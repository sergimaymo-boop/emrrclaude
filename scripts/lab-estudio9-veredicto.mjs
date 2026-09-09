/**
 * ESTUDIO 9 — VEREDICTO FINAL (cruza las corridas a 20 y 50 pb: gate G6).
 * Lee backtests/lab-estudio9.json y -50bp.json y aplica el pre-registro completo.
 */
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync("backtests/lab-estudio9.json", "utf8"));
const B = JSON.parse(fs.readFileSync("backtests/lab-estudio9-50bp.json", "utf8"));
const f1 = (x) => `${(x * 100).toFixed(1)}%`;
const byName = (j) => Object.fromEntries(j.results.map((r) => [r.name, r]));
const a = byName(A), b = byName(B);
const ref20 = a["v1.1 ★"], ref50 = b["v1.1 ★"];
console.log(`ESTUDIO 9 — VEREDICTO · ${A.nConfigs} configs pre-registradas + ${A.nCombos}/${B.nCombos} combos · ensemble 10 fases\n`);
console.log("v1.1 referencia:");
console.log(`  20 pb  cierres  train peor ${f1(ref20.close.trainWorst)} media ${f1(ref20.close.trainMean)} · confirm media ${f1(ref20.close.confirmMean)} peor ${f1(ref20.close.confirmWorst)} · DD ${f1(ref20.close.ddRealWorst)}`);
console.log(`  20 pb  INTRADÍA train peor ${f1(ref20.intra.trainWorst)} media ${f1(ref20.intra.trainMean)} · confirm media ${f1(ref20.intra.confirmMean)} peor ${f1(ref20.intra.confirmWorst)} · DD ${f1(ref20.intra.ddRealWorst)} · st/a ${ref20.intra.stopsY.toFixed(1)}`);
console.log(`  50 pb  cierres  train peor ${f1(ref50.close.trainWorst)} · confirm media ${f1(ref50.close.confirmMean)} peor ${f1(ref50.close.confirmWorst)}`);
console.log(`  50 pb  INTRADÍA train peor ${f1(ref50.intra.trainWorst)} · confirm media ${f1(ref50.intra.confirmMean)} peor ${f1(ref50.intra.confirmWorst)} · DD ${f1(ref50.intra.ddRealWorst)}\n`);

const filas = [];
for (const name of Object.keys(a)) {
  if (name === "v1.1 ★") continue;
  const x = a[name], y = b[name];
  if (!y) continue;
  const G6 = x.pasa && y.pasa;
  const G8 = x.gates.G8 && y.gates.G8;
  filas.push({ name, eje: x.eje, pasa20: x.pasa, pasa50: y.pasa, G6, G8, todo: G6 && G8, trW20: x.close.trainWorst, trM20: x.close.trainMean, cf20: x.close.confirmMean, cfW20: x.close.confirmWorst, dd20: x.close.ddRealWorst, t20: x.tConfirm.t, dT: x.close.trainWorst - ref20.close.trainWorst, dC: x.close.confirmMean - ref20.close.confirmMean, trWi: x.intra.trainWorst, cfi: x.intra.confirmMean });
}
filas.sort((p, q) => q.trW20 - p.trW20);
console.log("config                              eje      ΔtrainPeor  Δconfirm   t    │ 20pb 50pb intra │ VEREDICTO");
for (const r of filas) console.log(`${r.name.padEnd(35)} ${r.eje.padEnd(8)} ${(r.dT * 100).toFixed(1).padStart(9)} pp ${(r.dC * 100).toFixed(1).padStart(8)} pp ${r.t20.toFixed(2).padStart(5)} │ ${r.pasa20 ? " ✓ " : " ✗ "}  ${r.pasa50 ? " ✓ " : " ✗ "}  ${r.G8 ? " ✓ " : " ✗ "}  │ ${r.todo ? "✅ PASA TODO" : ""}`);

const ganadores = filas.filter((r) => r.todo).sort((p, q) => q.trW20 - p.trW20 || q.trM20 - p.trM20);
console.log("\n═══ VEREDICTO ═══");
if (!ganadores.length) {
  console.log("NINGUNA configuración supera los gates pre-registrados a ambos costes y en intradía.");
  console.log("→ v1.1 (M189s10 · K5 · SCORE[10,40] · R63 · trailing 45% · RESCAN2) queda CERTIFICADA de nuevo. No se cambia nada.");
} else {
  const g = ganadores[0];
  console.log(`GANADOR: ${g.name} — trainWorst ${f1(g.trW20)} (+${(g.dT * 100).toFixed(1)} pp) · confirm ${f1(g.cf20)} (${(g.dC * 100 >= 0 ? "+" : "")}${(g.dC * 100).toFixed(1)} pp) · DD ${f1(g.dd20)} · t=${g.t20.toFixed(2)}`);
  if (ganadores.length > 1) console.log("Otros que pasan todo: " + ganadores.slice(1).map((r) => r.name).join(" · "));
  console.log("⚠ Adopción sujeta a auditoría adversarial independiente (norma de la casa) — nunca directa.");
}

// transparencia: el ranking INGENUO (por confirm) y sus trampas
console.log("\n═══ TRANSPARENCIA: si eligiéramos por el número más alto de confirmación (lo que NO se hace) ═══");
const ing = [...filas].sort((p, q) => q.cf20 - p.cf20).slice(0, 6);
for (const r of ing) console.log(`  ${r.name.padEnd(35)} confirm ${f1(r.cf20)} (${(r.dC * 100 >= 0 ? "+" : "")}${(r.dC * 100).toFixed(1)} pp) · train peor ${f1(r.trW20)} (${(r.dT * 100 >= 0 ? "+" : "")}${(r.dT * 100).toFixed(1)} pp) ${r.dC > 0 && r.dT < 0 ? "← test-brillante/train-flojo (trampa)" : ""}`);
