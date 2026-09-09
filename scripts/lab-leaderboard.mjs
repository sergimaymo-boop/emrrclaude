/**
 * RANKING GLOBAL — TODO lo probado en Rally-Test (estudios 2, 3, lab-day B-G, stop-audit,
 * ex-COVID, red-dormir, estudio 9). Dos lecturas: la INGENUA (mayor confirm) y la de la
 * CASA (mayor train peor-fase sin perder confirm). Solo lectura de JSONs.
 */
import fs from "node:fs";
const f1 = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "   —  ");
const rows = [];
const add = (src, name, r) => {
  if (!r) return;
  let trainWorst = r.trainWorst, trainMean = r.trainMean, confirmMean = r.confirmMean, confirmWorst = r.confirmWorst, dd = r.ddRealWorst ?? r.ddFullWorst, fases = r.fasesDistintas;
  if ((trainWorst == null || confirmMean == null) && Array.isArray(r.cells) && r.cells.length && r.cells[0].train?.cagr != null) {
    const tr = r.cells.map((c) => c.train.cagr), cf = r.cells.map((c) => c.confirm.cagr);
    trainWorst = Math.min(...tr); trainMean = tr.reduce((s, v) => s + v, 0) / tr.length; confirmMean = cf.reduce((s, v) => s + v, 0) / cf.length; confirmWorst = Math.min(...cf);
    fases = fases ?? new Set(cf.map((v) => Math.round(v * 1e10))).size;
  }
  if (!Number.isFinite(trainWorst) || !Number.isFinite(confirmMean)) return;
  rows.push({ src, name, trainWorst, trainMean, confirmMean, confirmWorst, dd, fases: fases ?? null });
};
const files = fs.readdirSync("backtests").filter((f) => /^(rally-test-engine-study[23]|lab-day-fase[B-G]|lab-stop-audit|lab-excovid-stop|lab-red-dormir|lab-estudio9)\.json$/.test(f));
for (const f of files) {
  const j = JSON.parse(fs.readFileSync("backtests/" + f, "utf8"));
  for (const r of j.results ?? []) add(f.replace(".json", ""), r.name, f.startsWith("lab-estudio9") ? { ...r.close, name: r.name } : r);
}
const ref = rows.find((r) => r.src === "lab-estudio9" && r.name === "v1.1 ★") ?? rows.find((r) => /v1\.1/.test(r.name));
console.log(`RANKING GLOBAL · ${rows.length} configuraciones evaluadas (20 pb) · referencia v1.1: train peor ${f1(ref?.trainWorst)} · confirm ${f1(ref?.confirmMean)}\n`);
const linea = (r) => `${(r.src + " · " + r.name).slice(0, 62).padEnd(62)} trPeor ${f1(r.trainWorst).padStart(6)} trMed ${f1(r.trainMean).padStart(6)} │ cfMed ${f1(r.confirmMean).padStart(6)} cfPeor ${f1(r.confirmWorst).padStart(6)} │ DD ${f1(r.dd).padStart(6)}${r.fases != null && r.fases < 10 ? ` ⚠${r.fases}/10` : ""}`;
console.log("═══ LECTURA INGENUA — top 15 por confirmación media (la cifra 'más ganadora') ═══");
for (const r of [...rows].filter((r) => r.fases == null || r.fases === 10).sort((p, q) => q.confirmMean - p.confirmMean).slice(0, 15)) console.log(linea(r) + (ref && r.trainWorst < ref.trainWorst ? "  ← pierde en TRAIN" : ""));
console.log("\n═══ LECTURA DE LA CASA — top 15 por train peor-fase, sin perder confirm respecto a v1.1 ═══");
for (const r of [...rows].filter((r) => (r.fases == null || r.fases === 10) && (!ref || r.confirmMean >= ref.confirmMean - 1e-9)).sort((p, q) => q.trainWorst - p.trainWorst).slice(0, 15)) console.log(linea(r));
