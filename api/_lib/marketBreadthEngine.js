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

import { calculateEma } from "./technicalEngine.js";

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
  bullish: 70,        // score ≥ 70 → 🟢 ALCISTA
  deteriorating: 50,  // 50 ≤ score < 70 → 🟡 DETERIORO
  // score < 50 → 🔴 PULLBACK INMINENTE
});

// Parámetros de las señales por ticker.
const DISTRIBUTION_RVOL = 1.5;   // RVOL ≥ 1.5 en vela bajista = distribución institucional
const NEW_HL_LOOKBACK = 252;     // ~52 semanas de sesiones para máx/mín

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
    // Distribución: vela bajista reciente con volumen relativo alto.
    distribution: mom5 !== null && isNum(t.rvol) ? (mom5 < 0 && t.rvol >= DISTRIBUTION_RVOL) : null,
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
  if (series.length < 2) return { value: 0, score: 50, available: false };
  const fast = calculateEma(series, Math.min(19, series.length));
  const slow = calculateEma(series, Math.min(39, series.length));
  if (!isNum(fast) || !isNum(slow)) return { value: 0, score: 50, available: false };
  const value = fast - slow;
  // Normaliza: McClellan típico ∈ [-100,+100]; mapear a 0-100 con 50 = neutro.
  const score = clamp(50 + value * 0.5);
  return { value: Math.round(value * 100) / 100, score: Math.round(score), available: series.length >= 5 };
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

  let score = 0;
  for (const [k, w] of Object.entries(weights)) score += (sub[k] ?? 50) * w;
  score = Math.round(clamp(score));

  // Hard-override de régimen: si el SPY está bajo su EMA200, techo del veredicto
  // (las mejores rachas fallan en régimen bajista — misma doctrina que marketPulse).
  if (opts.spyBullish === false && score > thr.deteriorating) {
    score = thr.deteriorating - 1;
  }

  const verdict = score >= thr.bullish ? "BULLISH"
    : score >= thr.deteriorating ? "DETERIORATING"
    : "PULLBACK_IMMINENT";

  // Señales de alerta temprana (explicadas).
  const alerts = [];
  if (distributionPct >= 30) alerts.push(`Distribución institucional: ${distributionPct.toFixed(0)}% de tickers con ventas de alto volumen.`);
  if (netHL < -5) alerts.push(`Expansión de nuevos mínimos (${newLowPct.toFixed(0)}%) sobre nuevos máximos (${newHighPct.toFixed(0)}%) — deterioro interno.`);
  if (pctAboveMA50 < 40) alerts.push(`Solo ${pctAboveMA50.toFixed(0)}% del mercado sobre su MA50 — amplitud rota.`);
  if (opts.spyBullish === true && pctAboveMA50 < 50 && avgRs20 < 0) alerts.push(`Divergencia de amplitud: el índice aguanta pero la participación cae (subida "hueca").`);
  if (mcc.available && mcc.value < 0) alerts.push(`Oscilador McClellan en negativo (${mcc.value}) — momento de amplitud girando a la baja.`);

  return {
    score,
    verdict, // BULLISH | DETERIORATING | PULLBACK_IMMINENT
    color: verdict === "BULLISH" ? "#10b981" : verdict === "DETERIORATING" ? "#eab308" : "#ef4444",
    label: verdict === "BULLISH" ? "Alcista — amplitud sana"
      : verdict === "DETERIORATING" ? "Deterioro — vigilancia"
      : "Pullback inminente — distribución",
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
  const fwd = opts.forwardSessions ?? 5;
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
    // Acierto: ALCISTA acierta si el SPY sube; PULLBACK si baja; DETERIORO si no hay subida fuerte.
    const hit = cur.verdict === "BULLISH" ? ret > 0
      : cur.verdict === "PULLBACK_IMMINENT" ? ret < 0
      : ret < 0.5;
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
