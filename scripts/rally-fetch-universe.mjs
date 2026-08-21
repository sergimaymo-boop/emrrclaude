/**
 * RALLY — descarga durable de 10 años de barras diarias (con volumen) del universo
 * completo de 606 tickers. Se guarda en data/ (NO en /tmp, que se purga) para que
 * el backtest sea reproducible entre sesiones.
 *
 * ACTUALIZACIÓN INCREMENTAL (corregido 21-ago-2026): la versión anterior SALTABA
 * cualquier ticker que ya tuviera barras guardadas — así que una vez descargado el
 * universo una vez, ninguna ejecución posterior traía datos nuevos, aunque
 * `fetchedAt` se reescribía con la fecha del día (falso sello de frescura: el
 * 21-ago se ejecutó y guardó "hoy" con datos que seguían siendo del 7-ago). Ahora
 * se pide solo un rango corto (60 días) para los tickers que ya existen y se
 * fusiona por fecha con lo guardado — barato en llamadas y siempre al día.
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

async function fetchOne(y, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=${range}&interval=1d&events=split`;
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
      return bars;
    } catch {
      if (a === 3) return null;
      await sleep(700 * a);
    }
  }
  return null;
}

/** Fusiona por fecha: las barras nuevas SUSTITUYEN a las viejas en fechas repetidas
 *  (Yahoo puede revisar cierres recientes), y se añaden las fechas que faltaban. */
function fusionar(previas, nuevas) {
  const porFecha = new Map(previas.map((b) => [b.d, b]));
  for (const b of nuevas) porFecha.set(b.d, b);
  return [...porFecha.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

let nuevo = 0, actualizado = 0, fail = 0;
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const tieneHistorico = series[t.sym]?.bars?.length >= 300;
  // Ticker nuevo (o histórico insuficiente) → 10 años completos. Ticker ya conocido
  // → solo los últimos 60 días naturales, de sobra para cubrir festivos/fines de
  // semana y fusionar con lo que ya había.
  const bars = await fetchOne(t.yahoo, tieneHistorico ? "3mo" : "10y");
  if (bars && bars.length) {
    const previas = series[t.sym]?.bars ?? [];
    const fusionadas = tieneHistorico ? fusionar(previas, bars) : bars;
    if (fusionadas.length >= 300) {
      series[t.sym] = { name: t.name, exchange: t.exchange, currency: t.currency, bars: fusionadas };
      tieneHistorico ? actualizado++ : nuevo++;
    } else fail++;
  } else fail++;
  if ((i + 1) % 40 === 0) {
    fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), series }));
    console.log(`  ${i + 1}/${targets.length} · nuevos ${nuevo} · actualizados ${actualizado} · fallos ${fail}`);
  }
  await sleep(260);
}
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), series }));
console.log(`\nFIN: ${Object.keys(series).length} tickers con histórico · nuevos ${nuevo} · actualizados ${actualizado} · fallos ${fail} · ${(fs.statSync(OUT).size / 1e6).toFixed(0)} MB`);
