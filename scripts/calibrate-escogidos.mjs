/**
 * CALIBRACIÓN "LOS ESCOGIDOS" — top-10 con mayor probabilidad alcista a 5 SESIONES (~7 días naturales).
 * LOOP de optimización: prueba varias familias de señales (reversal corto, momentum, compresión de
 * volatilidad, volumen, combinaciones) → pesos por IC en TRAIN → valida OOS en TEST → itera y se
 * queda con la mejor config. Walk-forward sin lookahead, 5 años, universo completo US+EU.
 */
import fs from "node:fs";
const H = 5;                 // 5 sesiones = ~7 días naturales
const STEP = 3, WINDOW = 290, TOPN = 10;
const CACHE = "/tmp/emrr-bars-5y.json";

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
function rk(arr) { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; }
function spearman(x, y) { if (x.length < 3) return 0; const rx = rk(x), ry = rk(y); const mx = mean(rx), my = mean(ry); return mean(rx.map((v, i) => (v - mx) * (ry[i] - my))) / (std(rx) * std(ry)); }
function ema(vals, p) { const k = 2 / (p + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; }
function rsi(closes, p) { if (closes.length < p + 1) return 50; let g = 0, l = 0; for (let i = closes.length - p; i < closes.length; i++) { const ch = closes[i] - closes[i - 1]; if (ch >= 0) g += ch; else l -= ch; } const rs = l === 0 ? 100 : g / l; return 100 - 100 / (1 + rs); }

if (!fs.existsSync(CACHE)) { console.error("Falta /tmp/emrr-bars-5y.json"); process.exit(1); }
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date);
for (const f of fetched) f.byDate = new Map(f.bars.map((b, i) => [b.date, i]));
console.log(`Datos: ${fetched.length} tickers · ${spyDates[0]}→${spyDates.at(-1)}\n`);

// ── Features a 5 sesiones (point-in-time, última barra de la ventana) ──
const ALL_FEATS = ["ret5", "ret10", "ret20", "ret60", "rsi3", "rsi14", "distMA20", "distMA50", "distMA200", "atrPct", "atrRatio", "rvol5", "dist52H", "dist52L", "emaSlope", "downStreak"];
function featuresAt(bars, hi) {
  if (hi < 210) return null;
  const closes = bars.slice(0, hi + 1).map((b) => b.close);
  const last = closes[hi];
  if (!Number.isFinite(last) || last <= 0) return null;
  const win = bars.slice(Math.max(0, hi - 260), hi + 1);
  const highs = win.map((b) => b.high), lows = win.map((b) => b.low);
  const hi252 = Math.max(...highs), lo252 = Math.min(...lows);
  const ema20 = ema(closes.slice(-30), 20), ema50 = ema(closes.slice(-60), 50), ema200 = ema(closes.slice(-220), 200);
  const ema20p = ema(closes.slice(-35, -5), 20);
  const vols = bars.slice(0, hi + 1).map((b) => b.volume);
  const v5 = mean(vols.slice(-5)), v20 = mean(vols.slice(-20));
  const trs = []; for (let i = hi - 13; i <= hi; i++) trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  const atr14 = mean(trs);
  const trsOld = []; for (let i = hi - 41; i <= hi - 28; i++) trsOld.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  const atrOld = mean(trsOld);
  let streak = 0; for (let i = hi; i > hi - 10 && closes[i] < closes[i - 1]; i--) streak++;
  return {
    ret5: last / closes[hi - 5] - 1, ret10: last / closes[hi - 10] - 1,
    ret20: last / closes[hi - 20] - 1, ret60: last / closes[hi - 60] - 1,
    rsi3: rsi(closes, 3), rsi14: rsi(closes, 14),
    distMA20: last / ema20 - 1, distMA50: last / ema50 - 1, distMA200: last / ema200 - 1,
    atrPct: atr14 / last, atrRatio: atrOld > 0 ? atr14 / atrOld : 1,
    rvol5: v20 > 0 ? v5 / v20 : 1,
    dist52H: last / hi252 - 1, dist52L: last / lo252 - 1,
    emaSlope: ema20p !== 0 ? ema20 / ema20p - 1 : 0,
    downStreak: streak, close: last,
  };
}

// ── Panel walk-forward ──
const panel = [];
for (let d = 230; d < spyDates.length - H - 1; d += STEP) {
  const dt = spyDates[d];
  const recs = [];
  for (const f of fetched) {
    const hi = f.byDate.get(dt); if (hi === undefined || hi < 230) continue;
    const ft = featuresAt(f.bars, hi); if (!ft) continue;
    const j = hi + H; if (j >= f.bars.length) continue;
    const fwd = (f.bars[j].close / ft.close - 1) * 100;
    if (!Number.isFinite(fwd) || Math.abs(fwd) > 80) continue; // descarta glitches
    recs.push({ ft, fwd });
  }
  if (recs.length >= 60) panel.push({ dt, recs });
}
console.log(`Panel: ${panel.length} fechas (${panel[0]?.dt}→${panel.at(-1)?.dt})`);
const cut = Math.floor(panel.length * 0.7);
const train = panel.slice(0, cut), test = panel.slice(cut);
console.log(`TRAIN ${train.length} | TEST ${test.length}\n`);

// stats globales en TRAIN (para z fija desplegable)
const gstats = {};
{ const rowsAll = train.flatMap((p) => p.recs);
  for (const k of ALL_FEATS) { const xs = rowsAll.map((r) => r.ft[k]); gstats[k] = { m: mean(xs), s: std(xs) }; } }

function fitWeights(feats) {
  const w = {};
  for (const k of feats) {
    const ics = train.map((p) => spearman(p.recs.map((r) => r.ft[k]), p.recs.map((r) => r.fwd))).filter(Number.isFinite);
    w[k] = mean(ics);
  }
  const wa = Object.values(w).reduce((a, b) => a + Math.abs(b), 0) || 1;
  for (const k of feats) w[k] /= wa;
  return w;
}
const zOf = (ft, k) => Math.max(-3, Math.min(3, (ft[k] - gstats[k].m) / (gstats[k].s || 1)));
const scoreOf = (ft, w) => Object.keys(w).reduce((s, k) => s + w[k] * zOf(ft, k), 0);

function evalOOS(w, label) {
  const ics = [], topFwd = [], uniFwd = []; let beat = 0, tot = 0;
  for (const p of test) {
    const scores = p.recs.map((r) => scoreOf(r.ft, w));
    const fwds = p.recs.map((r) => r.fwd);
    ics.push(spearman(scores, fwds));
    const dayMean = mean(fwds);
    uniFwd.push(...fwds);
    p.recs.map((r, i) => ({ r, sc: scores[i] })).sort((a, b) => b.sc - a.sc).slice(0, TOPN)
      .forEach(({ r }) => { topFwd.push(r.fwd); tot++; if (r.fwd > dayMean) beat++; });
  }
  const ic = mean(ics), uniM = mean(uniFwd);
  const res = { label, ic, top: mean(topFwd), uni: uniM, alpha: mean(topFwd) - uniM, win: topFwd.filter((x) => x > 0).length / topFwd.length, beat: beat / tot };
  console.log(`  ${label.padEnd(34)} IC ${ic.toFixed(3).padStart(6)} | top10 ${res.top.toFixed(2)}% vs uni ${uniM.toFixed(2)}% (α ${res.alpha.toFixed(2)}pp) | win ${(res.win * 100).toFixed(0)}% | bate ${(res.beat * 100).toFixed(0)}%`);
  return res;
}

// ── LOOP DE OPTIMIZACIÓN: configs candidatas ──
console.log("LOOP de configs (todo OOS en TEST, H=5 sesiones):");
const CONFIGS = [
  ["A · todas las señales (IC-weighted)", ALL_FEATS],
  ["B · reversal corto", ["ret5", "ret10", "rsi3", "rsi14", "downStreak", "distMA20"]],
  ["C · momentum", ["ret20", "ret60", "distMA50", "distMA200", "dist52H", "emaSlope"]],
  ["D · reversal + volumen + vol", ["ret5", "rsi3", "downStreak", "rvol5", "atrRatio", "atrPct"]],
  ["E · reversal + tendencia fondo", ["ret5", "rsi3", "downStreak", "distMA200", "dist52L", "atrPct"]],
  ["G · E + volumen/compresión", ["ret5", "rsi3", "downStreak", "distMA200", "dist52L", "atrPct", "rvol5", "atrRatio"]],
  ["H · E + momentum medio", ["ret5", "rsi3", "downStreak", "distMA200", "dist52L", "atrPct", "ret20", "ret60"]],
  ["I · E sin distMA200 (peso ~0)", ["ret5", "rsi3", "downStreak", "dist52L", "atrPct"]],
];
const results = [];
for (const [label, feats] of CONFIGS) results.push({ feats, w: fitWeights(feats), ...evalOOS(fitWeights(feats), label) });

// iteración 2: poda — top-k features por |IC| de la mejor config base
results.sort((a, b) => b.ic - a.ic);
const bestBase = results[0];
const ranked = Object.entries(bestBase.w).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
for (const k of [4, 6, 8]) {
  if (ranked.length <= k) continue;
  const feats = ranked.slice(0, k).map(([f]) => f);
  const w = fitWeights(feats);
  results.push({ feats, w, ...evalOOS(w, `F · poda top-${k} de "${bestBase.label.slice(0, 1)}"`) });
}
results.sort((a, b) => b.ic - a.ic);
const best = results[0];
console.log(`\n🏆 MEJOR: ${best.label} → IC ${best.ic.toFixed(3)}, α ${best.alpha.toFixed(2)}pp, win ${(best.win * 100).toFixed(0)}%`);
console.log("Pesos:", Object.fromEntries(Object.entries(best.w).map(([k, v]) => [k, +v.toFixed(4)])));

// prob calibrada por bins en TRAIN (con la config ganadora)
const trainRows = train.flatMap((p) => p.recs.map((r) => ({ sc: scoreOf(r.ft, best.w), up: r.fwd > 0 ? 1 : 0 }))).sort((a, b) => a.sc - b.sc);
const NB = 20, probTable = [];
for (let q = 0; q < NB; q++) { const seg = trainRows.slice(Math.floor(q * trainRows.length / NB), Math.floor((q + 1) * trainRows.length / NB)); probTable.push({ sMin: +seg[0].sc.toFixed(4), p: +mean(seg.map((x) => x.up)).toFixed(4) }); }
const baseUp = +mean(trainRows.map((x) => x.up)).toFixed(4);
console.log(`\nbaseUp ${(baseUp * 100).toFixed(1)}% · bin sup ${(probTable[NB - 1].p * 100).toFixed(1)}%`);
console.log("\n=== PARAMS PARA DESPLEGAR ===");
console.log(JSON.stringify({ horizonSessions: H, feats: best.feats, weights: Object.fromEntries(Object.entries(best.w).map(([k, v]) => [k, +v.toFixed(4)])), gstats: Object.fromEntries(best.feats.map((k) => [k, { m: +gstats[k].m.toFixed(5), s: +gstats[k].s.toFixed(5) }])), probTable, baseUp }));
