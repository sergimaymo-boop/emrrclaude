/**
 * SP500 STUDY 1 — barrido amplio de reglas de ENTRADA/SALIDA sobre el S&P 500.
 * Universo del estudio: el propio índice (no selección de acciones). Objetivo:
 * encontrar la fórmula que maximiza rentabilidad controlando la caída máxima.
 *
 * Datos: SPY ajustado (1993→2026, incluye 2000, 2008, 2020, 2022) + ^GSPC (1970→)
 * como validación fuera de muestra. Efectivo remunerado con ^IRX (letras 13 semanas).
 * Costes 5 bps por lado (ETF muy líquido) + coste de gestión del apalancamiento.
 */
import fs from "node:fs";

const DB = JSON.parse(fs.readFileSync("data/sp500-history.json", "utf8")).series;
const COST = 5 / 1e4;          // 5 bps por lado (cambio de exposición)
const LEV_FEE = { 1: 0.0009, 1.5: 0.0035, 2: 0.0060, 3: 0.0095 }; // TER anual del vehículo
const LEV_SPREAD = 0.0040;     // spread de financiación sobre el tipo sin riesgo

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function sma(v, p) { const o = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; }
function ema(v, p) { const k = 2 / (p + 1); const o = new Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i === 0 ? v[0] : v[i] * k + e * (1 - k); o[i] = e; } return o; }
function rsi(v, p) { const o = new Array(v.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  return o; }

// ---------- alineado de series al calendario de SPY ----------
const spy = DB.SPY;
const dates = spy.map((b) => b.date);
const idx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
function align(sym, field = "close") {
  const out = new Array(D).fill(null); const s = DB[sym]; if (!s) return out;
  for (const b of s) { const i = idx.get(b.date); if (i !== undefined) out[i] = b[field]; }
  for (let i = 1; i < D; i++) if (out[i] == null) out[i] = out[i - 1];  // forward-fill
  return out;
}
const px = spy.map((b) => b.adj);                       // precio total-return (con dividendos)
const raw = spy.map((b) => b.close);                    // precio sin ajustar (para señales de nivel)
const vix = align("^VIX");
const irx = align("^IRX").map((v) => (v == null ? 4 : v) / 100); // rendimiento anual del efectivo
const hyg = align("HYG", "adj"), lqd = align("LQD", "adj");

const ret = new Array(D).fill(0);
for (let i = 1; i < D; i++) ret[i] = px[i] / px[i - 1] - 1;

const sma200 = sma(raw, 200), sma50 = sma(raw, 50), ema200 = ema(raw, 200);
const sma210 = sma(raw, 210);                          // ≈ 10 meses (Faber)
const rsi2 = rsi(raw, 2);
const vixSma = sma(vix.map((v) => v ?? 20), 20);
const mom252 = new Array(D).fill(0); for (let i = 252; i < D; i++) mom252[i] = px[i] / px[i - 252] - 1;
const mom126 = new Array(D).fill(0); for (let i = 126; i < D; i++) mom126[i] = px[i] / px[i - 126] - 1;
const vol20 = new Array(D).fill(null);
for (let i = 20; i < D; i++) vol20[i] = sd(ret.slice(i - 19, i + 1)) * Math.sqrt(252);
const hlRatio = new Array(D).fill(null);
for (let i = 0; i < D; i++) if (hyg[i] && lqd[i]) hlRatio[i] = hyg[i] / lqd[i];
const hlSma = sma(hlRatio.map((v) => v ?? 1), 50);

// ---------- señales de régimen (todas usan datos hasta i-1: sin mirar al futuro) ----------
const REGIMES = {
  bh:        () => 1,                                                   // comprar y mantener
  sma200:    (i) => (raw[i] >= sma200[i] ? 1 : 0),
  ema200:    (i) => (raw[i] >= ema200[i] ? 1 : 0),
  faber:     (i) => (raw[i] >= sma210[i] ? 1 : 0),
  sma200b:   (i, st) => {                                               // con banda 2% (antilátigo)
    if (st.on) return raw[i] >= sma200[i] * 0.98 ? 1 : 0;
    return raw[i] >= sma200[i] * 1.02 ? 1 : 0; },
  dual:      (i) => (raw[i] >= sma200[i] && sma50[i] >= sma200[i] ? 1 : 0),
  mom12:     (i) => (mom252[i] > 0 ? 1 : 0),
  mom6:      (i) => (mom126[i] > 0 ? 1 : 0),
  momSma:    (i) => (mom252[i] > 0 && raw[i] >= sma200[i] ? 1 : 0),
  vixReg:    (i) => (vix[i] != null && vix[i] < vixSma[i] * 1.2 ? 1 : 0),
  smaVix:    (i) => (raw[i] >= sma200[i] && vix[i] < 30 ? 1 : 0),
  smaCred:   (i) => (raw[i] >= sma200[i] && (hlRatio[i] == null || hlRatio[i] >= hlSma[i]) ? 1 : 0),
  graded:    (i) => (raw[i] >= sma200[i] ? (sma50[i] >= sma200[i] ? 1 : 0.6) : (raw[i] >= sma200[i] * 0.9 ? 0.3 : 0)),
};

function simulate({ regime, lev = 1, volTarget = null, volCap = 1.0, pullback = false, confirm = 1, cashYield = true }) {
  const FROM = 260, TO = D - 1;
  let eq = 1, exposure = 0, trades = 0, daysIn = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  const dret = [];
  const st = { on: false };
  let pendSignal = null, pendCount = 0;
  const fee = LEV_FEE[lev] ?? 0.001;

  for (let i = FROM + 1; i <= TO; i++) {
    // señal calculada con el cierre de i-1
    let target = REGIMES[regime](i - 1, st);
    st.on = target > 0;
    // confirmación de N días para reducir látigos
    if (confirm > 1) {
      if (pendSignal === null) pendSignal = target;
      if (target !== pendSignal) { pendSignal = target; pendCount = 1; }
      else pendCount++;
      if (pendCount < confirm) target = exposure > 0 ? 1 : 0;
    }
    // objetivo de volatilidad: escala la exposición
    if (volTarget && target > 0 && vol20[i - 1]) {
      target *= Math.min(volCap, volTarget / vol20[i - 1]);
    }
    // entradas en retroceso: refuerza cuando el índice está sobrevendido dentro de tendencia alcista
    if (pullback && target > 0 && rsi2[i - 1] != null && rsi2[i - 1] < 10) target *= 1.25;
    target = Math.max(0, Math.min(target, volCap)) * lev;

    if (Math.abs(target - exposure) > 1e-9) { eq *= 1 - COST * Math.abs(target - exposure); trades++; }
    exposure = target;

    const rf = irx[i - 1] / 252;
    const borrow = Math.max(0, exposure - 1) * (irx[i - 1] + LEV_SPREAD) / 252;
    const idle = cashYield ? Math.max(0, 1 - Math.min(exposure, 1)) * rf : 0;
    const feeD = exposure > 0 ? fee / 252 : 0;
    const r = exposure * ret[i] + idle - borrow - feeD;
    eq *= 1 + r;
    curve[i] = eq; dret.push(r);
    if (exposure > 0) daysIn++;
  }

  const years = (TO - FROM) / 252;
  const cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const sh = sd(dret) > 0 ? (mean(dret) * 252 - mean(irx) ) / (sd(dret) * Math.sqrt(252)) : 0;
  // subperiodos (tercios)
  const cuts = [FROM, FROM + Math.floor((TO - FROM) / 3), FROM + Math.floor(2 * (TO - FROM) / 3), TO];
  const sub = [];
  for (let k = 0; k < 3; k++) {
    const a = curve[cuts[k]], b = curve[cuts[k + 1]];
    const y = (cuts[k + 1] - cuts[k]) / 252;
    sub.push(Math.pow(b / a, 1 / y) - 1);
  }
  return { cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: sh, trades: trades / years, pctIn: daysIn / (TO - FROM), sub, final: eq };
}

// ---------- barrido ----------
const rows = [];
const regimeList = Object.keys(REGIMES);
for (const regime of regimeList) {
  for (const lev of [1, 1.5, 2, 3]) {
    for (const vt of [null, 0.15, 0.20]) {
      for (const pb of [false, true]) {
        for (const cf of [1, 3]) {
          if (regime === "bh" && (vt || pb || cf > 1)) continue;
          const r = simulate({ regime, lev, volTarget: vt, volCap: vt ? 1.5 : 1.0, pullback: pb, confirm: cf });
          rows.push({ id: `${regime}·L${lev}${vt ? `·VT${vt * 100}` : ""}${pb ? "·PB" : ""}${cf > 1 ? `·C${cf}` : ""}`, regime, lev, vt, pb, cf, ...r });
        }
      }
    }
  }
}

const f = (x, d = 1) => (x * 100).toFixed(d);
const show = (list, title) => {
  console.log(`\n=== ${title} ===`);
  console.log("ID".padEnd(26), "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(6), "Sharpe".padStart(7), "ops/a".padStart(6), "%dentro".padStart(8), "  subperiodos");
  for (const r of list) console.log(r.id.padEnd(26), (f(r.cagr) + "%").padStart(7), (f(r.mdd) + "%").padStart(7), r.mar.toFixed(2).padStart(6), r.sharpe.toFixed(2).padStart(7), r.trades.toFixed(0).padStart(6), (f(r.pctIn, 0) + "%").padStart(8), "  " + r.sub.map((s) => f(s, 0) + "%").join(" / "));
};

show([rows.find((r) => r.id === "bh·L1"), ...rows.filter((r) => r.regime === "bh")].filter((v, i, a) => v && a.indexOf(v) === i), "REFERENCIA: comprar y mantener");
show([...rows].sort((a, b) => b.mar - a.mar).slice(0, 20), "TOP 20 por MAR (rentabilidad / caída máxima)");
show([...rows].sort((a, b) => b.cagr - a.cagr).slice(0, 15), "TOP 15 por CAGR puro");
show([...rows].filter((r) => r.mdd <= 0.25).sort((a, b) => b.cagr - a.cagr).slice(0, 15), "TOP 15 por CAGR con caída máxima ≤ 25%");
show([...rows].filter((r) => r.mdd <= 0.35).sort((a, b) => b.cagr - a.cagr).slice(0, 15), "TOP 15 por CAGR con caída máxima ≤ 35%");

fs.writeFileSync("backtests/sp500-study-1.json", JSON.stringify({ ranAt: new Date().toISOString(), period: [dates[260], dates.at(-1)], rows }, null, 1));
console.log(`\nPeriodo: ${dates[260]} → ${dates.at(-1)}  (${((D - 260) / 252).toFixed(1)} años, ${D} sesiones)`);
console.log("Guardado: backtests/sp500-study-1.json");
