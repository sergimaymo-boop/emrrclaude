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
  mergeAggregators, computeBreadthVerdict, computeBreadthFeedback, BREADTH_WEIGHTS,
  computeTickerRankFeatures, scoreTickerRank, RANK_CALIBRATION,
} from "./_lib/marketBreadthEngine.js";
import { computeFable5Features, scoreFable5, mergeFable5, FABLE5_CALIBRATION } from "./_lib/fable5Engine.js";
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

// Región de un ticker según el sufijo estilo EODHD (.US/.DE/.PA/.MI/.SW/.LSE…).
function regionOfSymbol(providerSymbol) {
  if (typeof providerSymbol !== "string") return "USA";
  if (/\.US$/i.test(providerSymbol) || !providerSymbol.includes(".")) return "USA";
  return "Europe";
}

// Recorta la última barra si es de HOY (UTC) Y la sesión de esa región sigue ABIERTA.
// Así el veredicto es SIEMPRE close-based y estable: corra de noche (cron, nada abierto →
// no recorta) o intradía con ambos mercados abiertos (no arrastra la vela diaria en formación,
// que distorsionaría momentum/máx-mín/distribución/RVOL). Resuelve la petición "ambos abiertos".
function trimFormingBar(bars, providerSymbol, openMarkets, todayUtc) {
  if (!Array.isArray(bars) || bars.length === 0 || !openMarkets?.length) return bars;
  const last = bars[bars.length - 1];
  if (last?.date === todayUtc && openMarkets.includes(regionOfSymbol(providerSymbol))) {
    return bars.slice(0, -1);
  }
  return bars;
}

// SPY bajo/sobre su EMA200 → régimen primario (override del veredicto). El SPY (región USA)
// también se recorta si EE.UU. está abierto, para que RS y el override usen el último cierre completo.
const SPY_REGIME_KEY = "spy_bullish_last";
async function resolveSpyContext(openMarkets = [], todayUtc = "") {
  try {
    let spyBars = await fetchSpyBars();
    spyBars = trimFormingBar(spyBars, "SPY.US", openMarkets, todayUtc);
    if (Array.isArray(spyBars) && spyBars.length >= 200) {
      const closes = spyBars.map((b) => b.close).filter((v) => Number.isFinite(v));
      const ema200 = calculateEma(closes, 200);
      const last = closes.at(-1);
      const spyBullish = (Number.isFinite(ema200) && Number.isFinite(last)) ? last > ema200 : null;
      if (spyBullish !== null) {
        // Persistir el régimen para reusarlo si una próxima ejecución no logra el histórico.
        await kvSet(SPY_REGIME_KEY, { spyBullish, atUtc: new Date().toISOString() }, 72 * 3600).catch(() => {});
        return { spyBars, spyBullish, spyRegimeStale: false };
      }
    }
    // Histórico SPY no disponible (Yahoo rate-limita la IP de Vercel durante el scan) → reusar el
    // último régimen conocido (alcista/bajista de ayer sigue siendo válido para la anotación de tendencia).
    const cached = await kvGet(SPY_REGIME_KEY).catch(() => null);
    if (cached && typeof cached.spyBullish === "boolean") {
      return { spyBars: spyBars ?? [], spyBullish: cached.spyBullish, spyRegimeStale: true };
    }
    return { spyBars: spyBars ?? [], spyBullish: null, spyRegimeStale: false };
  } catch { return { spyBars: [], spyBullish: null, spyRegimeStale: false }; }
}

// Mantiene los 15 mejores candidatos del ranking al fusionar batches.
function mergeTopRank(a, b) {
  return [...(a ?? []), ...(b ?? [])].sort((x, y) => y.score - x.score).slice(0, 15);
}

// Procesa un batch → {agg amplitud, candidates ranking}. Fetch en paralelo, fold secuencial.
// Reutiliza las MISMAS barras para amplitud y para el factor model per-ticker (cero fetch extra).
async function processBatch(assets, spyBars, opts = {}) {
  const { openMarkets = [], todayUtc = "" } = opts;
  const results = await Promise.all(assets.map(async (asset) => {
    try {
      const hist = await fetchEodhdHistoricalBars(asset.providerSymbol, { fromDate: null });
      if (!hist.ok || !Array.isArray(hist.bars) || hist.bars.length < 60) return null;
      const bars = trimFormingBar(hist.bars, asset.providerSymbol, openMarkets, todayUtc);
      if (bars.length < 60) return null;
      const tech = calculateTechnicals(bars, spyBars);
      const signals = computeTickerBreadthSignals(tech.ok ? tech : { technicals: null }, bars);
      const ft = computeTickerRankFeatures(bars);
      const rank = ft ? scoreTickerRank(ft) : null;
      const cand = (ft && rank) ? { sym: asset.providerSymbol, score: rank.score, prob: rank.prob, ft } : null;
      // FABLE 5 — módulo independiente (tendencia limpia); reaprovecha las MISMAS barras.
      const fft = computeFable5Features(bars);
      const fab = fft ? scoreFable5(fft) : null;
      const fabCand = (fft && fab) ? { sym: asset.providerSymbol, score: fab.score, ft: fft } : null;
      return { signals, cand, fabCand };
    } catch { return null; }
  }));
  const agg = emptyBreadthAggregator();
  const candidates = [];
  const fable5 = [];
  for (const r of results) {
    foldTickerSignals(agg, r?.signals ?? null);
    if (r?.cand) candidates.push(r.cand);
    if (r?.fabCand) fable5.push(r.fabCand);
  }
  candidates.sort((a, b) => b.score - a.score);
  fable5.sort((a, b) => b.score - a.score);
  return { agg, candidates: candidates.slice(0, 15), fable5: fable5.slice(0, 15) };
}

async function loadWeights() {
  try {
    const w = await kvGet(WEIGHTS_KEY);
    if (w && typeof w === "object") return w;
  } catch { /* ignore */ }
  return BREADTH_WEIGHTS;
}

// Enriquece el top-10 del ranking con nombres (universo cacheado) y formatea para la watchlist.
async function enrichTopRank(topRank) {
  const top = (topRank ?? []).slice(0, 10);
  if (top.length === 0) return [];
  let nameMap = new Map();
  try {
    const uni = await buildUniverseResponse({ includeFullAssets: true });
    nameMap = new Map((uni.assets ?? []).map((a) => [a.providerSymbol, a.name ?? a.companyName ?? a.Name ?? a.providerSymbol]));
  } catch { /* fallback al símbolo */ }
  const r2 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const r3 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const pc = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 10 : null); // fracción → %
  return top.map((c) => {
    const price = c.ft.close;
    const prev = c.ft.prevClose;
    const pctChange = (Number.isFinite(price) && Number.isFinite(prev) && prev > 0) ? r2((price / prev - 1) * 100) : null;
    const atrPctVal = Number.isFinite(c.ft.atrPct) ? c.ft.atrPct * 100 : null; // ATR diario en %
    // Trailing stops desde ATR: mínimo 0.65× · medio 1× · ampliado 1.45× (% de distancia + nivel de precio).
    const trail = (mult) => (atrPctVal && Number.isFinite(price))
      ? { pct: r2(atrPctVal * mult), price: r2(price * (1 - (atrPctVal * mult) / 100)) }
      : null;
    return {
      symbol: c.sym,
      name: nameMap.get(c.sym) ?? c.sym,
      probUp: Math.round((c.prob ?? 0) * 100),
      score: c.score,
      price: r2(price),
      pctChange,
      trailing: { min: trail(0.65), med: trail(1.0), wide: trail(1.45) },
      features: {
        ret20: pc(c.ft.ret20), ret60: pc(c.ft.ret60), rsi14: r3(c.ft.rsi14),
        distMA50: pc(c.ft.distMA50), distMA200: pc(c.ft.distMA200),
        dist52H: pc(c.ft.dist52H), dist52L: pc(c.ft.dist52L),
        atrPct: pc(c.ft.atrPct), rvol: r3(c.ft.rvol),
        aboveMA200: c.ft.aboveMA200 === 1, lastClose: r2(price),
      },
    };
  });
}

// FABLE 5 — enriquece el top-10 (tendencia limpia) y lo persiste en su PROPIA clave.
const FABLE5_KEY = "fable5_v1";
async function persistFable5(topFab, scanStartedAtUtc, activeMarkets, universeCount) {
  const top = (topFab ?? []).slice(0, 10);
  if (top.length === 0) return;
  let nameMap = new Map();
  try {
    const uni = await buildUniverseResponse({ includeFullAssets: true });
    nameMap = new Map((uni.assets ?? []).map((a) => [a.providerSymbol, a.name ?? a.providerSymbol]));
  } catch { /* fallback al símbolo */ }
  const r2n = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const items = top.map((c, i) => {
    const price = c.ft.close;
    const prev = c.ft.prevClose;
    const atrPctVal = Number.isFinite(c.ft.atrPct) ? c.ft.atrPct * 100 : null;
    const m = FABLE5_CALIBRATION.trailingMults;
    const trail = (mult) => (atrPctVal && Number.isFinite(price))
      ? { pct: r2n(atrPctVal * mult), price: r2n(price * (1 - (atrPctVal * mult) / 100)) }
      : null;
    return {
      rank: i + 1,
      symbol: c.sym,
      name: nameMap.get(c.sym) ?? c.sym,
      price: r2n(price),
      pctDay: (Number.isFinite(price) && Number.isFinite(prev) && prev > 0) ? r2n((price / prev - 1) * 100) : null,
      score: c.score,
      r2: r2n(c.ft.r2),
      slope20: r2n(c.ft.slope20 * 100),
      dist52H: r2n(c.ft.dist52H * 100),
      trailing: { ajustado: trail(m.ajustado), normal: trail(m.normal), ampliado: trail(m.ampliado) },
    };
  });
  const payload = {
    ok: true, items, universeCount, activeMarkets,
    oosWin: FABLE5_CALIBRATION.oos.win,
    horizon: FABLE5_CALIBRATION.horizonSessions,
    scanStartedAtUtc, cachedAtUtc: new Date().toISOString(),
  };
  await kvSet(FABLE5_KEY, payload, 26 * 3600).catch(() => {});
}

// Al completar el loop: calcula veredicto, persiste cache + histórico (serie A/D para McClellan).
async function finalizeAndPersist(agg, scanStartedAtUtc, activeMarkets, universeCount, topRank = [], topFab = []) {
  await persistFable5(topFab, scanStartedAtUtc, activeMarkets, universeCount).catch(() => {});
  const todayUtc = (scanStartedAtUtc ?? "").slice(0, 10);
  // intraday = algún mercado abierto durante el run (manual/dispatch). El cron nocturno corre
  // con todo cerrado → intraday=false. Los runs intradía SIRVEN el cache pero NO contaminan
  // la serie histórica (que debe ser homogénea, solo cierres) para McClellan + feedback.
  const intraday = Array.isArray(activeMarkets) && activeMarkets.length > 0;
  const { spyBars, spyBullish } = await resolveSpyContext(activeMarkets ?? [], todayUtc);
  const history = (await kvGet(HISTORY_KEY).catch(() => null)) ?? [];
  const adNetSeries = Array.isArray(history) ? history.map((h) => h.adNet).filter((v) => Number.isFinite(v)) : [];
  const weights = await loadWeights();

  const verdict = computeBreadthVerdict(agg, { spyBullish, adNetSeries, weights });
  const spyClose = spyBars.length ? spyBars.at(-1)?.close ?? null : null;
  const cachedAtUtc = new Date().toISOString();
  const topTickers = await enrichTopRank(topRank);

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
    horizonDays: verdict.horizonDays,
    topTickers,
    rankHorizonDays: RANK_CALIBRATION.horizonDays,
    rankBaseUp: Math.round(RANK_CALIBRATION.baseUp * 100),
    spyBullish,
    activeMarkets,
    universeCount,
    intraday,
    scanStartedAtUtc,
    cachedAtUtc,
  };

  await kvSet(CACHE_KEY, payload, 26 * 3600).catch(() => {});

  // Histórico append-only (cap), SOLO en runs de cierre → serie homogénea para feedback + McClellan.
  if (!intraday) {
    const record = {
      timestampUtc: cachedAtUtc, score: verdict.score, verdict: verdict.verdict,
      adNet: verdict.adNet, pctAboveMA50: verdict.indicators.pctAboveMA50,
      distributionPct: verdict.indicators.distributionPct, spyClose,
      universeCount, activeMarkets,
    };
    const nextHistory = [...(Array.isArray(history) ? history : []), record].slice(-HISTORY_CAP);
    await kvSet(HISTORY_KEY, nextHistory, 120 * 24 * 3600).catch(() => {});
  }

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
  const todayUtc = scanStartedAtUtc.slice(0, 10);
  const { spyBars } = await resolveSpyContext(activeMarkets, todayUtc);

  const { agg, candidates, fable5 } = await processBatch(eligible.slice(0, BATCH_SIZE), spyBars, { openMarkets: activeMarkets, todayUtc });
  const isFinal = batchesTotal <= 1;

  if (isFinal) {
    const payload = await finalizeAndPersist(agg, scanStartedAtUtc, activeMarkets, tickers.length, candidates, fable5);
    return sendJson(res, 200, { ...payload, mode: "BREADTH_SCAN", status: "FINAL", isFinal: true });
  }

  const token = encodeToken({ scanStartedAtUtc, activeMarkets, tickers, batchesTotal, batchesCompleted: 1, nextBatchIndex: 1, agg, topRank: candidates, topFab: fable5 });
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
  const todayUtc = (st.scanStartedAtUtc ?? "").slice(0, 10);
  const { spyBars } = await resolveSpyContext(st.activeMarkets ?? [], todayUtc);

  const { agg: batchAgg, candidates: batchCands, fable5: batchFab } = await processBatch(eligible, spyBars, { openMarkets: st.activeMarkets ?? [], todayUtc });
  const merged = mergeAggregators(st.agg, batchAgg);
  const mergedRank = mergeTopRank(st.topRank ?? [], batchCands);
  const mergedFab = mergeFable5(st.topFab ?? [], batchFab);
  const newCompleted = st.batchesCompleted + 1;
  const isFinal = newCompleted >= st.batchesTotal;

  if (isFinal) {
    const payload = await finalizeAndPersist(merged, st.scanStartedAtUtc, st.activeMarkets, st.tickers.length, mergedRank, mergedFab);
    return sendJson(res, 200, { ...payload, mode: "BREADTH_SCAN", status: "FINAL", isFinal: true });
  }

  const token = encodeToken({ ...st, batchesCompleted: newCompleted, nextBatchIndex: st.nextBatchIndex + 1, agg: merged, topRank: mergedRank, topFab: mergedFab });
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

// ─── feedback (hit-rate auditado, no auto-aplica pesos) ──────────────────────
async function handleFeedback(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const history = await kvGet(HISTORY_KEY).catch(() => null);
  const feedback = computeBreadthFeedback(Array.isArray(history) ? history : []);
  return sendJson(res, 200, { ok: true, feedback, historySize: Array.isArray(history) ? history.length : 0 });
}

export default async function handler(req, res) {
  const action = req.query?.action ?? req.url?.split("action=")[1]?.split("&")[0] ?? "";
  if (action === "start") return handleStart(req, res);
  if (action === "continue") return handleContinue(req, res);
  if (action === "feedback") return handleFeedback(req, res);
  return handleGet(req, res);
}
