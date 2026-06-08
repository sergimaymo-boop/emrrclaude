/**
 * POST /api/scan-snapshot/continue
 * Continues a scan started by start.js using the base64 state token.
 */
import { STATIC_ASSETS_BY_EXCHANGE } from "../_lib/staticUniverse.js";
import { isEligibleForUniverse, mapUniverseAsset, PROVIDER_EXCHANGES } from "../_lib/universeEngine.js";
import { fetchEodhdHistoricalBars } from "../_lib/historicalDataProvider.js";
import { fetchEodhdSpread } from "../_lib/spreadDataProvider.js";
import { evaluateCandidate, buildOperationalTop8FromEvaluations, buildEligibilityDiagnostics, summarizeEvaluations } from "../_lib/candidateEvaluationEngine.js";
import { saveLastScanSnapshot, loadBenchmarkBars, saveBenchmarkBars } from "../_lib/kvStorage.js";
import { raceBenchmarkHistory } from "../_lib/providerCascade.js";
import { filterActiveOperableAssets, getActiveMarketsAt } from "../_lib/scanSnapshot.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "SCAN_SNAPSHOT_CONTINUE";
const BENCHMARK_SYMBOL = "SPY.US";

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

function isWeekend(date) { const d = date.getUTCDay(); return d === 0 || d === 6; }
function inRange(date, s, e) { const m = date.getUTCHours() * 60 + date.getUTCMinutes(); return m >= s && m < e; }
function isUsDst(date) { const mo = date.getUTCMonth() + 1; return mo >= 3 && mo <= 11; }
function marketStatusForExchange(exchange, date) {
  if (isWeekend(date)) return "CLOSED";
  const n = String(exchange ?? "").toUpperCase();
  if (n.includes("NASDAQ") || n.includes("NYSE") || n === "USA_SUPPORTED")
    return inRange(date, isUsDst(date) ? 13*60+30 : 14*60+30, isUsDst(date) ? 20*60 : 21*60) ? "OPEN" : "CLOSED";
  if (n.includes("LSE") || n.includes("LONDON")) return inRange(date, 8*60, 16*60+30) ? "OPEN" : "CLOSED";
  if (n.includes("XETRA") || n.includes("EURONEXT") || n.includes("BORSA") || n.includes("SIX") || n.includes("MILAN") || n.includes("PARIS") || n.includes("AMSTERDAM"))
    return inRange(date, 7*60, 15*60+30) ? "OPEN" : "CLOSED";
  return "CLOSED";
}

function mergeTop8(existing, newOnes) {
  const map = new Map((existing ?? []).map(c => [c.providerSymbol ?? c.ticker, c]));
  for (const c of (newOnes ?? [])) {
    const key = c.providerSymbol ?? c.ticker;
    const prev = map.get(key);
    if (!prev || (c.score ?? 0) > (prev.score ?? 0)) map.set(key, c);
  }
  return [...map.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") return sendJson(response, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const body = await readJsonBody(request);
  if (!body.snapshotToken) return sendJson(response, 400, { ok: false, error: "SNAPSHOT_TOKEN_REQUIRED" });

  // Decode the base64 state token from start.js
  let state;
  try {
    state = JSON.parse(Buffer.from(body.snapshotToken, "base64url").toString("utf8"));
  } catch {
    return sendJson(response, 400, { ok: false, error: "INVALID_SNAPSHOT_TOKEN" });
  }

  const { scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize,
    batchesTotal, batchesCompleted, nextBatchIndex, universeCount,
    actualProviderCalls: prevCalls,
    accumulatedTop8: prevAccumulated } = state; // accumulated top8 from previous batches

  if (nextBatchIndex === null || batchesCompleted >= batchesTotal) {
    return sendJson(response, 400, { ok: false, error: "SCAN_ALREADY_COMPLETE" });
  }

  // AUDIT FIX (mercados mixtos): el scan SOLO debe cubrir los mercados que
  // estaban abiertos cuando arrancó (scanStartedAtUtc, igual que en start.js —
  // ancla el filtro al inicio del scan, no al "ahora" de cada batch, para que
  // el slicing por nextBatchIndex permanezca alineado entre lotes). Si entre
  // batches cambia el estado de mercados activos, abortamos para evitar mezclar
  // sesiones (igual que el guard "ACTIVE_MARKET_STATE_CHANGED" del motor Rally).
  const activeMarketsNow = getActiveMarketsAt(scanStartedAtUtc);
  const sameActiveMarkets = Array.isArray(activeMarkets)
    ? activeMarkets.length === activeMarketsNow.length && activeMarkets.every((m) => activeMarketsNow.includes(m))
    : true;
  if (!sameActiveMarkets || activeMarketsNow.length === 0) {
    return sendJson(response, 409, {
      ok: false,
      error: "ACTIVE_MARKET_STATE_CHANGED",
      scanId, scanStartedAtUtc, activeMarkets: activeMarketsNow,
      message: "El estado de los mercados activos cambió durante el scan — se aborta para no mezclar sesiones.",
    });
  }

  // Rebuild operable assets directly from static universe (no external calls, no ENABLE check),
  // luego filtrar a SOLO los activos cuyo mercado/región estaba abierto al arrancar el scan —
  // misma regla y misma ancla temporal que start.js, para mantener el slicing por batch alineado.
  let allOperable = [];
  try {
    const fullOperable = [];
    for (const exchangeConfig of PROVIDER_EXCHANGES) {
      const rows = STATIC_ASSETS_BY_EXCHANGE[exchangeConfig.providerExchange] ?? [];
      for (const row of rows) {
        if (isEligibleForUniverse(row, exchangeConfig)) {
          const asset = mapUniverseAsset(row, exchangeConfig);
          if (asset.operabilityStatus === "OPERABLE") fullOperable.push(asset);
        }
      }
    }
    allOperable = filterActiveOperableAssets(fullOperable, scanStartedAtUtc);
  } catch(e) {
    return sendJson(response, 500, { ok: false, error: "STATIC_UNIVERSE_FAILED", message: e.message });
  }
  if (allOperable.length === 0) {
    return sendJson(response, 409, { ok: false, error: "NO_OPERABLE_ASSETS_ON_CONTINUE" });
  }
  const batch = allOperable.slice(nextBatchIndex * batchSize, (nextBatchIndex + 1) * batchSize);

  // Fetch SPY benchmark — Redis cache (4h TTL) + parallel race, same as start.js
  let benchmarkBars = [];
  try {
    const cached = await loadBenchmarkBars();
    if (cached) {
      benchmarkBars = cached;
    } else {
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
  } catch { /* RS will use neutral 50 if all providers fail */ }

  // Evaluate batch — ALL assets fetched IN PARALLEL (not sequential)
  // This reduces time from batchSize×callTime to max(callTime)
  const now = new Date();
  const assetResults = await Promise.all(
    batch.map(async (asset) => {
      try {
        const [histResult, spreadResult] = await Promise.all([
          fetchEodhdHistoricalBars(asset.providerSymbol),
          fetchEodhdSpread(asset.providerSymbol).catch(() => ({ ok: false, blockedReason: "SPREAD_FAILED" })),
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
      historyStatus: { ok: histResult.ok === true, provider: histResult.provider ?? null, providerSymbol: histResult.providerSymbol ?? asset.providerSymbol, blockedReason: histResult.ok ? null : "HISTORY_FAILED", barCount: Array.isArray(histResult.bars) ? histResult.bars.length : 0 },
      spreadStatus: { ok: spreadResult.ok === true, provider: spreadResult.provider ?? null, providerSymbol: spreadResult.providerSymbol ?? asset.providerSymbol, blockedReason: spreadResult.ok ? null : "SPREAD_FAILED", spreadPercent: spreadResult.spreadPercent ?? null },
      marketStatus: marketStatusForExchange(asset.exchange, now),
      dataQuality: "GOOD",
    })
  );
  const providerCalls = 1 + batch.length * 2;

  const newTop8 = buildOperationalTop8FromEvaluations(evaluations);

  // Merge with accumulated top8 from previous batches
  const accumulated = (prevAccumulated ?? []);
  const combined = [...accumulated, ...newTop8]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((c, i, arr) => arr.findIndex(x => (x.providerSymbol ?? x.ticker) === (c.providerSymbol ?? c.ticker)) === i)
    .slice(0, 8);
  const mergedTop8 = combined;
  const newBatchesCompleted = batchesCompleted + 1;
  const newCoverage = Math.round((newBatchesCompleted / batchesTotal) * 100);
  const isGlobalTop8Final = newBatchesCompleted >= batchesTotal;
  const scanCompletedAtUtc = isGlobalTop8Final ? new Date().toISOString() : null;
  const totalCalls = (prevCalls ?? 0) + providerCalls;

  const topCandidates = mergedTop8.map((c, i) => ({ ...c, rank: i + 1, scanId, scanStartedAtUtc, scanCompletedAtUtc }));

  if (isGlobalTop8Final && topCandidates.length > 0) {
    await saveLastScanSnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc, coveragePercent: 100, isGlobalTop8Final: true, topCandidates, universeHash, activeMarkets, universeCount: allOperable.length, actualProviderCalls: totalCalls }).catch(() => {});
  }

  // Compact token — include minimal accumulated top8 for cross-batch merging
  const compactAccumulated = mergedTop8.map(c => ({
    ticker: c.ticker, providerSymbol: c.providerSymbol, score: c.score,
    name: c.name, market: c.market, exchange: c.exchange, currency: c.currency,
    risk: c.risk, action: c.action, conviction: c.conviction,
    trailing: c.trailing, scoreBreakdown: c.scoreBreakdown,
    operabilityStatus: c.operabilityStatus, eligibility: c.eligibility,
    scanId, scanStartedAtUtc
  }));
  const newSnapshotToken = isGlobalTop8Final ? null : Buffer.from(JSON.stringify({
    scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize, batchesTotal,
    batchesCompleted: newBatchesCompleted, nextBatchIndex: nextBatchIndex + 1,
    universeCount: allOperable.length, actualProviderCalls: totalCalls,
    accumulatedTop8: compactAccumulated, // carry forward best candidates
  })).toString("base64url");

  const statusCode = isGlobalTop8Final ? 200 : 206;

  return sendJson(response, statusCode, {
    ok: isGlobalTop8Final,
    mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
    status: isGlobalTop8Final ? "GLOBAL_TOP8_FINAL" : "PARTIAL_BATCH_ONLY",
    scanId, scanStartedAtUtc, scanCompletedAtUtc, universeHash, activeMarkets,
    universeDiscovered: allOperable.length, universeAfterFilters: allOperable.length,
    batchesTotal, batchesCompleted: newBatchesCompleted,
    nextBatchIndex: isGlobalTop8Final ? null : nextBatchIndex + 1,
    coveragePercent: newCoverage, actualProviderCalls: totalCalls,
    resultScope: isGlobalTop8Final ? "GLOBAL_TOP8_FINAL" : "PARTIAL_BATCH_ONLY",
    isGlobalTop8Final, isPartialResult: !isGlobalTop8Final,
    snapshotToken: newSnapshotToken,
    topCandidates, assets: topCandidates,
    diagnostics: { processedBatches: [{ batchIndex: nextBatchIndex + 1, selectedAssets: batch.length, providerCallsPlanned: batch.length * 2 + 1, ok: true, evaluationSummary: summarizeEvaluations(evaluations), eligibilityDiagnostics: buildEligibilityDiagnostics(evaluations, { batchSize: batch.length }) }] },
    message: isGlobalTop8Final ? "Global TOP 8 final." : `Batch ${newBatchesCompleted}/${batchesTotal} complete.`,
  });
}
