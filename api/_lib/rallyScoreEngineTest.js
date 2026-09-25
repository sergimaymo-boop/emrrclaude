/**
 * RALLY-TEST — MOTOR PROPIO "LAB-M189" v1.1 (mandato de Sergi, 2-sep-2026)
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
 *   · RITMO  : rebalanceo sugerido cada ~63 sesiones (≈3 meses).
 *   · RED    : trailing stop del 45% POR POSICIÓN, evaluado a CIERRES, fijado
 *              al pico desde la entrada (v1.1, estudio 3 a petición de Sergi:
 *              "sin stop loss no tienes red"). PROTOCOLO al saltar: re-escanear
 *              y reinvertir TODO según los pesos del scan nuevo (RESCAN2 del
 *              estudio — el reloj del rebalanceo periódico NO se resetea).
 *              El estudio 3 probó anchuras 15-45% y adaptativas: las ceñidas
 *              (15-25%) son whipsaw destructivo (−28% en 2022, 22 saltos/año);
 *              la ancha 45% salta ~0,8 veces/año y es la única que mejora
 *              train, confirm, DD real y 2022 A LA VEZ. En COVID (crash en V)
 *              no protege (−53% vs −50%): un trailing a cierres no esquiva
 *              un desplome de 3 semanas.
 * Backtest v1.1 (2016-2026, 603 tickers supervivientes, 20 pb/lado, ensemble 10
 * fases; scripts/rally-test-engine-study3.mjs, elegido por TRAIN):
 * confirmación 2022-26 media 64,6% CAGR · peor fase 56,1% · DD real pico-valle
 * 38,8% · año 2022 −11,6% (v1.0 sin stops: 64,1% · 53,6% · 42,9% · −16,5%;
 * C0 producción: 53,3% · 43,7% · 36,9% · −12,9%). A 50 pb: 62,3% · 54,0%.
 *
 * ⚠ ACTA DE LA AUDITORÍA ADVERSARIAL del estudio 2 (2-sep-2026, sigue vigente):
 * mecánica LIMPIA (sin lookahead — sobrevive a lag de ejecución de +1 día —,
 * costes de dos patas correctos, bit-reproducible), pero el edge nominal NO es
 * del motor: es de la CONCENTRACIÓN K=5 — a igual tamaño de libro (K=10) este
 * motor pierde contra C0 en 64/64 configs. Esperanza honesta tras descuentos
 * (supervivencia + fuga de diseño del 2º asalto): +2 a +4 pp/año. La v1.1
 * (trailing 45%) MITIGÓ el punto más duro del acta: el año 2022 pasa de −34,5%
 * (v1.0 K5 R42 sin stops... nota: la cifra del acta era de la config R42; la
 * base R63 sin stops hizo −16,5%) a −11,6%, en tablas con C0 (−12,9%); el DD
 * real queda en −38,8% vs −36,9% de C0. El colapso de fases del modo RESCAN
 * original (10 fases → 1 trayectoria) se detectó y se descartó ese modo: la
 * config adoptada (RESCAN2) mantiene 10/10 fases distintas. PROHIBIDO
 * proponerlo para producción sin gates pre-registrados y commiteados (§10c).
 * ⚠ Universo superviviente: niveles inflados, solo comparaciones relativas.
 *
 * Métricas informativas emitidas (NO participan en el score): calidad de
 * tendencia (pendiente×R² 126d), momentum 63d, volatilidad 126d anualizada,
 * mayor movimiento diario del último mes (aviso de evento binario).
 *
 * Rally Leaders NO usa este archivo. Producción intacta (§10e).
 */

export const RALLY_ENGINE_VERSION = "LABM189-1.1";

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

/* ── INDICADORES DE VISUALIZACIÓN (mandato Sergi 7-sep-2026) ──────────────────
 * Paridad INFORMATIVA con Rally Leaders sin tocar el motor: zona de entrada
 * (proximidad al máximo de 52 semanas) y recorrido restante (edad de la
 * tendencia + extensión sobre la media de 50 + cercanía a máximos). Son copias
 * PROPIAS del laboratorio de la lógica de display de producción — el módulo no
 * importa nada de rallyScoreEngine.js. NADA de esto entra en score, selección,
 * pesos ni stop: el trailing de LAB-M189 sigue FIJO en 45% (v1.1) y la cartera
 * top-5 se elige solo por score/momRaw. Si estos campos faltaran, el módulo
 * funcionaría exactamente igual (el panel reserva el hueco).
 * Las referencias "en el estudio" de las etiquetas son los estudios de display
 * a nivel de ticker (entrada: 260 episodios; recorrido: 1.060) — describen el
 * comportamiento del ticker, no la estrategia del laboratorio. */

function computeEntryTimingTest(proximity52w) {
  if (!isNum(proximity52w)) {
    return { score: null, zone: "SIN_DATOS", label: "Sin histórico suficiente para valorar el momento de entrada" };
  }
  if (proximity52w >= 0.96 && proximity52w <= 0.997) {
    return { score: 90, zone: "IDEAL", label: "Cerca de su máximo de 52 semanas sin haberlo tocado — la zona con mejor rentabilidad y menor caída en el estudio" };
  }
  if (proximity52w > 0.997) {
    return { score: 45, zone: "EN_MAXIMOS", label: "En máximos históricos o rompiéndolos ahora mismo — el estudio muestra más riesgo de retroceso a corto plazo" };
  }
  return { score: 55, zone: "LEJOS", label: "Alejado de su máximo de 52 semanas — el estudio muestra menor rentabilidad esperada que la zona ideal" };
}

function computeRunwayTest(price, ema50, trendAge, proximity52w) {
  let score = 50;
  const reasons = [];
  if (isNum(trendAge)) {
    if (trendAge < 40) { score += 25; reasons.push(`Tendencia joven (${trendAge} sesiones sobre su media de 50) — históricamente la que más recorrido deja`); }
    else if (trendAge < 100) { score += 5; reasons.push(`Tendencia de ${trendAge} sesiones — recorrido intermedio`); }
    else { score -= 5; reasons.push(`Tendencia madura (${trendAge} sesiones) — buena parte del recorrido puede estar hecha`); }
  }
  const ext50 = isNum(ema50) && ema50 > 0 && isNum(price) ? (price - ema50) / ema50 : null;
  if (ext50 != null) {
    if (ext50 < 0.05) { score += 20; reasons.push(`Solo un ${(ext50 * 100).toFixed(0)}% sobre su media de 50 — el tramo aún no se ha estirado`); }
    else if (ext50 < 0.15) { score += 5; }
    else if (ext50 > 0.30) { score -= 10; reasons.push(`Un ${(ext50 * 100).toFixed(0)}% por encima de su media de 50 — tramo muy estirado`); }
  }
  if (isNum(proximity52w) && proximity52w > 0.997) {
    score -= 15;
    reasons.push("Justo en máximos de 52 semanas — en el estudio es la peor zona para lo que queda de recorrido");
  }
  score = Math.max(0, Math.min(100, score));
  const level = score >= 75 ? "ALTO" : score >= 55 ? "MEDIO" : "BAJO";
  return { score: Math.round(score), level, trendAge: isNum(trendAge) ? trendAge : null, reasons };
}

/**
 * Puntúa UN ticker con la fórmula LAB-M189. Firma compatible con el batch
 * processor (bars del proveedor con cierres AJUSTADOS; spyBars se acepta y se
 * ignora — esta señal no es relativa al índice).
 */
export function calculateRallyScore({ bars, spyBars = [], spreadPercent = null, region = "USA", gapDates = [], lastBarForming = false }) {
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

  // ── visualización (7-sep-2026): máximo 52s, EMA50 propia y edad de tendencia.
  // Solo alimentan entryTiming/runway/metrics de display — jamás la cartera.
  const look = Math.min(n - 1, 252);
  const high52w = Math.max(...closes.slice(-look));
  const prox52 = high52w > 0 ? pNow / high52w : null;
  // EMA50 con la MISMA convención que producción (emaSeries: semilla = SMA de los
  // primeros 50 cierres, serie desde la barra 50). Auditoría 7-sep-2026: la versión
  // inicial sembraba con el primer cierre y trendAge divergía en tickers de
  // historial corto (~200-250 barras), volteando la zona del recorrido mostrado.
  const ema50Series = new Array(n).fill(null);
  if (n >= 50) {
    const k = 2 / 51;
    let e = 0;
    for (let i = 0; i < 50; i++) e += closes[i];
    e /= 50;
    for (let i = 50; i < n; i++) { e = closes[i] * k + e * (1 - k); ema50Series[i] = e; }
  }
  const ema50 = ema50Series[n - 1];
  let trendAge = 0;
  for (let i = n - 1; i >= 0; i--) {
    const ev = ema50Series[i];
    if (ev == null || closes[i] < ev) break;
    trendAge++;
  }

  const p126 = closes[n - 127];
  const mom126 = isNum(p126) && p126 > 0 ? pNow / p126 - 1 : null;

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
  // ⚠️ GUARDIA DE HUECO DE PROVEEDOR (23-sep-2026, mismo arreglo que rallyScoreEngine.js):
  // `prev` viene del array `closes` ya limpio de nulos — un hueco de sesión real
  // (Yahoo con close=null para todo el mercado un día, visto en vivo el 22-sep-2026)
  // desaparece antes de llegar aquí y "prev" pasa a ser antesdeayer sin avisar.
  // Se cruza contra `gapDates` (fechas recientes reconocidas por el proveedor pero
  // sin rellenar): si hay una entre las dos barras comparadas, dayChangePct es
  // multi-día y se sirve null en vez de una cifra calculada sobre base equivocada.
  const lastBarDate = bars[bars.length - 1]?.date ?? null;
  const prevBarDate = bars[bars.length - 2]?.date ?? null;
  const sessionGapBetween = Array.isArray(gapDates) && prevBarDate && lastBarDate
    ? gapDates.some((d) => d > prevBarDate && d < lastBarDate)
    : false;
  const { label, color } = getRallyLabel(score);
  return {
    ok: true,
    rallyScore: score,
    label, color,
    trailingStop: 45,                   // v1.1: trailing ANCHO a cierres; al saltar → re-scan y reinvertir
    warningFlags,
    // Display (7-sep-2026): mismos indicadores informativos que Rally Leaders,
    // calculados con las copias PROPIAS de arriba. NO tocan la cartera.
    entryTiming: computeEntryTimingTest(prox52),
    runway: computeRunwayTest(pNow, ema50, trendAge, prox52),
    metrics: {
      lastClose: Math.round(pNow * 100) / 100,
      dayChangePct: (!sessionGapBetween && isNum(prev) && prev > 0) ? round1((pNow / prev - 1) * 100) : null,
      // Sesión de lastClose, si sigue abierta (precio intradía, no cierre) y sesiones
      // posteriores que la fuente no rellenó (25-sep-2026). Solo display.
      lastBarDate,
      lastBarForming: lastBarForming === true,
      missingSessions: Array.isArray(gapDates) && lastBarDate ? gapDates.filter((d) => d > lastBarDate) : [],
      momRaw: round1(mom * 100),        // % de la señal 189s10 — desempate del merge
      mom63: mom63 != null ? round1(mom63 * 100) : null,
      mom126: mom126 != null ? round1(mom126 * 100) : null,
      vol126: round1(vol126 * 100),
      tq: tq != null ? Math.round(tq * 100) / 100 : null,
      r2: r2 != null ? Math.round(r2 * 100) / 100 : null,
      maxDay21: round1(maxDay21 * 100),
      prox52w: prox52 != null ? round1(prox52 * 100) : null,   // % del máximo de 52 semanas
      ext50: isNum(ema50) && ema50 > 0 ? round1(((pNow - ema50) / ema50) * 100) : null,
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
  // Redondeo a 0,1 por MAYOR RESTO (25-sep-2026): redondear cada peso por separado
  // hacía que el top-5 sumase 99,9 o 100,1 en ~35% de los casos.
  const decimas = ws.map((w) => Math.floor(w * 10));
  let faltan = Math.round(ws.reduce((s, w) => s + w, 0) * 10) - decimas.reduce((s, d) => s + d, 0);
  ws.map((w, i) => ({ i, resto: w * 10 - decimas[i] }))
    .sort((x, y) => y.resto - x.resto)
    .forEach(({ i }) => { if (faltan > 0) { decimas[i]++; faltan--; } });
  return list.map((a, i) => ({
    ...a,
    rank: i + 1,
    suggestedWeightPct: i < inv.length ? decimas[i] / 10 : 0,
  }));
}
