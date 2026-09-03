/**
 * AUDITORÍA EXHAUSTIVA DEL TRAILING STOP — Rally-Test (mandato Sergi 3-sep-2026)
 * ==============================================================================
 * Pregunta: ¿cuánto cuesta la red de protección y cuánto protege? ¿Merece la pena
 * el 45% actual, otro valor, o ninguno? Premisa de Sergi: máxima rentabilidad,
 * aceptando perder "poca o ninguna" a cambio de protección.
 *
 * Motivación real: el auditor de la jornada lab-day encontró que a 50 pb la
 * variante SIN stop batía a la CON stop en confirm (el F45 costaba −1,05 pp de
 * cfMean). Esto lo audita de frente, con la métrica correcta: TEST PAREADO por
 * fase (no medias sueltas — sd entre fases ≈7 pp aplasta cualquier diferencia).
 *
 * BARRIDO (todos sobre la construcción v1.1: M189s10 · K5 · SCORE[10,40] · R63 ·
 * RESCAN2, ensemble 10 fases, 20 y 50 pb):
 *   · SIN stop
 *   · fijos: 25,30,35,40,45,50,55,60,70%
 *   · adaptativos por volatilidad: kv 0,75/1,0/1,25/1,5 acotados [20,60]
 *   · chandelier-ATR-like: kv×vol con suelo alto (protege poco, deja correr)
 * MÉTRICAS por config: CAGR train/confirm (media y peor fase), DD real pico-valle,
 * DD del año COVID 2020, retorno 2022, MAR, stops/año, y — lo importante —
 * DIFERENCIA PAREADA vs SIN-STOP fase a fase con su t de Student.
 *
 * Salida: backtests/lab-stop-audit[-50bp].json
 */
import fs from "node:fs";
import { evaluar, PHASES10, COST_BPS, mean, sd, isNum, f1 } from "./lab-day-core.mjs";

const OUT = COST_BPS > 0.003 ? "backtests/lab-stop-audit-50bp.json" : "backtests/lab-stop-audit.json";
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0 };

const CONFIGS = [
  { name: "SIN stop", scfg: { tipo: "NONE" } },
  ...[0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70].map((w) => ({ name: `F${(w * 100).toFixed(0)}`, scfg: { tipo: "FIJO", w } })),
  ...[0.75, 1.0, 1.25, 1.5].map((kv) => ({ name: `ADAPT×${kv}`, scfg: { tipo: "ADAPT", kv, lo: 0.20, hi: 0.60 } })),
];

console.log(`AUDITORÍA DEL STOP (${(COST_BPS * 1e4).toFixed(0)} pb) — ${CONFIGS.length} anchuras × 10 fases\n`);
const RES = CONFIGS.map(({ name, scfg }) => {
  const r = evaluar({ ...BASE, scfg });
  process.stdout.write(".");
  return { name, scfg, ...r };
});
console.log("\n");

const sinStop = RES[0];
// test pareado fase a fase contra SIN stop (la métrica correcta)
function pareado(r, campo) {
  const d = PHASES10.map((_, k) => r.cells[k][campo].cagr - sinStop.cells[k][campo].cagr);
  const m = mean(d), s = sd(d);
  const se = s / Math.sqrt(d.length);
  return { media: m, sd: s, t: se > 0 ? m / se : 0, gana: d.filter((x) => x > 0).length };
}
for (const r of RES) {
  r.pareadoConfirm = pareado(r, "confirm");
  r.pareadoTrain = pareado(r, "train");
  r.marConfirm = r.ddRealWorst > 0 ? r.confirmMean / r.ddRealWorst : 0;
}

console.log("anchura      trWorst  cfMean cfWorst │ Δconfirm vs SIN-STOP     │ DDreal  2020   2022   MAR  st/a");
console.log("─".repeat(112));
for (const r of RES) {
  const p = r.pareadoConfirm;
  const sig = Math.abs(p.t) >= 2 ? "◄SIGNIF" : "";
  console.log(
    `${r.name.padEnd(12)} ${f1(r.trainWorst).padStart(7)} ${f1(r.confirmMean).padStart(7)} ${f1(r.confirmWorst).padStart(7)} │ ` +
    `${f1(p.media).padStart(7)} t=${p.t.toFixed(2).padStart(5)} ${String(p.gana + "/10").padStart(5)} ${sig.padEnd(7)} │ ` +
    `${f1(r.ddRealWorst).padStart(6)} ${f1(r.dd2020Worst).padStart(6)} ${f1(r.ret2022Mean).padStart(6)} ${r.marConfirm.toFixed(2).padStart(5)} ${r.stopsY.toFixed(1).padStart(4)}`
  );
}

console.log("\n═══ LECTURA ═══");
console.log("· Δconfirm = coste (o beneficio) de rentabilidad en confirmación 2022-26, medido PAREADO fase a fase.");
console.log("· |t| ≥ 2 sería diferencia estadísticamente distinguible del ruido; por debajo, es indistinguible.");
console.log("· DDreal = caída máxima pico-valle (lo que de verdad duele). 2020 = crash COVID. MAR = rentabilidad/caída.");

// mejor por protección sin sacrificar rentabilidad de forma significativa
const candidatos = RES.filter((r) => r.name !== "SIN stop" && r.pareadoConfirm.t > -2 && r.fasesDistintas === 10);
candidatos.sort((a, b) => (a.ddRealWorst - b.ddRealWorst) || (b.confirmMean - a.confirmMean));
console.log("\n═══ MEJOR PROTECCIÓN sin pérdida significativa de rentabilidad (t > −2) ═══");
for (const r of candidatos.slice(0, 5)) {
  console.log(`  ${r.name.padEnd(12)} DDreal ${f1(r.ddRealWorst)} (SIN stop: ${f1(sinStop.ddRealWorst)}) · Δconfirm ${f1(r.pareadoConfirm.media)} (t=${r.pareadoConfirm.t.toFixed(2)}) · 2022 ${f1(r.ret2022Mean)} · MAR ${r.marConfirm.toFixed(2)}`);
}

fs.writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4,
  pregunta: "coste vs protección del trailing stop en Rally-Test (mandato Sergi)",
  base: { ...BASE, señal: "M189s10" }, results: RES,
}, null, 1));
console.log(`\nGuardado: ${OUT}`);
