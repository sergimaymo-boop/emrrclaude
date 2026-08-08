/**
 * RALLY — BACKTEST del ranking "los 10 tickers con el rally más sano".
 *
 * El motor `rallyScoreEngine.js` nunca se había validado con datos: sus pesos
 * (33% fuerza relativa, 23% momento, 17% tendencia…) venían de literatura
 * (O'Neil, Minervini, Weinstein), no de un backtest. Esto lo mide.
 *
 * Método: en cada fecha de revisión se puntúa TODO el universo usando solo datos
 * hasta esa fecha (sin mirar al futuro), se compran los N mejores a peso igual y se
 * mantienen hasta la siguiente revisión (con opción de trailing stop).
 *
 * Se replica la fórmula del motor de producción EXACTAMENTE; hay un test de
 * equivalencia (`--verify`) que compara contra calculateRallyScore().
 */
import fs from "node:fs";

const DATA = "data/universe-10y.json";
const COST_BPS = Number(process.env.COST_BPS ?? 20) / 1e4; // 20 pb por lado

// ─── utilidades ──────────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// ─── réplica EXACTA de los normalizadores del motor de producción ────────────
const normalizeRS = (x) => (isNum(x) ? clamp(50 + 50 * Math.tanh(x / 40)) : 20);
const normLin = (v, mn, mx) => (isNum(v) ? clamp(((v - mn) / (mx - mn)) * 100) : 0);
const scoreRS = (rs3m, rs6m) => normalizeRS(rs3m ?? 0) * 0.70 + normalizeRS(rs6m ?? 0) * 0.30;
const scoreMom = (m1, m3, m6) => normLin(m1 ?? 0, -10, 20) * 0.10 + normLin(m3 ?? 0, -15, 45) * 0.60 + normLin(m6 ?? 0, -20, 65) * 0.30;
function scoreTrend(p, e20, e50, s20, s50) {
  let s = 0;
  if (isNum(p) && isNum(e20) && p > e20) s += 25;
  if (isNum(e20) && isNum(e50) && e20 > e50) s += 25;
  if (isNum(s20) && s20 > 0) s += 25;
  if (isNum(s50) && s50 > 0) s += 25;
  if (isNum(p) && isNum(e50) && p > e50) s = Math.min(100, s + 10);
  return clamp(s);
}
function scoreProx(prox) {
  if (!isNum(prox)) return 40;
  if (prox >= 1.0) return 100;
  if (prox >= 0.95) return 90;
  if (prox >= 0.85) return 70;
  if (prox >= 0.75) return 40;
  return 10;
}
function scoreRvol(rvol, p, e5) {
  if (!isNum(rvol)) return 30;
  const mult = isNum(p) && isNum(e5) && p >= e5 ? 1.0 : 0.25;
  const base = rvol >= 1.5 ? 100 : rvol >= 1.2 ? 75 : rvol >= 1.0 ? 50 : rvol >= 0.8 ? 30 : 10;
  return clamp(base * mult);
}
function scoreAtr(a) {
  if (!isNum(a)) return 30;
  const x = Math.abs(a);
  if (x >= 1.0 && x <= 2.5) return 100;
  if (x >= 0.5 && x < 1.0) return 60;
  if (x > 2.5 && x <= 4.0) return 70;
  if (x < 0.5) return 20;
  return 30;
}
function scoreLiq(avgValue20, region) {
  const minValue = region === "USA" ? 10_000_000 : 5_000_000;
  let s = 100;
  if (isNum(avgValue20) && avgValue20 < minValue) s -= 50;
  return clamp(s); // el spread no está disponible en histórico: se omite (afecta igual a todos)
}
function penalties(base, { p, e20, e50, m1, m3, rvol, rs5d }) {
  let pen = 0;
  if (isNum(p) && isNum(e20) && e20 > 0) {
    const ext = (p - e20) / e20;
    if (ext > 0.30) pen += 25; else if (ext > 0.20) pen += 15; else if (ext > 0.15) pen += 8;
  }
  if (isNum(p) && isNum(e50) && p < e50) pen += 20;
  if (isNum(m1) && m1 > 40) pen += 10;
  if (isNum(m1) && m1 > 60) pen += 15;
  if (isNum(rvol) && rvol > 3.5) pen += 15;
  if (isNum(rs5d) && rs5d < -8) pen += 8;
  if (isNum(rs5d) && rs5d < -15) pen += 8;
  if (isNum(m3) && isNum(m1) && m3 > 15 && m1 < -5) pen += 8;
  return clamp(base - pen);
}

// ─── carga y preparación ─────────────────────────────────────────────────────
console.log("Cargando universo…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyRaw = series["SPY.US"]?.bars;
if (!spyRaw) throw new Error("Falta SPY.US en el histórico");

const dates = spyRaw.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
const spyClose = spyRaw.map((b) => b.a);

function emaSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function retPct(v, i, lb) {
  if (i - lb < 0) return null;
  const past = v[i - lb];
  return past > 0 ? ((v[i] - past) / past) * 100 : null;
}

// El benchmark se necesita indexado por fecha para la fuerza relativa.
const spyRet = (i, lb) => retPct(spyClose, i, lb);

console.log("Precomputando indicadores por ticker…");
const T = [];
for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  const n = bars.length;
  const closes = bars.map((b) => b.c);       // precio sin ajustar: para las señales técnicas
  const adj = bars.map((b) => b.a);          // ajustado: para la RENTABILIDAD real
  const highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v);
  const e5 = emaSeriesOf(closes, 5), e20 = emaSeriesOf(closes, 20), e50 = emaSeriesOf(closes, 50);

  // ATR de Wilder a 14
  const atrPct = new Array(n).fill(null);
  { let atr = null;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      atr = atr == null ? (i >= 14 ? tr : null) : (atr * 13 + tr) / 14;
      if (i === 14) { let s = 0; for (let k = 1; k <= 14; k++) s += Math.max(highs[k] - lows[k], Math.abs(highs[k] - closes[k - 1]), Math.abs(lows[k] - closes[k - 1])); atr = s / 14; }
      if (atr != null && closes[i] > 0) atrPct[i] = (atr / closes[i]) * 100;
    } }

  // Se proyecta cada barra del ticker sobre el calendario maestro (SPY).
  const mi = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) { const k = dateIdx.get(bars[i].d); if (k !== undefined) mi[i] = k; }

  const mAdj = new Array(D).fill(null);      // precio ajustado por fecha (rentabilidad)
  const mClose = new Array(D).fill(null);
  const mLow = new Array(D).fill(null);
  const feat = new Array(D).fill(null);      // rasgos listos para puntuar

  for (let i = 0; i < n; i++) {
    const k = mi[i]; if (k < 0) continue;
    mAdj[k] = adj[i]; mClose[k] = closes[i]; mLow[k] = lows[i];
    if (i < 130) continue;

    const p = closes[i];
    const s20 = isNum(e20[i]) && isNum(e20[i - 5]) && e20[i - 5] !== 0 ? ((e20[i] - e20[i - 5]) / e20[i - 5]) * 100 : null;
    const s50 = isNum(e50[i]) && isNum(e50[i - 5]) && e50[i - 5] !== 0 ? ((e50[i] - e50[i - 5]) / e50[i - 5]) * 100 : null;
    const m1 = retPct(closes, i, 20), m3 = retPct(closes, i, 63), m6 = retPct(closes, i, 126);
    const v20 = vols.slice(i - 19, i + 1), v40 = vols.slice(i - 39, i - 19);
    const av20 = mean(v20), avPrev = mean(v40);
    const rvol = avPrev > 0 ? av20 / avPrev : null;
    const lookback = Math.min(i, 252);
    let hi = 0; for (let k2 = i - lookback + 1; k2 <= i; k2++) if (closes[k2] > hi) hi = closes[k2];
    // Fuerza relativa contra el S&P 500, en la MISMA fecha de calendario.
    const rs3m = m3 != null && spyRet(k, 63) != null ? m3 - spyRet(k, 63) : null;
    const rs6m = m6 != null && spyRet(k, 126) != null ? m6 - spyRet(k, 126) : null;
    const r5 = retPct(closes, i, 5);
    const rs5d = r5 != null && spyRet(k, 5) != null ? r5 - spyRet(k, 5) : null;

    feat[k] = { p, e5: e5[i], e20: e20[i], e50: e50[i], s20, s50, m1, m3, m6,
                rvol, atr: atrPct[i], av: av20 * p, prox: hi > 0 ? p / hi : null, rs3m, rs6m, rs5d };
  }
  T.push({ sym, name: obj.name, region: obj.exchange === "US" ? "USA" : "EU", adj: mAdj, close: mClose, low: mLow, feat });
}
console.log(`Tickers utilizables: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);

// ─── puntuación configurable ─────────────────────────────────────────────────
const BASE_W = { rs: 0.33, mom: 0.23, trend: 0.17, prox: 0.07, rvol: 0.10, atr: 0.05, liq: 0.05 };

function scoreOf(f, region, W, opts = {}) {
  if (!f) return null;
  const sRS = scoreRS(f.rs3m, f.rs6m);
  const sMom = scoreMom(f.m1, f.m3, f.m6);
  const sTr = scoreTrend(f.p, f.e20, f.e50, f.s20, f.s50);
  const sPr = scoreProx(f.prox);
  const sRv = scoreRvol(f.rvol, f.p, f.e5);
  const sAt = scoreAtr(f.atr);
  const sLq = scoreLiq(f.av, region);
  const rawScore = sRS * W.rs + sMom * W.mom + sTr * W.trend + sPr * W.prox + sRv * W.rvol + sAt * W.atr + sLq * W.liq;
  const s = opts.noPenalties ? clamp(rawScore) : penalties(rawScore, { p: f.p, e20: f.e20, e50: f.e50, m1: f.m1, m3: f.m3, rvol: f.rvol, rs5d: f.rs5d });
  return s;
}

// ─── régimen de mercado (filtro opcional) ────────────────────────────────────
const spyEma200 = emaSeriesOf(spyClose, 200);

// ─── simulador ───────────────────────────────────────────────────────────────
function simulate({ topN = 10, review = 21, W = BASE_W, regimeFilter = false, trailPct = null,
                    minScore = 0, noPenalties = false, label = "" }) {
  const FROM = 260, TO = D - 1;
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  const dret = [];
  let held = [];       // [{ti, peak}]
  let trades = 0, daysIn = 0;
  const picksLog = [];

  for (let i = FROM + 1; i <= TO; i++) {
    // rentabilidad del día con la cartera de ayer
    let r = 0;
    if (held.length) {
      for (const h of held) {
        const t = T[h.ti];
        const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) / held.length;
      }
      daysIn++;
    }
    eq *= 1 + r; curve[i] = eq; dret.push(r);

    // trailing stop intradía sobre el máximo alcanzado
    if (trailPct && held.length) {
      const survivors = [];
      for (const h of held) {
        const t = T[h.ti];
        const a = t.adj[i];
        if (isNum(a)) h.peak = Math.max(h.peak ?? a, a);
        const stopped = isNum(a) && h.peak > 0 && a <= h.peak * (1 - trailPct);
        if (stopped) { eq *= 1 - COST_BPS / held.length; trades++; } else survivors.push(h);
      }
      held = survivors;
    }

    if ((i - FROM) % review !== 0) continue;

    // ── revisión: se puntúa con datos hasta i (cierre de hoy), se opera mañana ──
    const regimeOk = !regimeFilter || (isNum(spyEma200[i]) && spyClose[i] >= spyEma200[i]);
    let pick = [];
    if (regimeOk) {
      const cands = [];
      for (let ti = 0; ti < T.length; ti++) {
        const t = T[ti];
        const f = t.feat[i];
        if (!f || !isNum(t.adj[i])) continue;
        const s = scoreOf(f, t.region, W, { noPenalties });
        if (s == null || s < minScore) continue;
        cands.push({ ti, s });
      }
      cands.sort((a, b) => b.s - a.s);
      pick = cands.slice(0, topN).map((c) => ({ ti: c.ti, peak: T[c.ti].adj[i] }));
      if (picksLog.length < 3 && pick.length) {
        picksLog.push({ date: dates[i], top: pick.slice(0, 5).map((x) => T[x.ti].sym) });
      }
    }

    // coste de rotación: solo lo que cambia
    const oldSet = new Set(held.map((h) => h.ti)), newSet = new Set(pick.map((p) => p.ti));
    let turnover = 0;
    for (const ti of newSet) if (!oldSet.has(ti)) turnover++;
    for (const ti of oldSet) if (!newSet.has(ti)) turnover++;
    if (turnover) { eq *= 1 - COST_BPS * (turnover / Math.max(topN, 1)); trades += turnover; }
    // conserva el máximo de los que siguen
    const peaks = new Map(held.map((h) => [h.ti, h.peak]));
    held = pick.map((p) => ({ ti: p.ti, peak: peaks.get(p.ti) ?? p.peak }));
  }

  const years = (TO - FROM) / 252;
  const cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const vol = sd(dret) * Math.sqrt(252);
  const cuts = [FROM, FROM + Math.floor((TO - FROM) / 3), FROM + Math.floor(2 * (TO - FROM) / 3), TO];
  const sub = [];
  for (let k = 0; k < 3; k++) sub.push(Math.pow(curve[cuts[k + 1]] / curve[cuts[k]], 252 / (cuts[k + 1] - cuts[k])) - 1);
  return { label, cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: vol > 0 ? (cagr - 0.03) / vol : 0,
           tradesYr: trades / years, pctIn: daysIn / (TO - FROM), sub, picksLog };
}

function buyHoldSpy() {
  const FROM = 260, TO = D - 1;
  let eq = 1; const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = [];
  for (let i = FROM + 1; i <= TO; i++) { const r = spyClose[i] / spyClose[i - 1] - 1; eq *= 1 + r; curve[i] = eq; dret.push(r); }
  const years = (TO - FROM) / 252, cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const vol = sd(dret) * Math.sqrt(252);
  const cuts = [FROM, FROM + Math.floor((TO - FROM) / 3), FROM + Math.floor(2 * (TO - FROM) / 3), TO];
  const sub = []; for (let k = 0; k < 3; k++) sub.push(Math.pow(curve[cuts[k + 1]] / curve[cuts[k]], 252 / (cuts[k + 1] - cuts[k])) - 1);
  return { label: "SPY comprar y mantener", cagr, mdd, mar: cagr / mdd, sharpe: (cagr - 0.03) / vol, tradesYr: 0, pctIn: 1, sub };
}


// ─── RONDA 2: rejilla centrada en la cadencia larga ──────────────────────────
const f1 = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
function head(t) {
  console.log(`\n=== ${t} ===`);
  console.log("Variante".padEnd(44), "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(6), "Sharpe".padStart(7), "ops/a".padStart(6), "%dentro".padStart(8), "  tercios");
}
function line(r) {
  console.log(r.label.padEnd(44), f1(r.cagr).padStart(7), f1(r.mdd).padStart(7), r.mar.toFixed(2).padStart(6),
    r.sharpe.toFixed(2).padStart(7), r.tradesYr.toFixed(0).padStart(6), f1(r.pctIn, 0).padStart(8),
    "  " + r.sub.map((s) => f1(s, 0)).join(" / "));
}
const WV = {
  "v2.0":        BASE_W,
  "mom":         { rs: 0, mom: 1.00, trend: 0, prox: 0, rvol: 0, atr: 0, liq: 0 },
  "rs+mom":      { rs: 0.50, mom: 0.50, trend: 0, prox: 0, rvol: 0, atr: 0, liq: 0 },
  "rs50mom30t20":{ rs: 0.50, mom: 0.30, trend: 0.20, prox: 0, rvol: 0, atr: 0, liq: 0 },
  "rs+mom+liq":  { rs: 0.45, mom: 0.45, trend: 0, prox: 0, rvol: 0, atr: 0, liq: 0.10 },
};
const rows = [];
for (const [wn, W] of Object.entries(WV))
  for (const review of [42, 63, 84, 126])
    for (const topN of [5, 10, 15])
      for (const noPenalties of [false, true])
        for (const regimeFilter of [false, true]) {
          const r = simulate({ topN, review, W, noPenalties, regimeFilter,
            label: `${wn}·rev${review}·top${topN}${noPenalties ? "·sinPen" : ""}${regimeFilter ? "·reg" : ""}` });
          rows.push(r);
        }
const bh = buyHoldSpy();
head("REFERENCIA");
line(bh);
head("TOP 15 por MAR (rentabilidad / caída máxima)");
[...rows].sort((a, b) => b.mar - a.mar).slice(0, 15).forEach(line);
head("TOP 15 por CAGR");
[...rows].sort((a, b) => b.cagr - a.cagr).slice(0, 15).forEach(line);
head("TOP 12 por Sharpe (consistencia)");
[...rows].sort((a, b) => b.sharpe - a.sharpe).slice(0, 12).forEach(line);
head("MEJORES con caída máxima <= 35% (tolerable)");
[...rows].filter((r) => r.mdd <= 0.35).sort((a, b) => b.cagr - a.cagr).slice(0, 12).forEach(line);
head("Estabilidad: los que ganan en LOS TRES tercios");
[...rows].filter((r) => r.sub.every((s) => s > 0.05)).sort((a, b) => b.cagr - a.cagr).slice(0, 12).forEach(line);

fs.writeFileSync("backtests/rally-backtest-2.json", JSON.stringify({
  ranAt: new Date().toISOString(), period: [dates[260], dates.at(-1)], tickers: T.length,
  buyHold: bh, rows: rows.map(({ picksLog, ...r }) => r) }, null, 1));
console.log(`\nVariantes probadas: ${rows.length}  ·  Guardado: backtests/rally-backtest-2.json`);
