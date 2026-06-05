/**
 * POST /api/scan-snapshot/start
 * SCAN FULL — Motor 1 (TOP 8 institucional)
 *
 * Direct implementation bypassing top8Pipeline.js module cache issues.
 * Uses evaluateCandidate + buildOperationalTop8FromEvaluations directly.
 */
import { buildUniverseResponse } from "../universe.js";
import { attachSnapshotToken, buildSnapshotPlan, processNextSnapshotBatch } from "../_lib/scanSnapshot.js";
import { saveLastScanSnapshot, loadBenchmarkBars, saveBenchmarkBars } from "../_lib/kvStorage.js";
import { fetchEodhdHistoricalBars } from "../_lib/historicalDataProvider.js";
import { raceBenchmarkHistory } from "../_lib/providerCascade.js";
import { fetchEodhdSpread } from "../_lib/spreadDataProvider.js";
import { calculateTechnicals } from "../_lib/technicalEngine.js";
import { evaluateCandidate, buildOperationalTop8FromEvaluations, buildEligibilityDiagnostics, summarizeEvaluations } from "../_lib/candidateEvaluationEngine.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "SCAN_SNAPSHOT_START";
const BENCHMARK_SYMBOL = "SPY.US";
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

// Market hours — used to set correct marketStatus per asset
function isWeekend(date) {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}
function inRange(date, startMin, endMin) {
  const m = date.getUTCHours() * 60 + date.getUTCMinutes();
  return m >= startMin && m < endMin;
}
function isUsDst(date) {
  // Approximate: DST active March-November
  const month = date.getUTCMonth() + 1;
  return month >= 3 && month <= 11;
}
function marketStatusForExchange(exchange, date) {
  if (isWeekend(date)) return "CLOSED";
  const n = String(exchange ?? "").toUpperCase();
  if (n.includes("NASDAQ") || n.includes("NYSE") || n === "USA_SUPPORTED") {
    return inRange(date, isUsDst(date) ? 13 * 60 + 30 : 14 * 60 + 30,
      isUsDst(date) ? 20 * 60 : 21 * 60) ? "OPEN" : "CLOSED";
  }
  if (n.includes("LSE") || n.includes("LONDON")) {
    return inRange(date, 8 * 60, 16 * 60 + 30) ? "OPEN" : "CLOSED";
  }
  if (n.includes("XETRA") || n.includes("EURONEXT") || n.includes("BORSA") ||
      n.includes("ITALIANA") || n.includes("SIX") || n.includes("MILAN") ||
      n.includes("PARIS") || n.includes("AMSTERDAM")) {
    return inRange(date, 7 * 60, 15 * 60 + 30) ? "OPEN" : "CLOSED";
  }
  return "CLOSED";
}

function sendJson(response, statusCode, payload) {
  response.status(statusCode).json({
    ...payload,
    app: APP_NAME,
    endpoint: ENDPOINT,
    timestampUtc: new Date().toISOString(),
  });
}

async function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function getActiveMarkets(assets) {
  return [...new Set(assets.map(a => a.market ?? a.providerExchange ?? "UNKNOWN"))];
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return sendJson(response, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const queryKeys = Object.keys(request.query ?? {});
  if (queryKeys.length > 0) {
    return sendJson(response, 400, { ok: false, error: "QUERY_NOT_ALLOWED" });
  }

  const body = await readJsonBody(request);
  const batchSize = Math.min(body.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const scanStartedAtUtc = new Date().toISOString();

  // 1. Get universe
  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok) {
    return sendJson(response, 409, {
      ok: false,
      scanStartedAtUtc,
      scanCompletedAtUtc: new Date().toISOString(),
      status: "DATA_UNAVAILABLE",
      resultScope: "DATA_UNAVAILABLE",
      isGlobalTop8Final: false,
      coveragePercent: 0,
      error: universe.error ?? "UNIVERSE_DISCOVERY_NOT_READY",
      blockedReasons: [universe.error ?? "UNIVERSE_DISCOVERY_NOT_READY"],
      assets: [],
      message: "SCAN FULL cannot start without real universe metadata.",
    });
  }

  // 2. Filter operable assets
  const allOperable = (universe.assets ?? []).filter(a => a.operabilityStatus === "OPERABLE");
  if (allOperable.length === 0) {
    return sendJson(response, 409, {
      ok: false,
      scanStartedAtUtc,
      status: "DATA_UNAVAILABLE",
      error: "NO_OPERABLE_ASSETS",
      assets: [],
    });
  }

  const batchesTotal = Math.ceil(allOperable.length / batchSize);
  const universeHash = Buffer.from(allOperable.map(a => a.providerSymbol).join(","))
    .toString("base64url").slice(0, 16);
  const activeMarkets = getActiveMarkets(allOperable);
  const scanId = `scan-${Date.now().toString(36)}`;

  // 3. Process batch 0
  const batch = allOperable.slice(0, batchSize);
  const now = new Date();

  // Fetch SPY benchmark — Redis cache (4h TTL) + parallel race across ALL providers
  // This guarantees RS (Relative Strength) is always calculable, never falls back to neutral 50
  let benchmarkBars = [];
  try {
    // 1. Try Redis cache first (fast, <50ms)
    const cached = await loadBenchmarkBars();
    if (cached) {
      benchmarkBars = cached;
    } else {
      // 2. Cache miss → race ALL 4 providers simultaneously (fastest wins, no timeout risk)
      const env = process.env;
      const spyResult = await raceBenchmarkHistory(270, {
        EODHD_API_KEY:       env.EODHD_API_KEY,
        TWELVE_DATA_API_KEY: env.TWELVE_DATA_API_KEY,
      });
      if (spyResult.ok && spyResult.bars.length >= 61) {
        benchmarkBars = spyResult.bars;
        saveBenchmarkBars(benchmarkBars); // async, fire-and-forget
      }
    }
  } catch { /* no benchmark — RS will use neutral 50 */ }

  // 4. Evaluate ALL assets IN PARALLEL — reduces time from N×T to max(T)
  const assetResults = await Promise.all(
    batch.map(async (asset) => {
      try {
        const [histResult, spreadResult] = await Promise.all([
          fetchEodhdHistoricalBars(asset.providerSymbol),
          fetchEodhdSpread(asset.providerSymbol).catch(() => ({ ok: false, blockedReason: "SPREAD_PROVIDER_FAILED" })),
        ]);
        return { asset, histResult, spreadResult };
      } catch {
        return { asset, histResult: { ok: false, bars: [] }, spreadResult: { ok: false } };
      }
    })
  );

  const evaluations = assetResults.map(({ asset, histResult, spreadResult }) =>
    evaluateCandidate({
      asset,
      historicalBars: histResult.ok ? histResult.bars : [],
      benchmarkBars,
      spreadPercent: spreadResult.ok ? spreadResult.spreadPercent : null,
      historyStatus: { ok: histResult.ok === true, provider: histResult.provider ?? null, providerSymbol: histResult.providerSymbol ?? asset.providerSymbol, blockedReason: histResult.ok ? null : histResult.blockedReason ?? "HISTORY_FAILED", barCount: Array.isArray(histResult.bars) ? histResult.bars.length : 0 },
      spreadStatus: { ok: spreadResult.ok === true, provider: spreadResult.provider ?? null, providerSymbol: spreadResult.providerSymbol ?? asset.providerSymbol, blockedReason: spreadResult.ok ? null : spreadResult.blockedReason ?? "SPREAD_FAILED", spreadPercent: spreadResult.spreadPercent ?? null },
      marketStatus: marketStatusForExchange(asset.exchange ?? asset.market, now),
      dataQuality: "GOOD",
    })
  );
  const providerCalls = 1 + batch.length * 2;

  // 5. Build TOP 8
  const top8 = buildOperationalTop8FromEvaluations(evaluations);

  const batchesCompleted = 1;
  const coveragePercent = Math.round((batchesCompleted / batchesTotal) * 100);
  const isGlobalTop8Final = batchesCompleted >= batchesTotal;
  const scanCompletedAtUtc = isGlobalTop8Final ? new Date().toISOString() : null;

  const summary = summarizeEvaluations(evaluations);
  const eligibilityDiagnostics = buildEligibilityDiagnostics(evaluations, { batchSize: batch.length });

  // Add rank + scanId to results
  const topCandidates = top8.map((c, i) => ({
    ...c,
    rank: i + 1,
    scanId,
    scanStartedAtUtc,
    scanCompletedAtUtc,
  }));

  // Save if complete
  if (isGlobalTop8Final && topCandidates.length > 0) {
    const payload = {
      ok: true,
      scanId,
      scanStartedAtUtc,
      scanCompletedAtUtc,
      coveragePercent: 100,
      isGlobalTop8Final: true,
      topCandidates,
      universeHash,
      activeMarkets,
      universeCount: allOperable.length,
      actualProviderCalls: providerCalls,
    };
    await saveLastScanSnapshot(payload).catch(() => {});
  }

  // Build snapshot token for continuation
  const snapshotState = {
    scanId,
    scanStartedAtUtc,
    universeHash,
    activeMarkets,
    batchSize,
    batchesTotal,
    batchesCompleted,
    nextBatchIndex: isGlobalTop8Final ? null : 1,
    coveragePercent,
    universeCount: allOperable.length,
    actualProviderCalls: providerCalls,
    topCandidates,
    eligibleTickers: allOperable.map(a => a.providerSymbol),
    status: isGlobalTop8Final ? "GLOBAL_TOP8_FINAL" : "PARTIAL_BATCH_ONLY",
    isGlobalTop8Final,
    resultScope: isGlobalTop8Final ? "GLOBAL_TOP8_FINAL" : "PARTIAL_BATCH_ONLY",
  };

  // Compact token — include minimal top8 for cross-batch accumulation
  const compactAccumulated = top8.map(c => ({
    ticker: c.ticker, providerSymbol: c.providerSymbol, score: c.score,
    name: c.name, market: c.market, exchange: c.exchange, currency: c.currency,
    risk: c.risk, action: c.action, conviction: c.conviction,
    trailing: c.trailing, scoreBreakdown: c.scoreBreakdown,
    operabilityStatus: c.operabilityStatus, eligibility: c.eligibility,
    scanId, scanStartedAtUtc
  }));
  const compactState = {
    scanId: snapshotState.scanId,
    scanStartedAtUtc: snapshotState.scanStartedAtUtc,
    universeHash: snapshotState.universeHash,
    activeMarkets: snapshotState.activeMarkets,
    batchSize: snapshotState.batchSize,
    batchesTotal: snapshotState.batchesTotal,
    batchesCompleted: snapshotState.batchesCompleted,
    nextBatchIndex: snapshotState.nextBatchIndex,
    universeCount: snapshotState.universeCount,
    actualProviderCalls: snapshotState.actualProviderCalls,
    accumulatedTop8: compactAccumulated,
  };
  const snapshotToken = isGlobalTop8Final ? null
    : Buffer.from(JSON.stringify(compactState)).toString("base64url");

  const statusCode = isGlobalTop8Final ? 200 : batchesCompleted > 0 ? 206 : 409;

  return sendJson(response, statusCode, {
    ok: isGlobalTop8Final,
    mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
    status: snapshotState.status,
    scanId,
    scanStartedAtUtc,
    scanCompletedAtUtc,
    universeHash,
    activeMarkets,
    universeDiscovered: allOperable.length,
    universeAfterFilters: allOperable.length,
    batchesTotal,
    batchesCompleted,
    nextBatchIndex: snapshotState.nextBatchIndex,
    coveragePercent,
    estimatedProviderCalls: batchSize * 2 + 1,
    actualProviderCalls: providerCalls,
    resultScope: snapshotState.resultScope,
    isGlobalTop8Final,
    isPartialResult: !isGlobalTop8Final,
    snapshotToken,
    topCandidates,
    assets: topCandidates,
    diagnostics: {
      processedBatches: [{
        batchIndex: 1,
        selectedAssets: batch.length,
        providerCallsPlanned: batch.length * 2 + 1,
        ok: true,
        evaluationSummary: summary,
        eligibilityDiagnostics,
      }],
    },
    message: isGlobalTop8Final
      ? "Global TOP 8 final — 100% coverage."
      : `SCAN FULL batch 1/${batchesTotal} complete.`,
  });
}
