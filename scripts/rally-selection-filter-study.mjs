/**
 * RALLY — ESTUDIO 7: FILTROS DE EXCLUSIÓN POR ESTADO EN LA SELECCIÓN DEL TOP-10
 * =============================================================================
 * PREGUNTA (Sergi, 17-ago-2026): los tickers que entran al top-10 con recorrido
 * bajista (runway BAJO), en máximos (zona EN_MAXIMOS) o con estructura rota
 * (precio < EMA50 — el warning BELOW_EMA50 de producción) ¿deberían quedar FUERA
 * del top-10, sustituidos por los siguientes del ranking (11º, 12º, …)? ¿Sube
 * eso la rentabilidad? Variable NUNCA probada antes: exclusión por estado en la
 * SELECCIÓN (los estudios previos probaron ponderar por estado —±0,5 pp, nada—
 * y exigir IDEAL en la ROTACIÓN —destruye ~10 pp—, pero no vetar en selección).
 *
 * ESTADOS (réplicas EXACTAS de producción, api/_lib/rallyScoreEngine.js):
 *   BAJO        runwayScore(f) < 55        (level: ≥75 ALTO, ≥55 MEDIO, resto BAJO)
 *   EN_MAXIMOS  prox52w > 0,997            (computeEntryTiming)
 *   BELOW_EMA50 precio < EMA50 estricto    (computeWarningFlags → ext50 < 0)
 * Todos medidos el DÍA DE REVISIÓN con datos ≤ ese día (sin lookahead).
 *
 * MECÁNICA DEL FILTRO EN SELECCIÓN: se recorre el ranking por score v4 (mismo
 * desempate por m9 de producción) SALTANDO los que incumplen; los huecos los
 * rellenan los siguientes elegibles (11º, 12º, …) hasta 10. DECISIÓN DE DISEÑO:
 * si un día hubiera <10 elegibles en todo el universo, se completa con los
 * mejores NO elegibles (cartera siempre de 10 — aísla la pregunta de sustitución
 * del market-timing implícito de quedarse en liquidez); se cuenta cada vez que
 * pasa. Implementación: scoreFn penalizado (score−1000 si excluido) — preserva
 * bit a bit el orden dentro de cada grupo y el desempate.
 *
 * C0 (producción certificada 17-ago-2026, auditoría conjunta rally-joint-study):
 *   top-10 por score v4 · revisión 84 sesiones · stop clamp(12+0,35·runway,15,45)%
 *   re-fijado por revisión · al saltar el stop, rotación al mejor por
 *   0,7·score+0,3·recorrido y el sustituto HEREDA el peso · pesos M9_RAW
 *   clamp(max(1,m9)·t, 4, 20) con Σ=100 · costes 20 pb/lado.
 *
 * VARIANTES (filtro aplicado en selección Y en el candidato de rotación, salvo
 * indicación — coherencia; F3 además se descompone solo-selección/solo-rotación):
 *   F0          control = C0 sin filtro (regresión bit a bit vs M9_RAW guardado)
 *   F1          excluir runway BAJO
 *   F2          excluir EN_MAXIMOS
 *   F3          excluir precio<EMA50 (la hipótesis más fuerte del usuario)
 *   F3_SOLO_SEL F3 solo en selección (rotación C0 sin filtro)
 *   F3_SOLO_ROT F3 solo en rotación (selección C0 sin filtro)
 *   F3B         excluir precio<0,98·EMA50 (margen −2%: "claramente rota")
 *   F4          excluir (BAJO Y EN_MAXIMOS) simultáneos (el caso literal del usuario)
 *   F5          excluir (BAJO O precio<EMA50)
 *   F6          SUAVE: sin excluir, el que está bajo EMA50 entra al peso mínimo
 *               (4%) y el excedente se reparte al resto (capNormalize al objetivo
 *               100−4k con topes [4,20]; si k≥7 no es factible → pesos estándar,
 *               se cuenta). Rotación C0 (el sustituto hereda peso, sin filtro).
 *   F7          excluir (BAJO O EN_MAXIMOS O precio<EMA50) — unión de los tres
 *               estados que nombra el usuario (la más estricta)
 *
 * PROTOCOLO (idéntico a rally-joint-study.mjs): señales sobre cierre ajustado,
 * split train 2017-08→2021-12 vs CONFIRMACIÓN 2022-01→2026-08, malla 9 celdas
 * (fases 260/280/300 × cadencias 63/84/105, canónica 260/84), métricas
 * CAGR/MaxDD/MAR por tramo, peor-celda = mín de las 9 CAGR del tramo.
 *
 * GATE PRE-REGISTRADO para cambiar (vs F0, todo en confirmación):
 *   1) CAGR canónica MAYOR  Y  peor-celda MAYOR
 *   2) mejora MATERIAL: ΔCAGR ≥ +2 pp  O  ΔMAR ≥ +0,08
 *   3) MaxDD ≤ referencia + 5 pp
 *   4) entre passers se elige POR TRAIN (peor-celda train, desempate CAGR train
 *      canónica) — nunca por el test. PARSIMONIA: sin dominancia → MANTENER_ACTUAL.
 *
 * ANÁLISIS DEL CASO DEL USUARIO (responde la pregunta PASE O NO el gate):
 * sobre el calendario canónico (FROM 260, revisiones cada 84), para cada miembro
 * del top-10 SIN filtro: estado al entrar y retorno forward de 84 sesiones
 * (buy&hold del cierre ajustado, ventanas completas). Se compara con-estado vs
 * sin-estado vs media del top-10 del MISMO día (exceso mismo-día = control de
 * régimen), y excluidos vs los 11º-12º… que les habrían sustituido ese día.
 * NOTA: el forward ignora stops/rotación a propósito — aísla la calidad de la
 * SELECCIÓN; el efecto con stops+rotación lo miden las simulaciones completas.
 *
 * HECHOS PREVIOS QUE ESTE ESTUDIO PONE A PRUEBA (no contradecir sin números):
 *   · "en máximos" retrocede MENOS (intuición invertida — estudio de stops)
 *   · exigir IDEAL en la ROTACIÓN destruye ~10 pp (F-rotación mide análogos)
 *   · ponderar por TIMING/zona no aporta (±0,5 pp)
 * Determinista, sin lookahead, sin aleatoriedad. No toca api/ ni src/.
 * Salida: backtests/rally-selection-filter-study.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, buyHolds, scoreV4, runwayScore,
  isNum, clamp, f1, mean, sd,
} from "./rally-study-lib.mjs";

const t0 = Date.now();
console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D, spyClose } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones)`);
console.log(`Split train/confirmación: índice ${SPLIT} = ${dates[SPLIT]}\n`);

// ─── estados (réplica exacta de producción) ──────────────────────────────────
const isBajo = (f) => runwayScore(f) < 55;                       // level BAJO
const isMax = (f) => f.prox != null && f.prox > 0.997;           // zone EN_MAXIMOS
const isBelow = (f) => f.ext50 != null && f.ext50 < 0;           // warning BELOW_EMA50
const isBelow2 = (f) => f.ext50 != null && f.ext50 < -0.02;      // margen −2%

const STATES = {
  BAJO: isBajo,
  EN_MAXIMOS: isMax,
  BELOW_EMA50: isBelow,
  BAJO_Y_EN_MAXIMOS: (f) => isBajo(f) && isMax(f),
};

// ─── piezas C0 ───────────────────────────────────────────────────────────────
const stopH4 = (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45) / 100;

/** capNormalize exacto de producción/estudios (objetivo parametrizado; a 100 es bit a bit el de rally-weighting/joint). */
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

/** Salto MIX70 de producción con filtro opcional: el mejor por 0,7·score+0,3·recorrido
 *  entre los elegibles; si NINGÚN elegible (≈imposible con 600 tickers), el mejor
 *  global (fallback contado). Con excl=null es bit-idéntico al bestBy del joint-study. */
function makePickJump(excl, counters) {
  return (i, heldSet) => {
    let bi = null, bv = -Infinity, fbi = null, fbv = -Infinity;
    for (let ti = 0; ti < T.length; ti++) {
      if (heldSet.has(ti)) continue;
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s == null) continue;
      const v = 0.7 * s + 0.3 * runwayScore(f);
      if (v > fbv) { fbv = v; fbi = ti; }
      if (excl && excl(f)) continue;
      if (v > bv) { bv = v; bi = ti; }
    }
    if (bi == null && fbi != null) { counters.jumpFallback++; return fbi; }
    return bi;
  };
}

// ─── métricas por tramo (idéntico a rally-joint-study.mjs) ───────────────────
function segMetrics(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
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

// ─── una variante = {selExcl, rotExcl, soft} + su malla 9 celdas ─────────────
const PHASES = [260, 280, 300];
const STD_REVIEWS = [63, 84, 105];

function runCell(v, FROM, review) {
  const counters = { jumpFallback: 0, f6Infeasible: 0, selFillFallback: 0 };
  const scoreFn = v.selExcl
    ? (f) => { const s = scoreV4(f); if (s == null) return null; return v.selExcl(f) ? s - 1000 : s; }
    : scoreV4;
  const weightsOf = v.soft
    ? (top) => {
        const n = top.length;
        const flags = top.map((c) => isBelow(c.f));
        const k = flags.filter(Boolean).length;
        const nOk = n - k, target = 100 - 4 * k;
        let ws;
        if (k === 0) ws = wM9(top);
        else if (!(nOk > 0 && nOk * 4 <= target && nOk * 20 >= target)) { counters.f6Infeasible++; ws = wM9(top); }
        else {
          const okIdx = [], okRaw = [];
          top.forEach((c, j) => { if (!flags[j]) { okIdx.push(j); okRaw.push(Math.max(1, c.f.m9 ?? 1)); } });
          const okW = capNormalizeTarget(okRaw, 4, 20, target);
          ws = new Array(n).fill(4);
          okIdx.forEach((j, q) => { ws[j] = okW[q]; });
        }
        const sum = ws.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 1e-6) throw new Error(`pesos no suman 100 (${sum})`);
        return ws;
      }
    : (top) => {
        const ws = wM9(top);
        // detección del relleno con no-elegibles (score penalizado < 0 en el top)
        if (v.selExcl && top.some((c) => c.s < 0)) counters.selFillFallback++;
        const sum = ws.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 1e-6) throw new Error(`pesos no suman 100 (${sum})`);
        return ws;
      };
  const r = simulate(T, D, {
    FROM, review, topN: 10, conviction: true,
    widthOf: stopH4, pickJump: makePickJump(v.rotExcl ?? null, counters), weightsOf, scoreFn,
  });
  return {
    train: segMetrics(r.curve, FROM, SPLIT),
    confirm: segMetrics(r.curve, SPLIT, TO),
    full: segMetrics(r.curve, FROM, TO),
    sim: r, counters,
  };
}

function runVariant(v) {
  const cells = [];
  let canon = null, canonCurve = null;
  for (const FROM of PHASES) for (const review of STD_REVIEWS) {
    const c = runCell(v, FROM, review);
    cells.push({ FROM, review, train: c.train, confirm: c.confirm, full: c.full, counters: c.counters });
    if (FROM === 260 && review === 84) {
      const years = (TO - FROM) / 252;
      const r = c.sim;
      canon = {
        train: c.train, confirm: c.confirm, full: c.full,
        tradesYr: r.trades / years, jumps: r.jumpCount,
        winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open),
        counters: c.counters,
      };
      canonCurve = r.curve;
    }
  }
  const trC = cells.map((c) => c.train.cagr), cfC = cells.map((c) => c.confirm.cagr);
  const sorted = [...cfC].sort((a, b) => a - b);
  return {
    ...v, cells, canon, canonCurve,
    worstTrain: Math.min(...trC), worstConfirm: Math.min(...cfC),
    medianConfirm: sorted[4], sdCellsConfirm: sd(cfC), sdCellsTrain: sd(trC),
  };
}

// ─── definición de variantes ─────────────────────────────────────────────────
const anyState = (f) => isBajo(f) || isMax(f) || isBelow(f);
const bajoOrBelow = (f) => isBajo(f) || isBelow(f);
const bajoAndMax = (f) => isBajo(f) && isMax(f);
const VARIANTS = [
  { name: "F0", filtro: "sin filtro (control = C0)", selExcl: null, rotExcl: null, soft: false },
  { name: "F1", filtro: "excluir runway BAJO (sel+rot)", selExcl: isBajo, rotExcl: isBajo, soft: false },
  { name: "F2", filtro: "excluir EN_MAXIMOS (sel+rot)", selExcl: isMax, rotExcl: isMax, soft: false },
  { name: "F3", filtro: "excluir precio<EMA50 (sel+rot)", selExcl: isBelow, rotExcl: isBelow, soft: false },
  { name: "F3_SOLO_SEL", filtro: "excluir precio<EMA50 SOLO selección", selExcl: isBelow, rotExcl: null, soft: false },
  { name: "F3_SOLO_ROT", filtro: "excluir precio<EMA50 SOLO rotación", selExcl: null, rotExcl: isBelow, soft: false },
  { name: "F3B", filtro: "excluir precio<0,98·EMA50 (sel+rot)", selExcl: isBelow2, rotExcl: isBelow2, soft: false },
  { name: "F4", filtro: "excluir BAJO∧EN_MAXIMOS (sel+rot)", selExcl: bajoAndMax, rotExcl: bajoAndMax, soft: false },
  { name: "F5", filtro: "excluir BAJO∨precio<EMA50 (sel+rot)", selExcl: bajoOrBelow, rotExcl: bajoOrBelow, soft: false },
  { name: "F6", filtro: "SUAVE: bajo-EMA50 al 4% fijo, excedente al resto (sel; rot C0)", selExcl: null, rotExcl: null, soft: true },
  { name: "F7", filtro: "excluir BAJO∨EN_MAXIMOS∨precio<EMA50 (sel+rot)", selExcl: anyState, rotExcl: anyState, soft: false },
];

// ─── CONTROL DE REGRESIÓN: F0 ≡ M9_RAW guardado (canónica + 9 celdas) ────────
const REF = JSON.parse(fs.readFileSync("backtests/rally-weighting-study.json", "utf8"));
const refM9 = REF.esquemas.find((e) => e.name === "M9_RAW");
const results = {};
const F0 = runVariant(VARIANTS[0]);
results.F0 = F0;
{
  const close = (a, b, w) => { if (Math.abs(a - b) > 1e-9) throw new Error(`REGRESIÓN ${w}: ${a} ≠ ${b}`); };
  close(F0.canon.confirm.cagr, refM9.canon.confirm.cagr, "canon confirm CAGR");
  close(F0.canon.train.cagr, refM9.canon.train.cagr, "canon train CAGR");
  close(F0.canon.full.cagr, refM9.canon.full.cagr, "canon full CAGR");
  close(F0.canon.confirm.mdd, refM9.canon.confirm.mdd, "canon confirm MaxDD");
  for (const rc of refM9.cells) {
    const mc = F0.cells.find((c) => c.FROM === rc.FROM && c.review === rc.review);
    close(mc.train.cagr, rc.train.cagr, `celda ${rc.FROM}/${rc.review} train`);
    close(mc.confirm.cagr, rc.confirm.cagr, `celda ${rc.FROM}/${rc.review} confirm`);
  }
  console.log("CONTROL DE REGRESIÓN: F0 ≡ C0/M9_RAW guardado (canónica + 9 celdas, tol 1e-9). OK\n");
}

// ─── tabla principal ─────────────────────────────────────────────────────────
console.log("═══ VARIANTES — malla 9 celdas (train 17-21 ‖ CONFIRMACIÓN 22-26; canónica fase 260 · rev 84) ═══");
console.log(["Variante".padEnd(13), "‖ trCAGR".padStart(9), "trPEOR".padStart(8), "‖ cfCAGR".padStart(9), "cfMaxDD".padStart(8), "cfMAR".padStart(6), "cfPEOR".padStart(8), "cfMED".padStart(8), "sdCf".padStart(6), "ops/a".padStart(6), "saltos".padStart(7)].join(" "));
const printRow = (r) => console.log([r.name.padEnd(13), f1(r.canon.train.cagr).padStart(9), f1(r.worstTrain).padStart(8),
  f1(r.canon.confirm.cagr).padStart(9), f1(r.canon.confirm.mdd).padStart(8), r.canon.confirm.mar.toFixed(2).padStart(6),
  f1(r.worstConfirm).padStart(8), f1(r.medianConfirm).padStart(8), f1(r.sdCellsConfirm).padStart(6),
  r.canon.tradesYr.toFixed(0).padStart(6), String(r.canon.jumps).padStart(7)].join(" "));
printRow(F0);
for (const v of VARIANTS.slice(1)) { const r = runVariant(v); results[r.name] = r; printRow(r); }

// ─── GATE pre-registrado vs F0 ───────────────────────────────────────────────
function gateRow(r, ref) {
  const dCagr = r.canon.confirm.cagr - ref.canon.confirm.cagr;
  const dMar = r.canon.confirm.mar - ref.canon.confirm.mar;
  const dMdd = r.canon.confirm.mdd - ref.canon.confirm.mdd;
  const dWorst = r.worstConfirm - ref.worstConfirm;
  const beats = dCagr > 0 && dWorst > 0;
  const material = dCagr >= 0.02 || dMar >= 0.08;
  const mddOK = dMdd <= 0.05;
  const pass = beats && material && mddOK;
  const dWorstTrain = r.worstTrain - ref.worstTrain;
  const dCanonTrain = r.canon.train.cagr - ref.canon.train.cagr;
  return { variante: r.name, dCagr, dMar, dMdd, dWorst, dWorstTrain, dCanonTrain, beats, material, mddOK, pass, trainPrefiereRef: dWorstTrain < 0 && dCanonTrain < 0 };
}
console.log(`\n═══ GATE vs F0 — confirmación 2022-26 (F0: CAGR ${f1(F0.canon.confirm.cagr)} · MaxDD ${f1(F0.canon.confirm.mdd)} · MAR ${F0.canon.confirm.mar.toFixed(2)} · peor-celda ${f1(F0.worstConfirm)}) ═══`);
console.log(["Variante".padEnd(13), "ΔCAGR".padStart(8), "ΔMAR".padStart(7), "ΔMaxDD".padStart(8), "Δpeor".padStart(8), "ΔpeorTr".padStart(9), "ΔcanTr".padStart(8), "bate2".padStart(6), "mat".padStart(5), "MddOK".padStart(6), "GATE".padStart(7)].join(" "));
const gateTable = [];
for (const r of Object.values(results)) {
  if (r.name === "F0") continue;
  const g = gateRow(r, F0);
  gateTable.push(g);
  console.log([g.variante.padEnd(13), f1(g.dCagr).padStart(8), g.dMar.toFixed(2).padStart(7), f1(g.dMdd).padStart(8), f1(g.dWorst).padStart(8),
    f1(g.dWorstTrain).padStart(9), f1(g.dCanonTrain).padStart(8),
    (g.beats ? "sí" : "no").padStart(6), (g.material ? "sí" : "no").padStart(5), (g.mddOK ? "sí" : "no").padStart(6), (g.pass ? "✅PASA" : "—").padStart(7)].join(" "));
}

// ─── IMPACTO EN SELECCIÓN + CASO DEL USUARIO (calendario canónico 260/84) ────
// Ranking del día i con el MISMO desempate que simulate (score desc, m9 desc).
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
const reviewDaysAll = [];
for (let i = 260 + 84; i <= TO; i += 84) reviewDaysAll.push(i);
const reviewDaysFwd = reviewDaysAll.filter((i) => i + 84 <= TO);

const stat = (xs) => {
  const v = xs.filter(isNum);
  if (!v.length) return { n: 0, media: null, mediana: null };
  const s = [...v].sort((a, b) => a - b);
  return { n: v.length, media: mean(v), mediana: s[Math.floor((s.length - 1) / 2)] };
};

// 1) Estados dentro del top-10 SIN filtro + forward por estado (control mismo-día)
const memberRows = []; // {i, seg, ti, sym, rank, fwd, dayMean, estados{...}}
for (const i of reviewDaysFwd) {
  const top10 = rankingAt(i).slice(0, 10);
  const fwds = top10.map((c) => fwdOf(c.ti, i));
  const dayMean = mean(fwds.filter(isNum));
  top10.forEach((c, j) => {
    memberRows.push({
      i, seg: i < SPLIT ? "train" : "confirm", ti: c.ti, sym: T[c.ti].sym, rank: j + 1,
      fwd: fwds[j], dayMean,
      estados: Object.fromEntries(Object.entries(STATES).map(([k, fn]) => [k, fn(c.f)])),
    });
  });
}
const casoEstados = {};
console.log(`\n═══ CASO DEL USUARIO — forward 84 sesiones de los miembros del top-10 C0 (calendario canónico, ${reviewDaysFwd.length} revisiones con ventana completa, ${memberRows.length} plazas) ═══`);
console.log(["Estado".padEnd(19), "frec".padStart(6), "n".padStart(5), "fwdCON".padStart(9), "fwdSIN".padStart(9), "ΔvsSIN".padStart(8), "excCON".padStart(9), "excSIN".padStart(9), "n>media".padStart(8)].join(" "));
for (const [k] of Object.entries(STATES)) {
  const con = memberRows.filter((r) => r.estados[k]);
  const sin = memberRows.filter((r) => !r.estados[k]);
  const sCon = stat(con.map((r) => r.fwd)), sSin = stat(sin.map((r) => r.fwd));
  const eCon = stat(con.map((r) => (isNum(r.fwd) && isNum(r.dayMean) ? r.fwd - r.dayMean : null)));
  const eSin = stat(sin.map((r) => (isNum(r.fwd) && isNum(r.dayMean) ? r.fwd - r.dayMean : null)));
  const beat = con.filter((r) => isNum(r.fwd) && isNum(r.dayMean) && r.fwd > r.dayMean).length;
  const bySeg = {};
  for (const seg of ["train", "confirm"]) {
    const c2 = con.filter((r) => r.seg === seg), s2 = sin.filter((r) => r.seg === seg);
    bySeg[seg] = {
      con: stat(c2.map((r) => r.fwd)), sin: stat(s2.map((r) => r.fwd)),
      excesoCon: stat(c2.map((r) => (isNum(r.fwd) && isNum(r.dayMean) ? r.fwd - r.dayMean : null))).media,
    };
  }
  casoEstados[k] = {
    frecuenciaEnTop10: con.length / memberRows.length,
    fwd84_conEstado: sCon, fwd84_sinEstado: sSin,
    excesoVsMediaDelDia_conEstado: eCon, excesoVsMediaDelDia_sinEstado: eSin,
    pctConEstadoQueBateMediaDelDia: con.length ? beat / con.length : null,
    porSegmento: bySeg,
  };
  console.log([k.padEnd(19), f1(con.length / memberRows.length).padStart(6), String(sCon.n).padStart(5), f1(sCon.media).padStart(9), f1(sSin.media).padStart(9),
    f1(sCon.media - sSin.media).padStart(8), f1(eCon.media).padStart(9), f1(eSin.media).padStart(9), f1(con.length ? beat / con.length : null).padStart(8)].join(" "));
}

// 2) Por filtro: frecuencia de expulsión, sustitutos y forward excluidos vs sustitutos
const FILTER_FNS = {
  F1: isBajo, F2: isMax, F3: isBelow, F3B: isBelow2, F4: bajoAndMax, F5: bajoOrBelow, F7: anyState,
};
const impactoFiltros = {};
console.log("\n═══ IMPACTO DE CADA FILTRO EN LA SELECCIÓN (calendario canónico; fwd solo ventanas completas) ═══");
console.log(["Filtro".padEnd(6), "%plazas".padStart(8), "%revis".padStart(7), "rangoMedSust".padStart(13), "fwdEXCL".padStart(9), "fwdSUST".padStart(9), "Δ(S−E)".padStart(8), "%díasS>E".padStart(9), "eleg<10".padStart(8)].join(" "));
for (const [fname, fn] of Object.entries(FILTER_FNS)) {
  let slotsExcluded = 0, reviewsAffected = 0, fillFallback = 0;
  const exclCount = {}, replCount = {}, replRanks = [];
  const exclFwd = [], replFwd = [], exclExc = [], replExc = [], pairDelta = [];
  const bySeg = { train: { excl: [], repl: [] }, confirm: { excl: [], repl: [] } };
  for (const i of reviewDaysAll) {
    const rk = rankingAt(i);
    const top10 = rk.slice(0, 10);
    const elig = rk.filter((c) => !fn(c.f));
    if (elig.length < 10) fillFallback++;
    const ftop = elig.slice(0, 10);
    if (ftop.length < 10) for (const c of rk) { if (ftop.length >= 10) break; if (fn(c.f) && !ftop.includes(c)) ftop.push(c); }
    const ftopSet = new Set(ftop.map((c) => c.ti));
    const topSet = new Set(top10.map((c) => c.ti));
    const excluded = top10.filter((c) => !ftopSet.has(c.ti));
    const replacements = ftop.filter((c) => !topSet.has(c.ti));
    slotsExcluded += excluded.length;
    if (excluded.length) reviewsAffected++;
    for (const c of excluded) exclCount[T[c.ti].sym] = (exclCount[T[c.ti].sym] ?? 0) + 1;
    for (const c of replacements) {
      replCount[T[c.ti].sym] = (replCount[T[c.ti].sym] ?? 0) + 1;
      replRanks.push(rk.indexOf(c) + 1);
    }
    if (i + 84 <= TO && excluded.length) {
      const seg = i < SPLIT ? "train" : "confirm";
      const dayMean = mean(top10.map((c) => fwdOf(c.ti, i)).filter(isNum));
      const eF = excluded.map((c) => fwdOf(c.ti, i)).filter(isNum);
      const rF = replacements.map((c) => fwdOf(c.ti, i)).filter(isNum);
      exclFwd.push(...eF); replFwd.push(...rF);
      bySeg[seg].excl.push(...eF); bySeg[seg].repl.push(...rF);
      if (isNum(dayMean)) { exclExc.push(...eF.map((x) => x - dayMean)); replExc.push(...rF.map((x) => x - dayMean)); }
      if (eF.length && rF.length) pairDelta.push({ i, seg, delta: mean(rF) - mean(eF) });
    }
  }
  const sE = stat(exclFwd), sR = stat(replFwd);
  const daysReplWin = pairDelta.filter((p) => p.delta > 0).length;
  impactoFiltros[fname] = {
    filtro: results[fname]?.filtro ?? fname,
    pctPlazasExpulsadas: slotsExcluded / (10 * reviewDaysAll.length),
    pctRevisionesAfectadas: reviewsAffected / reviewDaysAll.length,
    revisionesConMenosDe10Elegibles: fillFallback,
    rangoMedioDelSustituto: replRanks.length ? mean(replRanks) : null,
    tickersMasExpulsados: Object.entries(exclCount).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, c]) => `${s}×${c}`),
    tickersSustitutosMasFrecuentes: Object.entries(replCount).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, c]) => `${s}×${c}`),
    fwd84_excluidos: sE, fwd84_sustitutos: sR,
    excesoVsMediaDelDia: { excluidos: stat(exclExc).media, sustitutos: stat(replExc).media },
    deltaSustitutoMenosExcluido: sR.media != null && sE.media != null ? sR.media - sE.media : null,
    pctDiasSustitutoGanaAlExcluido: pairDelta.length ? daysReplWin / pairDelta.length : null,
    nDiasComparables: pairDelta.length,
    porSegmento: Object.fromEntries(Object.entries(bySeg).map(([k, v]) => [k, { excluidos: stat(v.excl), sustitutos: stat(v.repl) }])),
  };
  const it = impactoFiltros[fname];
  console.log([fname.padEnd(6), f1(it.pctPlazasExpulsadas).padStart(8), f1(it.pctRevisionesAfectadas).padStart(7),
    (it.rangoMedioDelSustituto?.toFixed(1) ?? "—").padStart(13), f1(sE.media).padStart(9), f1(sR.media).padStart(9),
    f1(it.deltaSustitutoMenosExcluido).padStart(8), f1(it.pctDiasSustitutoGanaAlExcluido).padStart(9), String(fillFallback).padStart(8)].join(" "));
}

// ─── veredicto pre-registrado ────────────────────────────────────────────────
const byTrain = (a, b) => (b.worstTrain - a.worstTrain) || (b.canon.train.cagr - a.canon.train.cagr);
const passers = gateTable.filter((g) => g.pass).map((g) => g.variante);
const passersByTrain = passers.map((n) => results[n]).sort(byTrain).map((r) => r.name);
let verdict, recomendado = null;
if (!passers.length) verdict = "MANTENER_ACTUAL";
else {
  recomendado = passersByTrain[0];
  verdict = ["F6", "F3_SOLO_SEL", "F3_SOLO_ROT"].includes(recomendado) ? "CAMBIO_PARCIAL" : "CAMBIAR_SELECCION";
}
console.log(`\nPassers del gate: ${passers.length ? passers.join(", ") : "NINGUNO"}`);
if (passers.length) console.log(`Orden por TRAIN entre passers: ${passersByTrain.join(" > ")}`);
console.log(`VEREDICTO: ${verdict}${recomendado ? ` → ${recomendado}` : " — C0 sin filtros se queda (parsimonia: cambiar sin dominancia es churn)"}`);

// ─── benchmarks + año a año ──────────────────────────────────────────────────
const benchmarks = {};
{
  const bh = buyHolds(T, D, spyClose, 260);
  for (const [k, v] of Object.entries({ spy: bh.spy, universoEqW: bh.universe })) {
    benchmarks[k] = { train: segMetrics(v.curve, 260, SPLIT), confirm: segMetrics(v.curve, SPLIT, TO), full: segMetrics(v.curve, 260, TO) };
  }
}
const porAno = [];
{
  const SHOW = Object.keys(results);
  const years = [];
  for (let y = 2018; y <= 2026; y++) {
    const a = dates.findIndex((d) => d >= `${y}-01-01`);
    const b = y < 2026 ? dates.findIndex((d) => d >= `${y + 1}-01-01`) - 1 : TO;
    if (a > 260 && b > a) years.push({ y, a, b });
  }
  console.log("\nAÑO A AÑO (celda canónica):");
  console.log(["Año".padEnd(5), ...SHOW.map((s) => s.slice(0, 11).padStart(12))].join(" "));
  for (const { y, a, b } of years) {
    const row = { ano: y };
    for (const n of SHOW) { const c = results[n].canonCurve; row[n] = isNum(c[a]) && isNum(c[b]) && c[a] > 0 ? c[b] / c[a] - 1 : null; }
    porAno.push(row);
    console.log([String(y).padEnd(5), ...SHOW.map((n) => f1(row[n]).padStart(12))].join(" "));
  }
}

// ─── salida JSON ─────────────────────────────────────────────────────────────
const strip = ({ name, filtro, cells, canon, worstTrain, worstConfirm, medianConfirm, sdCellsConfirm, sdCellsTrain }) =>
  ({ name, filtro, worstTrain, worstConfirm, medianConfirm, sdCellsConfirm, sdCellsTrain, canon, cells });
const OUT = {
  ranAt: new Date().toISOString(),
  objeto: "FILTROS DE EXCLUSIÓN POR ESTADO en la selección del top-10 (runway BAJO / EN_MAXIMOS / precio<EMA50): ¿expulsarlos y rellenar con los siguientes del ranking sube la rentabilidad? Variable nunca probada (los estudios previos probaron ponderar por estado y exigir IDEAL en rotación, no vetar en selección).",
  umbralesProduccion: {
    BAJO: "runwayScore < 55 (level: ≥75 ALTO, ≥55 MEDIO, resto BAJO — computeRunway)",
    EN_MAXIMOS: "prox52w > 0,997 (computeEntryTiming)",
    BELOW_EMA50: "precio < EMA50 estricto, es decir ext50 < 0 (computeWarningFlags)",
    F3B_margen: "ext50 < −0,02 (precio < 0,98·EMA50)",
  },
  metodologia: {
    señales: "cierre ajustado (convención de producción), rasgos rich",
    split: { indice: SPLIT, fecha: dates[SPLIT], train: `${dates[260]} → ${dates[SPLIT]}`, confirmacion: `${dates[SPLIT]} → ${dates[TO]}` },
    malla: "3 fases (260/280/300) × 3 cadencias (63/84/105), canónica (260, 84) — idéntica a rally-joint-study",
    mecanicaFiltro: "scoreFn penalizado (score−1000 si excluido): el top-10 son los 10 primeros ELEGIBLES del ranking (orden y desempate por m9 intactos); si un día hay <10 elegibles en el universo se completa con los mejores no-elegibles (cartera siempre de 10 — aísla la sustitución del market-timing de la liquidez) y se cuenta (selFillFallback/eleg<10)",
    rotacion: "el filtro se aplica TAMBIÉN al candidato del salto (mejor por 0,7·score+0,3·recorrido entre elegibles; si ninguno, mejor global contado como jumpFallback); F3 se descompone además en solo-selección y solo-rotación",
    gate: "vs F0 en CONFIRMACIÓN: CAGR canónica > Y peor-celda > · material (ΔCAGR ≥ 2 pp O ΔMAR ≥ 0,08) · ΔMaxDD ≤ +5 pp · entre passers se elige POR TRAIN (peor-celda, desempate CAGR canónica train). Sin passers → MANTENER_ACTUAL (parsimonia)",
    casoUsuario: "calendario canónico (FROM 260, revisiones cada 84): estado de cada miembro del top-10 SIN filtro el día de revisión y retorno forward 84 sesiones (buy&hold ajustado, solo ventanas completas); exceso vs la media del top-10 del MISMO día = control de régimen; y excluidos vs los 11º-12º… que les habrían sustituido ese mismo día",
    costes: "20 pb por lado (COST_BPS)",
  },
  controlRegresion: "F0 ≡ C0/M9_RAW guardado en backtests/rally-weighting-study.json (canónica + 9 celdas, tolerancia 1e-9) — OK",
  c0Referencia: strip(F0),
  variantes: Object.values(results).filter((r) => r.name !== "F0").map(strip),
  gateTable,
  impactoSeleccion: impactoFiltros,
  casoUsuario: {
    nota: "forward 84 sesiones SIN stops ni rotación (aísla la calidad de la selección; el efecto completo lo miden las simulaciones). Exceso mismo-día = fwd del miembro − media fwd del top-10 de ese día.",
    revisiones: reviewDaysFwd.length, plazasTotales: memberRows.length,
    porEstado: casoEstados,
  },
  benchmarks, porAno,
  cautelas: [
    "Universo superviviente (603 tickers de HOY, 10 años): niveles absolutos inflados; SOLO valen comparaciones relativas entre variantes. OJO específico de este estudio: los filtros que expulsan tickers débiles (BAJO, bajo-EMA50) sustituyen por nombres que en un universo superviviente 'siempre acaban bien' — el beneficio de sustituir puede estar algo inflado; el de expulsar EN_MAXIMOS no tiene ese sesgo direccional claro",
    "Muestra del caso del usuario pequeña en algunos estados (n<40): leer medias CON la mediana y el n; sin tests formales — no hay potencia",
    "Los estados están correlacionados mecánicamente: EN_MAXIMOS resta 15 puntos al runwayScore (un ticker en máximos tiene más papeletas de ser BAJO); BAJO∧EN_MAXIMOS es un subconjunto de ambos",
    "El forward del caso ignora stops/rotación a propósito; las simulaciones completas (tabla principal) son la medida con toda la maquinaria",
    "HECHOS previos consistentes o a contrastar: 'en máximos retrocede MENOS' (estudio stops), 'exigir IDEAL en la ROTACIÓN destruye ~10 pp', 'ponderar por zona no aporta ±0,5 pp' — un filtro que expulsa EN_MAXIMOS va CONTRA esos priors y necesitaría señal muy fuerte",
    "9 variantes no-control comparten referencia: multiplicidad de comparaciones — el umbral de materialidad del gate (≥2 pp / ≥0,08 MAR) y la elección por train mitigan, no eliminan",
    "sd de celdas ~4-7 pp: Δ menores que la sd son ruido de fase×cadencia",
    "Cartera siempre de 10 por diseño (relleno con no-elegibles si <10 elegibles): un filtro-a-liquidez (mantener el hueco en cash) es OTRA estrategia, con market-timing implícito, fuera del alcance de este estudio",
    "Stops evaluados a cierres diarios; primera formación de cartera en FROM+review (convención del simulador, idéntica en todas las variantes)",
  ],
  veredicto: {
    verdict, recomendado, passers, passersOrdenTrain: passersByTrain,
    criterio: "gate pre-registrado en confirmación; entre passers, mejor por TRAIN; sin passers → MANTENER_ACTUAL",
  },
};
fs.writeFileSync("backtests/rally-selection-filter-study.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-selection-filter-study.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
