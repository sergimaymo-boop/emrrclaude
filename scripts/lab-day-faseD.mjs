/**
 * LAB-DAY FASE D — EXPOSICIÓN POR AMPLITUD DEL UNIVERSO (el agujero COVID).
 * Idea propia del día: la fracción invertida se decide por el % del UNIVERSO
 * con momentum positivo (salud interna del caladero) — mecanismo distinto del
 * régimen SPY-EMA200 de Supreme. Se aplica en cada REFORMA de cartera; como los
 * stops disparan reformas (RESCAN2), en un crash la cadena es: stop → reforma →
 * amplitud hundida → caja. Ejes:
 *   amplitud: B189 (% con M189s10>0, lenta) · B63 (% con mom63>0, rápida)
 *   mapeo → exposición: LIN50 (breadth/0,50 acotado 0-1) · STEP (0 si <15%,
 *           0,5 si <30%, 1 si no) · SQRT40 (√(breadth/0,40) acotado)
 * Construcción fija v1.1. Gate de adopción de la casa. Salida: lab-day-faseD.json
 */
import fs from "node:fs";
import { evaluar, fila, mom, breadth, memo, isNum, T } from "./lab-day-core.mjs";

const N = T.length;
function breadth63(i) {
  return memo(`b63:${i}`, () => {
    let pos = 0, tot = 0;
    for (let ti = 0; ti < N; ti++) {
      if (!isNum(T[ti].adj[i])) continue;
      const m = mom(ti, i, 63, 0);
      if (m == null) continue;
      tot++; if (m > 0) pos++;
    }
    return tot >= 100 ? pos / tot : null;
  });
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const MAPEOS = {
  LIN50: (b) => clamp01(b / 0.50),
  STEP: (b) => (b < 0.15 ? 0 : b < 0.30 ? 0.5 : 1),
  SQRT40: (b) => Math.sqrt(clamp01(b / 0.40)),
};
const AMPLITUDES = { B189: breadth, B63: breadth63 };

const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2", cooldown: 0 };
const CONFIGS = [{ name: "v1.1 sin overlay ★", cfg: V11 }];
for (const [ak, afn] of Object.entries(AMPLITUDES))
  for (const [mk, mfn] of Object.entries(MAPEOS))
    CONFIGS.push({ name: `${ak}·${mk}`, cfg: { ...V11, expoFn: (i) => { const b = afn(i); return b == null ? 1 : mfn(b); } } });

console.log(`FASE D: ${CONFIGS.length} configuraciones × 10 fases`);
const t0 = Date.now();
const RES = CONFIGS.map(({ name, cfg }) => { const r = evaluar(cfg); process.stdout.write("."); return { name, ...r }; });
console.log(` ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

const base = RES[0];
RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("config                          trWorst  trMean ‖ cfMean cfWorst ‖ riesgo (expoMin = mínima fracción invertida vista)");
for (const r of RES) {
  const em = r.cells ? Math.min(...r.cells.map((c) => c.expoMin ?? 1)) : 1;
  console.log(fila(r.name, r) + `  expoMin ${(em * 100).toFixed(0)}%`);
}
console.log("\nGATE (batir v1.1 en trainWorst Y no perder cfMean/cfWorst; además queremos 2020 MEJOR):");
let alguno = false;
for (const r of RES) {
  if (r === base) continue;
  const pasa = r.trainWorst > base.trainWorst && r.confirmMean >= base.confirmMean - 1e-12 && r.confirmWorst >= base.confirmWorst - 1e-12 && r.fasesDistintas === 10;
  if (pasa) { alguno = true; console.log(`  ✅ ${r.name} · 2020 ${(r.dd2020Worst * 100).toFixed(1)}% (base ${(base.dd2020Worst * 100).toFixed(1)}%)`); }
}
if (!alguno) console.log("  ninguno pasa el gate completo");

fs.writeFileSync("backtests/lab-day-faseD.json", JSON.stringify({ ranAt: new Date().toISOString(), results: RES }, null, 1));
console.log("\nGuardado: backtests/lab-day-faseD.json");
