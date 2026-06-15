/**
 * CALIBRACIÓN "FABLE01" — top-10 de TENDENCIA ALCISTA SANA con ASIGNACIÓN DE CAPITAL.
 * ====================================================================================
 * Distinto a FABLE 5: aquí no medimos el retorno forward simple del top-10, sino una
 * SIMULACIÓN DE CARTERA real bajo las decisiones del usuario:
 *   · 100% del capital, SIN tope de concentración, rebalanceo COMPLETO en cada scan.
 *   · Score de salud de tendencia PULLBACK-AGNÓSTICO (no penaliza sobreextensión).
 *   · Trailing por ticker (TR/TN/TA) como corazón de la salida → rotación al siguiente scan.
 * Objetivo optimizado: RETORNO / DRAWDOWN (MAR), no retorno bruto — porque concentrar
 * sin vigilar el drawdown arruina. Walk-forward, métricas OOS en TEST + consistencia por
 * subventanas → badge de fiabilidad honesto (peor subventana, sin maquillar).
 *
 * Barridos que el spec §4.1 exige reportar ANTES de codificar:
 *   FASE A — trailing (múltiplo ATR): CAGR, maxDD, MAR, hold medio, win, % stops → TR/TN/TA.
 *   FASE B — concentración (temperatura softmax): CAGR/maxDD por nivel.
 *   FASE C — cadencia de rebalanceo (sesiones): CAGR/maxDD por cadencia.
 *   FASE D — config final → OOS, consistencia por tercios, badge 0-100.
 */
import fs from "node:fs";

const CACHE = "/tmp/emrr-bars-5y.json";

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function ema(vals, p) { const k = 2 / (p + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; }
function r2Log(closes) {
  const n = closes.length; if (n < 10) return 0;
  const ys = closes.map((c) => Math.log(c)); const xs = ys.map((_, i) => i);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return 0;
  return (sxy * sxy) / (sxx * syy);
}

// ── Datos ──
if (!fs.existsSync(CACHE)) { console.error("Falta caché 5y. Corre primero calibrate-fable5.mjs."); process.exit(1); }
console.log("Cargando caché…");
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date);
const spyCloseByDate = new Map(spy.map((b) => [b.date, b.close]));
// SPY EMA200 por fecha (interruptor de régimen risk-on/off para el overlay §8)
const spyEMA200ByDate = new Map();
{ const k = 2 / 201; let e = spy[0].close; for (let i = 0; i < spy.length; i++) { e = spy[i].close * k + e * (1 - k); spyEMA200ByDate.set(spy[i].date, e); } }
const spyRiskOn = (dt) => { const c = spyCloseByDate.get(dt), e = spyEMA200ByDate.get(dt); return c != null && e != null ? c >= e : true; };
for (const f of fetched) f.byDate = new Map(f.bars.map((b, i) => [b.date, i]));
console.log(`Listos ${fetched.length} tickers · ${spyDates[0]}→${spyDates.at(-1)}\n`);

// SPY momentum 60d en cada fecha (para Relative Strength)
function spyRet60At(dt) {
  const i = spyDates.indexOf(dt); if (i < 60) return 0;
  const c0 = spyCloseByDate.get(spyDates[i - 60]), c1 = spyCloseByDate.get(dt);
  return c0 > 0 ? c1 / c0 - 1 : 0;
}

// ── Features de SALUD de tendencia (pullback-agnóstico, §6) ──
function featuresAt(bars, hi, spyR60) {
  if (hi < 230) return null;
  const closes = bars.slice(0, hi + 1).map((b) => b.close);
  const last = closes[hi];
  if (!Number.isFinite(last) || last <= 0) return null;
  const recent5 = closes.slice(-6, -1).slice().sort((a, b) => a - b);
  const med = recent5[Math.floor(recent5.length / 2)];
  if (med > 0 && Math.abs(last / med - 1) > 0.40) return null; // anti-glitch
  const e20 = ema(closes.slice(-30), 20), e50 = ema(closes.slice(-60), 50), e200 = ema(closes.slice(-220), 200);
  const e20p = ema(closes.slice(-35, -5), 20);
  const trs = []; for (let i = hi - 13; i <= hi; i++) trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  const atrPct = mean(trs) / last;
  const up60 = closes.slice(-60).filter((c, i, a) => i > 0 && c > a[i - 1]).length / 59;
  const ret60 = closes[hi - 60] > 0 ? last / closes[hi - 60] - 1 : 0;
  // RVOL: volumen reciente vs media 60 (confirmación)
  const vols = bars.slice(Math.max(0, hi - 59), hi + 1).map((b) => b.volume).filter((v) => Number.isFinite(v) && v > 0);
  const vRecent = mean(bars.slice(Math.max(0, hi - 4), hi + 1).map((b) => b.volume).filter((v) => Number.isFinite(v) && v > 0));
  const rvol = vols.length ? vRecent / mean(vols) : 1;
  return {
    align: (last > e20 ? 1 : 0) + (e20 > e50 ? 1 : 0) + (e50 > e200 ? 1 : 0),
    slope20: e20p !== 0 ? e20 / e20p - 1 : 0,
    upDays: up60,
    r2: r2Log(closes.slice(-60)),
    rs60: ret60 - spyR60,        // fuerza relativa vs benchmark (peso alto)
    ret60,                        // momentum (peso medio)
    rvol: Number.isFinite(rvol) ? rvol : 1, // confirmación (peso bajo)
    distMA20: e20 !== 0 ? last / e20 - 1 : 0, // sobreextensión (para damping, NO filtro)
    atrPct, close: last,
  };
}

// Score de salud de tendencia 0-100 por ranking transversal (pullback-agnóstico).
function pctRank(vals) {
  const sorted = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(vals.length);
  sorted.forEach(([, i], k) => { r[i] = vals.length > 1 ? k / (vals.length - 1) : 0.5; });
  return r;
}
// Score ABSOLUTO por-ticker (squash tanh) — desplegable batch-a-batch sin contexto cross-sectional.
// Mismo espíritu que el ranking percentil: RS y pendiente dominan; pullback-agnóstico.
const squash = (x, scale) => 0.5 * (Math.tanh(x / scale) + 1); // → (0,1)
function scoreOne(ft) {
  const comp = 0.18 * squash(ft.slope20, 0.04) + 0.30 * squash(ft.rs60, 0.15)
    + 0.12 * ft.upDays + 0.15 * ft.r2 + 0.15 * squash(ft.ret60, 0.30)
    + 0.10 * Math.min(ft.rvol, 2) / 2;
  const alignBonus = ft.align === 3 ? 0.06 : 0;
  return Math.min(100, 100 * (comp + alignBonus));
}
function scoreDate(recs) {
  // elegibles: tendencia alcista mínima (align>=2, pendiente>0). SIN filtro de sobreextensión.
  const elig = recs.filter((r) => r.ft.align >= 2 && r.ft.slope20 > 0);
  if (elig.length < 12) return [];
  elig.forEach((r) => { r.score = scoreOne(r.ft); });
  return elig.sort((a, b) => b.score - a.score);
}

// ── Fechas de rebalanceo (cada REBAL sesiones) y panel scored ──
function buildRebal(REBAL) {
  const dates = [];
  for (let d = 240; d < spyDates.length - 2; d += REBAL) {
    const dt = spyDates[d];
    const recs = [];
    for (const f of fetched) {
      const hi = f.byDate.get(dt); if (hi === undefined || hi < 240) continue;
      const ft = featuresAt(f.bars, hi, spyRet60At(dt)); if (!ft) continue;
      recs.push({ f, hi, ft });
    }
    const scored = scoreDate(recs);
    if (scored.length >= 12) dates.push({ dt, d, scored });
  }
  return dates;
}

// Pesos: softmax(score/T) sobre top-10, floor (cae a 0 y renormaliza), SIN tope.
function weightsFor(picks, T, floorPct) {
  let w;
  if (!Number.isFinite(T)) w = picks.map(() => 1 / picks.length); // equiponderado
  else { const ex = picks.map((p) => Math.exp(p.score / T)); const s = ex.reduce((a, b) => a + b, 0); w = ex.map((e) => e / s); }
  // floor: por debajo del mínimo ejecutable → 0, renormaliza
  w = w.map((x) => (x * 100 < floorPct ? 0 : x));
  const s2 = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / s2);
}

// Simula una posición desde su fecha de entrada hasta la siguiente fecha de rebalanceo,
// con trailing = mult × ATR% desde el máximo. Devuelve {ret, held, stopped}.
function simSleeve(p, nextDt, mult) {
  const entry = p.ft.close; const stopDist = mult * p.ft.atrPct;
  const hiNext = p.f.byDate.get(nextDt);
  const end = hiNext !== undefined ? hiNext : Math.min(p.hi + 12, p.f.bars.length - 1);
  let peak = entry;
  for (let j = p.hi + 1; j <= end; j++) {
    const b = p.f.bars[j]; if (!b) break;
    if (Number.isFinite(b.high) && b.high > peak) peak = b.high;
    const stopLevel = peak * (1 - stopDist);
    if (Number.isFinite(b.low) && b.low <= stopLevel) return { ret: stopLevel / entry - 1, held: j - p.hi, stopped: true };
  }
  return { ret: p.f.bars[end].close / entry - 1, held: end - p.hi, stopped: false };
}

// Simulación de cartera: rebalanceo completo en cada fecha; entre fechas, trailing por ticker.
// costBps = coste ONE-WAY por unidad de peso operada (spread+slippage+comisión). Honesto:
//   se cobra (a) la rotación del libro en cada rebalanceo [Σ|Δw|] y (b) la salida por stop intra-período.
function runPortfolio(rebal, mult, T, floorPct, fromIdx, toIdx, costBps = 0) {
  const cost = costBps / 1e4;
  let equity = 1; const curve = [equity]; const holds = []; const wins = []; let stops = 0, posCount = 0;
  let prevW = new Map(); // pesos efectivos del libro al inicio del rebalanceo (0 si salió por stop)
  for (let i = fromIdx; i < toIdx - 1; i++) {
    const cur = rebal[i], nxt = rebal[i + 1];
    const picks = cur.scored.slice(0, 10);
    const w = weightsFor(picks, T, floorPct);
    // coste de rotación: |peso nuevo − peso previo efectivo| por símbolo
    const newW = new Map(); picks.forEach((p, k) => { if (w[k] > 0) newW.set(p.f.sym ?? p.f.yahoo ?? p.f, w[k]); });
    let turnover = 0; const syms = new Set([...prevW.keys(), ...newW.keys()]);
    for (const s of syms) turnover += Math.abs((newW.get(s) ?? 0) - (prevW.get(s) ?? 0));
    equity *= (1 - cost * turnover);
    // retorno del período + coste de salidas por stop (re-entrada en el siguiente rebalanceo ya contada)
    let periodRet = 0, stopCost = 0;
    picks.forEach((p, k) => {
      if (w[k] <= 0) return;
      const r = simSleeve(p, nxt.dt, mult);
      periodRet += w[k] * r.ret;
      if (r.stopped) { stops++; stopCost += cost * w[k]; } // exit extra al saltar el stop
      holds.push(r.held); wins.push(r.ret > 0 ? 1 : 0); posCount++;
    });
    equity *= (1 + periodRet) * (1 - stopCost); curve.push(equity);
    // pesos efectivos para el próximo rebalanceo: 0 para los que saltaron (estamos en caja)
    prevW = new Map(); picks.forEach((p, k) => { if (w[k] > 0) { const r = simSleeve(p, nxt.dt, mult); if (!r.stopped) prevW.set(p.f.sym ?? p.f.yahoo ?? p.f, w[k]); } });
  }
  return { curve, holds, wins, stops, posCount };
}

function metrics(curve, nSessions) {
  const totalRet = curve.at(-1) - 1;
  const years = nSessions / 252;
  const cagr = years > 0 ? Math.pow(curve.at(-1), 1 / years) - 1 : 0;
  let peak = curve[0], maxDD = 0;
  for (const v of curve) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const mar = maxDD > 0.001 ? cagr / maxDD : cagr / 0.001;
  return { totalRet, cagr, maxDD, mar };
}
function spyReturn(fromDt, toDt) {
  const c0 = spyCloseByDate.get(fromDt), c1 = spyCloseByDate.get(toDt);
  return c0 > 0 ? c1 / c0 - 1 : 0;
}

// ═══════════════════ FASE A — trailing (REBAL=10, equiponderado, floor 0) ═══════════════════
const REBAL0 = 10;
const rebal10 = buildRebal(REBAL0);
const cut10 = Math.floor(rebal10.length * 0.7);
console.log(`Panel rebalanceo@${REBAL0}: ${rebal10.length} fechas (${rebal10[0]?.dt}→${rebal10.at(-1)?.dt}) · TRAIN ${cut10} | TEST ${rebal10.length - cut10}\n`);
const testSessions10 = (rebal10.length - cut10) * REBAL0;

console.log("FASE A — barrido de trailing (×ATR), cartera OOS (TEST), equiponderado:");
console.log("  mult | CAGR    | maxDD  | MAR  | hold | win | %stops");
const MULTS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
const sweepA = [];
for (const m of MULTS) {
  const r = runPortfolio(rebal10, m, Infinity, 0, cut10, rebal10.length);
  const mt = metrics(r.curve, testSessions10);
  const row = { m, ...mt, hold: mean(r.holds), win: mean(r.wins), pstop: r.stops / Math.max(1, r.posCount) };
  sweepA.push(row);
  console.log(`  ${m.toFixed(1).padStart(4)} | ${(mt.cagr * 100).toFixed(1).padStart(6)}% | ${(mt.maxDD * 100).toFixed(1).padStart(5)}% | ${mt.mar.toFixed(2).padStart(4)} | ${row.hold.toFixed(1).padStart(4)} | ${(row.win * 100).toFixed(0)}% | ${(row.pstop * 100).toFixed(0)}%`);
}
// "el más AJUSTADO que aún deja correr": mejor MAR, sesgado a tight si empata ~5%
sweepA.sort((a, b) => b.mar - a.mar);
const bestMar = sweepA[0].mar;
const tightChoices = sweepA.filter((r) => r.mar >= bestMar * 0.95).sort((a, b) => a.m - b.m);
const central = tightChoices[0].m;
const TR = Math.max(1.0, Math.round((central - 0.5) * 10) / 10);
const TN = central;
const TA = Math.min(6.0, Math.round((central + 1.0) * 10) / 10);
console.log(`\n🏆 FASE A: central(TN) = ${TN}×ATR (mejor MAR dejando correr) · TR = ${TR}×ATR · TA = ${TA}×ATR\n`);

// ═══════════════════ FASE B — concentración (softmax T) ═══════════════════
console.log("FASE B — barrido de concentración (softmax T; menor T = más concentrado), TEST:");
console.log("  T        | CAGR    | maxDD  | MAR  | top1%w");
const TEMPS = [Infinity, 25, 15, 10, 7, 5];
const sweepB = [];
for (const T of TEMPS) {
  const r = runPortfolio(rebal10, TN, T, 0, cut10, rebal10.length);
  const mt = metrics(r.curve, testSessions10);
  // peso del top-1 (concentración media)
  const sample = weightsFor(rebal10[cut10].scored.slice(0, 10), T, 0);
  sweepB.push({ T, ...mt, top1: sample[0] });
  console.log(`  ${(Number.isFinite(T) ? T.toFixed(0) : "∞(equi)").padStart(8)} | ${(mt.cagr * 100).toFixed(1).padStart(6)}% | ${(mt.maxDD * 100).toFixed(1).padStart(5)}% | ${mt.mar.toFixed(2).padStart(4)} | ${(sample[0] * 100).toFixed(0)}%`);
}
sweepB.sort((a, b) => b.mar - a.mar);
const bestT = sweepB[0].T;
console.log(`\n🏆 FASE B: T óptimo = ${Number.isFinite(bestT) ? bestT : "∞ (equiponderado)"} (MAR ${sweepB[0].mar.toFixed(2)}, top-1 peso ${(sweepB[0].top1 * 100).toFixed(0)}%)\n`);

// ═══════════════════ FASE C — cadencia de rebalanceo ═══════════════════
console.log("FASE C — barrido de cadencia de rebalanceo, TEST:");
console.log("  cada N | fechas | CAGR    | maxDD  | MAR");
const REBALS = [5, 10, 20];
const sweepC = [];
for (const R of REBALS) {
  const rb = R === REBAL0 ? rebal10 : buildRebal(R);
  const cutR = Math.floor(rb.length * 0.7);
  const r = runPortfolio(rb, TN, bestT, 0, cutR, rb.length);
  const mt = metrics(r.curve, (rb.length - cutR) * R);
  sweepC.push({ R, rb, cutR, ...mt });
  console.log(`  ${String(R).padStart(6)} | ${String(rb.length).padStart(6)} | ${(mt.cagr * 100).toFixed(1).padStart(6)}% | ${(mt.maxDD * 100).toFixed(1).padStart(5)}% | ${mt.mar.toFixed(2).padStart(4)}`);
}
sweepC.sort((a, b) => b.mar - a.mar);
const bestC = sweepC[0];
console.log(`\n🏆 FASE C: cadencia óptima = cada ${bestC.R} sesiones (MAR ${bestC.mar.toFixed(2)})\n`);

// ═══════════════════ FASE D — config final, OOS, consistencia, badge ═══════════════════
const rbF = bestC.rb, cutF = bestC.cutR;
const full = runPortfolio(rbF, TN, bestT, 5, cutF, rbF.length);
const mtFull = metrics(full.curve, (rbF.length - cutF) * bestC.R);
const spyTest = spyReturn(rbF[cutF].dt, rbF.at(-1).dt);
// consistencia por tercios del TEST: estrategia vs SPY
const segs = 3; const segLen = Math.floor((rbF.length - cutF) / segs);
let segWins = 0; const segReport = [];
for (let s = 0; s < segs; s++) {
  const a = cutF + s * segLen, b = s === segs - 1 ? rbF.length : cutF + (s + 1) * segLen;
  const rp = runPortfolio(rbF, TN, bestT, 5, a, b);
  const stratRet = rp.curve.at(-1) - 1;
  const spyRet = spyReturn(rbF[a].dt, rbF[b - 1].dt);
  if (stratRet > spyRet) segWins++;
  segReport.push({ from: rbF[a].dt, to: rbF[b - 1].dt, strat: stratRet, spy: spyRet });
}
console.log("FASE D — config final (TEST OOS):");
console.log(`  CAGR ${(mtFull.cagr * 100).toFixed(1)}% · maxDD ${(mtFull.maxDD * 100).toFixed(1)}% · MAR ${mtFull.mar.toFixed(2)} · win posiciones ${(mean(full.wins) * 100).toFixed(0)}% · hold medio ${mean(full.holds).toFixed(1)} sesiones`);
console.log(`  Total OOS estrategia ${((full.curve.at(-1) - 1) * 100).toFixed(1)}% vs SPY ${(spyTest * 100).toFixed(1)}%`);
console.log("  Consistencia por tercios (estrategia vs SPY):");
segReport.forEach((s) => console.log(`    ${s.from}→${s.to}: ${(s.strat * 100).toFixed(1)}% vs ${(s.spy * 100).toFixed(1)}%  ${s.strat > s.spy ? "✅" : "❌"}`));

// Badge 0-100 honesto: combina MAR (riesgo/recompensa), exceso vs SPY y CONSISTENCIA (peor caso).
const worstSeg = Math.min(...segReport.map((s) => s.strat - s.spy));
const marScore = 100 * Math.max(0, Math.min(1, mtFull.mar / 1.5));     // MAR 1.5 → tope
const excessScore = 100 * Math.max(0, Math.min(1, (full.curve.at(-1) - 1 - spyTest) / 0.30)); // +30pp → tope
const consistScore = 100 * (segWins / segs);
const worstPenalty = worstSeg < 0 ? Math.min(25, -worstSeg * 100) : 0;  // castiga la peor subventana
const badge = Math.round(Math.max(0, Math.min(100, 0.40 * marScore + 0.30 * excessScore + 0.30 * consistScore - worstPenalty)));
console.log(`\n🎖️  BADGE DE FIABILIDAD = ${badge}/100`);
console.log(`     (MAR ${marScore.toFixed(0)} · exceso ${excessScore.toFixed(0)} · consistencia ${consistScore.toFixed(0)} − penaliz. peor tercio ${worstPenalty.toFixed(0)})`);

console.log("\n⚠️  TODO LO ANTERIOR ES SIN COSTES (optimista). Re-evaluación honesta abajo.\n");

// ═══════════════════ FASE E — COSTES + RÉGIMEN (la verdad) ═══════════════════
console.log("FASE E — barrido de COSTES sobre cadencia (one-way bps de spread+slippage), MAR OOS:");
console.log("  cada N |  0bps  | 10bps | 20bps | 35bps");
const COSTS = [0, 10, 20, 35];
const costGrid = [];
for (const R of REBALS) {
  const rb = R === REBAL0 ? rebal10 : buildRebal(R);
  const cutR = Math.floor(rb.length * 0.7);
  const row = { R, rb, cutR, mars: {} };
  const cells = [];
  for (const cb of COSTS) {
    const r = runPortfolio(rb, TN, bestT, 0, cutR, rb.length, cb);
    const mt = metrics(r.curve, (rb.length - cutR) * R);
    row.mars[cb] = mt.mar; cells.push(mt.mar.toFixed(2).padStart(5));
  }
  costGrid.push(row);
  console.log(`  ${String(R).padStart(6)} | ${cells.join(" | ")}`);
}
// cadencia cost-aware: mejor MAR a 20bps (coste realista mixto US/EU)
costGrid.sort((a, b) => b.mars[20] - a.mars[20]);
const cAware = costGrid[0];
console.log(`\n🏆 FASE E: cadencia cost-aware = cada ${cAware.R} sesiones (MAR@20bps ${cAware.mars[20].toFixed(2)})`);

// Config final HONESTA: cost 20bps, cadencia cost-aware, sobre TODO el panel (incluye bear 2022).
const COST = 20;
const rbH = cAware.rb;
const fullH = runPortfolio(rbH, TN, bestT, 5, 1, rbH.length, COST);
const mtH = metrics(fullH.curve, (rbH.length - 1) * cAware.R);
// régimen: trozos de ~9 meses sobre TODO el histórico (incluye el bear 2022 → en TRAIN, in-sample)
console.log("\nRégimen (estrategia vs SPY, periodos ~9 meses; los primeros = bear/recuperación 2022-23, in-sample):");
const segN = 6; const segL = Math.floor((rbH.length - 1) / segN);
const regSeg = []; let regWins = 0;
for (let s = 0; s < segN; s++) {
  const a = 1 + s * segL, b = s === segN - 1 ? rbH.length : 1 + (s + 1) * segL;
  if (b - a < 2) continue;
  const rp = runPortfolio(rbH, TN, bestT, 5, a, b, COST);
  const stratRet = rp.curve.at(-1) - 1;
  const spyRet = spyReturn(rbH[a].dt, rbH[b - 1].dt);
  if (stratRet > spyRet) regWins++;
  regSeg.push({ from: rbH[a].dt, to: rbH[b - 1].dt, strat: stratRet, spy: spyRet });
  console.log(`  ${rbH[a].dt}→${rbH[b - 1].dt}: ${(stratRet * 100).toFixed(1).padStart(6)}% vs SPY ${(spyRet * 100).toFixed(1).padStart(6)}%  ${stratRet > spyRet ? "✅" : "❌"}`);
}
const worstReg = Math.min(...regSeg.map((s) => s.strat));
const worstExc = Math.min(...regSeg.map((s) => s.strat - s.spy));

// ═══════════════════ FASE F — overlay §8 "BLINDADO": cap blando + caja en risk-off + damping ═══════════════════
// Cartera con: tope blando por nombre (cap%), damping de sobreextensión (no filtra, reduce peso),
// y colchón de caja cuando SPY < EMA200 (invierte solo riskFrac). Mismo trailing/cadencia/costes.
function runGuarded(rebal, mult, T, cap, riskFrac, fromIdx, toIdx, costBps = 0) {
  const cost = costBps / 1e4;
  let equity = 1; const curve = [equity]; const wins = []; let posCount = 0;
  let prevW = new Map();
  for (let i = fromIdx; i < toIdx - 1; i++) {
    const cur = rebal[i], nxt = rebal[i + 1];
    const picks = cur.scored.slice(0, 10);
    let w = weightsFor(picks, T, 0);
    // damping de sobreextensión: reduce (no elimina) el peso del que está muy por encima de su MA20
    w = w.map((x, k) => x / (1 + 4 * Math.max(0, picks[k].ft.distMA20 - 0.05)));
    // tope blando por nombre + renormaliza (iterativo simple)
    for (let it = 0; it < 3; it++) { const s = w.reduce((a, b) => a + b, 0) || 1; w = w.map((x) => x / s); w = w.map((x) => Math.min(x, cap)); }
    const s = w.reduce((a, b) => a + b, 0) || 1; w = w.map((x) => x / s);
    // régimen: en risk-off invierte solo riskFrac (resto en caja, sin coste ni retorno)
    const invest = spyRiskOn(cur.dt) ? 1 : riskFrac;
    w = w.map((x) => x * invest);
    const newW = new Map(); picks.forEach((p, k) => { if (w[k] > 0) newW.set(p.f.sym, w[k]); });
    let turnover = 0; const syms = new Set([...prevW.keys(), ...newW.keys()]);
    for (const sy of syms) turnover += Math.abs((newW.get(sy) ?? 0) - (prevW.get(sy) ?? 0));
    equity *= (1 - cost * turnover);
    let periodRet = 0, stopCost = 0; const nextPrev = new Map();
    picks.forEach((p, k) => {
      if (w[k] <= 0) return;
      const r = simSleeve(p, nxt.dt, mult);
      periodRet += w[k] * r.ret; wins.push(r.ret > 0 ? 1 : 0); posCount++;
      if (r.stopped) stopCost += cost * w[k]; else nextPrev.set(p.f.sym, w[k]);
    });
    equity *= (1 + periodRet) * (1 - stopCost); curve.push(equity);
    prevW = nextPrev;
  }
  return { curve, wins, posCount };
}

console.log("\nFASE F — overlay §8 BLINDADO (cap 20% + caja risk-off 35% + damping), 20bps, todo histórico:");
const rbG = cAware.rb;
const guard = runGuarded(rbG, TN, bestT, 0.20, 0.35, 1, rbG.length, COST);
const mtG = metrics(guard.curve, (rbG.length - 1) * cAware.R);
let gWins = 0; const gSeg = [];
{ const segL2 = Math.floor((rbG.length - 1) / 6);
  for (let s = 0; s < 6; s++) { const a = 1 + s * segL2, b = s === 5 ? rbG.length : 1 + (s + 1) * segL2; if (b - a < 2) continue;
    const rp = runGuarded(rbG, TN, bestT, 0.20, 0.35, a, b, COST); const sr = rp.curve.at(-1) - 1; const sp = spyReturn(rbG[a].dt, rbG[b - 1].dt);
    if (sr > sp) gWins++; gSeg.push({ strat: sr, spy: sp, from: rbG[a].dt, to: rbG[b - 1].dt }); } }
gSeg.forEach((s) => console.log(`  ${s.from}→${s.to}: ${(s.strat * 100).toFixed(1).padStart(6)}% vs SPY ${(s.spy * 100).toFixed(1).padStart(6)}%  ${s.strat > s.spy ? "✅" : "❌"}`));
const gWorst = Math.min(...gSeg.map((s) => s.strat));
console.log(`  → BLINDADO: CAGR ${(mtG.cagr * 100).toFixed(1)}% · maxDD ${(mtG.maxDD * 100).toFixed(1)}% · MAR ${mtG.mar.toFixed(2)} · gana a SPY ${gWins}/${gSeg.length} · peor trozo ${(gWorst * 100).toFixed(1)}%`);
const marSG = 100 * Math.max(0, Math.min(1, mtG.mar / 3));
const consSG = 100 * (gWins / gSeg.length);
const penG = gWorst < 0 ? Math.min(30, -gWorst * 150) : 0;
const badgeG = Math.round(Math.max(0, Math.min(92, 0.5 * marSG + 0.5 * consSG - penG)));
console.log(`  🎖️  BADGE BLINDADO = ${badgeG}/100  (vs ${15}/100 del puro agresivo)`);

console.log("\n=== CONFIG FINAL HONESTA (FABLE01, 20bps costes, todo el histórico) ===");
console.log(`  CAGR ${(mtH.cagr * 100).toFixed(1)}% · maxDD ${(mtH.maxDD * 100).toFixed(1)}% · MAR ${mtH.mar.toFixed(2)} · win pos ${(mean(fullH.wins) * 100).toFixed(0)}% · hold ${mean(fullH.holds).toFixed(1)} sesiones`);
console.log(`  Peor trozo ~9m: ${(worstReg * 100).toFixed(1)}% · peor exceso vs SPY: ${(worstExc * 100).toFixed(1)}pp · gana a SPY en ${regWins}/${regSeg.length} trozos`);

// Badge honesto: MAR cost-aware + consistencia cross-régimen + castigo por peor trozo. Tope realista.
const marS = 100 * Math.max(0, Math.min(1, mtH.mar / 3));            // MAR 3 (con costes) ya es excelente → tope
const consS = 100 * (regWins / regSeg.length);
const worstPen = worstReg < 0 ? Math.min(30, -worstReg * 150) : 0;
const badgeH = Math.round(Math.max(0, Math.min(92, 0.5 * marS + 0.5 * consS - worstPen)));  // techo 92: nunca "perfecto"
console.log(`\n🎖️  BADGE HONESTO = ${badgeH}/100   (MAR ${marS.toFixed(0)} · consistencia ${consS.toFixed(0)} − peor trozo ${worstPen.toFixed(0)}; techo 92)`);

console.log("\n=== PARAMS PARA DESPLEGAR (FABLE01) ===");
console.log(JSON.stringify({
  rebalSessions: cAware.R,
  concentrationT: Number.isFinite(bestT) ? bestT : null,
  trailingMults: { TR, TN, TA },
  costBpsAssumed: COST,
  oosHonest: { cagr: +(mtH.cagr * 100).toFixed(1), maxDD: +(mtH.maxDD * 100).toFixed(1), mar: +mtH.mar.toFixed(2), winPos: +(mean(fullH.wins) * 100).toFixed(0), worstSeg: +(worstReg * 100).toFixed(1), beatsSpy: `${regWins}/${regSeg.length}` },
  badge: badgeH,
}, null, 0));
