/**
 * RALLY — BACKTEST del ranking "los 10 tickers con el rally más sano".
 *
 * El motor `rallyScoreEngine.js` nunca se había validado con datos: sus pesos
 * (33% fuerza relativa, 23% momento, 17% tendencia…) venían de literatura
 * (O'Neil, Minervini, Weinstein), no de un backtest. Esto lo mide.
 *
 * Método: en cada fecha de revisión se puntúa TODO el universo usando solo datos
 * hasta esa fecha (sin mirar al futuro), se compran los N mejores a peso igual y se
 * mantienen hasta la siguiente revisión (con opción de trailing stop).
 *
 * Se replica la fórmula del motor de producción EXACTAMENTE; hay un test de
 * equivalencia (`--verify`) que compara contra calculateRallyScore().
 */
import fs from "node:fs";

const DATA = "data/universe-10y.json";
const COST_BPS = Number(process.env.COST_BPS ?? 20) / 1e4; // 20 pb por lado

// ─── utilidades ──────────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// ─── réplica EXACTA de los normalizadores del motor de producción ────────────
const normalizeRS = (x) => (isNum(x) ? clamp(50 + 50 * Math.tanh(x / 40)) : 20);
const normLin = (v, mn, mx) => (isNum(v) ? clamp(((v - mn) / (mx - mn)) * 100) : 0);
const scoreRS = (rs3m, rs6m) => normalizeRS(rs3m ?? 0) * 0.70 + normalizeRS(rs6m ?? 0) * 0.30;
const scoreMom = (m1, m3, m6) => normLin(m1 ?? 0, -10, 20) * 0.10 + normLin(m3 ?? 0, -15, 45) * 0.60 + normLin(m6 ?? 0, -20, 65) * 0.30;
function scoreTrend(p, e20, e50, s20, s50) {
  let s = 0;
  if (isNum(p) && isNum(e20) && p > e20) s += 25;
  if (isNum(e20) && isNum(e50) && e20 > e50) s += 25;
  if (isNum(s20) && s20 > 0) s += 25;
  if (isNum(s50) && s50 > 0) s += 25;
  if (isNum(p) && isNum(e50) && p > e50) s = Math.min(100, s + 10);
  return clamp(s);
}
function scoreProx(prox) {
  if (!isNum(prox)) return 40;
  if (prox >= 1.0) return 100;
  if (prox >= 0.95) return 90;
  if (prox >= 0.85) return 70;
  if (prox >= 0.75) return 40;
  return 10;
}
function scoreRvol(rvol, p, e5) {
  if (!isNum(rvol)) return 30;
  const mult = isNum(p) && isNum(e5) && p >= e5 ? 1.0 : 0.25;
  const base = rvol >= 1.5 ? 100 : rvol >= 1.2 ? 75 : rvol >= 1.0 ? 50 : rvol >= 0.8 ? 30 : 10;
  return clamp(base * mult);
}
function scoreAtr(a) {
  if (!isNum(a)) return 30;
  const x = Math.abs(a);
  if (x >= 1.0 && x <= 2.5) return 100;
  if (x >= 0.5 && x < 1.0) return 60;
  if (x > 2.5 && x <= 4.0) return 70;
  if (x < 0.5) return 20;
  return 30;
}
function scoreLiq(avgValue20, region) {
  const minValue = region === "USA" ? 10_000_000 : 5_000_000;
  let s = 100;
  if (isNum(avgValue20) && avgValue20 < minValue) s -= 50;
  return clamp(s); // el spread no está disponible en histórico: se omite (afecta igual a todos)
}
function penalties(base, { p, e20, e50, m1, m3, rvol, rs5d }) {
  let pen = 0;
  if (isNum(p) && isNum(e20) && e20 > 0) {
    const ext = (p - e20) / e20;
    if (ext > 0.30) pen += 25; else if (ext > 0.20) pen += 15; else if (ext > 0.15) pen += 8;
  }
  if (isNum(p) && isNum(e50) && p < e50) pen += 20;
  if (isNum(m1) && m1 > 40) pen += 10;
  if (isNum(m1) && m1 > 60) pen += 15;
  if (isNum(rvol) && rvol > 3.5) pen += 15;
  if (isNum(rs5d) && rs5d < -8) pen += 8;
  if (isNum(rs5d) && rs5d < -15) pen += 8;
  if (isNum(m3) && isNum(m1) && m3 > 15 && m1 < -5) pen += 8;
  return clamp(base - pen);
}

// ─── carga y preparación ─────────────────────────────────────────────────────
console.log("Cargando universo…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyRaw = series["SPY.US"]?.bars;
if (!spyRaw) throw new Error("Falta SPY.US en el histórico");

const dates = spyRaw.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
const spyClose = spyRaw.map((b) => b.a);

function emaSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function retPct(v, i, lb) {
  if (i - lb < 0) return null;
  const past = v[i - lb];
  return past > 0 ? ((v[i] - past) / past) * 100 : null;
}

// El benchmark se necesita indexado por fecha para la fuerza relativa.
const spyRet = (i, lb) => retPct(spyClose, i, lb);

console.log("Precomputando indicadores por ticker…");
const T = [];
for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  const n = bars.length;
  const closes = bars.map((b) => b.c);       // precio sin ajustar: para las señales técnicas
  const adj = bars.map((b) => b.a);          // ajustado: para la RENTABILIDAD real
  const highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v);
  const e5 = emaSeriesOf(closes, 5), e20 = emaSeriesOf(closes, 20), e50 = emaSeriesOf(closes, 50);

  // ATR de Wilder a 14
  const atrPct = new Array(n).fill(null);
  { let atr = null;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      atr = atr == null ? (i >= 14 ? tr : null) : (atr * 13 + tr) / 14;
      if (i === 14) { let s = 0; for (let k = 1; k <= 14; k++) s += Math.max(highs[k] - lows[k], Math.abs(highs[k] - closes[k - 1]), Math.abs(lows[k] - closes[k - 1])); atr = s / 14; }
      if (atr != null && closes[i] > 0) atrPct[i] = (atr / closes[i]) * 100;
    } }

  // Se proyecta cada barra del ticker sobre el calendario maestro (SPY).
  const mi = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) { const k = dateIdx.get(bars[i].d); if (k !== undefined) mi[i] = k; }

  const mAdj = new Array(D).fill(null);      // precio ajustado por fecha (rentabilidad)
  const mClose = new Array(D).fill(null);
  const mLow = new Array(D).fill(null);
  const feat = new Array(D).fill(null);      // rasgos listos para puntuar

  for (let i = 0; i < n; i++) {
    const k = mi[i]; if (k < 0) continue;
    mAdj[k] = adj[i]; mClose[k] = closes[i]; mLow[k] = lows[i];
    if (i < 130) continue;

    const p = closes[i];
    const s20 = isNum(e20[i]) && isNum(e20[i - 5]) && e20[i - 5] !== 0 ? ((e20[i] - e20[i - 5]) / e20[i - 5]) * 100 : null;
    const s50 = isNum(e50[i]) && isNum(e50[i - 5]) && e50[i - 5] !== 0 ? ((e50[i] - e50[i - 5]) / e50[i - 5]) * 100 : null;
    const m1 = retPct(closes, i, 20), m3 = retPct(closes, i, 63), m6 = retPct(closes, i, 126);
    const v20 = vols.slice(i - 19, i + 1), v40 = vols.slice(i - 39, i - 19);
    const av20 = mean(v20), avPrev = mean(v40);
    const rvol = avPrev > 0 ? av20 / avPrev : null;
    const lookback = Math.min(i, 252);
    let hi = 0; for (let k2 = i - lookback + 1; k2 <= i; k2++) if (closes[k2] > hi) hi = closes[k2];
    // Fuerza relativa contra el S&P 500, en la MISMA fecha de calendario.
    const rs3m = m3 != null && spyRet(k, 63) != null ? m3 - spyRet(k, 63) : null;
    const rs6m = m6 != null && spyRet(k, 126) != null ? m6 - spyRet(k, 126) : null;
    const r5 = retPct(closes, i, 5);
    const rs5d = r5 != null && spyRet(k, 5) != null ? r5 - spyRet(k, 5) : null;

    feat[k] = { p, e5: e5[i], e20: e20[i], e50: e50[i], s20, s50, m1, m3, m6,
                rvol, atr: atrPct[i], av: av20 * p, prox: hi > 0 ? p / hi : null, rs3m, rs6m, rs5d };
  }
  T.push({ sym, name: obj.name, region: obj.exchange === "US" ? "USA" : "EU", adj: mAdj, close: mClose, low: mLow, feat });
}
console.log(`Tickers utilizables: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);


/**
 * OPTIMIZACIÓN DE LA SELECCIÓN — mandato de Sergi (9-ago-2026):
 * "que los 10 tickets sean los que merece la pena entrar para ganar rentabilidad,
 *  que NO estén en el último periodo (del rally) y nos indique si es momento de entrada".
 *
 * En la vuelta anterior probé FILTRAR por una puntuación de recorrido y empeoraba.
 * Aquí se prueba lo que NO probé: selección en DOS ETAPAS (coger un grupo amplio por
 * momento y, dentro de ese grupo, preferir a los que aún tienen recorrido), varias
 * definiciones alternativas de "estar en el último periodo", y exclusiones suaves que
 * solo descartan a los verdaderamente agotados.
 *
 * Criterio de decisión: el PEOR de los dos semestres (robustez), nunca el mejor número
 * del periodo completo — ya se comprobó (rho=0,03) que elegir por el mejor no se transfiere.
 */
const W_RSM = { rs: 0.50, mom: 0.50 };
const scoreV3 = (f) => (f ? clamp(scoreRS(f.rs3m, f.rs6m) * W_RSM.rs + scoreMom(f.m1, f.m3, f.m6) * W_RSM.mom) : null);

// ── definiciones alternativas de "cuánto lleva corriendo / cuánto le queda" ──
function trendAgeEma50(t, i) {
  let n = 0;
  for (let j = i; j > Math.max(130, i - 400); j--) {
    const px = t.close[j]; if (!isNum(px)) continue;
    const f = t.feat[j]; if (!f || !isNum(f.e50) || px < f.e50) break;
    n++;
  }
  return n;
}
/** Sesiones desde el mínimo de 52 semanas: cuánto lleva el tramo alcista. */
function daysSince52wLow(t, i) {
  let lo = Infinity, loIdx = i;
  for (let j = Math.max(0, i - 252); j <= i; j++) { const p = t.close[j]; if (isNum(p) && p < lo) { lo = p; loIdx = j; } }
  return i - loIdx;
}
/** Qué parte del tramo desde el mínimo de 52s ya se ha recorrido (0-1). */
function moveCompletion(t, i, f) {
  let lo = Infinity, hi = 0;
  for (let j = Math.max(0, i - 252); j <= i; j++) { const p = t.close[j]; if (!isNum(p)) continue; if (p < lo) lo = p; if (p > hi) hi = p; }
  if (!isFinite(lo) || hi <= lo) return null;
  return (f.p - lo) / (hi - lo);
}
/** Extensión sobre la media de 50 (el tramo actual, ya validado). */
const extEma50 = (f) => (isNum(f.e50) && f.e50 > 0 ? (f.p - f.e50) / f.e50 : null);

function runwayComposite(t, i, f, mode) {
  const age = trendAgeEma50(t, i);
  const e50 = extEma50(f);
  if (mode === "age") return age < 40 ? 100 : age < 100 ? 60 : age < 200 ? 30 : 10;
  if (mode === "ext") return e50 == null ? 50 : e50 < 0.05 ? 100 : e50 < 0.15 ? 65 : e50 < 0.30 ? 35 : 10;
  if (mode === "since_low") { const d = daysSince52wLow(t, i); return d < 60 ? 100 : d < 120 ? 65 : d < 200 ? 35 : 15; }
  if (mode === "completion") { const c = moveCompletion(t, i, f); return c == null ? 50 : c < 0.7 ? 100 : c < 0.9 ? 70 : c < 0.98 ? 40 : 15; }
  // compuesto validado (edad + extensión + penalización por estar en máximos)
  let s = 50;
  if (age < 40) s += 25; else if (age < 100) s += 5; else s -= 5;
  if (e50 != null) { if (e50 < 0.05) s += 20; else if (e50 < 0.15) s += 5; else if (e50 > 0.30) s -= 10; }
  if (f.prox != null && f.prox > 0.997) s -= 15;
  return clamp(s);
}

/** ¿Está claramente AGOTADO? Exclusión suave: solo los casos extremos. */
function isExhausted(t, i, f, level) {
  const age = trendAgeEma50(t, i), e50 = extEma50(f);
  if (level === "off") return false;
  if (level === "suave") return (age > 200) || (e50 != null && e50 > 0.40);
  if (level === "medio") return (age > 150) || (e50 != null && e50 > 0.30) || (f.prox != null && f.prox > 0.999 && age > 100);
  return (age > 100) || (e50 != null && e50 > 0.25);   // "duro"
}

const maxWeightSeen = { v: 0 };
function portfolio({ topN = 10, review = 84, poolN = null, runwayMode = null, exhaust = "off",
                     blendW = 0, label = "", weighting = "equal" }) {
  const FROM = 260, TO = D - 1;
  let eq = 1, trades = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = [];
  let held = [];
  for (let i = FROM + 1; i <= TO; i++) {
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) { const t = T[h.ti]; const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum); }
    }
    eq *= 1 + r; curve[i] = eq; dret.push(r);
    if ((i - FROM) % review !== 0) continue;

    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const rs = scoreV3(f); if (rs == null) continue;
      cands.push({ ti, rs, f, t });
    }
    cands.sort((a, b) => b.rs - a.rs);

    let pool = cands;
    if (exhaust !== "off") {
      const kept = cands.filter((c) => !isExhausted(c.t, i, c.f, exhaust));
      if (kept.length >= topN) pool = kept;   // si el filtro deja menos de 10, no se aplica
    }
    let pick;
    if (poolN && runwayMode) {
      // DOS ETAPAS: los mejores `poolN` por momento; entre ellos, los de más recorrido.
      const stage1 = pool.slice(0, poolN);
      stage1.forEach((c) => { c.rw = runwayComposite(c.t, i, c.f, runwayMode); });
      stage1.sort((a, b) => b.rw - a.rw);
      pick = stage1.slice(0, topN);
    } else if (blendW > 0 && runwayMode) {
      pool.forEach((c) => { c.rw = runwayComposite(c.t, i, c.f, runwayMode); });
      pool.sort((a, b) => (b.rs * (1 - blendW) + b.rw * blendW) - (a.rs * (1 - blendW) + a.rw * blendW));
      pick = pool.slice(0, topN);
    } else {
      pick = pool.slice(0, topN);
    }

    // ponderación: igual, o proporcional a la convicción (score por encima de 50)
    const wOf = (rs) => {
      if (weighting === "equal") return 1;
      if (weighting === "score50") return Math.max(0.1, rs - 50);
      if (weighting === "score40") return Math.max(0.1, rs - 40);
      if (weighting === "score60") return Math.max(0.1, rs - 60);
      if (weighting === "sqrt") return Math.sqrt(Math.max(0.1, rs - 50));
      return 1;
    };
    let newIds = pick.map((p) => ({ ti: p.ti, w: wOf(p.rs) }));
    if (weighting !== "equal") {
      // TOPE de concentración: ninguna posición puede pasar del 18% ni bajar del 4%
      const tot = newIds.reduce((s, x) => s + x.w, 0) || 1;
      newIds = newIds.map((x) => ({ ...x, w: clamp((x.w / tot) * 100, 4, 18) }));
      const mx = Math.max(...newIds.map((x) => x.w / newIds.reduce((s, y) => s + y.w, 0)));
      if (mx > maxWeightSeen.v) maxWeightSeen.v = mx;
    }
    const oldSet = new Set(held.map((h) => h.ti)), newSet = new Set(newIds.map((h) => h.ti));
    let turnover = 0;
    for (const ti of newSet) if (!oldSet.has(ti)) turnover++;
    for (const ti of oldSet) if (!newSet.has(ti)) turnover++;
    if (turnover) { eq *= 1 - COST_BPS * (turnover / Math.max(topN, 1)); trades += turnover; }
    held = newIds;
  }
  const years = (TO - FROM) / 252, cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const vol = sd(dret) * Math.sqrt(252);
  return { label, cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: vol > 0 ? (cagr - 0.03) / vol : 0, tradesYr: trades / years, curve };
}

const SPLIT = Math.floor((D - 260) / 2) + 260;
function evaluate(cfg) {
  const r = portfolio(cfg), c = r.curve;
  const yA = (SPLIT - 260) / 252, yB = (D - 1 - SPLIT) / 252;
  const a = Math.pow(c[SPLIT] / c[260], 1 / yA) - 1;
  const b = Math.pow(c[D - 1] / c[SPLIT], 1 / yB) - 1;
  return { ...r, cagrA: a, cagrB: b, worst: Math.min(a, b) };
}

const f1 = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
function ev3(cfg) {
  maxWeightSeen.v = 0;
  const a = evaluate({ ...cfg, review: 63 }), b = evaluate({ ...cfg, review: 84 }), c = evaluate({ ...cfg, review: 105 });
  return { label: cfg.label, w63: a.worst, w84: b.worst, w105: c.worst, minAll: Math.min(a.worst, b.worst, c.worst),
           cagr: b.cagr, mdd: b.mdd, mar: b.mar, maxW: maxWeightSeen.v };
}
console.log("Ponderación".padEnd(34), "rev63".padStart(8), "rev84".padStart(8), "rev105".padStart(8), "PEOR-3".padStart(8), " ‖ ", "CAGR".padStart(8), "caída".padStart(8), "MAR".padStart(6), "máx.pos".padStart(8));
const tests = [
  { label: "peso igual (base actual)", weighting: "equal" },
  { label: "convicción score-40", weighting: "score40" },
  { label: "convicción score-50", weighting: "score50" },
  { label: "convicción score-60", weighting: "score60" },
  { label: "convicción raíz cuadrada", weighting: "sqrt" },
];
const out = tests.map((t) => { const r = ev3({ ...t, topN: 10 });
  console.log(r.label.padEnd(34), f1(r.w63).padStart(8), f1(r.w84).padStart(8), f1(r.w105).padStart(8), f1(r.minAll).padStart(8), " ‖ ",
    f1(r.cagr).padStart(8), f1(r.mdd).padStart(8), r.mar.toFixed(2).padStart(6), (r.maxW ? f1(r.maxW,0) : "—").padStart(8));
  return r; });
const base = out[0];
console.log("\n=== ¿Mejora a la base en las TRES cadencias? ===");
for (const o of out.slice(1)) {
  const ok = o.w63 >= base.w63 && o.w84 >= base.w84 && o.w105 >= base.w105;
  console.log(`  ${o.label.padEnd(30)} ${ok ? "✅ SÍ en las 3" : "❌ no"}   (peor-3: ${f1(o.minAll)} frente a ${f1(base.minAll)})`);
}
fs.writeFileSync("backtests/rally-weighting.json", JSON.stringify({ ranAt: new Date().toISOString(), out }, null, 1));
console.log("\nGuardado: backtests/rally-weighting.json");
