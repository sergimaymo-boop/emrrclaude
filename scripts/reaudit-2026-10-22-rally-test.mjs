/**
 * RE-AUDITORÍA 22/23-oct-2026 — RALLY-TEST (LAB-M189 v1.1) sobre el dataset REPARADO.
 * Solo MIDE (no cambia estrategia). Usa el núcleo tal cual: lab-day-core.mjs (anclas
 * A1/A2 bit a bit al importar). Config v1.1 = M189s10·K5·SCORE[10,40]·R63·F45·RESCAN2.
 * Coste por env COST_BPS (20 por defecto). Salida: backtests/reaudit-2026-10-22-rally-test[-50bp].json
 */
import fs from "node:fs";
import { simular, evaluar, PHASES10, SPLIT, TO, dates, COST_BPS, segMetrics, mean, sd, isNum, f1 } from "./lab-day-core.mjs";

const OUT = `backtests/reaudit-2026-10-22-rally-test${COST_BPS > 0.003 ? "-50bp" : ""}.json`;
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0 };
const CFGS = [
  { name: "v1.1 F45 (producción Rally-Test)", scfg: { tipo: "FIJO", w: 0.45 } },
  { name: "referencia SIN stop", scfg: { tipo: "NONE" } },
];
const yearIdx = {};
dates.forEach((d, i) => { const y = d.slice(0, 4); (yearIdx[y] ??= { a: i, b: i }).b = i; });
const years = Object.keys(yearIdx).sort();

const res = CFGS.map(({ name, scfg }) => {
  const ev = evaluar({ ...BASE, scfg });
  const porAnio = {};
  const full = [];
  for (const FROM of PHASES10) {
    const s = simular({ ...BASE, scfg, FROM });
    full.push(segMetrics(s.curve, FROM, TO));
    for (const y of years) {
      const { a, b } = yearIdx[y];
      const a0 = Math.max(a - 1, FROM);          // el año arranca en el cierre anterior
      if (b <= FROM) continue;
      const v0 = s.curve[a0], v1 = s.curve[b];
      if (isNum(v0) && v0 > 0 && isNum(v1)) (porAnio[y] ??= []).push(v1 / v0 - 1);
    }
  }
  const anio = Object.fromEntries(Object.entries(porAnio).map(([y, v]) => [y, { media: mean(v), min: Math.min(...v), max: Math.max(...v), n: v.length }]));
  return { name, scfg, ...ev, fullCagrMean: mean(full.map((m) => m.cagr)), fullCagrWorst: Math.min(...full.map((m) => m.cagr)),
           fullDDWorst: Math.max(...full.map((m) => m.maxDD ?? m.dd ?? 0)), porAnio: anio };
});

console.log(`RE-AUDITORÍA Rally-Test — ${(COST_BPS * 1e4).toFixed(0)} pb/lado · dataset ${dates[0]} → ${dates.at(-1)}\n`);
for (const r of res) {
  console.log(`${r.name}${r.fasesDistintas < 10 ? " ⚠ COLAPSO " + r.fasesDistintas + "/10" : ""}`);
  console.log(`  train  media ${f1(r.trainMean)} · peor ${f1(r.trainWorst)}`);
  console.log(`  confirm 2022-26 media ${f1(r.confirmMean)} · peor ${f1(r.confirmWorst)} · DD pico-valle ${f1(r.ddRealWorst)} · 2020 ${f1(r.dd2020Worst)} · 2022 ${f1(r.ret2022Mean)}`);
  console.log(`  10 años (fase→fin) CAGR media ${f1(r.fullCagrMean)} · peor ${f1(r.fullCagrWorst)} · saltos/año ${r.stopsY.toFixed(2)}`);
  console.log("  por año: " + Object.entries(r.porAnio).map(([y, v]) => `${y} ${f1(v.media, 0)}`).join(" · "));
}
fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, dataset: { from: dates[0], to: dates.at(-1), sesiones: dates.length }, results: res }, null, 1));
console.log(`\nGuardado ${OUT}`);
