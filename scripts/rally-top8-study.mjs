/**
 * RALLY — ESTUDIO 7 (PRE-REGISTRADO): TOP-8 CON TOPES [5,25] COMO RETADOR DE C0
 * =============================================================================
 * MOTIVO: la auditoría conjunta (estudio 6, 17-ago) y su re-adjudicación con el
 * ensemble de 10 fases (19-ago, en ambos modos de ejecución) señalaron a
 * "top-8 · topes [5,25]" como el candidato con mejor respaldo del proyecto
 * (10/10 fases, +4,2 a +4,6 pp de media). §10c lo dejó anotado como
 * "candidato futuro nº1 — exige estudio propio pre-registrado". ESTE es ese
 * estudio. Nada de aquí toca producción: si pasa, se propone a Sergi y en todo
 * caso se implementa primero en Rally-Test (§10e).
 *
 * REFERENCIA: C0 = producción (top-10 · [4,20] · H4 · rev 84 · mezcla 70/30 ·
 * heredar peso · M9_RAW). CANDIDATOS:
 *   T8_PROP — topN 8 · topes [5,25] (=[4,20]·10/8: concentración RELATIVA de C0)
 *   T8_FIX  — topN 8 · topes [4,20] (concentración ABSOLUTA por nombre)
 * Todo lo demás BIT A BIT idéntico a C0 (mismos helpers exportados del lib:
 * PRESET_C0 / stopH4pct / pickJumpMix70 / capNormalizeTarget — §10c prohíbe
 * re-tipear fórmulas).
 *
 * ══ GATES PRE-REGISTRADOS (fijados 26-ago-2026 ANTES de ejecutar; si falla
 *    UNO → CERTIFICAR C0, parsimonia) ══
 *  G1 MALLA (3 fases 260/280/300 × cadencias 63/84/105; canónica 260·84):
 *     CAGR confirm canónica > C0  Y  peor-celda confirm > C0.
 *  G2 MATERIALIDAD: ΔCAGR confirm canónica ≥ +2 pp  O  ΔMAR confirm ≥ +0,08.
 *  G3 RIESGO: MaxDD confirm canónica ≤ C0 + 5 pp.
 *  G4 ENSEMBLE (10 fases 260..350 paso 10, rev 84, 20 pb):
 *     P1: confirm(T8) > confirm(C0) en ≥7/10 fases · P2: media de edges ≥ +2 pp.
 *  G5 COSTES: mismo ensemble a COST_BPS=50 → P1 sigue cumpliéndose (≥7/10).
 *  G6 NO COMPRAR TEST CEDIENDO TRAIN (la trampa que refutó CAD_63):
 *     peor-celda TRAIN ≥ C0 − 2 pp  Y  media de edges de TRAIN en el ensemble ≥ −2 pp.
 *  G7 INTRADÍA (script hermano rally-top8-intradia.mjs, réplica validada bit a
 *     bit contra el modo cierres): P1 ≥7/10 y P2 ≥ +2 pp también en ese modo.
 *  ELECCIÓN entre passers: por TRAIN (peor-celda train; desempate CAGR train
 *  canónica) — nunca por el test.
 *
 * CONTROLES DE REGRESIÓN (abortan el estudio si fallan):
 *  R1: IDENTIDAD DE INSTRUMENTO sobre los datos ACTUALES — la celda canónica de
 *      C0 y de T8_PROP calculadas por la ruta del lib (PRESET_C0/capNormalizeTarget)
 *      deben igualar a <1e-12 la RÉPLICA LOCAL certificada del estudio 6
 *      (capNormalize por bisección + H4 + mezcla 70/30, tipeada SOLO aquí dentro
 *      con el único fin de comparar instrumentos).
 *  NOTA DE DATASET: los niveles del estudio 6 (17-ago) NO son reproducibles bit a
 *      bit — aquel corrió sobre el dataset pre-refresco, con colas rancias por el
 *      bug del fetch incremental (arreglado 21-ago) y 4 sesiones menos. Toda
 *      comparación de ESTE estudio es interna al dataset actual (C0 recalculado
 *      sobre los mismos datos que los candidatos), que es lo que exige el gate.
 *
 * LIMITACIONES (heredadas del estudio 6, siguen aplicando): universo
 * superviviente → SOLO comparaciones relativas; pesos fijos entre revisiones;
 * niveles absolutos inflados; dispersión entre celdas grande (leer Δ con la sd).
 *
 * USO:  node scripts/rally-top8-study.mjs            → backtests/rally-top8-study.json
 *       COST_BPS=50 node scripts/rally-top8-study.mjs → backtests/rally-top8-study-50bp.json
 * Determinista, sin aleatoriedad, sin lookahead.
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, PRESET_C0, capNormalizeTarget, segMetrics,
  COST_BPS, isNum, mean, sd, f1,
} from "./rally-study-lib.mjs";

const OUT = COST_BPS > 0.003 ? "backtests/rally-top8-study-50bp.json" : "backtests/rally-top8-study.json";
console.log(`Costes: ${(COST_BPS * 1e4).toFixed(0)} pb/lado → ${OUT}`);

console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones) · split ${dates[SPLIT]}`);

// ─── variantes: SOLO cambian topN y topes; el resto es PRESET_C0 literal ─────
const base = PRESET_C0(T);
const mkWeights = (lo, hi) => (top) => capNormalizeTarget(top.map((c) => Math.max(1, c.f.m9 ?? 1)), lo, hi, 100);
const VARIANTS = {
  C0:      { topN: 10, opts: base,                                          lo: 4, hi: 20 },
  T8_PROP: { topN: 8,  opts: { ...base, weightsOf: mkWeights(5, 25) },      lo: 5, hi: 25 },
  T8_FIX:  { topN: 8,  opts: { ...base, weightsOf: mkWeights(4, 20) },      lo: 4, hi: 20 },
};

const PHASES = [260, 280, 300];
const STD_REVIEWS = [63, 84, 105];
const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];

function runCell(v, FROM, review) {
  const r = simulate(T, D, { FROM, review, topN: v.topN, ...v.opts });
  const years = (TO - FROM) / 252;
  return {
    FROM, review,
    train: segMetrics(r.curve, FROM, SPLIT),
    confirm: segMetrics(r.curve, SPLIT, TO),
    full: segMetrics(r.curve, FROM, TO),
    opsYr: r.trades / years,
    jumps: r.jumpCount,
  };
}

// ─── malla estándar 9 celdas + canónica ──────────────────────────────────────
const results = {};
for (const [name, v] of Object.entries(VARIANTS)) {
  const cells = [];
  for (const FROM of PHASES) for (const review of STD_REVIEWS) cells.push(runCell(v, FROM, review));
  const canon = cells.find((c) => c.FROM === 260 && c.review === 84);
  results[name] = {
    cfg: { topN: v.topN, lo: v.lo, hi: v.hi },
    canon, cells,
    worstConfirm: Math.min(...cells.map((c) => c.confirm.cagr)),
    worstTrain: Math.min(...cells.map((c) => c.train.cagr)),
    sdCellsConfirm: sd(cells.map((c) => c.confirm.cagr)),
  };
}

// ─── R1: identidad de instrumento (lib vs réplica local del estudio 6) ───────
// Réplica tipeada SOLO para este check (capNormalize bisección + H4 + mezcla
// 70/30, copiadas de rally-joint-study.mjs / verify-joint-cadence.mjs).
{
  const clampL = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const scoreL = (f) => (f && isNum(f.m9) ? clampL(50 + 50 * Math.tanh(f.m9 / 75)) : null);
  const runwayL = (f) => { // copia de runwayScore del lib (misma del estudio 6)
    let s = 50;
    if (f.age < 40) s += 25; else if (f.age < 100) s += 5; else s -= 5;
    if (f.ext50 != null) { if (f.ext50 < 0.05) s += 20; else if (f.ext50 < 0.15) s += 5; else if (f.ext50 > 0.30) s -= 10; }
    if (f.prox != null && f.prox > 0.997) s -= 15;
    return clampL(s);
  };
  const H4L = (f) => clampL(12 + 0.35 * runwayL(f), 15, 45) / 100;
  const jumpL = (i, heldSet) => {
    let bi = null, bv = -Infinity;
    for (let ti = 0; ti < T.length; ti++) {
      if (heldSet.has(ti)) continue;
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreL(f);
      if (s == null) continue;
      const rw = runwayL(f);
      const v = 0.7 * s + 0.3 * (isNum(rw) ? rw : 50);
      if (v > bv) { bv = v; bi = ti; }
    }
    return bi;
  };
  const capL = (raw, lo, hi) => {
    const n = raw.length;
    if (!n) return [];
    const w = raw.map((v) => (isNum(v) && v > 0 ? v : 1e-6));
    const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
    let a = 1e-9, b = 1e9;
    for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
    const t = Math.sqrt(a * b);
    return w.map((v) => Math.min(hi, Math.max(lo, v * t)));
  };
  const check = (name, topN, lo, hi) => {
    const rep = simulate(T, D, { FROM: 260, review: 84, topN,
      widthOf: H4L, pickJump: jumpL,
      weightsOf: (top) => capL(top.map((c) => Math.max(1, c.f.m9 ?? 1)), lo, hi) });
    const mine = results[name].canon;
    const repM = { train: segMetrics(rep.curve, 260, SPLIT), confirm: segMetrics(rep.curve, SPLIT, TO) };
    const d1 = Math.abs(repM.confirm.cagr - mine.confirm.cagr);
    const d2 = Math.abs(repM.train.cagr - mine.train.cagr);
    if (d1 > 1e-12 || d2 > 1e-12) throw new Error(`R1 FALLA en ${name}: lib vs réplica difieren (Δcf ${d1}, Δtr ${d2})`);
  };
  check("C0", 10, 4, 20);
  check("T8_PROP", 8, 5, 25);
  console.log("R1 OK — ruta del lib ≡ réplica certificada del estudio 6 (<1e-12) para C0 y T8_PROP sobre los datos actuales.");
  const stored = JSON.parse(fs.readFileSync("backtests/rally-joint-study.json", "utf8"));
  console.log(`NOTA dataset: estudio 6 corrió ${stored.ranAt.slice(0, 10)} sobre datos pre-refresco (mi C0 canon cf ${f1(results.C0.canon.confirm.cagr)} vs ${f1(stored.c0.canon.confirm.cagr)} guardado — niveles no comparables, comparación interna).\n`);
}

// ─── ensemble 10 fases (rev 84) ──────────────────────────────────────────────
const ensemble = {};
for (const [name, v] of Object.entries(VARIANTS)) {
  ensemble[name] = PHASES10.map((FROM) => runCell(v, FROM, 84));
}
function probes(cand) {
  const eC = PHASES10.map((_, k) => ensemble[cand][k].confirm.cagr - ensemble.C0[k].confirm.cagr);
  const eT = PHASES10.map((_, k) => ensemble[cand][k].train.cagr - ensemble.C0[k].train.cagr);
  return {
    edgesConfirm: eC, edgesTrain: eT,
    winsConfirm: eC.filter((x) => x > 0).length,
    meanConfirm: mean(eC), meanTrain: mean(eT),
    minConfirm: Math.min(...eC), maxConfirm: Math.max(...eC),
  };
}
const P = { T8_PROP: probes("T8_PROP"), T8_FIX: probes("T8_FIX") };

// ─── evaluación de gates (G1-G6; G5 = la invocación a 50 pb; G7 = script hermano) ──
function gates(cand) {
  const r = results[cand], c0 = results.C0, p = P[cand];
  const g1 = r.canon.confirm.cagr > c0.canon.confirm.cagr && r.worstConfirm > c0.worstConfirm;
  const g2 = (r.canon.confirm.cagr - c0.canon.confirm.cagr) >= 0.02 || (r.canon.confirm.mar - c0.canon.confirm.mar) >= 0.08;
  const g3 = r.canon.confirm.mdd <= c0.canon.confirm.mdd + 0.05;
  const g4 = p.winsConfirm >= 7 && p.meanConfirm >= 0.02;
  const g6 = r.worstTrain >= c0.worstTrain - 0.02 && p.meanTrain >= -0.02;
  return { G1: g1, G2: g2, G3: g3, G4: g4, G6: g6, passAll_20bp: g1 && g2 && g3 && g4 && g6 };
}
const GATES = { T8_PROP: gates("T8_PROP"), T8_FIX: gates("T8_FIX") };

// ─── salida legible ──────────────────────────────────────────────────────────
console.log("═══ MALLA 9 CELDAS (canónica 260·84) — confirm CAGR / MaxDD / MAR ‖ peor-celda cf / tr ═══");
for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(8)} canon cf ${f1(r.canon.confirm.cagr)} · MDD ${f1(r.canon.confirm.mdd)} · MAR ${r.canon.confirm.mar.toFixed(2)}` +
    ` ‖ peor cf ${f1(r.worstConfirm)} · peor tr ${f1(r.worstTrain)} · sd celdas ${f1(r.sdCellsConfirm)} · ops/a ${r.canon.opsYr.toFixed(1)}`);
}
console.log("\n═══ ENSEMBLE 10 FASES (rev 84) — edges vs C0 ═══");
for (const [name, p] of Object.entries(P)) {
  console.log(`${name.padEnd(8)} confirm: ${p.winsConfirm}/10 fases · media ${f1(p.meanConfirm)} · rango [${f1(p.minConfirm)}, ${f1(p.maxConfirm)}]` +
    ` ‖ train: media ${f1(p.meanTrain)}`);
}
console.log("\n═══ GATES (a estos costes; G5=50pb aparte, G7=intradía aparte) ═══");
for (const [name, g] of Object.entries(GATES)) {
  console.log(`${name.padEnd(8)} G1 ${g.G1 ? "✓" : "✗"} · G2 ${g.G2 ? "✓" : "✗"} · G3 ${g.G3 ? "✓" : "✗"} · G4 ${g.G4 ? "✓" : "✗"} · G6 ${g.G6 ? "✓" : "✗"}  →  ${g.passAll_20bp ? "PASA (este tramo)" : "NO PASA"}`);
}

fs.writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(),
  estudio: "rally-top8-study (estudio 7, pre-registrado)",
  costBps: COST_BPS * 1e4,
  gatesPreRegistrados: "G1-G7 en la cabecera del script; elección entre passers por TRAIN",
  split: dates[SPLIT], sesiones: D, tickers: T.length,
  results, ensemble, probes: P, gates: GATES,
}, null, 1));
console.log(`\nGuardado: ${OUT}`);
