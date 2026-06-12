/**
 * CALIBRACIÓN "FABLE 5" — top-10 de TENDENCIA ALCISTA LIMPIA sin pullback inminente.
 * ===================================================================================
 * LOOP doble de optimización sobre 5 años walk-forward (train/test temporal, universo US+EU):
 *   LOOP 1 — ¿qué definición de "tendencia limpia + no sobreextendida" maximiza el retorno
 *            forward inmediato (10/20 sesiones) del top-10? (6 configs de señales)
 *   LOOP 2 — con los picks de la config ganadora: ¿qué múltiplos de ATR para el trailing stop
 *            maximizan el retorno de salida en histórico? → ajustado / normal / ampliado.
 */
import fs from "node:fs";
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const CACHE = "/tmp/emrr-bars-5y.json";
const STEP = 5, TOPN = 10;
const HORIZONS = [10, 20];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
function ema(vals, p) { const k = 2 / (p + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; }
function rsiOf(closes, p) { if (closes.length < p + 1) return 50; let g = 0, l = 0; for (let i = closes.length - p; i < closes.length; i++) { const ch = closes[i] - closes[i - 1]; if (ch >= 0) g += ch; else l -= ch; } const rs = l === 0 ? 100 : g / l; return 100 - 100 / (1 + rs); }
// R² de ajuste lineal sobre log-precios: mide lo "limpia" (recta) que es la tendencia.
function r2Log(closes) {
  const n = closes.length; if (n < 10) return 0;
  const ys = closes.map((c) => Math.log(c)); const xs = ys.map((_, i) => i);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return 0;
  return (sxy * sxy) / (sxx * syy);
}

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

// ── Datos ──
let fetched, spy;
if (fs.existsSync(CACHE)) {
  console.log("Cargando caché…");
  ({ fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8")));
} else {
  const all = [];
  for (const [ex, assets] of Object.entries(STATIC_ASSETS_BY_EXCHANGE))
    for (const a of assets) { const y = toYahooSymbol(`${a.Code}.${ex}`); if (y) all.push({ ex, sym: `${a.Code}.${ex}`, yahoo: y }); }
  console.log(`Descargando ${all.length} símbolos (5y)…`);
  spy = await fetchBars("SPY");
  fetched = (await pool(all, async (s) => { const b = await fetchBars(s.yahoo); return b ? { ...s, bars: b } : null; })).filter(Boolean);
  fs.writeFileSync(CACHE, JSON.stringify({ fetched, spy }));
}
const spyDates = spy.map((b) => b.date);
for (const f of fetched) f.byDate = new Map(f.bars.map((b, i) => [b.date, i]));
console.log(`Listos ${fetched.length} tickers · ${spyDates[0]}→${spyDates.at(-1)}\n`);

// ── Features de tendencia limpia (point-in-time) ──
function featuresAt(bars, hi) {
  if (hi < 230) return null;
  const closes = bars.slice(0, hi + 1).map((b) => b.close);
  const last = closes[hi];
  if (!Number.isFinite(last) || last <= 0) return null;
  const recent5 = closes.slice(-6, -1).slice().sort((a, b) => a - b);
  const med = recent5[Math.floor(recent5.length / 2)];
  if (med > 0 && Math.abs(last / med - 1) > 0.40) return null; // anti-glitch
  const e20 = ema(closes.slice(-30), 20), e50 = ema(closes.slice(-60), 50), e200 = ema(closes.slice(-220), 200);
  const e20p = ema(closes.slice(-35, -5), 20);
  const win = bars.slice(Math.max(0, hi - 260), hi + 1);
  const hi252 = Math.max(...win.map((b) => b.high));
  const trs = []; for (let i = hi - 13; i <= hi; i++) trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  const atrPct = mean(trs) / last;
  const up60 = closes.slice(-60).filter((c, i, a) => i > 0 && c > a[i - 1]).length / 59;
  return {
    slope20: e20p !== 0 ? e20 / e20p - 1 : 0,                 // pendiente de la tendencia corta
    align: (last > e20 ? 1 : 0) + (e20 > e50 ? 1 : 0) + (e50 > e200 ? 1 : 0), // alineación de medias
    r2: r2Log(closes.slice(-60)),                              // limpieza de la tendencia (recta)
    upDays: up60,                                              // consistencia (% días verdes)
    dist52H: last / hi252 - 1,                                 // cerca de máximos = tendencia fuerte
    ret60: last / closes[hi - 60] - 1,
    // anti-pullback (sobreextensión):
    distMA20: last / e20 - 1, rsi14: rsiOf(closes, 14), ret5: last / closes[hi - 5] - 1,
    atrPct, close: last,
  };
}

// ── Panel walk-forward ──
const maxH = 45; // forward máximo necesario (trailing sweep usa 40)
const panel = [];
for (let d = 240; d < spyDates.length - maxH - 1; d += STEP) {
  const dt = spyDates[d];
  const recs = [];
  for (const f of fetched) {
    const hi = f.byDate.get(dt); if (hi === undefined || hi < 240) continue;
    const ft = featuresAt(f.bars, hi); if (!ft) continue;
    recs.push({ f, hi, ft });
  }
  if (recs.length >= 60) panel.push({ dt, recs });
}
console.log(`Panel: ${panel.length} fechas (${panel[0]?.dt}→${panel.at(-1)?.dt})`);
const cut = Math.floor(panel.length * 0.7);
const train = panel.slice(0, cut), test = panel.slice(cut);
console.log(`TRAIN ${train.length} | TEST ${test.length}\n`);

const fwdOf = (r, H) => { const j = r.hi + H; return j < r.f.bars.length ? (r.f.bars[j].close / r.ft.close - 1) * 100 : null; };

// ── LOOP 1: configs de "tendencia limpia sin pullback inminente" ──
// Cada config: filtro duro (elegibles) + función de score. Se evalúa el TOP-10 OOS.
const CONFIGS = [
  ["T1 · tendencia pura", (ft) => ft.align === 3 && ft.slope20 > 0, (ft) => ft.slope20 * 50 + ft.r2 * 2 + ft.upDays + Math.max(-0.3, ft.dist52H) * 2],
  ["T2 · T1 + limpieza R² fuerte", (ft) => ft.align === 3 && ft.slope20 > 0 && ft.r2 > 0.6, (ft) => ft.r2 * 3 + ft.slope20 * 40 + ft.upDays],
  ["T3 · T1 + anti-sobreextensión", (ft) => ft.align === 3 && ft.slope20 > 0 && ft.rsi14 < 75 && ft.distMA20 < 0.08 && ft.ret5 < 0.10, (ft) => ft.slope20 * 50 + ft.r2 * 2 + ft.upDays + Math.max(-0.3, ft.dist52H) * 2],
  ["T4 · T3 + baja volatilidad (limpia)", (ft) => ft.align === 3 && ft.slope20 > 0 && ft.rsi14 < 75 && ft.distMA20 < 0.08 && ft.ret5 < 0.10, (ft) => ft.slope20 * 40 + ft.r2 * 3 + ft.upDays - ft.atrPct * 30],
  ["T5 · T3 + pullback suave a MA20", (ft) => ft.align === 3 && ft.slope20 > 0 && ft.rsi14 < 70 && ft.distMA20 >= -0.02 && ft.distMA20 < 0.04, (ft) => ft.slope20 * 50 + ft.r2 * 2 + ft.upDays],
  ["T6 · momentum 60d en uptrend limpio", (ft) => ft.align === 3 && ft.slope20 > 0 && ft.rsi14 < 75 && ft.distMA20 < 0.08, (ft) => ft.ret60 * 3 + ft.r2 * 2 + ft.slope20 * 30],
  ["T7 · T1 + guardas EXTREMAS (desplegada)", (ft) => ft.align === 3 && ft.slope20 > 0 && ft.rsi14 < 80 && ft.ret5 < 0.15 && ft.distMA20 < 0.12, (ft) => ft.slope20 * 50 + ft.r2 * 2 + ft.upDays + Math.max(-0.3, ft.dist52H) * 2],
];

console.log("LOOP 1 — configs de tendencia limpia (top-10 OOS en TEST):");
console.log("  config                                | H  | ret top10 | uni    | α      | win  | n/fecha");
const results = [];
for (const [label, filter, scoreFn] of CONFIGS) {
  for (const H of HORIZONS) {
    const tops = [], unis = []; let nEligTotal = 0, nDates = 0;
    for (const p of test) {
      const elig = p.recs.filter((r) => filter(r.ft));
      const fwds = p.recs.map((r) => fwdOf(r, H)).filter((v) => v !== null);
      unis.push(...fwds);
      if (elig.length < TOPN) continue;
      nEligTotal += elig.length; nDates++;
      elig.slice().sort((a, b) => scoreFn(b.ft) - scoreFn(a.ft)).slice(0, TOPN)
        .forEach((r) => { const v = fwdOf(r, H); if (v !== null) tops.push(v); });
    }
    if (tops.length < 50) continue;
    const ret = mean(tops), uni = mean(unis), win = tops.filter((x) => x > 0).length / tops.length;
    console.log(`  ${label.padEnd(37)} | ${String(H).padStart(2)} | ${ret.toFixed(2).padStart(7)}% | ${uni.toFixed(2).padStart(5)}% | ${(ret - uni).toFixed(2).padStart(5)}pp | ${(win * 100).toFixed(0)}% | ${(nEligTotal / Math.max(1, nDates)).toFixed(0)}`);
    results.push({ label, filter, scoreFn, H, ret, alpha: ret - uni, win, samples: tops.length });
  }
}
// criterio: maximizar retorno del top-10 ("beneficios inmediatos") con win decente
results.sort((a, b) => b.ret - a.ret);
const best = results[0];
console.log(`\n🏆 LOOP 1 GANADOR: ${best.label} @ H=${best.H} → ret ${best.ret.toFixed(2)}%, α ${best.alpha.toFixed(2)}pp, win ${(best.win * 100).toFixed(0)}% (${best.samples} muestras)\n`);

// ── LOOP 2: trailing stops óptimos (múltiplos de ATR) sobre los picks del ganador ──
// Simula: entrada en t, trailing stop = mult × ATR% desde el máximo alcanzado; ventana 40 sesiones.
function simulateTrailing(r, multPct, maxDays = 40) {
  const entry = r.ft.close; const stopDist = multPct; // % del precio
  let peak = entry;
  for (let k = 1; k <= maxDays; k++) {
    const j = r.hi + k; if (j >= r.f.bars.length) break;
    const b = r.f.bars[j];
    if (Number.isFinite(b.high) && b.high > peak) peak = b.high;
    const stopLevel = peak * (1 - stopDist / 100);
    if (Number.isFinite(b.low) && b.low <= stopLevel) return (stopLevel / entry - 1) * 100; // salta el stop
  }
  const j = Math.min(r.hi + maxDays, r.f.bars.length - 1);
  return (r.f.bars[j].close / entry - 1) * 100; // fin de ventana sin stop
}

console.log("LOOP 2 — barrido de trailing stops (múltiplo × ATR% de cada ticker, OOS):");
console.log("  mult ATR | ret medio salida | % stops saltados");
const MULTS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
const sweep = [];
for (const m of MULTS) {
  const rets = []; let stopped = 0, total = 0;
  for (const p of test) {
    const elig = p.recs.filter((r) => best.filter(r.ft));
    if (elig.length < TOPN) continue;
    elig.slice().sort((a, b) => best.scoreFn(b.ft) - best.scoreFn(a.ft)).slice(0, TOPN).forEach((r) => {
      const multPct = m * r.ft.atrPct * 100;
      const ret = simulateTrailing(r, multPct);
      rets.push(ret); total++;
      // aproximación: si ret < retorno a 40d sin stop, saltó
    });
  }
  const avg = mean(rets);
  console.log(`  ${m.toFixed(1).padStart(7)} | ${avg.toFixed(2).padStart(15)}% | (${rets.length} sims)`);
  sweep.push({ m, avg });
}
sweep.sort((a, b) => b.avg - a.avg);
const normal = sweep[0].m;
const tight = Math.max(1.0, normal - 1.0);
const wide = Math.min(5.0, normal + 1.0);
console.log(`\n🏆 LOOP 2: óptimo NORMAL = ${normal}×ATR · AJUSTADO = ${tight}×ATR · AMPLIADO = ${wide}×ATR`);
console.log("\n=== PARAMS PARA DESPLEGAR ===");
console.log(JSON.stringify({ config: best.label, horizon: best.H, trailingMults: { ajustado: tight, normal, ampliado: wide }, oos: { ret: +best.ret.toFixed(2), alpha: +best.alpha.toFixed(2), win: +(best.win * 100).toFixed(0) } }));
