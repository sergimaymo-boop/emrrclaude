/**
 * SP500 STUDY 3 — corrige la ventana de los sectores y prueba el módulo de
 * ENTRADAS EN RETROCESO (pullback) de forma seria, no como un multiplicador suelto.
 */
import fs from "node:fs";
const DB = JSON.parse(fs.readFileSync("data/sp500-history.json", "utf8")).series;
const COST = 5 / 1e4, LEV_SPREAD = 0.0040;
const LEV_FEE = { 1: 0.0009, 1.5: 0.0035, 2: 0.0060 };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const sma = (v, p) => { const o = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
const rsiF = (v, p) => { const o = new Array(v.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } return o; };

const spy = DB.SPY, dates = spy.map((b) => b.date), idx = new Map(dates.map((d, i) => [d, i])), D = dates.length;
const al = (sym, f = "adj") => { const o = new Array(D).fill(null); const s = DB[sym]; if (!s) return o;
  for (const b of s) { const i = idx.get(b.date); if (i !== undefined) o[i] = b[f]; }
  for (let i = 1; i < D; i++) if (o[i] == null) o[i] = o[i - 1]; return o; };
const px = spy.map((b) => b.adj), rawP = spy.map((b) => b.close);
const ret = new Array(D).fill(0); for (let i = 1; i < D; i++) ret[i] = px[i] / px[i - 1] - 1;
const irx = al("^IRX", "close").map((v) => (v == null ? 4 : v) / 100);
const mom252 = new Array(D).fill(0); for (let i = 252; i < D; i++) mom252[i] = px[i] / px[i - 252] - 1;
const vol20 = new Array(D).fill(null); for (let i = 20; i < D; i++) vol20[i] = sd(ret.slice(i - 19, i + 1)) * Math.sqrt(252);
const sma200 = sma(rawP, 200), rsi2 = rsiF(rawP, 2);
const hi20 = new Array(D).fill(null); for (let i = 20; i < D; i++) hi20[i] = Math.max(...rawP.slice(i - 19, i + 1));

function metrics(curve, dret, FROM, TO) {
  const years = (TO - FROM) / 252, eq = curve[TO], cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0; for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  return { cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: sd(dret) > 0 ? (mean(dret) * 252 - mean(irx)) / (sd(dret) * Math.sqrt(252)) : 0 };
}
/** Núcleo: régimen mom12 + objetivo de volatilidad, revisión semanal, saltos de 10 pp. */
function core({ FROM, lev = 1, volTarget = 0.20, volCap = 1.5, review = 5, step = 0.10, deadband = 0.10,
                pbBoost = 0, pbRsi = 5, confirmDays = 3 }) {
  const TO = D - 1; let eq = 1, target = 0, orders = 0, switches = 0, daysIn = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = []; let pend = null, pendN = 0;
  const fee = LEV_FEE[lev] ?? 0.001;
  for (let i = FROM + 1; i <= TO; i++) {
    const j = i - 1;
    const scheduled = (i - FROM) % review === 0;
    // el refuerzo por retroceso se evalúa A DIARIO (una oportunidad no espera al lunes)
    const pbNow = pbBoost > 0 && mom252[j] > 0 && rawP[j] >= sma200[j] && rsi2[j] != null && rsi2[j] < pbRsi;
    if (scheduled || pbNow) {
      let sig = mom252[j] > 0 ? 1 : 0;
      if (confirmDays > 1) { if (pend === null || sig !== pend) { pend = sig; pendN = 1; } else pendN++;
        if (pendN < confirmDays) sig = target > 0 ? 1 : 0; }
      let t = sig;
      if (volTarget && t > 0 && vol20[j]) t *= Math.min(volCap, volTarget / vol20[j]);
      if (pbNow && t > 0) t += pbBoost;
      t = Math.max(0, Math.min(t, volCap + pbBoost)) * lev;
      if (step) t = Math.round(t / step) * step;
      if (Math.abs(t - target) >= deadband || (t === 0) !== (target === 0)) {
        if ((t === 0) !== (target === 0)) switches++;
        orders++; eq *= 1 - COST * Math.abs(t - target); target = t;
      }
    }
    const borrow = Math.max(0, target - 1) * (irx[j] + LEV_SPREAD) / 252;
    const idle = Math.max(0, 1 - Math.min(target, 1)) * irx[j] / 252;
    const r = target * ret[i] + idle - borrow - (target > 0 ? fee / 252 : 0);
    eq *= 1 + r; curve[i] = eq; dret.push(r); if (target > 0) daysIn++;
  }
  const years = (TO - FROM) / 252;
  return { ...metrics(curve, dret, FROM, TO), orders: orders / years, switches: switches / years, pctIn: daysIn / (TO - FROM) };
}
function buyHold(FROM, series = ret) {
  const TO = D - 1; let eq = 1; const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = [];
  for (let i = FROM + 1; i <= TO; i++) { eq *= 1 + series[i]; curve[i] = eq; dret.push(series[i]); }
  return { ...metrics(curve, dret, FROM, TO), orders: 0, switches: 0, pctIn: 1 };
}
const f = (x, d = 1) => (x * 100).toFixed(d) + "%";
const head = (t) => { console.log(`\n=== ${t} ===`); console.log("ID".padEnd(30), "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(6), "Sharpe".padStart(7), "órd/a".padStart(7), "in/out".padStart(7), "%dentro".padStart(7)); };
const line = (id, r) => console.log(id.padEnd(30), f(r.cagr).padStart(7), f(r.mdd).padStart(7), r.mar.toFixed(2).padStart(6), r.sharpe.toFixed(2).padStart(7), r.orders.toFixed(0).padStart(7), r.switches.toFixed(1).padStart(7), f(r.pctIn, 0).padStart(7));

// ---- E-bis) sectores en VENTANA COMPARABLE (desde 1999-06, con los 9 sectores vivos) ----
const SECT = ["XLK","XLF","XLV","XLY","XLP","XLE","XLI","XLU","XLB"];
const sPx = Object.fromEntries(SECT.map((s) => [s, al(s)]));
const F99 = idx.get(dates.find((d) => d >= "1999-06-01"));
function rotation({ FROM, topN, lookback, review = 21, useRegime = true }) {
  const TO = D - 1; let eq = 1, orders = 0, daysIn = 0; const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = []; let held = [];
  for (let i = FROM + 1; i <= TO; i++) {
    if ((i - FROM) % review === 0) {
      const j = i - 1, on = !useRegime || (mom252[j] > 0 && rawP[j] >= sma200[j]);
      const pick = on ? SECT.map((s) => ({ s, m: sPx[s][j] && sPx[s][j - lookback] ? sPx[s][j] / sPx[s][j - lookback] - 1 : -9 }))
        .filter((x) => x.m > -9).sort((a, b) => b.m - a.m).slice(0, topN).map((x) => x.s) : [];
      if (pick.join() !== held.join()) { eq *= 1 - COST; orders++; held = pick; }
    }
    let r = held.length ? 0 : irx[i - 1] / 252;
    for (const s of held) { const a = sPx[s][i], b = sPx[s][i - 1]; if (a && b) r += (a / b - 1) / held.length; }
    eq *= 1 + r; curve[i] = eq; dret.push(r); if (held.length) daysIn++;
  }
  const years = (TO - FROM) / 252;
  return { ...metrics(curve, dret, FROM, TO), orders: orders / years, switches: 0, pctIn: daysIn / (TO - FROM) };
}
head(`E-bis) SECTORES vs ÍNDICE, misma ventana ${dates[F99]} → ${dates.at(-1)}`);
line("comprar y mantener SPY", buyHold(F99));
line("ÍNDICE · núcleo semanal", core({ FROM: F99 }));
for (const topN of [1, 2, 3, 4]) for (const lb of [126, 252]) line(`sectores top${topN}·mom${lb}`, rotation({ FROM: F99, topN, lookback: lb }));

// ---- G) módulo de entradas en RETROCESO evaluado a diario ----
head("G) ¿Aporta el refuerzo en retrocesos (RSI2 bajo dentro de tendencia)? (1994→)");
const F94 = 260;
line("núcleo sin refuerzo", core({ FROM: F94, pbBoost: 0 }));
for (const boost of [0.15, 0.25, 0.40]) for (const r of [3, 5, 10]) line(`refuerzo +${boost * 100}pp·RSI2<${r}`, core({ FROM: F94, pbBoost: boost, pbRsi: r }));

// ---- H) rejilla fina del núcleo: objetivo de volatilidad y tope ----
head("H) Ajuste fino del objetivo de volatilidad y del tope de exposición (1x, semanal)");
for (const vt of [0.12, 0.15, 0.18, 0.20, 0.25]) for (const cap of [1.0, 1.25, 1.5, 2.0]) line(`VT${vt * 100}·tope${cap * 100}`, core({ FROM: F94, volTarget: vt, volCap: cap }));

// ---- I) la recomendación final a distintos niveles de riesgo ----
head("I) Perfiles finales (VT20·tope150·semanal·saltos10pp·refuerzo elegido)");
line("REFERENCIA comprar y mantener", buyHold(F94));
for (const lev of [1, 1.25, 1.5, 1.75, 2]) line(`perfil L${lev}`, core({ FROM: F94, lev, pbBoost: 0.25, pbRsi: 5 }));
