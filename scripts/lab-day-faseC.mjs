/**
 * LAB-DAY FASE C — CONSTRUCCIÓN DE CARTERA (señal fija M189s10; OFAT alrededor
 * de v1.1 = K5·SCORE·F45·RESCAN2·R63, luego cruces de los ganadores por train).
 *  C1  concentración K {3,4,5,6,7}
 *  C2  pesos {EQ, SCORE, MRAW, RANKPOW α1, IVOLSCORE}
 *  C3  stop {F40, F45, F50, A0.75, A1.0}
 *  C4  cooldown de recompra tras stop {0, 10, 21} sesiones
 *  C5  reinversión {RESCAN2, JUMP}
 * Gate de adopción (estilo casa): batir a v1.1 en TRAIN peor-fase Y no perder
 * en confirm (media NI peor-fase). Salida: backtests/lab-day-faseC.json
 */
import fs from "node:fs";
import { evaluar, fila } from "./lab-day-core.mjs";

const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2", cooldown: 0 };
const CONFIGS = [
  { name: "v1.1 (referencia)", cfg: V11 },
  // C1 — K
  ...[3, 4, 6, 7].map((K) => ({ name: `K${K}`, cfg: { ...V11, K } })),
  // C2 — pesos
  { name: "pesos EQ", cfg: { ...V11, wcfg: { modo: "EQ" } } },
  { name: "pesos MRAW", cfg: { ...V11, wcfg: { modo: "MRAW" } } },
  { name: "pesos RANKPOW", cfg: { ...V11, wcfg: { modo: "RANKPOW", alpha: 1 } } },
  { name: "pesos IVOL×SCORE", cfg: { ...V11, wcfg: { modo: "IVOLSCORE" } } },
  // C3 — stop
  { name: "stop F40", cfg: { ...V11, scfg: { tipo: "FIJO", w: 0.40 } } },
  { name: "stop F50", cfg: { ...V11, scfg: { tipo: "FIJO", w: 0.50 } } },
  { name: "stop A0.75", cfg: { ...V11, scfg: { tipo: "ADAPT", kv: 0.75 } } },
  { name: "stop A1.0", cfg: { ...V11, scfg: { tipo: "ADAPT", kv: 1.0 } } },
  // C4 — cooldown
  { name: "cooldown 10", cfg: { ...V11, cooldown: 10 } },
  { name: "cooldown 21", cfg: { ...V11, cooldown: 21 } },
  // C5 — reinversión
  { name: "modo JUMP", cfg: { ...V11, modoStop: "JUMP" } },
];

console.log(`FASE C: ${CONFIGS.length} configuraciones × 10 fases`);
const t0 = Date.now();
const RES = CONFIGS.map(({ name, cfg }) => { const r = evaluar(cfg); process.stdout.write("."); return { name, cfg, ...r }; });
console.log(` ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

const base = RES[0];
RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("config                          trWorst  trMean ‖ cfMean cfWorst ‖ riesgo");
for (const r of RES) console.log(fila(r.name + (r === base ? " ★" : ""), r));

// gate de adopción por eje
console.log("\nGATE (batir v1.1 en trainWorst Y no perder en cfMean NI cfWorst):");
for (const r of RES) {
  if (r === base) continue;
  const pasa = r.trainWorst > base.trainWorst && r.confirmMean >= base.confirmMean - 1e-12 && r.confirmWorst >= base.confirmWorst - 1e-12 && r.fasesDistintas === 10;
  if (pasa) console.log(`  ✅ ${r.name}`);
}
console.log("  (sin líneas ✅ = ningún eje pasa; v1.1 se queda)");

fs.writeFileSync("backtests/lab-day-faseC.json", JSON.stringify({ ranAt: new Date().toISOString(), results: RES.map(({ cfg, ...r }) => r) }, null, 1));
console.log("\nGuardado: backtests/lab-day-faseC.json");
