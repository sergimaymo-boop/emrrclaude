/**
 * OPTIMAL SUPREME — SWEEP 4: ROTACIÓN PROACTIVA RÁPIDA (mandato 25-jul-2026).
 * Pregunta de Sergi: ¿mejora saltar al mejor ticker SIN esperar al trailing stop,
 * con rotaciones en días/semanas, y con un régimen de ciclo económico más fino?
 *
 * Grid (45 combos + sensibilidad a costes):
 *   • REBAL: 1 / 2 / 5 / 10 / 21 sesiones (diario→mensual)
 *   • HYST (histéresis de salto): 1.00 = rotar SIEMPRE al top-2 actual;
 *     1.10 / 1.25 = rotar solo si el candidato supera al tenido en 10%/25% de score
 *     (sin histéresis, la rotación rápida muere por whipsaw+costes)
 *   • RÉGIMEN: b200 (binario EMA200, actual) / b100 (EMA100, más rápido) /
 *     graded (3 niveles: sobre EMA100+200→100% · solo sobre EMA200→65% · debajo→30%)
 * Fijo: trailing bandas TR/TN/TA con rotación al saltar, VT30/10d, costes 20bps/lado.
 * ANCLA de validación: rebal21 · hyst1.0 · b200 debe reproducir ≈ CAGR 50.2 / DD 26.9 / MAR 1.87.
 * Al final: los 3 mejores por MAR se re-simulan con costes 10bps (hipótesis "IBK barato").
 */
import fs from "node:fs";

const CACHE = "/tmp/emrr-bars-10y.json";
const OUT = "/tmp/backtest-supreme4-results.json";
const N_POS = 2;
const LB_LONG = 189, LB_SKIP = 42, VOL_W = 63;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

console.log("Cargando caché 10y…");
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date), spyClose = spy.map((b) => b.close);
const D = spyDates.length;
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));
function emaSeries(vals, p) { const k = 2 / (p + 1); const out = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out[i] = e; } return out; }
const spyEMA200 = emaSeries(spyClose, 200);
const spyEMA100 = emaSeries(spyClose, 100);
const spyRetLong = new Array(D).fill(0); for (let i = LB_LONG; i < D; i++) spyRetLong[i] = spyClose[i - LB_LONG] > 0 ? spyClose[i] / spyClose[i - LB_LONG] - 1 : 0;

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
  const e20 = emaSeries(closes, 20), e50 = emaSeries(closes, 50), e200 = emaSeries(closes, 200);
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
function candidatesAt(i) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const tk = T[ti];
    if (tk.raw[i] == null || tk.close[i] == null || tk.atr[i] == null) continue;
    cands.push({ ti, raw: tk.raw[i] });
  }
  cands.sort((a, b) => b.raw - a.raw);
  return cands;
}
function exposureAt(i, regimeType) {
  const c = spyClose[i], e200 = spyEMA200[i], e100 = spyEMA100[i];
  if (regimeType === "b100") return c >= e100 ? 1.0 : 0.30;
  if (regimeType === "graded") {
    if (c >= e200 && c >= e100) return 1.0;
    if (c >= e200) return 0.65;
    return 0.30;
  }
  return c >= e200 ? 1.0 : 0.30; // b200 (actual)
}

function simulate({ rebal = 21, hyst = 1.0, regimeType = "b200", cost = 20 / 1e4 }) {
  const FROM = 240, TO = D - 1;
  let equity = 1;
  const curve = new Array(TO + 1).fill(null); curve[FROM] = 1;
  const dailyPort = [];
  let slots = [];
  let trades = 0;
  let nextRebal = FROM;

  for (let i = FROM + 1; i <= TO; i++) {
    let expo = exposureAt(i - 1, regimeType);
    if (dailyPort.length >= 10 && expo > 0) {
      const recent = dailyPort.slice(-10);
      const mu = mean(recent), sd = Math.sqrt(mean(recent.map((r) => (r - mu) ** 2)));
      const realized = sd * Math.sqrt(252);
      if (realized > 0.30) expo = expo * (0.30 / realized);
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
        equity *= (1 - cost * h.w);
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
    if (slots.length < N_POS && expo > 0.02) {
      const held = new Set(slots.map((h) => h.ti));
      const cands = candidatesAt(i).filter((c) => !held.has(c.ti));
      const wPer = expo / N_POS;
      let ci = 0;
      while (slots.length < N_POS && ci < cands.length) {
        const { ti } = cands[ci++];
        const tk = T[ti];
        slots.push({ ti, peak: tk.close[i], stopDist: bandMult(tk.atr[i], tk.r2[i] ?? 0.5) * tk.atr[i], w: wPer });
        equity *= (1 - cost * wPer); trades++;
      }
    }

    // ── ROTACIÓN PROACTIVA con histéresis (la idea de Sergi) ──────────────────
    if (i >= nextRebal) {
      nextRebal = i + rebal;
      if (expo > 0.02) {
        const cands = candidatesAt(i);
        const heldSet = new Set(slots.map((h) => h.ti));
        // Para cada posición tenida: rotar si el mejor candidato NO tenido la supera en ×hyst
        // (o si la posición dejó de ser elegible). hyst=1.0 replica el rebalanceo clásico.
        const avail = cands.filter((c) => !heldSet.has(c.ti));
        let ai = 0;
        for (let s = 0; s < slots.length; s++) {
          const h = slots[s];
          const heldRaw = T[h.ti].raw[i];
          const best = avail[ai];
          const mustRotate = heldRaw == null || (best && best.raw > (heldRaw ?? 0) * hyst);
          if (mustRotate && best) {
            equity *= (1 - cost * h.w); trades++;           // vender tenida
            const tk = T[best.ti];
            slots[s] = { ti: best.ti, peak: tk.close[i], stopDist: bandMult(tk.atr[i], tk.r2[i] ?? 0.5) * tk.atr[i], w: h.w };
            equity *= (1 - cost * h.w); trades++;           // comprar nueva
            ai++;
          }
        }
        // recomponer pesos al expo/score actual
        const raws = slots.map((h) => Math.max(0.0001, T[h.ti].raw[i] ?? 0.0001));
        const rSum = raws.reduce((a, b) => a + b, 0) || 1;
        for (let s = 0; s < slots.length; s++) {
          const wT = expo * raws[s] / rSum;
          const dw = Math.abs(wT - slots[s].w);
          if (dw > 0.01) equity *= (1 - cost * dw);
          slots[s].w = wT;
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
  const third = Math.floor(eq.length / 3);
  const sub = [0, 1, 2].map((t) => {
    const a = eq[t * third], b = eq[t === 2 ? eq.length - 1 : (t + 1) * third];
    const yrs = (t === 2 ? eq.length - 1 - t * third : third) / 252;
    return +(100 * (Math.pow(b / a, 1 / yrs) - 1)).toFixed(1);
  });
  return {
    cagr: +(cagr * 100).toFixed(1), maxDD: +(maxDD * 100).toFixed(1),
    mar: +(cagr / maxDD).toFixed(2), sharpe: +((mu / sd) * Math.sqrt(252)).toFixed(2),
    tradesYr: +(trades / years).toFixed(0), sub,
  };
}

console.log("Sweep 4 — rotación proactiva (rebal × histéresis × régimen)…\n");
const results = {};
for (const regimeType of ["b200", "b100", "graded"]) {
  for (const rebal of [1, 2, 5, 10, 21]) {
    for (const hyst of [1.0, 1.1, 1.25]) {
      const key = `${regimeType}_r${rebal}_h${hyst}`;
      results[key] = simulate({ rebal, hyst, regimeType });
      const r = results[key];
      console.log(`${key.padEnd(20)} CAGR ${String(r.cagr).padStart(5)}% | DD ${String(r.maxDD).padStart(5)}% | MAR ${String(r.mar).padStart(5)} | ops/a ${String(r.tradesYr).padStart(4)} | sub [${r.sub}]`);
    }
  }
}

const byMar = Object.entries(results).sort((a, b) => (b[1].mar - a[1].mar));
console.log("\n🥇 TOP 8 por MAR (costes 20bps/lado):");
for (const [name, r] of byMar.slice(0, 8))
  console.log(`  ${name}: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | ops/año ${r.tradesYr}`);

console.log("\n💸 Sensibilidad a costes — top 3 re-simulados a 10bps/lado (hipótesis IBK barato):");
const low = {};
for (const [name] of byMar.slice(0, 3)) {
  const [regimeType, rStr, hStr] = name.split("_");
  const r = simulate({ rebal: +rStr.slice(1), hyst: +hStr.slice(1), regimeType, cost: 10 / 1e4 });
  low[`${name}_10bps`] = r;
  console.log(`  ${name} @10bps: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | ops/año ${r.tradesYr}`);
}

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), universe: T.length, results, lowCost: low }, null, 2));
console.log(`\nResultados → ${OUT}`);
