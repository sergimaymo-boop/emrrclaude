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
  const highs = bars.map((b) => b.h), lows = bars.map((b) => b.l);
  // ATR de Wilder 14 (para la anchura del trailing por ticker)
  const atrPct = new Array(n).fill(null);
  { let atr = null;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      if (i === 14) { let s0 = 0; for (let q = 1; q <= 14; q++) s0 += Math.max(highs[q] - lows[q], Math.abs(highs[q] - closes[q - 1]), Math.abs(lows[q] - closes[q - 1])); atr = s0 / 14; }
      else if (i > 14) atr = (atr * 13 + tr) / 14;
      if (atr != null && closes[i] > 0) atrPct[i] = (atr / closes[i]) * 100;
    } }
  // edad de la tendencia: sesiones consecutivas cerrando sobre la EMA50
  const ageArr = new Array(n).fill(0);
  { let cnt = 0;
    for (let i = 0; i < n; i++) { cnt = isNum(e50[i]) && closes[i] >= e50[i] ? cnt + 1 : 0; ageArr[i] = cnt; } }
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
      atr: atrPct[i],
      age: ageArr[i],
      ext50: isNum(e50[i]) && e50[i] > 0 ? (closes[i] - e50[i]) / e50[i] : null,
    };
  }
  T.push({ sym, adj: mAdj, feat });
}
console.log(`Tickers: ${T.length}\n`);


/**
 * PRUEBA DE LA ESTRATEGIA DE SERGI (10-ago-2026):
 * "cuando salte el trailing stop, salta al ticket que EN ESE MOMENTO el scan diga
 *  que es el mejor, con recorrido ALTO y entrada IDEAL".
 *
 * Se simula EXACTAMENTE eso, sobre el ranking v4 (momento 9m) con pesos por
 * convicción, y se compara contra el campeón actual (revisión ~4 meses sin trailing).
 * Protocolo: malla 3 fases × 3 cadencias, peor semestre por celda.
 */
const scoreV4 = (f) => (f && isNum(f.m9) ? clamp(50 + 50 * Math.tanh(f.m9 / 75)) : null);

// réplica exacta de computeRunway / entryTiming de producción
function runwayLevel(f) {
  let s = 50;
  if (f.age < 40) s += 25; else if (f.age < 100) s += 5; else s -= 5;
  if (f.ext50 != null) { if (f.ext50 < 0.05) s += 20; else if (f.ext50 < 0.15) s += 5; else if (f.ext50 > 0.30) s -= 10; }
  if (f.prox != null && f.prox > 0.997) s -= 15;
  s = clamp(s);
  return s >= 75 ? "ALTO" : s >= 55 ? "MEDIO" : "BAJO";
}
const entryIdeal = (f) => f.prox != null && f.prox >= 0.96 && f.prox <= 0.997;
function trailCat(atr) { return clamp(25 + (isNum(atr) ? atr : 3) * 2, 25, 35) / 100; }
function trailTight(atr) {
  if (!isNum(atr) || atr <= 0) return 0.10;
  const m = atr < 1.5 ? 2.0 : atr <= 3.0 ? 2.5 : 3.0;
  return clamp(atr * m, 5, 18) / 100;
}

function pickReplacement(i, heldSet, mode) {
  let best = null, bestAlto = null, bestIdeal = null;
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s == null) continue;
    if (!best || s > best.s) best = { ti, s };
    const rl = runwayLevel(f);
    if (rl === "ALTO") {
      if (!bestAlto || s > bestAlto.s) bestAlto = { ti, s };
      if (entryIdeal(f) && (!bestIdeal || s > bestIdeal.s)) bestIdeal = { ti, s };
    }
  }
  if (mode === "ideal") return bestIdeal ?? bestAlto ?? best;   // preferencia estricta de Sergi, con degradado
  if (mode === "alto") return bestAlto ?? best;
  return best;
}

function portfolio({ review, FROM, trailing = null, jumpMode = null }) {
  const TO = D - 1;
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let held = [];   // {ti, w, peak, trailPct}
  for (let i = FROM + 1; i <= TO; i++) {
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) { const t = T[h.ti]; const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum); }
    }
    eq *= 1 + r; curve[i] = eq;

    // trailing + SALTO inmediato al sustituto elegido según el modo
    if (trailing && held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const next = [];
      for (const h of held) {
        const px = T[h.ti].adj[i];
        if (isNum(px)) {
          if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trailPct)) {
            eq *= 1 - COST_BPS * 2 * (h.w / 100);   // vender + comprar el sustituto
            heldSet.delete(h.ti);
            const rep = pickReplacement(i, heldSet, jumpMode);
            if (rep) {
              const f = T[rep.ti].feat[i];
              next.push({ ti: rep.ti, w: h.w, peak: T[rep.ti].adj[i], trailPct: trailing === "cat" ? trailCat(f?.atr) : trailing === "tight" ? trailTight(f?.atr) : trailing });
              heldSet.add(rep.ti);
            }
            continue;
          }
        }
        next.push(h);
      }
      held = next;
    }

    if ((i - FROM) % review !== 0) continue;
    // revisión: re-pick completo con convicción
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, 10);
    const raws = top.map((c) => Math.max(0.1, c.s - 50));
    const tot = raws.reduce((x, y) => x + y, 0) || 1;
    const pick = top.map((c, j) => ({
      ti: c.ti, w: clamp((raws[j] / tot) * 100, 4, 18),
      peak: T[c.ti].adj[i],
      trailPct: trailing === "cat" ? trailCat(c.f?.atr) : trailing === "tight" ? trailTight(c.f?.atr) : (trailing ?? 0),
    }));
    const oldSet = new Set(held.map((h) => h.ti)), newSet = new Set(pick.map((p) => p.ti));
    let turn = 0;
    for (const ti of newSet) if (!oldSet.has(ti)) turn++;
    for (const ti of oldSet) if (!newSet.has(ti)) turn++;
    if (turn) eq *= 1 - COST_BPS * (turn / 10);
    const peaks = new Map(held.map((h) => [h.ti, h.peak]));
    held = pick.map((p) => ({ ...p, peak: Math.max(peaks.get(p.ti) ?? p.peak, p.peak) }));
  }
  return curve;
}

function evalCurve(curve, FROM) {
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
const CONFIGS = [
  { label: "CAMPEÓN v4 (sin trailing)", trailing: null, jumpMode: null },
  { label: "SERGI: stop cat.→salto IDEAL", trailing: "cat", jumpMode: "ideal" },
  { label: "stop cat.→salto rec.ALTO", trailing: "cat", jumpMode: "alto" },
  { label: "stop cat.→salto mejor score", trailing: "cat", jumpMode: "best" },
  { label: "stop 20%→salto IDEAL", trailing: 0.20, jumpMode: "ideal" },
  { label: "stop ceñido ATR→salto IDEAL", trailing: "tight", jumpMode: "ideal" },
];
const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
console.log("Config".padEnd(30), "9 celdas (peor semestre)".padEnd(72), "mín".padStart(7), "mediana".padStart(8), " ‖ ", "CAGR 260·84".padStart(11), "caída".padStart(7));
const out = [];
for (const cfg of CONFIGS) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const e = evalCurve(portfolio({ review, FROM, trailing: cfg.trailing, jumpMode: cfg.jumpMode }), FROM);
    cells.push(e.worst);
    if (FROM === 260 && review === 84) canon = e;
  }
  const minC = Math.min(...cells), medC = [...cells].sort((a, b) => a - b)[4];
  out.push({ ...cfg, cells, minC, medC, canon });
  console.log(cfg.label.padEnd(30), cells.map((c) => f1(c).padStart(7)).join(" "), f1(minC).padStart(7), f1(medC).padStart(8), " ‖ ", f1(canon.cagr).padStart(11), f1(canon.mdd).padStart(7));
}
const champ = out[0];
console.log("\n=== ¿La estrategia de salto gana al campeón celda a celda? ===");
for (const o of out.slice(1)) {
  let wins = 0;
  for (let i = 0; i < 9; i++) if (o.cells[i] > champ.cells[i]) wins++;
  console.log(`  ${o.label.padEnd(30)} gana ${wins}/9 celdas  ${wins === 9 ? "✅ DOMINA" : wins >= 5 ? "🟡 mixto" : "❌ pierde"}`);
}
fs.writeFileSync("backtests/rally-v4-jump-test.json", JSON.stringify({ ranAt: new Date().toISOString(), out: out.map(({canon,...o})=>({...o,canonCagr:canon.cagr,canonMdd:canon.mdd})) }, null, 1));
console.log("\nGuardado: backtests/rally-v4-jump-test.json");
