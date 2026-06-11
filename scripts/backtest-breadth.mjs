/**
 * BACKTEST del Motor de Market Breadth — análisis OFFLINE (no desplegado).
 * Reconstruye el veredicto del módulo en cada día histórico (walk-forward, sin lookahead)
 * usando LAS MISMAS funciones del motor, y lo contrasta con el retorno forward del SPY.
 * Mide: retorno medio condicional por veredicto, hit-rate direccional, y detección de pullbacks.
 *
 * Datos: Yahoo (con User-Agent). Muestra representativa del universo real (US+EU proporcional).
 */
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { calculateTechnicals } from "../api/_lib/technicalEngine.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";
import {
  computeTickerBreadthSignals, emptyBreadthAggregator, foldTickerSignals,
  computeBreadthVerdict,
} from "../api/_lib/marketBreadthEngine.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const HORIZONS = [5, 10];
const SAMPLE_PER_EXCHANGE = { US: 130, XETRA: 28, PA: 16, AS: 10, MI: 10, SW: 10, LSE: 12, BR: 4, LS: 4 };
const STEP = 2; // evaluar cada 2 sesiones (suficiente, mitad de cómputo)

async function fetchBars(yahooSymbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1y`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json();
    const r = d?.chart?.result?.[0];
    if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const bars = r.timestamp.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0,
    })).filter((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.open) && b.open > 0);
    return bars.length >= 120 ? bars : null;
  } catch { return null; }
}

async function pool(items, worker, concurrency = 8) {
  const out = []; let i = 0;
  async function run() { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx]); } }
  await Promise.all(Array.from({ length: concurrency }, run));
  return out;
}

// Build sample of provider symbols → yahoo symbols
const sample = [];
for (const [ex, n] of Object.entries(SAMPLE_PER_EXCHANGE)) {
  const assets = STATIC_ASSETS_BY_EXCHANGE[ex] ?? [];
  const stepEx = Math.max(1, Math.floor(assets.length / n));
  for (let k = 0; k < assets.length && sample.filter((s) => s.ex === ex).length < n; k += stepEx) {
    const providerSymbol = `${assets[k].Code}.${ex}`;
    const y = toYahooSymbol(providerSymbol);
    if (y) sample.push({ ex, providerSymbol, yahoo: y });
  }
}
console.log(`Muestra: ${sample.length} tickers (US+EU). Descargando histórico…`);

const spyBarsAll = await fetchBars("SPY");
if (!spyBarsAll) { console.error("No SPY"); process.exit(1); }
const spyDates = spyBarsAll.map((b) => b.date);
const spyCloseByDate = new Map(spyBarsAll.map((b) => [b.date, b.close]));

const fetched = await pool(sample, async (s) => ({ ...s, bars: await fetchBars(s.yahoo) }), 8);
const ok = fetched.filter((f) => f.bars);
console.log(`Descargados ${ok.length}/${sample.length} con histórico válido.\n`);

// Walk-forward: para cada fecha de SPY, reconstruir el veredicto con datos hasta esa fecha.
const records = [];
const adNetSeries = []; // serie incremental para McClellan, como en producción

for (let d = 70; d < spyDates.length - Math.max(...HORIZONS) - 1; d += STEP) {
  const dt = spyDates[d];
  const spySub = spyBarsAll.slice(0, d + 1);
  if (spySub.length < 61) continue;

  // spyBullish as-of: close > EMA200 (si hay >=200 barras)
  let spyBullish = null;
  if (spySub.length >= 200) {
    const closes = spySub.map((b) => b.close);
    // EMA200 inline
    const k = 2 / (200 + 1); let ema = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
    for (let i = 200; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    spyBullish = closes[closes.length - 1] > ema;
  }

  const agg = emptyBreadthAggregator();
  for (const f of ok) {
    const sub = f.bars.filter((b) => b.date <= dt);
    if (sub.length < 61) continue;
    const tech = calculateTechnicals(sub, spySub);
    const sig = computeTickerBreadthSignals(tech.ok ? tech : { technicals: null }, sub);
    foldTickerSignals(agg, sig);
  }
  if (agg.total < 50) continue;

  const verdict = computeBreadthVerdict(agg, { spyBullish, adNetSeries: [...adNetSeries] });
  adNetSeries.push(verdict.adNet);

  records.push({
    date: dt, idx: d, verdict: verdict.verdict, score: verdict.score,
    spyClose: spyCloseByDate.get(dt), analyzed: agg.total,
  });
}

console.log(`Veredictos reconstruidos: ${records.length} (cada ${STEP} sesiones, ~${records.length * STEP} días de mercado)\n`);

// Métricas por horizonte
function pct(x) { return (x * 100).toFixed(1) + "%"; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

for (const H of HORIZONS) {
  const rows = records.map((r) => {
    const fwdIdx = r.idx + H;
    const fwdClose = spyCloseByDate.get(spyDates[fwdIdx]);
    const fwdRet = (Number.isFinite(fwdClose) && r.spyClose) ? ((fwdClose - r.spyClose) / r.spyClose) * 100 : null;
    return { ...r, fwdRet };
  }).filter((r) => r.fwdRet !== null);

  const byV = { BULLISH: [], DETERIORATING: [], PULLBACK_IMMINENT: [] };
  for (const r of rows) (byV[r.verdict] ??= []).push(r.fwdRet);

  // Hit-rate direccional (buckets no solapados, como el feedback del motor)
  let hits = 0;
  for (const r of rows) {
    const h = r.verdict === "BULLISH" ? r.fwdRet > 1 : r.verdict === "PULLBACK_IMMINENT" ? r.fwdRet < -1 : (r.fwdRet >= -1 && r.fwdRet <= 1);
    if (h) hits++;
  }

  // Detección de pullbacks reales (fwd < -2%): recall y precisión de las señales 🟡/🔴
  const realDrops = rows.filter((r) => r.fwdRet < -2);
  const warned = realDrops.filter((r) => r.verdict !== "BULLISH");
  const warnings = rows.filter((r) => r.verdict !== "BULLISH");
  const warningsFollowedByWeak = warnings.filter((r) => r.fwdRet < 0);

  // Correlación score ↔ retorno forward (Pearson)
  const xs = rows.map((r) => r.score), ys = rows.map((r) => r.fwdRet);
  const mx = mean(xs), my = mean(ys);
  const cov = mean(rows.map((r) => (r.score - mx) * (r.fwdRet - my)));
  const sx = Math.sqrt(mean(xs.map((x) => (x - mx) ** 2))), sy = Math.sqrt(mean(ys.map((y) => (y - my) ** 2)));
  const corr = (sx && sy) ? cov / (sx * sy) : 0;

  console.log(`══════ HORIZONTE ${H} sesiones (${rows.length} muestras) ══════`);
  console.log(`Retorno medio SPY tras cada veredicto (el EDGE — deben ordenarse 🟢 > 🟡 > 🔴):`);
  console.log(`  🟢 BULLISH:           ${pct(mean(byV.BULLISH) / 100)}  (n=${byV.BULLISH.length})`);
  console.log(`  🟡 DETERIORATING:     ${pct(mean(byV.DETERIORATING) / 100)}  (n=${byV.DETERIORATING.length})`);
  console.log(`  🔴 PULLBACK_IMMINENT: ${pct(mean(byV.PULLBACK_IMMINENT) / 100)}  (n=${byV.PULLBACK_IMMINENT.length})`);
  console.log(`Hit-rate direccional global: ${pct(hits / rows.length)}`);
  console.log(`Pullbacks reales (SPY fwd < -2%): ${realDrops.length} | avisados con 🟡/🔴 (recall): ${realDrops.length ? pct(warned.length / realDrops.length) : "n/a"}`);
  console.log(`Señales 🟡/🔴 seguidas de debilidad fwd<0 (precisión): ${warnings.length ? pct(warningsFollowedByWeak.length / warnings.length) : "n/a"}`);
  console.log(`Correlación score↔retorno forward: ${corr.toFixed(3)}\n`);
}

// Distribución de veredictos
const dist = {};
for (const r of records) dist[r.verdict] = (dist[r.verdict] ?? 0) + 1;
console.log("Distribución de veredictos en el periodo:", dist);
console.log("Rango temporal:", records[0]?.date, "→", records.at(-1)?.date);
