/**
 * SP500 MODULE — descarga de histórico largo para el estudio de entradas/salidas.
 * Fuente: Yahoo chart API (gratuita, sin clave). Guarda en data/sp500-history.json
 * para que NO dependa de /tmp (que se purga) y el estudio sea reproducible.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("data/sp500-history.json");
const SYMBOLS = [
  "^GSPC",  // índice S&P 500 (1927+) — serie de precio más larga
  "SPY",    // ETF de referencia (1993+) — el instrumento real
  "^VIX",   // volatilidad implícita
  "^VXV",   // VIX 3 meses (curva)
  "HYG",    // crédito high yield (risk appetite)
  "LQD",    // crédito investment grade
  "IEF",    // bonos 7-10y (activo refugio / rendimiento fuera del mercado)
  "TLT",    // bonos 20y+
  "^TNX",   // tipo 10y
  "RSP",    // S&P500 equiponderado (amplitud interna)
  "XLK","XLF","XLV","XLY","XLP","XLE","XLI","XLU","XLB","XLRE","XLC", // sectores SP500
  "SSO",    // 2x S&P500 (validación del modelo de apalancamiento)
  "UPRO",   // 3x S&P500
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=9999999999&interval=1d&events=div%7Csplit`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) throw new Error("sin result");
      const ts = r.timestamp || [];
      const q = r.indicators?.quote?.[0] || {};
      const adj = r.indicators?.adjclose?.[0]?.adjclose || null;
      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i];
        if (c == null || !Number.isFinite(c)) continue;
        bars.push({
          date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          open: q.open?.[i] ?? c, high: q.high?.[i] ?? c, low: q.low?.[i] ?? c,
          close: c, adj: adj?.[i] ?? c, vol: q.volume?.[i] ?? 0,
        });
      }
      if (!bars.length) throw new Error("0 barras");
      return bars;
    } catch (err) {
      if (attempt === 4) { console.error(`  ✗ ${sym}: ${err.message}`); return null; }
      await sleep(900 * attempt);
    }
  }
  return null;
}

const out = {};
for (const sym of SYMBOLS) {
  const bars = await fetchOne(sym);
  if (bars) { out[sym] = bars; console.log(`  ✓ ${sym.padEnd(6)} ${bars.length} barras  ${bars[0].date} → ${bars.at(-1).date}`); }
  await sleep(350);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), series: out }));
console.log(`\nGuardado en ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
