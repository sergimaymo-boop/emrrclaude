/**
 * /api/rally-scan  — unified dispatcher
 *
 * Combines start / continue / last into one Serverless Function to stay
 * within Vercel Hobby plan's 12-function limit.
 *
 * Routing (via vercel.json rewrites or direct query-param):
 *   POST /api/rally-scan?action=start    → handleStart
 *   POST /api/rally-scan?action=continue → handleContinue
 *   GET  /api/rally-scan?action=last     → handleLast
 *
 * The subdirectory files api/rally-scan/{start,continue,last}.js have had
 * their export default removed so Vercel does not deploy them as separate
 * functions.
 */

// ─── imports ─────────────────────────────────────────────────────────────────
// NOTE: The monetary cycle does NOT adjust the rally score. The rally score is a
// pure per-ticker technical breakout metric; a global macro offset would not change
// the relative ranking (all tickers shift equally) and there is no absolute rally
// threshold gate. The monetary cycle correctly modulates the ENTRY decision via
// Filter 5 (cycleWarning) in OptimalSignalPanel.tsx, not the technical ranking.
import { buildUniverseResponse } from './universe.js';
import { saveLastRallySnapshot, loadLastRallySnapshot } from './_lib/kvStorage.js';
import { runRallyBatch, fetchSpyBars } from './_lib/rallyBatchProcessor.js';
import { filterActiveOperableAssets, getActiveMarketsAt } from './_lib/scanSnapshot.js';

const APP_NAME  = 'EMRR 2.0 / Tendencias';
const RALLY_VERSION = 'RALLY_V1';
const BATCH_SIZE    = 80;
const MAX_TOP_CANDIDATES = 10;

function getEnv()         { return globalThis.process?.env ?? {}; }
function isRealApi()      { return getEnv().ENABLE_REAL_API_CALLS === 'true'; }

function sendJson(res, status, payload, endpoint) {
  res.status(status).json({ ...payload, app: APP_NAME, endpoint, timestampUtc: new Date().toISOString() });
}

function encodeToken(state) {
  return Buffer.from(JSON.stringify({ v: RALLY_VERSION, ...state })).toString('base64url');
}

function decodeToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (decoded.v !== RALLY_VERSION) return { ok: false, error: 'INVALID_TOKEN_VERSION' };
    return { ok: true, state: decoded };
  } catch { return { ok: false, error: 'TOKEN_DECODE_FAILED' }; }
}

function createScanId() { return `rally-${Date.now().toString(36)}`; }

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

// ─── start handler ────────────────────────────────────────────────────────────
async function handleStart(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'RALLY_SCAN_START');
  if (!isRealApi()) return sendJson(res, 409, { ok: false, status: 'RALLY_DATA_UNAVAILABLE', error: 'REAL_API_CALLS_DISABLED', message: 'Set ENABLE_REAL_API_CALLS=true to run Rally scan.' }, 'RALLY_SCAN_START');

  const scanStartedAtUtc = new Date().toISOString();
  const scanId = createScanId();

  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok || universe.assets.length === 0) {
    return sendJson(res, 409, { ok: false, status: 'RALLY_DATA_UNAVAILABLE', error: universe.error ?? 'UNIVERSE_NOT_READY', message: 'Rally scan requires active universe.' }, 'RALLY_SCAN_START');
  }

  const activeMarkets = getActiveMarketsAt(scanStartedAtUtc);
  // Siempre universo completo. Mercados abiertos → precios en tiempo real; cerrados → último cierre.
  const eligibleAssets = (universe.assets ?? []).filter(a => a?.operabilityStatus === 'OPERABLE');
  if (eligibleAssets.length === 0) {
    return sendJson(res, 409, { ok: false, status: 'RALLY_DATA_UNAVAILABLE', error: 'NO_OPERABLE_ASSETS', activeMarkets, message: 'No operable assets in universe.' }, 'RALLY_SCAN_START');
  }

  const spyBars = await fetchSpyBars();
  const batchesTotal = Math.ceil(eligibleAssets.length / BATCH_SIZE);
  const universeHash = Buffer.from(eligibleAssets.map(a => a.providerSymbol).join(',')).toString('base64url').slice(0, 16);

  const { candidates, providerCalls } = await runRallyBatch({ eligibleAssets, batchIndex: 0, batchSize: BATCH_SIZE, existingCandidates: [], spyBars });
  const batchesCompleted = 1;
  const coveragePercent  = Math.round((batchesCompleted / batchesTotal) * 100);
  const isComplete = batchesCompleted >= batchesTotal;
  const top10 = candidates.map((c, i) => ({ ...c, rank: i + 1, scanId }));

  if (isComplete) {
    await saveLastRallySnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), coveragePercent: 100, isRallyFinal: true, top10, universeHash, activeMarkets, universeCount: eligibleAssets.length, actualProviderCalls: providerCalls });
  }

  const rallyToken = encodeToken({ scanId, scanStartedAtUtc, universeHash, activeMarkets, universeCount: eligibleAssets.length, batchSize: BATCH_SIZE, batchesTotal, batchesCompleted, nextBatchIndex: isComplete ? null : 1, coveragePercent, eligibleTickers: eligibleAssets.map(a => a.providerSymbol), topCandidates: top10, actualProviderCalls: providerCalls, spyBarsLength: spyBars.length });

  return sendJson(res, isComplete ? 200 : 206, { ok: isComplete, mode: 'RALLY_LEADERS_SCAN', status: isComplete ? 'RALLY_FINAL' : 'RALLY_SCANNING', scanId, scanStartedAtUtc, scanCompletedAtUtc: isComplete ? new Date().toISOString() : null, universeHash, activeMarkets, universeCount: eligibleAssets.length, batchesTotal, batchesCompleted, nextBatchIndex: isComplete ? null : 1, coveragePercent, actualProviderCalls: providerCalls, isRallyFinal: isComplete, rallyToken: isComplete ? null : rallyToken, top10, message: isComplete ? 'Rally Leaders final.' : `Rally scan partial — batch 1/${batchesTotal} complete.` }, 'RALLY_SCAN_START');
}

// ─── continue handler ─────────────────────────────────────────────────────────
async function handleContinue(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'RALLY_SCAN_CONTINUE');
  if (!isRealApi()) return sendJson(res, 409, { ok: false, error: 'REAL_API_CALLS_DISABLED' }, 'RALLY_SCAN_CONTINUE');

  const body = await readBody(req);
  if (!body.rallyToken) return sendJson(res, 400, { ok: false, error: 'RALLY_TOKEN_REQUIRED' }, 'RALLY_SCAN_CONTINUE');

  const decoded = decodeToken(body.rallyToken);
  if (!decoded.ok) return sendJson(res, 400, { ok: false, error: decoded.error }, 'RALLY_SCAN_CONTINUE');

  const state = decoded.state;
  const { scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize, batchesTotal, batchesCompleted, nextBatchIndex, eligibleTickers, topCandidates, actualProviderCalls } = state;

  if (nextBatchIndex === null || batchesCompleted >= batchesTotal) {
    return sendJson(res, 400, { ok: false, error: 'SCAN_ALREADY_COMPLETE' }, 'RALLY_SCAN_CONTINUE');
  }

  // Re-derivar el universo real (determinista) y mapear cada ticker guardado a su asset COMPLETO,
  // preservando el orden exacto capturado en el token de start. Antes se reconstruía la metadata
  // desde el sufijo del ticker (.US→USA/USD, resto→Europe/EUR), lo que CORROMPÍA región/exchange/
  // currency respecto al batch inicial (p.ej. .L=Londres/GBX y .SW=Suiza/CHF caían a Europe/EUR).
  // La reconstrucción por sufijo se conserva solo como fallback ante deriva rara del universo.
  const universe = await buildUniverseResponse({ includeFullAssets: true });
  const assetBySymbol = new Map((universe.assets ?? []).map(a => [a.providerSymbol, a]));
  const eligibleAssets = eligibleTickers.map(ticker => assetBySymbol.get(ticker) ?? ({
    providerSymbol: ticker, ticker: ticker.split('.')[0], name: ticker.split('.')[0],
    market: ticker.includes('.US') ? 'Nasdaq/NYSE' : 'Europe', region: ticker.includes('.US') ? 'USA' : 'Europe',
    exchange: ticker.split('.').slice(1).join('.'), currency: ticker.includes('.US') ? 'USD' : 'EUR',
  }));
  const spyBars = await fetchSpyBars();
  const { candidates, providerCalls: newCalls } = await runRallyBatch({ eligibleAssets, batchIndex: nextBatchIndex, batchSize, existingCandidates: topCandidates ?? [], spyBars });

  const newBatchesCompleted = batchesCompleted + 1;
  const newCoveragePercent  = Math.round((newBatchesCompleted / batchesTotal) * 100);
  const isComplete  = newBatchesCompleted >= batchesTotal;
  const totalCalls  = (actualProviderCalls ?? 0) + newCalls;
  const top10 = candidates.map((c, i) => ({ ...c, rank: i + 1, scanId }));

  if (isComplete) {
    await saveLastRallySnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), coveragePercent: 100, isRallyFinal: true, top10, universeHash, activeMarkets, universeCount: eligibleTickers.length, actualProviderCalls: totalCalls });
  }

  const newToken = isComplete ? null : encodeToken({ scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isComplete ? null : nextBatchIndex + 1, coveragePercent: newCoveragePercent, eligibleTickers, topCandidates: top10, actualProviderCalls: totalCalls, spyBarsLength: spyBars.length });

  return sendJson(res, isComplete ? 200 : 206, { ok: isComplete, mode: 'RALLY_LEADERS_SCAN', status: isComplete ? 'RALLY_FINAL' : 'RALLY_SCANNING', scanId, scanStartedAtUtc, scanCompletedAtUtc: isComplete ? new Date().toISOString() : null, universeHash, activeMarkets, universeCount: eligibleTickers.length, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isComplete ? null : nextBatchIndex + 1, coveragePercent: newCoveragePercent, actualProviderCalls: totalCalls, isRallyFinal: isComplete, rallyToken: newToken, top10, message: isComplete ? 'Rally Leaders final.' : `Rally scan partial — batch ${newBatchesCompleted}/${batchesTotal} complete.` }, 'RALLY_SCAN_CONTINUE');
}

// ─── last handler ─────────────────────────────────────────────────────────────
async function handleLast(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', app: APP_NAME, endpoint: 'RALLY_SCAN_LAST' });

  const snapshot = await loadLastRallySnapshot();
  if (!snapshot) {
    return res.status(404).json({ ok: false, app: APP_NAME, endpoint: 'RALLY_SCAN_LAST', error: 'NO_STORED_RALLY_SNAPSHOT', status: 'RALLY_DATA_UNAVAILABLE', message: 'No completed Rally scan found.', timestampUtc: new Date().toISOString() });
  }
  return res.status(200).json({ ...snapshot, app: APP_NAME, endpoint: 'RALLY_SCAN_LAST', source: 'LAST_SESSION_CACHE', retrievedAtUtc: new Date().toISOString() });
}

// ─── main dispatcher ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Determine action from query param (set by vercel.json rewrite) or URL path
  const action = req.query?.action ?? (req.url?.split('/').pop()?.split('?')[0]);
  if (action === 'start')    return handleStart(req, res);
  if (action === 'continue') return handleContinue(req, res);
  if (action === 'last')     return handleLast(req, res);
  return res.status(400).json({ ok: false, error: 'UNKNOWN_ACTION', validActions: ['start', 'continue', 'last'] });
}
