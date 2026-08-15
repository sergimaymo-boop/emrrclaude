/**
 * RALLY — ESTUDIO 4 (mandato Sergi 15-ago-2026): STOP ADAPTATIVO POR TICKER
 * ==========================================================================
 * Requisito de producto: cada ticker debe tener SU trailing stop según su fase
 * (amplitud/volatilidad, salud de tendencia, cercanía a pullback): ceñido si hay
 * riesgo inminente, amplio si la tendencia es sana. Objetivo: MÁXIMA rentabilidad
 * con robustez, sabiendo que al saltar el stop el capital rota al mejor del scanner.
 *
 * Espacio de políticas (mucho más amplio que el estudio 2):
 *   1) ATR-escalado: stop% = k·ATR14%/precio con malla de k y suelos/techos.
 *      ATR DE PRODUCCIÓN (media simple de los últimos 14 TR — technicalEngine).
 *   2) Modulación continua por SALUD de tendencia (score compuesto calculable en t).
 *   3) Ratchet de beneficio / chandelier (ceñir tras ganancia o subida parabólica).
 *   4) Clasificador de pullback: combinaciones de indicadores → drawdown forward.
 *   5) Ajuste por ticker con SHRINKAGE hacia el global (solo si bate OOS).
 *
 * FIDELIDAD: señales sobre cierre AJUSTADO (convención real de producción, corrige
 * la infidelidad del estudio anterior). Rotación al saltar: mezcla 0,7·score +
 * 0,3·recorrido (validada). Protocolo: malla 9 celdas (3 fases × 3 cadencias, peor
 * semestre por celda), costes 20 pb/lado, sin lookahead, determinista.
 *
 * CRITERIO FINAL: máxima rentabilidad OOS sujeta a robustez (peor celda de la malla
 * no inferior a la del fijo 30%). Empate → gana la variante ADAPTATIVA por ticker.
 * ⚠ El ranking "por 2ª mitad" que imprime este script se sustituyó en la ronda 2
 * por el walk-forward correcto (elegir con la 1ª mitad, confirmar con la 2ª): ver
 * la nota de honestidad en rally-adaptive-stop-round2.mjs.
 *
 * ⚠ NOTAS DE LA VERIFICACIÓN ADVERSARIAL sobre la parte A (clasificador):
 *   · El combo OLS de 15 rasgos NUNCA llegó a ajustarse: dd52 = prox − 1 son
 *     colineales EXACTOS → matriz singular → ols() devuelve null y el combo se
 *     descarta en silencio (por eso no aparece su fila en la salida).
 *   · m9 y slope200 SÍ tienen IC estable moderado (0,24-0,30 en train y test):
 *     "más momento/extensión → más drawdown forward". No se usa para ceñir
 *     porque TODAS las políticas que ciñen a los fuertes pierden en la malla
 *     (control inverso, salud, parabólico): la justificación es la evidencia a
 *     nivel de política, no la afirmación "nada predice".
 *
 * Salida: backtests/rally-adaptive-stop-study.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, evalCurve, scoreV4, runwayScore, runwayLevel,
  isNum, mean, sd, f1, clamp, spearman,
} from "./rally-study-lib.mjs";

console.log("Cargando universo (señales sobre cierre AJUSTADO — convención de producción)…");
const { T, dates, D, spyClose } = loadUniverse({ adjustedSignals: true, rich: true });
console.log(`Tickers: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);

const OUT = { ranAt: new Date().toISOString(), clasificador: {}, politicas: [], shrinkage: {}, hoy: [] };
const TO = D - 1;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ─── SALUD DE TENDENCIA: score compuesto ∈ [0,1], todo calculable en t ────────
function health(f) {
  const parts = [];
  if (isNum(f.dist50) && isNum(f.sma50) && isNum(f.sma200) && isNum(f.slope50) && isNum(f.slope200)) {
    parts.push(((f.dist50 > 0 ? 1 : 0) + (f.sma50 > f.sma200 ? 1 : 0) + (f.slope50 > 0 ? 1 : 0) + (f.slope200 > 0 ? 1 : 0)) / 4);
  }
  if (isNum(f.rsi14)) parts.push(clamp01((f.rsi14 - 30) / 40));          // 30→0 · 70→1
  if (isNum(f.dd52)) parts.push(clamp01(1 + f.dd52 / 0.25));             // en máximos→1 · −25%→0
  if (isNum(f.m3)) parts.push(clamp01((f.m3 + 10) / 50));                // −10%→0 · +40%→1
  if (isNum(f.vol2060)) parts.push(clamp01(1.6 - f.vol2060));            // vol contraída→1
  if (isNum(f.ddVel10)) parts.push(clamp01(1 + f.ddVel10 / 0.10));       // cayendo rápido→0
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5;
}

const atrOf = (f) => (isNum(f.atrProd) ? f.atrProd : isNum(f.atr) ? f.atr : 3);
const atrK = (f, k, lo, hi) => clamp(k * atrOf(f), lo, hi) / 100;
const mkAtrK = (k, lo, hi) => (f) => atrK(f, k, lo, hi);
const mkHealthLin = (lo, hi) => (f) => (lo + (hi - lo) * health(f)) / 100;
const mkAtrHealth = (k, lo, hi) => (f) => clamp(k * atrOf(f) * (0.6 + 0.8 * health(f)), lo, hi) / 100;

// ─── PARTE A: CLASIFICADOR DE PULLBACK (combinaciones de indicadores) ─────────
{
  console.log("═══ A) ¿QUÉ COMBINACIÓN DE INDICADORES PREDICE EL DRAWDOWN FORWARD? ═══");
  const FEATS = ["atrProd", "vol2060", "rsi14", "dist50", "dist200", "slope50", "slope200",
    "m1", "m3", "m9", "dd52", "ddVel10", "ext50", "age", "prox"];
  const eps = [];
  for (let i = 280; i <= TO - 63; i += 21) {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands.slice(0, 10)) {
      const t = T[c.ti];
      let peak = t.adj[i], dd21 = 0, dd63 = 0;
      for (let j = i + 1; j <= Math.min(i + 63, TO); j++) {
        const px = t.adj[j]; if (!isNum(px)) continue;
        if (px > peak) peak = px;
        const dd = 1 - px / peak;
        if (j <= i + 21) dd21 = Math.max(dd21, dd);
        dd63 = Math.max(dd63, dd);
      }
      const row = { i, dd21, dd63, health: health(c.f), runway: runwayScore(c.f) };
      for (const k of FEATS) row[k] = c.f[k];
      eps.push(row);
    }
  }
  const SPLIT = 280 + Math.floor((TO - 280) / 2);
  const train = eps.filter((e) => e.i < SPLIT), test = eps.filter((e) => e.i >= SPLIT);
  console.log(`Episodios: ${eps.length} (train ${train.length} / test ${test.length}) · dd63 medio ${f1(mean(eps.map((e) => e.dd63)))}`);

  const ic = (rows, k, target) => {
    const p = rows.filter((r) => isNum(r[k]) && isNum(r[target]));
    return spearman(p.map((r) => r[k]), p.map((r) => r[target]));
  };
  console.log("\nRasgo         IC-train(dd63)  IC-test(dd63)  IC-test(dd21)");
  const uni = {};
  for (const k of [...FEATS, "health", "runway"]) {
    const a = ic(train, k, "dd63"), b = ic(test, k, "dd63"), c = ic(test, k, "dd21");
    uni[k] = { train63: a, test63: b, test21: c };
    console.log(`  ${k.padEnd(10)} ${(a ?? 0).toFixed(3).padStart(12)} ${(b ?? 0).toFixed(3).padStart(14)} ${(c ?? 0).toFixed(3).padStart(14)}`);
  }

  // multivariante: OLS estandarizado en train → Spearman de la predicción en test
  function ols(rows, keys, target) {
    const X = [], y = [];
    for (const r of rows) {
      if (!keys.every((k) => isNum(r[k])) || !isNum(r[target])) continue;
      X.push(keys.map((k) => r[k])); y.push(r[target]);
    }
    if (X.length < 30) return null;
    const mu = keys.map((_, j) => mean(X.map((x) => x[j])));
    const si = keys.map((_, j) => sd(X.map((x) => x[j])) || 1);
    const Z = X.map((x) => [1, ...x.map((v, j) => (v - mu[j]) / si[j])]);
    const d = Z[0].length;
    const A = Array.from({ length: d }, () => new Array(d + 1).fill(0));
    for (let r = 0; r < Z.length; r++)
      for (let a = 0; a < d; a++) { for (let b = 0; b < d; b++) A[a][b] += Z[r][a] * Z[r][b]; A[a][d] += Z[r][a] * y[r]; }
    for (let c = 0; c < d; c++) { // eliminación gaussiana con pivote parcial
      let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < d; r++) { if (r === c) continue; const m = A[r][c] / A[c][c]; for (let q = c; q <= d; q++) A[r][q] -= m * A[c][q]; }
    }
    const beta = A.map((row, r2) => row[d] / row[r2]);
    return { beta, mu, si, predict: (r) => beta[0] + keys.reduce((s, k, j) => s + beta[j + 1] * ((r[k] - mu[j]) / si[j]), 0) };
  }
  const COMBOS = [
    ["atrProd", "vol2060"],
    ["atrProd", "rsi14", "ddVel10"],
    ["atrProd", "m1", "dist50"],
    ["atrProd", "vol2060", "rsi14", "m1", "dist50"],
    [...FEATS],
  ];
  console.log("\nCombinación (OLS train→test)                                 Spearman pred↔dd63 TEST");
  OUT.clasificador = { univariante: uni, combos: [] };
  for (const keys of COMBOS) {
    const model = ols(train, keys, "dd63");
    if (!model) continue;
    const p = test.filter((r) => keys.every((k) => isNum(r[k])) && isNum(r.dd63));
    const rho = spearman(p.map((r) => model.predict(r)), p.map((r) => r.dd63));
    OUT.clasificador.combos.push({ keys, rhoTest: rho, n: p.length });
    console.log(`  ${keys.join("+").slice(0, 58).padEnd(58)} ${(rho ?? 0).toFixed(3).padStart(8)} (n=${p.length})`);
  }
  console.log("");
}

// ─── rotación al saltar el stop: MEZCLA 0,7·score + 0,3·recorrido (validada) ──
function jumpMezcla(i, heldSet) {
  let bi = null, bv = -Infinity;
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s == null) continue;
    const v = 0.7 * s + 0.3 * runwayScore(f);
    if (v > bv) { bv = v; bi = ti; }
  }
  return bi;
}

// ─── PARTE B: MALLA DE POLÍTICAS ──────────────────────────────────────────────
const POLICIES = [
  { label: "CAMPEÓN (sin trailing)", widthOf: null },
  { label: "fijo 20%", widthOf: () => 0.20 },
  { label: "fijo 25%", widthOf: () => 0.25 },
  { label: "fijo 30%", widthOf: () => 0.30 },
  { label: "fijo 35%", widthOf: () => 0.35 },
  { label: "catATR-prod 25-35 (panel)", widthOf: (f) => clamp(25 + atrOf(f) * 2, 25, 35) / 100 },
  { label: "REC A40/M30/B20 @entrada", widthOf: (f) => ({ ALTO: 0.40, MEDIO: 0.30, BAJO: 0.20 })[runwayLevel(f)] },
  { label: "ATR k6 [12,45] @entrada", widthOf: mkAtrK(6, 12, 45) },
  { label: "ATR k8 [12,45] @entrada", widthOf: mkAtrK(8, 12, 45) },
  { label: "ATR k10 [12,45] @entrada", widthOf: mkAtrK(10, 12, 45) },
  { label: "ATR k12 [12,45] @entrada", widthOf: mkAtrK(12, 12, 45) },
  { label: "ATR k8 [15,40] @entrada", widthOf: mkAtrK(8, 15, 40) },
  { label: "ATR k10 [15,40] @entrada", widthOf: mkAtrK(10, 15, 40) },
  { label: "ATR k12 [10,50] @entrada", widthOf: mkAtrK(12, 10, 50) },
  { label: "ATR k8 [12,45] DIARIO", widthOf: mkAtrK(8, 12, 45), dailyWidth: true },
  { label: "ATR k10 [12,45] DIARIO", widthOf: mkAtrK(10, 12, 45), dailyWidth: true },
  { label: "SALUD lineal 15..45 @entrada", widthOf: mkHealthLin(15, 45) },
  { label: "SALUD lineal 12..40 @entrada", widthOf: mkHealthLin(12, 40) },
  { label: "SALUD lineal 20..40 @entrada", widthOf: mkHealthLin(20, 40) },
  { label: "SALUD tramos 15/28/40 @entrada", widthOf: (f) => (health(f) < 0.4 ? 15 : health(f) < 0.7 ? 28 : 40) / 100 },
  { label: "SALUD lineal 15..45 DIARIO", widthOf: mkHealthLin(15, 45), dailyWidth: true },
  { label: "ATR k8×salud [12,45] @entrada", widthOf: mkAtrHealth(8, 12, 45) },
  { label: "ATR k10×salud [12,45] @entrada", widthOf: mkAtrHealth(10, 12, 45) },
  { label: "ATR k10×salud [12,45] DIARIO", widthOf: mkAtrHealth(10, 12, 45), dailyWidth: true },
  { label: "fijo30 + ratchet g50→20/g100→15", widthOf: (f, ctx) => ((ctx?.peakGain ?? 0) > 1 ? 0.15 : (ctx?.peakGain ?? 0) > 0.5 ? 0.20 : 0.30), dailyWidth: true },
  { label: "ATR k10 + ratchet ×0.6 @+50%", widthOf: (f, ctx) => { const w = atrK(f, 10, 12, 45); return (ctx?.peakGain ?? 0) > 0.5 ? Math.max(0.10, w * 0.6) : w; }, dailyWidth: true },
  { label: "ATR k10 + parabólico m1>40→×0.6", widthOf: (f) => { const w = atrK(f, 10, 12, 45); return isNum(f.m1) && f.m1 > 40 ? Math.max(0.10, w * 0.6) : w; }, dailyWidth: true },
];

const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
console.log("═══ B) POLÍTICAS — malla 9 celdas (peor semestre) + canónicas 260·84 (señales AJUSTADAS, salto mezcla) ═══");
console.log("Política".padEnd(34), "mín".padStart(7), "mediana".padStart(8), " ‖ ", "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(5), "Sharpe".padStart(7), "1ª mit".padStart(8), "2ª mit".padStart(8), "ops/a".padStart(6), "win".padStart(5));
const results = [];
for (const cfg of POLICIES) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const r = simulate(T, D, {
      FROM, review, conviction: true,
      widthOf: cfg.widthOf, dailyWidth: cfg.dailyWidth ?? false,
      pickJump: cfg.widthOf ? jumpMezcla : null,
    });
    const e = evalCurve(r.curve, FROM, D, r.dret);
    cells.push(e.worst);
    if (FROM === 260 && review === 84) {
      const years = (D - 1 - FROM) / 252;
      canon = { ...e, tradesYr: r.trades / years, jumps: r.jumpCount, winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open) };
    }
  }
  const minC = Math.min(...cells), medC = [...cells].sort((a, b) => a - b)[4];
  results.push({ label: cfg.label, cells, minC, medC, canon });
  console.log(cfg.label.padEnd(34), f1(minC).padStart(7), f1(medC).padStart(8), " ‖ ",
    f1(canon.cagr).padStart(7), f1(canon.mdd).padStart(7), canon.mar.toFixed(2).padStart(5), (canon.sharpe ?? 0).toFixed(2).padStart(7),
    f1(canon.cagrA).padStart(8), f1(canon.cagrB).padStart(8), canon.tradesYr.toFixed(0).padStart(6), f1(canon.winrate, 0).padStart(5));
}

// ─── selección: máx rentabilidad OOS sujeta a robustez (suelo = fijo 30%) ────
const fijo30 = results.find((r) => r.label === "fijo 30%");
const champ = results[0];
console.log(`\nSuelo de robustez (fijo 30%): celda mínima ${f1(fijo30.minC)} · mediana ${f1(fijo30.medC)}`);
const eligible = results.filter((r) => r.label !== "CAMPEÓN (sin trailing)" && r.minC >= fijo30.minC - 1e-9);
eligible.sort((a, b) => b.canon.cagrB - a.canon.cagrB);
console.log("\n=== ELEGIBLES (celda mínima ≥ fijo30), ordenadas por CAGR de la 2ª mitad (OOS) ===");
for (const r of eligible) {
  console.log(`  ${r.label.padEnd(34)} 2ªmit ${f1(r.canon.cagrB).padStart(7)} · CAGR ${f1(r.canon.cagr)} · MaxDD ${f1(r.canon.mdd)} · MAR ${r.canon.mar.toFixed(2)} · mín ${f1(r.minC)} · med ${f1(r.medC)}`);
}
console.log("\n=== Dominancia vs campeón sin trailing (celda a celda) — mejores 8 por mediana ===");
for (const r of [...results.slice(1)].sort((a, b) => b.medC - a.medC).slice(0, 8)) {
  let wins = 0;
  for (let i = 0; i < 9; i++) if (r.cells[i] > champ.cells[i]) wins++;
  console.log(`  ${r.label.padEnd(34)} gana ${wins}/9 · mediana ${f1(r.medC)} · mín ${f1(r.minC)}`);
}

// ─── PARTE C: AJUSTE POR TICKER CON SHRINKAGE (multiplicador k del ATR) ──────
{
  console.log("\n═══ C) k POR TICKER CON SHRINKAGE HACIA EL GLOBAL ═══");
  const KS = [6, 8, 10, 12, 14];
  const eps = [];
  for (let i = 280; i <= TO - 40; i += 21) {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands.slice(0, 10)) {
      const t = T[c.ti], entry = t.adj[i];
      const cap = KS.map((k) => {
        const w = atrK(c.f, k, 12, 45);
        let peak = entry, out = null;
        for (let j = i + 1; j <= Math.min(i + 252, TO); j++) {
          const px = t.adj[j]; if (!isNum(px)) continue;
          if (px > peak) peak = px;
          if (px <= peak * (1 - w)) { out = px / entry - 1; break; }
        }
        if (out == null) for (let j = Math.min(i + 252, TO); j > i; j--) if (isNum(t.adj[j])) { out = t.adj[j] / entry - 1; break; }
        return out;
      });
      eps.push({ i, sym: t.sym, cap });
    }
  }
  const SPLIT = 280 + Math.floor((TO - 280) / 2);
  const capMean = (rows, ki) => mean(rows.map((e) => e.cap[ki]).filter(isNum));
  const argmaxK = (rows) => { let bi = 0, bv = -Infinity; for (let ki = 0; ki < KS.length; ki++) { const v = capMean(rows, ki); if (isNum(v) && v > bv) { bv = v; bi = ki; } } return bi; };
  const h1 = eps.filter((e) => e.i < SPLIT), h2 = eps.filter((e) => e.i >= SPLIT);
  const kGlobIdx = argmaxK(h1);
  console.log(`Episodios: ${eps.length} · k global óptimo en 1ª mitad: ${KS[kGlobIdx]} (capturado ${f1(capMean(h1, kGlobIdx))})`);
  const bySym = new Map();
  for (const e of eps) { if (!bySym.has(e.sym)) bySym.set(e.sym, { h1: [], h2: [] }); (e.i < SPLIT ? bySym.get(e.sym).h1 : bySym.get(e.sym).h2).push(e); }
  const kOpt1 = [], kOpt2 = [];
  const perf = { global: [], perTicker: [], shrunk3: [], shrunk8: [] };
  let usable = 0;
  const nearestKi = (kv) => { let bi = 0, bd = Infinity; for (let ki = 0; ki < KS.length; ki++) { const d2 = Math.abs(KS[ki] - kv); if (d2 < bd) { bd = d2; bi = ki; } } return bi; };
  for (const [, b] of bySym) {
    if (b.h1.length < 3 || b.h2.length < 3) continue;
    usable++;
    const k1 = argmaxK(b.h1), k2 = argmaxK(b.h2);
    kOpt1.push(KS[k1]); kOpt2.push(KS[k2]);
    const n1 = b.h1.length;
    const w2 = b.h2.length; // peso por muestra OOS
    const push = (arr, ki) => { const v = capMean(b.h2, ki); if (isNum(v)) arr.push({ v, w: w2 }); };
    push(perf.global, kGlobIdx);
    push(perf.perTicker, k1);
    push(perf.shrunk3, nearestKi((n1 * KS[k1] + 3 * KS[kGlobIdx]) / (n1 + 3)));
    push(perf.shrunk8, nearestKi((n1 * KS[k1] + 8 * KS[kGlobIdx]) / (n1 + 8)));
  }
  const wMean = (rows) => { const sw = rows.reduce((s, r) => s + r.w, 0) || 1; return rows.reduce((s, r) => s + r.v * r.w, 0) / sw; };
  const rho = spearman(kOpt1, kOpt2);
  console.log(`Tickers con ≥3 episodios en cada mitad: ${usable} · estabilidad k-óptimo (Spearman 1ª↔2ª): ${rho == null ? "—" : rho.toFixed(2)}`);
  console.log(`Capturado medio 2ª mitad (ponderado por episodios):`);
  console.log(`  k GLOBAL (${KS[kGlobIdx]}):        ${f1(wMean(perf.global))}`);
  console.log(`  k por ticker (sin shrink): ${f1(wMean(perf.perTicker))}`);
  console.log(`  k shrinkage m=3:           ${f1(wMean(perf.shrunk3))}`);
  console.log(`  k shrinkage m=8:           ${f1(wMean(perf.shrunk8))}`);
  OUT.shrinkage = { usable, rho, kGlobal: KS[kGlobIdx],
    captGlobal: wMean(perf.global), captPerTicker: wMean(perf.perTicker),
    captShrunk3: wMean(perf.shrunk3), captShrunk8: wMean(perf.shrunk8) };
}

// ─── LOS 10 DE HOY con su stop por política (dispersión visible) ─────────────
{
  console.log("\n═══ LOS 10 DE HOY — stop sugerido por ticker (política ATR y ATR×salud) ═══");
  const last = TO;
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti], f = t.feat[last];
    if (!f || !isNum(t.adj[last])) continue;
    const s = scoreV4(f);
    if (s != null) cands.push({ ti, s, f });
  }
  cands.sort((a, b) => b.s - a.s);
  console.log("Ticker".padEnd(14), "ATR%".padStart(6), "salud".padStart(6), "k10[12,45]".padStart(11), "k10×salud".padStart(10), "SALUD 15..45".padStart(13));
  for (const c of cands.slice(0, 10)) {
    const t = T[c.ti], f = c.f;
    const row = { sym: t.sym, atrProd: f.atrProd, health: health(f),
      k10: atrK(f, 10, 12, 45), k10h: mkAtrHealth(10, 12, 45)(f), hl: mkHealthLin(15, 45)(f) };
    OUT.hoy.push(row);
    console.log(t.sym.padEnd(14), (f.atrProd ?? 0).toFixed(1).padStart(6), row.health.toFixed(2).padStart(6),
      f1(row.k10, 0).padStart(11), f1(row.k10h, 0).padStart(10), f1(row.hl, 0).padStart(13));
  }
}

OUT.politicas = results.map((r) => ({ label: r.label, cells: r.cells, minC: r.minC, medC: r.medC, canon: r.canon }));
fs.writeFileSync("backtests/rally-adaptive-stop-study.json", JSON.stringify(OUT, null, 1));
console.log("\nGuardado: backtests/rally-adaptive-stop-study.json");
