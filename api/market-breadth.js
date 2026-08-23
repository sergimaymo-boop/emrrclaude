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

import { buildUniverseResponse } from "./_lib/universeResponse.js";
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
import { computeFable01Features, scoreFable01, mergeFable01, assignBand, allocateFable01, FABLE01_CALIBRATION } from "./_lib/fable01Engine.js";
import { computeOptimal2026Features, scoreOptimal2026, mergeOptimal2026, detectOptimal2026Regime, allocateOptimal2026, assignOptimal2026Stops, applySupremeVolTarget, OPTIMAL_SUPREME_CALIBRATION } from "./_lib/optimal2026Engine.js";
import { kvGet, kvSet } from "./_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "MARKET_BREADTH";
const CACHE_KEY = "market_breadth_v1";       // último veredicto servido al dashboard
const HISTORY_KEY = "market_breadth_history_v1"; // histórico append-only (feedback-loop + serie McClellan)
const WEIGHTS_KEY = "market_breadth_weights_v1"; // pesos recalibrados (auditados); fallback a los congelados
const BATCH_SIZE = 50;
const HISTORY_CAP = 180;                       // ~9 meses de ciclos diarios (Upstash free ~1MB/valor)
// TTL de los snapshots (breadth, Optimal Supreme, FABLE5, FABLE01). Antes 26h: el cron
// GH corre L-V 21:30 UTC, así que el viernes 21:30 + 26h = sábado 23:30 → los 4 módulos
// quedaban SIN DATOS todo el fin de semana Y el lunes de mercado hasta el run de las
// 21:30 (verificado en producción el domingo 23-ago: breadth UNKNOWN, optimal2026 404,
// fable5/01 vacíos).
// 5ª auditoría — 80h cubría el finde normal (72h) con solo 8h de holgura, pero se quedaba
// corto en los huecos REALES de calendario y de fiabilidad:
//   · Viernes Santo (jue 21:30 → lun 21:30) = 96h  → apagón
//   · Navidad / Año Nuevo (mié → lun)        = 120h → apagón
//   · Finde normal + UN run fallido          = 96h  → apagón
// Ese último no es hipotético: en este repo hay workflows que fallan de forma recurrente.
// 7 días (= convención del proyecto para snapshots de scan, §14 CLAUDE.md) absorbe todos.
// No engaña: el panel imprime SIEMPRE la hora del dato (`cachedAtUtc`), así que un dato
// viejo se ve viejo — y un panel con el último cierre conocido es más útil que uno vacío.
const SNAPSHOT_TTL_S = 7 * 24 * 3600;

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
        await kvSet(SPY_REGIME_KEY, { spyBullish, atUtc: new Date().toISOString() }, SNAPSHOT_TTL_S).catch(() => {});  // 4ª auditoría: 72h dejaba 0h de holgura el lunes
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
      // FABLE01 — módulo independiente (salud de tendencia + allocation); MISMAS barras + spyBars (RS).
      const f01ft = computeFable01Features(bars, spyBars);
      const f01 = f01ft ? scoreFable01(f01ft) : null;
      const f01Cand = (f01ft && f01) ? { sym: asset.providerSymbol, score: f01.score, ft: f01ft } : null;
      // OPTIMAL2026 — módulo independiente (dual momentum risk-parity); MISMAS barras + spyBars.
      const o26ft = computeOptimal2026Features(bars, spyBars);
      const o26 = o26ft ? scoreOptimal2026(o26ft) : null;
      const o26Cand = (o26ft && o26) ? { sym: asset.providerSymbol, score: o26.score, raw: o26.raw, ft: o26ft } : null;
      return { signals, cand, fabCand, f01Cand, o26Cand };
    } catch { return null; }
  }));
  const agg = emptyBreadthAggregator();
  const candidates = [];
  const fable5 = [];
  const fable01 = [];
  const optimal2026 = [];
  for (const r of results) {
    foldTickerSignals(agg, r?.signals ?? null);
    if (r?.cand) candidates.push(r.cand);
    if (r?.fabCand) fable5.push(r.fabCand);
    if (r?.f01Cand) fable01.push(r.f01Cand);
    if (r?.o26Cand) optimal2026.push(r.o26Cand);
  }
  candidates.sort((a, b) => b.score - a.score);
  fable5.sort((a, b) => b.score - a.score);
  fable01.sort((a, b) => b.score - a.score);
  // Optimal2026 ordena por `raw` (score crudo del backtest) para preservar el ranking exacto.
  optimal2026.sort((a, b) => (b.raw ?? b.score) - (a.raw ?? a.score));
  return { agg, candidates: candidates.slice(0, 15), fable5: fable5.slice(0, 15), fable01: fable01.slice(0, 15), optimal2026: optimal2026.slice(0, 10) };
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
  // Defensivo: descarta candidatos sin features válidas (p.ej. de un token manipulado o de un
  // cambio futuro en la forma del candidato), para que un dato corrupto de un ticker NUNCA
  // bloquee el persistir del veredicto completo (auditoría de estabilidad).
  const top = (topRank ?? []).filter((c) => c && c.ft && Number.isFinite(c.ft.close)).slice(0, 10);
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
  await kvSet(FABLE5_KEY, payload, SNAPSHOT_TTL_S).catch(() => {});
}

// FABLE01 — enriquece el top-10 (salud de tendencia + asignación de capital blindada) en su PROPIA clave.
const FABLE01_KEY = "fable01_v1";
async function persistFable01(topF01, scanStartedAtUtc, activeMarkets, universeCount, spyBullish, analizados = Infinity) {
  const top = (topF01 ?? []).slice(0, 10);
  if (top.length === 0) return;   // ya conserva el snapshot bueno (no sobrescribe con vacío)
  void analizados;                 // firma homogénea con persistOptimal2026; FABLE01 no lo necesita
  let nameMap = new Map();
  try {
    const uni = await buildUniverseResponse({ includeFullAssets: true });
    nameMap = new Map((uni.assets ?? []).map((a) => [a.providerSymbol, a.name ?? a.providerSymbol]));
  } catch { /* fallback al símbolo */ }
  const r2n = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  // Régimen: risk-on si SPY>EMA200 (o desconocido → asumir risk-on, como hace breadth).
  const regimeRiskOn = spyBullish !== false;
  const { weights, deploymentPct } = allocateFable01(top, { regimeRiskOn });
  const m = FABLE01_CALIBRATION.trailingMults;
  // allocationPct redondeado a entero que suma exactamente 100 (reparto del residuo al mayor).
  const raw = weights.map((w) => (w ?? 0) * 100);
  const alloc = raw.map((v) => Math.floor(v));
  let resid = 100 - alloc.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && resid > 0; k++) { if (raw[order[k][1]] > 0) { alloc[order[k][1]]++; resid--; } }

  const items = top.map((c, i) => {
    const price = c.ft.close;
    const prev = c.ft.prevClose;
    const atrPctVal = Number.isFinite(c.ft.atrPct) ? c.ft.atrPct * 100 : null; // ATR diario %
    const band = assignBand(c.ft);
    const bandMult = m[band];
    const stopPct = atrPctVal ? r2n(atrPctVal * bandMult) : null;
    const stopPrice = (atrPctVal && Number.isFinite(price)) ? r2n(price * (1 - (atrPctVal * bandMult) / 100)) : null;
    const allLevels = atrPctVal ? {
      TR: r2n(atrPctVal * m.TR), TN: r2n(atrPctVal * m.TN), TA: r2n(atrPctVal * m.TA),
    } : null;
    return {
      rank: i + 1,
      symbol: c.sym,
      name: nameMap.get(c.sym) ?? c.sym,
      score: Math.round(c.score),
      allocationPct: alloc[i] ?? 0,
      price: r2n(price),
      pctDay: (Number.isFinite(price) && Number.isFinite(prev) && prev > 0) ? r2n((price / prev - 1) * 100) : null,
      trailingBand: band,
      trailingStopPct: stopPct,
      trailingStopPrice: stopPrice,
      trailingLevelsPct: allLevels,
      rs60: r2n(c.ft.rs60 * 100),
      slope20: r2n(c.ft.slope20 * 100),
    };
  });
  const payload = {
    ok: true, items, universeCount, activeMarkets,
    badge: FABLE01_CALIBRATION.badge,
    oos: FABLE01_CALIBRATION.oos,
    deploymentPct, regimeRiskOn,
    scanStartedAtUtc, cachedAtUtc: new Date().toISOString(),
  };
  await kvSet(FABLE01_KEY, payload, SNAPSHOT_TTL_S).catch(() => {});
}

// OPTIMAL2026 — persiste el top-3 (dual momentum risk-parity) en su PROPIA clave.
const OPTIMAL2026_KEY = "optimal2026_v1";
async function persistOptimal2026(topO26, scanStartedAtUtc, activeMarkets, universeCount, spyBars, spyBullish = null, analizados = Infinity) {
  // SUELO DE MUESTRA (5ª auditoría): un apagón de proveedores (<50 tickers analizados) NUNCA
  // debe sobrescribir el snapshot bueno de Optimal Supreme — ni con "CAJA" (0 candidatos) ni,
  // sobre todo, con una allocation calculada sobre los pocos supervivientes del apagón (que no
  // son muestra aleatoria). En la 4ª auditoría esta guarda quedó DENTRO de la rama top.length===0,
  // así que un apagón que devolvía ≥1 candidato la esquivaba y pisaba el snapshot bueno por la
  // ruta normal (kvSet final). Subida a la entrada: protege TODAS las rutas de escritura.
  if (analizados < 50) return;
  // Régimen: SPY vs EMA200 con las barras de este run. AUDIT FIX: si SPY no llegó
  // (rate-limit puntual) usar el régimen CACHEADO (spyBullish) en vez de caer a
  // RISK_OFF — evitaba incoherencia con FABLE01/breadth en el MISMO run.
  let regime = detectOptimal2026Regime(spyBars ?? []);
  if ((spyBars?.length ?? 0) < 200 && typeof spyBullish === "boolean") {
    regime = spyBullish
      ? { regime: "RISK_ON", deployPct: 100, regimeReason: "SPY sobre EMA200 — alcista (régimen cacheado: SPY no disponible este run)" }
      : { regime: "RISK_OFF", deployPct: 30, regimeReason: "SPY bajo EMA200 — defensivo (régimen cacheado: SPY no disponible este run)" };
  }

  // Top 4 para mostrar: 2 invertidos (con allocation) + 2 "en banca" a 0% (candidatos de rotación).
  const top = (topO26 ?? []).slice(0, 4);
  if (top.length === 0) {
    // Aquí analizados>=50 garantizado por la guarda de entrada: 0 candidatos con muestra
    // suficiente = señal REAL de caja (no un apagón). Se persiste "estrategia en CAJA".
    // AUDIT FIX: persistir snapshot VACÍO explícito en vez de dejar el anterior en KV.
    // Sin candidatos elegibles = mercado sin momentum 9m positivo → la estrategia está
    // en caja y el dashboard debe reflejarlo, no mostrar la allocation alcista antigua.
    await kvSet(OPTIMAL2026_KEY, {
      ok: true, items: [], universeCount, activeMarkets,
      regime: regime.regime, deployPct: 0,
      regimeReason: `${regime.regimeReason} · Sin candidatos elegibles — estrategia en CAJA`,
      badge: OPTIMAL_SUPREME_CALIBRATION.badge,
      oos: OPTIMAL_SUPREME_CALIBRATION.oos,
      scanStartedAtUtc, cachedAtUtc: new Date().toISOString(),
    }, SNAPSHOT_TTL_S).catch(() => {});
    return;
  }
  let nameMap = new Map();
  try {
    const uni = await buildUniverseResponse({ includeFullAssets: true });
    nameMap = new Map((uni.assets ?? []).map((a) => [a.providerSymbol, a.name ?? a.companyName ?? a.providerSymbol]));
  } catch { /* fallback al símbolo */ }
  const r2n = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  let allocated = allocateOptimal2026(top, regime);
  // OPTIMAL SUPREME — vol-targeting 30%/10d sobre el top-2 invertido (ganador de los sweeps: 118 variantes)
  // AUDIT FIX: escalar con factorRaw (sin redondear) — el factor redondeado a 2 decimales
  // hacía que la suma de allocations divergiera del deployPct publicado (hasta ~0.5pp).
  const vt = applySupremeVolTarget(regime, allocated);
  if (vt.factorRaw < 1) {
    allocated = allocated.map((c) => ({
      ...c,
      allocationPct: c.allocationPct > 0 ? Math.round(c.allocationPct * vt.factorRaw * 10) / 10 : 0,
    }));
  }
  // deployPct publicado = suma REAL de las allocations escaladas (coherencia exacta con lo mostrado)
  const deployPctPublished = Math.round(allocated.reduce((s, c) => s + (c.allocationPct > 0 ? c.allocationPct : 0), 0) * 10) / 10;
  const items = allocated.map((c, i) => {
    const price = c.ft?.close;
    const prev = c.ft?.prevClose;
    const stops = assignOptimal2026Stops(c);
    return {
      rank: i + 1,
      symbol: c.sym,
      name: nameMap.get(c.sym) ?? c.sym.split(".")[0],
      score: r2n(c.score),
      allocationPct: c.allocationPct ?? 0,
      price: r2n(price),
      pctDay: (Number.isFinite(price) && Number.isFinite(prev) && prev > 0) ? r2n((price / prev - 1) * 100) : null,
      riskAdjMom: r2n(c.ft?.riskAdjMom),
      retLong: r2n(c.ft?.retLong != null ? c.ft.retLong * 100 : null),
      rsLong: r2n(c.ft?.rsLong != null ? c.ft.rsLong * 100 : null),
      vol63: r2n(c.ft?.vol63 != null ? c.ft.vol63 * 100 : null),
      r2: r2n(c.ft?.r2),
      align: c.ft?.align ?? null,
      stopPct: stops.stopPct,
      stopPrice: stops.stopPrice,
      stopBand: stops.band,
    };
  });
  const payload = {
    ok: true, items, universeCount, activeMarkets,
    regime: regime.regime,
    deployPct: deployPctPublished,
    regimeReason: vt.factorRaw < 1 ? `${regime.regimeReason} · ${vt.reason}` : regime.regimeReason,
    volTargetFactor: vt.volTargetFactor,
    realizedVol10d: vt.realizedVol,
    badge: OPTIMAL_SUPREME_CALIBRATION.badge,
    oos: OPTIMAL_SUPREME_CALIBRATION.oos,
    scanStartedAtUtc, cachedAtUtc: new Date().toISOString(),
  };
  await kvSet(OPTIMAL2026_KEY, payload, SNAPSHOT_TTL_S).catch(() => {});
}

// Al completar el loop: calcula veredicto, persiste cache + histórico (serie A/D para McClellan).
async function finalizeAndPersist(agg, scanStartedAtUtc, activeMarkets, universeCount, topRank = [], topFab = [], topF01 = [], topO26 = []) {
  await persistFable5(topFab, scanStartedAtUtc, activeMarkets, universeCount).catch(() => {});
  const todayUtc = (scanStartedAtUtc ?? "").slice(0, 10);
  // intraday = algún mercado abierto durante el run (manual/dispatch). El cron nocturno corre
  // con todo cerrado → intraday=false. Los runs intradía SIRVEN el cache pero NO contaminan
  // la serie histórica (que debe ser homogénea, solo cierres) para McClellan + feedback.
  const intraday = Array.isArray(activeMarkets) && activeMarkets.length > 0;
  const { spyBars, spyBullish } = await resolveSpyContext(activeMarkets ?? [], todayUtc);
  // FABLE01 — persiste con el régimen SPY (risk-on/off) para el colchón de caja del overlay blindado.
  // agg.total = tickers realmente analizados; <50 = apagón de proveedores, NO señal de
  // mercado. Se pasa para que Supreme/FABLE01 NO sobrescriban su snapshot bueno con una
  // "estrategia en CAJA" fabricada sobre 0 datos (4ª auditoría, MEDIA-1).
  const analizados = agg?.total ?? 0;
  await persistFable01(topF01, scanStartedAtUtc, activeMarkets, universeCount, spyBullish, analizados).catch(() => {});
  // OPTIMAL2026 — dual momentum risk-parity, persiste en su propia clave (independiente).
  // spyBullish (régimen cacheado) como fallback si spyBars llegó vacío este run.
  await persistOptimal2026(topO26, scanStartedAtUtc, activeMarkets, universeCount, spyBars, spyBullish, analizados).catch(() => {});
  const history = (await kvGet(HISTORY_KEY).catch(() => null)) ?? [];
  const adNetSeries = Array.isArray(history) ? history.map((h) => h.adNet).filter((v) => Number.isFinite(v)) : [];
  const weights = await loadWeights();

  const verdict = computeBreadthVerdict(agg, { spyBullish, adNetSeries, weights });
  const spyClose = spyBars.length ? spyBars.at(-1)?.close ?? null : null;
  const cachedAtUtc = new Date().toISOString();
  const topTickers = await enrichTopRank(topRank);

  // Con muestra insuficiente (proveedores caídos) el score/alertas/indicadores están
  // fabricados sobre 0 tickers — NO se sirven (la señal contraria leía 0% como sobreventa
  // extrema → 99/100 + "sesgo de rebote"). Se sirve UNKNOWN con score null y sin alertas.
  const muestraOk = !verdict.insufficientSample;
  const payload = {
    ok: true,
    verdict: verdict.verdict,
    score: muestraOk ? verdict.score : null,
    color: verdict.color,
    label: verdict.label,
    indicators: muestraOk ? verdict.indicators : {},
    subScores: muestraOk ? verdict.subScores : {},
    alerts: muestraOk ? verdict.alerts : [],
    insufficientSample: verdict.insufficientSample === true,
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

  await kvSet(CACHE_KEY, payload, SNAPSHOT_TTL_S).catch(() => {});

  // Histórico append-only (cap), SOLO en runs de cierre Y con muestra suficiente → serie
  // homogénea. Un UNKNOWN por proveedores caídos NO entra: su adNet=0 fabricado movía el
  // oscilador McClellan y descuadraba el emparejamiento forward del feedback (3ª/4ª auditoría).
  if (!intraday && !verdict.insufficientSample) {
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

  const { agg, candidates, fable5, fable01, optimal2026 } = await processBatch(eligible.slice(0, BATCH_SIZE), spyBars, { openMarkets: activeMarkets, todayUtc });
  const isFinal = batchesTotal <= 1;

  if (isFinal) {
    const payload = await finalizeAndPersist(agg, scanStartedAtUtc, activeMarkets, tickers.length, candidates, fable5, fable01, optimal2026);
    return sendJson(res, 200, { ...payload, mode: "BREADTH_SCAN", status: "FINAL", isFinal: true });
  }

  const token = encodeToken({ scanStartedAtUtc, activeMarkets, tickers, batchesTotal, batchesCompleted: 1, nextBatchIndex: 1, agg, topRank: candidates, topFab: fable5, topF01: fable01, topO26: optimal2026 });
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
  // Validar la FORMA del estado (no solo que sea JSON): un token con campos ausentes/erróneos
  // reventaría más abajo (st.tickers.slice) como un 500 mudo. Mejor un 400 estructurado.
  if (!st || !Array.isArray(st.tickers) || !Number.isInteger(st.nextBatchIndex) || !Number.isInteger(st.batchesTotal)) {
    return sendJson(res, 400, { ok: false, error: "TOKEN_STATE_INVALID" });
  }

  // La lista de tickers va fija en el token (universo de cierre estable), así que el
  // loop no se "rompe" si cruza una apertura/cierre — no hay check de sesión que abortar.
  const start = st.nextBatchIndex * BATCH_SIZE;
  const batchTickers = st.tickers.slice(start, start + BATCH_SIZE);
  const eligible = batchTickers.map((symbol) => ({ providerSymbol: symbol }));
  const todayUtc = (st.scanStartedAtUtc ?? "").slice(0, 10);
  const { spyBars } = await resolveSpyContext(st.activeMarkets ?? [], todayUtc);

  const { agg: batchAgg, candidates: batchCands, fable5: batchFab, fable01: batchF01, optimal2026: batchO26 } = await processBatch(eligible, spyBars, { openMarkets: st.activeMarkets ?? [], todayUtc });
  const merged = mergeAggregators(st.agg, batchAgg);
  const mergedRank = mergeTopRank(st.topRank ?? [], batchCands);
  const mergedFab = mergeFable5(st.topFab ?? [], batchFab);
  const mergedF01 = mergeFable01(st.topF01 ?? [], batchF01);
  const mergedO26 = mergeOptimal2026(st.topO26 ?? [], batchO26);
  const newCompleted = st.batchesCompleted + 1;
  const isFinal = newCompleted >= st.batchesTotal;

  if (isFinal) {
    const payload = await finalizeAndPersist(merged, st.scanStartedAtUtc, st.activeMarkets, st.tickers.length, mergedRank, mergedFab, mergedF01, mergedO26);
    return sendJson(res, 200, { ...payload, mode: "BREADTH_SCAN", status: "FINAL", isFinal: true });
  }

  const token = encodeToken({ ...st, batchesCompleted: newCompleted, nextBatchIndex: st.nextBatchIndex + 1, agg: merged, topRank: mergedRank, topFab: mergedFab, topF01: mergedF01, topO26: mergedO26 });
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
  // try/catch global: cualquier excepción no prevista devuelve un 500 ESTRUCTURADO (con body JSON)
  // en vez de un FUNCTION_INVOCATION_FAILED mudo, para que el orquestador externo pueda reaccionar.
  try {
    if (action === "start") return await handleStart(req, res);
    if (action === "continue") return await handleContinue(req, res);
    if (action === "feedback") return await handleFeedback(req, res);
    return await handleGet(req, res);
  } catch (err) {
    console.error("[market-breadth] handler error:", err);
    if (!res.headersSent) return sendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", detail: String(err?.message ?? err) });
  }
}
