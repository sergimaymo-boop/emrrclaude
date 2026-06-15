/**
 * FABLE01 — BACKTEST DE ROTACIÓN CONTINUA (el modo de inversión real del usuario).
 * =================================================================================
 * Distinto al backtest de cartera anterior (que dejaba caja hasta el siguiente rebalanceo):
 * aquí 10 SLOTS, cada uno con trailing por ATR; cuando un slot SALTA, ese MISMO día rellena
 * con el mejor ticker de tendencia sana disponible (no tenido). Capital siempre trabajando.
 * Costes en CADA entrada y CADA salida (rotar más = más costes — el factor decisivo con stops
 * ajustados). Mark-to-market diario → curva de equity, drawdown y consistencia honestos.
 *
 * Barre el lado AJUSTADO del trailing (1.5×–4.0×ATR) para responder: ¿compensa la rotación
 * inmediata el mayor número de stops de un trailing ajustado? Incluye el bear 2022 (cross-régimen).
 */
import fs from "node:fs";

const CACHE = "/tmp/emrr-bars-5y.json";
const N_SLOTS = 10;
const COST = 20 / 1e4; // one-way bps (spread+slippage+comisión) en cada entrada y cada salida

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const squash = (x, s) => 0.5 * (Math.tanh(x / s) + 1);

if (!fs.existsSync(CACHE)) { console.error("Falta caché 5y."); process.exit(1); }
console.log("Cargando caché…");
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date);
const spyClose = spy.map((b) => b.close);
const D = spyDates.length;
// SPY EMA200 + ret60 por índice de calendario maestro
const spyEMA200 = new Array(D); { const k = 2 / 201; let e = spyClose[0]; for (let i = 0; i < D; i++) { e = spyClose[i] * k + e * (1 - k); spyEMA200[i] = e; } }
const spyRet60 = new Array(D).fill(0); for (let i = 60; i < D; i++) spyRet60[i] = spyClose[i - 60] > 0 ? spyClose[i] / spyClose[i - 60] - 1 : 0;
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));

// ── Precompute por ticker: arrays alineados al calendario maestro (null donde no cotiza) ──
function emaArr(vals, p) { const k = 2 / (p + 1); const out = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out[i] = e; } return out; }
function r2Log(closes, a, b) { // r2 sobre [a,b)
  const n = b - a; if (n < 10) return 0;
  let sx = 0, sy = 0; for (let i = a; i < b; i++) { sy += Math.log(closes[i]); sx += i - a; }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = a; i < b; i++) { const xx = (i - a) - mx, yy = Math.log(closes[i]) - my; sxy += xx * yy; sxx += xx * xx; syy += yy * yy; }
  if (sxx === 0 || syy === 0) return 0; return (sxy * sxy) / (sxx * syy);
}

console.log("Precomputando features diarias…");
const T = []; // por ticker: { sym, idxOf: Map(masterIdx→barIdx), close[],high[],low[], score[], atrPct[] alineados a master }
for (const f of fetched) {
  const bars = f.bars; const n = bars.length;
  const closes = bars.map((b) => b.close), highs = bars.map((b) => b.high), lows = bars.map((b) => b.low), vols = bars.map((b) => b.volume ?? 0);
  if (n < 240) continue;
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e200 = emaArr(closes, 200);
  // ATR14 rolling
  const atrPct = new Array(n).fill(null); { let trSum = 0; const trs = [];
    for (let i = 1; i < n; i++) { const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])); trs.push(tr); trSum += tr; if (trs.length > 14) trSum -= trs.shift(); if (trs.length === 14 && closes[i] > 0) atrPct[i] = (trSum / 14) / closes[i]; } }
  // upDays60 + rvol con sumas deslizantes
  const up = new Array(n).fill(0); for (let i = 1; i < n; i++) up[i] = closes[i] > closes[i - 1] ? 1 : 0;
  const volPrefix = new Array(n + 1).fill(0); for (let i = 0; i < n; i++) volPrefix[i + 1] = volPrefix[i] + vols[i];
  // alinear a master + score
  const mClose = new Array(D).fill(null), mHigh = new Array(D).fill(null), mLow = new Array(D).fill(null), mScore = new Array(D).fill(null), mAtr = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mClose[mi] = closes[bi]; mHigh[mi] = highs[bi]; mLow[mi] = lows[bi]; mAtr[mi] = atrPct[bi];
    if (bi < 230 || atrPct[bi] == null) continue;
    // anti-glitch
    const r5 = [closes[bi - 5], closes[bi - 4], closes[bi - 3], closes[bi - 2], closes[bi - 1]].slice().sort((a, b) => a - b);
    const med = r5[2]; if (med > 0 && Math.abs(closes[bi] / med - 1) > 0.40) continue;
    const last = closes[bi];
    const align = (last > e20[bi] ? 1 : 0) + (e20[bi] > e50[bi] ? 1 : 0) + (e50[bi] > e200[bi] ? 1 : 0);
    const slope20 = e20[bi - 5] !== 0 ? e20[bi] / e20[bi - 5] - 1 : 0;
    if (!(align >= 2 && slope20 > 0)) continue; // elegible (pullback-agnóstico)
    const ret60 = closes[bi - 60] > 0 ? last / closes[bi - 60] - 1 : 0;
    const rs60 = ret60 - spyRet60[mi];
    const r2 = r2Log(closes, bi - 59, bi + 1);
    let upc = 0; for (let k = bi - 58; k <= bi; k++) upc += up[k]; const upDays = upc / 59;
    const vR = (volPrefix[bi + 1] - volPrefix[bi - 4]) / 5, vB = (volPrefix[bi + 1] - volPrefix[bi - 59]) / 60;
    const rvol = vB > 0 ? vR / vB : 1;
    const comp = 0.18 * squash(slope20, 0.04) + 0.30 * squash(rs60, 0.15) + 0.12 * upDays + 0.15 * r2 + 0.15 * squash(ret60, 0.30) + 0.10 * Math.min(rvol, 2) / 2;
    mScore[mi] = Math.min(100, 100 * (comp + (align === 3 ? 0.06 : 0)));
  }
  T.push({ sym: f.sym, close: mClose, high: mHigh, low: mLow, score: mScore, atr: mAtr });
}
console.log(`Tickers con features: ${T.length}\n`);

// ── Simulación de rotación continua diaria ──
// mult: trailing ×ATR (fijo al entrar). regime: si true, en risk-off (SPY<EMA200) limita slots a 35%.
function runRotation(mult, { regime = false } = {}, from = 240, to = D - 1) {
  let equity = 1; const curve = [{ i: from, eq: 1 }];
  const slots = new Array(N_SLOTS).fill(null); // {ti, entry, peak, stopDist}
  let trades = 0; const exitRets = [];
  const W = 1 / N_SLOTS;
  for (let i = from + 1; i <= to; i++) {
    let dayRet = 0;
    // 1) actualizar/parar posiciones
    for (let s = 0; s < N_SLOTS; s++) {
      const h = slots[s]; if (!h) continue;
      const tk = T[h.ti]; const c0 = tk.close[i - 1], c1 = tk.close[i], hi = tk.high[i], lo = tk.low[i];
      if (c1 == null || c0 == null) { continue; } // sin cotización ese día → mantener
      if (hi != null && hi > h.peak) h.peak = hi;
      const stopLevel = h.peak * (1 - h.stopDist);
      if (lo != null && lo <= stopLevel) {
        const r = stopLevel / c0 - 1; dayRet += W * r; equity *= (1 - COST * W); // coste de salida
        exitRets.push(stopLevel / h.entry - 1); trades++; slots[s] = null;
      } else { dayRet += W * (c1 / c0 - 1); }
    }
    equity *= (1 + dayRet); curve.push({ i, eq: equity });
    // 2) rellenar slots vacíos con los mejores tickers sanos no tenidos (entrada al cierre de hoy)
    const riskOn = !regime || spyClose[i] >= spyEMA200[i];
    const maxFilled = riskOn ? N_SLOTS : Math.floor(N_SLOTS * 0.35);
    let filled = slots.filter(Boolean).length;
    if (filled < maxFilled) {
      const held = new Set(slots.filter(Boolean).map((h) => h.ti));
      const cands = [];
      for (let ti = 0; ti < T.length; ti++) { if (held.has(ti)) continue; const sc = T[ti].score[i]; if (sc != null && T[ti].close[i] != null && T[ti].atr[i] != null) cands.push([sc, ti]); }
      cands.sort((a, b) => b[0] - a[0]);
      let ci = 0;
      for (let s = 0; s < N_SLOTS && filled < maxFilled && ci < cands.length; s++) {
        if (slots[s]) continue;
        const ti = cands[ci++][1]; const tk = T[ti];
        slots[s] = { ti, entry: tk.close[i], peak: tk.close[i], stopDist: mult * tk.atr[i] };
        equity *= (1 - COST * W); trades++; filled++;
      }
    }
  }
  // métricas
  const eqArr = curve.map((p) => p.eq); const years = (to - from) / 252;
  const cagr = Math.pow(eqArr.at(-1), 1 / years) - 1;
  let peak = eqArr[0], maxDD = 0; for (const v of eqArr) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const mar = maxDD > 0.001 ? cagr / maxDD : cagr / 0.001;
  const win = exitRets.length ? exitRets.filter((x) => x > 0).length / exitRets.length : 0;
  return { cagr, maxDD, mar, win, trades, tradesYr: trades / years, total: eqArr.at(-1) - 1, curve };
}

const spyRet = (a, b) => spyClose[a] > 0 ? spyClose[b] / spyClose[a] - 1 : 0;

console.log("BARRIDO TRAILING (rotación continua, costes 20bps ida+vuelta, TODO histórico incl. bear):");
console.log("  ×ATR | CAGR    | maxDD  | MAR  | win  | trades/año | (régimen OFF)");
const MULTS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
const rows = [];
for (const m of MULTS) {
  const r = runRotation(m, { regime: false });
  rows.push({ m, ...r });
  console.log(`  ${m.toFixed(1).padStart(4)} | ${(r.cagr * 100).toFixed(1).padStart(6)}% | ${(r.maxDD * 100).toFixed(1).padStart(5)}% | ${r.mar.toFixed(2).padStart(4)} | ${(r.win * 100).toFixed(0)}% | ${r.tradesYr.toFixed(0).padStart(6)}`);
}
console.log("\nCon overlay de RÉGIMEN (caja en risk-off):");
console.log("  ×ATR | CAGR    | maxDD  | MAR  | win  | trades/año");
const rowsR = [];
for (const m of MULTS) {
  const r = runRotation(m, { regime: true });
  rowsR.push({ m, ...r });
  console.log(`  ${m.toFixed(1).padStart(4)} | ${(r.cagr * 100).toFixed(1).padStart(6)}% | ${(r.maxDD * 100).toFixed(1).padStart(5)}% | ${r.mar.toFixed(2).padStart(4)} | ${(r.win * 100).toFixed(0)}% | ${r.tradesYr.toFixed(0).padStart(6)}`);
}

// Mejor por MAR (con régimen) → desglose por régimen + consistencia vs SPY
rowsR.sort((a, b) => b.mar - a.mar);
const best = rowsR[0];
console.log(`\n🏆 Mejor (con régimen): ${best.m}×ATR → CAGR ${(best.cagr * 100).toFixed(1)}% · maxDD ${(best.maxDD * 100).toFixed(1)}% · MAR ${best.mar.toFixed(2)} · win ${(best.win * 100).toFixed(0)}% · ${best.tradesYr.toFixed(0)} trades/año`);
console.log("\nDesglose por régimen (tramos ~9 meses), mejor config:");
const segs = 6; const segL = Math.floor((D - 1 - 240) / segs); let segWins = 0;
for (let s = 0; s < segs; s++) {
  const a = 240 + s * segL, b = s === segs - 1 ? D - 1 : 240 + (s + 1) * segL;
  const r = runRotation(best.m, { regime: true }, a, b);
  const sp = spyRet(a, b);
  if (r.total > sp) segWins++;
  console.log(`  ${spyDates[a]}→${spyDates[b]}: ${(r.total * 100).toFixed(1).padStart(6)}% vs SPY ${(sp * 100).toFixed(1).padStart(6)}%  ${r.total > sp ? "✅" : "❌"}`);
}
console.log(`\nGana al SPY en ${segWins}/${segs} tramos.`);
const spyFull = spyRet(240, D - 1);
console.log(`Total histórico: estrategia ${(best.total * 100).toFixed(0)}% vs SPY ${(spyFull * 100).toFixed(0)}%`);
