/**
 * RANKING DE TICKERS — factor model cross-sectional (análisis OFFLINE, no desplegado).
 * Extiende la metodología del módulo de amplitud al nivel de ticker: ¿qué combinación de
 * señales predice, en sección cruzada (entre tickers a cada fecha), el mejor retorno futuro?
 *
 * Anti-overfit: 5 años, walk-forward sin lookahead, split temporal train/test, pesos = IC
 * (Spearman) medio de cada factor en TRAIN. Se valida SOLO en test. "Loop": barre horizontes
 * y se queda con el de mejor IC out-of-sample. Salida: top-10 actual + probabilidad calibrada.
 */
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const HORIZONS = [20, 40, 60];
const STEP = 5;
const FEATS = ["ret20", "ret60", "distMA50", "distMA200", "rsi14", "dist52H", "dist52L", "rvol", "atrPct", "emaSlope",
  "pbUptrend", "aboveMA200", "goldenCross", "qualMom"];

async function fetchBars(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json(); const r = d?.chart?.result?.[0]; if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const bars = r.timestamp.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0,
    })).filter((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.high) && Number.isFinite(b.low));
    return bars.length >= 280 ? bars : null;
  } catch { return null; }
}
async function pool(items, worker, c = 6) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: c }, async () => { while (i < items.length) { const k = i++; out[k] = await worker(items[k]); } }));
  return out;
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
function ema(vals, p) { const k = 2 / (p + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; }
function rsi(closes, p = 14) {
  if (closes.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) { const ch = closes[i] - closes[i - 1]; if (ch >= 0) g += ch; else l -= ch; }
  const rs = l === 0 ? 100 : g / l; return 100 - 100 / (1 + rs);
}
function rank(arr) { // ranks 0..1
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k / (arr.length - 1 || 1); }); return r;
}
function spearman(x, y) { const rx = rank(x), ry = rank(y); const mx = mean(rx), my = mean(ry); const cov = mean(rx.map((v, i) => (v - mx) * (ry[i] - my))); return cov / (std(rx) * std(ry)); }

// Features de un ticker en el índice de barra `hi` (point-in-time)
function featuresAt(bars, hi) {
  if (hi < 210) return null;
  const closes = bars.slice(0, hi + 1).map((b) => b.close);
  const last = closes[hi];
  const win = bars.slice(Math.max(0, hi - 260), hi + 1);
  const highs = win.map((b) => b.high), lows = win.map((b) => b.low);
  const hi252 = Math.max(...highs), lo252 = Math.min(...lows);
  const ema50 = ema(closes.slice(-60), 50), ema200 = ema(closes.slice(-220), 200);
  const ema20 = ema(closes.slice(-30), 20), ema20p = ema(closes.slice(-35, -5), 20);
  const vol = bars.slice(0, hi + 1).map((b) => b.volume);
  const v20 = mean(vol.slice(-20)), v60 = mean(vol.slice(-60));
  const trs = []; for (let i = hi - 13; i <= hi; i++) trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  const atr = mean(trs);
  const r = rsi(closes);
  const upTrend = last > ema200 ? 1 : 0; // tendencia de fondo intacta
  const ret60v = last / closes[hi - 60] - 1;
  return {
    ret20: last / closes[hi - 20] - 1,
    ret60: ret60v,
    distMA50: last / ema50 - 1,
    distMA200: last / ema200 - 1,
    rsi14: r,
    dist52H: last / hi252 - 1,
    dist52L: last / lo252 - 1,
    rvol: v60 > 0 ? v20 / v60 : 1,
    atrPct: atr / last,
    emaSlope: ema20 / ema20p - 1,
    // Interacciones: PULLBACK EN TENDENCIA ALCISTA (sobreventa con tendencia de fondo intacta).
    pbUptrend: upTrend * Math.max(0, 50 - r),      // alto = sobrevendido Y en uptrend
    aboveMA200: upTrend,
    goldenCross: ema50 > ema200 ? 1 : 0,
    qualMom: upTrend * ret60v,                       // momentum solo si en uptrend
    close: last,
  };
}

// ── Muestra: universo completo ──
const all = [];
for (const [ex, assets] of Object.entries(STATIC_ASSETS_BY_EXCHANGE))
  for (const a of assets) { const y = toYahooSymbol(`${a.Code}.${ex}`); if (y) all.push({ ex, code: a.Code, name: a.Name, providerSymbol: `${a.Code}.${ex}`, yahoo: y }); }
console.log(`Universo: ${all.length} símbolos. Descargando 5 años (concurrencia 6)…`);
const spy = await fetchBars("SPY"); const spyDates = spy.map((b) => b.date); const spyClose = spy.map((b) => b.close);
const fetched = (await pool(all, async (s) => ({ ...s, bars: await fetchBars(s.yahoo) }))).filter((f) => f.bars);
console.log(`Descargados ${fetched.length}/${all.length}. Rango: ${spyDates[0]}→${spyDates.at(-1)}\n`);

// índice de fecha por ticker
for (const f of fetched) { f.byDate = new Map(f.bars.map((b, i) => [b.date, i])); }

// ── Dataset cross-sectional walk-forward ──
const evalDates = [];
for (let d = 230; d < spyDates.length - Math.max(...HORIZONS) - 1; d += STEP) evalDates.push(d);

// Para cada fecha: features por ticker (z-score cross-sectional) + retorno forward por horizonte
const panel = []; // {d, rows:[{f, feats:{z...}, fwd:{H:ret}}]}
for (const d of evalDates) {
  const dt = spyDates[d];
  const raw = [];
  for (const f of fetched) {
    const hi = f.byDate.get(dt); if (hi === undefined || hi < 230) continue;
    const ft = featuresAt(f.bars, hi); if (!ft) continue;
    const fwd = {};
    for (const Hh of HORIZONS) { const j = hi + Hh; fwd[Hh] = j < f.bars.length ? (f.bars[j].close / ft.close - 1) * 100 : null; }
    if (HORIZONS.some((Hh) => fwd[Hh] === null)) continue;
    raw.push({ sym: f.providerSymbol, name: f.name, ft, fwd });
  }
  if (raw.length < 40) continue;
  // z-score cross-sectional por feature
  const z = {};
  for (const k of FEATS) { const vals = raw.map((r) => r.ft[k]); const m = mean(vals), s = std(vals); z[k] = raw.map((r) => (r.ft[k] - m) / s); }
  panel.push({ d, dt, raw, z });
}
console.log(`Fechas en el panel: ${panel.length} (${panel[0]?.dt}→${panel.at(-1)?.dt})\n`);

const cut = Math.floor(panel.length * 0.7);
const train = panel.slice(0, cut), test = panel.slice(cut);
console.log(`TRAIN ${train.length} fechas | TEST ${test.length} fechas\n`);

// ── LOOP sobre horizontes: pesos = IC medio por factor en TRAIN; validar en TEST ──
console.log("BARRIDO (out-of-sample en TEST):");
console.log("  H  | IC combinado | top-decil fwd | resto fwd | lift");
let best = null;
for (const Hh of HORIZONS) {
  // IC medio por factor en train
  const w = {};
  for (const k of FEATS) {
    const ics = train.map((p) => spearman(p.z[k], p.raw.map((r) => r.fwd[Hh]))).filter(Number.isFinite);
    w[k] = mean(ics);
  }
  const wAbs = Object.values(w).reduce((a, b) => a + Math.abs(b), 0) || 1;
  const wN = {}; for (const k of FEATS) wN[k] = w[k] / wAbs;
  const scoreOf = (p, i) => FEATS.reduce((s, k) => s + wN[k] * p.z[k][i], 0);

  // validar en test: IC del score combinado + lift del top decil
  const icTest = test.map((p) => spearman(p.raw.map((_, i) => scoreOf(p, i)), p.raw.map((r) => r.fwd[Hh]))).filter(Number.isFinite);
  const topFwd = [], restFwd = [];
  for (const p of test) {
    const scored = p.raw.map((r, i) => ({ r, sc: scoreOf(p, i) })).sort((a, b) => b.sc - a.sc);
    const nTop = Math.max(1, Math.floor(scored.length / 10));
    scored.slice(0, nTop).forEach((x) => topFwd.push(x.r.fwd[Hh]));
    scored.slice(nTop).forEach((x) => restFwd.push(x.r.fwd[Hh]));
  }
  const ic = mean(icTest), lift = mean(topFwd) - mean(restFwd);
  console.log(`  ${String(Hh).padStart(2)} | ${ic.toFixed(3).padStart(11)} | ${mean(topFwd).toFixed(2).padStart(9)}% | ${mean(restFwd).toFixed(2)}% | ${lift.toFixed(2)}pp`);
  if (!best || ic > best.ic) best = { Hh, wN, ic, lift, topFwd: mean(topFwd), restFwd: mean(restFwd) };
}
console.log(`\n→ Mejor horizonte: ${best.Hh}d (IC test ${best.ic.toFixed(3)}, lift ${best.lift.toFixed(2)}pp)`);
console.log("Pesos del factor model (IC-weighted):");
for (const k of FEATS) console.log(`  ${k.padEnd(10)} ${best.wN[k].toFixed(3)}`);

// ── Probabilidad calibrada: P(fwd>0) por decil de score en TRAIN ──
const Hh = best.Hh;
const trainScored = [];
for (const p of train) { const sc = p.raw.map((_, i) => FEATS.reduce((s, k) => s + best.wN[k] * p.z[k][i], 0)); p.raw.forEach((r, i) => trainScored.push({ sc: sc[i], up: r.fwd[Hh] > 0 ? 1 : 0 })); }
trainScored.sort((a, b) => a.sc - b.sc);
const decileProb = []; for (let q = 0; q < 10; q++) { const seg = trainScored.slice(Math.floor(q * trainScored.length / 10), Math.floor((q + 1) * trainScored.length / 10)); decileProb.push(mean(seg.map((x) => x.up))); }
const baseUp = mean(trainScored.map((x) => x.up));
console.log(`\nProb. base de subida a ${Hh}d: ${(baseUp * 100).toFixed(0)}% | top decil: ${(decileProb[9] * 100).toFixed(0)}%`);
function probOf(score) { // interpola por percentil de score en train
  let lo = 0; for (const t of trainScored) { if (t.sc < score) lo++; }
  const q = Math.min(9, Math.floor(lo / trainScored.length * 10)); return decileProb[q];
}

// ── TOP 10 ACTUAL (última fecha disponible) ──
const lastDate = spyDates[spyDates.length - 1];
const cur = [];
for (const f of fetched) {
  const hi = f.byDate.get(lastDate) ?? (f.bars.length - 1);
  const ft = featuresAt(f.bars, f.bars.length - 1); if (!ft) continue;
  cur.push({ sym: f.providerSymbol, name: f.name, ft });
}
const zc = {}; for (const k of FEATS) { const vals = cur.map((r) => r.ft[k]); const m = mean(vals), s = std(vals); zc[k] = cur.map((r) => (r.ft[k] - m) / s); }
const scored = cur.map((r, i) => ({ ...r, score: FEATS.reduce((s, k) => s + best.wN[k] * zc[k][i], 0) }));
scored.sort((a, b) => b.score - a.score);
console.log(`\n══════ TOP 10 — mayor probabilidad de tendencia alcista (${Hh}d), a ${lastDate} ══════`);
scored.slice(0, 10).forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${r.sym.padEnd(12)} prob↑ ${(probOf(r.score) * 100).toFixed(0)}% | ret20 ${(r.ft.ret20 * 100).toFixed(1)}% RSI ${r.ft.rsi14.toFixed(0)} dMA50 ${(r.ft.distMA50 * 100).toFixed(1)}% d52H ${(r.ft.dist52H * 100).toFixed(1)}% — ${r.name}`);
});
// ── PARÁMETROS PARA DESPLIEGUE (z-stats GLOBALES fijas → cada ticker se puntúa solo) ──
// z global por feature (sobre todas las muestras de TRAIN) para no necesitar toda la sección a la vez.
const allFeatRows = [];
for (const p of train) for (const r of p.raw) allFeatRows.push({ ft: r.ft, up: r.fwd[Hh] > 0 ? 1 : 0, fwd: r.fwd[Hh] });
const gstats = {}; for (const k of FEATS) { const vals = allFeatRows.map((r) => r.ft[k]); gstats[k] = { m: mean(vals), s: std(vals) }; }
const fixedScore = (ft) => FEATS.reduce((s, k) => s + best.wN[k] * ((ft[k] - gstats[k].m) / gstats[k].s), 0);
// tabla score→P(subida) por percentiles (20 bins) en TRAIN con z fija
const fz = allFeatRows.map((r) => ({ sc: fixedScore(r.ft), up: r.up })).sort((a, b) => a.sc - b.sc);
const NB = 20; const probTable = [];
for (let q = 0; q < NB; q++) { const seg = fz.slice(Math.floor(q * fz.length / NB), Math.floor((q + 1) * fz.length / NB)); probTable.push({ sMin: seg[0].sc, p: mean(seg.map((x) => x.up)) }); }
function fixedProb(sc) { let p = probTable[0].p; for (const b of probTable) if (sc >= b.sMin) p = b.p; return p; }

console.log("\n=== PARAMS PARA IMPLEMENTAR (z-stats fijas) ===");
console.log(JSON.stringify({ horizon: Hh, weights: best.wN, gstats, probTable: probTable.map((b) => ({ sMin: +b.sMin.toFixed(4), p: +b.p.toFixed(4) })), baseUp: +baseUp.toFixed(4) }));

// validar que la top-10 con z FIJA es coherente con la cross-sectional
const curFixed = cur.map((r) => ({ ...r, score: fixedScore(r.ft), prob: fixedProb(fixedScore(r.ft)) })).sort((a, b) => b.score - a.score);
console.log("\nTOP 10 con z FIJA (la que se desplegará):");
curFixed.slice(0, 10).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.sym.padEnd(11)} prob↑ ${(r.prob * 100).toFixed(0)}% — ${r.name}`));
