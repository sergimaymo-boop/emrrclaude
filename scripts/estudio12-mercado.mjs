/**
 * ESTUDIO 12 — CONGELADO DE SERIES DE MERCADO (12-nov-2026)
 * Descarga UNA vez y deja en backtests/estudio12-mercado.json las series diarias que usan
 * los indicadores de régimen del estudio 12 (VIX, crédito, tipos, MOVE, VVIX, SPY y el
 * histórico de Fear & Greed de CNN), con su huella sha256, para que el estudio sea
 * reproducible sin red. Reutiliza los cargadores ya auditados de backtest-fear-greed.mjs
 * (conservan los huecos como null; nunca chartPreviousClose). Solo cierres COMPLETADOS:
 * la vela del día en curso queda fuera (--end = última sesión cerrada).
 *   node scripts/estudio12-mercado.mjs --end 2026-11-11
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, parseArgs, loadYahoo, seriesQuality, loadCnn, sha256 } from "./backtest-fear-greed.mjs";

const opts = parseArgs(process.argv.slice(2), { end: "2026-11-11", cache: "/private/tmp/claude-501/estudio12-cache", offline: false, refresh: false, out: path.join(ROOT, "backtests/estudio12-mercado.json") });
const DESDE = "2015-01-01";
const SYMS = ["SPY", "^VIX", "HYG", "LQD", "^TNX", "^MOVE", "^VVIX"];
const series = {}, calidad = [];
for (const s of SYMS) {
  const y = await loadYahoo(s, opts);
  const q = seriesQuality(y);
  calidad.push(q);
  const bars = y.bars.filter((b) => b.date >= DESDE);
  series[s] = { bars, sha256: sha256(JSON.stringify(bars)), fetchedAt: y.fetchedAt };
  console.log(`${s.padEnd(6)} ${q.first} → ${q.last} · ${bars.length} barras desde ${DESDE} · huecos ${bars.filter((b) => b.close === null).length} · salto máx ${q.maxDailyJumpPct.pct}% (${q.maxDailyJumpPct.date})`);
  if (q.last < opts.end) console.log(`   ⚠ ${s}: la serie acaba el ${q.last}, antes de ${opts.end}`);
}
let cnn = null;
try {
  const c = await loadCnn(opts);
  cnn = { usable: c.usable, sha256: c.sha256, fetchedAt: c.fetchedAt, firstPoint: c.firstPoint, placeholderRuns: c.placeholderRuns };
  console.log(`CNN F&G: ${c.usable.length} cierres utilizables ${c.usable[0]?.date} → ${c.usable.at(-1)?.date}`);
} catch (e) { console.log(`⚠ CNN F&G no disponible: ${e.message} — el estudio lo dirá y seguirá sin él`); }
fs.writeFileSync(opts.out, JSON.stringify({ generadoUtc: new Date().toISOString(), end: opts.end, desde: DESDE, series, cnn, calidad }));
console.log(`Guardado ${path.relative(ROOT, opts.out)} (${(fs.statSync(opts.out).size / 1e6).toFixed(2)} MB)`);
