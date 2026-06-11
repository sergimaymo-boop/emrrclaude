/**
 * CALIBRACIÓN del Motor de Market Breadth — análisis OFFLINE (no desplegado).
 * Objetivo: subir la fiabilidad ajustando pesos/umbrales contra histórico, SIN overfitting.
 * Método anti-sobreajuste:
 *   - 5 años de datos → varios regímenes de mercado.
 *   - Walk-forward sin lookahead; split TEMPORAL train(70%)/test(30%).
 *   - Pesos = correlación univariante de cada sub-score con el retorno futuro (señal robusta,
 *     baja varianza). Umbrales = terciles de la puntuación en TRAIN (reparto equilibrado).
 *   - Se valida SOLO en test (out-of-sample). Se compara v1 (actual) vs v2 (calibrado).
 */
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { calculateTechnicals } from "../api/_lib/technicalEngine.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";
import {
  computeTickerBreadthSignals, emptyBreadthAggregator, foldTickerSignals,
  computeBreadthVerdict, BREADTH_WEIGHTS,
} from "../api/_lib/marketBreadthEngine.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const H = 10;             // horizonte de predicción (sesiones)
const STEP = 2;
const WINDOW = 290;       // ventana de barras pasada a calculateTechnicals (acota cómputo)
const SAMPLE_PER_EXCHANGE = { US: 130, XETRA: 28, PA: 16, AS: 10, MI: 10, SW: 10, LSE: 12, BR: 4, LS: 4 };
const FEATURES = ["pctAboveMA50", "pctAboveMA200", "advanceDecline", "newHighLow", "distribution", "emaSlope", "mcclellan"];

async function fetchBars(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json(); const r = d?.chart?.result?.[0];
    if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const bars = r.timestamp.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0,
    })).filter((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.open) && b.open > 0);
    return bars.length >= 260 ? bars : null;
  } catch { return null; }
}
async function pool(items, worker, c = 8) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: c }, async () => { while (i < items.length) { const k = i++; out[k] = await worker(items[k]); } }));
  return out;
}
const HORIZONS = [5, 10, 20, 40, 60];
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
function corr(xs, ys) {
  const mx = mean(xs), my = mean(ys); const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const sx = std(xs), sy = std(ys); return (sx && sy) ? cov / (sx * sy) : 0;
}

// ── Muestra ──
const sample = [];
for (const [ex, n] of Object.entries(SAMPLE_PER_EXCHANGE)) {
  const assets = STATIC_ASSETS_BY_EXCHANGE[ex] ?? []; const stepEx = Math.max(1, Math.floor(assets.length / n));
  for (let k = 0; k < assets.length && sample.filter((s) => s.ex === ex).length < n; k += stepEx) {
    const y = toYahooSymbol(`${assets[k].Code}.${ex}`); if (y) sample.push({ ex, yahoo: y });
  }
}
console.log(`Muestra: ${sample.length} tickers. Descargando 5 años…`);
const spy = await fetchBars("SPY"); if (!spy) { console.error("No SPY"); process.exit(1); }
const spyDates = spy.map((b) => b.date); const spyClose = new Map(spy.map((b) => [b.date, b.close]));
const fetched = (await pool(sample, async (s) => ({ ...s, bars: await fetchBars(s.yahoo) }))).filter((f) => f.bars);
console.log(`Descargados ${fetched.length}. Rango SPY: ${spyDates[0]} → ${spyDates.at(-1)} (${spyDates.length} sesiones)\n`);

// ── Walk-forward: features por fecha (retornos forward se calculan luego por horizonte) ──
const rows = []; const adNetSeries = [];
for (let d = 210; d < spyDates.length - Math.max(...HORIZONS) - 1; d += STEP) {
  const dt = spyDates[d];
  const spySub = spy.slice(Math.max(0, d - WINDOW), d + 1);
  let spyBullish = null;
  if (spySub.length >= 200) {
    const cl = spySub.map((b) => b.close); const k = 2 / 201; let e = mean(cl.slice(0, 200));
    for (let i = 200; i < cl.length; i++) e = cl[i] * k + e * (1 - k); spyBullish = cl.at(-1) > e;
  }
  const agg = emptyBreadthAggregator();
  for (const f of fetched) {
    let lo = 0; const fb = f.bars;
    // localizar índice de la barra <= dt y tomar ventana trailing
    let hi = -1; for (let i = fb.length - 1; i >= 0; i--) { if (fb[i].date <= dt) { hi = i; break; } }
    if (hi < 60) continue; lo = Math.max(0, hi - WINDOW);
    const sub = fb.slice(lo, hi + 1);
    if (sub.length < 61) continue;
    const tech = calculateTechnicals(sub, spySub);
    foldTickerSignals(agg, computeTickerBreadthSignals(tech.ok ? tech : { technicals: null }, sub));
  }
  if (agg.total < 50) continue;
  const v = computeBreadthVerdict(agg, { spyBullish, adNetSeries: [...adNetSeries] });
  adNetSeries.push(v.adNet);
  rows.push({ date: dt, idx: d, sub: v.sub ?? v.subScores, scoreV1: v.score, verdictV1: v.verdict, spyAt: spyClose.get(dt) });
}
console.log(`Puntos walk-forward: ${rows.length} (${rows[0]?.date} → ${rows.at(-1)?.date})\n`);

function fwdRetOf(r, h) {
  const fwd = spyClose.get(spyDates[r.idx + h]);
  return (Number.isFinite(fwd) && r.spyAt) ? ((fwd - r.spyAt) / r.spyAt) * 100 : null;
}

// ── Barrido de horizontes: calibrar en TRAIN, validar en TEST (out-of-sample) ──
console.log("BARRIDO DE HORIZONTES (todo out-of-sample en TEST):\n");
console.log("  H  | v1 corr | v2 corr | v2 sep 🟢-🔴 | v2 hit | base | pesos→signo dominante");
const results = [];
for (const h of HORIZONS) {
  const data = rows.map((r) => ({ ...r, fwdRet: fwdRetOf(r, h) })).filter((r) => r.fwdRet !== null);
  const cut = Math.floor(data.length * 0.7);
  const train = data.slice(0, cut), test = data.slice(cut);

  const stats = {}, w = {};
  for (const f of FEATURES) {
    const xs = train.map((r) => r.sub[f] ?? 50);
    stats[f] = { m: mean(xs), s: std(xs) };
    w[f] = corr(xs, train.map((r) => r.fwdRet));
  }
  const wAbs = Object.values(w).reduce((a, b) => a + Math.abs(b), 0) || 1;
  const wN = {}; for (const f of FEATURES) wN[f] = w[f] / wAbs;
  const scoreV2 = (r) => FEATURES.reduce((s, f) => s + wN[f] * (((r.sub[f] ?? 50) - stats[f].m) / stats[f].s), 0);
  const ts = train.map(scoreV2).sort((a, b) => a - b);
  const q33 = ts[Math.floor(ts.length / 3)], q66 = ts[Math.floor(ts.length * 2 / 3)];
  const bucketV2 = (r) => { const sc = scoreV2(r); return sc >= q66 ? "BULLISH" : sc >= q33 ? "DETERIORATING" : "PULLBACK_IMMINENT"; };

  const corrV1 = corr(test.map((r) => r.scoreV1), test.map((r) => r.fwdRet));
  const corrV2 = corr(test.map(scoreV2), test.map((r) => r.fwdRet));
  const byV = { BULLISH: [], DETERIORATING: [], PULLBACK_IMMINENT: [] };
  let hits = 0;
  for (const r of test) { const b = bucketV2(r); byV[b].push(r.fwdRet); const ok = b === "BULLISH" ? r.fwdRet > 1 : b === "PULLBACK_IMMINENT" ? r.fwdRet < -1 : (r.fwdRet >= -1 && r.fwdRet <= 1); if (ok) hits++; }
  const sep = mean(byV.BULLISH) - mean(byV.PULLBACK_IMMINENT);
  const base = test.filter((r) => r.fwdRet > 0).length / test.length;
  const sign = w.pctAboveMA50 < 0 ? "REVERSIÓN (amplitud↑→cae)" : "CONTINUACIÓN (amplitud↑→sube)";
  console.log(`  ${String(h).padStart(2)} | ${corrV1.toFixed(3).padStart(6)} | ${corrV2.toFixed(3).padStart(6)} | ${sep.toFixed(2).padStart(6)} pp | ${(hits/test.length*100).toFixed(0).padStart(3)}% | ${(base*100).toFixed(0)}% | ${sign}`);
  results.push({ h, corrV2, sep, weights: wN, stats, thresholds: { q33, q66 }, hit: hits/test.length, base, trainN: train.length, testN: test.length, sign });
}

const best = results.slice().sort((a, b) => Math.abs(b.corrV2) - Math.abs(a.corrV2))[0];
console.log(`\n→ Mejor horizonte out-of-sample: ${best.h} sesiones (corr v2 = ${best.corrV2.toFixed(3)}, sep ${best.sep.toFixed(2)}pp, hit ${(best.hit*100).toFixed(0)}%, ${best.sign})`);
console.log(`\n=== PARAMS v2 del mejor horizonte (H=${best.h}) para implementar ===`);
console.log(JSON.stringify({ horizon: best.h, weights: best.weights, zstats: best.stats, thresholds: best.thresholds }, null, 0));
