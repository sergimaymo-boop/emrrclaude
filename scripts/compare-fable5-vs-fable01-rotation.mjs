/**
 * COMPARATIVA INFORMATIVA — FABLE 5 (1er módulo) vs FABLE01 (2º módulo) con la MISMA estrategia.
 * ================================================================================================
 * NO modifica ningún módulo desplegado. Solo backtest comparativo a efectos informativos.
 *
 * Misma mecánica de rotación continua para AMBOS (idénticas condiciones — solo cambia la SEÑAL):
 *   10 slots · trailing por ATR · al saltar el stop, rellena ese mismo día con el mejor ticker
 *   según la señal del módulo · costes 20bps en cada entrada y salida · mark-to-market diario ·
 *   overlay de régimen (caja en risk-off) · TODO el histórico (incl. bear 2022).
 *
 * Señal FABLE 5 : elegible align===3 && pendiente>0 && anti-blowoff (RSI<80, ret5<15%, distMA20<12%);
 *                 score = pendiente×50 + R²×2 + consistencia + cercanía a máximos×2.   (excluye pullback)
 * Señal FABLE01 : elegible align>=2 && pendiente>0 (pullback-AGNÓSTICO);
 *                 score = RS-vs-SPY + pendiente + momentum + R² + RVOL (composite squash).
 */
import fs from "node:fs";

const CACHE = "/tmp/emrr-bars-5y.json";
const N_SLOTS = 10;
const COST = 20 / 1e4;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const squash = (x, s) => 0.5 * (Math.tanh(x / s) + 1);

if (!fs.existsSync(CACHE)) { console.error("Falta caché 5y."); process.exit(1); }
console.log("Cargando caché…");
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date);
const spyClose = spy.map((b) => b.close);
const D = spyDates.length;
const spyEMA200 = new Array(D); { const k = 2 / 201; let e = spyClose[0]; for (let i = 0; i < D; i++) { e = spyClose[i] * k + e * (1 - k); spyEMA200[i] = e; } }
const spyRet60 = new Array(D).fill(0); for (let i = 60; i < D; i++) spyRet60[i] = spyClose[i - 60] > 0 ? spyClose[i] / spyClose[i - 60] - 1 : 0;
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));

function emaArr(vals, p) { const k = 2 / (p + 1); const out = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out[i] = e; } return out; }
function r2Log(closes, a, b) { const n = b - a; if (n < 10) return 0; let sy = 0; for (let i = a; i < b; i++) sy += Math.log(closes[i]); const mx = (n - 1) / 2, my = sy / n; let sxy = 0, sxx = 0, syy = 0; for (let i = a; i < b; i++) { const xx = (i - a) - mx, yy = Math.log(closes[i]) - my; sxy += xx * yy; sxx += xx * xx; syy += yy * yy; } if (sxx === 0 || syy === 0) return 0; return (sxy * sxy) / (sxx * syy); }

console.log("Precomputando features diarias (ambas señales)…");
const T = [];
for (const f of fetched) {
  const bars = f.bars; const n = bars.length; if (n < 240) continue;
  const closes = bars.map((b) => b.close), highs = bars.map((b) => b.high), lows = bars.map((b) => b.low), vols = bars.map((b) => b.volume ?? 0);
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e200 = emaArr(closes, 200);
  const atrPct = new Array(n).fill(null); { let s = 0; const q = []; for (let i = 1; i < n; i++) { const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])); q.push(tr); s += tr; if (q.length > 14) s -= q.shift(); if (q.length === 14 && closes[i] > 0) atrPct[i] = (s / 14) / closes[i]; } }
  const up = new Array(n).fill(0); for (let i = 1; i < n; i++) up[i] = closes[i] > closes[i - 1] ? 1 : 0;
  const volPre = new Array(n + 1).fill(0); for (let i = 0; i < n; i++) volPre[i + 1] = volPre[i] + vols[i];
  // RSI14 simple (gains/losses sobre 14) rolling
  const rsi = new Array(n).fill(50); { let g = 0, l = 0; const ch = []; for (let i = 1; i < n; i++) { const c = closes[i] - closes[i - 1]; ch.push(c); g += c > 0 ? c : 0; l += c < 0 ? -c : 0; if (ch.length > 14) { const old = ch.shift(); g -= old > 0 ? old : 0; l -= old < 0 ? -old : 0; } if (ch.length === 14) { const rs = l === 0 ? 100 : g / l; rsi[i] = 100 - 100 / (1 + rs); } } }
  // máximo 252 sesiones (dist52H) con deque monótona
  const hi252 = new Array(n).fill(null); { const dq = []; for (let i = 0; i < n; i++) { while (dq.length && highs[dq[dq.length - 1]] <= highs[i]) dq.pop(); dq.push(i); while (dq[0] <= i - 252) dq.shift(); hi252[i] = highs[dq[0]]; } }

  const mClose = new Array(D).fill(null), mHigh = new Array(D).fill(null), mLow = new Array(D).fill(null), mAtr = new Array(D).fill(null);
  const s01 = new Array(D).fill(null), s05 = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mClose[mi] = closes[bi]; mHigh[mi] = highs[bi]; mLow[mi] = lows[bi]; mAtr[mi] = atrPct[bi];
    if (bi < 230 || atrPct[bi] == null) continue;
    const r5 = [closes[bi - 5], closes[bi - 4], closes[bi - 3], closes[bi - 2], closes[bi - 1]].slice().sort((a, b) => a - b);
    if (r5[2] > 0 && Math.abs(closes[bi] / r5[2] - 1) > 0.40) continue; // anti-glitch
    const last = closes[bi];
    const align = (last > e20[bi] ? 1 : 0) + (e20[bi] > e50[bi] ? 1 : 0) + (e50[bi] > e200[bi] ? 1 : 0);
    const slope20 = e20[bi - 5] !== 0 ? e20[bi] / e20[bi - 5] - 1 : 0;
    if (slope20 <= 0) continue;
    const ret60 = closes[bi - 60] > 0 ? last / closes[bi - 60] - 1 : 0;
    const r2 = r2Log(closes, bi - 59, bi + 1);
    let upc = 0; for (let k = bi - 58; k <= bi; k++) upc += up[k]; const upDays = upc / 59;
    const dist52H = hi252[bi] > 0 ? last / hi252[bi] - 1 : 0;
    const distMA20 = e20[bi] !== 0 ? last / e20[bi] - 1 : 0;
    const ret5 = closes[bi - 5] > 0 ? last / closes[bi - 5] - 1 : 0;

    // —— Señal FABLE01 (pullback-agnóstico) ——
    if (align >= 2) {
      const rs60 = ret60 - spyRet60[mi];
      const vR = (volPre[bi + 1] - volPre[bi - 4]) / 5, vB = (volPre[bi + 1] - volPre[bi - 59]) / 60;
      const rvol = vB > 0 ? vR / vB : 1;
      const comp = 0.18 * squash(slope20, 0.04) + 0.30 * squash(rs60, 0.15) + 0.12 * upDays + 0.15 * r2 + 0.15 * squash(ret60, 0.30) + 0.10 * Math.min(rvol, 2) / 2;
      s01[mi] = Math.min(100, 100 * (comp + (align === 3 ? 0.06 : 0)));
    }
    // —— Señal FABLE 5 (align completo + anti-blowoff) ——
    if (align === 3 && rsi[bi] < 80 && ret5 < 0.15 && distMA20 < 0.12) {
      s05[mi] = slope20 * 50 + r2 * 2 + upDays + Math.max(-0.3, dist52H) * 2;
    }
  }
  T.push({ sym: f.sym, close: mClose, high: mHigh, low: mLow, atr: mAtr, s01, s05 });
}
console.log(`Tickers: ${T.length}\n`);

// ── Rotación continua diaria (idéntica para ambas señales; 'sig' = "s01" | "s05") ──
function runRotation(sig, mult, { regime = false } = {}, from = 240, to = D - 1) {
  let equity = 1; const curve = [1]; const slots = new Array(N_SLOTS).fill(null); let trades = 0; const exitRets = [];
  const W = 1 / N_SLOTS;
  for (let i = from + 1; i <= to; i++) {
    let dayRet = 0;
    for (let s = 0; s < N_SLOTS; s++) {
      const h = slots[s]; if (!h) continue;
      const tk = T[h.ti]; const c0 = tk.close[i - 1], c1 = tk.close[i], hi = tk.high[i], lo = tk.low[i];
      if (c1 == null || c0 == null) continue;
      if (hi != null && hi > h.peak) h.peak = hi;
      const stop = h.peak * (1 - h.stopDist);
      if (lo != null && lo <= stop) { dayRet += W * (stop / c0 - 1); equity *= (1 - COST * W); exitRets.push(stop / h.entry - 1); trades++; slots[s] = null; }
      else dayRet += W * (c1 / c0 - 1);
    }
    equity *= (1 + dayRet); curve.push(equity);
    const riskOn = !regime || spyClose[i] >= spyEMA200[i];
    const maxFilled = riskOn ? N_SLOTS : Math.floor(N_SLOTS * 0.35);
    let filled = slots.filter(Boolean).length;
    if (filled < maxFilled) {
      const held = new Set(slots.filter(Boolean).map((h) => h.ti));
      const cands = [];
      for (let ti = 0; ti < T.length; ti++) { if (held.has(ti)) continue; const sc = T[ti][sig][i]; if (sc != null && T[ti].close[i] != null && T[ti].atr[i] != null) cands.push([sc, ti]); }
      cands.sort((a, b) => b[0] - a[0]);
      let ci = 0;
      for (let s = 0; s < N_SLOTS && filled < maxFilled && ci < cands.length; s++) { if (slots[s]) continue; const ti = cands[ci++][1]; const tk = T[ti]; slots[s] = { ti, entry: tk.close[i], peak: tk.close[i], stopDist: mult * tk.atr[i] }; equity *= (1 - COST * W); trades++; filled++; }
    }
  }
  const years = (to - from) / 252; const cagr = Math.pow(curve.at(-1), 1 / years) - 1;
  let peak = curve[0], maxDD = 0; for (const v of curve) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const mar = maxDD > 0.001 ? cagr / maxDD : cagr / 0.001;
  const win = exitRets.length ? exitRets.filter((x) => x > 0).length / exitRets.length : 0;
  return { cagr, maxDD, mar, win, trades, tradesYr: trades / years, total: curve.at(-1) - 1 };
}
const spyRet = (a, b) => spyClose[a] > 0 ? spyClose[b] / spyClose[a] - 1 : 0;

const MULTS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5];
function sweep(sig, label) {
  console.log(`\n${label} — barrido trailing (rotación + régimen, costes 20bps, todo histórico):`);
  console.log("  ×ATR | CAGR    | maxDD  | MAR  | win  | trades/año");
  const rows = [];
  for (const m of MULTS) { const r = runRotation(sig, m, { regime: true }); rows.push({ m, ...r }); console.log(`  ${m.toFixed(1).padStart(4)} | ${(r.cagr * 100).toFixed(1).padStart(6)}% | ${(r.maxDD * 100).toFixed(1).padStart(5)}% | ${r.mar.toFixed(2).padStart(4)} | ${(r.win * 100).toFixed(0)}% | ${r.tradesYr.toFixed(0).padStart(6)}`); }
  rows.sort((a, b) => b.mar - a.mar);
  return rows[0];
}
const best5 = sweep("s05", "FABLE 5 (1er módulo)");
const best01 = sweep("s01", "FABLE01 (2º módulo)");

function regimeBreak(sig, m) {
  const segs = 6; const segL = Math.floor((D - 1 - 240) / segs); let wins = 0; const out = [];
  for (let s = 0; s < segs; s++) { const a = 240 + s * segL, b = s === segs - 1 ? D - 1 : 240 + (s + 1) * segL; const r = runRotation(sig, m, { regime: true }, a, b); const sp = spyRet(a, b); if (r.total > sp) wins++; out.push({ a, b, t: r.total, sp }); }
  return { wins, out };
}
const rb5 = regimeBreak("s05", best5.m), rb01 = regimeBreak("s01", best01.m);

console.log("\n══════════════ COMPARATIVA (mejor config de cada uno, misma estrategia) ══════════════");
console.log("  métrica            | FABLE 5 (1º)        | FABLE01 (2º)");
const row = (k, a, b) => console.log(`  ${k.padEnd(18)} | ${String(a).padEnd(19)} | ${b}`);
row("trailing óptimo", `${best5.m}×ATR`, `${best01.m}×ATR`);
row("CAGR", `${(best5.cagr * 100).toFixed(1)}%`, `${(best01.cagr * 100).toFixed(1)}%`);
row("Max Drawdown", `${(best5.maxDD * 100).toFixed(1)}%`, `${(best01.maxDD * 100).toFixed(1)}%`);
row("MAR (ret/DD)", best5.mar.toFixed(2), best01.mar.toFixed(2));
row("Win por trade", `${(best5.win * 100).toFixed(0)}%`, `${(best01.win * 100).toFixed(0)}%`);
row("Trades/año", best5.tradesYr.toFixed(0), best01.tradesYr.toFixed(0));
row("Gana al SPY", `${rb5.wins}/6 tramos`, `${rb01.wins}/6 tramos`);
row("Total histórico", `${(best5.total * 100).toFixed(0)}%`, `${(best01.total * 100).toFixed(0)}%`);
console.log(`  SPY mismo periodo  | ${(spyRet(240, D - 1) * 100).toFixed(0)}%`);

console.log("\nDesglose por régimen (tramos ~9m) — FABLE 5 vs FABLE01 vs SPY:");
for (let s = 0; s < rb5.out.length; s++) { const x = rb5.out[s], y = rb01.out[s]; console.log(`  ${spyDates[x.a]}→${spyDates[x.b]}: F5 ${(x.t * 100).toFixed(1).padStart(6)}%  |  F01 ${(y.t * 100).toFixed(1).padStart(6)}%  |  SPY ${(x.sp * 100).toFixed(1).padStart(6)}%`); }
