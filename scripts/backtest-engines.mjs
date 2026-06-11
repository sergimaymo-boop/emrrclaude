/**
 * BACKTEST COMPARATIVO DE MOTORES (offline). Enfrenta los pickers per-ticker:
 *   1. TOP 8        (scoreEngine.calculateScore)      — momentum/calidad
 *   2. Rally        (rallyScoreEngine.calculateRallyScore) — momentum/breakout
 *   3. Watchlist    (breadth scoreTickerRank)          — contrario/sobreventa
 * Walk-forward sin lookahead, 5 años. Métrica clave: retorno FORWARD real de las selecciones
 * de cada motor vs el universo (alpha), + hit-rate + IC. Responde: ¿cuál maximiza beneficio al entrar?
 */
import fs from "node:fs";
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";
import { calculateTechnicals } from "../api/_lib/technicalEngine.js";
import { calculateScore } from "../api/_lib/scoreEngine.js";
import { calculateRallyScore } from "../api/_lib/rallyScoreEngine.js";
import { computeTickerRankFeatures, scoreTickerRank } from "../api/_lib/marketBreadthEngine.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const HORIZONS = [126, 189, 252];
const STEP = 7;
const WINDOW = 290;
const TOPN = 8;
const CACHE = "/tmp/emrr-bars-5y.json";

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
function rank(arr) { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; }
function spearman(x, y) { const rx = rank(x), ry = rank(y); const mx = mean(rx), my = mean(ry); return mean(rx.map((v, i) => (v - mx) * (ry[i] - my))) / (std(rx) * std(ry)); }

async function fetchBars(sym) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json(); const r = d?.chart?.result?.[0]; if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const bars = r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
      .filter((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.open) && b.open > 0 && Number.isFinite(b.high) && Number.isFinite(b.low));
    return bars.length >= 280 ? bars : null;
  } catch { return null; }
}
async function pool(items, worker, c = 6) { const out = []; let i = 0; await Promise.all(Array.from({ length: c }, async () => { while (i < items.length) { const k = i++; out[k] = await worker(items[k]); } })); return out; }

// ── Datos (cache) ──
let fetched, spy;
if (fs.existsSync(CACHE)) {
  console.log("Cargando datos cacheados…");
  const j = JSON.parse(fs.readFileSync(CACHE, "utf8")); fetched = j.fetched; spy = j.spy;
} else {
  const all = [];
  for (const [ex, assets] of Object.entries(STATIC_ASSETS_BY_EXCHANGE))
    for (const a of assets) { const y = toYahooSymbol(`${a.Code}.${ex}`); if (y) all.push({ ex, sym: `${a.Code}.${ex}`, region: ex === "US" ? "USA" : "Europe", yahoo: y }); }
  console.log(`Descargando ${all.length} símbolos (5y)…`);
  spy = await fetchBars("SPY");
  fetched = (await pool(all, async (s) => { const b = await fetchBars(s.yahoo); return b ? { ...s, bars: b } : null; })).filter(Boolean);
  fs.writeFileSync(CACHE, JSON.stringify({ fetched, spy }));
}
const spyDates = spy.map((b) => b.date), spyClose = new Map(spy.map((b) => [b.date, b.close]));
for (const f of fetched) f.byDate = new Map(f.bars.map((b, i) => [b.date, i]));
console.log(`Listos ${fetched.length} tickers. Rango ${spyDates[0]}→${spyDates.at(-1)}\n`);

// ── Walk-forward: 3 scores por ticker/fecha + retornos forward ──
const ENGINES = ["TOP8", "RALLY", "WATCHLIST"];
const rowsByDate = [];
for (let d = 230; d < spyDates.length - Math.max(...HORIZONS) - 1; d += STEP) {
  const dt = spyDates[d];
  const spySub = spy.slice(Math.max(0, d - WINDOW), d + 1);
  const recs = [];
  for (const f of fetched) {
    const hi = f.byDate.get(dt); if (hi === undefined || hi < 230) continue;
    const bars = f.bars.slice(Math.max(0, hi - WINDOW), hi + 1);
    if (bars.length < 130) continue;
    const fwd = {}; for (const H of HORIZONS) { const j = hi + H; fwd[H] = j < f.bars.length ? (f.bars[j].close / f.bars[hi].close - 1) * 100 : null; }
    if (HORIZONS.some((H) => fwd[H] === null)) continue;
    // TOP8
    const tech = calculateTechnicals(bars, spySub);
    const s8 = tech.ok ? calculateScore({ technicals: tech.technicals, eligibleForScore: true, operabilityStatus: "OPERABLE", dataQuality: tech.dataQuality }) : null;
    const top8 = (s8 && s8.score !== null) ? s8.score : null;
    // RALLY
    const ry = calculateRallyScore({ bars, spyBars: spySub, region: f.region });
    const rally = ry.ok ? ry.rallyScore : null;
    // WATCHLIST
    const ft = computeTickerRankFeatures(bars); const wr = ft ? scoreTickerRank(ft) : null;
    const watch = wr ? wr.score : null;
    recs.push({ sym: f.sym, fwd, scores: { TOP8: top8, RALLY: rally, WATCHLIST: watch } });
  }
  if (recs.length >= 40) rowsByDate.push({ dt, recs });
}
console.log(`Fechas: ${rowsByDate.length} (${rowsByDate[0]?.dt}→${rowsByDate.at(-1)?.dt})\n`);

// ── Métricas por motor y horizonte: retorno de top-8 vs universo, hit-rate, IC ──
for (const H of HORIZONS) {
  console.log(`══════ HORIZONTE ${H} sesiones ══════`);
  const uniAll = [];
  for (const day of rowsByDate) for (const r of day.recs) uniAll.push(r.fwd[H]);
  const uniMean = mean(uniAll);
  const winRateBase = uniAll.filter((x) => x > 0).length / uniAll.length;
  console.log(`Universo (buy-and-hold medio): ${uniMean.toFixed(2)}% | % positivos: ${(winRateBase * 100).toFixed(0)}%`);
  console.log("  Motor      | ret. top8 | alpha vs univ | % positivos | % bate univ | IC");
  for (const eng of ENGINES) {
    const picksFwd = [], allScores = [], allFwd = []; let beatUni = 0, totPick = 0;
    for (const day of rowsByDate) {
      const scored = day.recs.filter((r) => r.scores[eng] !== null && Number.isFinite(r.scores[eng]));
      if (scored.length < 20) continue;
      const dayMean = mean(scored.map((r) => r.fwd[H]));
      for (const r of scored) { allScores.push(r.scores[eng]); allFwd.push(r.fwd[H]); }
      const top = scored.slice().sort((a, b) => b.scores[eng] - a.scores[eng]).slice(0, TOPN);
      for (const r of top) { picksFwd.push(r.fwd[H]); totPick++; if (r.fwd[H] > dayMean) beatUni++; }
    }
    const ic = spearman(allScores, allFwd);
    const ret = mean(picksFwd), pos = picksFwd.filter((x) => x > 0).length / picksFwd.length;
    console.log(`  ${eng.padEnd(10)} | ${ret.toFixed(2).padStart(7)}% | ${(ret - uniMean).toFixed(2).padStart(8)}pp | ${(pos * 100).toFixed(0).padStart(8)}% | ${(beatUni / totPick * 100).toFixed(0).padStart(8)}% | ${ic.toFixed(3)}`);
  }
  console.log("");
}
