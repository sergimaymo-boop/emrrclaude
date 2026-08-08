/**
 * SP500 STUDY 2 — de la teoría a lo EJECUTABLE.
 * Preguntas que resuelve:
 *  A) ¿Aguanta la fórmula si la revisamos SEMANAL/MENSUAL y movemos la exposición
 *     a saltos (10/25 pp) en vez de ajustarla a diario? (Sergi opera a mano)
 *  B) ¿Mejora aparcar el dinero en bonos (IEF/TLT) en vez de en efectivo?
 *  C) ¿Vale la pena rotar SECTORES del S&P 500 en vez de comprar el índice?
 *  D) ¿El apalancamiento sintético 2x/3x reproduce a SSO/UPRO reales?
 *  E) ¿La regla funciona fuera de muestra en 1970-1993 (^GSPC)?
 */
import fs from "node:fs";
const DB = JSON.parse(fs.readFileSync("data/sp500-history.json", "utf8")).series;
const COST = 5 / 1e4, LEV_SPREAD = 0.0040;
const LEV_FEE = { 1: 0.0009, 1.5: 0.0035, 2: 0.0060, 3: 0.0095 };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const sma = (v, p) => { const o = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };

function buildContext(baseSym, field) {
  const base = DB[baseSym];
  const dates = base.map((b) => b.date), idx = new Map(dates.map((d, i) => [d, i])), D = dates.length;
  const al = (sym, f = "adj") => { const o = new Array(D).fill(null); const s = DB[sym]; if (!s) return o;
    for (const b of s) { const i = idx.get(b.date); if (i !== undefined) o[i] = b[f]; }
    for (let i = 1; i < D; i++) if (o[i] == null) o[i] = o[i - 1]; return o; };
  const px = base.map((b) => b[field]), raw = base.map((b) => b.close);
  const ret = new Array(D).fill(0); for (let i = 1; i < D; i++) ret[i] = px[i] / px[i - 1] - 1;
  const irx = al("^IRX", "close").map((v) => (v == null ? 4 : v) / 100);
  const mom252 = new Array(D).fill(0); for (let i = 252; i < D; i++) mom252[i] = px[i] / px[i - 252] - 1;
  const vol20 = new Array(D).fill(null); for (let i = 20; i < D; i++) vol20[i] = sd(ret.slice(i - 19, i + 1)) * Math.sqrt(252);
  return { dates, idx, D, al, px, raw, ret, irx, mom252, vol20, sma200: sma(raw, 200) };
}
function metrics(curve, dret, FROM, TO, irx) {
  const years = (TO - FROM) / 252, eq = curve[TO];
  const cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const sh = sd(dret) > 0 ? (mean(dret) * 252 - mean(irx)) / (sd(dret) * Math.sqrt(252)) : 0;
  return { cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: sh };
}

const C = buildContext("SPY", "adj");
const { D, ret, irx, mom252, vol20, raw, sma200 } = C;
const ief = C.al("IEF"), tlt = C.al("TLT");
const iefRet = new Array(D).fill(0); for (let i = 1; i < D; i++) if (ief[i] && ief[i - 1]) iefRet[i] = ief[i] / ief[i - 1] - 1;

/**
 * Motor común. `review`: cada cuántas sesiones se recalcula la orden (1=diario,
 * 5=semanal, 21=mensual). `step`: redondeo de la exposición a múltiplos (0.10=10 pp).
 * `deadband`: no mover la cartera si el cambio es menor que esto.
 */
function sim({ lev = 1, volTarget = 0.20, volCap = 1.5, review = 5, step = 0.10, deadband = 0.10,
               regime = "mom12", parking = "cash", confirmDays = 3, retSeries = ret, ctx = C }) {
  const FROM = 260, TO = ctx.D - 1;
  let eq = 1, expo = 0, orders = 0, switches = 0, daysIn = 0, target = 0;
  const curve = new Array(ctx.D).fill(null); curve[FROM] = 1; const dret = [];
  let pend = null, pendN = 0;
  const fee = LEV_FEE[lev] ?? 0.001;
  for (let i = FROM + 1; i <= TO; i++) {
    if ((i - FROM) % review === 0) {
      const j = i - 1;
      let sig = regime === "mom12" ? (ctx.mom252[j] > 0 ? 1 : 0)
              : regime === "sma200" ? (ctx.raw[j] >= ctx.sma200[j] ? 1 : 0)
              : regime === "both" ? (ctx.mom252[j] > 0 && ctx.raw[j] >= ctx.sma200[j] ? 1 : 0)
              : (ctx.mom252[j] > 0 || ctx.raw[j] >= ctx.sma200[j] ? 1 : 0); // "any"
      if (confirmDays > 1) { if (pend === null || sig !== pend) { pend = sig; pendN = 1; } else pendN++;
        if (pendN < confirmDays) sig = expo > 0 ? 1 : 0; }
      let t = sig;
      if (volTarget && t > 0 && ctx.vol20[j]) t *= Math.min(volCap, volTarget / ctx.vol20[j]);
      t = Math.max(0, Math.min(t, volCap)) * lev;
      if (step) t = Math.round(t / step) * step;
      if (Math.abs(t - target) >= deadband || (t === 0) !== (target === 0)) {
        if ((t === 0) !== (target === 0)) switches++;
        orders++; eq *= 1 - COST * Math.abs(t - target); target = t;
      }
    }
    expo = target;
    const rf = ctx.irx[i - 1] / 252;
    const borrow = Math.max(0, expo - 1) * (ctx.irx[i - 1] + LEV_SPREAD) / 252;
    const free = Math.max(0, 1 - Math.min(expo, 1));
    const idle = parking === "cash" ? free * rf
               : parking === "ief" ? free * iefRet[i]
               : free * rf;
    const r = expo * retSeries[i] + idle - borrow - (expo > 0 ? fee / 252 : 0);
    eq *= 1 + r; curve[i] = eq; dret.push(r); if (expo > 0) daysIn++;
  }
  const years = (TO - FROM) / 252;
  return { ...metrics(curve, dret, FROM, TO, ctx.irx), orders: orders / years, switches: switches / years, pctIn: daysIn / (TO - FROM) };
}

const f = (x, d = 1) => (x * 100).toFixed(d) + "%";
const line = (id, r) => console.log(id.padEnd(30), f(r.cagr).padStart(7), f(r.mdd).padStart(7), r.mar.toFixed(2).padStart(6), r.sharpe.toFixed(2).padStart(7), r.orders.toFixed(0).padStart(7), r.switches.toFixed(1).padStart(7), f(r.pctIn, 0).padStart(7));
const head = (t) => { console.log(`\n=== ${t} ===`); console.log("ID".padEnd(30), "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(6), "Sharpe".padStart(7), "órd/a".padStart(7), "in/out".padStart(7), "%dentro".padStart(7)); };

// ---------- A) operabilidad: cada cuánto revisar y con qué granularidad ----------
head("A) ¿Cuánto se pierde por revisar SEMANAL/MENSUAL y mover a saltos? (regla mom12, VT20, 1x)");
for (const review of [1, 5, 21]) for (const step of [0, 0.10, 0.25]) for (const db of [0.05, 0.10, 0.20]) {
  line(`rev${review}·paso${step * 100 || "cont"}·banda${db * 100}`, sim({ review, step, deadband: db }));
}

// ---------- B) aparcar en bonos vs efectivo ----------
head("B) ¿Bonos (IEF) en vez de efectivo mientras estamos fuera? (rev5·paso10·banda10)");
for (const parking of ["cash", "ief"]) for (const lev of [1, 1.5, 2]) line(`${parking}·L${lev}`, sim({ parking, lev }));

// ---------- C) apalancamiento: cuál es el punto óptimo ----------
head("C) Nivel de apalancamiento óptimo (mom12·VT20·rev5·paso10)");
for (const lev of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) line(`L${lev}`, sim({ lev: LEV_FEE[lev] ? lev : lev, ...{} }));

// ---------- D) validación del apalancamiento sintético contra SSO/UPRO reales ----------
console.log("\n=== D) ¿El 2x/3x sintético reproduce a los ETFs reales? ===");
for (const [sym, L] of [["SSO", 2], ["UPRO", 3]]) {
  const s = DB[sym]; if (!s) continue;
  const from = C.idx.get(s[0].date) ?? 0;
  let real = 1, synth = 1;
  const rmap = new Map(s.map((b) => [b.date, b.adj]));
  let prev = null;
  for (let i = from; i < D; i++) {
    const p = rmap.get(C.dates[i]); if (p == null) continue;
    if (prev != null) { real *= p / prev; synth *= 1 + L * ret[i] - Math.max(0, L - 1) * (irx[i - 1] + LEV_SPREAD) / 252 - LEV_FEE[L] / 252; }
    prev = p;
  }
  const yrs = (D - from) / 252;
  console.log(`  ${sym} (${L}x, ${s[0].date}→): real ${f(Math.pow(real, 1 / yrs) - 1)} anual  ·  sintético ${f(Math.pow(synth, 1 / yrs) - 1)} anual  ·  desvío ${((Math.pow(synth, 1 / yrs) / Math.pow(real, 1 / yrs) - 1) * 100).toFixed(2)} pp`);
}

// ---------- E) rotación de sectores del S&P 500 ----------
console.log("\n=== E) ¿Rotar SECTORES del S&P500 bate a comprar el índice? ===");
const SECT = ["XLK","XLF","XLV","XLY","XLP","XLE","XLI","XLU","XLB"];
const sPx = Object.fromEntries(SECT.map((s) => [s, C.al(s)]));
function sectorRotation({ topN = 3, lookback = 126, review = 21, useRegime = true }) {
  const FROM = 260, TO = D - 1; let eq = 1; const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = [];
  let held = [], orders = 0;
  for (let i = FROM + 1; i <= TO; i++) {
    if ((i - FROM) % review === 0) {
      const j = i - 1;
      const on = !useRegime || (mom252[j] > 0 && raw[j] >= sma200[j]);
      let pick = [];
      if (on) {
        const sc = SECT.map((s) => ({ s, m: sPx[s][j] && sPx[s][j - lookback] ? sPx[s][j] / sPx[s][j - lookback] - 1 : -9 }))
          .filter((x) => x.m > -9).sort((a, b) => b.m - a.m);
        pick = sc.slice(0, topN).map((x) => x.s);
      }
      const changed = pick.join() !== held.join();
      if (changed) { eq *= 1 - COST * (pick.length ? 1 : held.length ? 1 : 0); orders++; held = pick; }
    }
    let r = 0;
    if (held.length) { for (const s of held) { const a = sPx[s][i], b = sPx[s][i - 1]; if (a && b) r += (a / b - 1) / held.length; } }
    else r = irx[i - 1] / 252;
    eq *= 1 + r; curve[i] = eq; dret.push(r);
  }
  return { ...metrics(curve, dret, FROM, TO, irx), orders: orders / ((TO - FROM) / 252), switches: 0, pctIn: 0 };
}
head("  rotación de sectores vs índice");
for (const topN of [1, 2, 3, 4]) for (const lookback of [63, 126, 252]) for (const useRegime of [true]) {
  line(`top${topN}·mom${lookback}·mens`, sectorRotation({ topN, lookback, useRegime }));
}
line("ÍNDICE (mom12·VT20·rev5)", sim({}));

// ---------- F) fuera de muestra 1970-1993 (^GSPC, sin dividendos) ----------
console.log("\n=== F) Fuera de muestra: 1970-1993 en ^GSPC (solo precio, sin dividendos) ===");
const G = buildContext("^GSPC", "close");
const cut = G.dates.findIndex((d) => d >= "1993-01-29");
const gRet = G.ret.slice(); for (let i = cut; i < G.D; i++) gRet[i] = 0; // congelar a partir de 1993
const oos = sim({ ctx: { ...G, D: cut }, retSeries: gRet, review: 5, step: 0.10, deadband: 0.10 });
let bh = 1; for (let i = 261; i < cut; i++) bh *= 1 + G.ret[i];
const yrsO = (cut - 260) / 252;
head("  1970→1993");
line("mom12·VT20·rev5·L1", oos);
console.log("comprar y mantener".padEnd(30), f(Math.pow(bh, 1 / yrsO) - 1).padStart(7));
console.log(`\nPeriodo principal: ${C.dates[260]} → ${C.dates.at(-1)}`);
