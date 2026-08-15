/**
 * RALLY — ESTUDIO 1: ¿VENTANA DE BACKTEST ANCLADA AL RÉGIMEN ALCISTA DE CADA TICKER?
 * ===================================================================================
 * Hipótesis de Sergi: la mayoría del universo son valores del boom de IA cuyos
 * gráficos solo despegaron hace pocos años; backtestear con ~10 años fijos mezcla
 * años "muertos" con el rally real. ¿Salen parámetros MEJORES (más robustos, no solo
 * más bonitos en muestra) si cada ticker se ancla al inicio de su tendencia real?
 *
 * Detección de régimen (sin lookahead): cierre > SMA200 con SMA200 subiendo a 20
 * sesiones vista, SOSTENIDO (≥45 de las últimas 50 sesiones lo cumplen).
 *
 * Tres experimentos, todos con walk-forward:
 *   A) Radiografía del universo: cuándo empezó el régimen vigente de cada ticker y
 *      cuánto del top-10 del scanner está ya en régimen (¿el anclaje cambia algo?).
 *   B) Calibración de la ANCHURA del trailing con episodios de entrada al top-10:
 *      muestra completa vs muestra solo-régimen, 3 cortes walk-forward. ¿Cuál ventana
 *      elige la anchura que mejor funciona DESPUÉS (fuera de muestra)?
 *   C) Elección del LOOKBACK del momento (3/6/9/12m) backtesteando IS con ventana
 *      completa vs ventana-régimen; se despliega en OOS y se mide el gap de sobreajuste.
 *
 * Salida: backtests/rally-regime-window-study.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, evalCurve, cagrOf, scoreV4, isNum, mean, f1, clamp, spearman,
} from "./rally-study-lib.mjs";

console.log("Cargando universo…");
const { T, dates, D, spyClose } = loadUniverse();
console.log(`Tickers: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);

const FROM = 280, TO = D - 1;
const OUT = { ranAt: new Date().toISOString(), regimen: {}, episodios: {}, lookback: {}, porTicker: {} };

// ═══ A) RADIOGRAFÍA DEL RÉGIMEN ══════════════════════════════════════════════
{
  const last = TO;
  let inReg = 0; const startYears = {};
  for (const t of T) {
    const f = t.feat[last] ?? t.feat[last - 1] ?? t.feat[last - 2];
    if (!f) continue;
    if (f.inRegime) {
      inReg++;
      const startIdx = Math.max(0, last - f.regAge + 1);
      const y = dates[startIdx].slice(0, 4);
      startYears[y] = (startYears[y] ?? 0) + 1;
    }
  }
  // ¿cuánto del top-10 histórico ya estaba en régimen? (si es ~100%, anclar no cambia la selección)
  let picks = 0, picksInReg = 0; const regAges = [];
  for (let i = FROM; i <= TO; i += 21) {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ s, f });
    }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands.slice(0, 10)) { picks++; if (c.f.inRegime) { picksInReg++; regAges.push(c.f.regAge); } }
  }
  OUT.regimen = {
    universoEnRegimen: inReg, universoTotal: T.length,
    aniosInicioRegimenVigente: startYears,
    pctTop10EnRegimen: picksInReg / Math.max(1, picks),
    edadMedianaRegimenTop10: regAges.sort((a, b) => a - b)[Math.floor(regAges.length / 2)] ?? null,
  };
  console.log("═══ A) RADIOGRAFÍA DEL RÉGIMEN ═══");
  console.log(`En régimen alcista HOY: ${inReg}/${T.length} tickers (${f1(inReg / T.length, 0)})`);
  console.log("Año de inicio del régimen vigente:", Object.entries(startYears).sort().map(([y, n]) => `${y}:${n}`).join("  "));
  console.log(`Top-10 del scanner ya en régimen: ${f1(picksInReg / Math.max(1, picks))} de ${picks} entradas históricas · edad mediana del régimen ${OUT.regimen.edadMedianaRegimenTop10} sesiones\n`);
}

// ═══ B) CALIBRACIÓN DE ANCHURA DEL TRAILING: ventana completa vs ventana-régimen ═══
// Episodios de entrada al top-10 cada 21 sesiones; cada uno se simula con todas las
// anchuras de la parrilla (stop sobre el máximo del cierre ajustado desde la entrada).
const WIDTHS = [0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const MAX_HOLD = 252;

const episodes = [];
for (let i = FROM; i <= TO - 40; i += 21) {
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
    const entry = t.adj[i];
    const cap = new Array(WIDTHS.length).fill(null);
    const dias = new Array(WIDTHS.length).fill(null);
    let maxAdverse = 0;
    { // máximo retroceso desde la entrada (sin stop) en 63 sesiones — para el riesgo
      let peak = entry;
      for (let j = i + 1; j <= Math.min(i + 63, TO); j++) {
        const px = t.adj[j]; if (!isNum(px)) continue;
        if (px > peak) peak = px;
        maxAdverse = Math.max(maxAdverse, 1 - px / peak);
      }
    }
    for (let w = 0; w < WIDTHS.length; w++) {
      let peak = entry, exitPx = null, exitIdx = null;
      for (let j = i + 1; j <= Math.min(i + MAX_HOLD, TO); j++) {
        const px = t.adj[j]; if (!isNum(px)) continue;
        if (px > peak) peak = px;
        if (px <= peak * (1 - WIDTHS[w])) { exitPx = px; exitIdx = j; break; }
      }
      if (exitIdx == null) for (let j = Math.min(i + MAX_HOLD, TO); j > i; j--) if (isNum(t.adj[j])) { exitPx = t.adj[j]; exitIdx = j; break; }
      if (exitIdx == null) continue;
      cap[w] = exitPx / entry - 1;
      dias[w] = exitIdx - i;
    }
    episodes.push({ i, sym: t.sym, inRegime: c.f.inRegime, regAge: c.f.regAge, cap, dias, maxAdverse });
  }
}
console.log(`═══ B) EPISODIOS: ${episodes.length} entradas al top-10 (cada 21 sesiones) · ${f1(mean(episodes.map((e) => e.inRegime ? 1 : 0)), 0)} en régimen ═══`);

const capMean = (eps, w) => mean(eps.map((e) => e.cap[w]).filter(isNum));
function bestWidth(eps) {
  let bw = 0, bv = -Infinity;
  for (let w = 0; w < WIDTHS.length; w++) { const v = capMean(eps, w); if (isNum(v) && v > bv) { bv = v; bw = w; } }
  return { w: bw, v: bv };
}

// walk-forward: 3 cortes por índice de calendario
const cutAt = (frac) => FROM + Math.floor((TO - FROM) * frac);
const FOLDS = [
  { name: "corte 45%", isEnd: cutAt(0.45), oosEnd: cutAt(0.65) },
  { name: "corte 65%", isEnd: cutAt(0.65), oosEnd: cutAt(0.85) },
  { name: "corte 85%", isEnd: cutAt(0.85), oosEnd: TO },
];
OUT.episodios.folds = [];
console.log("\nFold        muestra IS      anchura óptima IS   capt.IS      capt.OOS (misma anchura)   rho IS↔OOS");
for (const fold of FOLDS) {
  const isAll = episodes.filter((e) => e.i < fold.isEnd);
  const isReg = isAll.filter((e) => e.inRegime);
  const oos = episodes.filter((e) => e.i >= fold.isEnd && e.i < fold.oosEnd);
  if (!oos.length) continue;
  const oosCurve = WIDTHS.map((_, w) => capMean(oos, w));
  const rows = [];
  for (const [tag, eps] of [["completa", isAll], ["régimen", isReg]]) {
    const { w, v } = bestWidth(eps);
    const isCurve = WIDTHS.map((_, wi) => capMean(eps, wi));
    const rho = spearman(isCurve, oosCurve);
    const oosV = capMean(oos, w);
    rows.push({ ventana: tag, n: eps.length, anchura: WIDTHS[w], captIS: v, captOOS: oosV, gap: v - oosV, rho });
    console.log(`${fold.name.padEnd(10)} ${tag.padEnd(9)} n=${String(eps.length).padStart(5)}   ${f1(WIDTHS[w], 0).padStart(6)}          ${f1(v).padStart(7)}      ${f1(oosV).padStart(7)} (gap ${f1(v - oosV)})            ${rho == null ? "—" : rho.toFixed(2)}`);
  }
  OUT.episodios.folds.push({ ...fold, oosN: oos.length, rows, oosCurve: Object.fromEntries(WIDTHS.map((wd, w) => [wd, oosCurve[w]])) });
}

// curvas completas por ventana (informativo): capturado medio por anchura
{
  const SPLIT = cutAt(0.5);
  const h1 = episodes.filter((e) => e.i < SPLIT), h2 = episodes.filter((e) => e.i >= SPLIT);
  console.log("\nCapturado medio por anchura (episodios; 1ª mitad ‖ 2ª mitad ‖ solo-régimen 1ª ‖ solo-régimen 2ª):");
  const table = {};
  for (let w = 0; w < WIDTHS.length; w++) {
    const a = capMean(h1, w), b = capMean(h2, w);
    const ar = capMean(h1.filter((e) => e.inRegime), w), br = capMean(h2.filter((e) => e.inRegime), w);
    table[WIDTHS[w]] = { h1: a, h2: b, h1reg: ar, h2reg: br };
    console.log(`  ${f1(WIDTHS[w], 0).padStart(4)}   ${f1(a).padStart(7)} ‖ ${f1(b).padStart(7)} ‖ ${f1(ar).padStart(7)} ‖ ${f1(br).padStart(7)}`);
  }
  OUT.episodios.porAnchura = table;
}

// ═══ C) LOOKBACK DEL MOMENTO: backtest IS completo vs anclado al régimen → OOS ═══
console.log("\n═══ C) ELECCIÓN DEL LOOKBACK (3/6/9/12m): ventana completa vs ventana-régimen ═══");
const LOOKBACKS = [["3m", (f) => f.m3], ["6m", (f) => f.m6], ["9m", (f) => f.m9], ["12m", (f) => f.m12]];
const mkScore = (get) => (f) => { const v = get(f); return isNum(v) ? clamp(50 + 50 * Math.tanh(v / 75)) : null; };

function runPortfolio(scoreFn, from, to, restrictRegime) {
  const r = simulate(T, D, {
    FROM: from, TO: to, review: 84, conviction: false, widthOf: null,
    scoreFn, eligible: restrictRegime ? (f) => f.inRegime : null,
  });
  const y = (to - from) / 252;
  const cagr = Math.pow(r.curve[to], 1 / y) - 1;
  let peak = 0, mdd = 0;
  for (let i = from; i <= to; i++) { if (r.curve[i] == null) continue; peak = Math.max(peak, r.curve[i]); mdd = Math.max(mdd, 1 - r.curve[i] / peak); }
  return { cagr, mdd };
}

OUT.lookback.folds = [];
for (const isFrac of [0.5, 0.7]) {
  const CUT = cutAt(isFrac);
  console.log(`\n— Corte IS/OOS al ${Math.round(isFrac * 100)}% (${dates[CUT]}) —`);
  console.log("Lookback   IS completa   IS régimen   ‖   OOS sin filtro   OOS con filtro régimen");
  const rows = [];
  for (const [name, get] of LOOKBACKS) {
    const sf = mkScore(get);
    const isFull = runPortfolio(sf, FROM, CUT, false);
    const isReg = runPortfolio(sf, FROM, CUT, true);
    const oosFull = runPortfolio(sf, CUT, TO, false);
    const oosReg = runPortfolio(sf, CUT, TO, true);
    rows.push({ name, isFull: isFull.cagr, isReg: isReg.cagr, oosFull: oosFull.cagr, oosReg: oosReg.cagr });
    console.log(`  ${name.padEnd(6)} ${f1(isFull.cagr).padStart(10)} ${f1(isReg.cagr).padStart(11)}   ‖ ${f1(oosFull.cagr).padStart(13)} ${f1(oosReg.cagr).padStart(18)}`);
  }
  const pickFull = rows.reduce((a, b) => (b.isFull > a.isFull ? b : a));
  const pickReg = rows.reduce((a, b) => (b.isReg > a.isReg ? b : a));
  console.log(`  ELECCIÓN ventana completa: ${pickFull.name} → OOS ${f1(pickFull.oosFull)} (gap sobreajuste ${f1(pickFull.isFull - pickFull.oosFull)})`);
  console.log(`  ELECCIÓN ventana régimen:  ${pickReg.name} → OOS ${f1(pickReg.oosFull)} desplegado sin filtro · ${f1(pickReg.oosReg)} con filtro (gap ${f1(pickReg.isReg - pickReg.oosReg)})`);
  OUT.lookback.folds.push({ isFrac, cutDate: dates[CUT], rows, pickFull: pickFull.name, pickReg: pickReg.name });
}

// ═══ D) PER-TICKER: ¿la anchura óptima por ticker es estable? completa vs régimen ═══
console.log("\n═══ D) ANCHURA ÓPTIMA POR TICKER: estabilidad entre mitades ═══");
{
  const SPLIT = cutAt(0.5);
  const bySym = new Map();
  for (const e of episodes) {
    if (!bySym.has(e.sym)) bySym.set(e.sym, { h1: [], h2: [], h1r: [], h2r: [] });
    const b = bySym.get(e.sym);
    (e.i < SPLIT ? b.h1 : b.h2).push(e);
    if (e.inRegime) (e.i < SPLIT ? b.h1r : b.h2r).push(e);
  }
  const wF1 = [], wF2 = [], wR1 = [], wR2 = [];
  let capPerTickerFull = [], capPerTickerReg = [], capGlobal = [];
  const { w: gw } = bestWidth(episodes.filter((e) => e.i < SPLIT));
  let usable = 0;
  for (const [sym, b] of bySym) {
    if (b.h1.length < 5 || b.h2.length < 5) continue;
    usable++;
    const f1w = bestWidth(b.h1).w, f2w = bestWidth(b.h2).w;
    wF1.push(f1w); wF2.push(f2w);
    if (b.h1r.length >= 5 && b.h2r.length >= 5) { wR1.push(bestWidth(b.h1r).w); wR2.push(bestWidth(b.h2r).w); }
    // despliegue: usar la anchura calibrada en h1 sobre los episodios de h2
    capPerTickerFull.push(capMean(b.h2, f1w));
    if (b.h1r.length >= 5) capPerTickerReg.push(capMean(b.h2, bestWidth(b.h1r).w));
    capGlobal.push(capMean(b.h2, gw));
  }
  const rhoFull = spearman(wF1, wF2), rhoReg = spearman(wR1, wR2);
  console.log(`Tickers con ≥5 episodios en cada mitad: ${usable}`);
  console.log(`Estabilidad de la anchura óptima por ticker (Spearman 1ª↔2ª mitad): completa ${rhoFull == null ? "—" : rhoFull.toFixed(2)} · régimen ${rhoReg == null ? "—" : rhoReg.toFixed(2)}`);
  console.log(`Capturado medio en 2ª mitad: anchura por-ticker (completa) ${f1(mean(capPerTickerFull.filter(isNum)))} · por-ticker (régimen) ${f1(mean(capPerTickerReg.filter(isNum)))} · anchura GLOBAL ${f1(mean(capGlobal.filter(isNum)))}`);
  OUT.porTicker = {
    usable, rhoFull, rhoReg,
    captH2PerTickerFull: mean(capPerTickerFull.filter(isNum)),
    captH2PerTickerReg: mean(capPerTickerReg.filter(isNum)),
    captH2Global: mean(capGlobal.filter(isNum)),
    globalWidth: WIDTHS[gw],
  };
}

fs.writeFileSync("backtests/rally-regime-window-study.json", JSON.stringify(OUT, null, 1));
console.log("\nGuardado: backtests/rally-regime-window-study.json");
