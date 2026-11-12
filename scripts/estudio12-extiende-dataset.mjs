/**
 * ESTUDIO 12 — EXTENSIÓN DEL DATASET PARA LA VENTANA NUEVA (12-nov-2026)
 * Crea data/universe-10y-ext-<fin>.json = el dataset canon SIN TOCAR (barras ≤ su último
 * día bit a bit iguales) + las sesiones posteriores, encadenadas por RETORNO AJUSTADO:
 *   a_nuevo(d) = a_canon(último) × a_yahoo(d) / a_yahoo(último)
 * Así no aparece el escalón falso que deja fusionar ajustados de dos descargas distintas
 * (un dividendo posterior re-escala todo el histórico de Yahoo). El canon NO se reescribe:
 * los estudios congelados siguen leyendo data/universe-10y.json.
 * Reglas duras: solo sesiones CERRADAS (≤ --end); si el cierre crudo de Yahoo en el día de
 * enganche difiere del canon más de un 0,5% se asume split posterior y los crudos nuevos se
 * re-escalan a la base del canon (el ajustado no cambia); ticker sin día de enganche → no se
 * extiende y se lista. Uso: node scripts/estudio12-extiende-dataset.mjs --end 2026-11-11
 */
import fs from "node:fs";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";

const END = process.argv.includes("--end") ? process.argv[process.argv.indexOf("--end") + 1] : null;
if (!/^\d{4}-\d{2}-\d{2}$/.test(END ?? "")) throw new Error("falta --end AAAA-MM-DD (última sesión CERRADA)");
const IN = "data/universe-10y.json", OUT = `data/universe-10y-ext-${END}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;

async function fetchYahoo(y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=6mo&interval=1d&events=div%2Csplit`;
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json())?.chart?.result?.[0];
      if (!r?.timestamp) throw new Error("sin serie");
      const q = r.indicators.quote[0], adj = r.indicators?.adjclose?.[0]?.adjclose ?? [];
      const bars = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        const c = q.close?.[i], a2 = adj[i];
        if (!num(c) || !num(a2)) continue;
        bars.push({ d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), h: num(q.high?.[i]) ? q.high[i] : c, l: num(q.low?.[i]) ? q.low[i] : c, c, a: a2, v: q.volume?.[i] ?? 0 });
      }
      return bars;
    } catch (e) { if (a === 4) return null; await sleep(800 * a); }
  }
  return null;
}

const raw = JSON.parse(fs.readFileSync(IN, "utf8"));
const series = raw.series, syms = Object.keys(series);
const finCanon = series["SPY.US"].bars.at(-1).d;
const informe = { extendidos: 0, sinDatos: [], sinEnganche: [], splits: [], barrasNuevas: 0 };
for (const [n, sym] of syms.entries()) {
  const prev = series[sym].bars, last = prev.at(-1);
  const y = sym === "SPY.US" ? "SPY" : toYahooSymbol(sym);
  const fresh = y ? await fetchYahoo(y) : null;
  if (!fresh?.length) { informe.sinDatos.push(sym); await sleep(200); continue; }
  const ancla = fresh.find((b) => b.d === last.d);
  if (!ancla) { informe.sinEnganche.push(`${sym} (canon acaba ${last.d})`); await sleep(200); continue; }
  let esc = 1;
  if (Math.abs(ancla.c / last.c - 1) > 0.005) { esc = last.c / ancla.c; informe.splits.push(`${sym}: crudo ${last.c.toFixed(2)} canon vs ${ancla.c.toFixed(2)} Yahoo el ${last.d} (×${esc.toFixed(4)})`); }
  const nuevas = fresh.filter((b) => b.d > last.d && b.d <= END).map((b) => ({ d: b.d, h: b.h * esc, l: b.l * esc, c: b.c * esc, a: last.a * (b.a / ancla.a), v: b.v }));
  if (nuevas.length) { series[sym] = { ...series[sym], bars: [...prev, ...nuevas] }; informe.extendidos++; informe.barrasNuevas += nuevas.length; }
  if ((n + 1) % 60 === 0) console.log(`  ${n + 1}/${syms.length} · extendidos ${informe.extendidos} · sin datos ${informe.sinDatos.length} · sin enganche ${informe.sinEnganche.length}`);
  await sleep(230);
}
// fetchedAt pasa a ser el de la EXTENSIÓN (el comprobador de sanidad lo usa como "día de la descarga")
fs.writeFileSync(OUT, JSON.stringify({ ...raw, fetchedAt: new Date().toISOString(), canonFetchedAt: raw.fetchedAt, series, extension: { canonHasta: finCanon, hasta: END, generadoUtc: new Date().toISOString(), metodo: "retorno ajustado encadenado; canon intacto", ...informe } }));
console.log(`\nFIN: ${OUT} · ${informe.extendidos}/${syms.length} tickers extendidos · ${informe.barrasNuevas} barras nuevas · SPY ${finCanon} → ${series["SPY.US"].bars.at(-1).d}`);
console.log(`sin datos (${informe.sinDatos.length}): ${informe.sinDatos.join(", ") || "—"}`);
console.log(`sin enganche (${informe.sinEnganche.length}): ${informe.sinEnganche.join(", ") || "—"}`);
console.log(`splits re-escalados (${informe.splits.length}): ${informe.splits.join(" | ") || "—"}`);
