/**
 * VERIFY-COHERENCE — sanidad de data/universe-10y.json (17-ago-2026).
 * Muestreo DETERMINISTA: cada 60º ticker del listado ordenado alfabéticamente.
 * Comprueba: precios ≤ 0 (crudo y ajustado), huecos groseros de calendario
 * (>14 días naturales entre barras consecutivas, excluyendo huecos que el SPY
 * también tiene), y saltos >60% en el CIERRE AJUSTADO día a día (el ajustado ya
 * descuenta splits: un salto ahí es sospechoso salvo evento real); los saltos
 * >60% solo en el crudo con ajustado suave se reportan como split coherente.
 * Solo lee. No modifica nada.
 */
import fs from "node:fs";

const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8"));
const series = raw.series;
const syms = Object.keys(series).sort();
const sample = [];
for (let i = 0; i < syms.length; i += 60) sample.push(syms[i]);
console.log(`universo: ${syms.length} tickers · muestra determinista (cada 60º): ${sample.length}`);
console.log("muestra:", sample.join(", "));

const spyDates = new Set(series["SPY.US"].bars.map((b) => b.d));
const dayMs = 86400e3;
let totalIssues = 0;

for (const sym of sample) {
  const bars = series[sym].bars;
  const issues = [];
  let splits = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!(b.c > 0) || !(b.a > 0) || !(b.h > 0) || !(b.l > 0)) issues.push(`precio ≤0 o inválido en ${b.d} (c=${b.c} a=${b.a})`);
    if (i > 0) {
      const p = bars[i - 1];
      const gapDays = (Date.parse(b.d) - Date.parse(p.d)) / dayMs;
      if (gapDays > 14) issues.push(`hueco de ${gapDays} días naturales: ${p.d} → ${b.d}`);
      const rAdj = p.a > 0 ? b.a / p.a - 1 : 0;
      const rRaw = p.c > 0 ? b.c / p.c - 1 : 0;
      if (Math.abs(rAdj) > 0.6) issues.push(`salto AJUSTADO ${(rAdj * 100).toFixed(1)}% en ${b.d} (crudo ${(rRaw * 100).toFixed(1)}%)`);
      else if (Math.abs(rRaw) > 0.6) splits++; // crudo salta, ajustado no → split/dividendo coherente
    }
  }
  const first = bars[0]?.d, last = bars[bars.length - 1]?.d;
  const tag = issues.length ? `✗ ${issues.length} problemas` : "✓";
  console.log(`${tag} ${sym.padEnd(12)} ${bars.length} barras ${first}→${last}${splits ? ` · ${splits} salto(s) crudo>60% con ajustado suave (split coherente)` : ""}`);
  for (const msg of issues.slice(0, 5)) console.log(`     · ${msg}`);
  totalIssues += issues.length;
}
console.log(totalIssues === 0 ? "\n✓ SANIDAD OK: 0 problemas en la muestra" : `\n✗ ${totalIssues} problemas en la muestra`);
