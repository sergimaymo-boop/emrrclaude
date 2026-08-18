/**
 * VERIFICACIÓN ADVERSARIAL del único hallazgo del estudio conjunto
 * (rally-joint-study.mjs): la familia CAD_63 pasó el gate en confirmación.
 * ========================================================================
 * BANDERAS ROJAS que motivan esta verificación (visibles en el estudio):
 *   · No-monotonía: cadencia 63 (+9,5 pp) Y cadencia 105 (+16,4 pp) baten a 84
 *     en la celda canónica de confirmación — si acortar ayudara de verdad,
 *     alargar debería restar. Huele a suerte de alineación de fechas de revisión.
 *   · El train canónico prefiere 84 con fuerza (50,7% vs 41,5%): el patrón
 *     "brilla en test, flojea en train" es EXACTAMENTE el del fijo-20% que este
 *     repo ya rechazó (pivote documentado en rally-adaptive-stop-round2.mjs).
 *   · La ventaja por train de CAD_63 depende de la construcción de malla
 *     (jitter vs estándar) — frágil.
 *
 * CRITERIOS PRE-REGISTRADOS (escritos ANTES de ejecutar; los cinco deben
 * cumplirse para confirmar el cambio de cadencia; si falla UNO → CERTIFICAR_ACTUAL):
 *   P1 AMPLITUD DE FASES: confirm CAGR(63) > confirm CAGR(84) en ≥7/10 fases
 *      (ensemble 260..350 paso 10; la malla original solo tenía 3 fases).
 *   P2 MATERIAL EN ENSEMBLE: media del edge de confirmación ≥ +2 pp.
 *   P3 AMPLITUD TEMPORAL: edge medio > 0 en AMBAS mitades de la confirmación
 *      (2022-01→2024-01 y 2024-01→2026-08) — no un solo tramo afortunado.
 *   P4 COSTES: con 50 pb/lado (vs 20 del estudio), edge medio ≥ +1 pp
 *      (cadencia 63 rota ~15% más). [se evalúa con la 2ª invocación COST_BPS=50]
 *   P5 SACRIFICIO DE TRAIN ACOTADO: edge medio de TRAIN (63−84) ≥ −3 pp en el
 *      ensemble — un candidato que compra su brillo de test cediendo el train
 *      es selección sobre el test con disfraz (doctrina walk-forward del repo).
 *
 * Además, BARRIDO DE MONOTONÍA (solo diagnóstico, no criterio): cadencias
 * 50/63/70/84/95/105/120 × 10 fases — un efecto estructural debería dibujar un
 * patrón suave; el ruido dibuja zigzag.
 *
 * Uso: node scripts/verify-joint-cadence.mjs            (20 pb, escribe JSON y
 *      patchea backtests/rally-joint-study.json)
 *      COST_BPS=50 node scripts/verify-joint-cadence.mjs (2ª pasada: añade P4)
 * Determinista, sin lookahead. Salida: backtests/rally-joint-cadence-probe-{N}bp.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, scoreV4, runwayScore, isNum, clamp, f1, mean, sd,
} from "./rally-study-lib.mjs";

const COSTBPS = Number(process.env.COST_BPS ?? 20);
const t0 = Date.now();
console.log(`Cargando universo (señales AJUSTADAS, rich)… costes ${COSTBPS} pb/lado`);
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const MID = dates.findIndex((d) => d >= "2024-01-01");
console.log(`Split ${dates[SPLIT]} · mitades de confirmación: ${dates[SPLIT]}→${dates[MID]}→${dates[TO]}\n`);

// C0 exacto (M9_RAW + H4 + top10 + mezcla 70/30 + heredar) — réplica del estudio conjunto
const H4 = (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45) / 100;
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
const weightsOf = (top) => capNormalize(top.map((c) => Math.max(1, c.f.m9 ?? 1)));
const cagrSeg = (curve, a, b) => (isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 252 / (b - a)) - 1 : null);

function cell(FROM, review) {
  const r = simulate(T, D, { FROM, review, conviction: true, widthOf: H4, pickJump: jumpMezcla, weightsOf });
  const years = (TO - FROM) / 252;
  return {
    FROM, review,
    train: cagrSeg(r.curve, FROM, SPLIT),
    confirm: cagrSeg(r.curve, SPLIT, TO),
    confirmA: cagrSeg(r.curve, SPLIT, MID),
    confirmB: cagrSeg(r.curve, MID, TO),
    opsYr: r.trades / years,
  };
}

const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
const REVIEWS_SCAN = [50, 63, 70, 84, 95, 105, 120];
const grid = {};
for (const rev of REVIEWS_SCAN) {
  grid[rev] = PHASES10.map((FROM) => cell(FROM, rev));
}

// ─── tabla de monotonía: media/mediana/mín de confirm y train por cadencia ───
console.log("BARRIDO cadencia × 10 fases (260..350) — CAGR:");
console.log(["rev".padStart(4), "cf medio".padStart(9), "cf mediana".padStart(11), "cf mín".padStart(8), "cf máx".padStart(8), "‖ tr medio".padStart(11), "tr mín".padStart(8), "‖ cfA medio".padStart(12), "cfB medio".padStart(10), "ops/a".padStart(6)].join(" "));
const scanRows = [];
for (const rev of REVIEWS_SCAN) {
  const cf = grid[rev].map((c) => c.confirm), tr = grid[rev].map((c) => c.train);
  const cfA = grid[rev].map((c) => c.confirmA), cfB = grid[rev].map((c) => c.confirmB);
  const srt = [...cf].sort((a, b) => a - b);
  const row = {
    review: rev, cfMean: mean(cf), cfMedian: (srt[4] + srt[5]) / 2, cfMin: Math.min(...cf), cfMax: Math.max(...cf), cfSd: sd(cf),
    trMean: mean(tr), trMin: Math.min(...tr), cfAMean: mean(cfA), cfBMean: mean(cfB), opsYr: mean(grid[rev].map((c) => c.opsYr)),
  };
  scanRows.push(row);
  console.log([String(rev).padStart(4), f1(row.cfMean).padStart(9), f1(row.cfMedian).padStart(11), f1(row.cfMin).padStart(8), f1(row.cfMax).padStart(8),
    f1(row.trMean).padStart(11), f1(row.trMin).padStart(8), f1(row.cfAMean).padStart(12), f1(row.cfBMean).padStart(10), row.opsYr.toFixed(0).padStart(6)].join(" "));
}

// ─── criterios pre-registrados P1-P5 sobre 63 vs 84 ──────────────────────────
const g63 = grid[63], g84 = grid[84];
const edges = PHASES10.map((_, k) => g63[k].confirm - g84[k].confirm);
const edgesTr = PHASES10.map((_, k) => g63[k].train - g84[k].train);
const edgesA = PHASES10.map((_, k) => g63[k].confirmA - g84[k].confirmA);
const edgesB = PHASES10.map((_, k) => g63[k].confirmB - g84[k].confirmB);
const winsCf = edges.filter((e) => e > 0).length;
const P1 = winsCf >= 7;
const P2 = mean(edges) >= 0.02;
const P3 = mean(edgesA) > 0 && mean(edgesB) > 0;
const P5 = mean(edgesTr) >= -0.03;
console.log(`\n63 vs 84, fase a fase (confirm edge): ${edges.map((e, k) => `${PHASES10[k]}:${(e * 100).toFixed(1)}`).join("  ")}`);
console.log(`63 vs 84, fase a fase (train edge):   ${edgesTr.map((e, k) => `${PHASES10[k]}:${(e * 100).toFixed(1)}`).join("  ")}`);
console.log(`\nP1 amplitud fases (≥7/10 en confirm): ${winsCf}/10 → ${P1 ? "CUMPLE" : "FALLA"}`);
console.log(`P2 material (edge medio confirm ≥ +2 pp): ${f1(mean(edges))} → ${P2 ? "CUMPLE" : "FALLA"}`);
console.log(`P3 ambas mitades (22-23: ${f1(mean(edgesA))} · 24-26: ${f1(mean(edgesB))}): ${P3 ? "CUMPLE" : "FALLA"}`);
console.log(`P5 train acotado (edge medio train ≥ −3 pp): ${f1(mean(edgesTr))} → ${P5 ? "CUMPLE" : "FALLA"}`);
console.log(`P4 costes: evaluar con COST_BPS=50 (esta pasada: ${COSTBPS} pb${COSTBPS === 50 ? ` → edge medio ${f1(mean(edges))} ${mean(edges) >= 0.01 ? "CUMPLE" : "FALLA"}` : ""})`);

const OUT = {
  ranAt: new Date().toISOString(), costBps: COSTBPS,
  motivo: "adjudicar si el gate-pass de CAD_63 (y sus combos) es efecto estructural o suerte de alineación de fechas — banderas: no-monotonía 63/105, train canónico −9,2 pp, dependencia de construcción de malla",
  criteriosPreRegistrados: {
    P1: "confirm CAGR(63)>CAGR(84) en ≥7/10 fases del ensemble 260..350",
    P2: "edge medio de confirmación ≥ +2 pp",
    P3: "edge medio > 0 en ambas mitades de la confirmación (2022-23 y 2024-26)",
    P4: "con 50 pb/lado, edge medio ≥ +1 pp",
    P5: "edge medio de TRAIN ≥ −3 pp (no comprar test cediendo train)",
    regla: "los CINCO deben cumplirse; si falla uno → CERTIFICAR_ACTUAL",
  },
  ensemble: { fases: PHASES10, porCadencia: scanRows, grid },
  edges63vs84: {
    confirmPorFase: Object.fromEntries(PHASES10.map((p, k) => [p, edges[k]])),
    trainPorFase: Object.fromEntries(PHASES10.map((p, k) => [p, edgesTr[k]])),
    confirmMedio: mean(edges), trainMedio: mean(edgesTr),
    mitadA_2022_23: mean(edgesA), mitadB_2024_26: mean(edgesB), winsConfirm: winsCf,
  },
  resultado: { P1, P2, P3, P5, P4: COSTBPS === 50 ? mean(edges) >= 0.01 : null },
};
fs.writeFileSync(`backtests/rally-joint-cadence-probe-${COSTBPS}bp.json`, JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-joint-cadence-probe-${COSTBPS}bp.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ─── patch prometido en el header: veredictoFinal en rally-joint-study.json ──
// MERGE, no sobrescritura: se conserva todo el estudio y cualquier clave previa
// de veredictoFinal (razones, anula…); solo se actualizan verdict/probes/fecha.
const JOINT_PATH = "backtests/rally-joint-study.json";
try {
  const joint = JSON.parse(fs.readFileSync(JOINT_PATH, "utf8"));
  const probes = { ...(joint.veredictoFinal?.probes ?? {}), [`${COSTBPS}bp`]: OUT.resultado };
  // El cambio de cadencia solo se confirmaría con TODOS los criterios evaluados
  // en CUMPLE (incluido P4, que exige la pasada COST_BPS=50); si falla uno → actual.
  const evaluados = Object.values(probes).flatMap((p) => Object.values(p).filter((v) => v !== null));
  const p4Evaluado = Object.values(probes).some((p) => p.P4 !== null && p.P4 !== undefined);
  const verdict = p4Evaluado && evaluados.length > 0 && evaluados.every(Boolean)
    ? "CAMBIAR_CADENCIA_63"
    : "CERTIFICAR_ACTUAL";
  joint.veredictoFinal = { ...(joint.veredictoFinal ?? {}), verdict, probes, fecha: new Date().toISOString() };
  fs.writeFileSync(JOINT_PATH, JSON.stringify(joint, null, 1));
  console.log(`veredictoFinal { verdict: ${verdict}, probes: ${Object.keys(probes).join("+")} } fusionado en ${JOINT_PATH} (resto del estudio intacto)`);
} catch (e) {
  console.log(`⚠ No se pudo patchear ${JOINT_PATH}: ${e.message}`);
}
