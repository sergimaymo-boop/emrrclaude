/**
 * /api/scan-snapshot  — unified dispatcher
 *
 * Combines start / continue / last into one Serverless Function to stay
 * within Vercel Hobby plan's 12-function limit.
 *
 * Routing (via vercel.json rewrites):
 *   POST /api/scan-snapshot/start    → ?action=start
 *   POST /api/scan-snapshot/continue → ?action=continue
 *   GET  /api/scan-snapshot/last     → ?action=last
 *
 * The subdirectory files api/scan-snapshot/{start,continue,last}.js have had
 * their export default removed so Vercel does not deploy them as separate
 * Serverless Functions.
 */

import { buildUniverseResponse } from './universe.js';
import { STATIC_ASSETS_BY_EXCHANGE } from './_lib/staticUniverse.js';
import { isEligibleForUniverse, mapUniverseAsset, PROVIDER_EXCHANGES } from './_lib/universeEngine.js';
import { fetchEodhdHistoricalBars } from './_lib/historicalDataProvider.js';
import { fetchEodhdSpread } from './_lib/spreadDataProvider.js';
import { evaluateCandidate, buildOperationalTop8FromEvaluations, buildEligibilityDiagnostics, summarizeEvaluations } from './_lib/candidateEvaluationEngine.js';
import { saveLastScanSnapshot, loadLastScanSnapshot, loadBenchmarkBars, saveBenchmarkBars } from './_lib/kvStorage.js';
import { raceBenchmarkHistory } from './_lib/providerCascade.js';
import { filterActiveOperableAssets, getActiveMarketsAt } from './_lib/scanSnapshot.js';

const APP_NAME = 'EMRR 2.0 / Tendencias';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

// ─── helpers ──────────────────────────────────────────────────────────────────
function sendJson(response, statusCode, payload, endpoint) {
  response.status(statusCode).json({ ...payload, app: APP_NAME, endpoint, timestampUtc: new Date().toISOString() });
}

// Compact serialization for the continuation token + persisted snapshot.
// CRITICAL: preserves the SCALAR technicals (momentum20, ema, rs, atr, etc.),
// spreadStatus and dataQuality so the dashboard can render momentum and resolve
// scoreInputIntegrity = REAL after the scan. We deliberately DROP the heavy
// arrays (historical bars / breakdown detail) that previously bloated the token
// to ~36KB and aborted iOS fetch — only ~15 numbers + 1 date per candidate are
// kept (~2KB total for the TOP 8), far under the limit.
function compactCandidate(c, scanId, scanStartedAtUtc) {
  const t = c?.technicalResult?.technicals;
  return {
    ticker: c.ticker, providerSymbol: c.providerSymbol, score: c.score, name: c.name,
    market: c.market, exchange: c.exchange, currency: c.currency, risk: c.risk,
    action: c.action, conviction: c.conviction, trailing: c.trailing,
    scoreBreakdown: c.scoreBreakdown, operabilityStatus: c.operabilityStatus,
    eligibility: c.eligibility, dataQuality: c.dataQuality,
    spreadStatus: c.spreadStatus
      ? { ok: c.spreadStatus.ok, spreadPercent: c.spreadStatus.spreadPercent ?? null, blockedReason: c.spreadStatus.blockedReason ?? null }
      : null,
    technicalResult: t
      ? {
          ok: c.technicalResult.ok,
          dataQuality: c.technicalResult.dataQuality,
          validBars: c.technicalResult.validBars,
          technicals: {
            ema20: t.ema20 ?? null, ema50: t.ema50 ?? null, ema20SlopePercent: t.ema20SlopePercent ?? null,
            atr: t.atr ?? null, atrPercent: t.atrPercent ?? null, rvol: t.rvol ?? null,
            momentum5: t.momentum5 ?? null, momentum20: t.momentum20 ?? null,
            rs20: t.rs20 ?? null, rs60: t.rs60 ?? null,
            avgVolume20: t.avgVolume20 ?? null, avgValue20: t.avgValue20 ?? null,
            maxDrawdown20: t.maxDrawdown20 ?? null, lastClose: t.lastClose ?? null, lastDate: t.lastDate ?? null,
          },
        }
      : (c.technicalResult ?? null),
    scanId, scanStartedAtUtc,
  };
}

async function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

function isWeekend(date) { const d = date.getUTCDay(); return d === 0 || d === 6; }
function inRange(date, s, e) { const m = date.getUTCHours() * 60 + date.getUTCMinutes(); return m >= s && m < e; }
function isUsDst(date) { const mo = date.getUTCMonth() + 1; return mo >= 3 && mo <= 11; }
function marketStatusForExchange(exchange, date) {
  if (isWeekend(date)) return 'CLOSED';
  const n = String(exchange ?? '').toUpperCase();
  if (n.includes('NASDAQ') || n.includes('NYSE') || n === 'USA_SUPPORTED')
    return inRange(date, isUsDst(date) ? 13*60+30 : 14*60+30, isUsDst(date) ? 20*60 : 21*60) ? 'OPEN' : 'CLOSED';
  if (n.includes('LSE') || n.includes('LONDON')) return inRange(date, 8*60, 16*60+30) ? 'OPEN' : 'CLOSED';
  if (n.includes('XETRA') || n.includes('EURONEXT') || n.includes('BORSA') || n.includes('ITALIANA') || n.includes('SIX') || n.includes('MILAN') || n.includes('PARIS') || n.includes('AMSTERDAM'))
    return inRange(date, 7*60, 15*60+30) ? 'OPEN' : 'CLOSED';
  return 'CLOSED';
}

async function fetchBenchmarkBars() {
  try {
    const cached = await loadBenchmarkBars();
    if (cached) return cached;
    const env = process.env;
    const spyResult = await raceBenchmarkHistory(270, { EODHD_API_KEY: env.EODHD_API_KEY, TWELVE_DATA_API_KEY: env.TWELVE_DATA_API_KEY });
    if (spyResult.ok && spyResult.bars.length >= 61) {
      const bars = spyResult.bars;
      saveBenchmarkBars(bars); // fire-and-forget
      return bars;
    }
  } catch { /* no benchmark — RS falls back to neutral 50 */ }
  return [];
}

// ─── start ────────────────────────────────────────────────────────────────────
async function handleStart(request, response) {
  if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'SCAN_SNAPSHOT_START');

  const queryKeys = Object.keys(request.query ?? {}).filter(k => k !== 'action');
  if (queryKeys.length > 0) return sendJson(response, 400, { ok: false, error: 'QUERY_NOT_ALLOWED' }, 'SCAN_SNAPSHOT_START');

  const body = await readJsonBody(request);
  const batchSize = Math.min(body.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const scanStartedAtUtc = new Date().toISOString();

  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok) {
    return sendJson(response, 409, { ok: false, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), status: 'DATA_UNAVAILABLE', resultScope: 'DATA_UNAVAILABLE', isGlobalTop8Final: false, coveragePercent: 0, error: universe.error ?? 'UNIVERSE_DISCOVERY_NOT_READY', blockedReasons: [universe.error ?? 'UNIVERSE_DISCOVERY_NOT_READY'], assets: [], message: 'SCAN FULL cannot start without real universe metadata.' }, 'SCAN_SNAPSHOT_START');
  }

  const activeMarkets = getActiveMarketsAt(scanStartedAtUtc);
  // isLastCloseMode: ambos mercados cerrados → analiza universo completo con último precio de cierre.
  const isLastCloseMode = activeMarkets.length === 0;
  const allOperable = isLastCloseMode
    ? (universe.assets ?? []).filter(a => a?.operabilityStatus === 'OPERABLE')
    : filterActiveOperableAssets(universe.assets ?? [], scanStartedAtUtc);
  if (allOperable.length === 0) return sendJson(response, 409, { ok: false, scanStartedAtUtc, status: 'DATA_UNAVAILABLE', error: 'NO_OPERABLE_ASSETS', activeMarkets, assets: [] }, 'SCAN_SNAPSHOT_START');

  const batchesTotal = Math.ceil(allOperable.length / batchSize);
  const universeHash = Buffer.from(allOperable.map(a => a.providerSymbol).join(',')).toString('base64url').slice(0, 16);
  const scanId = `scan-${Date.now().toString(36)}`;
  const batch = allOperable.slice(0, batchSize);
  const now = new Date();

  const benchmarkBars = await fetchBenchmarkBars();

  const assetResults = await Promise.all(batch.map(async (asset) => {
    try {
      const [histResult, spreadResult] = await Promise.all([
        fetchEodhdHistoricalBars(asset.providerSymbol),
        fetchEodhdSpread(asset.providerSymbol).catch(() => ({ ok: false, blockedReason: 'SPREAD_PROVIDER_FAILED' })),
      ]);
      return { asset, histResult, spreadResult };
    } catch { return { asset, histResult: { ok: false, bars: [] }, spreadResult: { ok: false } }; }
  }));

  const evaluations = assetResults.map(({ asset, histResult, spreadResult }) => evaluateCandidate({
    asset,
    historicalBars: histResult.ok ? histResult.bars : [],
    benchmarkBars,
    spreadPercent: spreadResult.ok ? spreadResult.spreadPercent : null,
    historyStatus: { ok: histResult.ok === true, provider: histResult.provider ?? null, providerSymbol: histResult.providerSymbol ?? asset.providerSymbol, blockedReason: histResult.ok ? null : histResult.blockedReason ?? 'HISTORY_FAILED', barCount: Array.isArray(histResult.bars) ? histResult.bars.length : 0 },
    spreadStatus: { ok: spreadResult.ok === true, provider: spreadResult.provider ?? null, providerSymbol: spreadResult.providerSymbol ?? asset.providerSymbol, blockedReason: spreadResult.ok ? null : spreadResult.blockedReason ?? 'SPREAD_FAILED', spreadPercent: spreadResult.spreadPercent ?? null },
    marketStatus: marketStatusForExchange(asset.exchange ?? asset.market, now),
    dataQuality: 'GOOD',
  }));
  const providerOkBatch = assetResults.filter(r => r.histResult?.ok === true).length;
  const providerFailBatch = batch.length - providerOkBatch;
  const providerCalls = 1 + batch.length * 2;
  const top8 = buildOperationalTop8FromEvaluations(evaluations);
  const batchesCompleted = 1;
  const coveragePercent = Math.round((batchesCompleted / batchesTotal) * 100);
  const isGlobalTop8Final = batchesCompleted >= batchesTotal;
  const scanCompletedAtUtc = isGlobalTop8Final ? new Date().toISOString() : null;
  const summary = summarizeEvaluations(evaluations);
  const eligibilityDiagnostics = buildEligibilityDiagnostics(evaluations, { batchSize: batch.length });
  const topCandidates = top8.map((c, i) => ({ ...c, rank: i + 1, scanId, scanStartedAtUtc, scanCompletedAtUtc }));
  const dataIntegrityScore = Math.round(providerOkBatch / Math.max(batch.length, 1) * 100);

  if (isGlobalTop8Final && topCandidates.length > 0) {
    await saveLastScanSnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc, coveragePercent: 100, isGlobalTop8Final: true, topCandidates, universeHash, activeMarkets, universeCount: allOperable.length, actualProviderCalls: providerCalls, dataIntegrityScore, dataIntegrity: { tickersOk: providerOkBatch, tickersFailed: providerFailBatch, score: dataIntegrityScore } }).catch(() => {});
  }

  const compactAccumulated = top8.map(c => compactCandidate(c, scanId, scanStartedAtUtc));
  const snapshotToken = isGlobalTop8Final ? null : Buffer.from(JSON.stringify({ scanId, scanStartedAtUtc, universeHash, activeMarkets, isLastCloseMode, batchSize, batchesTotal, batchesCompleted, nextBatchIndex: 1, universeCount: allOperable.length, actualProviderCalls: providerCalls, accProviderOk: providerOkBatch, accProviderFail: providerFailBatch, accumulatedTop8: compactAccumulated })).toString('base64url');
  const statusCode = isGlobalTop8Final ? 200 : batchesCompleted > 0 ? 206 : 409;
  const marketMode = isLastCloseMode ? 'LAST_CLOSE' : 'LIVE';

  return sendJson(response, statusCode, { ok: isGlobalTop8Final, mode: 'CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT', marketMode, status: isGlobalTop8Final ? 'GLOBAL_TOP8_FINAL' : 'PARTIAL_BATCH_ONLY', scanId, scanStartedAtUtc, scanCompletedAtUtc, universeHash, activeMarkets, universeDiscovered: allOperable.length, universeAfterFilters: allOperable.length, batchesTotal, batchesCompleted, nextBatchIndex: isGlobalTop8Final ? null : 1, coveragePercent, estimatedProviderCalls: batchSize * 2 + 1, actualProviderCalls: providerCalls, resultScope: isGlobalTop8Final ? 'GLOBAL_TOP8_FINAL' : 'PARTIAL_BATCH_ONLY', isGlobalTop8Final, isPartialResult: !isGlobalTop8Final, snapshotToken, topCandidates, assets: topCandidates, diagnostics: { processedBatches: [{ batchIndex: 1, selectedAssets: batch.length, providerCallsPlanned: batch.length * 2 + 1, ok: true, evaluationSummary: summary, eligibilityDiagnostics }] }, message: isGlobalTop8Final ? 'Global TOP 8 final — 100% coverage.' : `SCAN FULL batch 1/${batchesTotal} complete.` }, 'SCAN_SNAPSHOT_START');
}

// ─── continue ─────────────────────────────────────────────────────────────────
async function handleContinue(request, response) {
  if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'SCAN_SNAPSHOT_CONTINUE');

  const body = await readJsonBody(request);
  if (!body.snapshotToken) return sendJson(response, 400, { ok: false, error: 'SNAPSHOT_TOKEN_REQUIRED' }, 'SCAN_SNAPSHOT_CONTINUE');

  let state;
  try { state = JSON.parse(Buffer.from(body.snapshotToken, 'base64url').toString('utf8')); }
  catch { return sendJson(response, 400, { ok: false, error: 'INVALID_SNAPSHOT_TOKEN' }, 'SCAN_SNAPSHOT_CONTINUE'); }

  const { scanId, scanStartedAtUtc, universeHash, activeMarkets, isLastCloseMode, batchSize, batchesTotal, batchesCompleted, nextBatchIndex, universeCount, actualProviderCalls: prevCalls, accProviderOk: prevOk = 0, accProviderFail: prevFail = 0, accumulatedTop8: prevAccumulated } = state;

  if (nextBatchIndex === null || batchesCompleted >= batchesTotal) return sendJson(response, 400, { ok: false, error: 'SCAN_ALREADY_COMPLETE' }, 'SCAN_SNAPSHOT_CONTINUE');

  const activeMarketsNow = getActiveMarketsAt(scanStartedAtUtc);
  const sameActiveMarkets = Array.isArray(activeMarkets)
    ? activeMarkets.length === activeMarketsNow.length && activeMarkets.every(m => activeMarketsNow.includes(m))
    : true;
  // En LAST_CLOSE mode (mercados cerrados al inicio) se permite continuar aunque siguen cerrados.
  if (!isLastCloseMode && (!sameActiveMarkets || activeMarketsNow.length === 0)) {
    return sendJson(response, 409, { ok: false, error: 'ACTIVE_MARKET_STATE_CHANGED', scanId, scanStartedAtUtc, activeMarkets: activeMarketsNow, message: 'El estado de los mercados activos cambió durante el scan — se aborta.' }, 'SCAN_SNAPSHOT_CONTINUE');
  }

  let allOperable = [];
  try {
    const fullOperable = [];
    for (const exchangeConfig of PROVIDER_EXCHANGES) {
      const rows = STATIC_ASSETS_BY_EXCHANGE[exchangeConfig.providerExchange] ?? [];
      for (const row of rows) {
        if (isEligibleForUniverse(row, exchangeConfig)) {
          const asset = mapUniverseAsset(row, exchangeConfig);
          if (asset.operabilityStatus === 'OPERABLE') fullOperable.push(asset);
        }
      }
    }
    allOperable = isLastCloseMode ? fullOperable : filterActiveOperableAssets(fullOperable, scanStartedAtUtc);
  } catch(e) {
    return sendJson(response, 500, { ok: false, error: 'STATIC_UNIVERSE_FAILED', message: e.message }, 'SCAN_SNAPSHOT_CONTINUE');
  }
  if (allOperable.length === 0) return sendJson(response, 409, { ok: false, error: 'NO_OPERABLE_ASSETS_ON_CONTINUE' }, 'SCAN_SNAPSHOT_CONTINUE');

  const batch = allOperable.slice(nextBatchIndex * batchSize, (nextBatchIndex + 1) * batchSize);
  const benchmarkBars = await fetchBenchmarkBars();
  const now = new Date();

  const assetResults = await Promise.all(batch.map(async (asset) => {
    try {
      const [histResult, spreadResult] = await Promise.all([
        fetchEodhdHistoricalBars(asset.providerSymbol),
        fetchEodhdSpread(asset.providerSymbol).catch(() => ({ ok: false, blockedReason: 'SPREAD_FAILED' })),
      ]);
      return { asset, histResult, spreadResult };
    } catch { return { asset, histResult: { ok: false, bars: [] }, spreadResult: { ok: false } }; }
  }));

  const evaluations = assetResults.map(({ asset, histResult, spreadResult }) => evaluateCandidate({
    asset,
    historicalBars: histResult.ok ? histResult.bars : [],
    benchmarkBars,
    spreadPercent: spreadResult.ok ? spreadResult.spreadPercent : null,
    historyStatus: { ok: histResult.ok === true, provider: histResult.provider ?? null, providerSymbol: histResult.providerSymbol ?? asset.providerSymbol, blockedReason: histResult.ok ? null : 'HISTORY_FAILED', barCount: Array.isArray(histResult.bars) ? histResult.bars.length : 0 },
    spreadStatus: { ok: spreadResult.ok === true, provider: spreadResult.provider ?? null, providerSymbol: spreadResult.providerSymbol ?? asset.providerSymbol, blockedReason: spreadResult.ok ? null : 'SPREAD_FAILED', spreadPercent: spreadResult.spreadPercent ?? null },
    marketStatus: marketStatusForExchange(asset.exchange, now),
    dataQuality: 'GOOD',
  }));
  const providerOkBatch = assetResults.filter(r => r.histResult?.ok === true).length;
  const providerFailBatch = batch.length - providerOkBatch;
  const totalOk = prevOk + providerOkBatch;
  const totalFail = prevFail + providerFailBatch;
  const dataIntegrityScore = Math.round(totalOk / Math.max(totalOk + totalFail, 1) * 100);
  const providerCalls = 1 + batch.length * 2;
  const newTop8 = buildOperationalTop8FromEvaluations(evaluations);
  const accumulated = prevAccumulated ?? [];
  const combined = [...accumulated, ...newTop8]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((c, i, arr) => arr.findIndex(x => (x.providerSymbol ?? x.ticker) === (c.providerSymbol ?? c.ticker)) === i)
    .slice(0, 8);
  const newBatchesCompleted = batchesCompleted + 1;
  const newCoverage = Math.round((newBatchesCompleted / batchesTotal) * 100);
  const isGlobalTop8Final = newBatchesCompleted >= batchesTotal;
  const scanCompletedAtUtc = isGlobalTop8Final ? new Date().toISOString() : null;
  const totalCalls = (prevCalls ?? 0) + providerCalls;
  const topCandidates = combined.map((c, i) => ({ ...c, rank: i + 1, scanId, scanStartedAtUtc, scanCompletedAtUtc }));

  if (isGlobalTop8Final && topCandidates.length > 0) {
    await saveLastScanSnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc, coveragePercent: 100, isGlobalTop8Final: true, topCandidates, universeHash, activeMarkets, universeCount: allOperable.length, actualProviderCalls: totalCalls, dataIntegrityScore, dataIntegrity: { tickersOk: totalOk, tickersFailed: totalFail, score: dataIntegrityScore } }).catch(() => {});
  }

  const compactAccumulated = combined.map(c => compactCandidate(c, scanId, scanStartedAtUtc));
  const newSnapshotToken = isGlobalTop8Final ? null : Buffer.from(JSON.stringify({ scanId, scanStartedAtUtc, universeHash, activeMarkets, isLastCloseMode, batchSize, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: nextBatchIndex + 1, universeCount: allOperable.length, actualProviderCalls: totalCalls, accProviderOk: totalOk, accProviderFail: totalFail, accumulatedTop8: compactAccumulated })).toString('base64url');
  const marketModeContinue = isLastCloseMode ? 'LAST_CLOSE' : 'LIVE';

  return sendJson(response, isGlobalTop8Final ? 200 : 206, { ok: isGlobalTop8Final, mode: 'CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT', marketMode: marketModeContinue, status: isGlobalTop8Final ? 'GLOBAL_TOP8_FINAL' : 'PARTIAL_BATCH_ONLY', scanId, scanStartedAtUtc, scanCompletedAtUtc, universeHash, activeMarkets, universeDiscovered: allOperable.length, universeAfterFilters: allOperable.length, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isGlobalTop8Final ? null : nextBatchIndex + 1, coveragePercent: newCoverage, actualProviderCalls: totalCalls, dataIntegrityScore, resultScope: isGlobalTop8Final ? 'GLOBAL_TOP8_FINAL' : 'PARTIAL_BATCH_ONLY', isGlobalTop8Final, isPartialResult: !isGlobalTop8Final, snapshotToken: newSnapshotToken, topCandidates, assets: topCandidates, diagnostics: { processedBatches: [{ batchIndex: nextBatchIndex + 1, selectedAssets: batch.length, providerCallsPlanned: batch.length * 2 + 1, ok: true, evaluationSummary: summarizeEvaluations(evaluations), eligibilityDiagnostics: buildEligibilityDiagnostics(evaluations, { batchSize: batch.length }) }] }, message: isGlobalTop8Final ? 'Global TOP 8 final.' : `Batch ${newBatchesCompleted}/${batchesTotal} complete.` }, 'SCAN_SNAPSHOT_CONTINUE');
}

// ─── last ─────────────────────────────────────────────────────────────────────
async function handleLast(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', app: APP_NAME, endpoint: 'SCAN_SNAPSHOT_LAST' });

  const snapshot = await loadLastScanSnapshot();
  if (!snapshot) {
    return response.status(404).json({ ok: false, app: APP_NAME, endpoint: 'SCAN_SNAPSHOT_LAST', error: 'NO_STORED_SNAPSHOT', message: 'No completed scan snapshot found.', timestampUtc: new Date().toISOString() });
  }
  return response.status(200).json({ ...snapshot, app: APP_NAME, endpoint: 'SCAN_SNAPSHOT_LAST', source: 'LAST_SESSION_CACHE', retrievedAtUtc: new Date().toISOString() });
}

// ─── main dispatcher ──────────────────────────────────────────────────────────
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const action = request.query?.action ?? (request.url?.split('/').pop()?.split('?')[0]);
  if (action === 'start')    return handleStart(request, response);
  if (action === 'continue') return handleContinue(request, response);
  if (action === 'last')     return handleLast(request, response);
  return response.status(400).json({ ok: false, error: 'UNKNOWN_ACTION', validActions: ['start', 'continue', 'last'] });
}
