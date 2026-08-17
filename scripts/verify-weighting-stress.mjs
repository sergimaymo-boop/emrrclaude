/**
 * RALLY — VERIFICACIÓN DE ROBUSTEZ (lente adversarial) del veredicto del
 * estudio de ponderación (backtests/rally-weighting-study.json → M9_RAW).
 * ============================================================================
 * Pruebas:
 *  A) SUB-MITADES de la confirmación 2022-26 (mitad temporal y corte 2024-01):
 *     ¿M9_RAW bate a ACTUAL en ambas mitades, en las 9 celdas?
 *  B) SENSIBILIDAD A LOS CAPS: malla de topes [lo,hi] alrededor del [4,20]
 *     elegido. ¿El exceso depende de un cap concreto?
 *  C) SENSIBILIDAD A LA FECHA DE INICIO: FROM = 240…300 (paso 4, 16 fases que
 *     desplazan TODAS las fechas de revisión). Confirmación fija SPLIT→TO.
 *  D) CONCENTRACIÓN DEL EXCESO: descomposición EXACTA del retorno diario
 *     (misma selección de tickers entre esquemas ⇒ exceso_t = Σ Δw_i·ret_i),
 *     contribución por ticker y por año, y leave-one-out real (re-simulación
 *     sin los 3 mayores contribuidores, de uno en uno).
 *  E) CADENCIA ±20: revisión 64 y 104 (84±20, puntos NUEVOS fuera de la malla
 *     63/105 del estudio): ¿se mantiene el orden de esquemas?
 *
 * Todo determinista, sin lookahead, señales ajustadas (convención del estudio).
 * El simulador instrumentado se valida Δmax=0 contra simulate() de la librería.
 * Salida: backtests/rally-weighting-stress.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, scoreV4, runwayScore, entryZone,
  convictionWeights, isNum, clamp, f1, mean, spearman, COST_BPS,
} from "./rally-study-lib.mjs";

const t0 = Date.now();
console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const MID = Math.floor((SPLIT + TO) / 2);          // mitad temporal de la confirmación
const IDX2024 = dates.findIndex((d) => d >= "2024-01-01");
console.log(`Tickers ${T.length} · ${dates[0]} → ${dates[TO]} · SPLIT ${dates[SPLIT]} · MID ${dates[MID]} · 2024 ${dates[IDX2024]}\n`);

// ─── estrategia fija (réplica exacta del estudio) ────────────────────────────
const stopH4pct = (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45);
const H4 = (f) => stopH4pct(f) / 100;
const mkJump = (TT) => (i, heldSet) => {
  let bi = null, bv = -Infinity;
  for (let ti = 0; ti < TT.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = TT[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s == null) continue;
    const v = 0.7 * s + 0.3 * runwayScore(f);
    if (v > bv) { bv = v; bi = ti; }
  }
  return bi;
};
const jumpMezcla = mkJump(T);

function capNormalize(raw, lo = 4, hi = 20) {
  const n = raw.length;
  if (!n) return [];
  const w = raw.map((v) => (isNum(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return w.map((v) => Math.min(hi, Math.max(lo, v * t)));
}

const ZONA_MAX = { IDEAL: 1.25, EN_MAXIMOS: 2.0, LEJOS: 0.75 };
const SCHEMES = {
  EQUAL: (top) => top.map(() => 100 / top.length),
  ACTUAL: (top) => convictionWeights(top.map((c) => c.s)),
  TOP5_CONC: (top) => capNormalize(top.map((_, j) => (j < 5 ? 12 : 8))),
  SCORE_POW2: (top) => capNormalize(top.map((c) => Math.max(0.1, c.s - 50) ** 2)),
  SCORE_POW3: (top) => capNormalize(top.map((c) => Math.max(0.1, c.s - 50) ** 3)),
  M9_SQRT: (top) => capNormalize(top.map((c) => Math.sqrt(Math.max(1, c.f.m9 ?? 1)))),
  M9_RAW_CAP15: (top) => capNormalize(top.map((c) => Math.max(1, c.f.m9 ?? 1)), 4, 15),
  M9_RAW: (top) => capNormalize(top.map((c) => Math.max(1, c.f.m9 ?? 1))),
  RANK_LIN: (top) => capNormalize(top.map((_, j) => top.length - j)),
  INV_VOL: (top) => capNormalize(top.map((c) => 1 / Math.max(0.5, isNum(c.f.atrProd) ? c.f.atrProd : isNum(c.f.atr) ? c.f.atr : 3))),
  TIMING_MAXIMOS: (top) => capNormalize(top.map((c) => ZONA_MAX[entryZone(c.f)] ?? 1)),
};

function segMetrics(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > mdd) mdd = dd; }
  return { cagr, mdd, mar: mdd > 0 && cagr != null ? cagr / mdd : 0 };
}
const run = (fn, FROM, review, TT = T, jump = null) =>
  simulate(TT, D, { FROM, review, conviction: true, widthOf: H4, pickJump: jump ?? (TT === T ? jumpMezcla : mkJump(TT)), weightsOf: (top, i) => fn(top, i) });

// ─── simulador INSTRUMENTADO (copia de lib con hook diario; validado Δmax=0) ─
function simulateInstr(TT, DD, opts, onDay) {
  const { FROM, TO: TOo = DD - 1, review = 84, topN = 10, widthOf = null, pickJump = null, scoreFn = scoreV4, weightsOf = null } = opts;
  let eq = 1;
  const curve = new Array(DD).fill(null); curve[FROM] = 1;
  let held = [];
  for (let i = FROM + 1; i <= TOo; i++) {
    let r = 0;
    const day = [];
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) {
        const t = TT[h.ti]; const a = t.adj[i], b = t.adj[i - 1];
        const ret = isNum(a) && isNum(b) && b > 0 ? a / b - 1 : 0;
        r += ret * (h.w / wsum);
        day.push({ ti: h.ti, share: h.w / wsum, ret });
      }
    }
    eq *= 1 + r; curve[i] = eq;
    if (onDay) onDay(i, day, r);
    if (widthOf && held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const next = [];
      for (const h of held) {
        const t = TT[h.ti]; const px = t.adj[i];
        if (isNum(px)) {
          if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trailPct)) {
            eq *= 1 - COST_BPS * (h.w / wsum);
            heldSet.delete(h.ti);
            if (pickJump) {
              const rep = pickJump(i, heldSet);
              if (rep != null) {
                const f = TT[rep].feat[i];
                const w0 = f ? widthOf(f, { gain: 0, peakGain: 0 }) : null;
                eq *= 1 - COST_BPS * (h.w / wsum);
                const epx = TT[rep].adj[i];
                next.push({ ti: rep, w: h.w, peak: epx, trailPct: isNum(w0) ? w0 : 0.30, entryPx: epx });
                heldSet.add(rep);
              }
            }
            continue;
          }
        }
        next.push(h);
      }
      held = next;
    }
    const doReview = review == null ? i === FROM + 1 : (i - FROM) % review === 0;
    if (!doReview) continue;
    const cands = [];
    for (let ti = 0; ti < TT.length; ti++) {
      const t = TT[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreFn(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, topN);
    const ws = weightsOf(top, i);
    const prev = new Map(held.map((h) => [h.ti, h]));
    const newSet = new Set(top.map((c) => c.ti));
    let turn = 0;
    for (const c of top) if (!prev.has(c.ti)) turn++;
    for (const h of held) if (!newSet.has(h.ti)) turn++;
    if (turn) eq *= 1 - COST_BPS * (turn / Math.max(topN, 1));
    held = top.map((c, j) => {
      const old = prev.get(c.ti);
      const w0 = widthOf ? widthOf(c.f, { gain: 0, peakGain: 0 }) : null;
      return { ti: c.ti, w: ws[j], peak: Math.max(old?.peak ?? 0, TT[c.ti].adj[i]), trailPct: isNum(w0) ? w0 : 0.30, entryPx: old?.entryPx ?? TT[c.ti].adj[i] };
    });
  }
  return { curve };
}

const OUT = { ranAt: new Date().toISOString(), objeto: "estrés del veredicto M9_RAW (rally-weighting-study.json)" };

// ─── control de regresión: instrumentado ≡ librería, para ACTUAL y M9_RAW ────
{
  for (const n of ["ACTUAL", "M9_RAW"]) {
    const a = run(SCHEMES[n], 260, 84);
    const b = simulateInstr(T, D, { FROM: 260, review: 84, widthOf: H4, pickJump: jumpMezcla, weightsOf: SCHEMES[n] }, null);
    let dmax = 0;
    for (let i = 260; i <= TO; i++) dmax = Math.max(dmax, Math.abs((a.curve[i] ?? 0) - (b.curve[i] ?? 0)));
    if (dmax > 1e-12) throw new Error(`instrumentado ≠ librería para ${n} (Δmax ${dmax})`);
  }
  console.log("Control de regresión: simulador instrumentado ≡ simulate() de la librería (Δmax 0) para ACTUAL y M9_RAW. OK\n");
}

// ─── A) sub-mitades de la confirmación, en las 9 celdas ──────────────────────
console.log("═══ A) SUB-MITADES DE LA CONFIRMACIÓN (M9_RAW vs ACTUAL, 9 celdas) ═══");
console.log(["Celda".padEnd(9), "H1 ACT".padStart(8), "H1 M9".padStart(8), "ΔH1".padStart(7), "‖ H2 ACT".padStart(9), "H2 M9".padStart(8), "ΔH2".padStart(7), "‖ 22-23Δ".padStart(9), "24-26Δ".padStart(8)].join(" "));
OUT.subMitades = [];
let winH1 = 0, winH2 = 0, winA = 0, winB = 0;
for (const FROM of [260, 280, 300]) for (const review of [63, 84, 105]) {
  const cA = run(SCHEMES.ACTUAL, FROM, review).curve;
  const cM = run(SCHEMES.M9_RAW, FROM, review).curve;
  const h1A = segMetrics(cA, SPLIT, MID).cagr, h1M = segMetrics(cM, SPLIT, MID).cagr;
  const h2A = segMetrics(cA, MID, TO).cagr, h2M = segMetrics(cM, MID, TO).cagr;
  const aA = segMetrics(cA, SPLIT, IDX2024).cagr, aM = segMetrics(cM, SPLIT, IDX2024).cagr;
  const bA = segMetrics(cA, IDX2024, TO).cagr, bM = segMetrics(cM, IDX2024, TO).cagr;
  if (h1M > h1A) winH1++; if (h2M > h2A) winH2++; if (aM > aA) winA++; if (bM > bA) winB++;
  OUT.subMitades.push({ FROM, review, h1: { act: h1A, m9: h1M }, h2: { act: h2A, m9: h2M }, y2223: { act: aA, m9: aM }, y2426: { act: bA, m9: bM } });
  console.log([`${FROM}/${review}`.padEnd(9), f1(h1A).padStart(8), f1(h1M).padStart(8), f1(h1M - h1A).padStart(7),
    f1(h2A).padStart(9), f1(h2M).padStart(8), f1(h2M - h2A).padStart(7), f1(aM - aA).padStart(9), f1(bM - bA).padStart(8)].join(" "));
}
OUT.subMitadesResumen = { m9GanaH1: `${winH1}/9`, m9GanaH2: `${winH2}/9`, m9Gana2223: `${winA}/9`, m9Gana2426: `${winB}/9` };
console.log(`M9_RAW gana: H1 (${dates[SPLIT]}→${dates[MID]}) ${winH1}/9 · H2 (${dates[MID]}→${dates[TO]}) ${winH2}/9 · 2022-23 ${winA}/9 · 2024-26 ${winB}/9`);

// ─── B) sensibilidad a los caps ──────────────────────────────────────────────
console.log("\n═══ B) SENSIBILIDAD A LOS CAPS de M9_RAW (celda canónica 260/84) ═══");
const CAPS = [[4, 20], [4, 15], [4, 18], [4, 25], [4, 30], [3, 20], [5, 20], [6, 20], [4, 12], [0.01, 20], [0.5, 60]];
const ACTcanon = run(SCHEMES.ACTUAL, 260, 84).curve;
const actCf = segMetrics(ACTcanon, SPLIT, TO), actTr = segMetrics(ACTcanon, 260, SPLIT);
console.log(["caps".padEnd(11), "trCAGR".padStart(8), "cfCAGR".padStart(8), "cfMaxDD".padStart(8), "cfMAR".padStart(6), "ΔcfCAGR vs ACT".padStart(15)].join(" "));
OUT.caps = [];
for (const [lo, hi] of CAPS) {
  const fn = (top) => capNormalize(top.map((c) => Math.max(1, c.f.m9 ?? 1)), lo, hi);
  const c = run(fn, 260, 84).curve;
  const tr = segMetrics(c, 260, SPLIT), cf = segMetrics(c, SPLIT, TO);
  OUT.caps.push({ lo, hi, train: tr, confirm: cf, dCfCagr: cf.cagr - actCf.cagr });
  console.log([`[${lo},${hi}]`.padEnd(11), f1(tr.cagr).padStart(8), f1(cf.cagr).padStart(8), f1(cf.mdd).padStart(8), cf.mar.toFixed(2).padStart(6), f1(cf.cagr - actCf.cagr).padStart(15)].join(" "));
}

// ─── C) sensibilidad a la fecha de inicio ────────────────────────────────────
console.log("\n═══ C) FECHA DE INICIO: FROM 240→300 paso 4 (desplaza todas las revisiones), rev 84, confirmación fija ═══");
OUT.inicio = [];
let winsStart = 0;
const deltas = [];
for (let FROM = 240; FROM <= 300; FROM += 4) {
  const cA = segMetrics(run(SCHEMES.ACTUAL, FROM, 84).curve, SPLIT, TO).cagr;
  const cM = segMetrics(run(SCHEMES.M9_RAW, FROM, 84).curve, SPLIT, TO).cagr;
  const d = cM - cA;
  deltas.push(d); if (d > 0) winsStart++;
  OUT.inicio.push({ FROM, fecha: dates[FROM], act: cA, m9: cM, delta: d });
}
OUT.inicioResumen = { fases: deltas.length, m9Gana: winsStart, deltaMin: Math.min(...deltas), deltaMediana: deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)], deltaMax: Math.max(...deltas) };
console.log(`M9_RAW gana en ${winsStart}/${deltas.length} fases de inicio · Δ cfCAGR mín ${f1(Math.min(...deltas))} · mediana ${f1(OUT.inicioResumen.deltaMediana)} · máx ${f1(Math.max(...deltas))}`);

// ─── D) concentración del exceso: descomposición exacta + leave-one-out ──────
console.log("\n═══ D) CONCENTRACIÓN DEL EXCESO (celda canónica, confirmación) ═══");
{
  const daysA = new Map(), daysM = new Map();
  simulateInstr(T, D, { FROM: 260, review: 84, widthOf: H4, pickJump: jumpMezcla, weightsOf: SCHEMES.ACTUAL }, (i, day) => daysA.set(i, day));
  simulateInstr(T, D, { FROM: 260, review: 84, widthOf: H4, pickJump: jumpMezcla, weightsOf: SCHEMES.M9_RAW }, (i, day) => daysM.set(i, day));
  // misma selección: los sets de tickers deben coincidir día a día
  let mismatch = 0;
  for (let i = SPLIT + 1; i <= TO; i++) {
    const sA = new Set((daysA.get(i) ?? []).map((x) => x.ti));
    const sM = new Set((daysM.get(i) ?? []).map((x) => x.ti));
    if (sA.size !== sM.size || [...sA].some((x) => !sM.has(x))) mismatch++;
  }
  OUT.mismaSeleccion = { diasConfirmacion: TO - SPLIT, diasConCarteraDistinta: mismatch };
  console.log(`Cartera idéntica entre esquemas (solo cambian pesos): ${mismatch} días de divergencia de ${TO - SPLIT}`);
  // excedente diario y contribuciones por ticker / año / periodo de revisión
  const contrib = new Map(); const porAno = new Map(); const dailyEx = [];
  for (let i = SPLIT + 1; i <= TO; i++) {
    const dA = daysA.get(i) ?? [], dM = daysM.get(i) ?? [];
    const mA = new Map(dA.map((x) => [x.ti, x]));
    let ex = 0;
    for (const x of dM) {
      const a = mA.get(x.ti);
      const dsh = x.share - (a ? a.share : 0);
      const c = dsh * x.ret;
      ex += c;
      contrib.set(x.ti, (contrib.get(x.ti) ?? 0) + c);
    }
    const y = dates[i].slice(0, 4);
    porAno.set(y, (porAno.get(y) ?? 0) + ex);
    dailyEx.push({ i, ex });
  }
  const totalEx = dailyEx.reduce((s, d) => s + d.ex, 0);
  const logEx = Math.log(segMetrics(run(SCHEMES.M9_RAW, 260, 84).curve, SPLIT, TO).cagr + 1) * ((TO - SPLIT) / 252) - Math.log(actCf.cagr + 1) * ((TO - SPLIT) / 252);
  const byTicker = [...contrib.entries()].map(([ti, c]) => ({ sym: T[ti].sym, c })).sort((a, b) => b.c - a.c);
  const pos = byTicker.filter((x) => x.c > 0).reduce((s, x) => s + x.c, 0);
  const top1 = byTicker[0], top2 = byTicker[1], top3 = byTicker[2];
  const nPos = byTicker.filter((x) => x.c > 0).length, nNeg = byTicker.filter((x) => x.c < 0).length;
  OUT.concentracion = {
    excesoAritmeticoTotal: totalEx, excesoLogAprox: logEx,
    tickersConContribucion: byTicker.length, positivos: nPos, negativos: nNeg,
    top10Contribuidores: byTicker.slice(0, 10).map((x) => ({ sym: x.sym, contribPP: Math.round(x.c * 1e4) / 100, pctDelTotal: Math.round((x.c / totalEx) * 1000) / 10, pctDelPositivo: Math.round((x.c / pos) * 1000) / 10 })),
    top10Negativos: byTicker.slice(-5).map((x) => ({ sym: x.sym, contribPP: Math.round(x.c * 1e4) / 100 })),
    share1: top1.c / totalEx, share2: (top1.c + top2.c) / totalEx, share3: (top1.c + top2.c + top3.c) / totalEx,
    porAno: Object.fromEntries([...porAno.entries()].map(([y, v]) => [y, Math.round(v * 1e4) / 100])),
  };
  console.log(`Exceso acumulado (aritmético, confirmación): ${(totalEx * 100).toFixed(1)} pp · ${byTicker.length} tickers con contribución (${nPos} +, ${nNeg} −)`);
  console.log("Top contribuidores (pp del exceso · % del exceso neto):");
  for (const x of byTicker.slice(0, 8)) console.log(`  ${x.sym.padEnd(12)} ${(x.c * 100).toFixed(2).padStart(7)} pp  ${((x.c / totalEx) * 100).toFixed(1).padStart(6)}%`);
  console.log(`Cuota top-1 ${((top1.c / totalEx) * 100).toFixed(1)}% · top-2 ${(((top1.c + top2.c) / totalEx) * 100).toFixed(1)}% · top-3 ${(((top1.c + top2.c + top3.c) / totalEx) * 100).toFixed(1)}% del exceso neto`);
  console.log("Exceso por año:", [...porAno.entries()].map(([y, v]) => `${y} ${(v * 100).toFixed(1)}pp`).join(" · "));
  // días extremos: ¿cuánto del exceso son 5 días?
  const sortedDays = dailyEx.slice().sort((a, b) => b.ex - a.ex);
  const top5d = sortedDays.slice(0, 5).reduce((s, d) => s + d.ex, 0);
  OUT.concentracion.top5DiasPP = Math.round(top5d * 1e4) / 100;
  OUT.concentracion.top5Dias = sortedDays.slice(0, 5).map((d) => ({ fecha: dates[d.i], pp: Math.round(d.ex * 1e4) / 100 }));
  console.log(`Los 5 mejores días de exceso suman ${(top5d * 100).toFixed(1)} pp de ${(totalEx * 100).toFixed(1)} pp`);

  // leave-one-out real: quitar los 3 mayores contribuidores (de uno en uno) del UNIVERSO
  console.log("\nLEAVE-ONE-OUT (re-simulación completa sin el ticker, ambos esquemas):");
  OUT.leaveOneOut = [];
  for (const { sym } of byTicker.slice(0, 3)) {
    const Ts = T.filter((t) => t.sym !== sym);
    const cA = segMetrics(run(SCHEMES.ACTUAL, 260, 84, Ts).curve, SPLIT, TO);
    const cM = segMetrics(run(SCHEMES.M9_RAW, 260, 84, Ts).curve, SPLIT, TO);
    OUT.leaveOneOut.push({ sin: sym, act: cA.cagr, m9: cM.cagr, delta: cM.cagr - cA.cagr });
    console.log(`  sin ${sym.padEnd(12)} ACTUAL ${f1(cA.cagr)} · M9_RAW ${f1(cM.cagr)} · Δ ${f1(cM.cagr - cA.cagr)} (base Δ ${f1(segMetrics(run(SCHEMES.M9_RAW, 260, 84).curve, SPLIT, TO).cagr - actCf.cagr)})`);
  }
}

// ─── E) cadencia ±20 sesiones: ¿se mantiene el orden de esquemas? ────────────
console.log("\n═══ E) CADENCIA ±20 (rev 64 · 84 · 104, fase 260) — cfCAGR y orden ═══");
{
  const revs = [64, 84, 104];
  const names = Object.keys(SCHEMES);
  const table = {};
  for (const rev of revs) {
    table[rev] = {};
    for (const n of names) table[rev][n] = segMetrics(run(SCHEMES[n], 260, rev).curve, SPLIT, TO).cagr;
  }
  console.log(["Esquema".padEnd(15), ...revs.map((r) => `rev${r}`.padStart(9)), "rango64".padStart(8), "rango84".padStart(8), "rango104".padStart(9)].join(" "));
  const rankOf = (rev) => names.slice().sort((a, b) => table[rev][b] - table[rev][a]);
  const ranks = Object.fromEntries(revs.map((r) => [r, rankOf(r)]));
  OUT.cadencia = { cfCagr: table, orden: Object.fromEntries(revs.map((r) => [r, ranks[r]])) };
  for (const n of names.slice().sort((a, b) => table[84][b] - table[84][a])) {
    console.log([n.padEnd(15), ...revs.map((r) => f1(table[r][n]).padStart(9)),
      ...revs.map((r) => String(ranks[r].indexOf(n) + 1).padStart(r === 104 ? 9 : 8))].join(" "));
  }
  const rho64 = spearman(names.map((n) => table[64][n]), names.map((n) => table[84][n]));
  const rho104 = spearman(names.map((n) => table[104][n]), names.map((n) => table[84][n]));
  OUT.cadencia.spearman = { rev64vs84: rho64, rev104vs84: rho104 };
  OUT.cadencia.m9SobreActual = Object.fromEntries(revs.map((r) => [r, table[r].M9_RAW - table[r].ACTUAL]));
  console.log(`Spearman orden rev64 vs rev84: ${rho64?.toFixed(2)} · rev104 vs rev84: ${rho104?.toFixed(2)}`);
  console.log(`M9_RAW − ACTUAL: rev64 ${f1(table[64].M9_RAW - table[64].ACTUAL)} · rev84 ${f1(table[84].M9_RAW - table[84].ACTUAL)} · rev104 ${f1(table[104].M9_RAW - table[104].ACTUAL)}`);
}

fs.writeFileSync("backtests/rally-weighting-stress.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-weighting-stress.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
