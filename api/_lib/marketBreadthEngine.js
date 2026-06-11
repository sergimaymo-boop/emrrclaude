/**
 * Market Breadth Engine — MOTOR DE ANÁLISIS DE AMPLITUD DE MERCADO
 * ================================================================
 * Módulo NUEVO e INDEPENDIENTE. Lógica PURA (sin I/O): recibe señales por ticker
 * ya calculadas y produce el VEREDICTO AGREGADO de mercado (🟢/🟡/🔴 + score 0-100).
 *
 * El ticker individual es materia prima; el producto es la amplitud del mercado:
 * ¿la subida está participada (sana) o es "hueca" (pocos tickers tirando = pullback)?
 *
 * Reutiliza por import (no duplica) calculateEma del technicalEngine existente para
 * el oscilador McClellan. No toca ningún módulo del programa.
 *
 * Indicadores de amplitud (los más predictivos de techo/pullback):
 *   1. % del universo sobre MA50          — salud de medio plazo
 *   2. % del universo sobre MA200         — régimen primario
 *   3. Advance/Decline (% avances)        — participación
 *   4. Nuevos máximos vs nuevos mínimos   — deterioro interno (alerta temprana)
 *   5. Distribución por RVOL en bajistas  — venta institucional (alerta temprana)
 *   6. Pendiente EMA20 agregada           — momentum de corto plazo
 *   7. McClellan-style oscillator         — momento de la amplitud (anticipa giros)
 *   8. Divergencia de amplitud vs SPY     — subida "hueca" = techo inminente (flag)
 */

import { calculateEma, calculateAtr } from "./technicalEngine.js";

// ── Pesos iniciales del score (Object.freeze como INDICATOR_WEIGHTS de marketPulse).
// Recalibrables de forma AUDITADA por el feedback-loop (nunca auto-tuning opaco). Suman 1.
export const BREADTH_WEIGHTS = Object.freeze({
  pctAboveMA50: 0.20,
  pctAboveMA200: 0.12,
  advanceDecline: 0.18,
  newHighLow: 0.15,
  distribution: 0.15, // inverso: más distribución → peor
  emaSlope: 0.10,
  mcclellan: 0.10,
});

// Umbrales del semáforo (validados por el usuario: ≥70 / 50-70 / <50).
export const BREADTH_THRESHOLDS = Object.freeze({
  bullish: 70,        // score ≥ 70 → 🟢 FAVORABLE
  deteriorating: 50,  // 50 ≤ score < 70 → 🟡 NEUTRAL
  // score < 50 → 🔴 RIESGO DE CORRECCIÓN
});

/**
 * CALIBRACIÓN v2 (contraria, horizonte ~40 sesiones ≈ 1-2 meses).
 * Derivada de un backtest walk-forward de 5 años (2021-2026), train/test temporal,
 * validada OUT-OF-SAMPLE: corr ~+0.25, separación 🟢-🔴 ≈ 2.8pp (reproducible con
 * scripts/calibrate-breadth.mjs; el +0.32 inicial era el mejor de un barrido de 5 horizontes →
 * sesgo de selección; dataset Yahoo no fijado). Hallazgo central: el breadth
 * REVIERTE A LA MEDIA — amplitud sobrecomprada → retornos peores; sobreventa → mejores
 * (por eso los pesos de participación son NEGATIVOS). El score es un blend de z-scores de los
 * sub-scores con estos pesos firmados, mapeado a 0-100 anclando q33→50 y q66→70.
 * Recalibrable (auditado) re-corriendo scripts/calibrate-breadth.mjs con más histórico.
 */
export const BREADTH_CALIBRATION = Object.freeze({
  horizonDays: 40,
  weights: Object.freeze({
    pctAboveMA50: -0.199, pctAboveMA200: 0.045, advanceDecline: -0.140,
    newHighLow: -0.044, distribution: -0.096, emaSlope: -0.221, mcclellan: -0.254,
  }),
  zstats: Object.freeze({
    pctAboveMA50: { m: 55.48, s: 20.56 }, pctAboveMA200: { m: 57.72, s: 19.64 },
    advanceDecline: { m: 52.95, s: 22.53 }, newHighLow: { m: 61.70, s: 16.20 },
    distribution: { m: 77.04, s: 21.36 }, emaSlope: { m: 54.12, s: 21.91 },
    mcclellan: { m: 50.34, s: 3.27 },
  }),
  thresholds: Object.freeze({ q33: -0.336, q66: 0.305 }),
});

// Parámetros de las señales por ticker.
const DISTRIBUTION_VOL_MULT = 1.25; // volumen > 1.25× su media 20d en vela bajista = distribución
const NEW_HL_LOOKBACK = 252;        // ~52 semanas de sesiones para máx/mín

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0);

/**
 * Señales binarias/graduadas de UN ticker a partir de sus barras crudas + technicals.
 * @param {{technicals: object|null}} evaluation  resultado de calculateTechnicals
 * @param {Array<{high:number,low:number,close:number}>} bars  barras crudas (~280)
 * @returns {object|null}  señales, o null si no hay datos suficientes (skip, no rompe)
 */
export function computeTickerBreadthSignals(evaluation, bars) {
  const t = evaluation?.technicals;
  if (!t || !isNum(t.lastClose) || !Array.isArray(bars) || bars.length < 60) return null;

  const closes = bars.map((b) => b.close).filter(isNum);
  const ema200 = closes.length >= 200 ? calculateEma(closes, 200) : null;

  // Máx/mín de las últimas ~52 semanas (de las barras disponibles).
  const window = bars.slice(-NEW_HL_LOOKBACK);
  const highs = window.map((b) => b.high).filter(isNum);
  const lows = window.map((b) => b.low).filter(isNum);
  const hi52 = highs.length ? Math.max(...highs) : null;
  const lo52 = lows.length ? Math.min(...lows) : null;

  const last = t.lastClose;
  const mom5 = isNum(t.momentum5) ? t.momentum5 : null;

  // Distribución (día de distribución institucional): vela de cierre BAJISTA con volumen por
  // encima de su media de 20 sesiones — derivada de barras crudas, robusta también en EU (donde
  // el rvol del technicalEngine puede quedar fijado a 1.0 y nunca disparar el umbral antiguo).
  const n = bars.length;
  const lastBar = bars[n - 1];
  const prevBar = bars[n - 2];
  const vols = bars.slice(-21, -1).map((b) => b.volume).filter(isNum);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  const distribution = (isNum(lastBar?.close) && isNum(prevBar?.close) && isNum(lastBar?.volume) && isNum(avgVol) && avgVol > 0)
    ? (lastBar.close < prevBar.close && lastBar.volume > avgVol * DISTRIBUTION_VOL_MULT)
    : null;

  return {
    hasMA50: isNum(t.ema50),
    aboveMA50: isNum(t.ema50) ? last > t.ema50 : null,
    hasMA200: isNum(ema200),
    aboveMA200: isNum(ema200) ? last > ema200 : null,
    advancing: mom5 === null ? null : mom5 > 0,
    declining: mom5 === null ? null : mom5 < 0,
    // Nuevo máximo/mínimo: a <2% del extremo de 52 semanas.
    newHigh: hi52 ? last >= hi52 * 0.98 : null,
    newLow: lo52 ? last <= lo52 * 1.02 : null,
    distribution,
    slopeUp: isNum(t.ema20SlopePercent) ? t.ema20SlopePercent > 0 : null,
    rs20: isNum(t.rs20) ? t.rs20 : null,
  };
}

/** Acumulador vacío de amplitud (se va sumando batch a batch). */
export function emptyBreadthAggregator() {
  return {
    total: 0,
    ma50Valid: 0, aboveMA50: 0,
    ma200Valid: 0, aboveMA200: 0,
    advancing: 0, declining: 0,
    newHigh: 0, newLow: 0,
    distribution: 0, distributionValid: 0,
    slopeValid: 0, slopeUp: 0,
    rsSum: 0, rsCount: 0,
    skipped: 0,
  };
}

/** Suma las señales de un ticker (o un batch) al acumulador. Mutación controlada. */
export function foldTickerSignals(agg, s) {
  if (!s) { agg.skipped += 1; return agg; }
  agg.total += 1;
  if (s.hasMA50) { agg.ma50Valid += 1; if (s.aboveMA50) agg.aboveMA50 += 1; }
  if (s.hasMA200) { agg.ma200Valid += 1; if (s.aboveMA200) agg.aboveMA200 += 1; }
  if (s.advancing === true) agg.advancing += 1;
  if (s.declining === true) agg.declining += 1;
  if (s.newHigh === true) agg.newHigh += 1;
  if (s.newLow === true) agg.newLow += 1;
  if (s.distribution !== null) { agg.distributionValid += 1; if (s.distribution) agg.distribution += 1; }
  if (s.slopeUp !== null) { agg.slopeValid += 1; if (s.slopeUp) agg.slopeUp += 1; }
  if (s.rs20 !== null) { agg.rsSum += s.rs20; agg.rsCount += 1; }
  return agg;
}

/** Combina dos acumuladores (para fusionar batches del loop). */
export function mergeAggregators(a, b) {
  const keys = Object.keys(emptyBreadthAggregator());
  const out = emptyBreadthAggregator();
  for (const k of keys) out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0);
  return out;
}

/**
 * McClellan-style oscillator: EMA rápida (19) menos EMA lenta (39) de la serie
 * histórica del A/D neto normalizado. Devuelve el valor y normalizado a 0-100.
 * @param {number[]} adNetSeries  histórico de (avances−declives)/total*100 por ciclo
 */
export function computeMcClellan(adNetSeries) {
  const series = (adNetSeries ?? []).filter(isNum);
  // Periodos FIJOS 19/39: con < 39 ciclos el oscilador no es comparable día a día
  // (EMA con periodo recortado → fast≈slow → value≈0). Hasta entonces, neutro y NO disponible
  // (computeBreadthVerdict no lo mete en el score mientras available=false).
  if (series.length < 39) return { value: 0, score: 50, available: false };
  const fast = calculateEma(series, 19);
  const slow = calculateEma(series, 39);
  if (!isNum(fast) || !isNum(slow)) return { value: 0, score: 50, available: false };
  const value = fast - slow;
  // Normaliza: McClellan típico ∈ [-100,+100]; mapear a 0-100 con 50 = neutro.
  const score = clamp(50 + value * 0.5);
  return { value: Math.round(value * 100) / 100, score: Math.round(score), available: true };
}

/**
 * VEREDICTO AGREGADO DE MERCADO a partir del acumulador del ciclo completo.
 * @param {object} agg  acumulador final (todo el universo)
 * @param {object} opts { adNetSeries, weights, thresholds, spyBullish }
 * @returns veredicto con score 0-100, semáforo, desglose de indicadores y alertas.
 */
export function computeBreadthVerdict(agg, opts = {}) {
  const weights = opts.weights ?? BREADTH_WEIGHTS;
  const thr = opts.thresholds ?? BREADTH_THRESHOLDS;

  const pctAboveMA50 = pct(agg.aboveMA50, agg.ma50Valid);
  const pctAboveMA200 = pct(agg.aboveMA200, agg.ma200Valid);
  const advDec = agg.advancing + agg.declining;
  const advPct = pct(agg.advancing, advDec);              // % de avances
  const newHighPct = pct(agg.newHigh, agg.total);
  const newLowPct = pct(agg.newLow, agg.total);
  const netHL = newHighPct - newLowPct;                    // neto máx-mín
  const distributionPct = pct(agg.distribution, agg.distributionValid);
  const slopeUpPct = pct(agg.slopeUp, agg.slopeValid);
  const avgRs20 = agg.rsCount > 0 ? agg.rsSum / agg.rsCount : 0;
  const mcc = computeMcClellan(opts.adNetSeries);

  // Sub-scores 0-100 (100 = más alcista/sano).
  const sub = {
    pctAboveMA50: clamp(pctAboveMA50),
    pctAboveMA200: clamp(pctAboveMA200),
    advanceDecline: clamp(advPct),
    newHighLow: clamp(50 + netHL * 1.5),                  // neto +máx empuja arriba
    distribution: clamp(100 - distributionPct * 2.5),     // INVERSO: más distribución → peor
    emaSlope: clamp(slopeUpPct),
    mcclellan: mcc.score,
  };

  // ── SCORE v2 CALIBRADO (contrario, ~40 sesiones) ──────────────────────────────
  // Blend de z-scores de los sub-scores con los pesos FIRMADOS de la calibración (negativo =
  // contrario: amplitud alta resta, sobreventa suma). Mapeado a 0-100 anclando q33→50, q66→70.
  // McClellan no disponible (serie < 39) → sub-score 50 → z≈0 → no aporta hasta acumular histórico.
  const cal = opts.calibration ?? BREADTH_CALIBRATION;
  let raw = 0;
  for (const f of Object.keys(cal.weights)) {
    const z = ((sub[f] ?? 50) - cal.zstats[f].m) / (cal.zstats[f].s || 1);
    raw += cal.weights[f] * z;
  }
  const { q33, q66 } = cal.thresholds;
  const slope = 20 / ((q66 - q33) || 1);
  const score = Math.round(clamp(50 + (raw - q33) * slope));

  const verdict = score >= thr.bullish ? "BULLISH"
    : score >= thr.deteriorating ? "DETERIORATING"
    : "PULLBACK_IMMINENT";

  // Alertas en clave CONTRARIA: la SOBRECOMPRA es el riesgo; la SOBREVENTA, el viento a favor.
  const alerts = [];
  if (pctAboveMA50 >= 75) alerts.push(`Amplitud sobrecomprada: ${pctAboveMA50.toFixed(0)}% sobre la MA50 — históricamente seguido de retornos más bajos a ~1-2 meses.`);
  if (pctAboveMA50 <= 30) alerts.push(`Amplitud en sobreventa: solo ${pctAboveMA50.toFixed(0)}% sobre la MA50 — sesgo de rebote a ~1-2 meses.`);
  if (distributionPct >= 35) alerts.push(`Presión vendedora elevada: ${distributionPct.toFixed(0)}% de tickers con ventas de alto volumen.`);
  if (opts.spyBullish === false) alerts.push(`Régimen primario bajista (SPY < EMA200) — la reversión al alza es menos fiable en tendencia bajista.`);
  if (opts.spyBullish === null) alerts.push(`Régimen del SPY no disponible (fallo de datos del benchmark).`);

  return {
    score,
    verdict, // BULLISH=favorable | DETERIORATING=neutral | PULLBACK_IMMINENT=riesgo corrección (~1-2 meses)
    horizonDays: cal.horizonDays,
    color: verdict === "BULLISH" ? "#10b981" : verdict === "DETERIORATING" ? "#eab308" : "#ef4444",
    label: verdict === "BULLISH" ? "Favorable — sesgo alcista (~1-2 meses)"
      : verdict === "DETERIORATING" ? "Neutral — amplitud en zona media"
      : "Riesgo de corrección — sobrecompra (~1-2 meses)",
    indicators: {
      pctAboveMA50: round1(pctAboveMA50),
      pctAboveMA200: round1(pctAboveMA200),
      advancePct: round1(advPct),
      declinePct: round1(pct(agg.declining, advDec)),
      newHighPct: round1(newHighPct),
      newLowPct: round1(newLowPct),
      netHighLow: round1(netHL),
      distributionPct: round1(distributionPct),
      slopeUpPct: round1(slopeUpPct),
      avgRs20: round1(avgRs20),
      mcclellan: mcc.value,
    },
    subScores: sub,
    alerts,
    sample: { analyzed: agg.total, skipped: agg.skipped, adNet: round1(advPct - pct(agg.declining, advDec)) },
    adNet: round1((agg.advancing - agg.declining) / Math.max(1, agg.total) * 100), // para la serie McClellan
  };
}

function round1(v) { return isNum(v) ? Math.round(v * 10) / 10 : 0; }

/**
 * FEEDBACK-LOOP (auto-optimización AUDITADA, no auto-aplicada).
 * Contrasta cada veredicto pasado contra el retorno REAL del SPY `forwardSessions`
 * ciclos después (ground-truth) → hit-rate por tipo de veredicto. Devuelve un informe
 * + una RECOMENDACIÓN de recalibración; NUNCA cambia los pesos por su cuenta (el usuario
 * valida y aplica). Así el motor "aprende" de forma transparente y auditable.
 * @param {Array<{verdict:string, spyClose:number}>} history  histórico append-only
 */
export function computeBreadthFeedback(history, opts = {}) {
  const fwd = opts.forwardSessions ?? BREADTH_CALIBRATION.horizonDays; // ~40 sesiones (horizonte del modelo)
  const h = (history ?? []).filter((r) => isNum(r?.spyClose) && r?.verdict);
  if (h.length < fwd + 3) {
    return { available: false, reason: "INSUFFICIENT_HISTORY", samples: h.length, needed: fwd + 3, forwardSessions: fwd };
  }

  const buckets = {
    BULLISH: { hit: 0, total: 0 },
    DETERIORATING: { hit: 0, total: 0 },
    PULLBACK_IMMINENT: { hit: 0, total: 0 },
  };
  let overallHit = 0, overallTotal = 0;

  for (let i = 0; i + fwd < h.length; i++) {
    const cur = h[i], future = h[i + fwd];
    if (!isNum(cur.spyClose) || !isNum(future.spyClose) || cur.spyClose === 0) continue;
    const ret = ((future.spyClose - cur.spyClose) / cur.spyClose) * 100; // % forward SPY
    const b = buckets[cur.verdict];
    if (!b) continue;
    // Acierto con buckets NO solapados a horizonte ~40 sesiones (banda ±2% por ser plazo largo):
    // FAVORABLE→SPY sube (ret>2); RIESGO→SPY baja (ret<-2); NEUTRAL→lateral (-2..2).
    const hit = cur.verdict === "BULLISH" ? ret > 2
      : cur.verdict === "PULLBACK_IMMINENT" ? ret < -2
      : (ret >= -2 && ret <= 2);
    b.total += 1; overallTotal += 1;
    if (hit) { b.hit += 1; overallHit += 1; }
  }

  const rate = (b) => (b.total > 0 ? Math.round((b.hit / b.total) * 100) : null);
  const overall = overallTotal > 0 ? Math.round((overallHit / overallTotal) * 100) : null;

  let recommendation = "Hit-rate dentro de lo esperado — mantener los pesos actuales.";
  if (overall != null && overall < 50) recommendation = "Hit-rate bajo (<50%): revisar pesos/umbrales antes de fiarse del veredicto. Recalibración recomendada (manual, auditada).";
  else if (overall != null && overall >= 65) recommendation = "Hit-rate sólido (≥65%): el motor anticipa bien; mantener configuración.";

  return {
    available: true,
    forwardSessions: fwd,
    samplesEvaluated: overallTotal,
    overallHitRate: overall,
    hitRate: { BULLISH: rate(buckets.BULLISH), DETERIORATING: rate(buckets.DETERIORATING), PULLBACK_IMMINENT: rate(buckets.PULLBACK_IMMINENT) },
    counts: buckets,
    recommendation,
    note: "Recalibración AUDITADA: este informe NO modifica los pesos. El ajuste lo aprueba el usuario.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RANKING DE TICKERS — factor model cross-sectional (sub-modelo, edge MODESTO).
// ════════════════════════════════════════════════════════════════════════════
// Validado out-of-sample (5 años, walk-forward): IC ≈ 0.01, prob↑ top ≈ 60% vs 58% base.
// Es un SCREENER de candidatos de rebote por sobreventa (mean-reversion), NO un predictor
// fiable. Pesos firmados (negativo = contrario: sobreventa puntúa alto). z-stats GLOBALES fijas
// → cada ticker se puntúa solo. Recalibrable con scripts/rank-tickers.mjs.
export const RANK_CALIBRATION = Object.freeze({
  horizonDays: 60,
  baseUp: 0.5822,
  weights: Object.freeze({
    ret20: -0.083, ret60: -0.109, distMA50: -0.115, distMA200: -0.003, rsi14: -0.065,
    dist52H: -0.044, dist52L: 0.126, rvol: 0.003, atrPct: 0.187, emaSlope: -0.092,
    pbUptrend: -0.035, aboveMA200: -0.046, goldenCross: 0.008, qualMom: -0.084,
  }),
  gstats: Object.freeze({
    ret20: { m: 0.00846, s: 0.08280 }, ret60: { m: 0.02481, s: 0.13921 },
    distMA50: { m: 0.00589, s: 0.06162 }, distMA200: { m: 0.01949, s: 0.12376 },
    rsi14: { m: 51.779, s: 17.391 }, dist52H: { m: -0.15760, s: 0.13188 },
    dist52L: { m: 0.33280, s: 0.34823 }, rvol: { m: 0.99615, s: 0.17160 },
    atrPct: { m: 0.02426, s: 0.01052 }, emaSlope: { m: 0.00144, s: 0.01913 },
    pbUptrend: { m: 2.0342, s: 5.4771 }, aboveMA200: { m: 0.57590, s: 0.49421 },
    goldenCross: { m: 0.57832, s: 0.49383 }, qualMom: { m: 0.05579, s: 0.10048 },
  }),
  // score → P(subida) por percentiles (20 bins) en TRAIN con z fija.
  probTable: Object.freeze([
    { sMin: -2.8799, p: 0.553 }, { sMin: -0.7836, p: 0.537 }, { sMin: -0.6342, p: 0.548 },
    { sMin: -0.5311, p: 0.546 }, { sMin: -0.4455, p: 0.568 }, { sMin: -0.3719, p: 0.547 },
    { sMin: -0.3046, p: 0.553 }, { sMin: -0.2401, p: 0.562 }, { sMin: -0.1782, p: 0.556 },
    { sMin: -0.1166, p: 0.572 }, { sMin: -0.0539, p: 0.569 }, { sMin: 0.0104, p: 0.578 },
    { sMin: 0.0774, p: 0.575 }, { sMin: 0.1518, p: 0.601 }, { sMin: 0.2270, p: 0.612 },
    { sMin: 0.3117, p: 0.602 }, { sMin: 0.4097, p: 0.615 }, { sMin: 0.5293, p: 0.631 },
    { sMin: 0.6909, p: 0.657 }, { sMin: 0.9503, p: 0.664 },
  ]),
});

function rsi14(closes, p = 14) {
  if (!Array.isArray(closes) || closes.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) g += ch; else l -= ch;
  }
  const rs = l === 0 ? 100 : g / l;
  return 100 - 100 / (1 + rs);
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Features de ranking de UN ticker desde sus barras (point-in-time, última barra). */
export function computeTickerRankFeatures(bars) {
  if (!Array.isArray(bars) || bars.length < 210) return null;
  const closes = bars.map((b) => b.close).filter(isNum);
  if (closes.length < 210) return null;
  const last = closes.at(-1);
  // Guarda anti-glitch / split sin ajustar: si la última vela se desvía >40% de la mediana de las
  // 5 anteriores, casi seguro es dato corrupto o split no ajustado → descartar (no rankear basura).
  const recent5 = closes.slice(-6, -1).slice().sort((a, b) => a - b);
  const med = recent5.length ? recent5[Math.floor(recent5.length / 2)] : null;
  if (isNum(med) && med > 0 && Math.abs(last / med - 1) > 0.40) return null;
  const win = bars.slice(-260);
  const highs = win.map((b) => b.high).filter(isNum);
  const lows = win.map((b) => b.low).filter(isNum);
  const hi252 = highs.length ? Math.max(...highs) : last;
  const lo252 = lows.length ? Math.min(...lows) : last;
  const ema50 = calculateEma(closes, 50);
  const ema200 = closes.length >= 200 ? calculateEma(closes, 200) : null;
  const ema20 = calculateEma(closes, 20);
  const ema20p = calculateEma(closes.slice(0, -5), 20);
  const vols = bars.map((b) => b.volume).filter(isNum);
  const v20 = avg(vols.slice(-20)), v60 = avg(vols.slice(-60));
  const atr = calculateAtr(bars.slice(-30), 14);
  const r = rsi14(closes);
  const up = (isNum(ema200) && last > ema200) ? 1 : 0;
  const ret60 = last / closes.at(-61) - 1;
  if (!isNum(ema50) || !isNum(ema200) || !isNum(atr)) return null;
  return {
    ret20: last / closes.at(-21) - 1, ret60,
    distMA50: last / ema50 - 1, distMA200: last / ema200 - 1,
    rsi14: r, dist52H: last / hi252 - 1, dist52L: last / lo252 - 1,
    rvol: v60 > 0 ? v20 / v60 : 1, atrPct: atr / last,
    emaSlope: isNum(ema20) && isNum(ema20p) && ema20p !== 0 ? ema20 / ema20p - 1 : 0,
    pbUptrend: up * Math.max(0, 50 - r), aboveMA200: up,
    goldenCross: (isNum(ema50) && isNum(ema200) && ema50 > ema200) ? 1 : 0,
    qualMom: up * ret60, close: last, prevClose: closes.at(-2) ?? null,
  };
}

/** Puntúa un ticker (score + probabilidad calibrada) con la calibración fija. */
export function scoreTickerRank(ft, cal = RANK_CALIBRATION) {
  if (!ft) return null;
  let score = 0;
  for (const k of Object.keys(cal.weights)) {
    const g = cal.gstats[k];
    if (!g) continue;
    // Winsorizar el z a [-3,3]: evita que un único feature extremo (p.ej. momentum +68%)
    // domine y cuele nombres ajenos al perfil de sobreventa en el top.
    const z = Math.max(-3, Math.min(3, (ft[k] - g.m) / (g.s || 1)));
    score += cal.weights[k] * z;
  }
  let prob = cal.baseUp;
  for (const b of cal.probTable) if (score >= b.sMin) prob = b.p;
  return { score: Math.round(score * 1000) / 1000, prob: Math.round(prob * 1000) / 1000 };
}
