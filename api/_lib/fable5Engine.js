/**
 * FABLE 5 — motor independiente: top-10 de TENDENCIA ALCISTA LIMPIA sin pullback inminente.
 * ==========================================================================================
 * Calibrado por LOOP doble (scripts/calibrate-fable5.mjs, 5 años walk-forward, train/test OOS):
 *  LOOP 1 (señal): ganó "tendencia pura" (alineación P>EMA20>EMA50>EMA200 + pendiente positiva,
 *    score = pendiente + limpieza R² + consistencia + cercanía a máximos 52s) @ 20 sesiones:
 *    top-10 ret 2.96% vs 0.85% universo (α +2.10pp), win 58% (590 muestras OOS).
 *    Hallazgo: filtros anti-sobreextensión ESTRICTOS restan ~1pp (el momentum fuerte continúa);
 *    se aplica solo guarda anti-blowoff EXTREMA (RSI14<80, ret5<15%, distMA20<12%) para excluir
 *    el pullback inminente sin matar el edge.
 *  LOOP 2 (trailing): barrido de múltiplos ATR en las salidas históricas de los picks:
 *    ajustado 3×ATR (ret salida 2.40%) · normal 4×ATR (2.55%) · ampliado 5×ATR (2.84%).
 *
 * Módulo independiente: no toca ningún otro motor; se alimenta de las MISMAS barras del scan.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export const FABLE5_CALIBRATION = Object.freeze({
  horizonSessions: 20,
  // OOS de la config DESPLEGADA (T7, validada en el script): las guardas anti-pullback cuestan
  // ~0.5pp vs tendencia pura (2.41% vs 2.96%) — peaje aceptado por requisito del usuario.
  oos: Object.freeze({ ret: 2.41, alpha: 1.56, win: 57 }),
  trailingMults: Object.freeze({ ajustado: 3.0, normal: 4.0, ampliado: 5.0 }),
  // guarda anti-blowoff (pullback inminente): solo extremos — el loop demostró que filtros
  // estrictos restan retorno.
  guards: Object.freeze({ maxRsi14: 80, maxRet5: 0.15, maxDistMA20: 0.12 }),
});

function emaOf(vals, p) {
  const k = 2 / (p + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

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

/** Features FABLE 5 desde las barras del ticker (point-in-time, última barra). */
export function computeFable5Features(bars) {
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
  const win = bars.slice(-260);
  const highs = win.map((b) => b.high).filter(isNum);
  const hi252 = highs.length ? Math.max(...highs) : last;
  const trs = [];
  for (let i = bars.length - 14; i < bars.length; i++) {
    const b = bars[i], pb = bars[i - 1];
    if (!isNum(b?.high) || !isNum(b?.low) || !isNum(pb?.close)) continue;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pb.close), Math.abs(b.low - pb.close)));
  }
  const atr14 = avg(trs);
  const last60 = closes.slice(-60);
  const upDays = last60.filter((c, i, a) => i > 0 && c > a[i - 1]).length / 59;

  return {
    slope20: e20p !== 0 ? e20 / e20p - 1 : 0,
    align: (last > e20 ? 1 : 0) + (e20 > e50 ? 1 : 0) + (e50 > e200 ? 1 : 0),
    r2: r2Log(last60),
    upDays,
    dist52H: last / hi252 - 1,
    distMA20: e20 !== 0 ? last / e20 - 1 : 0,
    rsi14: rsiOf(closes, 14),
    ret5: last / closes.at(-6) - 1,
    atrPct: isNum(atr14) && atr14 > 0 ? atr14 / last : null,
    close: last,
    prevClose: closes.at(-2) ?? null,
  };
}

/**
 * Elegibilidad + score FABLE 5 (config ganadora del loop):
 * elegible = uptrend completo (align 3, pendiente >0) y SIN blowoff extremo (pullback inminente).
 * score = pendiente×50 + limpieza R²×2 + consistencia + cercanía a máximos×2.
 */
export function scoreFable5(ft, cal = FABLE5_CALIBRATION) {
  if (!ft || !isNum(ft.atrPct)) return null;
  const g = cal.guards;
  const eligible = ft.align === 3 && ft.slope20 > 0
    && ft.rsi14 < g.maxRsi14 && ft.ret5 < g.maxRet5 && ft.distMA20 < g.maxDistMA20;
  if (!eligible) return null;
  const score = ft.slope20 * 50 + ft.r2 * 2 + ft.upDays + Math.max(-0.3, ft.dist52H) * 2;
  return { score: Math.round(score * 1000) / 1000 };
}

/** Mantiene los N mejores candidatos al fusionar batches del loop de scan. */
export function mergeFable5(a, b, n = 15) {
  return [...(a ?? []), ...(b ?? [])].sort((x, y) => y.score - x.score).slice(0, n);
}
