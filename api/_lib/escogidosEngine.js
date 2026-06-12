/**
 * LOS ESCOGIDOS — motor independiente: top-10 con mayor probabilidad alcista a 5 SESIONES (~7 días).
 * ================================================================================================
 * Calibrado por LOOP de optimización (scripts/calibrate-escogidos.mjs): 9 configs de señales,
 * walk-forward 5 años, train/test temporal, universo US+EU completo. Config ganadora OOS:
 * REVERSAL CORTO + suelo 52s + volatilidad → IC 0.038 · win 55% vs base 53% · α +0.52pp/5 sesiones.
 *
 * HONESTIDAD: el edge a 5 días es PEQUEÑO (el horizonte más difícil de predecir que existe).
 * La señal es CONTRARIA: sobreventa de muy corto plazo (RSI3 bajo, racha de caídas, ret5 negativo)
 * con volatilidad alta → sesgo de rebote. Diseñado para entrar SIEMPRE con trailing stop.
 *
 * Módulo independiente: no toca ningún otro motor. Se alimenta de las MISMAS barras del scan
 * (cero fetch extra) vía market-breadth processBatch.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// Parámetros de la config ganadora del loop (I), pegados tal cual del output del script.
export const ESCOGIDOS_CALIBRATION = Object.freeze({
  horizonSessions: 5, // ~7 días naturales
  baseUp: 0.5303,
  weights: Object.freeze({ ret5: -0.1655, rsi3: -0.3127, downStreak: 0.26, dist52L: 0.0779, atrPct: 0.1839 }),
  gstats: Object.freeze({
    ret5: { m: 0.00248, s: 0.04182 }, rsi3: { m: 52.17403, s: 34.12358 },
    downStreak: { m: 0.89742, s: 1.31067 }, dist52L: { m: 0.33318, s: 0.34942 },
    atrPct: { m: 0.02427, s: 0.01035 },
  }),
  probTable: Object.freeze([
    { sMin: -1.207, p: 0.5314 }, { sMin: -0.858, p: 0.5193 }, { sMin: -0.7702, p: 0.525 },
    { sMin: -0.6839, p: 0.5284 }, { sMin: -0.5957, p: 0.5338 }, { sMin: -0.5114, p: 0.5241 },
    { sMin: -0.4276, p: 0.5298 }, { sMin: -0.3449, p: 0.5249 }, { sMin: -0.2631, p: 0.5189 },
    { sMin: -0.1817, p: 0.5281 }, { sMin: -0.0994, p: 0.53 }, { sMin: -0.0156, p: 0.5316 },
    { sMin: 0.0718, p: 0.5254 }, { sMin: 0.1616, p: 0.5292 }, { sMin: 0.2586, p: 0.5334 },
    { sMin: 0.3687, p: 0.5374 }, { sMin: 0.5043, p: 0.5368 }, { sMin: 0.6974, p: 0.5254 },
    { sMin: 0.9154, p: 0.5331 }, { sMin: 1.2008, p: 0.5596 },
  ]),
});

function rsiOf(closes, p) {
  if (closes.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) g += ch; else l -= ch;
  }
  const rs = l === 0 ? 100 : g / l;
  return 100 - 100 / (1 + rs);
}

/** Features de "Los Escogidos" desde las barras del ticker (point-in-time, última barra). */
export function computeEscogidosFeatures(bars) {
  if (!Array.isArray(bars) || bars.length < 70) return null;
  const closes = bars.map((b) => b.close).filter(isNum);
  if (closes.length < 70) return null;
  const last = closes.at(-1);
  if (!isNum(last) || last <= 0) return null;
  // Anti-glitch (mismo criterio que la watchlist): última vela desviada >40% de la mediana de las
  // 5 previas = dato corrupto/split sin ajustar → descartar.
  const recent5 = closes.slice(-6, -1).slice().sort((a, b) => a - b);
  const med = recent5.length ? recent5[Math.floor(recent5.length / 2)] : null;
  if (isNum(med) && med > 0 && Math.abs(last / med - 1) > 0.40) return null;

  const win = bars.slice(-260);
  const lows = win.map((b) => b.low).filter(isNum);
  const lo252 = lows.length ? Math.min(...lows) : last;
  const trs = [];
  for (let i = bars.length - 14; i < bars.length; i++) {
    const b = bars[i], pb = bars[i - 1];
    if (!isNum(b?.high) || !isNum(b?.low) || !isNum(pb?.close)) continue;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pb.close), Math.abs(b.low - pb.close)));
  }
  const atr14 = avg(trs);
  let streak = 0;
  for (let i = closes.length - 1; i > closes.length - 11 && i > 0 && closes[i] < closes[i - 1]; i--) streak++;

  return {
    ret5: last / closes.at(-6) - 1, // 5 sesiones = ~7 días naturales (el "% últimos 7 días" del panel)
    rsi3: rsiOf(closes, 3),
    downStreak: streak,
    dist52L: last / lo252 - 1,
    atrPct: isNum(atr14) && atr14 > 0 ? atr14 / last : null,
    close: last,
    prevClose: closes.at(-2) ?? null,
  };
}

/** Puntúa un ticker con la calibración del loop. Devuelve score + probabilidad calibrada. */
export function scoreEscogidos(ft, cal = ESCOGIDOS_CALIBRATION) {
  if (!ft || !isNum(ft.atrPct)) return null;
  let score = 0;
  for (const k of Object.keys(cal.weights)) {
    const g = cal.gstats[k];
    const z = Math.max(-3, Math.min(3, (ft[k] - g.m) / (g.s || 1)));
    score += cal.weights[k] * z;
  }
  let prob = cal.baseUp;
  for (const b of cal.probTable) if (score >= b.sMin) prob = b.p;
  return { score: Math.round(score * 1000) / 1000, prob: Math.round(prob * 1000) / 1000 };
}

/** Mantiene los N mejores candidatos al fusionar batches del loop de scan. */
export function mergeEscogidos(a, b, n = 15) {
  return [...(a ?? []), ...(b ?? [])].sort((x, y) => y.score - x.score).slice(0, n);
}
