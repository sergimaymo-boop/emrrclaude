/**
 * RALLY — VERIFICACIÓN DE ROBUSTEZ (lente adversarial) del veredicto del
 * estudio de FILTROS DE SELECCIÓN (backtests/rally-selection-filter-study.json
 * → MANTENER_ACTUAL, 0/10 passers; F0 = C0 sin filtro).
 * ============================================================================
 * Pruebas (sobre las variantes relevantes F2 —única mejora defensiva—, F6 —la
 * que menos CAGR pierde—, F3 —la hipótesis fuerte del usuario— vs F0):
 *  A) SUB-MITADES de la confirmación 2022-26 (mitad temporal y corte 2024-01),
 *     en las 9 celdas: ¿F0 domina en ambas mitades o el veredicto depende de
 *     un solo tramo? Incluye MaxDD por mitad (la defensa de F2, ¿es de un tramo?).
 *  B) ENSEMBLE DE 10 FASES DE INICIO (FROM 240→303 paso 7, rev 84 — fases
 *     NUEVAS fuera de la malla 3×3): cfCAGR/MaxDD/MAR por fase, Δ vs F0,
 *     peor-fase como análogo de peor-celda.
 *  C) SENSIBILIDAD AL UMBRAL del filtro: runway<30/40/50/55 · EMA50 con margen
 *     −2%/0/+2% · EN_MAXIMOS prox>0,99/0,995/0,997/0,999 (celda canónica).
 *     ¿Aparece algún umbral escondido que bata a F0, o la familia entera pierde?
 *  D) CONCENTRACIÓN del efecto F0−F2: gap log diario por año, top-5 días,
 *     ventanas de MaxDD (¿la ventaja defensiva de F2 es UN episodio?) y
 *     leave-one-out real (re-simulación de F0 y F2 sin cada uno de los tickers
 *     más expulsados por el filtro).
 *  E) FORWARD-ANÁLISIS del caso del usuario: exceso vs media-del-día por estado,
 *     partido en train / confirmación-H1 / confirmación-H2 y repetido en las
 *     10 fases del ensemble (solo confirmación): ¿signo estable o ruido?
 *
 * Determinista, sin lookahead, señales ajustadas (convención del estudio).
 * Control de regresión: canónicas F0/F2/F3/F6 ≡ JSON del estudio (tol 1e-9).
 * Salida: backtests/verify-selfilter-stress.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, scoreV4, runwayScore,
  isNum, clamp, f1, mean,
} from "./rally-study-lib.mjs";

const t0 = Date.now();
console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const MID = Math.floor((SPLIT + TO) / 2);
const IDX2024 = dates.findIndex((d) => d >= "2024-01-01");
console.log(`Tickers ${T.length} · ${dates[0]} → ${dates[TO]} · SPLIT ${dates[SPLIT]} · MID ${dates[MID]} · 2024 ${dates[IDX2024]}\n`);

// ─── réplica EXACTA de la mecánica del estudio ───────────────────────────────
const isBajo = (f) => runwayScore(f) < 55;
const isMax = (f) => f.prox != null && f.prox > 0.997;
const isBelow = (f) => f.ext50 != null && f.ext50 < 0;
const stopH4 = (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45) / 100;

function capNormalizeTarget(raw, lo = 4, hi = 20, target = 100) {
  const n = raw.length;
  if (!n) return [];
  const w = raw.map((v) => (isNum(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < target ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return w.map((v) => Math.min(hi, Math.max(lo, v * t)));
}
const wM9 = (top) => capNormalizeTarget(top.map((c) => Math.max(1, c.f.m9 ?? 1)), 4, 20, 100);

function makePickJump(TT, excl) {
  return (i, heldSet) => {
    let bi = null, bv = -Infinity, fbi = null, fbv = -Infinity;
    for (let ti = 0; ti < TT.length; ti++) {
      if (heldSet.has(ti)) continue;
      const t = TT[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s == null) continue;
      const v = 0.7 * s + 0.3 * runwayScore(f);
      if (v > fbv) { fbv = v; fbi = ti; }
      if (excl && excl(f)) continue;
      if (v > bv) { bv = v; bi = ti; }
    }
    if (bi == null && fbi != null) return fbi;
    return bi;
  };
}

function segMetrics(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > mdd) mdd = dd; }
  return { cagr, mdd, mar: mdd > 0 && cagr != null ? cagr / mdd : 0 };
}

/** Variante = {selExcl, rotExcl, soft}. Devuelve el resultado completo de simulate. */
function runV(v, FROM, review, TT = T) {
  const scoreFn = v.selExcl
    ? (f) => { const s = scoreV4(f); if (s == null) return null; return v.selExcl(f) ? s - 1000 : s; }
    : scoreV4;
  const weightsOf = v.soft
    ? (top) => {
        const n = top.length;
        const flags = top.map((c) => isBelow(c.f));
        const k = flags.filter(Boolean).length;
        const nOk = n - k, target = 100 - 4 * k;
        if (k === 0 || !(nOk > 0 && nOk * 4 <= target && nOk * 20 >= target)) return wM9(top);
        const okIdx = [], okRaw = [];
        top.forEach((c, j) => { if (!flags[j]) { okIdx.push(j); okRaw.push(Math.max(1, c.f.m9 ?? 1)); } });
        const okW = capNormalizeTarget(okRaw, 4, 20, target);
        const ws = new Array(n).fill(4);
        okIdx.forEach((j, q) => { ws[j] = okW[q]; });
        return ws;
      }
    : wM9;
  return simulate(TT, D, {
    FROM, review, topN: 10, conviction: true,
    widthOf: stopH4, pickJump: makePickJump(TT, v.rotExcl ?? null), weightsOf, scoreFn,
  });
}

const VAR = {
  F0: { selExcl: null, rotExcl: null, soft: false },
  F2: { selExcl: isMax, rotExcl: isMax, soft: false },
  F3: { selExcl: isBelow, rotExcl: isBelow, soft: false },
  F6: { selExcl: null, rotExcl: null, soft: true },
};
const NAMES = Object.keys(VAR);

const OUT = { ranAt: new Date().toISOString(), objeto: "estrés del veredicto MANTENER_ACTUAL (rally-selection-filter-study.json): F0 vs F2/F3/F6 bajo sub-mitades, ensemble de fases, umbrales, concentración y forward por estado" };

// ─── control de regresión vs JSON del estudio (canónica 260/84, tol 1e-9) ────
const STUDY = JSON.parse(fs.readFileSync("backtests/rally-selection-filter-study.json", "utf8"));
const studyCanon = (n) => (n === "F0" ? STUDY.c0Referencia : STUDY.variantes.find((v) => v.name === n)).canon;
const canonRes = {};
{
  for (const n of NAMES) {
    const r = runV(VAR[n], 260, 84);
    canonRes[n] = r;
    const ref = studyCanon(n);
    const cf = segMetrics(r.curve, SPLIT, TO), tr = segMetrics(r.curve, 260, SPLIT);
    for (const [a, b, w] of [[cf.cagr, ref.confirm.cagr, "cf CAGR"], [cf.mdd, ref.confirm.mdd, "cf MaxDD"], [tr.cagr, ref.train.cagr, "tr CAGR"]]) {
      if (Math.abs(a - b) > 1e-9) throw new Error(`REGRESIÓN ${n} ${w}: ${a} ≠ ${b}`);
    }
  }
  console.log("CONTROL DE REGRESIÓN: canónicas F0/F2/F3/F6 ≡ JSON del estudio (tol 1e-9). OK\n");
}

// ─── A) sub-mitades de la confirmación, 9 celdas ─────────────────────────────
console.log("═══ A) SUB-MITADES DE LA CONFIRMACIÓN — F0 vs F2/F3/F6, 9 celdas (ΔCAGR = variante − F0) ═══");
const cellCurves = {};
for (const n of NAMES) {
  cellCurves[n] = {};
  for (const FROM of [260, 280, 300]) for (const review of [63, 84, 105]) {
    cellCurves[n][`${FROM}/${review}`] = (n in canonRes && FROM === 260 && review === 84)
      ? canonRes[n].curve : runV(VAR[n], FROM, review).curve;
  }
}
OUT.subMitades = { celdas: [], resumen: {} };
const winCount = {};
for (const n of ["F2", "F3", "F6"]) winCount[n] = { h1: 0, h2: 0, y2223: 0, y2426: 0 };
console.log(["Celda".padEnd(9), "‖ ΔH1 F2".padStart(9), "F3".padStart(7), "F6".padStart(7), "‖ ΔH2 F2".padStart(9), "F3".padStart(7), "F6".padStart(7), "‖ Δ22-23 F2".padStart(11), "‖ Δ24-26 F2".padStart(11)].join(" "));
for (const FROM of [260, 280, 300]) for (const review of [63, 84, 105]) {
  const key = `${FROM}/${review}`;
  const seg = (n, a, b) => segMetrics(cellCurves[n][key], a, b);
  const row = { celda: key };
  for (const n of ["F2", "F3", "F6"]) {
    const dh1 = seg(n, SPLIT, MID).cagr - seg("F0", SPLIT, MID).cagr;
    const dh2 = seg(n, MID, TO).cagr - seg("F0", MID, TO).cagr;
    const da = seg(n, SPLIT, IDX2024).cagr - seg("F0", SPLIT, IDX2024).cagr;
    const db = seg(n, IDX2024, TO).cagr - seg("F0", IDX2024, TO).cagr;
    row[n] = { dH1: dh1, dH2: dh2, d2223: da, d2426: db };
    if (dh1 > 0) winCount[n].h1++; if (dh2 > 0) winCount[n].h2++;
    if (da > 0) winCount[n].y2223++; if (db > 0) winCount[n].y2426++;
  }
  // MaxDD por mitad para la defensa de F2
  row.mddH1 = { F0: seg("F0", SPLIT, MID).mdd, F2: seg("F2", SPLIT, MID).mdd };
  row.mddH2 = { F0: seg("F0", MID, TO).mdd, F2: seg("F2", MID, TO).mdd };
  OUT.subMitades.celdas.push(row);
  console.log([key.padEnd(9), f1(row.F2.dH1).padStart(9), f1(row.F3.dH1).padStart(7), f1(row.F6.dH1).padStart(7),
    f1(row.F2.dH2).padStart(9), f1(row.F3.dH2).padStart(7), f1(row.F6.dH2).padStart(7),
    f1(row.F2.d2223).padStart(11), f1(row.F2.d2426).padStart(11)].join(" "));
}
for (const n of ["F2", "F3", "F6"]) OUT.subMitades.resumen[n] = Object.fromEntries(Object.entries(winCount[n]).map(([k, v]) => [k, `${v}/9`]));
const mddWins = { h1: 0, h2: 0 };
for (const r of OUT.subMitades.celdas) { if (r.mddH1.F2 < r.mddH1.F0) mddWins.h1++; if (r.mddH2.F2 < r.mddH2.F0) mddWins.h2++; }
OUT.subMitades.resumen.F2_MaxDD_menorQueF0 = { h1: `${mddWins.h1}/9`, h2: `${mddWins.h2}/9` };
console.log("Celdas en las que la variante GANA a F0 en CAGR:", JSON.stringify(OUT.subMitades.resumen));

// ─── B) ensemble de 10 fases de inicio ───────────────────────────────────────
console.log("\n═══ B) ENSEMBLE DE 10 FASES DE INICIO (FROM 240→303 paso 7, rev 84) — confirmación ═══");
const PHASES10 = [240, 247, 254, 261, 268, 275, 282, 289, 296, 303];
OUT.ensembleFases = { fases: [], resumen: {} };
console.log(["FROM".padEnd(6), "F0 cCAGR".padStart(9), "F2 Δ".padStart(8), "F3 Δ".padStart(8), "F6 Δ".padStart(8), "‖ MaxDD F0".padStart(11), "F2".padStart(7), "‖ MAR F0".padStart(9), "F2".padStart(6)].join(" "));
const phaseData = {};
for (const n of NAMES) phaseData[n] = [];
for (const FROM of PHASES10) {
  const row = { FROM, fecha: dates[FROM] };
  for (const n of NAMES) {
    const c = runV(VAR[n], FROM, 84).curve;
    const cf = segMetrics(c, SPLIT, TO);
    phaseData[n].push(cf);
    row[n] = cf;
  }
  OUT.ensembleFases.fases.push(row);
  console.log([String(FROM).padEnd(6), f1(row.F0.cagr).padStart(9), f1(row.F2.cagr - row.F0.cagr).padStart(8),
    f1(row.F3.cagr - row.F0.cagr).padStart(8), f1(row.F6.cagr - row.F0.cagr).padStart(8),
    f1(row.F0.mdd).padStart(11), f1(row.F2.mdd).padStart(7), row.F0.mar.toFixed(2).padStart(9), row.F2.mar.toFixed(2).padStart(6)].join(" "));
}
for (const n of ["F2", "F3", "F6"]) {
  const ds = PHASES10.map((_, j) => phaseData[n][j].cagr - phaseData.F0[j].cagr).sort((a, b) => a - b);
  const wins = ds.filter((d) => d > 0).length;
  const mddWins10 = PHASES10.map((_, j) => phaseData[n][j].mdd < phaseData.F0[j].mdd).filter(Boolean).length;
  const marWins10 = PHASES10.map((_, j) => phaseData[n][j].mar > phaseData.F0[j].mar).filter(Boolean).length;
  OUT.ensembleFases.resumen[n] = {
    ganaCagr: `${wins}/10`, dMin: ds[0], dMediana: ds[Math.floor(ds.length / 2)], dMax: ds.at(-1),
    mddMenor: `${mddWins10}/10`, marMayor: `${marWins10}/10`,
    peorFase: Math.min(...phaseData[n].map((x) => x.cagr)),
  };
}
OUT.ensembleFases.resumen.F0 = { peorFase: Math.min(...phaseData.F0.map((x) => x.cagr)), medianaFase: phaseData.F0.map((x) => x.cagr).sort((a, b) => a - b)[5] };
console.log("Resumen ensemble:", JSON.stringify(OUT.ensembleFases.resumen, (k, v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v)));

// ─── C) sensibilidad al umbral del filtro (celda canónica) ───────────────────
console.log("\n═══ C) SENSIBILIDAD AL UMBRAL (celda canónica 260/84; Δ vs F0 en confirmación) ═══");
const cfF0 = segMetrics(canonRes.F0.curve, SPLIT, TO), trF0 = segMetrics(canonRes.F0.curve, 260, SPLIT);
const THRESH = [
  ...[30, 40, 50, 55].map((th) => ({ name: `RUNWAY<${th}`, fam: "runway", excl: (f) => runwayScore(f) < th })),
  ...[[-0.02, "EMA50−2%"], [0, "EMA50+0%"], [0.02, "EMA50+2%"]].map(([m, nm]) => ({ name: nm, fam: "ema50", excl: (f) => f.ext50 != null && f.ext50 < m })),
  ...[0.99, 0.995, 0.997, 0.999].map((p) => ({ name: `PROX>${p}`, fam: "prox", excl: (f) => f.prox != null && f.prox > p })),
];
OUT.umbrales = [];
console.log(["Umbral".padEnd(12), "trCAGR".padStart(8), "cfCAGR".padStart(8), "cfMaxDD".padStart(8), "cfMAR".padStart(6), "ΔcfCAGR".padStart(9), "ΔcfMaxDD".padStart(9)].join(" "));
console.log(["F0".padEnd(12), f1(trF0.cagr).padStart(8), f1(cfF0.cagr).padStart(8), f1(cfF0.mdd).padStart(8), cfF0.mar.toFixed(2).padStart(6), "—".padStart(9), "—".padStart(9)].join(" "));
for (const t of THRESH) {
  const r = runV({ selExcl: t.excl, rotExcl: t.excl, soft: false }, 260, 84);
  const cf = segMetrics(r.curve, SPLIT, TO), tr = segMetrics(r.curve, 260, SPLIT);
  OUT.umbrales.push({ name: t.name, fam: t.fam, train: tr, confirm: cf, dCfCagr: cf.cagr - cfF0.cagr, dCfMdd: cf.mdd - cfF0.mdd });
  console.log([t.name.padEnd(12), f1(tr.cagr).padStart(8), f1(cf.cagr).padStart(8), f1(cf.mdd).padStart(8), cf.mar.toFixed(2).padStart(6), f1(cf.cagr - cfF0.cagr).padStart(9), f1(cf.mdd - cfF0.mdd).padStart(9)].join(" "));
}
OUT.umbralesResumen = {
  algunoBateCagrF0: OUT.umbrales.some((u) => u.dCfCagr > 0),
  mejorPorCagr: OUT.umbrales.slice().sort((a, b) => b.dCfCagr - a.dCfCagr)[0].name,
};

// ─── D) concentración del efecto F0−F2 ───────────────────────────────────────
console.log("\n═══ D) CONCENTRACIÓN F0 vs F2 (celda canónica, confirmación) ═══");
{
  const rF0 = canonRes.F0, rF2 = canonRes.F2;
  // gap log diario (dret[j] = retorno del día FROM+1+j)
  const gapDays = [];
  for (let i = SPLIT + 1; i <= TO; i++) {
    const j = i - 260 - 1;
    const a = rF0.dret[j] ?? 0, b = rF2.dret[j] ?? 0;
    gapDays.push({ i, g: Math.log(1 + a) - Math.log(1 + b) });
  }
  const totalGap = gapDays.reduce((s, d) => s + d.g, 0);
  const porAno = {};
  for (const d of gapDays) { const y = dates[d.i].slice(0, 4); porAno[y] = (porAno[y] ?? 0) + d.g; }
  const sorted = gapDays.slice().sort((a, b) => b.g - a.g);
  const top5 = sorted.slice(0, 5), bot5 = sorted.slice(-5).reverse();
  OUT.concentracionF2 = {
    gapLogTotalPP: Math.round(totalGap * 1e4) / 100,
    porAnoPP: Object.fromEntries(Object.entries(porAno).map(([y, v]) => [y, Math.round(v * 1e4) / 100])),
    top5DiasProF0: top5.map((d) => ({ fecha: dates[d.i], pp: Math.round(d.g * 1e4) / 100 })),
    top5DiasProF2: bot5.map((d) => ({ fecha: dates[d.i], pp: Math.round(d.g * 1e4) / 100 })),
    top5DiasProF0SumaPP: Math.round(top5.reduce((s, d) => s + d.g, 0) * 1e4) / 100,
  };
  console.log(`Gap log total F0−F2 (confirmación): ${(totalGap * 100).toFixed(1)} pp · por año: ${Object.entries(porAno).map(([y, v]) => `${y} ${(v * 100).toFixed(1)}pp`).join(" · ")}`);
  console.log(`Top-5 días pro-F0 suman ${OUT.concentracionF2.top5DiasProF0SumaPP} pp: ${top5.map((d) => `${dates[d.i]} ${(d.g * 100).toFixed(1)}pp`).join(" · ")}`);
  console.log(`Top-5 días pro-F2: ${bot5.map((d) => `${dates[d.i]} ${(d.g * 100).toFixed(1)}pp`).join(" · ")}`);

  // ventanas de MaxDD en confirmación
  const ddWindow = (curve) => {
    let peak = -Infinity, peakI = SPLIT, mdd = 0, from = SPLIT, to = SPLIT;
    for (let i = SPLIT; i <= TO; i++) {
      const v = curve[i]; if (v == null) continue;
      if (v > peak) { peak = v; peakI = i; }
      const dd = 1 - v / peak;
      if (dd > mdd) { mdd = dd; from = peakI; to = i; }
    }
    return { mdd, desde: dates[from], hasta: dates[to], fromI: from, toI: to };
  };
  const ddSpan = (curve, a, b) => {
    let peak = -Infinity, mdd = 0;
    for (let i = a; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; mdd = Math.max(mdd, 1 - v / peak); }
    return mdd;
  };
  const w0 = ddWindow(rF0.curve), w2 = ddWindow(rF2.curve);
  OUT.concentracionF2.maxDD = {
    F0: { mdd: w0.mdd, ventana: `${w0.desde} → ${w0.hasta}`, F2enMismaVentana: ddSpan(rF2.curve, w0.fromI, w0.toI) },
    F2: { mdd: w2.mdd, ventana: `${w2.desde} → ${w2.hasta}`, F0enMismaVentana: ddSpan(rF0.curve, w2.fromI, w2.toI) },
  };
  console.log(`MaxDD F0 ${f1(w0.mdd)} (${w0.desde} → ${w0.hasta}); F2 en esa misma ventana: ${f1(OUT.concentracionF2.maxDD.F0.F2enMismaVentana)}`);
  console.log(`MaxDD F2 ${f1(w2.mdd)} (${w2.desde} → ${w2.hasta}); F0 en esa misma ventana: ${f1(OUT.concentracionF2.maxDD.F2.F0enMismaVentana)}`);

  // leave-one-out: tickers más expulsados por EN_MAXIMOS según el estudio
  const LOO = ["GAW.LSE", "ARGX.BR", "LRCX.US", "NEM.US", "TSLA.US", "HWM.US"];
  console.log("\nLEAVE-ONE-OUT (re-simulación completa F0 y F2 sin el ticker; base ΔcfCAGR " +
    f1(cfF0.cagr - segMetrics(rF2.curve, SPLIT, TO).cagr) + " pro-F0, ΔMaxDD " + f1(segMetrics(rF2.curve, SPLIT, TO).mdd - cfF0.mdd) + " pro-F2):");
  OUT.leaveOneOut = [];
  for (const sym of LOO) {
    const Ts = T.filter((t) => t.sym !== sym);
    const c0 = segMetrics(runV(VAR.F0, 260, 84, Ts).curve, SPLIT, TO);
    const c2 = segMetrics(runV(VAR.F2, 260, 84, Ts).curve, SPLIT, TO);
    OUT.leaveOneOut.push({ sin: sym, F0: c0, F2: c2, dCagrProF0: c0.cagr - c2.cagr, dMddProF2: c2.mdd - c0.mdd });
    console.log(`  sin ${sym.padEnd(10)} F0 ${f1(c0.cagr)}/${f1(c0.mdd)} · F2 ${f1(c2.cagr)}/${f1(c2.mdd)} · ΔCAGR pro-F0 ${f1(c0.cagr - c2.cagr)} · ΔMaxDD pro-F2 ${f1(c2.mdd - c0.mdd)}`);
  }
}

// ─── E) forward-análisis del caso del usuario: estabilidad ───────────────────
console.log("\n═══ E) FORWARD 84s POR ESTADO — estabilidad del exceso vs media-del-día ═══");
function rankingAt(i) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s != null) cands.push({ ti, s, f });
  }
  cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
  return cands;
}
const fwdOf = (ti, i, H = 84) => {
  const a = T[ti].adj[i], b = T[ti].adj[i + H];
  return isNum(a) && isNum(b) && a > 0 ? b / a - 1 : null;
};
const STATES = { BAJO: isBajo, EN_MAXIMOS: isMax, BELOW_EMA50: isBelow };
function stateExcess(reviewDays) {
  const acc = {};
  for (const k of Object.keys(STATES)) acc[k] = [];
  for (const i of reviewDays) {
    const top10 = rankingAt(i).slice(0, 10);
    const fwds = top10.map((c) => fwdOf(c.ti, i));
    const dm = mean(fwds.filter(isNum));
    top10.forEach((c, j) => {
      if (!isNum(fwds[j]) || !isNum(dm)) return;
      for (const [k, fn] of Object.entries(STATES)) if (fn(c.f)) acc[k].push(fwds[j] - dm);
    });
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { n: v.length, excesoMedio: v.length ? mean(v) : null }]));
}
// (1) calendario canónico partido: train / confirm-H1 / confirm-H2
const revCanon = [];
for (let i = 260 + 84; i + 84 <= TO; i += 84) revCanon.push(i);
const segs = {
  train: revCanon.filter((i) => i < SPLIT),
  confirmH1: revCanon.filter((i) => i >= SPLIT && i < MID),
  confirmH2: revCanon.filter((i) => i >= MID),
};
OUT.forwardEstados = { canonicoPorTramo: {} };
for (const [sg, days] of Object.entries(segs)) OUT.forwardEstados.canonicoPorTramo[sg] = stateExcess(days);
console.log("Exceso medio (canónico) por tramo:");
for (const [sg, r] of Object.entries(OUT.forwardEstados.canonicoPorTramo)) {
  console.log(`  ${sg.padEnd(10)} ` + Object.entries(r).map(([k, v]) => `${k} ${f1(v.excesoMedio)} (n${v.n})`).join(" · "));
}
// (2) ensemble de 10 fases (solo confirmación): signo del exceso por fase
OUT.forwardEstados.ensembleConfirm = {};
const signs = {};
for (const k of Object.keys(STATES)) signs[k] = [];
for (const FROM of PHASES10) {
  const days = [];
  for (let i = FROM + 84; i + 84 <= TO; i += 84) if (i >= SPLIT) days.push(i);
  const r = stateExcess(days);
  for (const k of Object.keys(STATES)) signs[k].push({ FROM, exceso: r[k].excesoMedio, n: r[k].n });
}
console.log("Ensemble 10 fases (confirmación) — exceso medio por fase:");
for (const [k, arr] of Object.entries(signs)) {
  const neg = arr.filter((x) => isNum(x.exceso) && x.exceso < 0).length;
  const vals = arr.map((x) => x.exceso).filter(isNum);
  OUT.forwardEstados.ensembleConfirm[k] = {
    fasesNegativas: `${neg}/${arr.length}`, excesoMediano: vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)],
    rango: [Math.min(...vals), Math.max(...vals)], nPorFase: arr.map((x) => x.n), porFase: arr,
  };
  console.log(`  ${k.padEnd(12)} negativo en ${neg}/${arr.length} fases · mediana ${f1(OUT.forwardEstados.ensembleConfirm[k].excesoMediano)} · rango [${f1(Math.min(...vals))}, ${f1(Math.max(...vals))}] · n medio ${mean(arr.map((x) => x.n)).toFixed(0)}`);
}

// ─── veredicto de robustez ───────────────────────────────────────────────────
const eR = OUT.ensembleFases.resumen;
const veredictoComponentes = {
  A_F0dominaAmbasMitades: ["F2", "F3", "F6"].every((n) => winCount[n].h1 <= 4 && winCount[n].h2 <= 4),
  B_ningunaGanaMayoriaFases: ["F2", "F3", "F6"].every((n) => Number(eR[n].ganaCagr.split("/")[0]) <= 5),
  B_peorFaseF0mejorQueTodas: ["F2", "F3", "F6"].every((n) => eR.F0.peorFase > eR[n].peorFase),
  C_ningunUmbralBateCagr: !OUT.umbralesResumen.algunoBateCagrF0,
  D_defensaF2unEpisodio: null, // se rellena a mano abajo con la ventana de MaxDD
  E_excesoEnMaximosEstable: null,
};
veredictoComponentes.D_defensaF2unEpisodio =
  OUT.concentracionF2.maxDD.F0.F2enMismaVentana < OUT.concentracionF2.maxDD.F0.mdd - 0.03;
veredictoComponentes.E_excesoEnMaximosEstable =
  Number(OUT.forwardEstados.ensembleConfirm.EN_MAXIMOS.fasesNegativas.split("/")[0]) >= 7;
OUT.veredictoComponentes = veredictoComponentes;
console.log("\nComponentes del veredicto:", JSON.stringify(veredictoComponentes));

fs.writeFileSync("backtests/verify-selfilter-stress.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/verify-selfilter-stress.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
