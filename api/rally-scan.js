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
import { saveLastRallySnapshot, loadLastRallySnapshot, saveLastRallyTestSnapshot, loadLastRallyTestSnapshot, saveLastIBKPortfolio, loadLastIBKPortfolio, saveRallyNews, loadRallyNews } from './_lib/kvStorage.js';
import { motivosDelMovimiento } from './_lib/tickerNews.js';
import { toYahooSymbol } from './_lib/providerCascade.js';
import { runRallyBatch, fetchSpyBars } from './_lib/rallyBatchProcessor.js';
import { assignSuggestedWeights } from './_lib/rallyScoreEngine.js';
// RALLY-TEST (laboratorio, 18-ago-2026): motor y batch processor PROPIOS, snapshot en
// clave KV propia y token con versión propia. Vive en este mismo archivo porque el plan
// Hobby de Vercel está en su tope de 12 funciones: un api/rally-test.js nuevo no
// desplegaría. Los handlers de producción de arriba NO se tocan.
import { runRallyBatch as runRallyTestBatch, fetchSpyBars as fetchSpyBarsTest } from './_lib/rallyBatchProcessorTest.js';
import { assignSuggestedWeights as assignSuggestedWeightsTest } from './_lib/rallyScoreEngineTest.js';
import { filterActiveOperableAssets, getActiveMarketsAt, signStateToken, verifyStateToken, isSnapshotSigningConfigured } from './_lib/scanSnapshot.js';

const APP_NAME  = 'EMRR 2.0 / Tendencias';
const RALLY_VERSION = 'RALLY_V1';
const RALLY_TEST_VERSION = 'RALLY_TEST_V1';   // versión propia: un token de test NUNCA vale en producción, ni al revés
const BATCH_SIZE    = 80;
const MAX_TOP_CANDIDATES = 10;

function getEnv()         { return globalThis.process?.env ?? {}; }
function isRealApi()      { return getEnv().ENABLE_REAL_API_CALLS === 'true'; }

function sendJson(res, status, payload, endpoint) {
  res.status(status).json({ ...payload, app: APP_NAME, endpoint, timestampUtc: new Date().toISOString() });
}

// Firma HMAC compat (misma helper que scan-snapshot): con SCAN_SNAPSHOT_SIGNING_SECRET
// el token va firmado y se rechaza cualquier forja; sin la variable, fallback sin firma.
function encodeToken(state) {
  const payloadB64 = Buffer.from(JSON.stringify({ v: RALLY_VERSION, ...state })).toString('base64url');
  return signStateToken(payloadB64);
}

function decodeToken(token) {
  const verified = verifyStateToken(token);
  if (!verified.ok) return { ok: false, error: verified.error };
  try {
    const decoded = JSON.parse(Buffer.from(verified.payloadB64, 'base64url').toString('utf8'));
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
  // El peso por convicción se asigna sobre el conjunto final (necesita todos los scores).
  const top10 = assignSuggestedWeights(candidates.map((c, i) => ({ ...c, rank: i + 1, scanId })));

  if (isComplete) {
    await saveLastRallySnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), coveragePercent: 100, isRallyFinal: true, top10, universeHash, activeMarkets, universeCount: eligibleAssets.length, actualProviderCalls: providerCalls });
  }

  const rallyToken = encodeToken({ scanId, scanStartedAtUtc, universeHash, activeMarkets, universeCount: eligibleAssets.length, batchSize: BATCH_SIZE, batchesTotal, batchesCompleted, nextBatchIndex: isComplete ? null : 1, coveragePercent, eligibleTickers: eligibleAssets.map(a => a.providerSymbol), topCandidates: top10, actualProviderCalls: providerCalls, spyBarsLength: spyBars.length });
  const tokenSigning = isSnapshotSigningConfigured() ? 'SIGNED' : 'UNSIGNED_FALLBACK';
  const signingWarning = tokenSigning === 'UNSIGNED_FALLBACK' ? 'SCAN_SNAPSHOT_SIGNING_SECRET no configurada — tokens sin firma HMAC (fallback compat). Configúrala en Vercel para blindar la continuación.' : undefined;

  return sendJson(res, isComplete ? 200 : 206, { ok: isComplete, mode: 'RALLY_LEADERS_SCAN', status: isComplete ? 'RALLY_FINAL' : 'RALLY_SCANNING', scanId, scanStartedAtUtc, scanCompletedAtUtc: isComplete ? new Date().toISOString() : null, universeHash, activeMarkets, universeCount: eligibleAssets.length, batchesTotal, batchesCompleted, nextBatchIndex: isComplete ? null : 1, coveragePercent, actualProviderCalls: providerCalls, isRallyFinal: isComplete, rallyToken: isComplete ? null : rallyToken, tokenSigning, signingWarning, top10, message: isComplete ? 'Rally Leaders final.' : `Rally scan partial — batch 1/${batchesTotal} complete.` }, 'RALLY_SCAN_START');
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
  // El peso por convicción se asigna sobre el conjunto final (necesita todos los scores).
  const top10 = assignSuggestedWeights(candidates.map((c, i) => ({ ...c, rank: i + 1, scanId })));

  if (isComplete) {
    await saveLastRallySnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), coveragePercent: 100, isRallyFinal: true, top10, universeHash, activeMarkets, universeCount: eligibleTickers.length, actualProviderCalls: totalCalls });
  }

  const newToken = isComplete ? null : encodeToken({ scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isComplete ? null : nextBatchIndex + 1, coveragePercent: newCoveragePercent, eligibleTickers, topCandidates: top10, actualProviderCalls: totalCalls, spyBarsLength: spyBars.length });
  const tokenSigning = isSnapshotSigningConfigured() ? 'SIGNED' : 'UNSIGNED_FALLBACK';
  const signingWarning = tokenSigning === 'UNSIGNED_FALLBACK' ? 'SCAN_SNAPSHOT_SIGNING_SECRET no configurada — tokens sin firma HMAC (fallback compat). Configúrala en Vercel para blindar la continuación.' : undefined;

  return sendJson(res, isComplete ? 200 : 206, { ok: isComplete, mode: 'RALLY_LEADERS_SCAN', status: isComplete ? 'RALLY_FINAL' : 'RALLY_SCANNING', scanId, scanStartedAtUtc, scanCompletedAtUtc: isComplete ? new Date().toISOString() : null, universeHash, activeMarkets, universeCount: eligibleTickers.length, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isComplete ? null : nextBatchIndex + 1, coveragePercent: newCoveragePercent, actualProviderCalls: totalCalls, isRallyFinal: isComplete, rallyToken: newToken, tokenSigning, signingWarning, top10, message: isComplete ? 'Rally Leaders final.' : `Rally scan partial — batch ${newBatchesCompleted}/${batchesTotal} complete.` }, 'RALLY_SCAN_CONTINUE');
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

// ═══ RALLY-TEST — laboratorio de pruebas (copia aislada de start/continue/last) ══
// Mandato 18-ago-2026: Rally Leaders NO se toca. Estos handlers son una COPIA de los
// de arriba; al crearse hacen exactamente lo mismo, pero puntúan con el motor de test
// (rallyScoreEngineTest.js), guardan en su propia clave KV y firman con su propia
// versión de token. Todo experimento futuro se hace aquí, no arriba.
function encodeTestToken(state) {
  const payloadB64 = Buffer.from(JSON.stringify({ v: RALLY_TEST_VERSION, ...state })).toString('base64url');
  return signStateToken(payloadB64);
}

function decodeTestToken(token) {
  const verified = verifyStateToken(token);
  if (!verified.ok) return { ok: false, error: verified.error };
  try {
    const decoded = JSON.parse(Buffer.from(verified.payloadB64, 'base64url').toString('utf8'));
    if (decoded.v !== RALLY_TEST_VERSION) return { ok: false, error: 'INVALID_TOKEN_VERSION' };
    return { ok: true, state: decoded };
  } catch { return { ok: false, error: 'TOKEN_DECODE_FAILED' }; }
}

function createTestScanId() { return `rallytest-${Date.now().toString(36)}`; }

async function handleTestStart(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'RALLY_TEST_START');
  if (!isRealApi()) return sendJson(res, 409, { ok: false, status: 'RALLY_DATA_UNAVAILABLE', error: 'REAL_API_CALLS_DISABLED', message: 'Set ENABLE_REAL_API_CALLS=true to run Rally-Test scan.' }, 'RALLY_TEST_START');

  const scanStartedAtUtc = new Date().toISOString();
  const scanId = createTestScanId();

  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok || universe.assets.length === 0) {
    return sendJson(res, 409, { ok: false, status: 'RALLY_DATA_UNAVAILABLE', error: universe.error ?? 'UNIVERSE_NOT_READY', message: 'Rally-Test scan requires active universe.' }, 'RALLY_TEST_START');
  }

  const activeMarkets = getActiveMarketsAt(scanStartedAtUtc);
  const eligibleAssets = (universe.assets ?? []).filter(a => a?.operabilityStatus === 'OPERABLE');
  if (eligibleAssets.length === 0) {
    return sendJson(res, 409, { ok: false, status: 'RALLY_DATA_UNAVAILABLE', error: 'NO_OPERABLE_ASSETS', activeMarkets, message: 'No operable assets in universe.' }, 'RALLY_TEST_START');
  }

  const spyBars = await fetchSpyBarsTest();
  const batchesTotal = Math.ceil(eligibleAssets.length / BATCH_SIZE);
  const universeHash = Buffer.from(eligibleAssets.map(a => a.providerSymbol).join(',')).toString('base64url').slice(0, 16);

  const { candidates, providerCalls } = await runRallyTestBatch({ eligibleAssets, batchIndex: 0, batchSize: BATCH_SIZE, existingCandidates: [], spyBars });
  const batchesCompleted = 1;
  const coveragePercent  = Math.round((batchesCompleted / batchesTotal) * 100);
  const isComplete = batchesCompleted >= batchesTotal;
  const top10 = assignSuggestedWeightsTest(candidates.map((c, i) => ({ ...c, rank: i + 1, scanId })));

  if (isComplete) {
    await saveLastRallyTestSnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), coveragePercent: 100, isRallyFinal: true, top10, universeHash, activeMarkets, universeCount: eligibleAssets.length, actualProviderCalls: providerCalls });
  }

  const rallyToken = encodeTestToken({ scanId, scanStartedAtUtc, universeHash, activeMarkets, universeCount: eligibleAssets.length, batchSize: BATCH_SIZE, batchesTotal, batchesCompleted, nextBatchIndex: isComplete ? null : 1, coveragePercent, eligibleTickers: eligibleAssets.map(a => a.providerSymbol), topCandidates: top10, actualProviderCalls: providerCalls, spyBarsLength: spyBars.length });
  const tokenSigning = isSnapshotSigningConfigured() ? 'SIGNED' : 'UNSIGNED_FALLBACK';

  return sendJson(res, isComplete ? 200 : 206, { ok: isComplete, mode: 'RALLY_TEST_SCAN', status: isComplete ? 'RALLY_FINAL' : 'RALLY_SCANNING', scanId, scanStartedAtUtc, scanCompletedAtUtc: isComplete ? new Date().toISOString() : null, universeHash, activeMarkets, universeCount: eligibleAssets.length, batchesTotal, batchesCompleted, nextBatchIndex: isComplete ? null : 1, coveragePercent, actualProviderCalls: providerCalls, isRallyFinal: isComplete, rallyToken: isComplete ? null : rallyToken, tokenSigning, top10, message: isComplete ? 'Rally-Test final.' : `Rally-Test scan partial — batch 1/${batchesTotal} complete.` }, 'RALLY_TEST_START');
}

async function handleTestContinue(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'RALLY_TEST_CONTINUE');
  if (!isRealApi()) return sendJson(res, 409, { ok: false, error: 'REAL_API_CALLS_DISABLED' }, 'RALLY_TEST_CONTINUE');

  const body = await readBody(req);
  if (!body.rallyToken) return sendJson(res, 400, { ok: false, error: 'RALLY_TOKEN_REQUIRED' }, 'RALLY_TEST_CONTINUE');

  const decoded = decodeTestToken(body.rallyToken);
  if (!decoded.ok) return sendJson(res, 400, { ok: false, error: decoded.error }, 'RALLY_TEST_CONTINUE');

  const state = decoded.state;
  const { scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize, batchesTotal, batchesCompleted, nextBatchIndex, eligibleTickers, topCandidates, actualProviderCalls } = state;

  if (nextBatchIndex === null || batchesCompleted >= batchesTotal) {
    return sendJson(res, 400, { ok: false, error: 'SCAN_ALREADY_COMPLETE' }, 'RALLY_TEST_CONTINUE');
  }

  const universe = await buildUniverseResponse({ includeFullAssets: true });
  const assetBySymbol = new Map((universe.assets ?? []).map(a => [a.providerSymbol, a]));
  const eligibleAssets = eligibleTickers.map(ticker => assetBySymbol.get(ticker) ?? ({
    providerSymbol: ticker, ticker: ticker.split('.')[0], name: ticker.split('.')[0],
    market: ticker.includes('.US') ? 'Nasdaq/NYSE' : 'Europe', region: ticker.includes('.US') ? 'USA' : 'Europe',
    exchange: ticker.split('.').slice(1).join('.'), currency: ticker.includes('.US') ? 'USD' : 'EUR',
  }));
  const spyBars = await fetchSpyBarsTest();
  const { candidates, providerCalls: newCalls } = await runRallyTestBatch({ eligibleAssets, batchIndex: nextBatchIndex, batchSize, existingCandidates: topCandidates ?? [], spyBars });

  const newBatchesCompleted = batchesCompleted + 1;
  const newCoveragePercent  = Math.round((newBatchesCompleted / batchesTotal) * 100);
  const isComplete  = newBatchesCompleted >= batchesTotal;
  const totalCalls  = (actualProviderCalls ?? 0) + newCalls;
  const top10 = assignSuggestedWeightsTest(candidates.map((c, i) => ({ ...c, rank: i + 1, scanId })));

  if (isComplete) {
    await saveLastRallyTestSnapshot({ ok: true, scanId, scanStartedAtUtc, scanCompletedAtUtc: new Date().toISOString(), coveragePercent: 100, isRallyFinal: true, top10, universeHash, activeMarkets, universeCount: eligibleTickers.length, actualProviderCalls: totalCalls });
  }

  const newToken = isComplete ? null : encodeTestToken({ scanId, scanStartedAtUtc, universeHash, activeMarkets, batchSize, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isComplete ? null : nextBatchIndex + 1, coveragePercent: newCoveragePercent, eligibleTickers, topCandidates: top10, actualProviderCalls: totalCalls, spyBarsLength: spyBars.length });
  const tokenSigning = isSnapshotSigningConfigured() ? 'SIGNED' : 'UNSIGNED_FALLBACK';

  return sendJson(res, isComplete ? 200 : 206, { ok: isComplete, mode: 'RALLY_TEST_SCAN', status: isComplete ? 'RALLY_FINAL' : 'RALLY_SCANNING', scanId, scanStartedAtUtc, scanCompletedAtUtc: isComplete ? new Date().toISOString() : null, universeHash, activeMarkets, universeCount: eligibleTickers.length, batchesTotal, batchesCompleted: newBatchesCompleted, nextBatchIndex: isComplete ? null : nextBatchIndex + 1, coveragePercent: newCoveragePercent, actualProviderCalls: totalCalls, isRallyFinal: isComplete, rallyToken: newToken, tokenSigning, top10, message: isComplete ? 'Rally-Test final.' : `Rally-Test scan partial — batch ${newBatchesCompleted}/${batchesTotal} complete.` }, 'RALLY_TEST_CONTINUE');
}

async function handleTestLast(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', app: APP_NAME, endpoint: 'RALLY_TEST_LAST' });

  const snapshot = await loadLastRallyTestSnapshot();
  if (!snapshot) {
    return res.status(404).json({ ok: false, app: APP_NAME, endpoint: 'RALLY_TEST_LAST', error: 'NO_STORED_RALLY_SNAPSHOT', status: 'RALLY_DATA_UNAVAILABLE', message: 'No completed Rally-Test scan found.', timestampUtc: new Date().toISOString() });
  }
  return res.status(200).json({ ...snapshot, app: APP_NAME, endpoint: 'RALLY_TEST_LAST', source: 'LAST_SESSION_CACHE', retrievedAtUtc: new Date().toISOString() });
}


// ─── news handler (SOLO Rally Leaders, SOLO display) ──────────────────────────
// Devuelve, para cada ticker del último scan, el motivo más probable de su
// movimiento — o null si no hay ninguno identificable. NO toca el análisis: no
// entra en score, pesos, stops ni selección. Si falla, el módulo sigue igual.
async function handleNews(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'RALLY_NEWS');

  const snapshot = await loadLastRallySnapshot();
  const top10 = snapshot?.top10 ?? [];
  if (!top10.length) return sendJson(res, 200, { ok: true, news: {}, message: 'No hay scan reciente.' }, 'RALLY_NEWS');

  const cacheKey = `${snapshot.scanId ?? 'sin-id'}`;
  const saltarCache = req.query?.fresh === '1';   // solo para verificar cambios del selector
  const cached = saltarCache ? null : await loadRallyNews(cacheKey);
  if (cached) return sendJson(res, 200, { ok: true, news: cached, source: 'CACHE' }, 'RALLY_NEWS');

  const assets = top10.map(a => ({
    providerSymbol: a.providerSymbol,
    ticker: a.ticker,
    nombre: a.name,
    symbolYahoo: toYahooSymbol(a.providerSymbol) || a.ticker,
  }));
  const news = await motivosDelMovimiento(assets, { refDate: snapshot.scanCompletedAtUtc ?? null });
  await saveRallyNews(cacheKey, news);
  return sendJson(res, 200, { ok: true, news, source: 'LIVE' }, 'RALLY_NEWS');
}

// ─── ibk-portfolio handler ────────────────────────────────────────────────────
// Canal LATERAL de persistencia del snapshot de cartera IBK (subido por fotos
// desde el navegador) para que un proceso externo (script del Mac) pueda leerlo.
// NO participa en ningún cálculo de módulos (Rally / Supreme / SP500): solo
// guarda y devuelve el último snapshot tal cual.
const IBK_MAX_POSITIONS = 50;
const IBK_MAX_BYTES = 50 * 1024;
const IBK_MAX_MONEY = 1e8;   // techo € por importe de cuenta (100M) — bloquea valores absurdos de envenenamiento
const IBK_MAX_QTY   = 1e7;   // techo por nº de acciones de una posición
const IBK_MAX_PRICE = 1e7;   // techo por precio unitario
const IBK_SYMBOL_RE   = /^[A-Za-z0-9.\-]{1,15}$/;
const IBK_CURRENCY_RE = /^[A-Za-z]{3}$/;

// Importe monetario opcional (null/undefined permitido) o número finito en [0, techo].
function isMoneyOrNull(v) {
  if (v === null || v === undefined) return true;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= IBK_MAX_MONEY;
}
// Número acotado opcional (null/undefined) o finito en [0, max].
function isBoundedNumOrNull(v, max) {
  if (v === null || v === undefined) return true;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
}

function validatePosition(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'POSITION_MUST_BE_OBJECT';
  if (typeof p.symbol !== 'string' || !IBK_SYMBOL_RE.test(p.symbol)) return 'INVALID_POSITION_SYMBOL';
  if (!isBoundedNumOrNull(p.quantity, IBK_MAX_QTY))  return 'INVALID_POSITION_QUANTITY';
  if (!isBoundedNumOrNull(p.lastPrice, IBK_MAX_PRICE)) return 'INVALID_POSITION_PRICE';
  if (p.currency !== undefined && p.currency !== null && (typeof p.currency !== 'string' || !IBK_CURRENCY_RE.test(p.currency))) return 'INVALID_POSITION_CURRENCY';
  return null;
}

function validateIbkSnapshot(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'BODY_MUST_BE_OBJECT';
  if (!Array.isArray(body.positions)) return 'POSITIONS_MUST_BE_ARRAY';
  if (body.positions.length > IBK_MAX_POSITIONS) return 'TOO_MANY_POSITIONS';
  if (!isMoneyOrNull(body.navEur))    return 'INVALID_NAV_EUR';
  if (!isMoneyOrNull(body.valMdoEur)) return 'INVALID_VAL_MDO_EUR';
  if (!isMoneyOrNull(body.cashEur))   return 'INVALID_CASH_EUR';
  // FX opcional: si viene, número finito en banda razonable (evita divisiones absurdas aguas abajo).
  if (body.fxEurPerUsd !== undefined && body.fxEurPerUsd !== null &&
      !(typeof body.fxEurPerUsd === 'number' && Number.isFinite(body.fxEurPerUsd) && body.fxEurPerUsd > 0.1 && body.fxEurPerUsd < 10)) {
    return 'INVALID_FX';
  }
  if (body.loadedAt !== undefined && body.loadedAt !== null && (typeof body.loadedAt !== 'string' || body.loadedAt.length > 40)) {
    return 'INVALID_LOADED_AT';
  }
  for (const p of body.positions) {
    const reason = validatePosition(p);
    if (reason) return reason;
  }
  try {
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') >= IBK_MAX_BYTES) return 'SNAPSHOT_TOO_LARGE';
  } catch { return 'SNAPSHOT_NOT_SERIALIZABLE'; }
  return null;
}

async function handleIbkPortfolio(req, res) {
  if (req.method === 'GET') {
    const portfolio = await loadLastIBKPortfolio();
    return sendJson(res, 200, { ok: true, portfolio: portfolio ?? null }, 'IBK_PORTFOLIO');
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const invalidReason = validateIbkSnapshot(body);
    if (invalidReason) return sendJson(res, 400, { ok: false, error: invalidReason }, 'IBK_PORTFOLIO');
    const saved = await saveLastIBKPortfolio(body);
    if (!saved) return sendJson(res, 503, { ok: false, error: 'KV_UNAVAILABLE' }, 'IBK_PORTFOLIO');
    return sendJson(res, 200, { ok: true }, 'IBK_PORTFOLIO');
  }
  return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 'IBK_PORTFOLIO');
}

// ─── main dispatcher ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Determine action from query param (set by vercel.json rewrite) or URL path
  const action = req.query?.action ?? (req.url?.split('/').pop()?.split('?')[0]);
  if (action === 'start')    return handleStart(req, res);
  if (action === 'continue') return handleContinue(req, res);
  if (action === 'last')     return handleLast(req, res);
  if (action === 'ibk-portfolio') return handleIbkPortfolio(req, res);
  if (action === 'test-start')    return handleTestStart(req, res);
  if (action === 'test-continue') return handleTestContinue(req, res);
  if (action === 'test-last')     return handleTestLast(req, res);
  if (action === 'news')          return handleNews(req, res);
  return res.status(400).json({ ok: false, error: 'UNKNOWN_ACTION', validActions: ['start', 'continue', 'last', 'ibk-portfolio', 'news', 'test-start', 'test-continue', 'test-last'] });
}
