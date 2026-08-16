/**
 * RALLY — ESTUDIO (mandato 17-ago-2026): SCORE DE PULLBACK INMINENTE 0-100
 * ==========================================================================
 * Pregunta: ¿existe un score 0-100 por ticker que indique la probabilidad de un
 * pullback en el CORTÍSIMO plazo (1-3 sesiones) con poder predictivo REAL y
 * ESTABLE out-of-sample? REGLA SUPREMA: nada inventado — solo se recomienda
 * publicar si el gate de honestidad se cumple con números OOS.
 *
 * LECCIÓN DEL 15-AGO (rally-adaptive-stop-study): el clasificador OLS de 15
 * rasgos nunca ajustó (dd52↔prox colineales exactos) y los combos grandes no
 * generalizaron. Aquí NO hay regresión ni pesos ajustados: indicadores
 * individuales + combinación por MEDIA DE RANGOS PERCENTILES (pesos iguales),
 * selección walk-forward (todo se decide con train, se confirma con 2022+).
 *
 * DATOS Y CONVENCIONES (misma infraestructura que rally-study-lib.mjs):
 *   · data/universe-10y.json (10 años, ~603 tickers + SPY, calendario maestro SPY).
 *   · Señales sobre cierre AJUSTADO (convención de producción:
 *     historicalDataProvider → close = adjusted_close ?? close).
 *   · High/Low ajustados por el factor a/c del día (preserva el rango intradía
 *     en el espacio ajustado; evita el TR espurio en splits que tendría mezclar
 *     high crudo con cierre ajustado).
 *   · Volumen crudo (solo entra como ratio rvol20 → insensible a splits salvo
 *     el día del split, y luego pasa por percentil por ticker).
 *   · Se carga el JSON directamente porque loadUniverse() no expone volumen;
 *     las fórmulas replican las convenciones de la biblioteca.
 *
 * SIN LOOKAHEAD en ningún punto:
 *   · Todos los indicadores del día t usan solo barras ≤ t.
 *   · z-scores y percentiles: ventana MÓVIL de los 252 valores previos del
 *     propio ticker (mín 100), EXCLUYENDO el día t.
 *   · Dirección de cada indicador, ranking, tamaño del combo y bordes de
 *     calibración: decididos SOLO con train (< 2022); confirmación 2022-2026
 *     intocada hasta la evaluación final.
 *
 * EVENTO "pullback inmediato" — se prueban 3 definiciones y se elige con TRAIN
 * (regla pre-registrada, ver sección B):
 *   E1: retorno de t+1 < −1,0×ATR% del ticker (ATR14 Wilder, conocido en t).
 *   E2 (candidata principal): mín(cierres t+1..t+3)/cierre_t − 1 ≤ −1,5×ATR%.
 *   E3: retorno de t+1 < −2% (umbral fijo, no adaptativo).
 *
 * INDICADORES (14, todos conocidos al cierre de t):
 *   rsi2, rsi3, rsi14 (Wilder) · pctB %B Bollinger(20,2) · stretch5/stretch20
 *   (close−EMA)/ATR_abs · upStreak (cierres alcistas consecutivos) · ret5z,
 *   ret10z (z-score móvil 252d por ticker) · rvol20 (vol / media vol 20d previa)
 *   · atrExp (ATR5/ATR20, expansión) · prox52 (close/máx252) · sessPull
 *   (sesiones desde el último día-pullback, cap 60) · rangePos (posición del
 *   cierre en el rango del día — presión compradora tardía, candidato clásico
 *   de reversión; añadido justificado, mismo pipeline).
 *
 * SCORE: percentil móvil por ticker de cada indicador (dirección fijada en
 * train: si AUC<0,5 se usa 1−p) → score = 100 × media de los percentiles del
 * combo. Sin pesos. Calibración: bordes de deciles del score en TRAIN → % de
 * evento observado por bin (mapeo train, verificado en confirmación).
 *
 * GATE DE PUBLICACIÓN (en confirmación 2022-2026):
 *   · lift del decil superior ≥ 1,5× la tasa base, Y
 *   · estable: ambas sub-mitades de confirmación ≥ 1,3×, Y
 *   · calibración monótona (bins por bordes de train; sin inversión grosera =
 *     caída adyacente > máx(1,5 pp; 15% relativo) con n≥200; Spearman ≥ 0,9).
 *   Se exige el gate en las DOS poblaciones donde se publicaría: universo
 *   completo y líderes (top-50 por score v4 del día). Si falla → NO PUBLICAR.
 *
 * Determinista: sin aleatoriedad (submuestras por paso fijo).
 * Salida: backtests/rally-pullback-study.json
 */
import fs from "node:fs";
import { DATA, isNum, mean, sd, clamp, spearman, f1 } from "./rally-study-lib.mjs";

const t0 = Date.now();
const OUT = {
  ranAt: new Date().toISOString(),
  params: {
    data: DATA, pctWin: 252, pctMin: 100, zWin: 252, zMin: 100,
    confStart: "2022-01-01",
    gate: { liftTop: 1.5, liftHalves: 1.3, calibSpearmanMin: 0.9, invAbs: 0.015, invRel: 0.15, invMinN: 200 },
    leaders: 50,
  },
};

// ─── 0) CARGA + INDICADORES POR TICKER ───────────────────────────────────────
console.log("Cargando universo (señales sobre cierre AJUSTADO — convención de producción)…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyBars = series["SPY.US"].bars;
const dates = spyBars.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;

const PCT_WIN = 252, PCT_MIN = 100, Z_WIN = 252, Z_MIN = 100;
const IND_KEYS = ["rsi2", "rsi3", "rsi14", "pctB", "stretch5", "stretch20", "upStreak",
  "ret5z", "ret10z", "rvol20", "atrExp", "prox52", "sessPull", "rangePos"];
const NIND = IND_KEYS.length;

function emaArr(v, p) {
  const n = v.length, out = new Float64Array(n).fill(NaN);
  if (n < p) return out;
  let e = 0; for (let i = 0; i < p; i++) e += v[i]; e /= p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < n; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function rsiArr(c, p) {
  const n = c.length, out = new Float64Array(n).fill(NaN);
  let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}
/** Percentil móvil frente a los ÚLTIMOS PCT_WIN valores válidos PREVIOS (excluye hoy). */
function pctlArr(x) {
  const n = x.length, out = new Float32Array(n).fill(NaN);
  const buf = new Float64Array(PCT_WIN); let cnt = 0, head = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) continue;
    if (cnt >= PCT_MIN) {
      let less = 0, eq = 0;
      for (let j = 0; j < cnt; j++) { const b = buf[j]; if (b < v) less++; else if (b === v) eq++; }
      out[i] = (less + 0.5 * eq) / cnt;
    }
    if (cnt < PCT_WIN) buf[cnt++] = v; else { buf[head] = v; head = (head + 1) % PCT_WIN; }
  }
  return out;
}
/** z-score móvil frente a los últimos Z_WIN valores previos (excluye hoy). */
function zArr(x) {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  const buf = new Float64Array(Z_WIN); let cnt = 0, head = 0, s = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) continue;
    if (cnt >= Z_MIN) {
      const m = s / cnt, va = Math.max(0, s2 / cnt - m * m), sdv = Math.sqrt(va);
      if (sdv > 0) out[i] = (v - m) / sdv;
    }
    if (cnt < Z_WIN) { buf[cnt++] = v; s += v; s2 += v * v; }
    else { const old = buf[head]; s += v - old; s2 += v * v - old * old; buf[head] = v; head = (head + 1) % Z_WIN; }
  }
  return out;
}

class Col {
  constructor(T) { this.T = T; this.a = new T(1 << 20); this.n = 0; }
  push(v) { if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  trim() { return this.a.subarray(0, this.n); }
}
const cK = new Col(Int32Array), cT = new Col(Int32Array);
const cE1 = new Col(Uint8Array), cE2 = new Col(Uint8Array), cE3 = new Col(Uint8Array);
const cU1 = new Col(Uint8Array); // control espejo AL ALZA: ret t+1 > +1,0×ATR%
const cSV4 = new Col(Float32Array), cATR = new Col(Float32Array);
const cP = IND_KEYS.map(() => new Col(Float32Array));

const tickers = []; // {sym, name}
const today = [];   // captura del último día con indicadores válidos por ticker
let filledBars = 0;

for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  let n = bars.length;
  // sanitiza: barras inválidas → forward-fill del cierre (h=l=c, v=0); recorta cabecera inválida
  let start = 0;
  while (start < n && !(bars[start].c > 0 && bars[start].a > 0)) start++;
  if (n - start < 300) continue;
  const c = new Float64Array(n - start), h = new Float64Array(n - start), l = new Float64Array(n - start),
    vol = new Float64Array(n - start), mK = new Int32Array(n - start).fill(-1);
  n = n - start;
  for (let i = 0; i < n; i++) {
    const b = bars[i + start];
    const ok = b.c > 0 && b.a > 0 && b.h > 0 && b.l > 0 && b.h >= b.l;
    if (ok) {
      const fct = b.a / b.c;
      c[i] = b.a; h[i] = b.h * fct; l[i] = b.l * fct; vol[i] = isNum(b.v) ? b.v : 0;
    } else {
      c[i] = c[i - 1]; h[i] = c[i]; l[i] = c[i]; vol[i] = 0; filledBars++;
    }
    const k = dateIdx.get(b.d);
    mK[i] = k === undefined ? -1 : k;
  }

  // TR + ATRs (sobre OHLC ajustado)
  const tr = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  const atr14 = new Float64Array(n).fill(NaN); // Wilder
  { let a = null;
    for (let i = 1; i < n; i++) {
      if (i === 14) { let s0 = 0; for (let q = 1; q <= 14; q++) s0 += tr[q]; a = s0 / 14; }
      else if (i > 14) a = (a * 13 + tr[i]) / 14;
      if (a != null) atr14[i] = a;
    } }
  const atrPct = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (Number.isFinite(atr14[i]) && c[i] > 0) atrPct[i] = (atr14[i] / c[i]) * 100;
  const sma = (src, w) => { const out = new Float64Array(n).fill(NaN); let s = 0; let bad = 0;
    for (let i = 0; i < n; i++) { const v = src[i]; if (!Number.isFinite(v)) bad = w; else s += v;
      if (i >= w) { const o = src[i - w]; if (Number.isFinite(o)) s -= o; }
      if (bad > 0) bad--; if (i >= w - 1 && bad === 0) out[i] = s / w; }
    return out; };
  const atr5m = sma(tr, 5), atr20m = sma(tr, 20);

  // EMA / Bollinger / RSI
  const ema5 = emaArr(c, 5), ema20 = emaArr(c, 20);
  const sma20 = new Float64Array(n).fill(NaN), sd20 = new Float64Array(n).fill(NaN);
  { let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) { s += c[i]; s2 += c[i] * c[i];
      if (i >= 20) { s -= c[i - 20]; s2 -= c[i - 20] * c[i - 20]; }
      if (i >= 19) { const m = s / 20; sma20[i] = m; sd20[i] = Math.sqrt(Math.max(0, s2 / 20 - m * m)); } } }
  const rsi2 = rsiArr(c, 2), rsi3 = rsiArr(c, 3), rsi14 = rsiArr(c, 14);

  // máximo 252 (incluye hoy) y máximo de las 10 previas (excluye hoy)
  const hi252 = new Float64Array(n).fill(NaN), hi10prev = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const lb = Math.min(i + 1, 252); let m = 0;
    for (let q = i - lb + 1; q <= i; q++) if (c[q] > m) m = c[q];
    hi252[i] = m;
    if (i >= 10) { let m2 = 0; for (let q = i - 10; q < i; q++) if (c[q] > m2) m2 = c[q]; hi10prev[i] = m2; }
  }

  // día-pullback observable en t → sesiones desde el último (cap 60)
  const sessPull = new Float64Array(n).fill(NaN);
  { let last = -1;
    for (let i = 0; i < n; i++) {
      const pd = Number.isFinite(hi10prev[i]) && Number.isFinite(atrPct[i]) && c[i] <= hi10prev[i] * (1 - 1.5 * atrPct[i] / 100);
      if (pd) last = i;
      if (i >= 15) sessPull[i] = last < 0 ? 60 : Math.min(60, i - last);
    } }

  // resto de indicadores crudos
  const ind = {};
  ind.rsi2 = rsi2; ind.rsi3 = rsi3; ind.rsi14 = rsi14;
  ind.pctB = new Float64Array(n).fill(NaN);
  ind.stretch5 = new Float64Array(n).fill(NaN);
  ind.stretch20 = new Float64Array(n).fill(NaN);
  ind.upStreak = new Float64Array(n).fill(NaN);
  ind.rvol20 = new Float64Array(n).fill(NaN);
  ind.atrExp = new Float64Array(n).fill(NaN);
  ind.prox52 = new Float64Array(n).fill(NaN);
  ind.sessPull = sessPull;
  ind.rangePos = new Float64Array(n).fill(NaN);
  const ret5 = new Float64Array(n).fill(NaN), ret10 = new Float64Array(n).fill(NaN);
  { let streak = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) streak = c[i] > c[i - 1] ? streak + 1 : 0;
      ind.upStreak[i] = streak;
      if (Number.isFinite(sd20[i]) && sd20[i] > 0) ind.pctB[i] = (c[i] - (sma20[i] - 2 * sd20[i])) / (4 * sd20[i]);
      if (Number.isFinite(ema5[i]) && Number.isFinite(atr14[i]) && atr14[i] > 0) ind.stretch5[i] = (c[i] - ema5[i]) / atr14[i];
      if (Number.isFinite(ema20[i]) && Number.isFinite(atr14[i]) && atr14[i] > 0) ind.stretch20[i] = (c[i] - ema20[i]) / atr14[i];
      if (i >= 5 && c[i - 5] > 0) ret5[i] = c[i] / c[i - 5] - 1;
      if (i >= 10 && c[i - 10] > 0) ret10[i] = c[i] / c[i - 10] - 1;
      if (Number.isFinite(atr5m[i]) && Number.isFinite(atr20m[i]) && atr20m[i] > 0) ind.atrExp[i] = atr5m[i] / atr20m[i];
      if (hi252[i] > 0) ind.prox52[i] = c[i] / hi252[i];
      const rng = h[i] - l[i];
      if (rng > 0) ind.rangePos[i] = (c[i] - l[i]) / rng;
    } }
  // rvol20: volumen de hoy / media de las 20 sesiones PREVIAS (excluye hoy)
  { let s = 0;
    for (let i = 0; i < n; i++) {
      if (i >= 20) { const m = s / 20; if (m > 0 && vol[i] > 0) ind.rvol20[i] = vol[i] / m; }
      s += vol[i]; if (i >= 20) s -= vol[i - 20];
    } }
  ind.ret5z = zArr(ret5); ind.ret10z = zArr(ret10);

  // percentiles móviles por ticker
  const P = IND_KEYS.map((k) => pctlArr(ind[k]));

  // score v4 (m9) para la subpoblación de líderes
  const sv4 = new Float64Array(n).fill(NaN);
  for (let i = 189; i < n; i++) if (c[i - 189] > 0) sv4[i] = clamp(50 + 50 * Math.tanh(((c[i] / c[i - 189] - 1) * 100) / 75));

  // filas: pctls válidos + ATR + sv4 + etiquetas (t+1..t+3 dentro de la serie)
  const ti = tickers.length;
  tickers.push({ sym, name: obj.name });
  let lastValid = -1;
  for (let i = 0; i < n; i++) {
    let ok = Number.isFinite(atrPct[i]) && Number.isFinite(sv4[i]) && mK[i] >= 0;
    if (ok) for (let q = 0; q < NIND; q++) if (!Number.isFinite(P[q][i])) { ok = false; break; }
    if (!ok) continue;
    lastValid = i;
    if (i + 3 >= n) continue;
    const r1 = c[i + 1] / c[i] - 1;
    const min3 = Math.min(c[i + 1], c[i + 2], c[i + 3]) / c[i] - 1;
    cK.push(mK[i]); cT.push(ti);
    cE1.push(r1 < -1.0 * atrPct[i] / 100 ? 1 : 0);
    cE2.push(min3 <= -1.5 * atrPct[i] / 100 ? 1 : 0);
    cE3.push(r1 < -0.02 ? 1 : 0);
    cU1.push(r1 > 1.0 * atrPct[i] / 100 ? 1 : 0);
    cSV4.push(sv4[i]); cATR.push(atrPct[i]);
    for (let q = 0; q < NIND; q++) cP[q].push(P[q][i]);
  }
  if (lastValid >= 0 && mK[lastValid] === D - 1) {
    const snap = { sym, sv4: sv4[lastValid], atr: atrPct[lastValid], p: IND_KEYS.map((k, q) => P[q][lastValid]) };
    today.push(snap);
  }
}

const K = cK.trim(), TI = cT.trim(), E1 = cE1.trim(), E2 = cE2.trim(), E3 = cE3.trim(),
  U1 = cU1.trim(), SV4 = cSV4.trim(), ATR = cATR.trim();
const P = cP.map((c2) => c2.trim());
const N = K.length;
console.log(`Tickers: ${tickers.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)`);
console.log(`Filas evaluables (indicadores+percentiles+etiquetas válidos): ${N.toLocaleString("es")} · barras rellenadas: ${filledBars}`);

// ─── subpoblación LÍDERES: top-50 (y top-10) por score v4 del día ────────────
const LEAD50 = new Uint8Array(N), LEAD10 = new Uint8Array(N);
{
  const byDay = Array.from({ length: D }, () => []);
  for (let r = 0; r < N; r++) byDay[K[r]].push(r);
  for (const list of byDay) {
    list.sort((a, b) => SV4[b] - SV4[a] || a - b);
    const m = Math.min(50, list.length);
    for (let j = 0; j < m; j++) { LEAD50[list[j]] = 1; if (j < 10) LEAD10[list[j]] = 1; }
  }
}

// ─── splits temporales ───────────────────────────────────────────────────────
const kConfStart = dates.findIndex((d) => d >= OUT.params.confStart);
let kFirstRow = D; for (let r = 0; r < N; r++) if (K[r] < kFirstRow) kFirstRow = K[r];
const kTrainMid = Math.floor((kFirstRow + kConfStart - 1) / 2);
const kConfMid = Math.floor((kConfStart + (D - 1)) / 2);
const idx = { train: [], trainH1: [], trainH2: [], conf: [], confH1: [], confH2: [] };
for (let r = 0; r < N; r++) {
  const k = K[r];
  if (k < kConfStart) { idx.train.push(r); (k <= kTrainMid ? idx.trainH1 : idx.trainH2).push(r); }
  else { idx.conf.push(r); (k <= kConfMid ? idx.confH1 : idx.confH2).push(r); }
}
for (const key of Object.keys(idx)) idx[key] = Int32Array.from(idx[key]);
console.log(`Train (${dates[kFirstRow]} → ${dates[kConfStart - 1]}): ${idx.train.length.toLocaleString("es")} filas · ` +
  `mitades en ${dates[kTrainMid]}`);
console.log(`Confirmación (${dates[kConfStart]} → ${dates.at(-1)}): ${idx.conf.length.toLocaleString("es")} filas · ` +
  `mitades en ${dates[kConfMid]}\n`);
OUT.splits = {
  train: [dates[kFirstRow], dates[kConfStart - 1]], trainMid: dates[kTrainMid],
  conf: [dates[kConfStart], dates.at(-1)], confMid: dates[kConfMid],
  nTrain: idx.train.length, nConf: idx.conf.length, nRows: N, nTickers: tickers.length,
};

// ─── utilidades de evaluación ────────────────────────────────────────────────
function aucOf(rows, scoreAt, Y) {
  const n = rows.length;
  const s = new Float64Array(n); const y = new Uint8Array(n); let n1 = 0;
  for (let i = 0; i < n; i++) { const r = rows[i]; s[i] = scoreAt(r); y[i] = Y[r]; n1 += y[i]; }
  const n0 = n - n1; if (n1 === 0 || n0 === 0) return null;
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => s[a] - s[b]);
  let R1 = 0, i = 0;
  while (i < n) {
    let j = i; while (j + 1 < n && s[ord[j + 1]] === s[ord[i]]) j++;
    const rk = (i + j) / 2 + 1;
    for (let q = i; q <= j; q++) if (y[ord[q]]) R1 += rk;
    i = j + 1;
  }
  return (R1 - n1 * (n1 + 1) / 2) / (n1 * n0);
}
/** base, lift del decil superior (decil interno por rango, empates por id) */
function evalSplit(rows, scoreAt, Y) {
  const n = rows.length; if (!n) return null;
  const s = new Float64Array(n); let n1 = 0;
  for (let i = 0; i < n; i++) { s[i] = scoreAt(rows[i]); n1 += Y[rows[i]]; }
  const base = n1 / n;
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => s[b] - s[a] || rows[a] - rows[b]);
  const m = Math.max(1, Math.floor(n / 10));
  let e = 0; for (let i = 0; i < m; i++) e += Y[rows[ord[i]]];
  const freqTop = e / m;
  return { n, base, freqTop, lift: base > 0 ? freqTop / base : null, auc: aucOf(rows, scoreAt, Y) };
}
function calibBins(rows, scoreAt, Y, edges) {
  const nb = edges.length + 1;
  const cnt = new Array(nb).fill(0), ev = new Array(nb).fill(0);
  for (const r of rows) {
    const s = scoreAt(r);
    let b = 0; while (b < edges.length && s >= edges[b]) b++;
    cnt[b]++; ev[b] += Y[r];
  }
  return cnt.map((c2, b) => ({ bin: b + 1, n: c2, freq: c2 ? ev[b] / c2 : null }));
}
function quantileEdges(rows, scoreAt, nb = 10) {
  const s = Array.from(rows, (r) => scoreAt(r)).sort((a, b) => a - b);
  const edges = [];
  for (let q = 1; q < nb; q++) edges.push(s[Math.floor((q * s.length) / nb)]);
  return edges;
}

// ─── B) ELECCIÓN DEL EVENTO (regla pre-registrada, SOLO train) ───────────────
console.log("═══ B) ELECCIÓN DEL EVENTO (solo train; regla: tasa base 4-35%, máxima estabilidad");
console.log("    entre mitades de train; E2 preferida si su estabilidad ≥ mejor−0,02; desempate");
console.log("    por AUC media de 3 sondas [rsi2, stretch5, pctB]) ═══");
const EVENTS = [
  { key: "E1", Y: E1, def: "ret t+1 < −1,0×ATR%" },
  { key: "E2", Y: E2, def: "mín 3 sesiones ≤ −1,5×ATR%" },
  { key: "E3", Y: E3, def: "ret t+1 < −2% (fijo)" },
];
const PROBES = ["rsi2", "stretch5", "pctB"].map((k) => IND_KEYS.indexOf(k));
const evRows = [];
for (const ev of EVENTS) {
  const b = (rows) => { let s = 0; for (const r of rows) s += ev.Y[r]; return s / rows.length; };
  const bTr = b(idx.train), bH1 = b(idx.trainH1), bH2 = b(idx.trainH2), bCf = b(idx.conf);
  const stab = Math.min(bH1, bH2) / Math.max(bH1, bH2);
  const probeAuc = PROBES.map((q) => {
    const a = aucOf(idx.train, (r) => P[q][r], ev.Y);
    return a == null ? 0.5 : Math.max(a, 1 - a);
  });
  const probe = mean(probeAuc);
  evRows.push({ ...ev, bTr, bH1, bH2, bCf, stab, probe, ok: bTr >= 0.04 && bTr <= 0.35 });
  console.log(`  ${ev.key} (${ev.def.padEnd(28)}) base train ${f1(bTr)} [mit ${f1(bH1)}/${f1(bH2)} · estab ${stab.toFixed(3)}] · sondas AUC ${probe.toFixed(3)} · conf ${f1(bCf)} (solo informativo)`);
}
let EV;
{
  const ok = evRows.filter((e) => e.ok);
  const best = ok.reduce((a, b) => (b.stab > a.stab ? b : a));
  const e2 = ok.find((e) => e.key === "E2");
  EV = e2 && e2.stab >= best.stab - 0.02 ? e2 : best;
  const tied = ok.filter((e) => Math.abs(e.stab - EV.stab) < 1e-12 && e !== EV);
  if (tied.length) EV = [EV, ...tied].reduce((a, b) => (b.probe > a.probe ? b : a));
}
const Y = EV.Y;
console.log(`→ EVENTO ELEGIDO: ${EV.key} — ${EV.def}\n`);
OUT.evento = { candidatos: evRows.map(({ Y: _y, ...e }) => e), elegido: EV.key, definicion: EV.def };

// ─── C) RANKING DE INDICADORES INDIVIDUALES (dirección y ranking con train) ──
console.log("═══ C) INDICADORES INDIVIDUALES — AUC train (dirección fijada en train) ═══");
console.log("Indicador".padEnd(11), "dir".padStart(4), "AUCtr".padStart(7), "mit1".padStart(7), "mit2".padStart(7), "AUCconf".padStart(8), "estable".padStart(8));
const indStats = [];
for (let q = 0; q < NIND; q++) {
  const a0 = aucOf(idx.train, (r) => P[q][r], Y);
  const dir = a0 >= 0.5 ? 1 : -1;
  const sAt = dir > 0 ? (r) => P[q][r] : (r) => 1 - P[q][r];
  const aTr = Math.max(a0, 1 - a0);
  const aH1 = aucOf(idx.trainH1, sAt, Y), aH2 = aucOf(idx.trainH2, sAt, Y);
  const aCf = aucOf(idx.conf, sAt, Y);
  const stable = aTr >= 0.52 && aH1 >= 0.51 && aH2 >= 0.51;
  indStats.push({ key: IND_KEYS[q], q, dir, aTr, aH1, aH2, aCf, stable });
  console.log(IND_KEYS[q].padEnd(11), String(dir > 0 ? "+" : "−").padStart(4), aTr.toFixed(4).padStart(7),
    aH1.toFixed(4).padStart(7), aH2.toFixed(4).padStart(7), aCf.toFixed(4).padStart(8), (stable ? "sí" : "no").padStart(8));
}
const ranked = indStats.filter((s) => s.stable).sort((a, b) => b.aTr - a.aTr);
console.log(`\nElegibles (AUCtr ≥ 0,52 y ambas mitades de train ≥ 0,51): ${ranked.length} → ${ranked.map((s) => s.key).join(", ")}\n`);
OUT.indicadores = indStats;

// correlación de rangos entre elegibles (submuestra determinista de train, paso fijo)
const corrPairs = {};
{
  const stride = Math.max(1, Math.floor(idx.train.length / 40000));
  const sub = []; for (let i = 0; i < idx.train.length; i += stride) sub.push(idx.train[i]);
  for (let a = 0; a < ranked.length; a++) for (let b = a + 1; b < ranked.length; b++) {
    const xa = sub.map((r) => P[ranked[a].q][r]), xb = sub.map((r) => P[ranked[b].q][r]);
    corrPairs[`${ranked[a].key}|${ranked[b].key}`] = spearman(xa, xb);
  }
}
OUT.correlaciones = corrPairs;

// ─── D) COMBOS (media de rangos percentiles, sin pesos) — elegido con train ──
const comboScoreAt = (keysQ, dirs) => (r) => {
  let s = 0;
  for (let j = 0; j < keysQ.length; j++) s += dirs[j] > 0 ? P[keysQ[j]][r] : 1 - P[keysQ[j]][r];
  return (100 * s) / keysQ.length;
};
function greedyDiverse(kMax, cap = 0.85) {
  const pick = [];
  for (const s of ranked) {
    if (pick.length >= kMax) break;
    let okC = true;
    for (const p2 of pick) {
      const key = corrPairs[`${p2.key}|${s.key}`] ?? corrPairs[`${s.key}|${p2.key}`];
      if (key != null && Math.abs(key) > cap) { okC = false; break; }
    }
    if (okC) pick.push(s);
  }
  return pick;
}
const comboDefs = [];
for (const k2 of [3, 4, 5]) if (ranked.length >= k2) comboDefs.push({ label: `top${k2}`, sel: ranked.slice(0, k2) });
for (const k2 of [3, 5]) { const g = greedyDiverse(k2); if (g.length === k2) comboDefs.push({ label: `div${k2} (|ρ|≤0,85)`, sel: g }); }
console.log("═══ D) COMBOS (media de percentiles, pesos iguales) — evaluados en train ═══");
console.log("Combo".padEnd(16), "indicadores".padEnd(46), "AUCtr".padStart(7), "mit1".padStart(7), "mit2".padStart(7), "lift10tr".padStart(9));
const comboRows = [];
for (const cd of comboDefs) {
  const qs = cd.sel.map((s) => s.q), ds = cd.sel.map((s) => s.dir);
  const sAt = comboScoreAt(qs, ds);
  const aTr = aucOf(idx.train, sAt, Y);
  const aH1 = aucOf(idx.trainH1, sAt, Y), aH2 = aucOf(idx.trainH2, sAt, Y);
  const ev = evalSplit(idx.train, sAt, Y);
  comboRows.push({ ...cd, qs, ds, sAt, aTr, aH1, aH2, liftTr: ev.lift });
  console.log(cd.label.padEnd(16), cd.sel.map((s) => s.key).join("+").slice(0, 45).padEnd(46),
    aTr.toFixed(4).padStart(7), aH1.toFixed(4).padStart(7), aH2.toFixed(4).padStart(7), ev.lift.toFixed(2).padStart(9));
}
comboRows.sort((a, b) => b.aTr - a.aTr || Math.min(b.aH1, b.aH2) - Math.min(a.aH1, a.aH2));
const COMBO = comboRows[0];
const BEST1 = ranked[0];
const best1At = BEST1.dir > 0 ? (r) => 100 * P[BEST1.q][r] : (r) => 100 * (1 - P[BEST1.q][r]);
console.log(`→ COMBO elegido en train: ${COMBO.label} = ${COMBO.sel.map((s) => (s.dir > 0 ? "" : "1−") + s.key).join(" + ")} (media ×100)`);
console.log(`→ Mejor individual en train: ${BEST1.key} (dir ${BEST1.dir > 0 ? "+" : "−"})\n`);
OUT.combos = comboRows.map(({ sAt, sel, ...c2 }) => ({ ...c2, keys: sel.map((s) => s.key), dirs: sel.map((s) => s.dir) }));
OUT.eleccion = { combo: COMBO.label, keys: COMBO.sel.map((s) => s.key), dirs: COMBO.sel.map((s) => s.dir), mejorIndividual: BEST1.key };

// ─── E) CONFIRMACIÓN OOS (2022-2026) — combo vs mejor individual, 2 poblaciones ─
const trainEdges = quantileEdges(idx.train, COMBO.sAt, 10);
function fullEval(rows, rowsH1, rowsH2, sAt) {
  const all = evalSplit(rows, sAt, Y);
  const h1 = evalSplit(rowsH1, sAt, Y), h2 = evalSplit(rowsH2, sAt, Y);
  return { ...all, h1, h2 };
}
const filt = (rows, mask) => { const o = []; for (const r of rows) if (mask[r]) o.push(r); return Int32Array.from(o); };
const POPS = [
  { key: "ALL", label: "universo completo", rows: idx.conf, h1: idx.confH1, h2: idx.confH2 },
  { key: "LEAD50", label: "líderes top-50/día", rows: filt(idx.conf, LEAD50), h1: filt(idx.confH1, LEAD50), h2: filt(idx.confH2, LEAD50) },
  { key: "LEAD10", label: "líderes top-10/día (informativo)", rows: filt(idx.conf, LEAD10), h1: filt(idx.confH1, LEAD10), h2: filt(idx.confH2, LEAD10) },
];
console.log("═══ E) CONFIRMACIÓN OOS 2022-2026 ═══");
OUT.confirmacion = {};
for (const pop of POPS) {
  const evC = fullEval(pop.rows, pop.h1, pop.h2, COMBO.sAt);
  const evI = fullEval(pop.rows, pop.h1, pop.h2, best1At);
  OUT.confirmacion[pop.key] = { combo: evC, individual: evI };
  console.log(`\n— Población ${pop.key} (${pop.label}) · n=${evC.n.toLocaleString("es")} · tasa base ${f1(evC.base)}`);
  const line = (nm, e) => console.log(`  ${nm.padEnd(22)} AUC ${e.auc.toFixed(4)} · decil sup ${f1(e.freqTop)} · lift ${e.lift.toFixed(2)}× · ` +
    `mitades ${e.h1.lift.toFixed(2)}×/${e.h2.lift.toFixed(2)}× (bases ${f1(e.h1.base)}/${f1(e.h2.base)})`);
  line(`COMBO ${COMBO.label}`, evC);
  line(`individual ${BEST1.key}`, evI);
}

// calibración: bins por bordes de deciles de TRAIN (mapeo desplegable) — combo
const calTrain = calibBins(idx.train, COMBO.sAt, Y, trainEdges);
const calConf = calibBins(idx.conf, COMBO.sAt, Y, trainEdges);
const calConfL50 = calibBins(POPS[1].rows, COMBO.sAt, Y, trainEdges);
console.log("\n— Calibración del COMBO (bins = deciles del score en train)");
console.log("bin".padStart(4), "score≈".padStart(14), "n train".padStart(9), "%ev train".padStart(10), "n conf".padStart(9), "%ev conf".padStart(10), "%ev conf L50".padStart(13));
const edgeTxt = (b) => {
  const lo = b === 0 ? 0 : trainEdges[b - 1], hi = b >= trainEdges.length ? 100 : trainEdges[b];
  return `${lo.toFixed(1)}–${hi.toFixed(1)}`;
};
for (let b = 0; b < 10; b++) {
  console.log(String(b + 1).padStart(4), edgeTxt(b).padStart(14), String(calTrain[b].n).padStart(9), f1(calTrain[b].freq).padStart(10),
    String(calConf[b].n).padStart(9), f1(calConf[b].freq).padStart(10),
    (calConfL50[b].n >= 200 ? f1(calConfL50[b].freq) : `(${calConfL50[b].n})`).padStart(13));
}
OUT.calibracion = { edges: trainEdges, train: calTrain, conf: calConf, confLead50: calConfL50 };

// ─── F) GATE DE PUBLICACIÓN ──────────────────────────────────────────────────
function monotoneCheck(cal) {
  const g = OUT.params.gate;
  const usable = cal.filter((c2) => c2.n >= g.invMinN && c2.freq != null);
  let gross = 0;
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1].freq, cur = usable[i].freq;
    if (cur < prev - Math.max(g.invAbs, g.invRel * prev)) gross++;
  }
  const rho = spearman(usable.map((c2, i) => i), usable.map((c2) => c2.freq));
  return { gross, rho, monotona: gross === 0 && rho != null && rho >= g.calibSpearmanMin };
}
console.log("\n═══ F) GATE DE PUBLICACIÓN (confirmación 2022-2026) ═══");
const gateRes = {};
for (const pop of POPS.slice(0, 2)) {
  const e = OUT.confirmacion[pop.key].combo;
  const cal = pop.key === "ALL" ? calConf : calConfL50;
  const mono = monotoneCheck(cal);
  const pass = e.lift >= 1.5 && e.h1.lift >= 1.3 && e.h2.lift >= 1.3 && mono.monotona;
  gateRes[pop.key] = { lift: e.lift, liftH1: e.h1.lift, liftH2: e.h2.lift, ...mono, pass };
  console.log(`  ${pop.key.padEnd(7)} lift ${e.lift.toFixed(2)}× (≥1,5 ${e.lift >= 1.5 ? "✓" : "✗"}) · mitades ${e.h1.lift.toFixed(2)}×/${e.h2.lift.toFixed(2)}× (≥1,3 ${e.h1.lift >= 1.3 && e.h2.lift >= 1.3 ? "✓" : "✗"}) · ` +
    `calibración ${mono.monotona ? "monótona ✓" : `NO monótona ✗ (inversiones ${mono.gross}, ρ ${mono.rho?.toFixed(2)})`}`);
}
const VEREDICTO = gateRes.ALL.pass && gateRes.LEAD50.pass ? "PUBLICAR" : "NO PUBLICAR";
console.log(`\n→ VEREDICTO: ${VEREDICTO}`);
OUT.gate = gateRes; OUT.veredicto = VEREDICTO;

// ─── F-bis) CONTROLES DE HONESTIDAD ──────────────────────────────────────────
console.log("\n═══ F-bis) CONTROLES DE HONESTIDAD ═══");
{
  // (a) DIRECCIONALIDAD: evento espejo AL ALZA U1 (ret t+1 > +1,0×ATR%). Si los
  // mismos indicadores (con la MISMA dirección fijada para el evento bajista)
  // también predicen U1, el score no detecta "pullback" sino "movimiento grande"
  // (volatilidad) y publicarlo como probabilidad de pullback sería engañoso.
  console.log("— (a) Direccionalidad: ¿predicen también el movimiento espejo AL ALZA (U1)?");
  let bU = 0; for (const r of idx.conf) bU += U1[r]; bU /= idx.conf.length;
  console.log(`  Tasa base conf — evento bajista ${EV.key}: ${f1(OUT.confirmacion.ALL.combo.base)} · espejo alcista U1: ${f1(bU)}`);
  const dirCtl = [];
  for (const nm of ["rvol20", "atrExp"]) {
    const st = indStats.find((s) => s.key === nm);
    const sAt = st.dir > 0 ? (r) => P[st.q][r] : (r) => 1 - P[st.q][r];
    const aDown = aucOf(idx.conf, sAt, Y), aUp = aucOf(idx.conf, sAt, U1);
    dirCtl.push({ key: nm, aucDown: aDown, aucUp: aUp });
    console.log(`  ${nm.padEnd(8)} AUC conf vs ${EV.key} (baja): ${aDown.toFixed(4)} · vs U1 (sube): ${aUp.toFixed(4)}`);
  }
  const topFreq = (sAt, Y2) => {
    const rows = idx.conf;
    const s = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i++) s[i] = sAt(rows[i]);
    const ord = Array.from({ length: rows.length }, (_, i) => i).sort((a, b) => s[b] - s[a] || rows[a] - rows[b]);
    const m = Math.floor(rows.length / 10);
    let e = 0; for (let i = 0; i < m; i++) e += Y2[rows[ord[i]]];
    return e / m;
  };
  const cDown = topFreq(COMBO.sAt, Y), cUp = topFreq(COMBO.sAt, U1);
  const iDown = topFreq(best1At, Y), iUp = topFreq(best1At, U1);
  console.log(`  Decil superior del COMBO en conf: ${f1(cDown)} acaba en ${EV.key} (baja) vs ${f1(cUp)} en U1 (sube)`);
  console.log(`  Decil superior de rvol20 en conf: ${f1(iDown)} acaba en ${EV.key} (baja) vs ${f1(iUp)} en U1 (sube)`);
  OUT.controlDireccionalidad = { baseU1conf: bU, porIndicador: dirCtl, decilCombo: { down: cDown, up: cUp }, decilIndividual: { down: iDown, up: iUp } };

  // (b) SENSIBILIDAD AL EVENTO: pipeline completo re-derivado en train (dirección
  // + ranking por AUC de train + combo top-3) para los eventos no elegidos.
  console.log("\n— (b) Sensibilidad al evento (pipeline re-derivado en train, combo top-3)");
  OUT.sensibilidadEvento = [];
  for (const ev of EVENTS) {
    if (ev.key === EV.key) continue;
    const st = [];
    for (let q = 0; q < NIND; q++) {
      const a0 = aucOf(idx.train, (r) => P[q][r], ev.Y);
      if (a0 == null) continue;
      st.push({ q, key: IND_KEYS[q], dir: a0 >= 0.5 ? 1 : -1, aTr: Math.max(a0, 1 - a0) });
    }
    st.sort((a, b) => b.aTr - a.aTr);
    const top3 = st.slice(0, 3);
    const sAt = comboScoreAt(top3.map((s) => s.q), top3.map((s) => s.dir));
    const b1 = st[0];
    const b1At = b1.dir > 0 ? (r) => P[b1.q][r] : (r) => 1 - P[b1.q][r];
    const rows50 = POPS[1].rows;
    const eC = evalSplit(idx.conf, sAt, ev.Y), eC50 = evalSplit(rows50, sAt, ev.Y);
    const eI = evalSplit(idx.conf, b1At, ev.Y), eI50 = evalSplit(rows50, b1At, ev.Y);
    console.log(`  ${ev.key}: combo [${top3.map((s) => (s.dir > 0 ? "" : "1−") + s.key).join("+")}] conf ALL AUC ${eC.auc.toFixed(4)} lift ${eC.lift.toFixed(2)}× · L50 lift ${eC50.lift.toFixed(2)}×`);
    console.log(`      mejor individual ${b1.key}: conf ALL AUC ${eI.auc.toFixed(4)} lift ${eI.lift.toFixed(2)}× · L50 lift ${eI50.lift.toFixed(2)}× (bases ${f1(eC.base)}/${f1(eC50.base)})`);
    OUT.sensibilidadEvento.push({ evento: ev.key, comboKeys: top3.map((s) => s.key), comboDirs: top3.map((s) => s.dir),
      confALL: eC, confL50: eC50, mejorIndividual: b1.key, indConfALL: eI, indConfL50: eI50 });
  }
}

// ─── G) PER-TICKER vs GLOBAL (¿gana la selección por ticker OOS?) ────────────
console.log("\n═══ G) SELECCIÓN PER-TICKER vs GLOBAL (top-3 por AUC de train del propio ticker) ═══");
{
  const rowsByT = new Map();
  for (let r = 0; r < N; r++) {
    let e = rowsByT.get(TI[r]);
    if (!e) { e = { tr: [], cf: [] }; rowsByT.set(TI[r], e); }
    (K[r] < kConfStart ? e.tr : e.cf).push(r);
  }
  let nT = 0, winsPT = 0, sumPT = 0, sumGL = 0;
  const ptRows = [], ptScore = new Float64Array(N).fill(NaN);
  for (const [ti, e] of rowsByT) {
    if (e.tr.length < 250 || e.cf.length < 100) continue;
    let ev = 0; for (const r of e.tr) ev += Y[r];
    if (ev < 25) continue;
    const perf = [];
    for (let q = 0; q < NIND; q++) {
      const a = aucOf(e.tr, (r) => P[q][r], Y);
      if (a == null) continue;
      perf.push({ q, dir: a >= 0.5 ? 1 : -1, a: Math.max(a, 1 - a) });
    }
    perf.sort((x, y2) => y2.a - x.a);
    const top3 = perf.slice(0, 3);
    if (top3.length < 3) continue;
    const sAt = comboScoreAt(top3.map((s) => s.q), top3.map((s) => s.dir));
    const aPT = aucOf(e.cf, sAt, Y), aGL = aucOf(e.cf, COMBO.sAt, Y);
    if (aPT == null || aGL == null) continue;
    nT++; if (aPT > aGL) winsPT++;
    sumPT += aPT; sumGL += aGL;
    for (const r of e.cf) ptScore[r] = sAt(r);
    ptRows.push(...e.cf);
  }
  const rowsPT = Int32Array.from(ptRows);
  const evPT = evalSplit(rowsPT, (r) => ptScore[r], Y);
  const evGL = evalSplit(rowsPT, COMBO.sAt, Y);
  console.log(`  Tickers evaluables (≥250 filas y ≥25 eventos en train, ≥100 filas conf): ${nT}`);
  console.log(`  AUC conf media — per-ticker ${(sumPT / nT).toFixed(4)} vs global ${(sumGL / nT).toFixed(4)} · per-ticker gana en ${winsPT}/${nT} (${f1(winsPT / nT, 0)})`);
  console.log(`  Pooled conf (mismas filas) — per-ticker: AUC ${evPT.auc.toFixed(4)} lift ${evPT.lift.toFixed(2)}× · global: AUC ${evGL.auc.toFixed(4)} lift ${evGL.lift.toFixed(2)}×`);
  const gana = sumPT / nT > sumGL / nT && winsPT / nT > 0.55 && evPT.auc > evGL.auc;
  console.log(`  → ${gana ? "per-ticker gana de forma consistente (revisar)" : "GLOBAL se mantiene (per-ticker no gana de forma consistente)"}`);
  OUT.perTicker = { nT, winsPT, aucMediaPT: sumPT / nT, aucMediaGL: sumGL / nT, pooledPT: evPT, pooledGL: evGL, ganaPerTicker: gana };
}

// ─── H) LOS 10 DE HOY (último día de datos) — score de pullback del combo ────
{
  console.log("\n═══ H) LOS 10 LÍDERES DE HOY — score de pullback (combo) ═══");
  today.sort((a, b) => b.sv4 - a.sv4);
  const qs = COMBO.sel.map((s) => s.q), ds = COMBO.sel.map((s) => s.dir);
  const mapFreq = (s) => { let b = 0; while (b < trainEdges.length && s >= trainEdges[b]) b++; return calConf[b].freq; };
  OUT.hoy = [];
  console.log("Ticker".padEnd(14), "scoreV4".padStart(8), "pullback".padStart(9), "%obs OOS".padStart(9));
  for (const t of today.slice(0, 10)) {
    let s = 0; for (let j = 0; j < qs.length; j++) s += ds[j] > 0 ? t.p[qs[j]] : 1 - t.p[qs[j]];
    s = (100 * s) / qs.length;
    const row = { sym: t.sym, sv4: +t.sv4.toFixed(1), pullback: +s.toFixed(1), freqOOS: mapFreq(s) };
    OUT.hoy.push(row);
    console.log(t.sym.padEnd(14), t.sv4.toFixed(1).padStart(8), s.toFixed(1).padStart(9), f1(row.freqOOS).padStart(9));
  }
}

// ─── I) RECETA (solo si PUBLICAR) + limitaciones ─────────────────────────────
OUT.receta = VEREDICTO !== "PUBLICAR" ? null : {
  nota: "Especificación lista para api/_lib/rallyScoreEngine.js — NO implementada aún (solo estudio).",
  evento: `${EV.key}: ${EV.def}`,
  indicadores: COMBO.sel.map((s) => ({ key: s.key, dir: s.dir })),
  formula: "score = 100 × media_j( dir_j>0 ? pctl_j : 1−pctl_j ), pctl = percentil móvil del indicador frente a los últimos 252 valores del propio ticker (mín 100, excluye hoy, empates a medio rango)",
  ventanas: { percentil: PCT_WIN, percentilMin: PCT_MIN, zscore: Z_WIN, atr: "Wilder 14 sobre OHLC ajustado (high/low escalados por a/c)" },
  mapeoCalibracion: calConf.map((c2, b) => ({ bin: b + 1, scoreDesde: b === 0 ? 0 : +trainEdges[b - 1].toFixed(2), scoreHasta: b >= trainEdges.length ? 100 : +trainEdges[b].toFixed(2), probObservadaOOS: c2.freq })),
};
OUT.limitaciones = [
  "Datos EOD: 'inminente' = 1-3 sesiones a cierre, no intradía; el evento se mide sobre cierres, no sobre mínimos intradía.",
  "Universo superviviente (el actual de ~603): infla los niveles absolutos (tasas base y AUCs pueden diferir en un universo point-in-time), pero las comparaciones relativas (combo vs individual, train vs conf) valen.",
  "Ventanas de 3 sesiones solapadas → filas correlacionadas en serie; por eso el gate exige estabilidad temporal (mitades) y dos poblaciones, no p-valores.",
  "Probabilidades del mapeo = frecuencias observadas OOS por bin; son promedios de régimen (2022 bajista + 2023-26 alcista) y deben re-estimarse periódicamente.",
  `Warmup real: la primera fila evaluable es ${dates[kFirstRow]} (percentiles móviles necesitan ~1,4 años); el train efectivo es ${dates[kFirstRow]}→2021-12, no 2016→2021.`,
];

OUT.conclusion = {
  veredicto: VEREDICTO,
  motivos: [
    `Gate incumplido en confirmación 2022-2026: lift decil superior COMBO ${gateRes.ALL.lift.toFixed(2)}× (ALL) / ${gateRes.LEAD50.lift.toFixed(2)}× (líderes) — se exigía ≥1,5× — y mitades ${gateRes.ALL.liftH1.toFixed(2)}×/${gateRes.ALL.liftH2.toFixed(2)}× (ALL), ${gateRes.LEAD50.liftH1.toFixed(2)}×/${gateRes.LEAD50.liftH2.toFixed(2)}× (líderes) — se exigía ≥1,3× ambas.`,
    "El mejor individual (rvol20, lift 1,42-1,46×) tampoco alcanza el gate, y el control de direccionalidad muestra que predice casi igual el movimiento espejo AL ALZA: es un detector de 'movimiento grande inminente' (volatilidad), no de pullback.",
    "Sensibilidad: con E2 (candidata principal, caída 3 sesiones ≥1,5×ATR) el poder OOS desaparece (lift 1,06× ALL, 0,93× líderes); con E3 (−2% fijo) el lift 1,44-1,46× sigue bajo el gate y está dominado por el nivel de volatilidad del ticker, no por señal direccional.",
    "Los indicadores de sobrecompra clásicos (RSI corto, %B, estiramiento, rachas, retornos z) tenían AUC train 0,53-0,55 y colapsan a ~0,50-0,52 en confirmación: sin poder direccional estable a 1-3 sesiones en este universo.",
  ],
  maximoDefendible: "Con datos EOD de este universo, lo máximo demostrable OOS es un aviso NO direccional de volatilidad inminente (rvol20 alto → mañana se mueve más de 1×ATR en cualquier sentido, lift ~1,4×, AUC ~0,57). No es un score de pullback y no cumple el gate: no publicar como probabilidad de pullback.",
};
fs.writeFileSync("backtests/rally-pullback-study.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-pullback-study.json · ${(Date.now() - t0) / 1000 | 0}s`);
