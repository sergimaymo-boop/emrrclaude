/**
 * RALLY — SUPER-AUDITORÍA DE INDICADORES (mandato Sergi 9-ago-2026).
 *
 * Pregunta: de TODAS las familias de indicadores razonables (momento a distintos
 * plazos, momento 12-1 clásico, RSI, fuerza relativa a varias ventanas, momento
 * ajustado por volatilidad, estructura de tendencia, proximidad a máximos), ¿cuál
 * produce el top-10 con mejor rentabilidad REAL a 10 años?
 *
 * Protocolo anti-sobreajuste (el mismo que ya tumbó dos falsos hallazgos):
 *   1. Cada variante se evalúa con TRES cadencias de revisión (63/84/105 sesiones).
 *   2. En cada cadencia, la métrica es el PEOR de los dos semestres (2017-22 / 22-26).
 *   3. Un retador solo destrona al campeón si le gana en LAS TRES cadencias.
 *   4. Los indicadores se puntúan por PERCENTIL transversal del día (sin rangos
 *      arbitrarios que se puedan ajustar a mano).
 *
 * El campeón actual (RS 50 + momento 50, pesos por convicción) se evalúa con su
 * fórmula EXACTA de producción, no con una aproximación.
 */
import fs from "node:fs";

const DATA = "data/universe-10y.json";
const COST_BPS = 20 / 1e4;

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// réplica exacta de los normalizadores del campeón de producción
const normalizeRS = (x) => (isNum(x) ? clamp(50 + 50 * Math.tanh(x / 40)) : 20);
const normLin = (v, mn, mx) => (isNum(v) ? clamp(((v - mn) / (mx - mn)) * 100) : 0);
const scoreRS_prod = (rs3m, rs6m) => normalizeRS(rs3m ?? 0) * 0.70 + normalizeRS(rs6m ?? 0) * 0.30;
const scoreMom_prod = (m1, m3, m6) => normLin(m1 ?? 0, -10, 20) * 0.10 + normLin(m3 ?? 0, -15, 45) * 0.60 + normLin(m6 ?? 0, -20, 65) * 0.30;

console.log("Cargando universo…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyRaw = series["SPY.US"].bars;
const dates = spyRaw.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
const spyClose = spyRaw.map((b) => b.a);
const spyRet = (i, lb) => (i - lb >= 0 && spyClose[i - lb] > 0 ? (spyClose[i] / spyClose[i - lb] - 1) * 100 : null);

function emaSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function rsiSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}

console.log("Precomputando indicadores extendidos por ticker…");
const T = [];
for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const adj = bars.map((b) => b.a);
  const e20 = emaSeriesOf(closes, 20), e50 = emaSeriesOf(closes, 50), e200 = emaSeriesOf(closes, 200);
  const rsi14 = rsiSeriesOf(closes, 14);
  const lr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) lr[i] = closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : 0;

  const mAdj = new Array(D).fill(null);
  const feat = new Array(D).fill(null);
  const rp = (i, lb) => (i - lb >= 0 && closes[i - lb] > 0 ? (closes[i] / closes[i - lb] - 1) * 100 : null);

  for (let i = 0; i < n; i++) {
    const k = dateIdx.get(bars[i].d);
    if (k === undefined) continue;
    mAdj[k] = adj[i];
    if (i < 260) continue;

    const m1 = rp(i, 20), m3 = rp(i, 63), m6 = rp(i, 126), m9 = rp(i, 189), m12 = rp(i, 252);
    // momento 12-1 clásico (Jegadeesh-Titman): 12 meses saltando el último mes
    const m12s1 = i - 273 >= 0 && closes[i - 273] > 0 ? (closes[i - 21] / closes[i - 273] - 1) * 100 : null;
    let s2 = 0; for (let q = i - 59; q <= i; q++) s2 += lr[q] * lr[q];
    const vol60 = Math.sqrt((s2 / 60) * 252) * 100;   // % anualizado
    const lookback = Math.min(i, 252);
    let hi = 0; for (let q = i - lookback + 1; q <= i; q++) if (closes[q] > hi) hi = closes[q];
    const rs3m = m3 != null && spyRet(k, 63) != null ? m3 - spyRet(k, 63) : null;
    const rs6m = m6 != null && spyRet(k, 126) != null ? m6 - spyRet(k, 126) : null;
    const rs12m = m12 != null && spyRet(k, 252) != null ? m12 - spyRet(k, 252) : null;

    feat[k] = {
      m1, m3, m6, m9, m12, m12s1, rs3m, rs6m, rs12m,
      rsi14: rsi14[i], vol60,
      volAdj6: m6 != null && vol60 > 0 ? m6 / vol60 : null,     // momento/vol ("sharpe-momento")
      volAdj12: m12s1 != null && vol60 > 0 ? m12s1 / vol60 : null,
      trendStruct: (closes[i] > e20[i] ? 1 : 0) + (e20[i] > e50[i] ? 1 : 0) + (isNum(e200[i]) && e50[i] > e200[i] ? 1 : 0),
      prox: hi > 0 ? closes[i] / hi : null,
    };
  }
  T.push({ sym, adj: mAdj, feat });
}
console.log(`Tickers: ${T.length}\n`);

// ── familias de ranking ──────────────────────────────────────────────────────
// Cada una devuelve un valor crudo; el ranking del día se hace por percentil.
const FAMILIES = {
  "CAMPEÓN prod (RS+mom fijos)": null,   // caso especial: fórmula exacta de producción
  "momento 6m":            (f) => f.m6,
  "momento 9m":            (f) => f.m9,
  "momento 12m":           (f) => f.m12,
  "momento 12-1 clásico":  (f) => f.m12s1,
  "RS 3m":                 (f) => f.rs3m,
  "RS 12m":                (f) => f.rs12m,
  "RSI(14)":               (f) => f.rsi14,
  "momento/vol 6m":        (f) => f.volAdj6,
  "momento/vol 12-1":      (f) => f.volAdj12,
  "RS3m + mom6 (percentil)": "combo_rs_mom",
  "mom6 + mom12-1":        "combo_mom_mom",
  "RS3m + mom12-1":        "combo_rs_m121",
  "mom6 + RSI14":          "combo_mom_rsi",
};

function rankOf(vals) {
  // percentil transversal 0-100 (mayor = mejor)
  const idx = vals.map((v, i) => [v, i]).filter(([v]) => isNum(v)).sort((a, b) => a[0] - b[0]);
  const out = new Array(vals.length).fill(null);
  idx.forEach(([, i], r) => { out[i] = (r / Math.max(1, idx.length - 1)) * 100; });
  return out;
}

function scoresFor(famKey, cands) {
  const fam = FAMILIES[famKey];
  if (fam === null) {
    return cands.map((c) => clamp(scoreRS_prod(c.f.rs3m, c.f.rs6m) * 0.5 + scoreMom_prod(c.f.m1, c.f.m3, c.f.m6) * 0.5));
  }
  if (fam === "combo_rs_mom") {
    const a = rankOf(cands.map((c) => c.f.rs3m)), b = rankOf(cands.map((c) => c.f.m6));
    return cands.map((_, i) => (a[i] != null && b[i] != null ? (a[i] + b[i]) / 2 : null));
  }
  if (fam === "combo_mom_mom") {
    const a = rankOf(cands.map((c) => c.f.m6)), b = rankOf(cands.map((c) => c.f.m12s1));
    return cands.map((_, i) => (a[i] != null && b[i] != null ? (a[i] + b[i]) / 2 : null));
  }
  if (fam === "combo_rs_m121") {
    const a = rankOf(cands.map((c) => c.f.rs3m)), b = rankOf(cands.map((c) => c.f.m12s1));
    return cands.map((_, i) => (a[i] != null && b[i] != null ? (a[i] + b[i]) / 2 : null));
  }
  if (fam === "combo_mom_rsi") {
    const a = rankOf(cands.map((c) => c.f.m6)), b = rankOf(cands.map((c) => c.f.rsi14));
    return cands.map((_, i) => (a[i] != null && b[i] != null ? (a[i] + b[i]) / 2 : null));
  }
  return rankOf(cands.map((c) => fam(c.f)));
}

// ── simulador de cartera (peso igual: aísla la señal; la convicción se aplica al final) ──
function portfolio(famKey, review, FROM = 280) {
  const TO = D - 1;
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let held = [];
  for (let i = FROM + 1; i <= TO; i++) {
    let r = 0;
    if (held.length) {
      for (const ti of held) { const t = T[ti]; const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) / held.length; }
    }
    eq *= 1 + r; curve[i] = eq;
    if ((i - FROM) % review !== 0) continue;
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (f && isNum(t.adj[i])) cands.push({ ti, f });
    }
    const scores = scoresFor(famKey, cands);
    const ranked = cands.map((c, j) => ({ ti: c.ti, s: scores[j] })).filter((x) => x.s != null)
      .sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.ti);
    const oldSet = new Set(held), newSet = new Set(ranked);
    let turn = 0;
    for (const ti of newSet) if (!oldSet.has(ti)) turn++;
    for (const ti of oldSet) if (!newSet.has(ti)) turn++;
    if (turn) eq *= 1 - COST_BPS * (turn / 10);
    held = ranked;
  }
  return curve;
}

function evalCurve(curve, FROM = 280) {
  const SPLIT = Math.floor((D - FROM) / 2) + FROM;
  const yA = (SPLIT - FROM) / 252, yB = (D - 1 - SPLIT) / 252, yF = (D - 1 - FROM) / 252;
  const cagr = Math.pow(curve[D - 1], 1 / yF) - 1;
  const a = Math.pow(curve[SPLIT] / curve[FROM], 1 / yA) - 1;
  const b = Math.pow(curve[D - 1] / curve[SPLIT], 1 / yB) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= D - 1; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  return { cagr, mdd, worst: Math.min(a, b) };
}

const f1 = (x) => `${(x * 100).toFixed(1)}%`;
// ── MALLA DEFINITIVA: 3 fases de inicio × 3 cadencias ────────────────────────
// La medición simple resultó sensible a la fecha de inicio (el campeón varía
// 10 pp al desplazar el arranque 20 sesiones). Un retador solo es REAL si gana
// al campeón en las 9 celdas — o como mínimo nunca pierde y gana en la mayoría.
const CANDIDATES = ["CAMPEÓN prod (RS+mom fijos)", "momento 6m", "momento 9m", "RS 3m", "momento 12m"];
const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
const grid = {};
for (const fam of CANDIDATES) {
  grid[fam] = {};
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const e = evalCurve(portfolio(fam, review, FROM), FROM);
    grid[fam][`${FROM}·${review}`] = e;
  }
}
console.log("Familia".padEnd(28), "celdas (peor semestre por fase·cadencia)");
for (const fam of CANDIDATES) {
  const cells = Object.values(grid[fam]).map((e) => e.worst);
  const minC = Math.min(...cells), medC = [...cells].sort((a,b)=>a-b)[4];
  console.log(fam.padEnd(28), cells.map((c) => f1(c).padStart(7)).join(" "), "  ·  mín", f1(minC), "· mediana", f1(medC));
}
console.log("\n=== ¿El retador gana al campeón CELDA A CELDA? ===");
const champCells = grid["CAMPEÓN prod (RS+mom fijos)"];
for (const fam of CANDIDATES.slice(1)) {
  let wins = 0, losses = 0;
  for (const key of Object.keys(champCells)) {
    if (grid[fam][key].worst > champCells[key].worst) wins++; else losses++;
  }
  const minFam = Math.min(...Object.values(grid[fam]).map((e) => e.worst));
  const minCh = Math.min(...Object.values(champCells).map((e) => e.worst));
  console.log(`  ${fam.padEnd(26)} gana ${wins}/9 celdas · pierde ${losses} · mínimo global ${f1(minFam)} frente a ${f1(minCh)} del campeón  ${wins === 9 ? "✅ DOMINA" : wins >= 7 && minFam > minCh ? "🟡 casi domina" : "❌ no domina"}`);
}
// caídas máximas comparadas (a la fase/cadencia canónica 260·84)
console.log("\nCaída máxima en la celda canónica (fase 260, revisión 84):");
for (const fam of CANDIDATES) console.log(`  ${fam.padEnd(28)} CAGR ${f1(grid[fam]["260·84"].cagr)} · caída ${f1(grid[fam]["260·84"].mdd)}`);

fs.writeFileSync("backtests/rally-super-audit-grid.json", JSON.stringify({ ranAt: new Date().toISOString(), grid }, null, 1));
console.log("\nGuardado: backtests/rally-super-audit-grid.json");
