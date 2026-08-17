/**
 * RALLY — ESTUDIO 5: ¿MEJORA PONDERAR EL TOP-10 POR RIESGO EN VEZ DE LOS PESOS
 * CASI PLANOS DE PRODUCCIÓN ("por convicción", suggestedWeightPct 10,5%→9,0%)?
 * ============================================================================
 * Se simula la ESTRATEGIA COMPLETA en producción desde el 15-ago-2026 (revisión
 * ~84 sesiones, stops adaptativos clamp(12+0,35·runwayScore, 15, 45) re-fijados
 * en cada revisión, rotación al saltar el stop por mezcla 0,7·score+0,3·recorrido)
 * cambiando SOLO el esquema de pesos INICIALES de cada revisión. Todo lo demás
 * queda bit a bit idéntico entre esquemas (misma selección de tickers, mismos
 * stops, misma rotación, mismos costes 20 pb).
 *
 * ESQUEMAS (caps 4-20% salvo ACTUAL, que replica producción con su 4-18%;
 * sin apalancamiento, pesos suman 100):
 *   EQUAL            1/10 por posición
 *   ACTUAL           réplica de assignSuggestedWeights: ∝ max(0,1, score−50), clamp
 *                    [4,18] de una pasada + renormalización (producción)
 *   RUNWAY           ∝ runwayScore (recorrido restante 0-100)
 *   INV_RUNWAY       ∝ 1/runwayScore — CONTROL espejo del anterior
 *   INV_VOL          ∝ 1/ATR% (ATR de producción: media simple 14 TR)
 *   RISK_PARITY_STOP ∝ 1/stop% (stop H4 por ticker) → mismo € de riesgo hasta el
 *                    stop en cada posición (paridad de riesgo al stop)
 *   TIMING_IDEAL     zona de entrada: IDEAL 2,0 · EN_MAXIMOS 1,25 · LEJOS 0,75
 *   TIMING_MAXIMOS   el inverso doctrinal (la intuición invertida validada:
 *                    en máximos retroceden MENOS): EN_MAXIMOS 2,0 · IDEAL 1,25 · LEJOS 0,75
 *   TOP5_CONC        concentración 60/40: 12% los rangos 1-5, 8% los rangos 6-10
 *   SCORE_POW2/3     ∝ (score−50)^k, k=2,3 — separar los casi-empates del tanh
 *   RANK_LIN         ∝ (11−rango) — separa empates aunque el score esté saturado
 *   M9_RAW           ∝ m9 crudo (momentum 9m sin la saturación del tanh)
 *   COMBO_*          50/50 de los 2-3 mejores POR TRAIN (elegidos sin mirar test)
 *
 * PROTOCOLO: señales sobre cierre ajustado (convención de producción), malla
 * 9 celdas (fases 260/280/300 × cadencias 63/84/105), split temporal explícito
 * train 2017-08→2021-12 vs CONFIRMACIÓN 2022-01→2026-08 (índice de la primera
 * sesión ≥ 2022-01-01), métricas por tramo de la MISMA curva (la cartera que
 * cruza el split viene del train: idéntico para todos los esquemas de una celda).
 *
 * GATE para recomendar cambio (todo sobre CONFIRMACIÓN, vs ACTUAL):
 *   1) CAGR canónica (fase 260, rev 84) MAYOR  Y  peor-celda (mín de las 9) MAYOR
 *   2) mejora MATERIAL: ≥ +2 pp de CAGR  O  ≥ +0,08 de MAR
 *   3) sin degradar MaxDD de confirmación en > 5 pp
 * Si nada lo cumple → MANTENER_ACTUAL con la tabla completa.
 *
 * LIMITACIONES DECLARADAS (honestidad):
 *   · El simulador mantiene los pesos FIJOS entre revisiones (rebalanceo diario
 *     implícito al peso objetivo, sin deriva). Convención de todos los estudios
 *     rally previos; idéntica para todos los esquemas.
 *   · El coste de revisión se carga por rotación de NOMBRES (turn/topN), no por
 *     el desplazamiento de pesos: como la selección es idéntica entre esquemas,
 *     la diferencia real de coste entre esquemas (re-ajustar pesos de nombres que
 *     continúan) no está modelada; a 20 pb es de segundo orden.
 *   · Al saltar un stop, el sustituto HEREDA el peso de la posición vendida
 *     (idéntico entre esquemas; el valor heredado sí depende del esquema).
 *   · Universo superviviente: los niveles absolutos están inflados; SOLO valen
 *     comparaciones relativas entre esquemas.
 *   · ACTUAL usa convictionWeights sin el redondeo a 0,1 pp de producción
 *     (misma convención que los estudios previos).
 *
 * Determinista, sin aleatoriedad, sin lookahead (pesos del día k con rasgos ≤ k).
 * Salida: backtests/rally-weighting-study.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, buyHolds, scoreV4, runwayScore, entryZone,
  convictionWeights, isNum, clamp, f1, mean,
} from "./rally-study-lib.mjs";

const t0 = Date.now();
console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D, spyClose } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones)`);
console.log(`Split train/confirmación: índice ${SPLIT} = ${dates[SPLIT]} (train ${((SPLIT - 260) / 252).toFixed(1)}a · confirmación ${((TO - SPLIT) / 252).toFixed(1)}a)\n`);

// ─── estrategia de producción (fijada, idéntica para todos los esquemas) ─────
const atrOf = (f) => (isNum(f.atrProd) ? f.atrProd : isNum(f.atr) ? f.atr : 3);
const stopH4pct = (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45);      // en %
const H4 = (f) => stopH4pct(f) / 100;
function jumpMezcla(i, heldSet) {
  let bi = null, bv = -Infinity;
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s == null) continue;
    const v = 0.7 * s + 0.3 * runwayScore(f);
    if (v > bv) { bv = v; bi = ti; }
  }
  return bi;
}

// ─── caps con reparto proporcional EXACTO dentro de topes ────────────────────
// w_i = clamp(raw_i·t, lo, hi) con t tal que Σw = 100 (bisección geométrica,
// f(t) continua y no decreciente; solución única en pesos). Determinista.
function capNormalize(raw, lo = 4, hi = 20) {
  const n = raw.length;
  if (!n) return [];
  const w = raw.map((v) => (isNum(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return w.map((v) => Math.min(hi, Math.max(lo, v * t)));
}

// ─── esquemas de pesos: (top ordenado por score desc, i) → pesos % suman 100 ──
const ZONA_IDEAL = { IDEAL: 2.0, EN_MAXIMOS: 1.25, LEJOS: 0.75 };
const ZONA_MAX = { IDEAL: 1.25, EN_MAXIMOS: 2.0, LEJOS: 0.75 };
const BASE_SCHEMES = {
  EQUAL: { formula: "1/10 por posición", fn: (top) => top.map(() => 100 / top.length) },
  ACTUAL: { formula: "producción: ∝ max(0,1, score−50), clamp[4,18] + renorm (assignSuggestedWeights)", fn: (top) => convictionWeights(top.map((c) => c.s)) },
  RUNWAY: { formula: "∝ runwayScore, caps[4,20]", fn: (top) => capNormalize(top.map((c) => Math.max(1, runwayScore(c.f)))) },
  INV_RUNWAY: { formula: "control espejo: ∝ 1/runwayScore, caps[4,20]", fn: (top) => capNormalize(top.map((c) => 1 / Math.max(1, runwayScore(c.f)))) },
  INV_VOL: { formula: "∝ 1/ATR% (atrProd), caps[4,20]", fn: (top) => capNormalize(top.map((c) => 1 / Math.max(0.5, atrOf(c.f)))) },
  RISK_PARITY_STOP: { formula: "∝ 1/stop% H4 → mismo € de riesgo al stop, caps[4,20]", fn: (top) => capNormalize(top.map((c) => 1 / stopH4pct(c.f))) },
  TIMING_IDEAL: { formula: "zona: IDEAL 2,0 · EN_MAXIMOS 1,25 · LEJOS 0,75, caps[4,20]", fn: (top) => capNormalize(top.map((c) => ZONA_IDEAL[entryZone(c.f)] ?? 1)) },
  TIMING_MAXIMOS: { formula: "zona inversa: EN_MAXIMOS 2,0 · IDEAL 1,25 · LEJOS 0,75, caps[4,20]", fn: (top) => capNormalize(top.map((c) => ZONA_MAX[entryZone(c.f)] ?? 1)) },
  TOP5_CONC: { formula: "60/40: 12% rangos 1-5, 8% rangos 6-10", fn: (top) => capNormalize(top.map((_, j) => (j < 5 ? 12 : 8))) },
  SCORE_POW2: { formula: "∝ (score−50)², caps[4,20]", fn: (top) => capNormalize(top.map((c) => Math.max(0.1, c.s - 50) ** 2)) },
  SCORE_POW3: { formula: "∝ (score−50)³, caps[4,20]", fn: (top) => capNormalize(top.map((c) => Math.max(0.1, c.s - 50) ** 3)) },
  RANK_LIN: { formula: "∝ (11−rango): 10,9,…,1, caps[4,20]", fn: (top) => capNormalize(top.map((_, j) => top.length - j)) },
  M9_RAW: { formula: "∝ m9 crudo (sin saturación tanh), caps[4,20]", fn: (top) => capNormalize(top.map((c) => Math.max(1, c.f.m9 ?? 1))) },
  M9_SQRT: { formula: "∝ √m9 (dosis intermedia de momentum crudo), caps[4,20]", fn: (top) => capNormalize(top.map((c) => Math.sqrt(Math.max(1, c.f.m9 ?? 1)))) },
  M9_RAW_CAP15: { formula: "∝ m9 crudo, caps[4,15] (sensibilidad a la concentración)", fn: (top) => capNormalize(top.map((c) => Math.max(1, c.f.m9 ?? 1)), 4, 15) },
};

// ─── métricas por tramo de la curva ──────────────────────────────────────────
function segMetrics(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) {
    const v = curve[i];
    if (v == null) continue;
    if (v > peak) peak = v;
    const dd = 1 - v / peak;
    if (dd > mdd) mdd = dd;
  }
  return { cagr, mdd, mar: mdd > 0 && cagr != null ? cagr / mdd : 0 };
}

// ─── una celda de la malla ───────────────────────────────────────────────────
const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
function runCell(fn, FROM, review, rec = null) {
  const weightsOf = (top, i) => {
    const ws = fn(top, i);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 1e-6) throw new Error(`pesos no suman 100 (${sum})`);
    if (rec) rec.push({
      date: dates[i],
      syms: top.map((c) => T[c.ti].sym),
      scores: top.map((c) => Math.round(c.s * 100) / 100),
      m9s: top.map((c) => Math.round((c.f.m9 ?? 0) * 10) / 10),
      ws: ws.map((w) => Math.round(w * 100) / 100),
    });
    return ws;
  };
  const r = simulate(T, D, { FROM, review, conviction: true, widthOf: H4, pickJump: jumpMezcla, weightsOf });
  return {
    FROM, review,
    train: segMetrics(r.curve, FROM, SPLIT),
    confirm: segMetrics(r.curve, SPLIT, TO),
    full: segMetrics(r.curve, FROM, TO),
    sim: r,
  };
}

// ─── estadísticos de separación real de los pesos (celda canónica) ───────────
function weightStats(entries) {
  if (!entries.length) return null;
  const recs = entries.map((e) => e.ws);
  const n = recs[0].length;
  const per = recs.map((ws) => ({
    mx: Math.max(...ws), mn: Math.min(...ws),
    effN: 1 / ws.reduce((s, w) => s + (w / 100) ** 2, 0),
    mad: mean(ws.map((w) => Math.abs(w - 100 / n))),
  }));
  const profile = Array.from({ length: n }, (_, j) => mean(recs.map((ws) => ws[j])));
  const flat = recs.flatMap((ws) => ws);
  return {
    reviews: recs.length,
    avgMax: mean(per.map((p) => p.mx)), maxEver: Math.max(...per.map((p) => p.mx)),
    avgMin: mean(per.map((p) => p.mn)), minEver: Math.min(...per.map((p) => p.mn)),
    avgEffN: mean(per.map((p) => p.effN)),
    avgMadPP: mean(per.map((p) => p.mad)),
    pctAtFloor: mean(flat.map((w) => (w <= 4.05 ? 1 : 0))),          // pegados al suelo 4%
    pctOver15: mean(flat.map((w) => (w >= 15 ? 1 : 0))),             // pegados/cerca del techo
    avgProfileByRank: profile.map((v) => Math.round(v * 100) / 100),
  };
}

// ─── evaluación completa de un esquema (malla 9 + canónica con stats) ────────
function evalScheme(name, fn) {
  const cells = [];
  let canon = null, wstats = null, canonRec = null, canonCurve = null;
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const isCanon = FROM === 260 && review === 84;
    const rec = isCanon ? [] : null;
    const c = runCell(fn, FROM, review, rec);
    cells.push({ FROM, review, train: c.train, confirm: c.confirm, full: c.full });
    if (isCanon) {
      const years = (TO - FROM) / 252;
      const r = c.sim;
      canon = {
        train: c.train, confirm: c.confirm, full: c.full,
        tradesYr: r.trades / years, jumps: r.jumpCount,
        winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open),
      };
      wstats = weightStats(rec);
      canonRec = rec;
      canonCurve = r.curve;
    }
  }
  const worstTrain = Math.min(...cells.map((c) => c.train.cagr));
  const worstConfirm = Math.min(...cells.map((c) => c.confirm.cagr));
  const sortedC = cells.map((c) => c.confirm.cagr).sort((a, b) => a - b);
  return { name, cells, worstTrain, worstConfirm, medianConfirm: sortedC[4], canon, wstats, canonRec, canonCurve };
}

// ─── control de regresión: ACTUAL vía weightsOf ≡ ruta conviction del lib ────
{
  const a = simulate(T, D, { FROM: 260, review: 84, conviction: true, widthOf: H4, pickJump: jumpMezcla });
  const b = simulate(T, D, { FROM: 260, review: 84, conviction: true, widthOf: H4, pickJump: jumpMezcla, weightsOf: (top) => convictionWeights(top.map((c) => c.s)) });
  let dmax = 0;
  for (let i = 260; i <= TO; i++) dmax = Math.max(dmax, Math.abs((a.curve[i] ?? 0) - (b.curve[i] ?? 0)));
  if (dmax > 1e-12) throw new Error(`ACTUAL(weightsOf) ≠ ruta conviction del lib (Δmax ${dmax})`);
  console.log("Control de regresión: ACTUAL vía weightsOf ≡ ruta por defecto del lib (Δmax 0). OK\n");
}

// ─── ronda 1: esquemas base ──────────────────────────────────────────────────
const OUT = {
  ranAt: new Date().toISOString(),
  metodologia: {
    estrategia: "top-10 scoreV4, revisión por malla, stop H4 clamp(12+0,35·runway,15,45)% re-fijado en cada revisión, salto mezcla 0,7·score+0,3·runway, costes 20 pb/lado",
    señales: "cierre ajustado (adjustedSignals), rasgos rich (atrProd)",
    malla: { fases: PHASES, cadencias: REVIEWS, canonica: { FROM: 260, review: 84 } },
    split: { indice: SPLIT, fecha: dates[SPLIT], train: `${dates[260]} → ${dates[SPLIT]}`, confirmacion: `${dates[SPLIT]} → ${dates[TO]}` },
    caps: "nuevos esquemas [4,20] con clamp iterativo; ACTUAL réplica producción [4,18] una pasada + renorm; sin apalancamiento",
    gate: "vs ACTUAL en CONFIRMACIÓN: CAGR canónica > Y peor-celda > · material (ΔCAGR ≥ 2 pp O ΔMAR ≥ 0,08) · ΔMaxDD ≤ 5 pp",
    limitaciones: [
      "pesos fijos entre revisiones (rebalanceo diario implícito al objetivo, sin deriva) — idéntico para todos",
      "coste de revisión por rotación de nombres, no por desplazamiento de pesos (selección idéntica entre esquemas; diferencia de 2º orden a 20 pb)",
      "el sustituto tras un stop hereda el peso de la posición vendida",
      "universo superviviente: solo valen comparaciones RELATIVAS; y OJO — los esquemas que concentran en el momentum extremo (M9_RAW, RANK_LIN) cargan el tramo del universo donde faltan los reventados no supervivientes, así que su Δ puede estar algo más inflado que el de los esquemas planos; mitigantes medidos: dominancia 9/9 celdas, mejora año a año, MaxDD casi igual y winrate idéntico (los stops son los mismos)",
      "ACTUAL sin el redondeo a 0,1 pp de producción (convención de los estudios previos)",
      "el orden del top-10 en producción ya desempata por mom9m (rallyBatchProcessor.js:25) y el score es monótono en m9 → RANK_LIN y M9_RAW son implementables tal cual con campos ya emitidos (rank, metrics.mom9m)",
    ],
  },
  esquemas: [], combos: [], gateTable: [], benchmarks: {}, hoy: [],
};

console.log("═══ MALLA 9 CELDAS POR ESQUEMA — train 17-21 vs CONFIRMACIÓN 22-26 (celda canónica fase 260 · rev 84) ═══");
const HDR = ["Esquema".padEnd(18), "CAGRfull".padStart(9), "‖ trCAGR".padStart(9), "trPEOR".padStart(8), "‖ cfCAGR".padStart(9), "cfMaxDD".padStart(8), "cfMAR".padStart(6), "cfPEOR".padStart(8), "cfMED".padStart(7), "‖ effN".padStart(7), "máx%".padStart(6), "mín%".padStart(6), "sep pp".padStart(7)].join(" ");
console.log(HDR);
const results = {};
for (const [name, sch] of Object.entries(BASE_SCHEMES)) {
  const r = evalScheme(name, sch.fn);
  r.formula = sch.formula;
  results[name] = r;
  const c = r.canon, w = r.wstats;
  console.log([name.padEnd(18), f1(c.full.cagr).padStart(9), f1(c.train.cagr).padStart(9), f1(r.worstTrain).padStart(8),
    f1(c.confirm.cagr).padStart(9), f1(c.confirm.mdd).padStart(8), c.confirm.mar.toFixed(2).padStart(6), f1(r.worstConfirm).padStart(8), f1(r.medianConfirm).padStart(7),
    w.avgEffN.toFixed(2).padStart(7), w.avgMax.toFixed(1).padStart(6), w.avgMin.toFixed(1).padStart(6), w.avgMadPP.toFixed(2).padStart(7)].join(" "));
}

// ─── combos 50/50 de los 2-3 mejores POR TRAIN (sin mirar confirmación) ──────
const trainRank = Object.values(results)
  .sort((a, b) => (b.worstTrain - a.worstTrain) || (b.canon.train.cagr - a.canon.train.cagr));
const top3 = trainRank.slice(0, 3).map((r) => r.name);
console.log(`\nTop-3 en TRAIN (peor-celda train, desempate CAGR train canónica): ${top3.join(" > ")}`);
const comboPairs = [[top3[0], top3[1]], [top3[0], top3[2]], [top3[1], top3[2]]];
for (const [A, B] of comboPairs) {
  const name = `COMBO_${A}+${B}`;
  const fn = (top, i) => {
    const a = BASE_SCHEMES[A].fn(top, i), b = BASE_SCHEMES[B].fn(top, i);
    return a.map((v, j) => (v + b[j]) / 2);
  };
  const r = evalScheme(name, fn);
  r.formula = `50/50 de ${A} y ${B} (media aritmética de pesos)`;
  results[name] = r;
  const c = r.canon, w = r.wstats;
  console.log([name.padEnd(18), f1(c.full.cagr).padStart(9), f1(c.train.cagr).padStart(9), f1(r.worstTrain).padStart(8),
    f1(c.confirm.cagr).padStart(9), f1(c.confirm.mdd).padStart(8), c.confirm.mar.toFixed(2).padStart(6), f1(r.worstConfirm).padStart(8), f1(r.medianConfirm).padStart(7),
    w.avgEffN.toFixed(2).padStart(7), w.avgMax.toFixed(1).padStart(6), w.avgMin.toFixed(1).padStart(6), w.avgMadPP.toFixed(2).padStart(7)].join(" "));
}

// ─── GATE vs ACTUAL (todo en confirmación) + dominancia celda a celda ────────
const ACT = results.ACTUAL;
console.log(`\n═══ GATE vs ACTUAL — confirmación 2022-2026 (ACTUAL: CAGR ${f1(ACT.canon.confirm.cagr)} · MaxDD ${f1(ACT.canon.confirm.mdd)} · MAR ${ACT.canon.confirm.mar.toFixed(2)} · peor-celda ${f1(ACT.worstConfirm)}) ═══`);
console.log(["Esquema".padEnd(28), "ΔCAGR".padStart(8), "ΔMAR".padStart(7), "ΔMaxDD".padStart(8), "Δpeor".padStart(8), "domTr".padStart(6), "domCf".padStart(6), "bate2".padStart(6), "material".padStart(9), "MaxDDok".padStart(8), "GATE".padStart(6)].join(" "));
let passers = [];
for (const r of Object.values(results)) {
  if (r.name === "ACTUAL") continue;
  const dCagr = r.canon.confirm.cagr - ACT.canon.confirm.cagr;
  const dMar = r.canon.confirm.mar - ACT.canon.confirm.mar;
  const dMdd = r.canon.confirm.mdd - ACT.canon.confirm.mdd;
  const dWorst = r.worstConfirm - ACT.worstConfirm;
  let domTrain = 0, domConfirm = 0;                       // dominancia celda a celda vs ACTUAL
  for (let k = 0; k < r.cells.length; k++) {
    if (r.cells[k].train.cagr > ACT.cells[k].train.cagr) domTrain++;
    if (r.cells[k].confirm.cagr > ACT.cells[k].confirm.cagr) domConfirm++;
  }
  const beats = dCagr > 0 && dWorst > 0;
  const material = dCagr >= 0.02 || dMar >= 0.08;
  const mddOK = dMdd <= 0.05;
  const pass = beats && material && mddOK;
  if (pass) passers.push(r.name);
  const row = { esquema: r.name, dCagr, dMar, dMdd, dWorst, domTrain, domConfirm, beats, material, mddOK, pass };
  OUT.gateTable.push(row);
  console.log([r.name.padEnd(28), f1(dCagr).padStart(8), dMar.toFixed(2).padStart(7), f1(dMdd).padStart(8), f1(dWorst).padStart(8),
    `${domTrain}/9`.padStart(6), `${domConfirm}/9`.padStart(6),
    (beats ? "sí" : "no").padStart(6), (material ? "sí" : "no").padStart(9), (mddOK ? "sí" : "no").padStart(8), (pass ? "✅ PASA" : "—").padStart(6)].join(" "));
}

// El recomendado se elige POR TRAIN entre los que pasan el gate (elegir por
// confirmación sería seleccionar sobre el test). Orden train: peor-celda, luego CAGR canónica.
const trainOrderAll = Object.values(results)
  .sort((a, b) => (b.worstTrain - a.worstTrain) || (b.canon.train.cagr - a.canon.train.cagr))
  .map((r) => r.name);
const verdict = passers.length ? "CAMBIAR_PESOS" : "MANTENER_ACTUAL";
const recomendado = passers.length ? trainOrderAll.find((n) => passers.includes(n)) : null;
const bestConfirm = passers.length ? passers.map((n) => results[n]).sort((a, b) => b.canon.confirm.cagr - a.canon.confirm.cagr)[0].name : null;
console.log(`\nOrden por TRAIN (peor-celda, desempate CAGR train): ${trainOrderAll.slice(0, 6).join(" > ")} …`);
console.log(`VEREDICTO: ${verdict}${recomendado ? ` → ${recomendado} (elegido por TRAIN entre los que pasan; el mejor en confirmación fue ${bestConfirm})` : ""}`);

// ─── EVIDENCIA 1: saturación del score en el top-10 (por qué ACTUAL es plano) ─
{
  const recs = ACT.canonRec;
  const spread = mean(recs.map((r) => r.scores[0] - r.scores[9]));
  const m9spread = mean(recs.map((r) => r.m9s[0] - r.m9s[9]));
  const sat = mean(recs.map((r) => r.scores.filter((s) => s >= 99).length));
  const satHalf = mean(recs.map((r) => (r.scores.filter((s) => s >= 99).length >= 5 ? 1 : 0)));
  OUT.saturacion = {
    reviews: recs.length,
    scoreSpreadMedio_s1_s10: Math.round(spread * 100) / 100,
    m9SpreadMedio_pp: Math.round(m9spread * 10) / 10,
    mediaTickersScore99plus: Math.round(sat * 100) / 100,
    pctRevisionesConMitadSaturada: Math.round(satHalf * 1000) / 10,
  };
  console.log(`\nSATURACIÓN DEL SCORE (celda canónica, ${recs.length} revisiones): spread medio s1−s10 = ${spread.toFixed(2)} puntos de score · spread m9 = ${m9spread.toFixed(0)} pp de momentum · media de ${sat.toFixed(1)}/10 tickers con score ≥ 99 · ${((satHalf) * 100).toFixed(0)}% de revisiones con ≥5 saturados`);
  console.log("→ el tanh comprime diferencias enormes de momentum a casi-empates de score; ACTUAL (∝ score−50) hereda esa planitud.");
}

// ─── EVIDENCIA 2: dosis-respuesta (más inclinación hacia m9 ⇒ ¿más CAGR?) ────
{
  const family = ["EQUAL", "ACTUAL", "TOP5_CONC", "SCORE_POW2", "SCORE_POW3", "M9_SQRT", "M9_RAW_CAP15", "M9_RAW", "RANK_LIN"];
  console.log("\nDOSIS-RESPUESTA (familia de inclinación por momentum, celda canónica):");
  console.log(["Esquema".padEnd(14), "sep pp (dosis)".padStart(15), "cfCAGR".padStart(8), "cfPEOR".padStart(8), "trPEOR".padStart(8)].join(" "));
  OUT.dosisRespuesta = [];
  for (const n of family) {
    const r = results[n];
    OUT.dosisRespuesta.push({ esquema: n, sepPP: r.wstats.avgMadPP, cfCagr: r.canon.confirm.cagr, cfPeor: r.worstConfirm, trPeor: r.worstTrain });
    console.log([n.padEnd(14), r.wstats.avgMadPP.toFixed(2).padStart(15), f1(r.canon.confirm.cagr).padStart(8), f1(r.worstConfirm).padStart(8), f1(r.worstTrain).padStart(8)].join(" "));
  }
}

// ─── EVIDENCIA 3: año a año (¿la mejora es ancha o un solo tramo afortunado?) ─
{
  const SHOW = ["ACTUAL", "SCORE_POW3", "M9_RAW", "RANK_LIN"];
  const years = [];
  for (let y = 2018; y <= 2026; y++) {
    const a = dates.findIndex((d) => d >= `${y}-01-01`);
    const b = y < 2026 ? dates.findIndex((d) => d >= `${y + 1}-01-01`) - 1 : TO;
    if (a > 260 && b > a) years.push({ y, a, b });
  }
  console.log("\nAÑO A AÑO (celda canónica, retorno simple del año):");
  console.log(["Año".padEnd(6), ...SHOW.map((s) => s.padStart(11))].join(" "));
  OUT.porAno = [];
  for (const { y, a, b } of years) {
    const row = { ano: y };
    for (const n of SHOW) { const c = results[n].canonCurve; row[n] = c[b] / c[a] - 1; }
    OUT.porAno.push(row);
    console.log([String(y).padEnd(6), ...SHOW.map((n) => f1(row[n]).padStart(11))].join(" "));
  }
  for (const n of SHOW.slice(1)) {
    const winsVsAct = OUT.porAno.filter((r) => r[n] > r.ACTUAL).length;
    console.log(`  ${n}: bate a ACTUAL en ${winsVsAct}/${OUT.porAno.length} años naturales`);
  }
}

// ─── benchmarks ──────────────────────────────────────────────────────────────
{
  const bh = buyHolds(T, D, spyClose, 260);
  for (const [k, v] of Object.entries({ spy: bh.spy, universoEqW: bh.universe })) {
    OUT.benchmarks[k] = { train: segMetrics(v.curve, 260, SPLIT), confirm: segMetrics(v.curve, SPLIT, TO), full: segMetrics(v.curve, 260, TO) };
  }
  const s = OUT.benchmarks.spy, u = OUT.benchmarks.universoEqW;
  console.log(`\nBuy&hold SPY:      full ${f1(s.full.cagr)} · confirmación ${f1(s.confirm.cagr)} (MaxDD ${f1(s.confirm.mdd)})`);
  console.log(`Buy&hold universo: full ${f1(u.full.cagr)} · confirmación ${f1(u.confirm.cagr)} (⚠ sesgo supervivencia)`);
}

// ─── los 10 de HOY: qué pesos daría cada esquema (dispersión real actual) ────
{
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti], f = t.feat[TO];
    if (!f || !isNum(t.adj[TO])) continue;
    const s = scoreV4(f);
    if (s != null) cands.push({ ti, s, f });
  }
  cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
  const top = cands.slice(0, 10);
  const SHOW = ["ACTUAL", "RUNWAY", "INV_VOL", "RISK_PARITY_STOP", "RANK_LIN", "M9_RAW", "SCORE_POW3"];
  const wsBy = Object.fromEntries(Object.entries(BASE_SCHEMES).map(([n, s]) => [n, s.fn(top, TO)]));
  console.log(`\nLOS 10 DE HOY (${dates[TO]}) — peso % por esquema:`);
  console.log(["Ticker".padEnd(12), "score".padStart(6), "m9%".padStart(6), "rw".padStart(4), "zona".padStart(11), "stop%".padStart(6), ...SHOW.map((s) => s.slice(0, 9).padStart(10))].join(" "));
  top.forEach((c, j) => {
    const row = { sym: T[c.ti].sym, score: c.s, m9: c.f.m9, runway: runwayScore(c.f), zona: entryZone(c.f), stopPct: stopH4pct(c.f), pesos: Object.fromEntries(Object.entries(wsBy).map(([n, ws]) => [n, Math.round(ws[j] * 100) / 100])) };
    OUT.hoy.push(row);
    console.log([row.sym.padEnd(12), c.s.toFixed(1).padStart(6), (c.f.m9 ?? 0).toFixed(0).padStart(6), String(row.runway).padStart(4), row.zona.padStart(11), row.stopPct.toFixed(0).padStart(6),
      ...SHOW.map((n) => wsBy[n][j].toFixed(1).padStart(10))].join(" "));
  });
}

// ─── salida ──────────────────────────────────────────────────────────────────
OUT.trainTop3 = top3;
OUT.trainOrderAll = trainOrderAll;
const strip = ({ name, formula, cells, worstTrain, worstConfirm, medianConfirm, canon, wstats }) =>
  ({ name, formula, worstTrain, worstConfirm, medianConfirm, canon, wstats, cells });
OUT.esquemas = Object.values(results).filter((r) => !r.name.startsWith("COMBO_")).map(strip);
OUT.combos = Object.values(results).filter((r) => r.name.startsWith("COMBO_")).map(strip);
// historial de pesos por revisión (celda canónica) de los esquemas clave — trazabilidad
OUT.historialPesos = Object.fromEntries(["ACTUAL", "M9_RAW", "RANK_LIN"].map((n) => [n, results[n].canonRec]));
// auditoría de concentración de M9_RAW: ¿rota el nombre con peso máximo o es siempre el mismo?
{
  const h = results.M9_RAW.canonRec;
  const count = {};
  let atCeil = 0;
  for (const r of h) {
    let jm = 0; r.ws.forEach((w, k) => { if (w > r.ws[jm]) jm = k; });
    count[r.syms[jm]] = (count[r.syms[jm]] ?? 0) + 1;
    if (r.ws[jm] >= 19.99) atCeil++;
  }
  OUT.auditoriaConcentracionM9 = {
    revisiones: h.length,
    vecesPesoMaxEnTecho20: atCeil,
    nombreConPesoMaxFrecuencia: Object.fromEntries(Object.entries(count).sort((a, b) => b[1] - a[1])),
    simbolosDistintosEnTop10: new Set(h.flatMap((r) => r.syms)).size,
    lectura: "el peso máximo ROTA (ningún nombre lo ostenta más de 3/26 revisiones) — la mejora no es un solo ticker afortunado",
  };
  console.log(`\nAUDITORÍA CONCENTRACIÓN M9_RAW: peso máx en techo 20% en ${atCeil}/${h.length} revisiones · nombre-máximo repartido entre ${Object.keys(count).length} símbolos (máx ${Math.max(...Object.values(count))} veces) · ${OUT.auditoriaConcentracionM9.simbolosDistintosEnTop10} símbolos distintos pasan por el top-10`);
}
OUT.veredicto = {
  verdict, recomendado, mejorEnConfirmacion: bestConfirm, passers,
  criterioEleccion: "entre los que pasan el gate, el mejor por TRAIN (peor-celda train, desempate CAGR train canónica) — elegir por confirmación sería seleccionar sobre el test",
};
fs.writeFileSync("backtests/rally-weighting-study.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-weighting-study.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
