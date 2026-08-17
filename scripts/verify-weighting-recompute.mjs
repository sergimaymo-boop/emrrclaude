/**
 * VERIFICACIÓN INDEPENDIENTE del estudio de ponderación (rally-weighting-study.mjs)
 * =================================================================================
 * Re-deriva desde cero (simulador PROPIO escrito desde la especificación, no el
 * simulate() del lib) las cifras clave de ACTUAL y M9_RAW en:
 *   · celda canónica (fase 260, rev 84)  — train / confirmación / full
 *   · celda 300/105                      — la peor-celda de confirmación reclamada
 * y además:
 *   · capNormalize re-derivado por WATERFILLING exacto (KKT) vs la bisección del estudio
 *   · probe anti-lookahead: pesos calculados con rasgos retrasados 1 sesión (si el
 *     resultado apenas cambia de forma coherente y no hay salto, no hay fuga del futuro)
 *   · año a año desde mis propias curvas
 * Solo reutiliza del lib: loadUniverse (datos) y las réplicas de fórmulas de
 * producción (scoreV4, runwayScore, convictionWeights, clamp, isNum).
 */
import {
  loadUniverse, scoreV4, runwayScore, convictionWeights, isNum, clamp,
} from "./rally-study-lib.mjs";

const COST = 20 / 1e4;
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Universo: ${T.length} tickers · ${dates[0]} → ${dates.at(-1)} (${D} sesiones) · split idx ${SPLIT} = ${dates[SPLIT]}`);

// ── mi capNormalize: waterfilling exacto por KKT (algoritmo DISTINTO a la bisección) ──
// Resuelve w_i = clamp(raw_i·t, lo, hi), Σw=100. Itera: fija violadores en su tope y
// re-resuelve t con los libres. Converge en ≤ n pasadas (monótono en t).
function capWaterfill(raw, lo = 4, hi = 20) {
  const n = raw.length;
  const v = raw.map((x) => (isNum(x) && x > 0 ? x : 1e-6));
  let atLo = new Set(), atHi = new Set();
  for (let pass = 0; pass < n + 2; pass++) {
    let fixed = atLo.size * lo + atHi.size * hi, free = 0;
    for (let i = 0; i < n; i++) if (!atLo.has(i) && !atHi.has(i)) free += v[i];
    const t = free > 0 ? (100 - fixed) / free : 0;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (atLo.has(i) || atHi.has(i)) continue;
      if (v[i] * t < lo) { atLo.add(i); changed = true; }
      else if (v[i] * t > hi) { atHi.add(i); changed = true; }
    }
    if (!changed) return v.map((x, i) => (atLo.has(i) ? lo : atHi.has(i) ? hi : x * t));
  }
  throw new Error("waterfill no converge");
}

// ── réplica INDEPENDIENTE de la bisección del estudio, para contraste directo ──
function capBisect(raw, lo = 4, hi = 20) {
  const w = raw.map((x) => (isNum(x) && x > 0 ? x : 1e-6));
  const f = (t) => w.reduce((s, x) => s + Math.min(hi, Math.max(lo, x * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return w.map((x) => Math.min(hi, Math.max(lo, x * t)));
}

// contraste waterfill vs bisección sobre 500 vectores pseudo-reales (m9 de fechas reales)
{
  let worst = 0, cases = 0;
  for (let i = 400; i < D; i += Math.max(1, Math.floor(D / 500))) {
    const ms = [];
    for (const t of T) { const f = t.feat[i]; if (f && isNum(f.m9)) ms.push(Math.max(1, f.m9)); }
    ms.sort((a, b) => b - a);
    const top = ms.slice(0, 10);
    if (top.length < 10) continue;
    const a = capWaterfill(top), b = capBisect(top);
    for (let j = 0; j < 10; j++) worst = Math.max(worst, Math.abs(a[j] - b[j]));
    const sa = a.reduce((x, y) => x + y, 0);
    if (Math.abs(sa - 100) > 1e-9) throw new Error(`waterfill no suma 100: ${sa}`);
    cases++;
  }
  console.log(`capNormalize: waterfilling KKT vs bisección — ${cases} vectores reales, Δmax por peso = ${worst.toExponential(2)}`);
}

// ── fórmulas de la estrategia (desde la especificación, no copiadas del runCell) ──
const stopPct = (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45) / 100;
const wActual = (top) => convictionWeights(top.map((c) => c.s));
const wM9 = (top) => capWaterfill(top.map((c) => Math.max(1, c.f.m9 ?? 1)));

// ── MI simulador, escrito desde la especificación ──
// lagFeat=1 → probe anti-lookahead: los PESOS se calculan con los rasgos de i-1
function mySim(FROM, review, weightFn, { lagFeat = 0 } = {}) {
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let held = []; // {ti, w, peak, trail, entryPx}
  for (let i = FROM + 1; i <= TO; i++) {
    // 1) retorno del día con pesos objetivo fijos (rebalanceo diario implícito)
    let r = 0;
    const wsum0 = held.reduce((s, h) => s + h.w, 0) || 1;
    for (const h of held) {
      const a = T[h.ti].adj[i], b = T[h.ti].adj[i - 1];
      if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum0);
    }
    eq *= 1 + r; curve[i] = eq;
    // 2) stops diarios + salto inmediato por 0,7·score+0,3·runway
    if (held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const keep = [];
      for (const h of held) {
        const px = T[h.ti].adj[i];
        if (isNum(px)) {
          if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trail)) {
            eq *= 1 - COST * (h.w / wsum);
            heldSet.delete(h.ti);
            let bi = null, bv = -Infinity;
            for (let ti = 0; ti < T.length; ti++) {
              if (heldSet.has(ti)) continue;
              const f = T[ti].feat[i];
              if (!f || !isNum(T[ti].adj[i])) continue;
              const s = scoreV4(f);
              if (s == null) continue;
              const v = 0.7 * s + 0.3 * runwayScore(f);
              if (v > bv) { bv = v; bi = ti; }
            }
            if (bi != null) {
              const epx = T[bi].adj[i];
              eq *= 1 - COST * (h.w / wsum);
              keep.push({ ti: bi, w: h.w, peak: epx, trail: stopPct(T[bi].feat[i]), entryPx: epx });
              heldSet.add(bi);
            }
            continue;
          }
        }
        keep.push(h);
      }
      held = keep;
    }
    // 3) revisión cada `review` sesiones
    if ((i - FROM) % review !== 0) continue;
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const f = T[ti].feat[i];
      if (!f || !isNum(T[ti].adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, 10);
    // pesos: con rasgos del día i (o de i-lagFeat en el probe anti-lookahead)
    const topW = lagFeat
      ? top.map((c) => ({ ...c, f: T[c.ti].feat[i - lagFeat] ?? c.f, s: scoreV4(T[c.ti].feat[i - lagFeat] ?? c.f) ?? c.s }))
      : top;
    const ws = weightFn(topW);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 1e-6) throw new Error(`pesos suman ${sum}`);
    const prev = new Map(held.map((h) => [h.ti, h]));
    const newSet = new Set(top.map((c) => c.ti));
    let turn = 0;
    for (const c of top) if (!prev.has(c.ti)) turn++;
    for (const h of held) if (!newSet.has(h.ti)) turn++;
    if (turn) eq *= 1 - COST * (turn / 10);
    held = top.map((c, j) => {
      const old = prev.get(c.ti);
      return {
        ti: c.ti, w: ws[j],
        peak: Math.max(old?.peak ?? 0, T[c.ti].adj[i]),
        trail: stopPct(c.f),
        entryPx: old?.entryPx ?? T[c.ti].adj[i],
      };
    });
  }
  return curve;
}

// ── métricas de tramo, re-derivadas ──
function seg(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = Math.pow(curve[b] / curve[a], 1 / y) - 1;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; mdd = Math.max(mdd, 1 - v / peak); }
  return { cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0 };
}
const pf = (x) => (x * 100).toFixed(1) + "%";

// ── celdas a verificar: canónica 260/84 y la peor-celda reclamada 300/105 ──
const CLAIM = {
  "ACTUAL@260/84": { train: 0.464, cf: 0.362, cfMdd: 0.344, cfMar: 1.05, full: 0.411, fullMdd: 0.369, fullMar: 1.11 },
  "M9_RAW@260/84": { train: 0.507, cf: 0.449, cfMdd: 0.361, cfMar: 1.24, full: 0.477, fullMdd: 0.377, fullMar: 1.27 },
  "ACTUAL@300/105": { cf: 0.379 },
  "M9_RAW@300/105": { cf: 0.423 },
};
const out = {};
for (const [tag, FROM, rev, fn] of [
  ["ACTUAL@260/84", 260, 84, wActual], ["M9_RAW@260/84", 260, 84, wM9],
  ["ACTUAL@300/105", 300, 105, wActual], ["M9_RAW@300/105", 300, 105, wM9],
]) {
  const c = mySim(FROM, rev, fn);
  out[tag] = { curve: c, train: seg(c, FROM, SPLIT), cf: seg(c, SPLIT, TO), full: seg(c, FROM, TO) };
  const o = out[tag], cl = CLAIM[tag];
  console.log(`\n${tag}  (mi simulador independiente)`);
  console.log(`  train  CAGR ${pf(o.train.cagr)}${cl.train != null ? ` (reclamado ${pf(cl.train)})` : ""}`);
  console.log(`  confir CAGR ${pf(o.cf.cagr)} · MaxDD ${pf(o.cf.mdd)} · MAR ${o.cf.mar.toFixed(2)}${cl.cf != null ? ` (reclamado ${pf(cl.cf)}${cl.cfMdd ? ` / ${pf(cl.cfMdd)} / ${cl.cfMar}` : ""})` : ""}`);
  console.log(`  full   CAGR ${pf(o.full.cagr)} · MaxDD ${pf(o.full.mdd)} · MAR ${o.full.mar.toFixed(2)}${cl.full != null ? ` (reclamado ${pf(cl.full)} / ${pf(cl.fullMdd)} / ${cl.fullMar})` : ""}`);
}

// ── deltas del GATE re-derivados (confirmación, canónica + peor celda) ──
{
  const A = out["ACTUAL@260/84"], M = out["M9_RAW@260/84"];
  console.log(`\nGATE re-derivado: ΔCAGR cf ${pf(M.cf.cagr - A.cf.cagr)} (reclamado +8,7 pp) · ΔMaxDD ${pf(M.cf.mdd - A.cf.mdd)} (reclamado +1,6 pp) · ΔMAR ${(M.cf.mar - A.cf.mar).toFixed(2)} (reclamado +0,19)`);
}

// ── año a año desde MIS curvas ──
{
  const A = out["ACTUAL@260/84"].curve, M = out["M9_RAW@260/84"].curve;
  let wins = 0, n = 0;
  console.log("\nAño a año (mis curvas):");
  for (let y = 2018; y <= 2026; y++) {
    const a = dates.findIndex((d) => d >= `${y}-01-01`);
    const b = y < 2026 ? dates.findIndex((d) => d >= `${y + 1}-01-01`) - 1 : TO;
    if (a <= 260 || b <= a) continue;
    const ra = A[b] / A[a] - 1, rm = M[b] / M[a] - 1;
    n++; if (rm > ra) wins++;
    console.log(`  ${y}: ACTUAL ${pf(ra)} · M9_RAW ${pf(rm)} ${rm > ra ? "← M9 gana" : ""}`);
  }
  console.log(`  M9_RAW bate a ACTUAL en ${wins}/${n} años (reclamado 7/9)`);
}

// ── probe anti-lookahead: pesos con rasgos de i-1 (si hubiera fuga, el lag la rompería) ──
{
  const lag = mySim(260, 84, wM9, { lagFeat: 1 });
  const s = seg(lag, SPLIT, TO);
  console.log(`\nProbe anti-lookahead (pesos M9 con m9 de la sesión ANTERIOR): confirmación CAGR ${pf(s.cagr)} (sin lag ${pf(out["M9_RAW@260/84"].cf.cagr)}) — una diferencia pequeña y no sistemática indica ausencia de fuga`);
}
console.log("\nOK verificación completada.");
