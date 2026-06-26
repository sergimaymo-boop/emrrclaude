/**
 * COMPARATIVA INFORMATIVA — TIPO DE TRAILING STOP en IBKR: "A MERCADO" vs "DIARIO".
 * ================================================================================
 * NO modifica nada desplegado. Backtest a efectos informativos.
 *
 * Señal: FABLE01 (rotación continua, 10 slots, costes 20bps ida+vuelta, overlay de régimen,
 * TODO el histórico incl. bear 2022). Sweep de % FIJO (lo que se introduce en IBKR).
 *
 * Dos tipos de trailing (como los describe el usuario):
 *   A MERCADO (continuo): el stop sigue al MÁXIMO desde la entrada, acumula entre sesiones.
 *                         Salta si el precio cae el % desde ese pico histórico.
 *   DIARIO: el stop se RESETEA cada sesión; solo protege contra una caída del % DENTRO del día.
 *
 * ⚠️ LÍMITE HONESTO: con barras DIARIAS (OHLC) no hay datos intradía reales. El modelo "diario"
 * se aproxima: salta si hubo una reversión intradía (low < open) que cae ≥% desde el máximo del
 * día. Es DIRECCIONAL, no exacto; la respuesta precisa exigiría datos intradía (minutos).
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
function r2Log(c, a, b) { const n = b - a; if (n < 10) return 0; let sy = 0; for (let i = a; i < b; i++) sy += Math.log(c[i]); const mx = (n - 1) / 2, my = sy / n; let sxy = 0, sxx = 0, syy = 0; for (let i = a; i < b; i++) { const xx = (i - a) - mx, yy = Math.log(c[i]) - my; sxy += xx * yy; sxx += xx * xx; syy += yy * yy; } if (sxx === 0 || syy === 0) return 0; return (sxy * sxy) / (sxx * syy); }

console.log("Precomputando features + OHLC…");
const T = [];
for (const f of fetched) {
  const bars = f.bars; const n = bars.length; if (n < 240) continue;
  const closes = bars.map((b) => b.close), highs = bars.map((b) => b.high), lows = bars.map((b) => b.low), opens = bars.map((b) => b.open), vols = bars.map((b) => b.volume ?? 0);
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e200 = emaArr(closes, 200);
  const up = new Array(n).fill(0); for (let i = 1; i < n; i++) up[i] = closes[i] > closes[i - 1] ? 1 : 0;
  const volPre = new Array(n + 1).fill(0); for (let i = 0; i < n; i++) volPre[i + 1] = volPre[i] + vols[i];
  const mC = new Array(D).fill(null), mH = new Array(D).fill(null), mL = new Array(D).fill(null), mO = new Array(D).fill(null), mS = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mC[mi] = closes[bi]; mH[mi] = highs[bi]; mL[mi] = lows[bi]; mO[mi] = opens[bi];
    if (bi < 230) continue;
    const r5 = [closes[bi - 5], closes[bi - 4], closes[bi - 3], closes[bi - 2], closes[bi - 1]].slice().sort((a, b) => a - b);
    if (r5[2] > 0 && Math.abs(closes[bi] / r5[2] - 1) > 0.40) continue;
    const last = closes[bi];
    const align = (last > e20[bi] ? 1 : 0) + (e20[bi] > e50[bi] ? 1 : 0) + (e50[bi] > e200[bi] ? 1 : 0);
    const slope20 = e20[bi - 5] !== 0 ? e20[bi] / e20[bi - 5] - 1 : 0;
    if (!(align >= 2 && slope20 > 0)) continue;
    const ret60 = closes[bi - 60] > 0 ? last / closes[bi - 60] - 1 : 0;
    const rs60 = ret60 - spyRet60[mi];
    const r2 = r2Log(closes, bi - 59, bi + 1);
    let upc = 0; for (let k = bi - 58; k <= bi; k++) upc += up[k]; const upDays = upc / 59;
    const vR = (volPre[bi + 1] - volPre[bi - 4]) / 5, vB = (volPre[bi + 1] - volPre[bi - 59]) / 60;
    const rvol = vB > 0 ? vR / vB : 1;
    const comp = 0.18 * squash(slope20, 0.04) + 0.30 * squash(rs60, 0.15) + 0.12 * upDays + 0.15 * r2 + 0.15 * squash(ret60, 0.30) + 0.10 * Math.min(rvol, 2) / 2;
    mS[mi] = Math.min(100, 100 * (comp + (align === 3 ? 0.06 : 0)));
  }
  T.push({ close: mC, high: mH, low: mL, open: mO, score: mS });
}
console.log(`Tickers: ${T.length}\n`);

// type: "mercado" (continuo, peak persiste) | "diario" (resetea cada sesión)
function runRotation(type, pct, { regime = true } = {}, from = 240, to = D - 1) {
  let equity = 1; const curve = [1]; const slots = new Array(N_SLOTS).fill(null); let trades = 0; const exits = [];
  const W = 1 / N_SLOTS;
  for (let i = from + 1; i <= to; i++) {
    let dayRet = 0;
    for (let s = 0; s < N_SLOTS; s++) {
      const h = slots[s]; if (!h) continue;
      const tk = T[h.ti]; const c0 = tk.close[i - 1], c1 = tk.close[i], hi = tk.high[i], lo = tk.low[i], op = tk.open[i];
      if (c1 == null || c0 == null || hi == null || lo == null || op == null) continue;
      let exited = false, exitPx = c1;
      if (type === "mercado") {
        // continuo: stop = pico_hasta_ayer × (1-pct); gap al open; si no, ratchet con high de hoy
        const stop = h.peak * (1 - pct);
        if (op <= stop) { exited = true; exitPx = op; }
        else if (lo <= stop) { exited = true; exitPx = stop; }
        else h.peak = Math.max(h.peak, hi);
      } else {
        // diario: resetea cada sesión; salta si reversión intradía (low<open) que cae ≥pct del high del día
        const dayStop = hi * (1 - pct);
        if (lo < op && lo <= dayStop) { exited = true; exitPx = dayStop; }
        // sin estado entre días (reset)
      }
      if (exited) { dayRet += W * (exitPx / c0 - 1); equity *= (1 - COST * W); exits.push(exitPx / h.entry - 1); trades++; slots[s] = null; }
      else dayRet += W * (c1 / c0 - 1);
    }
    equity *= (1 + dayRet); curve.push(equity);
    const riskOn = !regime || spyClose[i] >= spyEMA200[i];
    const maxFilled = riskOn ? N_SLOTS : Math.floor(N_SLOTS * 0.35);
    let filled = slots.filter(Boolean).length;
    if (filled < maxFilled) {
      const held = new Set(slots.filter(Boolean).map((h) => h.ti));
      const cands = [];
      for (let ti = 0; ti < T.length; ti++) { if (held.has(ti)) continue; const sc = T[ti].score[i]; if (sc != null && T[ti].close[i] != null && T[ti].high[i] != null) cands.push([sc, ti]); }
      cands.sort((a, b) => b[0] - a[0]);
      let ci = 0;
      for (let s = 0; s < N_SLOTS && filled < maxFilled && ci < cands.length; s++) { if (slots[s]) continue; const ti = cands[ci++][1]; const tk = T[ti]; slots[s] = { ti, entry: tk.close[i], peak: tk.high[i] ?? tk.close[i] }; equity *= (1 - COST * W); trades++; filled++; }
    }
  }
  const years = (to - from) / 252; const cagr = Math.pow(curve.at(-1), 1 / years) - 1;
  let peak = curve[0], maxDD = 0; for (const v of curve) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const mar = maxDD > 0.001 ? cagr / maxDD : cagr / 0.001;
  const win = exits.length ? exits.filter((x) => x > 0).length / exits.length : 0;
  return { cagr, maxDD, mar, win, tradesYr: trades / years, total: curve.at(-1) - 1 };
}
const spyRet = (a, b) => spyClose[a] > 0 ? spyClose[b] / spyClose[a] - 1 : 0;

const PCTS = [0.05, 0.08, 0.10, 0.12, 0.15, 0.20];
function sweep(type, label) {
  console.log(`\n${label} — sweep de % (rotación FABLE01 + régimen, costes, todo histórico):`);
  console.log("   %  | CAGR    | maxDD  | MAR  | win  | trades/año");
  const rows = [];
  for (const p of PCTS) { const r = runRotation(type, p); rows.push({ p, ...r }); console.log(`  ${(p * 100).toFixed(0).padStart(2)}% | ${(r.cagr * 100).toFixed(1).padStart(6)}% | ${(r.maxDD * 100).toFixed(1).padStart(5)}% | ${r.mar.toFixed(2).padStart(4)} | ${(r.win * 100).toFixed(0)}% | ${r.tradesYr.toFixed(0).padStart(6)}`); }
  rows.sort((a, b) => b.mar - a.mar);
  return rows[0];
}
const bM = sweep("mercado", "🅐 TRAILING A MERCADO (continuo, acumula entre sesiones)");
const bD = sweep("diario", "🅑 TRAILING DIARIO (resetea cada sesión)");

console.log("\n══════════════ COMPARATIVA — mejor de cada tipo ══════════════");
const rowf = (k, a, b) => console.log(`  ${k.padEnd(16)} | ${String(a).padEnd(20)} | ${b}`);
rowf("", "A MERCADO", "DIARIO");
rowf("% óptimo", `${(bM.p * 100).toFixed(0)}%`, `${(bD.p * 100).toFixed(0)}%`);
rowf("CAGR", `${(bM.cagr * 100).toFixed(1)}%`, `${(bD.cagr * 100).toFixed(1)}%`);
rowf("Max Drawdown", `${(bM.maxDD * 100).toFixed(1)}%`, `${(bD.maxDD * 100).toFixed(1)}%`);
rowf("MAR", bM.mar.toFixed(2), bD.mar.toFixed(2));
rowf("Win por trade", `${(bM.win * 100).toFixed(0)}%`, `${(bD.win * 100).toFixed(0)}%`);
rowf("Trades/año", bM.tradesYr.toFixed(0), bD.tradesYr.toFixed(0));
rowf("Total histórico", `${(bM.total * 100).toFixed(0)}%`, `${(bD.total * 100).toFixed(0)}%`);
console.log(`  SPY mismo periodo: ${(spyRet(240, D - 1) * 100).toFixed(0)}%`);
const winner = bM.mar >= bD.mar ? "A MERCADO (continuo)" : "DIARIO";
console.log(`\n🏆 ÓPTIMO por MAR: ${winner}`);
