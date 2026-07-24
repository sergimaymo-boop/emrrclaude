/**
 * OPTIMAL SUPREME — SWEEP 2: control de drawdown (riesgo moderado).
 * El sweep 1 mostró: universo 603 → top-2 da CAGR 61.6% pero DD 40%.
 * Trailing bandas (MAR 1.75) y entry filter (DD 30.7%) ayudan; VIX no.
 * Objetivo: DD ≤ 20-22% conservando el máximo CAGR. Palancas:
 *   • nPos 2/3/4 (diversificación)
 *   • pesos score-proporcional vs inverse-vol (risk parity real)
 *   • vol-targeting de cartera (Barroso & Santa-Clara 2015): expo = min(1, target/realized)
 *   • combo trailing bandas + entry filter
 */
import fs from "node:fs";

const CACHE = "/tmp/emrr-bars-10y.json";
const OUT = "/tmp/backtest-supreme2-results.json";
const COST = 20 / 1e4;
const REBAL = 21;
const LB_LONG = 189, LB_SKIP = 42, VOL_W = 63;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

console.log("Cargando caché 10y…");
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date), spyClose = spy.map((b) => b.close);
const D = spyDates.length;
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));
const spyEMA200 = new Array(D); { const k = 2 / 201; let e = spyClose[0]; for (let i = 0; i < D; i++) { e = i === 0 ? spyClose[0] : spyClose[i] * k + e * (1 - k); spyEMA200[i] = e; } }
const spyRetLong = new Array(D).fill(0); for (let i = LB_LONG; i < D; i++) spyRetLong[i] = spyClose[i - LB_LONG] > 0 ? spyClose[i] / spyClose[i - LB_LONG] - 1 : 0;

function emaArr(vals, p) { const k = 2 / (p + 1); const out = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out[i] = e; } return out; }
function r2Log(closes, a, b) {
  const n = b - a; if (n < 10) return 0;
  let sx = 0, sy = 0; for (let i = a; i < b; i++) { sy += Math.log(closes[i]); sx += i - a; }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = a; i < b; i++) { const xx = (i - a) - mx, yy = Math.log(closes[i]) - my; sxy += xx * yy; sxx += xx * xx; syy += yy * yy; }
  if (sxx === 0 || syy === 0) return 0; return (sxy * sxy) / (sxx * syy);
}

console.log("Precomputando features…");
const T = [];
for (const f of fetched) {
  const bars = f.bars, n = bars.length;
  if (n < 240) continue;
  const closes = bars.map((b) => b.close), highs = bars.map((b) => b.high), lows = bars.map((b) => b.low);
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e200 = emaArr(closes, 200);
  const atrPct = new Array(n).fill(null); { let trSum = 0; const trs = [];
    for (let i = 1; i < n; i++) { const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])); trs.push(tr); trSum += tr; if (trs.length > 14) trSum -= trs.shift(); if (trs.length === 14 && closes[i] > 0) atrPct[i] = (trSum / 14) / closes[i]; } }
  const rsi = new Array(n).fill(50); { let ag = 0, al = 0;
    for (let i = 1; i < n; i++) { const ch = closes[i] - closes[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  const lr = new Array(n).fill(0); for (let i = 1; i < n; i++) lr[i] = Math.log(closes[i] / closes[i - 1]);

  const mClose = new Array(D).fill(null), mHigh = new Array(D).fill(null), mLow = new Array(D).fill(null);
  const mRaw = new Array(D).fill(null), mAtr = new Array(D).fill(null), mR2 = new Array(D).fill(null);
  const mRsi = new Array(D).fill(null), mDist20 = new Array(D).fill(null), mVol = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mClose[mi] = closes[bi]; mHigh[mi] = highs[bi]; mLow[mi] = lows[bi]; mAtr[mi] = atrPct[bi];
    mRsi[mi] = rsi[bi]; mDist20[mi] = e20[bi] > 0 ? closes[bi] / e20[bi] - 1 : null;
    if (bi < 230 || atrPct[bi] == null) continue;
    const r5 = [closes[bi - 5], closes[bi - 4], closes[bi - 3], closes[bi - 2], closes[bi - 1]].slice().sort((a, b) => a - b);
    const med = r5[2]; if (med > 0 && Math.abs(closes[bi] / med - 1) > 0.40) continue;
    const last = closes[bi];
    const retLong = closes[bi - LB_LONG] > 0 ? last / closes[bi - LB_LONG] - 1 : 0;
    const retSkip = closes[bi - LB_SKIP] > 0 ? last / closes[bi - LB_SKIP] - 1 : 0;
    let s2 = 0; for (let k = bi - VOL_W + 1; k <= bi; k++) s2 += lr[k] * lr[k];
    const vol63 = Math.sqrt((s2 / VOL_W) * 252);
    const align = (last > e20[bi] ? 1 : 0) + (e20[bi] > e50[bi] ? 1 : 0) + (e50[bi] > e200[bi] ? 1 : 0);
    if (!(retLong > 0 && align >= 2 && vol63 > 0.02 && vol63 < 2.5)) continue;
    const riskAdjMom = (retLong - retSkip) / vol63;
    const rsLong = clamp(retLong - spyRetLong[mi], -0.5, 0.5);
    const raw = riskAdjMom * (1 + 0.5 * rsLong) * (0.85 + 0.05 * align);
    if (!(raw > 0)) continue;
    mRaw[mi] = raw; mR2[mi] = r2Log(closes, bi - 59, bi + 1); mVol[mi] = vol63;
  }
  T.push({ sym: f.sym, close: mClose, high: mHigh, low: mLow, raw: mRaw, atr: mAtr, r2: mR2, rsi: mRsi, dist20: mDist20, vol: mVol });
}
console.log(`Tickers: ${T.length}\n`);

function bandMult(atrPct, r2) {
  if (atrPct < 0.025 && r2 > 0.70) return 2.5;
  if (atrPct > 0.045 || r2 < 0.40) return 4.0;
  return 3.0;
}
function pickTop(i, held, entryFilter) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    if (held.has(ti)) continue;
    const tk = T[ti];
    if (tk.raw[i] == null || tk.close[i] == null || tk.atr[i] == null) continue;
    if (entryFilter && ((tk.rsi[i] != null && tk.rsi[i] >= 80) || (tk.dist20[i] != null && tk.dist20[i] >= 0.12))) continue;
    cands.push([tk.raw[i], ti]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  return cands;
}

function simulate({ nPos = 2, weightMode = "score", entryFilter = false, volTarget = null, riskOffDeploy = 0.30 }) {
  const FROM = 240, TO = D - 1;
  let equity = 1;
  const curve = new Array(TO + 1).fill(null); curve[FROM] = 1;
  const dailyPort = []; // retornos diarios de cartera para vol-targeting
  let slots = [];
  let trades = 0;
  let nextRebal = FROM;

  function weightsFor(cands, i, expo) {
    // cands: [[raw, ti],...] recortado a nPos
    if (weightMode === "invvol") {
      const ivs = cands.map(([, ti]) => 1 / Math.max(0.05, T[ti].vol[i] ?? 0.3));
      const s = ivs.reduce((a, b) => a + b, 0) || 1;
      return cands.map(([, ti], k) => [ti, expo * ivs[k] / s]);
    }
    const s = cands.reduce((a, c) => a + c[0], 0) || 1;
    return cands.map(([raw, ti]) => [ti, expo * raw / s]);
  }

  for (let i = FROM + 1; i <= TO; i++) {
    const riskOn = spyClose[i - 1] >= spyEMA200[i - 1];
    let expo = riskOn ? 1.0 : riskOffDeploy;
    if (volTarget != null && dailyPort.length >= 20) {
      const recent = dailyPort.slice(-20);
      const mu = mean(recent), sd = Math.sqrt(mean(recent.map((r) => (r - mu) ** 2)));
      const realized = sd * Math.sqrt(252);
      if (realized > 0) expo = Math.min(expo, expo * (volTarget / realized));
    }
    let dayRet = 0;

    for (let s = 0; s < slots.length; s++) {
      const h = slots[s]; if (!h) continue;
      const tk = T[h.ti]; const c0 = tk.close[i - 1], c1 = tk.close[i], hi = tk.high[i], lo = tk.low[i];
      if (c1 == null || c0 == null) continue;
      if (hi != null && hi > h.peak) h.peak = hi;
      const stopLevel = h.peak * (1 - h.stopDist);
      if (lo != null && lo <= stopLevel) {
        dayRet += h.w * (stopLevel / c0 - 1);
        equity *= (1 - COST * h.w);
        trades++; slots[s] = null;
        continue;
      }
      dayRet += h.w * (c1 / c0 - 1);
    }
    slots = slots.filter(Boolean);
    equity *= (1 + dayRet);
    curve[i] = equity;
    dailyPort.push(dayRet);

    // rotación inmediata tras stop
    if (slots.length < nPos) {
      const held = new Set(slots.map((h) => h.ti));
      const cands = pickTop(i, held, entryFilter);
      const wPer = expo / nPos;
      while (slots.length < nPos && cands.length) {
        const [, ti] = cands.shift();
        const tk = T[ti];
        const mult = bandMult(tk.atr[i], tk.r2[i] ?? 0.5);
        slots.push({ ti, peak: tk.close[i], stopDist: mult * tk.atr[i], w: wPer });
        equity *= (1 - COST * wPer); trades++;
      }
    }

    // rebalanceo mensual
    if (i >= nextRebal) {
      nextRebal = i + REBAL;
      const top = pickTop(i, new Set(), entryFilter).slice(0, nPos);
      const target = new Map(weightsFor(top, i, expo));
      for (let s = 0; s < slots.length; s++) {
        const h = slots[s];
        if (!target.has(h.ti)) { equity *= (1 - COST * h.w); trades++; slots[s] = null; }
      }
      slots = slots.filter(Boolean);
      for (const [ti, w] of target) {
        const ex = slots.find((h) => h.ti === ti);
        if (ex) { const dw = Math.abs(w - ex.w); if (dw > 0.01) equity *= (1 - COST * dw); ex.w = w; }
        else {
          const tk = T[ti]; if (tk.close[i] == null || tk.atr[i] == null) continue;
          const mult = bandMult(tk.atr[i], tk.r2[i] ?? 0.5);
          slots.push({ ti, peak: tk.close[i], stopDist: mult * tk.atr[i], w });
          equity *= (1 - COST * w); trades++;
        }
      }
    }
  }

  const eq = []; for (let i = FROM; i <= TO; i++) if (curve[i] != null) eq.push(curve[i]);
  const years = eq.length / 252;
  const cagr = Math.pow(eq.at(-1) / eq[0], 1 / years) - 1;
  let peak = eq[0], maxDD = 0; for (const v of eq) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const dRets = []; for (let k = 1; k < eq.length; k++) dRets.push(eq[k] / eq[k - 1] - 1);
  const mu = mean(dRets), sd = Math.sqrt(mean(dRets.map((r) => (r - mu) ** 2))) || 1;
  const sharpe = (mu / sd) * Math.sqrt(252);
  let wins = 0, months = 0;
  for (let k = 21; k < eq.length; k += 21) { months++; if (eq[k] > eq[k - 21]) wins++; }
  const third = Math.floor(eq.length / 3);
  const sub = [0, 1, 2].map((t) => {
    const a = eq[t * third], b = eq[t === 2 ? eq.length - 1 : (t + 1) * third];
    const yrs = (t === 2 ? eq.length - 1 - t * third : third) / 252;
    return +(100 * (Math.pow(b / a, 1 / yrs) - 1)).toFixed(1);
  });
  return {
    cagr: +(cagr * 100).toFixed(1), maxDD: +(maxDD * 100).toFixed(1),
    mar: +(cagr / maxDD).toFixed(2), sharpe: +sharpe.toFixed(2),
    winMo: +((wins / months) * 100).toFixed(0), tradesYr: +(trades / years).toFixed(0), sub,
  };
}

console.log("Sweep 2 — control de drawdown…\n");
const results = {};
for (const nPos of [2, 3, 4]) {
  for (const weightMode of ["score", "invvol"]) {
    for (const entryFilter of [false, true]) {
      for (const volTarget of [null, 0.25, 0.20]) {
        const key = `n${nPos}_${weightMode}_${entryFilter ? "EF" : "noEF"}_${volTarget ? `vt${volTarget * 100}` : "noVT"}`;
        results[key] = simulate({ nPos, weightMode, entryFilter, volTarget });
        const r = results[key];
        console.log(`${key.padEnd(28)} CAGR ${String(r.cagr).padStart(5)}% | DD ${String(r.maxDD).padStart(5)}% | MAR ${String(r.mar).padStart(5)} | Sh ${r.sharpe} | ops/a ${r.tradesYr}`);
      }
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), universe: T.length, results }, null, 2));
console.log(`\nResultados → ${OUT}`);

const moderate = Object.entries(results).filter(([, r]) => r.maxDD <= 22).sort((a, b) => (b[1].cagr - a[1].cagr));
console.log("\n🏆 RIESGO MODERADO (DD ≤ 22%), por CAGR:");
for (const [name, r] of moderate.slice(0, 8))
  console.log(`  ${name}: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | Sharpe ${r.sharpe}`);
const byMar = Object.entries(results).sort((a, b) => (b[1].mar - a[1].mar));
console.log("\n🥇 TOP MAR global:");
for (const [name, r] of byMar.slice(0, 8))
  console.log(`  ${name}: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | Sharpe ${r.sharpe}`);
