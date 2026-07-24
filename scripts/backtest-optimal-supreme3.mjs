/**
 * OPTIMAL SUPREME — SWEEP 3: ataque directo al drawdown residual.
 * Sweep 2: top-2 score + bandas + vt25 = MAR 1.77 (CAGR 47.6 / DD 26.9). Diversificar NO ayuda.
 * El DD residual viene de crashes rápidos (mar-2020) donde EMA200 llega tarde.
 * Palancas nuevas:
 *   • CRASH FILTER: SPY ret10 < −6% → exposición 0 (cierra todo) hasta ret10 > 0
 *   • riskOffDeploy 0.30 / 0.15 / 0.0 (defensivo más duro)
 *   • vol-targeting reactivo: ventana 10d además de 20d; targets 25% / 30%
 * Estructura fija: n2, pesos por score, trailing bandas TR/TN/TA, rotación inmediata.
 */
import fs from "node:fs";

const CACHE = "/tmp/emrr-bars-10y.json";
const OUT = "/tmp/backtest-supreme3-results.json";
const COST = 20 / 1e4;
const REBAL = 21;
const N_POS = 2;
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
const spyRet10 = new Array(D).fill(0); for (let i = 10; i < D; i++) spyRet10[i] = spyClose[i - 10] > 0 ? spyClose[i] / spyClose[i - 10] - 1 : 0;

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
  const lr = new Array(n).fill(0); for (let i = 1; i < n; i++) lr[i] = Math.log(closes[i] / closes[i - 1]);
  const mClose = new Array(D).fill(null), mHigh = new Array(D).fill(null), mLow = new Array(D).fill(null);
  const mRaw = new Array(D).fill(null), mAtr = new Array(D).fill(null), mR2 = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mClose[mi] = closes[bi]; mHigh[mi] = highs[bi]; mLow[mi] = lows[bi]; mAtr[mi] = atrPct[bi];
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
    mRaw[mi] = raw; mR2[mi] = r2Log(closes, bi - 59, bi + 1);
  }
  T.push({ sym: f.sym, close: mClose, high: mHigh, low: mLow, raw: mRaw, atr: mAtr, r2: mR2 });
}
console.log(`Tickers: ${T.length}\n`);

function bandMult(atrPct, r2) {
  if (atrPct < 0.025 && r2 > 0.70) return 2.5;
  if (atrPct > 0.045 || r2 < 0.40) return 4.0;
  return 3.0;
}
function pickTop(i, held) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    if (held.has(ti)) continue;
    const tk = T[ti];
    if (tk.raw[i] == null || tk.close[i] == null || tk.atr[i] == null) continue;
    cands.push([tk.raw[i], ti]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  return cands;
}

function simulate({ riskOffDeploy = 0.30, volTarget = null, volWin = 20, crashFilter = false, crashThr = -0.06 }) {
  const FROM = 240, TO = D - 1;
  let equity = 1;
  const curve = new Array(TO + 1).fill(null); curve[FROM] = 1;
  const dailyPort = [];
  let slots = [];
  let trades = 0;
  let nextRebal = FROM;
  let crashMode = false;

  for (let i = FROM + 1; i <= TO; i++) {
    // señales con datos de AYER (sin lookahead)
    if (crashFilter) {
      if (!crashMode && spyRet10[i - 1] < crashThr) crashMode = true;
      else if (crashMode && spyRet10[i - 1] > 0) crashMode = false;
    }
    const riskOn = spyClose[i - 1] >= spyEMA200[i - 1];
    let expo = crashMode ? 0 : (riskOn ? 1.0 : riskOffDeploy);
    if (volTarget != null && dailyPort.length >= volWin && expo > 0) {
      const recent = dailyPort.slice(-volWin);
      const mu = mean(recent), sd = Math.sqrt(mean(recent.map((r) => (r - mu) ** 2)));
      const realized = sd * Math.sqrt(252);
      if (realized > volTarget) expo = expo * (volTarget / realized);
    }
    let dayRet = 0;

    // mark-to-market + trailing
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

    // crash: cerrar TODO hoy
    if (crashMode && slots.length) {
      for (const h of slots) { equity *= (1 - COST * h.w); trades++; }
      slots = [];
    }

    equity *= (1 + dayRet);
    curve[i] = equity;
    dailyPort.push(dayRet);

    // rotación inmediata tras stop (si no crash)
    if (!crashMode && slots.length < N_POS && expo > 0.02) {
      const held = new Set(slots.map((h) => h.ti));
      const cands = pickTop(i, held);
      const wPer = expo / N_POS;
      while (slots.length < N_POS && cands.length) {
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
      if (!crashMode && expo > 0.02) {
        const top = pickTop(i, new Set()).slice(0, N_POS);
        const rawSum = top.reduce((s, c) => s + c[0], 0) || 1;
        const target = new Map(top.map(([raw, ti]) => [ti, expo * raw / rawSum]));
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

console.log("Sweep 3 — crash filter + régimen duro + vt reactivo…\n");
const results = {};
for (const riskOff of [0.30, 0.15, 0.0]) {
  for (const crash of [false, true]) {
    for (const vt of [null, { t: 0.25, w: 20 }, { t: 0.25, w: 10 }, { t: 0.30, w: 10 }]) {
      const key = `ro${riskOff * 100}_${crash ? "CRASH" : "noCr"}_${vt ? `vt${vt.t * 100}w${vt.w}` : "noVT"}`;
      results[key] = simulate({ riskOffDeploy: riskOff, crashFilter: crash, volTarget: vt?.t ?? null, volWin: vt?.w ?? 20 });
      const r = results[key];
      console.log(`${key.padEnd(26)} CAGR ${String(r.cagr).padStart(5)}% | DD ${String(r.maxDD).padStart(5)}% | MAR ${String(r.mar).padStart(5)} | Sh ${r.sharpe} | sub [${r.sub}]`);
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), universe: T.length, results }, null, 2));
console.log(`\nResultados → ${OUT}`);

const moderate = Object.entries(results).filter(([, r]) => r.maxDD <= 23).sort((a, b) => (b[1].cagr - a[1].cagr));
console.log("\n🏆 RIESGO MODERADO (DD ≤ 23%), por CAGR:");
for (const [name, r] of moderate.slice(0, 10))
  console.log(`  ${name}: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | Sharpe ${r.sharpe} | sub [${r.sub}]`);
const byMar = Object.entries(results).sort((a, b) => (b[1].mar - a[1].mar));
console.log("\n🥇 TOP MAR global:");
for (const [name, r] of byMar.slice(0, 10))
  console.log(`  ${name}: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | Sharpe ${r.sharpe} | sub [${r.sub}]`);
