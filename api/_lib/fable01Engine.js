/**
 * FABLE01 — motor independiente: top-10 de TENDENCIA ALCISTA SANA con ASIGNACIÓN DE CAPITAL.
 * ===========================================================================================
 * Calibrado por LOOP de CARTERA REAL (scripts/calibrate-fable01.mjs, 5 años walk-forward):
 *   · Score de SALUD de tendencia PULLBACK-AGNÓSTICO (no penaliza sobreextensión, §6):
 *     RS vs SPY (peso alto) + pendiente (alto) + momentum (medio) + R²/consistencia + RVOL (conf.).
 *     Forma ABSOLUTA por-ticker (squash tanh) para ser desplegable batch-a-batch sin contexto global.
 *   · Asignación CONCENTRADA (softmax) con overlay §8 "BLINDADO" confirmado por backtest:
 *     tope blando 20% + damping de sobreextensión + colchón de caja en risk-off (SPY<EMA200, 35%).
 *   · Trailing = corazón del módulo. Barrido ATR: el más AJUSTADO que aún deja correr = 3.5×ATR.
 *     Bandas TR=3.0× / TN=3.5× / TA=4.5×, asignadas por volatilidad y continuidad de cada ticker.
 *
 * VERDAD HONESTA (OOS, 20bps costes, TODO el histórico incl. bear 2022): es un motor de momentum
 * pro-cíclico de ALTA BETA. CAGR ~20%, maxDD ~23%, MAR ~0.89, gana al SPY en 3/6 tramos.
 * Brilla en bulls limpios (+57% en tramos), sufre en lateral/bear. Badge honesto = 21/100.
 *
 * Módulo independiente: no lee/escribe ningún otro motor; se alimenta de las MISMAS barras del scan.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const squash = (x, scale) => 0.5 * (Math.tanh(x / scale) + 1); // → (0,1)

export const FABLE01_CALIBRATION = Object.freeze({
  // Trailing (corazón): el más ajustado que deja correr (mejor MAR del barrido) + bandas alrededor.
  trailingMults: Object.freeze({ TR: 3.0, TN: 3.5, TA: 4.5 }),
  concentrationT: 5,     // temperatura softmax (menor = más concentrado)
  cap: 0.20,             // tope blando por nombre (§8: protege overfit del ganador histórico)
  floorPct: 5,           // suelo ejecutable: por debajo → 0% (§4.2)
  riskOffInvest: 0.35,   // colchón de caja: en risk-off (SPY<EMA200) invierte solo 35%
  badge: 21,             // fiabilidad honesta cross-régimen (0-100), del backtest blindado
  oos: Object.freeze({ cagr: 20.3, maxDD: 22.9, mar: 0.89, winPos: 53, beatsSpy: "3/6" }),
});

function emaOf(vals, p) {
  const k = 2 / (p + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

// R² del ajuste lineal sobre log-precios (60 sesiones): mide lo "limpia" (recta) que es la tendencia.
function r2Log(closes) {
  const n = closes.length;
  if (n < 10) return 0;
  const ys = closes.map((c) => Math.log(c));
  const xs = ys.map((_, i) => i);
  const mx = avg(xs), my = avg(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return 0;
  return (sxy * sxy) / (sxx * syy);
}

/**
 * Features de SALUD de tendencia (point-in-time, pullback-agnóstico).
 * spyBars (opcional): para Relative Strength vs benchmark; si falta, rs60 cae a momentum absoluto.
 */
export function computeFable01Features(bars, spyBars = null) {
  if (!Array.isArray(bars) || bars.length < 230) return null;
  const closes = bars.map((b) => b.close).filter(isNum);
  if (closes.length < 230) return null;
  const last = closes.at(-1);
  if (!isNum(last) || last <= 0) return null;
  // Anti-glitch: última vela desviada >40% de la mediana de las 5 previas → descartar.
  const recent5 = closes.slice(-6, -1).slice().sort((a, b) => a - b);
  const med = recent5[Math.floor(recent5.length / 2)];
  if (isNum(med) && med > 0 && Math.abs(last / med - 1) > 0.40) return null;

  const e20 = emaOf(closes.slice(-30), 20);
  const e50 = emaOf(closes.slice(-60), 50);
  const e200 = emaOf(closes.slice(-220), 200);
  const e20p = emaOf(closes.slice(-35, -5), 20);
  const ret60 = closes.at(-61) > 0 ? last / closes.at(-61) - 1 : 0;
  // RS vs SPY (momentum relativo a 60 sesiones)
  let spyRet60 = 0;
  if (Array.isArray(spyBars) && spyBars.length >= 61) {
    const sc = spyBars.map((b) => b.close).filter(isNum);
    if (sc.length >= 61 && sc.at(-61) > 0) spyRet60 = sc.at(-1) / sc.at(-61) - 1;
  }
  const trs = [];
  for (let i = bars.length - 14; i < bars.length; i++) {
    const b = bars[i], pb = bars[i - 1];
    if (!isNum(b?.high) || !isNum(b?.low) || !isNum(pb?.close)) continue;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pb.close), Math.abs(b.low - pb.close)));
  }
  const atr14 = avg(trs);
  const last60 = closes.slice(-60);
  const upDays = last60.filter((c, i, a) => i > 0 && c > a[i - 1]).length / 59;
  // RVOL: volumen reciente (5) vs media 60 (confirmación)
  const vols = bars.slice(-60).map((b) => b.volume).filter((v) => isNum(v) && v > 0);
  const vRecent = avg(bars.slice(-5).map((b) => b.volume).filter((v) => isNum(v) && v > 0));
  const rvol = vols.length && avg(vols) > 0 ? vRecent / avg(vols) : 1;

  return {
    align: (last > e20 ? 1 : 0) + (e20 > e50 ? 1 : 0) + (e50 > e200 ? 1 : 0),
    slope20: e20p !== 0 ? e20 / e20p - 1 : 0,
    upDays,
    r2: r2Log(last60),
    rs60: ret60 - spyRet60,
    ret60,
    rvol: isNum(rvol) ? rvol : 1,
    distMA20: e20 !== 0 ? last / e20 - 1 : 0, // sobreextensión: para damping, NO filtro
    atrPct: isNum(atr14) && atr14 > 0 ? atr14 / last : null,
    close: last,
    prevClose: closes.at(-2) ?? null,
  };
}

/**
 * Elegibilidad + score de SALUD de tendencia 0-100 (ABSOLUTO, pullback-agnóstico).
 * elegible = uptrend mínimo (align>=2, pendiente>0). SIN filtro de sobreextensión (§2).
 */
export function scoreFable01(ft) {
  if (!ft || !isNum(ft.atrPct)) return null;
  if (!(ft.align >= 2 && ft.slope20 > 0)) return null;
  const comp = 0.18 * squash(ft.slope20, 0.04) + 0.30 * squash(ft.rs60, 0.15)
    + 0.12 * ft.upDays + 0.15 * ft.r2 + 0.15 * squash(ft.ret60, 0.30)
    + 0.10 * Math.min(ft.rvol, 2) / 2;
  const alignBonus = ft.align === 3 ? 0.06 : 0;
  const score = Math.min(100, 100 * (comp + alignBonus));
  return { score: Math.round(score * 100) / 100 };
}

/** Banda de trailing por ticker (volatilidad + continuidad): limpio+poco volátil → TR; ruidoso → TA. */
export function assignBand(ft) {
  const v = ft.atrPct ?? 0.03;
  if (v < 0.025 && ft.r2 > 0.65) return "TR";          // tendencia limpia y poco volátil → ajustado
  if (v > 0.045 || ft.r2 < 0.40) return "TA";          // volátil o ruidosa → ampliado
  return "TN";                                          // intermedio → normal
}

/** Mantiene los N mejores candidatos al fusionar batches del loop de scan. */
export function mergeFable01(a, b, n = 15) {
  return [...(a ?? []), ...(b ?? [])].sort((x, y) => y.score - x.score).slice(0, n);
}

/**
 * Asignación de capital BLINDADA (§7+§8) sobre el top-10:
 *   softmax(score/T) → damping de sobreextensión → tope blando 20% → suelo 5% (→0) → normaliza a 100%.
 *   deploymentPct = 100% en risk-on; 35% en risk-off (SPY<EMA200), resto en caja.
 * Devuelve pesos (suman 100, weak=0) + deploymentPct + régimen.
 */
export function allocateFable01(scored, { regimeRiskOn = true } = {}, cal = FABLE01_CALIBRATION) {
  const top = (scored ?? []).slice(0, 10);
  if (top.length === 0) return { weights: [], deploymentPct: 0, regimeRiskOn };
  const T = cal.concentrationT;
  let w = top.map((c) => Math.exp(c.score / T));
  // damping de sobreextensión (no elimina, reduce): cuanto más por encima de MA20, menos peso
  w = w.map((x, k) => x / (1 + 4 * Math.max(0, (top[k].ft?.distMA20 ?? 0) - 0.05)));
  // tope blando por nombre (iterativo) + renormaliza
  for (let it = 0; it < 4; it++) {
    const s = w.reduce((a, b) => a + b, 0) || 1; w = w.map((x) => x / s);
    w = w.map((x) => Math.min(x, cal.cap));
  }
  let s = w.reduce((a, b) => a + b, 0) || 1; w = w.map((x) => x / s);
  // suelo ejecutable: por debajo de floorPct → 0, renormaliza
  w = w.map((x) => (x * 100 < cal.floorPct ? 0 : x));
  s = w.reduce((a, b) => a + b, 0) || 1; w = w.map((x) => x / s);
  const deploymentPct = regimeRiskOn ? 100 : Math.round(cal.riskOffInvest * 100);
  return { weights: w, deploymentPct, regimeRiskOn };
}
