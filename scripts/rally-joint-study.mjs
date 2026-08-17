/**
 * RALLY — ESTUDIO 6: AUDITORÍA CONJUNTA DE INTERACCIONES ALREDEDOR DE C0
 * ======================================================================
 * MOTIVO: las piezas de C0 se optimizaron SECUENCIALMENTE (los stops H4 se
 * eligieron en agosto con pesos por convicción, ANTES de existir los pesos
 * M9_RAW; los pesos se eligieron después con los stops ya fijos). Este estudio
 * audita si alguna pieza cambiaría de ganador ahora que las demás están en su
 * valor final — grid one-factor-at-a-time (OFAT) alrededor de C0 + las celdas
 * cruzadas que el TRAIN sugiera prometedoras (nunca el producto cartesiano ciego).
 *
 * C0 (producción 17-ago-2026, cada pieza ya validada por separado):
 *   top-10 · revisión ~84 sesiones · stop trailing por ticker
 *   clamp(12+0,35·runwayScore, 15, 45)% fijado a la entrada y RE-FIJADO en cada
 *   revisión, evaluado a cierres diarios · al saltar el stop, rotación al mejor
 *   por 0,7·score+0,3·recorrido (sin exigir IDEAL) y el sustituto HEREDA el peso
 *   de la posición vendida · pesos M9_RAW: w_i = clamp(max(1,m9_i)·t, 4%, 20%)
 *   con t único tal que Σ=100 (capNormalize exacto) · costes 20 pb/lado.
 *
 * EJES DEL GRID (todos bajo pesos M9_RAW salvo indicación):
 *   1. STOPS×PESOS  — H4 (C0), fijo 30%, fijo 35%, pendiente 0,25 / 0,45,
 *                     clamp alternativo [18,40]. Pregunta: ¿cambia el ganador de
 *                     stops ahora que el capital se concentra en momentum alto?
 *   2. TOP-N        — 8, 10, 12, 15 con DOS convenciones de topes documentadas:
 *                     · PROP: [4·(10/N), 20·(10/N)]% — mantiene la concentración
 *                       RELATIVA de C0 (techo = 2× peso plano, suelo = 0,4×):
 *                       aísla el efecto N a concentración relativa constante.
 *                     · FIX:  [4,20]% donde es factible (N·4 ≤ 100 ≤ N·20; lo es
 *                       para 8/12/15) — mantiene la concentración ABSOLUTA por
 *                       nombre de C0 (a N alto permite MÁS concentración relativa,
 *                       techo/plano = 20/6,7 = 3× en N=15).
 *   3. CADENCIA     — revisión 63, 84, 105. Como la cadencia es aquí TRATAMIENTO
 *                     (no dimensión de robustez), cada config de cadencia recibe
 *                     su PROPIA malla 9 celdas: 3 fases × 3 jitter (R−5, R, R+5),
 *                     construcción idéntica para 63/84/105 → comparación limpia.
 *   4. ROTACIÓN     — mezcla del salto 0,5/0,5 · 0,7/0,3 (C0) · 0,9/0,1
 *                     score/recorrido; y peso del sustituto: HEREDAR (C0) vs
 *                     RECALC_M9 = clamp(max(1,m9_sustituto(día del salto))·t_últ,
 *                     4, 20) con t_últ = el factor de la última revisión (la
 *                     renormalización es implícita: el simulador reparte por
 *                     pesos relativos). Sin lookahead: t viene del pasado.
 *   5. INTERACCIONES— tras el OFAT, si ≥2 ejes mejoran a C0 POR TRAIN, se corren
 *                     los combos de los ganadores (pares del top-3 + triple);
 *                     además las interacciones STOP×CADENCIA y N×CADENCIA se leen
 *                     gratis de las columnas de cada malla.
 *
 * PROTOCOLO (idéntico a rally-weighting-study.mjs): señales sobre cierre
 * ajustado, split train 2017-08→2021-12 vs CONFIRMACIÓN 2022-01→2026-08,
 * malla 9 celdas por variante, métricas CAGR/MaxDD/MAR por tramo de la misma
 * curva, peor-celda = mín de las 9 CAGR de confirmación (y de train).
 *
 * GATE PRE-REGISTRADO para cambiar C0 (por eje o combinación), vs su referencia
 * de la MISMA construcción de malla (C0 estándar; CAD_84 para el eje cadencia):
 *   1) CAGR de confirmación (celda canónica) MAYOR  Y  peor-celda confirmación MAYOR
 *   2) mejora MATERIAL: ΔCAGR ≥ +2 pp  O  ΔMAR ≥ +0,08
 *   3) MaxDD de confirmación ≤ referencia + 5 pp
 *   4) entre los que pasan, la recomendación se elige POR TRAIN (peor-celda
 *      train, desempate CAGR train canónica) — nunca por el test.
 * PARSIMONIA por defecto: si nada pasa → CERTIFICAR_ACTUAL (C0 ya está validado;
 * cambiar sin dominancia es churn).
 *
 * LIMITACIONES DECLARADAS (honestidad):
 *   · Universo superviviente (603 tickers de HOY, 10 años): niveles absolutos
 *     inflados; SOLO valen comparaciones relativas entre variantes.
 *   · Pesos fijos entre revisiones (rebalanceo diario implícito al objetivo);
 *     coste de revisión por rotación de nombres — idéntico entre variantes.
 *   · El coste del salto se carga sobre el peso vendido también en RECALC_M9
 *     (diferencia de 2º orden a 20 pb).
 *   · El eje CADENCIA usa mallas jitter ±5 (construcción distinta de la malla
 *     estándar 63/84/105 de los demás ejes; ambas son 9 celdas y cada gate
 *     compara SIEMPRE mallas de la misma construcción).
 *   · La dispersión entre celdas de una misma variante es grande (ruido
 *     fase×cadencia): se reporta sd de celdas por variante — leer los Δ con eso.
 *   · Herencia de M9_RAW: el exceso vs conviction se concentra en mega-trends
 *     2024-26 (WDC/MU/PLTR ~80%); las comparaciones AQUÍ son todas bajo M9_RAW,
 *     así que ese sesgo afecta por igual a todas las variantes.
 *
 * Determinista, sin aleatoriedad, sin lookahead. Salida: backtests/rally-joint-study.json
 *
 * ⚠ RESULTADO (17-ago-2026, leer junto a verify-joint-cadence.mjs): el gate
 * mecánico lo pasó SOLO la familia CAD_63 (cadencia 63) y sus combos; la
 * verificación adversarial pre-registrada (P1-P5, ensemble de 10 fases, 2
 * niveles de coste) la REFUTÓ — P1 6/10 fases y P2 +1,9 pp < 2 pp: ruido de
 * alineación de fechas, mismo patrón test-brillante/train-flojo que el fijo-20%
 * rechazado en round2. VEREDICTO FINAL: CERTIFICAR_ACTUAL (C0 intacto). El campo
 * veredictoFinal del JSON lo escribe verify-joint-cadence.mjs; si se re-ejecuta
 * este estudio, re-ejecutar después el verificador para reconstruirlo.
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, buyHolds, scoreV4, runwayScore,
  convictionWeights, isNum, clamp, f1, mean, sd,
} from "./rally-study-lib.mjs";

const t0 = Date.now();
console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D, spyClose } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones)`);
console.log(`Split train/confirmación: índice ${SPLIT} = ${dates[SPLIT]}\n`);

// ─── piezas replicadas de producción ─────────────────────────────────────────
const stopFns = {
  S_H4: { desc: "clamp(12+0,35·runway, 15, 45)% — C0", fn: (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45) / 100 },
  S_FIJO30: { desc: "fijo 30%", fn: () => 0.30 },
  S_FIJO35: { desc: "fijo 35%", fn: () => 0.35 },
  S_P025: { desc: "clamp(12+0,25·runway, 15, 45)% — pendiente suave", fn: (f) => clamp(12 + 0.25 * runwayScore(f), 15, 45) / 100 },
  S_P045: { desc: "clamp(12+0,45·runway, 15, 45)% — pendiente fuerte", fn: (f) => clamp(12 + 0.45 * runwayScore(f), 15, 45) / 100 },
  S_C1840: { desc: "clamp(12+0,35·runway, 18, 40)% — banda estrecha", fn: (f) => clamp(12 + 0.35 * runwayScore(f), 18, 40) / 100 },
};
// mezclas del salto con CONSTANTES LITERALES (0,7/0,3 debe ser bit-idéntico a producción)
const jumpFns = {
  MIX50: (i, heldSet) => bestBy(i, heldSet, (s, rw) => 0.5 * s + 0.5 * rw),
  MIX70: (i, heldSet) => bestBy(i, heldSet, (s, rw) => 0.7 * s + 0.3 * rw),
  MIX90: (i, heldSet) => bestBy(i, heldSet, (s, rw) => 0.9 * s + 0.1 * rw),
};
function bestBy(i, heldSet, mixFn) {
  let bi = null, bv = -Infinity;
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s == null) continue;
    const v = mixFn(s, runwayScore(f));
    if (v > bv) { bv = v; bi = ti; }
  }
  return bi;
}

// capNormalize EXACTO (réplica bit a bit de rally-weighting-study.mjs) + factor t
function capNormalizeT(raw, lo = 4, hi = 20) {
  const n = raw.length;
  if (!n) return { ws: [], t: null };
  const w = raw.map((v) => (isNum(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return { ws: w.map((v) => Math.min(hi, Math.max(lo, v * t))), t };
}

// ─── métricas por tramo (idéntico a rally-weighting-study.mjs) ───────────────
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

// ─── una variante = config completa + su malla 9 celdas ──────────────────────
// cfg: { stop, topN, lo, hi, mix, recalc, review } — review solo si la cadencia
// es el tratamiento (malla jitter); si no, malla estándar 63/84/105 canónica 84.
const PHASES = [260, 280, 300];
const STD_REVIEWS = [63, 84, 105];
const jitterOf = (R) => [R - 5, R, R + 5];

function runCell(cfg, FROM, review) {
  let lastT = null;
  const weightsOf = (top) => {
    const { ws, t } = capNormalizeT(top.map((c) => Math.max(1, c.f.m9 ?? 1)), cfg.lo, cfg.hi);
    lastT = t;
    const sum = ws.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 1e-6) throw new Error(`pesos no suman 100 (${sum})`);
    return ws;
  };
  const jumpWeightOf = cfg.recalc
    ? (rep, i, h) => {
        const f = T[rep].feat[i];
        if (!isNum(lastT) || !f) return h.w;
        return clamp(Math.max(1, f.m9 ?? 1) * lastT, cfg.lo, cfg.hi);
      }
    : null;
  const r = simulate(T, D, {
    FROM, review, topN: cfg.topN, conviction: true,
    widthOf: stopFns[cfg.stop].fn, pickJump: jumpFns[cfg.mix], weightsOf, jumpWeightOf,
  });
  return {
    FROM, review,
    train: segMetrics(r.curve, FROM, SPLIT),
    confirm: segMetrics(r.curve, SPLIT, TO),
    full: segMetrics(r.curve, FROM, TO),
    sim: r,
  };
}

function runVariant(v) {
  const reviews = v.cfg.review ? jitterOf(v.cfg.review) : STD_REVIEWS;
  const canonReview = v.cfg.review ?? 84;
  const cells = [];
  let canon = null, canonCurve = null;
  for (const FROM of PHASES) for (const review of reviews) {
    const c = runCell(v.cfg, FROM, review);
    cells.push({ FROM, review, train: c.train, confirm: c.confirm, full: c.full });
    if (FROM === 260 && review === canonReview) {
      const years = (TO - FROM) / 252;
      const r = c.sim;
      canon = {
        train: c.train, confirm: c.confirm, full: c.full,
        tradesYr: r.trades / years, jumps: r.jumpCount,
        winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open),
      };
      canonCurve = r.curve;
    }
  }
  const trC = cells.map((c) => c.train.cagr), cfC = cells.map((c) => c.confirm.cagr);
  const sorted = [...cfC].sort((a, b) => a - b);
  return {
    ...v, cells, canon, canonCurve,
    worstTrain: Math.min(...trC), worstConfirm: Math.min(...cfC),
    medianConfirm: sorted[4], sdCellsConfirm: sd(cfC), sdCellsTrain: sd(trC),
    malla: v.cfg.review ? `3 fases × jitter ${reviews.join("/")}` : `3 fases × cadencias ${STD_REVIEWS.join("/")}`,
  };
}

const C0_CFG = { stop: "S_H4", topN: 10, lo: 4, hi: 20, mix: "MIX70", recalc: false, review: null };

// ─── CONTROL DE REGRESIÓN (obligatorio antes de leer nada) ───────────────────
// 1) C0 por la maquinaria de ESTE estudio ≡ M9_RAW guardado en
//    backtests/rally-weighting-study.json (canónica y las 9 celdas, <1e-9).
// 2) La ruta por defecto del lib (conviction, sin weightsOf/jumpWeightOf) ≡
//    ACTUAL guardado — verifica que el cambio aditivo jumpWeightOf no tocó nada.
const REF = JSON.parse(fs.readFileSync("backtests/rally-weighting-study.json", "utf8"));
const refM9 = REF.esquemas.find((e) => e.name === "M9_RAW");
const refACT = REF.esquemas.find((e) => e.name === "ACTUAL");
const C0 = runVariant({ name: "C0", axis: "BASE", formula: "producción 17-ago-2026 (M9_RAW+H4+top10+rev84+mezcla70/30+heredar)", cfg: C0_CFG });
{
  const close = (a, b, w) => { if (Math.abs(a - b) > 1e-9) throw new Error(`REGRESIÓN ${w}: ${a} ≠ ${b}`); };
  close(C0.canon.confirm.cagr, refM9.canon.confirm.cagr, "canon confirm CAGR");
  close(C0.canon.train.cagr, refM9.canon.train.cagr, "canon train CAGR");
  close(C0.canon.full.cagr, refM9.canon.full.cagr, "canon full CAGR");
  close(C0.canon.confirm.mdd, refM9.canon.confirm.mdd, "canon confirm MaxDD");
  for (const rc of refM9.cells) {
    const mc = C0.cells.find((c) => c.FROM === rc.FROM && c.review === rc.review);
    close(mc.train.cagr, rc.train.cagr, `celda ${rc.FROM}/${rc.review} train`);
    close(mc.confirm.cagr, rc.confirm.cagr, `celda ${rc.FROM}/${rc.review} confirm`);
  }
  // ruta por defecto del lib intacta (ACTUAL conviction, canónica)
  const a = simulate(T, D, { FROM: 260, review: 84, conviction: true, widthOf: stopFns.S_H4.fn, pickJump: jumpFns.MIX70 });
  const act = segMetrics(a.curve, SPLIT, TO);
  close(act.cagr, refACT.canon.confirm.cagr, "ACTUAL conviction confirm CAGR");
  console.log("CONTROL DE REGRESIÓN: C0 ≡ M9_RAW guardado (canónica + 9 celdas) y ruta conviction del lib intacta tras el cambio aditivo jumpWeightOf. OK\n");
}

// ─── OFAT: definición de variantes por eje ───────────────────────────────────
const VARIANTS = [
  // Eje 1 — STOPS bajo M9_RAW
  { name: "ST_FIJO30", axis: "STOPS", formula: "stop fijo 30% (resto C0)", cfg: { ...C0_CFG, stop: "S_FIJO30" } },
  { name: "ST_FIJO35", axis: "STOPS", formula: "stop fijo 35% (resto C0)", cfg: { ...C0_CFG, stop: "S_FIJO35" } },
  { name: "ST_P025", axis: "STOPS", formula: "clamp(12+0,25·rw,15,45)% (resto C0)", cfg: { ...C0_CFG, stop: "S_P025" } },
  { name: "ST_P045", axis: "STOPS", formula: "clamp(12+0,45·rw,15,45)% (resto C0)", cfg: { ...C0_CFG, stop: "S_P045" } },
  { name: "ST_C1840", axis: "STOPS", formula: "clamp(12+0,35·rw,18,40)% (resto C0)", cfg: { ...C0_CFG, stop: "S_C1840" } },
  // Eje 2 — TOP-N bajo M9_RAW (dos convenciones de topes, ambas documentadas)
  { name: "N8_PROP", axis: "TOPN", formula: "top-8, caps [5, 25]% = [4,20]·10/8 (concentración relativa de C0)", cfg: { ...C0_CFG, topN: 8, lo: 5, hi: 25 } },
  { name: "N12_PROP", axis: "TOPN", formula: "top-12, caps [3,33, 16,67]% = [4,20]·10/12", cfg: { ...C0_CFG, topN: 12, lo: 40 / 12, hi: 200 / 12 } },
  { name: "N15_PROP", axis: "TOPN", formula: "top-15, caps [2,67, 13,33]% = [4,20]·10/15", cfg: { ...C0_CFG, topN: 15, lo: 40 / 15, hi: 200 / 15 } },
  { name: "N8_FIX", axis: "TOPN", formula: "top-8, caps [4, 20]% absolutos (factible: 32≤100≤160)", cfg: { ...C0_CFG, topN: 8 } },
  { name: "N12_FIX", axis: "TOPN", formula: "top-12, caps [4, 20]% absolutos (factible: 48≤100≤240)", cfg: { ...C0_CFG, topN: 12 } },
  { name: "N15_FIX", axis: "TOPN", formula: "top-15, caps [4, 20]% absolutos (factible: 60≤100≤300)", cfg: { ...C0_CFG, topN: 15 } },
  // Eje 4 — ROTACIÓN: mezcla del salto y peso del sustituto
  { name: "ROT_MIX50", axis: "ROT_MEZCLA", formula: "salto por 0,5·score+0,5·recorrido (resto C0)", cfg: { ...C0_CFG, mix: "MIX50" } },
  { name: "ROT_MIX90", axis: "ROT_MEZCLA", formula: "salto por 0,9·score+0,1·recorrido (resto C0)", cfg: { ...C0_CFG, mix: "MIX90" } },
  { name: "ROT_RECALC", axis: "ROT_PESO", formula: "sustituto con peso M9 recalculado el día del salto: clamp(max(1,m9)·t_última_revisión, 4, 20), renorm implícita (resto C0)", cfg: { ...C0_CFG, recalc: true } },
];
// Eje 3 — CADENCIA como tratamiento: malla propia 3 fases × jitter ±5
const CAD_VARIANTS = [
  { name: "CAD_63", axis: "CADENCIA", formula: "revisión 63 sesiones (malla jitter 58/63/68; resto C0)", cfg: { ...C0_CFG, review: 63 } },
  { name: "CAD_84", axis: "CADENCIA_REF", formula: "revisión 84 (C0) con malla jitter 79/84/89 — referencia del eje cadencia", cfg: { ...C0_CFG, review: 84 } },
  { name: "CAD_105", axis: "CADENCIA", formula: "revisión 105 sesiones (malla jitter 100/105/110; resto C0)", cfg: { ...C0_CFG, review: 105 } },
];

console.log("═══ OFAT — malla 9 celdas por variante (train 17-21 ‖ CONFIRMACIÓN 22-26; celda canónica fase 260 · rev 84 o R propia) ═══");
const HDR = ["Variante".padEnd(12), "eje".padEnd(11), "‖ trCAGR".padStart(9), "trPEOR".padStart(8), "‖ cfCAGR".padStart(9), "cfMaxDD".padStart(8), "cfMAR".padStart(6), "cfPEOR".padStart(8), "cfMED".padStart(8), "sdCf".padStart(6), "ops/a".padStart(6)].join(" ");
console.log(HDR);
const printRow = (r) => console.log([r.name.padEnd(12), r.axis.padEnd(11), f1(r.canon.train.cagr).padStart(9), f1(r.worstTrain).padStart(8),
  f1(r.canon.confirm.cagr).padStart(9), f1(r.canon.confirm.mdd).padStart(8), r.canon.confirm.mar.toFixed(2).padStart(6),
  f1(r.worstConfirm).padStart(8), f1(r.medianConfirm).padStart(8), f1(r.sdCellsConfirm).padStart(6), r.canon.tradesYr.toFixed(0).padStart(6)].join(" "));

printRow(C0);
const results = { C0 };
for (const v of VARIANTS) { const r = runVariant(v); results[r.name] = r; printRow(r); }
const cadResults = {};
for (const v of CAD_VARIANTS) { const r = runVariant(v); cadResults[r.name] = r; results[r.name] = r; printRow(r); }
// consistencia interna: la canónica de CAD_84 es la MISMA sim que la de C0
{
  const d = Math.abs(cadResults.CAD_84.canon.confirm.cagr - C0.canon.confirm.cagr);
  if (d > 0) throw new Error(`CAD_84 canónica ≠ C0 canónica (Δ ${d})`);
}

// ─── GATE pre-registrado (cada variante vs la referencia de SU construcción) ──
function gateRow(r, ref) {
  const dCagr = r.canon.confirm.cagr - ref.canon.confirm.cagr;
  const dMar = r.canon.confirm.mar - ref.canon.confirm.mar;
  const dMdd = r.canon.confirm.mdd - ref.canon.confirm.mdd;
  const dWorst = r.worstConfirm - ref.worstConfirm;
  const beats = dCagr > 0 && dWorst > 0;
  const material = dCagr >= 0.02 || dMar >= 0.08;
  const mddOK = dMdd <= 0.05;
  const pass = beats && material && mddOK;
  const dWorstTrain = r.worstTrain - ref.worstTrain;
  const dCanonTrain = r.canon.train.cagr - ref.canon.train.cagr;
  const trainPrefiereRef = dWorstTrain < 0 && dCanonTrain < 0;
  return { variante: r.name, eje: r.axis, ref: ref.name, dCagr, dMar, dMdd, dWorst, dWorstTrain, dCanonTrain, beats, material, mddOK, pass, trainPrefiereRef };
}
const refOf = (r) => (r.cfg.review ? cadResults.CAD_84 : C0);

console.log(`\n═══ GATE vs referencia — confirmación 2022-26 (C0: CAGR ${f1(C0.canon.confirm.cagr)} · MaxDD ${f1(C0.canon.confirm.mdd)} · MAR ${C0.canon.confirm.mar.toFixed(2)} · peor-celda ${f1(C0.worstConfirm)} ‖ CAD_84 jitter: peor-celda ${f1(cadResults.CAD_84.worstConfirm)}) ═══`);
console.log(["Variante".padEnd(12), "ref".padEnd(7), "ΔCAGR".padStart(8), "ΔMAR".padStart(7), "ΔMaxDD".padStart(8), "Δpeor".padStart(8), "ΔpeorTr".padStart(9), "ΔcanTr".padStart(8), "bate2".padStart(6), "mat".padStart(5), "MddOK".padStart(6), "GATE".padStart(7)].join(" "));
const gateTable = [];
for (const r of Object.values(results)) {
  if (r.name === "C0" || r.name === "CAD_84") continue;
  const g = gateRow(r, refOf(r));
  gateTable.push(g);
  console.log([g.variante.padEnd(12), g.ref.padEnd(7), f1(g.dCagr).padStart(8), g.dMar.toFixed(2).padStart(7), f1(g.dMdd).padStart(8), f1(g.dWorst).padStart(8),
    f1(g.dWorstTrain).padStart(9), f1(g.dCanonTrain).padStart(8),
    (g.beats ? "sí" : "no").padStart(6), (g.material ? "sí" : "no").padStart(5), (g.mddOK ? "sí" : "no").padStart(6), (g.pass ? "✅PASA" : "—").padStart(7)].join(" "));
}

// ─── INTERACCIONES leídas gratis de las mallas: X × CADENCIA ─────────────────
// mín sobre fases a cadencia fija (columnas de la malla estándar) por variante.
const colMin = (r, review, seg) => Math.min(...r.cells.filter((c) => c.review === review).map((c) => c[seg].cagr));
const interCadencia = [];
console.log("\nINTERACCIÓN variante × cadencia (mín sobre 3 fases de la CAGR; malla estándar):");
console.log(["Variante".padEnd(12), "tr@63".padStart(7), "tr@84".padStart(7), "tr@105".padStart(7), "‖ cf@63".padStart(8), "cf@84".padStart(7), "cf@105".padStart(7)].join(" "));
for (const r of Object.values(results)) {
  if (r.cfg.review) continue; // las de cadencia tienen malla jitter, no estas columnas
  const row = { variante: r.name };
  for (const rev of STD_REVIEWS) { row[`tr${rev}`] = colMin(r, rev, "train"); row[`cf${rev}`] = colMin(r, rev, "confirm"); }
  interCadencia.push(row);
  console.log([r.name.padEnd(12), f1(row.tr63).padStart(7), f1(row.tr84).padStart(7), f1(row.tr105).padStart(7), f1(row.cf63).padStart(8), f1(row.cf84).padStart(7), f1(row.cf105).padStart(7)].join(" "));
}

// ─── ¿Cambia el ganador de stops bajo M9_RAW? (pregunta explícita del eje 1) ──
const stopFamily = ["C0", "ST_FIJO30", "ST_FIJO35", "ST_P025", "ST_P045", "ST_C1840"];
const stopOrderTrain = stopFamily.map((n) => results[n])
  .sort((a, b) => (b.worstTrain - a.worstTrain) || (b.canon.train.cagr - a.canon.train.cagr))
  .map((r) => r.name);
console.log(`\nEJE 1 — ganador de stops POR TRAIN bajo M9_RAW: ${stopOrderTrain.join(" > ")}`);
console.log(`  (histórico: bajo pesos por convicción ganó H4 por walk-forward — rally-adaptive-stop-round2)`);

// ─── selección por eje POR TRAIN + combos de interacción ─────────────────────
const byTrain = (a, b) => (b.worstTrain - a.worstTrain) || (b.canon.train.cagr - a.canon.train.cagr);
const AXES = {
  STOPS: { ref: "C0", members: ["ST_FIJO30", "ST_FIJO35", "ST_P025", "ST_P045", "ST_C1840"] },
  TOPN: { ref: "C0", members: ["N8_PROP", "N12_PROP", "N15_PROP", "N8_FIX", "N12_FIX", "N15_FIX"] },
  ROT_MEZCLA: { ref: "C0", members: ["ROT_MIX50", "ROT_MIX90"] },
  ROT_PESO: { ref: "C0", members: ["ROT_RECALC"] },
  CADENCIA: { ref: "CAD_84", members: ["CAD_63", "CAD_105"] },
};
const promising = [];
console.log("\nGANADOR POR TRAIN de cada eje (criterio pre-registrado: peor-celda train, desempate CAGR train canónica):");
for (const [axis, { ref, members }] of Object.entries(AXES)) {
  const pool = [results[ref], ...members.map((n) => results[n])].sort(byTrain);
  const win = pool[0];
  const isRef = win.name === ref || (axis === "CADENCIA" && win.name === "CAD_84");
  const gain = win.worstTrain - results[ref].worstTrain;
  console.log(`  ${axis.padEnd(11)} → ${win.name}${isRef ? " (la referencia: C0 gana su eje)" : ` (ΔpeorTrain ${f1(gain)} vs ref)`}`);
  if (!isRef) promising.push({ axis, name: win.name, gain, gainCanon: win.canon.train.cagr - results[ref].canon.train.cagr });
}
promising.sort((a, b) => (b.gain - a.gain) || (b.gainCanon - a.gainCanon));

// combos: pares del top-3 de ejes prometedores + triple si hay ≥3 (elegidos por TRAIN, sin mirar test)
const comboResults = {};
if (promising.length >= 2) {
  const topAxes = promising.slice(0, 3);
  const pairs = [];
  for (let i = 0; i < topAxes.length; i++) for (let j = i + 1; j < topAxes.length; j++) pairs.push([topAxes[i], topAxes[j]]);
  if (topAxes.length === 3) pairs.push(topAxes);
  for (const combo of pairs) {
    const parts = combo.map((c) => c.name);
    const name = `COMBO_${parts.join("+")}`;
    const cfg = { ...C0_CFG };
    for (const p of combo) Object.assign(cfg, comboPatch(p.name));
    const r = runVariant({ name, axis: "COMBO", formula: `cruce por train de ${parts.join(" y ")}`, cfg });
    comboResults[name] = r; results[name] = r;
    printRow(r);
    const g = gateRow(r, cfg.review ? cadResults.CAD_84 : C0);
    gateTable.push(g);
    console.log(`   gate ${name}: ΔCAGR ${f1(g.dCagr)} · Δpeor ${f1(g.dWorst)} · ΔMaxDD ${f1(g.dMdd)} → ${g.pass ? "✅ PASA" : "no pasa"}`);
  }
} else {
  console.log(`\nCombos de interacción: ${promising.length === 1 ? `solo 1 eje prometedor por train (${promising[0].name}) — sin cruce que explorar` : "ningún eje mejora a C0 por train — no hay interacción prometedora que cruzar (no se explora el producto cartesiano a ciegas)"}`);
}
function comboPatch(name) {
  const v = results[name];
  const p = {};
  for (const k of ["stop", "topN", "lo", "hi", "mix", "recalc", "review"]) if (JSON.stringify(v.cfg[k]) !== JSON.stringify(C0_CFG[k])) p[k] = v.cfg[k];
  return p;
}

// ─── SENSIBILIDAD DE C0: ¿meseta o pico? ─────────────────────────────────────
console.log("\n═══ SENSIBILIDAD DE C0 (vecinos OFAT por eje, CAGR confirmación canónica ‖ train canónica) ═══");
const sensibilidad = [];
for (const [axis, { ref, members }] of Object.entries(AXES)) {
  const refR = results[ref];
  const neigh = members.map((n) => results[n]);
  const cfDeltas = neigh.map((r) => r.canon.confirm.cagr - refR.canon.confirm.cagr);
  const trDeltas = neigh.map((r) => r.canon.train.cagr - refR.canon.train.cagr);
  const within3 = cfDeltas.filter((d) => Math.abs(d) <= 0.03).length;
  const allBelow3 = cfDeltas.every((d) => d <= -0.03);
  const lectura = allBelow3 ? "PICO (todos los vecinos ≥3 pp por debajo — sospechoso)" : within3 > 0 ? "meseta (≥1 vecino a ±3 pp)" : "vecinos por ENCIMA (C0 no es el máximo del eje)";
  sensibilidad.push({
    eje: axis, referencia: ref,
    vecinos: neigh.map((r) => ({ name: r.name, cfCagr: r.canon.confirm.cagr, trCagr: r.canon.train.cagr, cfPeor: r.worstConfirm })),
    dCfMin: Math.min(...cfDeltas), dCfMax: Math.max(...cfDeltas), dTrMin: Math.min(...trDeltas), dTrMax: Math.max(...trDeltas),
    vecinosDentroDe3pp: within3, lectura,
  });
  console.log(`  ${axis.padEnd(11)} Δcf vecinos [${f1(Math.min(...cfDeltas))}, ${f1(Math.max(...cfDeltas))}] · Δtr [${f1(Math.min(...trDeltas))}, ${f1(Math.max(...trDeltas))}] → ${lectura}`);
}

// ─── veredicto final (pre-registrado) ────────────────────────────────────────
const passers = gateTable.filter((g) => g.pass).map((g) => g.variante);
const passersByTrain = passers.map((n) => results[n]).sort(byTrain).map((r) => r.name);
let verdict, recomendado = null;
if (!passers.length) verdict = "CERTIFICAR_ACTUAL";
else {
  recomendado = passersByTrain[0];
  verdict = results[recomendado].axis === "COMBO" ? "CAMBIAR_CONFIG" : "CAMBIO_PARCIAL";
}
const mejorEnConfirm = passers.length ? passers.map((n) => results[n]).sort((a, b) => b.canon.confirm.cagr - a.canon.confirm.cagr)[0].name : null;
console.log(`\nPassers del gate: ${passers.length ? passers.join(", ") : "NINGUNO"}`);
if (passers.length) console.log(`Orden por TRAIN entre passers: ${passersByTrain.join(" > ")} (el mejor en confirmación fue ${mejorEnConfirm} — no decide)`);
console.log(`VEREDICTO: ${verdict}${recomendado ? ` → ${recomendado}` : " — C0 se queda como está (parsimonia: cambiar sin dominancia es churn)"}`);

// ─── benchmarks + año a año ──────────────────────────────────────────────────
const benchmarks = {};
{
  const bh = buyHolds(T, D, spyClose, 260);
  for (const [k, v] of Object.entries({ spy: bh.spy, universoEqW: bh.universe })) {
    benchmarks[k] = { train: segMetrics(v.curve, 260, SPLIT), confirm: segMetrics(v.curve, SPLIT, TO), full: segMetrics(v.curve, 260, TO) };
  }
  console.log(`\nBuy&hold SPY: confirmación ${f1(benchmarks.spy.confirm.cagr)} · universo eq-w ${f1(benchmarks.universoEqW.confirm.cagr)} (⚠ sesgo supervivencia)`);
}
const porAno = [];
{
  const SHOW = ["C0", ...(recomendado && recomendado !== "C0" ? [recomendado] : []), ...(passers.filter((p) => p !== recomendado).slice(0, 2))];
  const years = [];
  for (let y = 2018; y <= 2026; y++) {
    const a = dates.findIndex((d) => d >= `${y}-01-01`);
    const b = y < 2026 ? dates.findIndex((d) => d >= `${y + 1}-01-01`) - 1 : TO;
    if (a > 260 && b > a) years.push({ y, a, b });
  }
  if (SHOW.length > 1) {
    console.log("\nAÑO A AÑO (celda canónica de cada una):");
    console.log(["Año".padEnd(6), ...SHOW.map((s) => s.slice(0, 15).padStart(16))].join(" "));
    for (const { y, a, b } of years) {
      const row = { ano: y };
      for (const n of SHOW) { const c = results[n].canonCurve; row[n] = c[b] / c[a] - 1; }
      porAno.push(row);
      console.log([String(y).padEnd(6), ...SHOW.map((n) => f1(row[n]).padStart(16))].join(" "));
    }
    for (const n of SHOW.slice(1)) console.log(`  ${n}: bate a C0 en ${porAno.filter((r) => r[n] > r.C0).length}/${porAno.length} años naturales`);
  }
}

// ─── perfil analítico de las familias de stop (documentación, sin sim) ───────
// stop% en función del runwayScore — deja a la vista que S_P025/S_P045 cambian
// pendiente Y nivel medio (no son prueba pura de pendiente; cautela declarada).
const stopProfile = {};
for (const [k, s] of Object.entries(stopFns)) {
  stopProfile[k] = {
    desc: s.desc,
    enRunway: Object.fromEntries([30, 50, 75, 95].map((rw) => {
      const pct = k === "S_FIJO30" ? 30 : k === "S_FIJO35" ? 35 :
        k === "S_P025" ? clamp(12 + 0.25 * rw, 15, 45) : k === "S_P045" ? clamp(12 + 0.45 * rw, 15, 45) :
        k === "S_C1840" ? clamp(12 + 0.35 * rw, 18, 40) : clamp(12 + 0.35 * rw, 15, 45);
      return [rw, Math.round(pct * 10) / 10];
    })),
  };
}

// ─── salida JSON ─────────────────────────────────────────────────────────────
const strip = ({ name, axis, formula, malla, cells, canon, worstTrain, worstConfirm, medianConfirm, sdCellsConfirm, sdCellsTrain, cfg }) =>
  ({ name, axis, formula, malla, cfg: { ...cfg }, worstTrain, worstConfirm, medianConfirm, sdCellsConfirm, sdCellsTrain, canon, cells });
const OUT = {
  ranAt: new Date().toISOString(),
  objeto: "Auditoría CONJUNTA de interacciones alrededor de C0 (las piezas se optimizaron secuencialmente; aquí se re-testa cada eje con las demás piezas en su valor final + cruces sugeridos por train)",
  c0: strip(C0),
  metodologia: {
    señales: "cierre ajustado (convención de producción), rasgos rich",
    split: { indice: SPLIT, fecha: dates[SPLIT], train: `${dates[260]} → ${dates[SPLIT]}`, confirmacion: `${dates[SPLIT]} → ${dates[TO]}` },
    mallas: {
      estandar: "3 fases (260/280/300) × 3 cadencias (63/84/105), canónica (260, 84) — ejes STOPS/TOPN/ROTACIÓN",
      cadencia: "3 fases × jitter (R−5, R, R+5), canónica (260, R) — el eje CADENCIA no puede usar la cadencia como dimensión de robustez de sí misma; construcción idéntica para 63/84/105 y su referencia CAD_84",
    },
    gate: "vs referencia de la MISMA construcción, todo en CONFIRMACIÓN: CAGR canónica > Y peor-celda > · material (ΔCAGR ≥ 2 pp O ΔMAR ≥ 0,08) · ΔMaxDD ≤ +5 pp · elegido POR TRAIN entre los que pasan (peor-celda train, desempate CAGR train canónica). Por defecto: CERTIFICAR_ACTUAL (parsimonia)",
    combos: "solo cruces de ganadores POR TRAIN de ejes que mejoran a su referencia por train (pares del top-3 + triple); nunca producto cartesiano a ciegas",
    costes: "20 pb por lado; el salto carga venta+compra sobre el peso vendido",
  },
  topesTopN: {
    decision: "se prueban AMBAS convenciones y cada una entra al gate por separado",
    PROP: "[4,20]·(10/N)% — techo = 2× peso plano y suelo = 0,4× constantes: aísla el efecto N a concentración RELATIVA constante (la comparación limpia del tamaño de cartera)",
    FIX: "[4,20]% absolutos (factibles para 8/12/15) — mantiene la concentración ABSOLUTA por nombre; en N=15 el techo pasa a ser 3× el peso plano (más concentración relativa), en N=8 1,6× (menos)",
  },
  perfilStops: stopProfile,
  variantes: Object.values(results).filter((r) => r.name !== "C0").map(strip),
  gateTable,
  interacciones: {
    stopsBajoM9RAW: {
      pregunta: "¿cambia el ganador de stops ahora que el capital está concentrado en momentum alto?",
      ordenPorTrain: stopOrderTrain,
      ganador: stopOrderTrain[0],
      historico: "bajo pesos por convicción ganó H4 (walk-forward, rally-adaptive-stop-round2); fijo30 era el suelo de robustez",
      respuesta: stopOrderTrain[0] === "C0" ? "NO cambia: H4 sigue ganando por train bajo M9_RAW" : `SÍ cambia por train: ${stopOrderTrain[0]} supera a H4 bajo M9_RAW (ver gate para si además pasa en confirmación)`,
    },
    variantePorCadencia: interCadencia,
    ejesPrometedoresPorTrain: promising,
    combosProbados: Object.keys(comboResults),
  },
  sensibilidadC0: {
    porEje: sensibilidad,
    lectura: sensibilidad.every((s) => !s.lectura.startsWith("PICO"))
      ? "C0 está en MESETA en todos los ejes (ningún eje lo muestra como pico aislado) — óptimo robusto"
      : `OJO: pico en ${sensibilidad.filter((s) => s.lectura.startsWith("PICO")).map((s) => s.eje).join(", ")} — sospechoso de sobreajuste en ese eje`,
  },
  benchmarks, porAno,
  cautelas: [
    "Universo superviviente (603 tickers de hoy): niveles absolutos inflados; SOLO comparaciones relativas entre variantes",
    "Pesos fijos entre revisiones (rebalanceo diario implícito al objetivo); coste por rotación de nombres — idéntico entre variantes",
    "RECALC_M9: el coste del salto se sigue cargando sobre el peso vendido (diferencia de 2º orden a 20 pb); la renormalización es implícita por pesos relativos",
    "Eje CADENCIA con malla jitter ±5 (construcción distinta de la estándar; los gates comparan siempre mallas de la misma construcción; la canónica de CAD_84 es la MISMA sim que la de C0)",
    "Ruido fase×cadencia grande: sd de celdas por variante reportada (sdCellsConfirm) — Δ pequeños frente a esa sd no son señal",
    "Todas las variantes heredan el sesgo mega-trend de M9_RAW (WDC/MU/PLTR ~80% del exceso 2024-26) — afecta por igual, no distorsiona lo relativo",
    "El gate exige batir en confirmación pero la ELECCIÓN entre passers es por train; si un passer tiene trainPrefiereRef=true su ventaja es solo-confirmación y huele a suerte de test — se reporta el flag",
    "Stops evaluados a cierres diarios (una orden trailing intradía saltaría más a menudo)",
    "S_P025/S_P045 cambian pendiente Y nivel medio del stop (ver perfilStops): no son una prueba pura de pendiente",
  ],
  veredicto: {
    verdict, recomendado, mejorEnConfirmacion: mejorEnConfirm, passers, passersOrdenTrain: passersByTrain,
    criterioEleccion: "gate pre-registrado en confirmación; entre los que pasan, mejor por TRAIN (peor-celda, desempate CAGR canónica train); sin passers → CERTIFICAR_ACTUAL",
  },
};
fs.writeFileSync("backtests/rally-joint-study.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-joint-study.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
