/**
 * LAB-DAY FASE E — CADENCIA FINA × HISTÉRESIS DE PERTENENCIA.
 * Idea nueva del día: re-evaluar el ranking MÁS a menudo (R21/R42) pero vender
 * un held solo si cae por debajo del puesto H del ranking (banda de tolerancia)
 * — reacciona antes que R63 sin pagar la rotación del re-ranking puro.
 * También la malla fina de R alrededor de 63 sin histéresis.
 * Construcción v1.1 fija en lo demás. Gate de adopción de la casa.
 * Salida: backtests/lab-day-faseE.json
 */
import fs from "node:fs";
import { evaluar, fila } from "./lab-day-core.mjs";

const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2", cooldown: 0 };
const CONFIGS = [
  { name: "v1.1 (R63) ★", cfg: V11 },
  { name: "R52", cfg: { ...V11, R: 52 } },
  { name: "R74", cfg: { ...V11, R: 74 } },
  { name: "R21·H8", cfg: { ...V11, R: 21, hyst: 8 } },
  { name: "R21·H10", cfg: { ...V11, R: 21, hyst: 10 } },
  { name: "R21·H15", cfg: { ...V11, R: 21, hyst: 15 } },
  { name: "R42·H8", cfg: { ...V11, R: 42, hyst: 8 } },
  { name: "R42·H10", cfg: { ...V11, R: 42, hyst: 10 } },
  { name: "R63·H10", cfg: { ...V11, R: 63, hyst: 10 } },
];

console.log(`FASE E: ${CONFIGS.length} configuraciones × 10 fases`);
const t0 = Date.now();
const RES = CONFIGS.map(({ name, cfg }) => { const r = evaluar(cfg); process.stdout.write("."); return { name, ...r }; });
console.log(` ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

const base = RES[0];
RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("config                          trWorst  trMean ‖ cfMean cfWorst ‖ riesgo");
for (const r of RES) console.log(fila(r.name, r));
console.log("\nGATE (batir v1.1 en trainWorst Y no perder cfMean/cfWorst):");
let alguno = false;
for (const r of RES) {
  if (r === base) continue;
  const pasa = r.trainWorst > base.trainWorst && r.confirmMean >= base.confirmMean - 1e-12 && r.confirmWorst >= base.confirmWorst - 1e-12 && r.fasesDistintas === 10;
  if (pasa) { alguno = true; console.log(`  ✅ ${r.name}`); }
}
if (!alguno) console.log("  ninguno pasa; v1.1 se queda");

fs.writeFileSync("backtests/lab-day-faseE.json", JSON.stringify({ ranAt: new Date().toISOString(), results: RES }, null, 1));
console.log("\nGuardado: backtests/lab-day-faseE.json");
