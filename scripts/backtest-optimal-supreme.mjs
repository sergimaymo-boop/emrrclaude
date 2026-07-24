/**
 * OPTIMAL SUPREME — BACKTEST DE CONSOLIDACIÓN (offline, 10 años).
 * ================================================================
 * Objetivo: elegir el ÚNICO módulo definitivo. Parte del ganador documentado
 * (Optimal2026: Dual Momentum top-2, régimen binario, 40.1% CAGR / MAR 2.17)
 * y prueba si los mejores componentes de los otros módulos lo MEJORAN:
 *
 *   A  BASE      — Optimal2026 puro: rebalanceo mensual, sin trailing (referencia)
 *   B  TRAIL     — A + trailing ATR por bandas (TR/TN/TA) con ROTACIÓN INMEDIATA
 *                  al mejor candidato al saltar el stop (mecánica FABLE01)
 *   B' sweep     — B con multiplicadores 2.0×–4.0× para hallar el trailing ÓPTIMO
 *   C  VIX       — B + overlay de régimen VIX 4 estados (mecánica CLAUDE01)
 *   D  ENTRY     — B + filtro de calidad de entrada RSI14<80, dist EMA20<12% (FABLE5)
 *   E  FULL      — C + D combinados
 *
 * Todas las variantes: mismos datos, mismos costes (20bps one-way por lado),
 * mark-to-market diario, walk-forward sin lookahead. Métrica de decisión:
 * MAR (CAGR/MaxDD) con MaxDD ≤ 20% (riesgo moderado), desempate por CAGR.
 */
import fs from "node:fs";
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const CACHE = "/tmp/emrr-bars-10y.json";
const OUT = process.env.OUT ?? "/tmp/backtest-supreme-results.json";
const COST = 20 / 1e4;          // one-way por entrada y por salida
const N_POS = 2;                // top-2 (config óptima del sweep 810)
const REBAL = 21;               // sesiones ≈ mensual
const LB_LONG = 189, LB_SKIP = 42, VOL_W = 63;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

async function fetchBars(sym, range = "10y") {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json(); const r = d?.chart?.result?.[0]; if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const bars = r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), high: q.high?.[i], low: q.low?.[i], close: q.close?.[i] }))
      .filter((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.high) && Number.isFinite(b.low));
    return bars.length >= 260 ? bars : null;
  } catch { return null; }
}
async function pool(items, worker, c = 6) { const out = []; let i = 0; await Promise.all(Array.from({ length: c }, async () => { while (i < items.length) { const k = i++; out[k] = await worker(items[k]); } })); return out; }

// ── Datos (cache 10y) ─────────────────────────────────────────────────────────
let fetched, spy, vix;
if (fs.existsSync(CACHE)) {
  console.log("Cargando caché 10y…");
  ({ fetched, spy, vix } = JSON.parse(fs.readFileSync(CACHE, "utf8")));
} else {
  const all = [];
  for (const [ex, assets] of Object.entries(STATIC_ASSETS_BY_EXCHANGE))
    for (const a of assets) { const y = toYahooSymbol(`${a.Code}.${ex}`); if (y) all.push({ sym: `${a.Code}.${ex}`, yahoo: y }); }
  console.log(`Descargando ${all.length} símbolos (10y) + SPY + ^VIX…`);
  spy = await fetchBars("SPY");
  vix = await fetchBars("^VIX");
  let done = 0;
  fetched = (await pool(all, async (s) => {
    const b = await fetchBars(s.yahoo);
    if (++done % 50 === 0) console.log(`  ${done}/${all.length}`);
    return b ? { sym: s.sym, bars: b } : null;
  })).filter(Boolean);
  fs.writeFileSync(CACHE, JSON.stringify({ fetched, spy, vix }));
  console.log(`Cacheados ${fetched.length} tickers.`);
}

const spyDates = spy.map((b) => b.date), spyClose = spy.map((b) => b.close);
const D = spyDates.length;
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));
const spyEMA200 = new Array(D); { const k = 2 / 201; let e = spyClose[0]; for (let i = 0; i < D; i++) { e = i === 0 ? spyClose[0] : spyClose[i] * k + e * (1 - k); spyEMA200[i] = e; } }
// VIX alineado al calendario maestro (último conocido)
const vixByDate = new Map((vix ?? []).map((b) => [b.date, b.close]));
const vixArr = new Array(D).fill(20); { let last = 20; for (let i = 0; i < D; i++) { const v = vixByDate.get(spyDates[i]); if (v != null) last = v; vixArr[i] = last; } }
// SPY ret189 para RS
const spyRetLong = new Array(D).fill(0); for (let i = LB_LONG; i < D; i++) spyRetLong[i] = spyClose[i - LB_LONG] > 0 ? spyClose[i] / spyClose[i - LB_LONG] - 1 : 0;

console.log(`Calendario maestro: ${D} sesiones (${spyDates[0]} → ${spyDates.at(-1)})`);

// ── Features Optimal2026 por ticker, alineadas al calendario maestro ──────────
function emaArr(vals, p) { const k = 2 / (p + 1); const out = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out[i] = e; } return out; }
function r2Log(closes, a, b) {
  const n = b - a; if (n < 10) return 0;
  let sx = 0, sy = 0; for (let i = a; i < b; i++) { sy += Math.log(closes[i]); sx += i - a; }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = a; i < b; i++) { const xx = (i - a) - mx, yy = Math.log(closes[i]) - my; sxy += xx * yy; sxx += xx * xx; syy += yy * yy; }
  if (sxx === 0 || syy === 0) return 0; return (sxy * sxy) / (sxx * syy);
}

console.log("Precomputando features Optimal2026 diarias…");
const T = [];
for (const f of fetched) {
  const bars = f.bars, n = bars.length;
  if (n < 240) continue;
  const closes = bars.map((b) => b.close), highs = bars.map((b) => b.high), lows = bars.map((b) => b.low);
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50), e200 = emaArr(closes, 200);
  // ATR14 %
  const atrPct = new Array(n).fill(null); { let trSum = 0; const trs = [];
    for (let i = 1; i < n; i++) { const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])); trs.push(tr); trSum += tr; if (trs.length > 14) trSum -= trs.shift(); if (trs.length === 14 && closes[i] > 0) atrPct[i] = (trSum / 14) / closes[i]; } }
  // RSI14 (Wilder)
  const rsi = new Array(n).fill(50); { let ag = 0, al = 0;
    for (let i = 1; i < n; i++) { const ch = closes[i] - closes[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  // log-returns para vol63
  const lr = new Array(n).fill(0); for (let i = 1; i < n; i++) lr[i] = Math.log(closes[i] / closes[i - 1]);

  const mClose = new Array(D).fill(null), mHigh = new Array(D).fill(null), mLow = new Array(D).fill(null);
  const mRaw = new Array(D).fill(null), mAtr = new Array(D).fill(null), mR2 = new Array(D).fill(null);
  const mRsi = new Array(D).fill(null), mDist20 = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mClose[mi] = closes[bi]; mHigh[mi] = highs[bi]; mLow[mi] = lows[bi]; mAtr[mi] = atrPct[bi];
    mRsi[mi] = rsi[bi]; mDist20[mi] = e20[bi] > 0 ? closes[bi] / e20[bi] - 1 : null;
    if (bi < 230 || atrPct[bi] == null) continue;
    // anti-glitch
    const r5 = [closes[bi - 5], closes[bi - 4], closes[bi - 3], closes[bi - 2], closes[bi - 1]].slice().sort((a, b) => a - b);
    const med = r5[2]; if (med > 0 && Math.abs(closes[bi] / med - 1) > 0.40) continue;
    const last = closes[bi];
    const retLong = closes[bi - LB_LONG] > 0 ? last / closes[bi - LB_LONG] - 1 : 0;
    const retSkip = closes[bi - LB_SKIP] > 0 ? last / closes[bi - LB_SKIP] - 1 : 0;
    let s2 = 0; for (let k = bi - VOL_W + 1; k <= bi; k++) s2 += lr[k] * lr[k];
    const vol63 = Math.sqrt((s2 / VOL_W) * 252);
    const align = (last > e20[bi] ? 1 : 0) + (e20[bi] > e50[bi] ? 1 : 0) + (e50[bi] > e200[bi] ? 1 : 0);
    // Elegibilidad Optimal2026
    if (!(retLong > 0 && align >= 2 && vol63 > 0.02 && vol63 < 2.5)) continue;
    const riskAdjMom = (retLong - retSkip) / vol63;
    const rsLong = clamp(retLong - spyRetLong[mi], -0.5, 0.5);
    const raw = riskAdjMom * (1 + 0.5 * rsLong) * (0.85 + 0.05 * align);
    if (!(raw > 0)) continue;
    mRaw[mi] = raw; mR2[mi] = r2Log(closes, bi - 59, bi + 1);
  }
  T.push({ sym: f.sym, close: mClose, high: mHigh, low: mLow, raw: mRaw, atr: mAtr, r2: mR2, rsi: mRsi, dist20: mDist20 });
}
console.log(`Tickers con features: ${T.length}\n`);

// ── Motor de simulación unificado ─────────────────────────────────────────────
// opts:
//   trailing: null | { mode: "bands" } | { mode: "fixed", mult }
//   vixRegime: bool — 4 estados (si false: binario SPY/EMA200 100/30)
//   entryFilter: bool — RSI<80 y dist20<12% al entrar
function bandMult(atrPct, r2) {
  if (atrPct < 0.025 && r2 > 0.70) return 2.5;      // TR
  if (atrPct > 0.045 || r2 < 0.40) return 4.0;      // TA
  return 3.0;                                        // TN
}
function exposureAt(i, vixRegime) {
  const riskOn = spyClose[i] >= spyEMA200[i];
  if (!vixRegime) return riskOn ? 1.0 : 0.30;
  const v = vixArr[i];
  if (v > 35) return 0.60;                 // D: pánico → contrarian moderado
  if (!riskOn || v >= 28) return 0.30;     // C: bear/estrés → defensivo
  return 1.0;                              // A/B: expansión o corrección alcista
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

function simulate({ trailing = null, vixRegime = false, entryFilter = false }) {
  const FROM = 240, TO = D - 1;
  let equity = 1;
  const curve = new Array(TO + 1).fill(null); curve[FROM] = 1;
  let slots = []; // {ti, entryIdx, peak, stopDist, w}
  let trades = 0;
  let nextRebal = FROM;

  for (let i = FROM + 1; i <= TO; i++) {
    const expo = exposureAt(i - 1, vixRegime); // decisión con datos de ayer (sin lookahead)
    let dayRet = 0;

    // 1) mark-to-market + trailing
    for (let s = 0; s < slots.length; s++) {
      const h = slots[s]; if (!h) continue;
      const tk = T[h.ti]; const c0 = tk.close[i - 1], c1 = tk.close[i], hi = tk.high[i], lo = tk.low[i];
      if (c1 == null || c0 == null) continue;
      if (trailing) {
        if (hi != null && hi > h.peak) h.peak = hi;
        const stopLevel = h.peak * (1 - h.stopDist);
        if (lo != null && lo <= stopLevel) {
          dayRet += h.w * (stopLevel / c0 - 1);
          equity *= (1 - COST * h.w);
          trades++; slots[s] = null;
          continue;
        }
      }
      dayRet += h.w * (c1 / c0 - 1);
    }
    slots = slots.filter(Boolean);
    equity *= (1 + dayRet);
    curve[i] = equity;

    // 2) rotación inmediata tras stop (solo variantes con trailing)
    if (trailing && slots.length < N_POS) {
      const held = new Set(slots.map((h) => h.ti));
      const cands = pickTop(i, held, entryFilter);
      while (slots.length < N_POS && cands.length) {
        const [, ti] = cands.shift();
        const tk = T[ti];
        const mult = trailing.mode === "fixed" ? trailing.mult : bandMult(tk.atr[i], tk.r2[i] ?? 0.5);
        const w = expo / N_POS;
        slots.push({ ti, peak: tk.close[i], stopDist: mult * tk.atr[i], w });
        equity *= (1 - COST * w); trades++;
      }
    }

    // 3) rebalanceo mensual: recomponer top-2 y pesos
    if (i >= nextRebal) {
      nextRebal = i + REBAL;
      const cands = pickTop(i, new Set(), entryFilter).slice(0, N_POS);
      const rawSum = cands.reduce((s, c) => s + c[0], 0) || 1;
      const target = new Map(cands.map(([raw, ti]) => [ti, expo * raw / rawSum]));
      // cerrar lo que sale
      for (let s = 0; s < slots.length; s++) {
        const h = slots[s];
        if (!target.has(h.ti)) { equity *= (1 - COST * h.w); trades++; slots[s] = null; }
      }
      slots = slots.filter(Boolean);
      // ajustar pesos / abrir nuevos
      for (const [ti, w] of target) {
        const ex = slots.find((h) => h.ti === ti);
        if (ex) { const dw = Math.abs(w - ex.w); if (dw > 0.01) { equity *= (1 - COST * dw); } ex.w = w; }
        else {
          const tk = T[ti]; if (tk.close[i] == null || tk.atr[i] == null) continue;
          const mult = trailing ? (trailing.mode === "fixed" ? trailing.mult : bandMult(tk.atr[i], tk.r2[i] ?? 0.5)) : 0;
          slots.push({ ti, peak: tk.close[i], stopDist: trailing ? mult * tk.atr[i] : 1, w });
          equity *= (1 - COST * w); trades++;
        }
      }
    }
  }

  // Métricas
  const eq = []; const idxs = [];
  for (let i = FROM; i <= TO; i++) if (curve[i] != null) { eq.push(curve[i]); idxs.push(i); }
  const years = eq.length / 252;
  const cagr = Math.pow(eq.at(-1) / eq[0], 1 / years) - 1;
  let peak = eq[0], maxDD = 0; for (const v of eq) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const dRets = []; for (let k = 1; k < eq.length; k++) dRets.push(eq[k] / eq[k - 1] - 1);
  const mu = mean(dRets), sd = Math.sqrt(mean(dRets.map((r) => (r - mu) ** 2))) || 1;
  const sharpe = (mu / sd) * Math.sqrt(252);
  // win% mensual
  let wins = 0, months = 0;
  for (let k = 21; k < eq.length; k += 21) { months++; if (eq[k] > eq[k - 21]) wins++; }
  // sub-períodos (tercios)
  const third = Math.floor(eq.length / 3);
  const sub = [0, 1, 2].map((t) => {
    const a = eq[t * third], b = eq[t === 2 ? eq.length - 1 : (t + 1) * third];
    const yrs = (t === 2 ? eq.length - 1 - t * third : third) / 252;
    return Math.pow(b / a, 1 / yrs) - 1;
  });
  return {
    cagr: +(cagr * 100).toFixed(1), maxDD: +(maxDD * 100).toFixed(1),
    mar: +(cagr / maxDD).toFixed(2), sharpe: +sharpe.toFixed(2),
    winMo: +((wins / months) * 100).toFixed(0), tradesYr: +(trades / years).toFixed(0),
    sub: sub.map((s) => +(s * 100).toFixed(1)),
  };
}

// ── Ejecutar variantes ────────────────────────────────────────────────────────
console.log("Simulando variantes…\n");
const results = {};
results["A_BASE_mensual"] = simulate({});
console.log("A BASE (mensual, sin trailing):", JSON.stringify(results["A_BASE_mensual"]));
results["B_TRAIL_bandas"] = simulate({ trailing: { mode: "bands" } });
console.log("B TRAIL (bandas TR/TN/TA):    ", JSON.stringify(results["B_TRAIL_bandas"]));
for (const m of [2.0, 2.5, 3.0, 3.5, 4.0]) {
  results[`B_TRAIL_${m}x`] = simulate({ trailing: { mode: "fixed", mult: m } });
  console.log(`B TRAIL fijo ${m}×ATR:        `, JSON.stringify(results[`B_TRAIL_${m}x`]));
}
results["C_VIX"] = simulate({ trailing: { mode: "bands" }, vixRegime: true });
console.log("C VIX (4 estados):            ", JSON.stringify(results["C_VIX"]));
results["D_ENTRY"] = simulate({ trailing: { mode: "bands" }, entryFilter: true });
console.log("D ENTRY (RSI<80, dist<12%):   ", JSON.stringify(results["D_ENTRY"]));
results["E_FULL"] = simulate({ trailing: { mode: "bands" }, vixRegime: true, entryFilter: true });
console.log("E FULL (C+D):                 ", JSON.stringify(results["E_FULL"]));
// combos del mejor trailing fijo con overlays
for (const m of [2.5, 3.0]) {
  results[`E_VIX_${m}x`] = simulate({ trailing: { mode: "fixed", mult: m }, vixRegime: true });
  console.log(`E VIX + ${m}×ATR:             `, JSON.stringify(results[`E_VIX_${m}x`]));
  results[`E_FULL_${m}x`] = simulate({ trailing: { mode: "fixed", mult: m }, vixRegime: true, entryFilter: true });
  console.log(`E FULL + ${m}×ATR:            `, JSON.stringify(results[`E_FULL_${m}x`]));
}

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), universe: T.length, sessions: D, results }, null, 2));
console.log(`\nResultados → ${OUT}`);

// Ranking por MAR con MaxDD≤20 (riesgo moderado), desempate CAGR
const ranked = Object.entries(results)
  .filter(([, r]) => r.maxDD <= 20)
  .sort((a, b) => (b[1].mar - a[1].mar) || (b[1].cagr - a[1].cagr));
console.log("\n🏆 RANKING (MaxDD ≤ 20%, por MAR):");
for (const [name, r] of ranked.slice(0, 6))
  console.log(`  ${name}: CAGR ${r.cagr}% | DD ${r.maxDD}% | MAR ${r.mar} | Sharpe ${r.sharpe} | ops/año ${r.tradesYr}`);
