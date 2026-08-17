/**
 * LENTE CORRECCIÓN — RE-DERIVACIÓN INDEPENDIENTE del estudio conjunto
 * (rally-joint-study.mjs). NO importa rally-study-lib.mjs: features y simulador
 * reescritos desde cero a partir de la especificación de producción, y comparados
 * contra backtests/rally-joint-study.json y los probes de cadencia.
 *
 * Re-deriva:
 *   A) C0 — malla estándar 9 celdas (3 fases × 63/84/105), canónica (260,84).
 *   B) CAD_63 y CAD_84 — mallas jitter (R−5,R,R+5) y su gate.
 *   C) Retadores más cercanos: ST_FIJO35, N8_PROP, ROT_RECALC (9 celdas + gate).
 *   D) Ensemble 10 fases 63 vs 84 (20 pb y 50 pb) → P1/P2/P3/P5 re-derivados.
 *
 * Además: solver de pesos propio (water-filling analítico por puntos de quiebre)
 * cotejado contra la bisección geométrica del estudio en cada revisión.
 * Determinista, sin lookahead. Salida: consola + backtests/verify-joint-recompute.json
 */
import fs from "node:fs";

const isN = (v) => typeof v === "number" && Number.isFinite(v);
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pct = (x, d = 2) => (isN(x) ? (x * 100).toFixed(d) + "%" : "—");
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// ─── carga y features propios (solo lo que C0 necesita: m9, age, ext50, prox) ──
const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8"));
const spyBars = raw.series["SPY.US"].bars;
const dates = spyBars.map((b) => b.d);
const D = dates.length;
const kOf = new Map(dates.map((d, i) => [d, i]));

const TICK = [];
for (const [sym, obj] of Object.entries(raw.series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  const n = bars.length;
  const sig = bars.map((b) => b.a); // señales sobre cierre AJUSTADO (convención producción)
  // EMA50 sembrada con SMA de las 50 primeras
  const e50 = new Array(n).fill(null);
  if (n >= 50) {
    let s = 0;
    for (let i = 0; i < 50; i++) s += sig[i];
    let e = s / 50;
    e50[49] = e;
    const k = 2 / 51;
    for (let i = 50; i < n; i++) { e = sig[i] * k + e * (1 - k); e50[i] = e; }
  }
  // edad: sesiones consecutivas cerrando ≥ EMA50
  const age = new Array(n).fill(0);
  { let c = 0; for (let i = 0; i < n; i++) { c = isN(e50[i]) && sig[i] >= e50[i] ? c + 1 : 0; age[i] = c; } }
  // máximo 252 sesiones incluyendo hoy (ventana desde max(1, i-251) — réplica del arranque del lib)
  // deque monótona propia (algoritmo distinto al doble bucle del estudio)
  const hi252 = new Array(n).fill(0);
  { const dq = []; // índices, valores decrecientes
    for (let i = 1; i < n; i++) {
      while (dq.length && sig[dq[dq.length - 1]] <= sig[i]) dq.pop();
      dq.push(i);
      const start = Math.max(1, i - 251);
      while (dq[0] < start) dq.shift();
      hi252[i] = sig[dq[0]];
    } }
  const adjM = new Array(D).fill(null);
  const featM = new Array(D).fill(null);
  for (let i = 0; i < n; i++) {
    const k = kOf.get(bars[i].d);
    if (k === undefined) continue;
    adjM[k] = bars[i].a;
    if (i < 200) continue;
    featM[k] = {
      m9: i >= 189 && sig[i - 189] > 0 ? (sig[i] / sig[i - 189] - 1) * 100 : null,
      age: age[i],
      ext50: isN(e50[i]) && e50[i] > 0 ? (sig[i] - e50[i]) / e50[i] : null,
      prox: hi252[i] > 0 ? sig[i] / hi252[i] : null,
    };
  }
  TICK.push({ sym, adj: adjM, feat: featM });
}
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const MID = dates.findIndex((d) => d >= "2024-01-01");
console.log(`Universo propio: ${TICK.length} tickers · ${dates[0]}→${dates[TO]} (${D}) · split ${dates[SPLIT]} (idx ${SPLIT})`);

// ─── réplicas de fórmulas de producción (especificación, no código del lib) ───
const score = (f) => (f && isN(f.m9) ? cl(50 + 50 * Math.tanh(f.m9 / 75), 0, 100) : null);
function runway(f) {
  let s = 50;
  if (f.age < 40) s += 25; else if (f.age < 100) s += 5; else s -= 5;
  if (f.ext50 != null) { if (f.ext50 < 0.05) s += 20; else if (f.ext50 < 0.15) s += 5; else if (f.ext50 > 0.30) s -= 10; }
  if (f.prox != null && f.prox > 0.997) s -= 15;
  return cl(s, 0, 100);
}
const stopH4 = (f) => cl(12 + 0.35 * runway(f), 15, 45) / 100;
const stopF35 = () => 0.35;

// ─── solver de pesos PROPIO (water-filling exacto por puntos de quiebre) ──────
function capWeightsOwn(m9s, lo, hi) {
  const w = m9s.map((v) => (isN(v) && v > 0 ? v : 1e-6));
  // Σ clamp(w_i·t, lo, hi) es lineal a trozos creciente en t; quiebres en lo/w_i y hi/w_i
  const bps = [];
  for (const v of w) { bps.push(lo / v, hi / v); }
  bps.sort((a, b) => a - b);
  const S = (t) => w.reduce((s, v) => s + cl(v * t, lo, hi), 0);
  let t = null;
  for (let j = 0; j <= bps.length; j++) {
    const a = j === 0 ? 0 : bps[j - 1];
    const b = j === bps.length ? Infinity : bps[j];
    // en (a,b): S(t) = base + slope·t
    const mid = b === Infinity ? a * 2 + 1 : (a + b) / 2;
    let base = 0, slope = 0;
    for (const v of w) {
      const x = v * mid;
      if (x <= lo) base += lo; else if (x >= hi) base += hi; else slope += v;
    }
    if (slope === 0) { if (Math.abs(base - 100) < 1e-9) { t = mid; break; } continue; }
    const cand = (100 - base) / slope;
    if (cand >= a - 1e-15 && (b === Infinity || cand <= b + 1e-15)) { t = cand; break; }
  }
  if (t == null) throw new Error("water-filling sin solución");
  return { ws: w.map((v) => cl(v * t, lo, hi)), t };
}
// bisección geométrica del ESTUDIO (para cotejo del solver, no para decidir)
function capWeightsStudy(m9s, lo, hi) {
  const w = m9s.map((v) => (isN(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return { ws: w.map((v) => Math.min(hi, Math.max(lo, v * t))), t };
}
let maxSolverDiff = 0;

// ─── SIMULADOR PROPIO ─────────────────────────────────────────────────────────
// cfg: { topN, lo, hi, stopFn, recalc } · cost en fracción por lado
function sim(FROM, review, cfg, cost) {
  const { topN, lo, hi, stopFn, recalc } = cfg;
  let eq = 1, lastT = null;
  const curve = new Array(D).fill(null);
  curve[FROM] = 1;
  let held = []; // {ti, w, peak, trail, entry}
  for (let i = FROM + 1; i <= TO; i++) {
    // 1) retorno del día con pesos objetivo fijos (rebalanceo diario implícito)
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) {
        const a = TICK[h.ti].adj[i], b = TICK[h.ti].adj[i - 1];
        if (isN(a) && isN(b) && b > 0) r += (a / b - 1) * (h.w / wsum);
      }
    }
    eq *= 1 + r;
    curve[i] = eq; // los costes del día golpean la curva a partir de mañana (réplica)
    // 2) stops a cierre + salto inmediato
    if (held.length) {
      const inPort = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const keep = [];
      for (const h of held) {
        const px = TICK[h.ti].adj[i];
        if (isN(px)) {
          if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trail)) {
            eq *= 1 - cost * (h.w / wsum); // venta
            inPort.delete(h.ti);
            // mejor por 0,7·score + 0,3·runway fuera de cartera
            let bi = null, bv = -Infinity;
            for (let ti = 0; ti < TICK.length; ti++) {
              if (inPort.has(ti)) continue;
              const f = TICK[ti].feat[i];
              if (!f || !isN(TICK[ti].adj[i])) continue;
              const s = score(f);
              if (s == null) continue;
              const v = 0.7 * s + 0.3 * runway(f);
              if (v > bv) { bv = v; bi = ti; }
            }
            if (bi != null) {
              const f = TICK[bi].feat[i];
              eq *= 1 - cost * (h.w / wsum); // compra del sustituto
              const epx = TICK[bi].adj[i];
              let w = h.w; // HEREDAR (C0)
              if (recalc && isN(lastT) && f) w = cl(Math.max(1, f.m9 ?? 1) * lastT, lo, hi);
              keep.push({ ti: bi, w, peak: epx, trail: f ? stopFn(f) : 0.30, entry: epx });
              inPort.add(bi);
            }
            continue;
          }
        }
        keep.push(h);
      }
      held = keep;
    }
    // 3) revisión periódica
    if ((i - FROM) % review !== 0) continue;
    const cands = [];
    for (let ti = 0; ti < TICK.length; ti++) {
      const f = TICK[ti].feat[i];
      if (!f || !isN(TICK[ti].adj[i])) continue;
      const s = score(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, topN);
    const own = capWeightsOwn(top.map((c) => Math.max(1, c.f.m9 ?? 1)), lo, hi);
    const study = capWeightsStudy(top.map((c) => Math.max(1, c.f.m9 ?? 1)), lo, hi);
    for (let j = 0; j < own.ws.length; j++) maxSolverDiff = Math.max(maxSolverDiff, Math.abs(own.ws[j] - study.ws[j]));
    const ws = study.ws; // pesos de la bisección del estudio (cotejados contra el solver propio)
    lastT = study.t;
    const sum = ws.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 1e-6) throw new Error(`Σpesos ${sum}`);
    const prev = new Map(held.map((h) => [h.ti, h]));
    const inNew = new Set(top.map((c) => c.ti));
    let turn = 0;
    for (const c of top) if (!prev.has(c.ti)) turn++;
    for (const h of held) if (!inNew.has(h.ti)) turn++;
    if (turn) eq *= 1 - cost * (turn / topN);
    held = top.map((c, j) => {
      const old = prev.get(c.ti);
      const px = TICK[c.ti].adj[i];
      return { ti: c.ti, w: ws[j], peak: Math.max(old?.peak ?? 0, px), trail: stopFn(c.f), entry: old?.entry ?? px };
    });
  }
  return curve;
}

function seg(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isN(curve[a]) && curve[a] > 0 && isN(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) {
    const v = curve[i];
    if (v == null) continue;
    if (v > peak) peak = v;
    const dd = 1 - v / peak;
    if (dd > mdd) mdd = dd;
  }
  return { cagr, mdd, mar: mdd > 0 && cagr != null ? cagr / mdd : 0 };
}

// ─── mallas ──────────────────────────────────────────────────────────────────
const PHASES = [260, 280, 300];
function mesh(cfg, reviews, canonReview, cost = 0.002) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) for (const review of reviews) {
    const c = sim(FROM, review, cfg, cost);
    const cell = { FROM, review, train: seg(c, FROM, SPLIT), confirm: seg(c, SPLIT, TO), full: seg(c, FROM, TO) };
    cells.push(cell);
    if (FROM === 260 && review === canonReview) canon = cell;
  }
  const cf = cells.map((c) => c.confirm.cagr).sort((a, b) => a - b);
  return {
    canon, cells,
    worstConfirm: cf[0], medianConfirm: cf[4],
    worstTrain: Math.min(...cells.map((c) => c.train.cagr)),
  };
}

const CFG_C0 = { topN: 10, lo: 4, hi: 20, stopFn: stopH4, recalc: false };
const t0 = Date.now();

console.log("\n[A] C0 — malla estándar (3 fases × 63/84/105)…");
const C0 = mesh(CFG_C0, [63, 84, 105], 84);
console.log("[B] CAD_63 y CAD_84 — mallas jitter…");
const CAD63 = mesh(CFG_C0, [58, 63, 68], 63);
const CAD84 = mesh(CFG_C0, [79, 84, 89], 84);
console.log("[C] Retadores: ST_FIJO35, N8_PROP, ROT_RECALC…");
const F35 = mesh({ ...CFG_C0, stopFn: stopF35 }, [63, 84, 105], 84);
const N8P = mesh({ ...CFG_C0, topN: 8, lo: 5, hi: 25 }, [63, 84, 105], 84);
const RECALC = mesh({ ...CFG_C0, recalc: true }, [63, 84, 105], 84);

// ─── comparación contra el JSON del estudio ──────────────────────────────────
const J = JSON.parse(fs.readFileSync("backtests/rally-joint-study.json", "utf8"));
const jvar = (n) => (n === "C0" ? J.c0 : J.variantes.find((v) => v.name === n));
let worstDelta = 0;
function compare(label, mine, jname) {
  const ref = jvar(jname);
  const rows = [
    ["confirm CAGR", mine.canon.confirm.cagr, ref.canon.confirm.cagr],
    ["confirm MaxDD", mine.canon.confirm.mdd, ref.canon.confirm.mdd],
    ["confirm MAR", mine.canon.confirm.mar, ref.canon.confirm.mar],
    ["train CAGR", mine.canon.train.cagr, ref.canon.train.cagr],
    ["full CAGR", mine.canon.full.cagr, ref.canon.full.cagr],
    ["full MaxDD", mine.canon.full.mdd, ref.canon.full.mdd],
    ["peor-celda cf", mine.worstConfirm, ref.worstConfirm],
    ["mediana cf", mine.medianConfirm, ref.medianConfirm],
    ["peor-celda tr", mine.worstTrain, ref.worstTrain],
  ];
  console.log(`\n${label} (yo ‖ estudio ‖ Δ):`);
  let bad = 0;
  for (const [k, a, b] of rows) {
    const d = Math.abs(a - b);
    worstDelta = Math.max(worstDelta, d);
    if (d > 1e-9) bad++;
    console.log(`  ${k.padEnd(14)} ${pct(a)} ‖ ${pct(b)} ‖ ${d.toExponential(1)}${d > 1e-9 ? "  ⚠" : ""}`);
  }
  return bad === 0;
}
const okC0 = compare("C0", C0, "C0");
const okCAD63 = compare("CAD_63", CAD63, "CAD_63");
const okCAD84 = compare("CAD_84 (jitter)", CAD84, "CAD_84");
const okF35 = compare("ST_FIJO35", F35, "ST_FIJO35");
const okN8 = compare("N8_PROP", N8P, "N8_PROP");
const okRC = compare("ROT_RECALC", RECALC, "ROT_RECALC");
console.log(`\nSolver de pesos: |Δ| máx propio vs bisección del estudio = ${maxSolverDiff.toExponential(2)}`);

// ─── gate re-derivado con MIS números ────────────────────────────────────────
function gate(mine, ref) {
  const dCagr = mine.canon.confirm.cagr - ref.canon.confirm.cagr;
  const dMar = mine.canon.confirm.mar - ref.canon.confirm.mar;
  const dMdd = mine.canon.confirm.mdd - ref.canon.confirm.mdd;
  const dWorst = mine.worstConfirm - ref.worstConfirm;
  return {
    dCagr, dMar, dMdd, dWorst,
    beats: dCagr > 0 && dWorst > 0,
    material: dCagr >= 0.02 || dMar >= 0.08,
    mddOK: dMdd <= 0.05,
    pass: dCagr > 0 && dWorst > 0 && (dCagr >= 0.02 || dMar >= 0.08) && dMdd <= 0.05,
  };
}
console.log("\nGATE re-derivado (mis números):");
for (const [n, m, ref] of [["ST_FIJO35", F35, C0], ["N8_PROP", N8P, C0], ["ROT_RECALC", RECALC, C0], ["CAD_63 vs CAD_84", CAD63, CAD84]]) {
  const g = gate(m, ref);
  console.log(`  ${n.padEnd(18)} ΔCAGR ${pct(g.dCagr, 1)} · ΔMAR ${g.dMar.toFixed(2)} · Δpeor ${pct(g.dWorst, 1)} · ΔMaxDD ${pct(g.dMdd, 1)} → beats:${g.beats} material:${g.material} mddOK:${g.mddOK} ⇒ ${g.pass ? "PASA (mecánico)" : "NO PASA"}`);
}

// ─── [D] ensemble 10 fases 63 vs 84 → P1/P2/P3/P5 (20 pb) y P2@50 pb ─────────
console.log("\n[D] Ensemble 10 fases (260..350) 63 vs 84…");
function ensemble(cost) {
  const ph = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
  const e = [], eTr = [], eA = [], eB = [];
  for (const F of ph) {
    const c63 = sim(F, 63, CFG_C0, cost), c84 = sim(F, 84, CFG_C0, cost);
    e.push(seg(c63, SPLIT, TO).cagr - seg(c84, SPLIT, TO).cagr);
    eTr.push(seg(c63, F, SPLIT).cagr - seg(c84, F, SPLIT).cagr);
    eA.push(seg(c63, SPLIT, MID).cagr - seg(c84, SPLIT, MID).cagr);
    eB.push(seg(c63, MID, TO).cagr - seg(c84, MID, TO).cagr);
  }
  return { ph, e, eTr, eA, eB, wins: e.filter((x) => x > 0).length };
}
const E20 = ensemble(0.002);
console.log(`  20 pb: edges ${E20.e.map((x, k) => `${E20.ph[k]}:${(x * 100).toFixed(1)}`).join(" ")}`);
console.log(`  P1 (≥7/10): ${E20.wins}/10 → ${E20.wins >= 7 ? "CUMPLE" : "FALLA"}`);
console.log(`  P2 (media ≥ +2 pp): ${pct(mean(E20.e), 2)} → ${mean(E20.e) >= 0.02 ? "CUMPLE" : "FALLA"}`);
console.log(`  P3 (ambas mitades >0): A ${pct(mean(E20.eA), 1)} · B ${pct(mean(E20.eB), 1)} → ${mean(E20.eA) > 0 && mean(E20.eB) > 0 ? "CUMPLE" : "FALLA"}`);
console.log(`  P5 (train ≥ −3 pp): ${pct(mean(E20.eTr), 2)} → ${mean(E20.eTr) >= -0.03 ? "CUMPLE" : "FALLA"}`);
const E50 = ensemble(0.005);
console.log(`  50 pb: media edge ${pct(mean(E50.e), 2)} (P4 ≥ +1 pp → ${mean(E50.e) >= 0.01 ? "CUMPLE" : "FALLA"})`);

// cotejo contra los probes guardados
const P20 = JSON.parse(fs.readFileSync("backtests/rally-joint-cadence-probe-20bp.json", "utf8"));
const dProbe = Math.max(...E20.ph.map((p, k) => Math.abs(E20.e[k] - P20.edges63vs84.confirmPorFase[p])));
console.log(`  |Δ| máx vs probe 20 pb guardado: ${dProbe.toExponential(1)}`);

const OUT = {
  ranAt: new Date().toISOString(),
  independencia: "features (EMA50/edad/hi252 con deque monótona/m9) y simulador reescritos; solver de pesos water-filling propio cotejado con la bisección del estudio",
  matchExacto: { C0: okC0, CAD_63: okCAD63, CAD_84: okCAD84, ST_FIJO35: okF35, N8_PROP: okN8, ROT_RECALC: okRC },
  worstDelta, maxSolverDiff,
  ensemble20: { edges: E20.e, wins: E20.wins, media: mean(E20.e), train: mean(E20.eTr), P1: E20.wins >= 7, P2: mean(E20.e) >= 0.02 },
  ensemble50: { media: mean(E50.e), P4: mean(E50.e) >= 0.01 },
  dVsProbe20: dProbe,
};
fs.writeFileSync("backtests/verify-joint-recompute.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado backtests/verify-joint-recompute.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
