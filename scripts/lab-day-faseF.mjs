/**
 * LAB-DAY FASE F — BATERÍA DE ROBUSTEZ DEL CANDIDATO R21·H10 (v2.0 en examen).
 *  F1 vecindad: H {8,9,10,11,12} × R {17,21,26} — ¿meseta o pico de ruido?
 *  F2 retraso de ejecución +1 día (señales de ayer, ejecución al cierre de hoy)
 *     — el test del auditor: si hay lookahead sutil, esto lo destapa.
 *  F3 ¿el stop F45 sigue ganándose el puesto bajo R21·H10? (con vs sin)
 *  Con COST_BPS=50 el script entero re-corre a costes dobles (F4).
 * Salida: backtests/lab-day-faseF[-50bp].json
 */
import fs from "node:fs";
import { evaluar, fila, sigM189s10, COST_BPS } from "./lab-day-core.mjs";

const OUT = COST_BPS > 0.003 ? "backtests/lab-day-faseF-50bp.json" : "backtests/lab-day-faseF.json";
const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2", cooldown: 0 };
const CAND = { ...V11, R: 21, hyst: 10 };
const sigLag = (ti, i) => sigM189s10(ti, i - 1);   // señales de AYER

const CONFIGS = [
  { name: "v1.1 (R63) ★", cfg: V11 },
  { name: "CANDIDATO R21·H10", cfg: CAND },
  // F1 vecindad
  ...[8, 9, 11, 12].map((h) => ({ name: `R21·H${h}`, cfg: { ...CAND, hyst: h } })),
  ...[17, 26].map((R) => ({ name: `R${R}·H10`, cfg: { ...CAND, R } })),
  // F2 retraso +1 día
  { name: "CANDIDATO con lag+1", cfg: { ...CAND, signalFn: sigLag, sigKey: "M189s10lag1" } },
  { name: "v1.1 con lag+1", cfg: { ...V11, signalFn: sigLag, sigKey: "M189s10lag1" } },
  // F3 el stop bajo el candidato
  { name: "R21·H10 SIN stop", cfg: { ...CAND, scfg: { tipo: "NONE" } } },
];

console.log(`FASE F (${(COST_BPS * 1e4).toFixed(0)} pb): ${CONFIGS.length} configuraciones × 10 fases`);
const RES = CONFIGS.map(({ name, cfg }) => { const r = evaluar(cfg); process.stdout.write("."); return { name, ...r }; });
console.log("\n");
console.log("config                          trWorst  trMean ‖ cfMean cfWorst ‖ riesgo");
for (const r of RES) console.log(fila(r.name, r));

fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, results: RES }, null, 1));
console.log(`\nGuardado: ${OUT}`);
