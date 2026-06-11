/**
 * /api/market-breadth — MOTOR DE AMPLITUD DE MERCADO (endpoint).
 *
 * Una sola Serverless Function con 3 modos por ?action=:
 *   GET  /api/market-breadth                 → sirve el último veredicto cacheado (Redis). RÁPIDO.
 *   POST /api/market-breadth?action=start    → arranca el loop sobre el universo (batch 0).
 *   POST /api/market-breadth?action=continue → procesa el siguiente batch (token); al completar
 *                                              calcula el VEREDICTO y lo persiste en Redis.
 *
 * El loop pesado (recorrer N tickers, extraer historia, calcular amplitud) lo ORQUESTA un
 * disparador externo (GitHub Actions, 1×/día) encadenando start→continue…→final, igual que
 * el frontend orquesta el scan. El frontend del dashboard solo hace el GET (cacheado).
 *
 * Reutiliza POR IMPORT la extracción y cálculo existentes (sin tocarlos): buildUniverseResponse,
 * filterActiveOperableAssets, fetchEodhdHistoricalBars, fetchSpyBars, calculateTechnicals,
 * calculateEma. La lógica de amplitud vive en _lib/marketBreadthEngine.js.
 */

import { buildUniverseResponse } from "./universe.js";
import { getActiveMarketsAt } from "./_lib/scanSnapshot.js";
import { fetchEodhdHistoricalBars } from "./_lib/historicalDataProvider.js";
import { fetchSpyBars } from "./_lib/rallyBatchProcessor.js";
import { calculateTechnicals, calculateEma } from "./_lib/technicalEngine.js";
import {
  computeTickerBreadthSignals, emptyBreadthAggregator, foldTickerSignals,
  mergeAggregators, computeBreadthVerdict, BREADTH_WEIGHTS,
} from "./_lib/marketBreadthEngine.js";
import { kvGet, kvSet } from "./_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "MARKET_BREADTH";
const CACHE_KEY = "market_breadth_v1";       // último veredicto servido al dashboard
const HISTORY_KEY = "market_breadth_history_v1"; // histórico append-only (feedback-loop + serie McClellan)
const WEIGHTS_KEY = "market_breadth_weights_v1"; // pesos recalibrados (auditados); fallback a los congelados
const BATCH_SIZE = 50;
const HISTORY_CAP = 180;                       // ~9 meses de ciclos diarios (Upstash free ~1MB/valor)

function getEnv() { return globalThis.process?.env ?? {}; }
function isRealApi() { return getEnv().ENABLE_REAL_API_CALLS === "true"; }
function sendJson(res, status, payload) {
  res.status(status).json({ ...payload, app: APP_NAME, endpoint: ENDPOINT, timestampUtc: new Date().toISOString() });
}
function encodeToken(state) { return Buffer.from(JSON.stringify(state)).toString("base64url"); }
function decodeToken(token) {
  try { return { ok: true, state: JSON.parse(Buffer.from(token, "base64url").toString("utf8")) }; }
  catch { return { ok: false }; }
}
async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

// SPY bajo/sobre su EMA200 → régimen primario (override del veredicto).
async function resolveSpyContext() {
  try {
    const spyBars = await fetchSpyBars();
    if (!Array.isArray(spyBars) || spyBars.length < 200) return { spyBars: spyBars ?? [], spyBullish: null };
    const closes = spyBars.map((b) => b.close).filter((v) => Number.isFinite(v));
    const ema200 = calculateEma(closes, 200);
    const last = closes.at(-1);
    return { spyBars, spyBullish: (Number.isFinite(ema200) && Number.isFinite(last)) ? last > ema200 : null };
  } catch { return { spyBars: [], spyBullish: null }; }
}

// Procesa un batch de tickers → acumulador de amplitud (fetch en paralelo, fold secuencial).
async function processBatch(assets, spyBars) {
  const signalsList = await Promise.all(assets.map(async (asset) => {
    try {
      const hist = await fetchEodhdHistoricalBars(asset.providerSymbol, { fromDate: null });
      if (!hist.ok || !Array.isArray(hist.bars) || hist.bars.length < 60) return null;
      const tech = calculateTechnicals(hist.bars, spyBars);
      return computeTickerBreadthSignals(tech.ok ? tech : { technicals: null }, hist.bars);
    } catch { return null; }
  }));
  const agg = emptyBreadthAggregator();
  for (const s of signalsList) foldTickerSignals(agg, s);
  return agg;
}

async function loadWeights() {
  try {
    const w = await kvGet(WEIGHTS_KEY);
    if (w && typeof w === "object") return w;
  } catch { /* ignore */ }
  return BREADTH_WEIGHTS;
}

// Al completar el loop: calcula veredicto, persiste cache + histórico (serie A/D para McClellan).
async function finalizeAndPersist(agg, scanStartedAtUtc, activeMarkets, universeCount) {
  const { spyBars, spyBullish } = await resolveSpyContext();
  const history = (await kvGet(HISTORY_KEY).catch(() => null)) ?? [];
  const adNetSeries = Array.isArray(history) ? history.map((h) => h.adNet).filter((v) => Number.isFinite(v)) : [];
  const weights = await loadWeights();

  const verdict = computeBreadthVerdict(agg, { spyBullish, adNetSeries, weights });
  const spyClose = spyBars.length ? spyBars.at(-1)?.close ?? null : null;
  const cachedAtUtc = new Date().toISOString();

  const payload = {
    ok: true,
    verdict: verdict.verdict,
    score: verdict.score,
    color: verdict.color,
    label: verdict.label,
    indicators: verdict.indicators,
    subScores: verdict.subScores,
    alerts: verdict.alerts,
    sample: verdict.sample,
    spyBullish,
    activeMarkets,
    universeCount,
    scanStartedAtUtc,
    cachedAtUtc,
  };

  await kvSet(CACHE_KEY, payload, 26 * 3600).catch(() => {});

  // Histórico append-only (cap) para el feedback-loop y la serie McClellan.
  const record = {
    timestampUtc: cachedAtUtc, score: verdict.score, verdict: verdict.verdict,
    adNet: verdict.adNet, pctAboveMA50: verdict.indicators.pctAboveMA50,
    distributionPct: verdict.indicators.distributionPct, spyClose,
  };
  const nextHistory = [...(Array.isArray(history) ? history : []), record].slice(-HISTORY_CAP);
  await kvSet(HISTORY_KEY, nextHistory, 120 * 24 * 3600).catch(() => {});

  return payload;
}

// ─── start ──────────────────────────────────────────────────────────────────
async function handleStart(req, res) {
  if (!isRealApi()) return sendJson(res, 200, { ok: false, error: "REAL_API_CALLS_DISABLED" });

  const scanStartedAtUtc = new Date().toISOString();
  // Veredicto de amplitud de CIERRE: analiza TODO el universo operable (US+EU) con el
  // último cierre de cada ticker, así corre igual tras el cierre US (no filtra por hora,
  // a diferencia del scan intradía). activeMarkets queda como dato informativo.
  const activeMarkets = getActiveMarketsAt(scanStartedAtUtc);
  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok || !universe.assets?.length) {
    return sendJson(res, 409, { ok: false, error: universe.error ?? "UNIVERSE_NOT_READY" });
  }
  const eligible = (universe.assets ?? []).filter((a) => a?.operabilityStatus === "OPERABLE");
  if (eligible.length === 0) return sendJson(res, 409, { ok: false, error: "NO_OPERABLE_ASSETS", activeMarkets });

  const tickers = eligible.map((a) => a.providerSymbol);
  const batchesTotal = Math.ceil(tickers.length / BATCH_SIZE);
  const { spyBars } = await resolveSpyContext();

  const agg = await processBatch(eligible.slice(0, BATCH_SIZE), spyBars);
  const isFinal = batchesTotal <= 1;

  if (isFinal) {
    const payload = await finalizeAndPersist(agg, scanStartedAtUtc, activeMarkets, tickers.length);
    return sendJson(res, 200, { ...payload, mode: "BREADTH_SCAN", status: "FINAL", isFinal: true });
  }

  const token = encodeToken({ scanStartedAtUtc, activeMarkets, tickers, batchesTotal, batchesCompleted: 1, nextBatchIndex: 1, agg });
  return sendJson(res, 206, {
    ok: false, mode: "BREADTH_SCAN", status: "SCANNING", isFinal: false,
    batchesTotal, batchesCompleted: 1, coveragePercent: Math.round(100 / batchesTotal),
    universeCount: tickers.length, breadthToken: token, activeMarkets,
    message: `Breadth scan batch 1/${batchesTotal} complete.`,
  });
}

// ─── continue ───────────────────────────────────────────────────────────────
async function handleContinue(req, res) {
  if (!isRealApi()) return sendJson(res, 200, { ok: false, error: "REAL_API_CALLS_DISABLED" });
  const body = await readBody(req);
  if (!body.breadthToken) return sendJson(res, 400, { ok: false, error: "BREADTH_TOKEN_REQUIRED" });

  const decoded = decodeToken(body.breadthToken);
  if (!decoded.ok) return sendJson(res, 400, { ok: false, error: "TOKEN_DECODE_FAILED" });
  const st = decoded.state;

  // La lista de tickers va fija en el token (universo de cierre estable), así que el
  // loop no se "rompe" si cruza una apertura/cierre — no hay check de sesión que abortar.
  const start = st.nextBatchIndex * BATCH_SIZE;
  const batchTickers = st.tickers.slice(start, start + BATCH_SIZE);
  const eligible = batchTickers.map((symbol) => ({ providerSymbol: symbol }));
  const { spyBars } = await resolveSpyContext();

  const batchAgg = await processBatch(eligible, spyBars);
  const merged = mergeAggregators(st.agg, batchAgg);
  const newCompleted = st.batchesCompleted + 1;
  const isFinal = newCompleted >= st.batchesTotal;

  if (isFinal) {
    const payload = await finalizeAndPersist(merged, st.scanStartedAtUtc, st.activeMarkets, st.tickers.length);
    return sendJson(res, 200, { ...payload, mode: "BREADTH_SCAN", status: "FINAL", isFinal: true });
  }

  const token = encodeToken({ ...st, batchesCompleted: newCompleted, nextBatchIndex: st.nextBatchIndex + 1, agg: merged });
  return sendJson(res, 206, {
    ok: false, mode: "BREADTH_SCAN", status: "SCANNING", isFinal: false,
    batchesTotal: st.batchesTotal, batchesCompleted: newCompleted,
    coveragePercent: Math.round((newCompleted / st.batchesTotal) * 100),
    universeCount: st.tickers.length, breadthToken: token, activeMarkets: st.activeMarkets,
    message: `Breadth scan batch ${newCompleted}/${st.batchesTotal} complete.`,
  });
}

// ─── get (default) ──────────────────────────────────────────────────────────
async function handleGet(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cached = await kvGet(CACHE_KEY).catch(() => null);
  if (!cached) {
    return sendJson(res, 200, {
      ok: true, verdict: "UNKNOWN", score: null, color: "#64748b",
      label: "Sin datos — esperando primer análisis", reason: "NO_BREADTH_YET",
    });
  }
  return sendJson(res, 200, { ...cached, fromCache: true });
}

export default async function handler(req, res) {
  const action = req.query?.action ?? req.url?.split("action=")[1]?.split("&")[0] ?? "";
  if (action === "start") return handleStart(req, res);
  if (action === "continue") return handleContinue(req, res);
  return handleGet(req, res);
}
