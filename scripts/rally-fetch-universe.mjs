/**
 * RALLY — descarga durable de 10 años de barras diarias (con volumen) del universo
 * completo de 606 tickers. Se guarda en data/ (NO en /tmp, que se purga) para que
 * el backtest sea reproducible entre sesiones.
 */
import fs from "node:fs";
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";

const OUT = "data/universe-10y.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = [];
for (const [ex, list] of Object.entries(STATIC_ASSETS_BY_EXCHANGE)) {
  for (const a of list) targets.push({ sym: `${a.Code}.${ex}`, yahoo: toYahooSymbol(`${a.Code}.${ex}`), name: a.Name, exchange: ex, currency: a.Currency });
}
// Benchmark: el rally score mide fuerza RELATIVA contra el S&P 500.
targets.push({ sym: "SPY.US", yahoo: "SPY", name: "S&P 500 ETF", exchange: "US", currency: "USD" });

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { fetchedAt: null, series: {} };
const series = existing.series ?? {};

async function fetchOne(y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=10y&interval=1d&events=split`;
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r?.timestamp) throw new Error("sin datos");
      const q = r.indicators.quote[0], adj = r.indicators?.adjclose?.[0]?.adjclose ?? null;
      const bars = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        const c = q.close?.[i];
        if (c == null || !Number.isFinite(c) || c <= 0) continue;
        bars.push({
          d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
          h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c,
          a: adj?.[i] ?? c, v: q.volume?.[i] ?? 0,
        });
      }
      return bars.length >= 300 ? bars : null;
    } catch {
      if (a === 3) return null;
      await sleep(700 * a);
    }
  }
  return null;
}

let ok = 0, fail = 0, skip = 0;
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  if (series[t.sym]?.bars?.length) { skip++; continue; }
  const bars = await fetchOne(t.yahoo);
  if (bars) { series[t.sym] = { name: t.name, exchange: t.exchange, currency: t.currency, bars }; ok++; }
  else fail++;
  if ((i + 1) % 40 === 0) {
    fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), series }));
    console.log(`  ${i + 1}/${targets.length} · ok ${ok} · fallos ${fail} · ya estaban ${skip}`);
  }
  await sleep(260);
}
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), series }));
console.log(`\nFIN: ${Object.keys(series).length} tickers con histórico · ok ${ok} · fallos ${fail} · ${(fs.statSync(OUT).size / 1e6).toFixed(0)} MB`);
