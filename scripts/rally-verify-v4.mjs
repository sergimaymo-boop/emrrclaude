/**
 * VERIFICACIÓN v4 — el motor de producción debe puntuar clamp(50+50·tanh(m9/75))
 * y por tanto ordenar EXACTAMENTE igual que el momento a 9 meses crudo con el que
 * se validó la estrategia. Si esto falla, el panel enseña otra estrategia.
 */
import fs from "node:fs";
import { calculateRallyScore } from "../api/_lib/rallyScoreEngine.js";

const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8"));
const series = raw.series;
const spy = series["SPY.US"].bars;
const toBars = (arr) => arr.map((b) => ({ date: b.d, open: b.c, high: b.h, low: b.l, close: b.c, volume: b.v }));
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

let n = 0, maxDiff = 0, bad = 0;
const syms = Object.keys(series).filter((s) => s !== "SPY.US");
for (let si = 0; si < syms.length; si += 23) {
  const sym = syms[si];
  const bars = series[sym].bars;
  for (const frac of [0.6, 0.8, 1.0]) {
    const cut = Math.floor(bars.length * frac);
    if (cut < 300) continue;
    const slice = bars.slice(0, cut);
    const closes = slice.map((b) => b.c);
    if (closes.length < 190 || closes[closes.length - 190] <= 0) continue;
    const m9 = ((closes[closes.length - 1] - closes[closes.length - 190]) / closes[closes.length - 190]) * 100;
    const expected = Math.round(clamp(50 + 50 * Math.tanh(m9 / 75)));
    const endDate = slice.at(-1).d;
    const spySlice = spy.filter((b) => b.d <= endDate);
    const prod = calculateRallyScore({ bars: toBars(slice), spyBars: toBars(spySlice), region: series[sym].exchange === "US" ? "USA" : "EU" });
    if (!prod.ok) continue;
    n++;
    const diff = Math.abs(prod.rallyScore - expected);
    if (diff > maxDiff) maxDiff = diff;
    if (diff > 1) { bad++; if (bad <= 5) console.log(`  desvío ${diff} en ${sym} @ ${endDate}: prod ${prod.rallyScore} vs esperado ${expected} (m9 ${m9.toFixed(1)}%)`); }
  }
}
console.log(`\nEQUIVALENCIA v4: ${n} muestras · desvío máximo ${maxDiff} · ${bad} por encima de 1 punto`);
if (bad > 0) { console.error("❌ El motor NO puntúa la fórmula v4 validada."); process.exit(1); }
console.log("✅ El motor de producción puntúa exactamente la fórmula v4 validada (momento 9m).");
