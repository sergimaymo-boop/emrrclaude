/**
 * RALLY-TEST — MOTOR PROPIO "LAB-M189" v1.0 (mandato de Sergi, 2-sep-2026)
 * ========================================================================
 * Este archivo YA NO es la copia del motor de producción. Por mandato expreso,
 * Rally-Test lleva un motor de análisis diseñado en el laboratorio con una sola
 * premisa: máxima rentabilidad esperada del top-10, con un cálculo DISTINTO del
 * de Rally Leaders (momentum 9m + stops H4 + pesos M9_RAW), del de Supreme
 * (dual momentum top-2 + régimen) y del SP500 (timing de índice).
 *
 * FÓRMULA GANADORA (elegida por walk-forward en scripts/rally-test-engine-study2.mjs,
 * config M189s10·K5·SCORE·R42 — elegida por TRAIN 2017-21 sobre ensemble de 10
 * fases, confirmada en 2022-26 sin re-elegir; resultados en
 * backtests/rally-test-engine-study2.json y -50bp.json):
 *   · SEÑAL  : momentum de 189 sesiones SALTANDO las últimas 10 (m = P[t-10]/P[t-199] − 1,
 *              cierres ajustados). El salto de 10 sesiones esquiva la reversión
 *              de muy corto plazo y los picos de evento (lección MRNA 19-ago).
 *   · SCORE  : 50 + 50·tanh((m − 0,75)/0,75), redondeado a entero. Escala FIJA
 *              por ticker (sin normalización cruzada): 75% a 9 meses = 50 puntos,
 *              +150% ≈ 82, saturación ≈ 100. Elegible solo con m > 0.
 *   · CARTERA: top-10 mostrado; INVERTIDOS los 5 primeros con pesos proporcionales
 *              al score (topes 10-40%, Σ=100); los puestos 6-10 son RESERVA (0%).
 *   · RITMO  : rebalanceo sugerido cada ~42 sesiones (≈2 meses), SIN stops
 *              intradía — la salida es por caerse del top en el siguiente scan.
 * Backtest (2016-2026, 603 tickers supervivientes, 20 pb/lado, ensemble 10 fases):
 * confirmación 2022-26 media 64,1% CAGR · peor fase 53,6%
 * (referencia C0 producción en los mismos datos: 53,3% · 43,7%).
 * A 50 pb/lado: 61,4% · 51,1% (C0: 51,2% · 41,5%).
 *
 * ⚠ ACTA DE LA AUDITORÍA ADVERSARIAL (2-sep-2026, obligatoria de leer):
 * mecánica LIMPIA (sin lookahead — sobrevive a lag de ejecución de +1 día —,
 * costes de dos patas correctos, bit-reproducible), pero el edge nominal de
 * +10,8 pp NO es del motor: es de la CONCENTRACIÓN K=5 — a igual tamaño de
 * libro (K=10) este motor pierde contra C0 en 64/64 configs. Riesgo real
 * des-ventaneado: peor fase −42,9% pico-valle; año 2022 −34,5% (C0: −18,7%).
 * Esperanza honesta tras descuentos (supervivencia + fuga de diseño del 2º
 * asalto): +2 a +4 pp/año comprando más drawdown. PROHIBIDO proponerlo para
 * producción sin estudio con gates pre-registrados y commiteados (§10c).
 * ⚠ Universo superviviente: niveles inflados, solo comparaciones relativas.
 *
 * Métricas informativas emitidas (NO participan en el score): calidad de
 * tendencia (pendiente×R² 126d), momentum 63d, volatilidad 126d anualizada,
 * mayor movimiento diario del último mes (aviso de evento binario).
 *
 * Rally Leaders NO usa este archivo. Producción intacta (§10e).
 */

export const RALLY_ENGINE_VERSION = "LABM189-1.0";

const MOM_W = 189;          // ventana de momentum (sesiones)
const MOM_SKIP = 10;        // salto: se ignoran las últimas 10 sesiones en la señal
const MIN_BARS = MOM_W + MOM_SKIP + 1;   // 200
const TQ_W = 126;
const VOL_W = 126;
const K_INVERTIDOS = 5;     // los que llevan peso; 6-10 = reserva
const W_LO = 10, W_HI = 40; // topes de peso del top-5 (Σ=100)
export const MIN_SCORE = 12; // score mínimo (≈ momentum apenas > 0)

const squash = (x, c, w) => 50 + 50 * Math.tanh((x - c) / w);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);

export function getRallyLabel(score) {
  if (score >= 85) return { label: "TENDENCIA ÉLITE", color: "#10b981" };
  if (score >= 70) return { label: "TENDENCIA FUERTE", color: "#34d399" };
  if (score >= 50) return { label: "TENDENCIA SÓLIDA", color: "#f59e0b" };
  return { label: "EN RADAR", color: "#94a3b8" };
}

/**
 * Puntúa UN ticker con la fórmula LAB-M189. Firma compatible con el batch
 * processor (bars del proveedor con cierres AJUSTADOS; spyBars se acepta y se
 * ignora — esta señal no es relativa al índice).
 */
export function calculateRallyScore({ bars, spyBars = [], spreadPercent = null, region = "USA" }) {
  void spyBars; void spreadPercent; void region;
  if (!Array.isArray(bars) || bars.length < MIN_BARS) {
    return { ok: false, reason: `NEED_${MIN_BARS}_BARS` };
  }
  const closes = bars.map((b) => b?.close).filter(isNum);
  if (closes.length < MIN_BARS) return { ok: false, reason: "BAD_BARS" };

  const n = closes.length;
  const pNow = closes[n - 1];
  const pSig = closes[n - 1 - MOM_SKIP];
  const pBase = closes[n - 1 - MOM_SKIP - MOM_W];
  if (!isNum(pSig) || !isNum(pBase) || pBase <= 0 || pNow <= 0) return { ok: false, reason: "BAD_BARS" };

  const mom = pSig / pBase - 1;                       // la SEÑAL
  if (mom <= 0) return { ok: false, reason: "NO_POSITIVE_TREND" };
  const score = Math.round(squash(mom, 0.75, 0.75));

  // ── métricas informativas (no puntúan) ──
  const rets = [];
  for (let i = n - VOL_W; i < n; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  const mRet = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const vol126 = Math.sqrt(rets.reduce((s, x) => s + (x - mRet) ** 2, 0) / (rets.length || 1)) * Math.sqrt(252);

  const p63 = closes[n - 64];
  const mom63 = isNum(p63) && p63 > 0 ? pNow / p63 - 1 : null;

  let tq = null, r2 = null;
  {
    const ys = [], xs = [];
    for (let i = n - TQ_W; i < n; i++) if (closes[i] > 0) { ys.push(Math.log(closes[i])); xs.push(i); }
    const m2 = ys.length;
    if (m2 >= TQ_W * 0.7) {
      const mx = xs.reduce((s, x) => s + x, 0) / m2, my = ys.reduce((s, x) => s + x, 0) / m2;
      let sxy = 0, sxx = 0, syy = 0;
      for (let k = 0; k < m2; k++) { const dx = xs[k] - mx, dy = ys[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      if (sxx > 0 && syy > 0) { r2 = (sxy * sxy) / (sxx * syy); tq = (sxy / sxx) * 252 * r2; }
    }
  }

  let maxDay21 = 0;
  for (let i = n - 21; i < n; i++) {
    if (closes[i - 1] > 0) maxDay21 = Math.max(maxDay21, Math.abs(closes[i] / closes[i - 1] - 1));
  }

  const warningFlags = [];
  if (maxDay21 > 0.20) warningFlags.push({
    code: "JUMP_EVENT",
    label: `Movimiento de evento (${(maxDay21 * 100).toFixed(0)}% en un día este mes) — la señal salta las últimas 10 sesiones, pero un salto binario puede revertir`,
  });
  if (vol126 > 0.60) warningFlags.push({
    code: "HIGH_VOL",
    label: `Volatilidad muy alta (${(vol126 * 100).toFixed(0)}% anualizada) — posición de mayor riesgo`,
  });

  const prev = closes[n - 2];
  const { label, color } = getRallyLabel(score);
  return {
    ok: true,
    rallyScore: score,
    label, color,
    trailingStop: null,                 // este motor NO usa stops — salida por rebalanceo
    warningFlags,
    entryTiming: null,
    runway: null,
    metrics: {
      lastClose: Math.round(pNow * 100) / 100,
      dayChangePct: isNum(prev) && prev > 0 ? round1((pNow / prev - 1) * 100) : null,
      momRaw: round1(mom * 100),        // % de la señal 189s10 — desempate del merge
      mom63: mom63 != null ? round1(mom63 * 100) : null,
      vol126: round1(vol126 * 100),
      tq: tq != null ? Math.round(tq * 100) / 100 : null,
      r2: r2 != null ? Math.round(r2 * 100) / 100 : null,
      maxDay21: round1(maxDay21 * 100),
      version: RALLY_ENGINE_VERSION,
    },
  };
}

/**
 * Pesos sugeridos: SOLO los 5 primeros invierten — proporcionales a
 * (score − 40) con topes [10,40] y Σ=100 (bisección determinista, la misma
 * mecánica de normalización que usa la casa). Puestos 6-10: 0% (RESERVA — son
 * los sustitutos naturales del próximo rebalanceo). Orden: score desc,
 * desempate por la señal cruda (el score satura en 100).
 */
export function assignSuggestedWeights(assets) {
  const list = [...(assets ?? [])].sort(
    (a, b) => (b.rallyScore ?? 0) - (a.rallyScore ?? 0) || (b.metrics?.momRaw ?? 0) - (a.metrics?.momRaw ?? 0)
  );
  const inv = list.slice(0, K_INVERTIDOS);
  const raw = inv.map((a) => Math.max(1, (a.rallyScore ?? 0) - 40));
  let ws = [];
  if (inv.length) {
    if (inv.length * W_LO > 100 || inv.length * W_HI < 100) {
      ws = inv.map(() => 100 / inv.length);          // infactible con topes → equiponderado
    } else {
      const f = (t) => raw.reduce((s, v) => s + Math.min(W_HI, Math.max(W_LO, v * t)), 0);
      let a = 1e-9, b = 1e9;
      for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
      const t = Math.sqrt(a * b);
      ws = raw.map((v) => Math.min(W_HI, Math.max(W_LO, v * t)));
    }
  }
  return list.map((a, i) => ({
    ...a,
    rank: i + 1,
    suggestedWeightPct: i < inv.length ? Math.round(ws[i] * 10) / 10 : 0,
  }));
}
