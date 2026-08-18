/**
 * LENTE 2 — RESCATE DE SEÑAL del estudio rally-pullback-study (17-ago-2026).
 * Objetivo: intentar REFUTAR el "NO PUBLICAR" encontrando una variante SIN fugas
 * que pase el gate en confirmación 2022-2026:
 *   · lift decil superior ≥ 1,5× la tasa base, Y
 *   · ambas sub-mitades de confirmación ≥ 1,3×, Y
 *   · calibración monótona (bins por deciles de train; sin inversión grosera; ρ≥0,9).
 *
 * DISCIPLINA WALK-FORWARD (idéntica al estudio):
 *   · Todo lo interno (dirección del score, bordes de calibración, selección del
 *     candidato primario) se decide SOLO con train 2017-06→2021-12.
 *   · Confirmación 2022-01→2026-08 intocada salvo para el gate.
 *   · PROTOCOLO PRIMARIO pre-registrado: por cada (evento × población) se
 *     selecciona UN score por lift de decil superior EN TRAIN (desempate AUC
 *     train); solo ese pasa al gate como candidato "walk-forward puro". El resto
 *     se reporta como tabla exploratoria (multiple testing: cualquier "pass"
 *     exploratorio va con esa advertencia).
 *   · Control de direccionalidad: para cada celda se mide el lift del MISMO
 *     score sobre el evento espejo AL ALZA (mismo umbral, mismo horizonte).
 *
 * VARIANTES (pre-registradas):
 *   Eventos: E1 (ret t+1<−1,0×ATR%) · E3s (mín 3 ses ≤−1,5×ATR%) ·
 *            E5s15 (mín 5 ses ≤−1,5×ATR%) · E5s20 (mín 5 ses ≤−2,0×ATR%).
 *            [Gap a la baja al open: IMPOSIBLE — universe-10y.json no trae open.]
 *   Poblaciones: ALL · LEAD50 (top-50/día por score v4) · REGON (SPY>EMA50 en t)
 *            · L50REG (líderes ∩ régimen). REGOFF solo informativo.
 *   Scores (percentiles móviles 252d por ticker, excluyen hoy, como el estudio):
 *     rvol        = p(rvol20)
 *     atrExp      = p(ATR5/ATR20)
 *     rvolRed     = día rojo ? p(rvol20) : 0        (asimetría del rvol)
 *     rvolGreen   = día verde ? p(rvol20) : 0       (control de la asimetría)
 *     volSell     = min(p(rvol20), 1−p(rangePos))   (volumen alto + cierre en mínimos)
 *     volDown     = min(p(rvol20), p(dRet))         (volumen alto + caída grande hoy, dRet=−ret/ATR%)
 *     volStretch  = min(p(rvol20), p(stretch20))    (mandato: rvol alto Y estiramiento alto)
 *     streakB     = min(p(upStreak), p(%B))         (mandato: racha larga Y %B alto)
 *     meanVS      = (p(rvol20)+1−p(rangePos))/2
 *     bigRed      = p(dRet)                          (caída de hoy en ATRs)
 *   Dirección de cada score: fijada por AUC de TRAIN de su celda (flip si <0,5).
 *
 * Mismas convenciones de datos que el estudio (cierre ajustado; high/low ×a/c;
 * volumen crudo → ratio; percentil móvil 252/mín100 excluyendo hoy; sin lookahead).
 * Determinista. Salida JSON: scratchpad (no toca backtests/ del estudio).
 */
import fs from "node:fs";
import { DATA, isNum, clamp, spearman, f1 } from "./rally-study-lib.mjs";

const t0 = Date.now();
const OUTPATH = process.env.LENS2_OUT ??
  "/private/tmp/claude-501/-Users-sergimaymo-Desktop-Bolsa-Codex/94df227a-26bb-46ac-8ff3-cb53bfbeec87/scratchpad/verify-pullback-lens2.json";
const GATE = { liftTop: 1.5, liftHalves: 1.3, calibSpearmanMin: 0.9, invAbs: 0.015, invRel: 0.15, invMinN: 200 };
const OUT = { ranAt: new Date().toISOString(), params: { data: DATA, gate: GATE, confStart: "2022-01-01" } };

// ─── carga ───────────────────────────────────────────────────────────────────
console.log("Cargando universo…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyBars = series["SPY.US"].bars;
const dates = spyBars.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
console.log(`Campos de una barra: ${Object.keys(spyBars[100]).join(",")} (sin 'o' → gap-open imposible)`);

// régimen SPY>EMA50 (adjusted close, conocido al cierre de t)
const spyAdj = spyBars.map((b) => b.a);
const REG = new Uint8Array(D);
{
  let e = 0; for (let i = 0; i < 50; i++) e += spyAdj[i]; e /= 50;
  const k = 2 / 51;
  for (let i = 50; i < D; i++) { e = spyAdj[i] * k + e * (1 - k); REG[i] = spyAdj[i] > e ? 1 : 0; }
}

const PCT_WIN = 252, PCT_MIN = 100;
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
function emaArr(v, p) {
  const n = v.length, out = new Float64Array(n).fill(NaN);
  if (n < p) return out;
  let e = 0; for (let i = 0; i < p; i++) e += v[i]; e /= p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < n; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

class Col {
  constructor(T) { this.T = T; this.a = new T(1 << 20); this.n = 0; }
  push(v) { if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  trim() { return this.a.subarray(0, this.n); }
}
const FEATS = ["rvol20", "rangePos", "stretch20", "upStreak", "pctB", "dRet", "atrExp"];
const NF = FEATS.length;
const cK = new Col(Int32Array), cRED = new Col(Uint8Array), cSV4 = new Col(Float32Array);
const EV_KEYS = ["E1", "E3s", "E5s15", "E5s20", "U1", "U3s", "U5s15", "U5s20"];
const cEV = EV_KEYS.map(() => new Col(Uint8Array));
const cP = FEATS.map(() => new Col(Float32Array));

let nTk = 0, filledBars = 0;
for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  let n = bars.length;
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
    } else if (i === 0) {
      // i=0 sin barra previa que forward-fillear: el recorte de cabecera garantiza
      // c>0 y a>0 aquí (solo h/l pueden ser inválidos) → usar la propia barra.
      c[0] = b.a; h[0] = b.a; l[0] = b.a; vol[0] = 0; filledBars++;
    } else { c[i] = c[i - 1]; h[i] = c[i]; l[i] = c[i]; vol[i] = 0; filledBars++; }
    const k = dateIdx.get(b.d);
    mK[i] = k === undefined ? -1 : k;
  }
  // ATR14 Wilder + atrPct
  const tr = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  const atr14 = new Float64Array(n).fill(NaN);
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
  const ema20 = emaArr(c, 20);
  const sma20 = new Float64Array(n).fill(NaN), sd20 = new Float64Array(n).fill(NaN);
  { let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) { s += c[i]; s2 += c[i] * c[i];
      if (i >= 20) { s -= c[i - 20]; s2 -= c[i - 20] * c[i - 20]; }
      if (i >= 19) { const m = s / 20; sma20[i] = m; sd20[i] = Math.sqrt(Math.max(0, s2 / 20 - m * m)); } } }

  const F = {};
  for (const k2 of FEATS) F[k2] = new Float64Array(n).fill(NaN);
  { let streak = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) streak = c[i] > c[i - 1] ? streak + 1 : 0;
      F.upStreak[i] = streak;
      if (Number.isFinite(sd20[i]) && sd20[i] > 0) F.pctB[i] = (c[i] - (sma20[i] - 2 * sd20[i])) / (4 * sd20[i]);
      if (Number.isFinite(ema20[i]) && Number.isFinite(atr14[i]) && atr14[i] > 0) F.stretch20[i] = (c[i] - ema20[i]) / atr14[i];
      if (Number.isFinite(atr5m[i]) && Number.isFinite(atr20m[i]) && atr20m[i] > 0) F.atrExp[i] = atr5m[i] / atr20m[i];
      const rng = h[i] - l[i];
      if (rng > 0) F.rangePos[i] = (c[i] - l[i]) / rng;
      if (i > 0 && c[i - 1] > 0 && Number.isFinite(atrPct[i]) && atrPct[i] > 0)
        F.dRet[i] = (-(c[i] / c[i - 1] - 1) * 100) / atrPct[i];
    } }
  { let s = 0;
    for (let i = 0; i < n; i++) {
      if (i >= 20) { const m = s / 20; if (m > 0 && vol[i] > 0) F.rvol20[i] = vol[i] / m; }
      s += vol[i]; if (i >= 20) s -= vol[i - 20];
    } }
  const P = FEATS.map((k2) => pctlArr(F[k2]));
  const sv4 = new Float64Array(n).fill(NaN);
  for (let i = 189; i < n; i++) if (c[i - 189] > 0) sv4[i] = clamp(50 + 50 * Math.tanh(((c[i] / c[i - 189] - 1) * 100) / 75));

  for (let i = 1; i < n; i++) {
    if (i + 5 >= n) break;
    let ok = Number.isFinite(atrPct[i]) && atrPct[i] > 0 && Number.isFinite(sv4[i]) && mK[i] >= 0 && c[i - 1] > 0;
    if (ok) for (let q = 0; q < NF; q++) if (!Number.isFinite(P[q][i])) { ok = false; break; }
    if (!ok) continue;
    const A = atrPct[i] / 100;
    const r1 = c[i + 1] / c[i] - 1;
    const min3 = Math.min(c[i + 1], c[i + 2], c[i + 3]) / c[i] - 1;
    const max3 = Math.max(c[i + 1], c[i + 2], c[i + 3]) / c[i] - 1;
    const min5 = Math.min(c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5]) / c[i] - 1;
    const max5 = Math.max(c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5]) / c[i] - 1;
    cK.push(mK[i]); cRED.push(c[i] < c[i - 1] ? 1 : 0); cSV4.push(sv4[i]);
    const evVals = [r1 < -1.0 * A, min3 <= -1.5 * A, min5 <= -1.5 * A, min5 <= -2.0 * A,
      r1 > 1.0 * A, max3 >= 1.5 * A, max5 >= 1.5 * A, max5 >= 2.0 * A];
    for (let e = 0; e < EV_KEYS.length; e++) cEV[e].push(evVals[e] ? 1 : 0);
    for (let q = 0; q < NF; q++) cP[q].push(P[q][i]);
  }
  nTk++;
  if (nTk % 100 === 0) console.log(`  …${nTk} tickers (${((Date.now() - t0) / 1000) | 0}s)`);
}

const K = cK.trim(), RED = cRED.trim(), SV4 = cSV4.trim();
const EVCOLS = Object.fromEntries(EV_KEYS.map((k2, e) => [k2, cEV[e].trim()]));
const P = cP.map((c2) => c2.trim());
const N = K.length;
console.log(`Tickers: ${nTk} · filas: ${N.toLocaleString("es")} · barras rellenadas: ${filledBars}`);

// LEAD50 por día (top-50 por sv4, réplica del estudio)
const LEAD50 = new Uint8Array(N);
{
  const byDay = Array.from({ length: D }, () => []);
  for (let r = 0; r < N; r++) byDay[K[r]].push(r);
  for (const list of byDay) {
    list.sort((a, b) => SV4[b] - SV4[a] || a - b);
    const m = Math.min(50, list.length);
    for (let j = 0; j < m; j++) LEAD50[list[j]] = 1;
  }
}

// splits temporales (idénticos al estudio)
const kConfStart = dates.findIndex((d) => d >= "2022-01-01");
const kConfMid = Math.floor((kConfStart + (D - 1)) / 2);
let kFirstRow = D; for (let r = 0; r < N; r++) if (K[r] < kFirstRow) kFirstRow = K[r];
const kTrainMid = Math.floor((kFirstRow + kConfStart - 1) / 2);
const baseIdx = { train: [], trainH1: [], trainH2: [], conf: [], confH1: [], confH2: [] };
for (let r = 0; r < N; r++) {
  const k = K[r];
  if (k < kConfStart) { baseIdx.train.push(r); (k <= kTrainMid ? baseIdx.trainH1 : baseIdx.trainH2).push(r); }
  else { baseIdx.conf.push(r); (k <= kConfMid ? baseIdx.confH1 : baseIdx.confH2).push(r); }
}
for (const key of Object.keys(baseIdx)) baseIdx[key] = Int32Array.from(baseIdx[key]);
console.log(`Train ${dates[kFirstRow]}→${dates[kConfStart - 1]}: ${baseIdx.train.length.toLocaleString("es")} · ` +
  `Conf ${dates[kConfStart]}→${dates.at(-1)}: ${baseIdx.conf.length.toLocaleString("es")}`);
OUT.splits = { train: [dates[kFirstRow], dates[kConfStart - 1]], conf: [dates[kConfStart], dates.at(-1)], nRows: N, nTickers: nTk };

// poblaciones
const inPop = {
  ALL: () => true,
  LEAD50: (r) => LEAD50[r] === 1,
  REGON: (r) => REG[K[r]] === 1,
  REGOFF: (r) => REG[K[r]] === 0,
  L50REG: (r) => LEAD50[r] === 1 && REG[K[r]] === 1,
};
const POPS = ["ALL", "LEAD50", "REGON", "L50REG", "REGOFF"];
const popIdx = {};
for (const pk of POPS) {
  const f = inPop[pk];
  popIdx[pk] = {};
  for (const sk of Object.keys(baseIdx)) {
    const o = []; for (const r of baseIdx[sk]) if (f(r)) o.push(r);
    popIdx[pk][sk] = Int32Array.from(o);
  }
}

// scores
const iF = Object.fromEntries(FEATS.map((k2, q) => [k2, q]));
const SCORES = {
  rvol: (r) => P[iF.rvol20][r],
  atrExp: (r) => P[iF.atrExp][r],
  rvolRed: (r) => (RED[r] ? P[iF.rvol20][r] : 0),
  rvolGreen: (r) => (RED[r] ? 0 : P[iF.rvol20][r]),
  volSell: (r) => Math.min(P[iF.rvol20][r], 1 - P[iF.rangePos][r]),
  volDown: (r) => Math.min(P[iF.rvol20][r], P[iF.dRet][r]),
  volStretch: (r) => Math.min(P[iF.rvol20][r], P[iF.stretch20][r]),
  streakB: (r) => Math.min(P[iF.upStreak][r], P[iF.pctB][r]),
  meanVS: (r) => (P[iF.rvol20][r] + 1 - P[iF.rangePos][r]) / 2,
  bigRed: (r) => P[iF.dRet][r],
};
const SCORE_KEYS = Object.keys(SCORES);
const MIRROR = { E1: "U1", E3s: "U3s", E5s15: "U5s15", E5s20: "U5s20" };
const DOWN_EVENTS = Object.keys(MIRROR);

// ─── evaluación (réplica del estudio) ────────────────────────────────────────
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
function evalSplit(rows, scoreAt, Y) {
  const n = rows.length; if (!n) return null;
  const s = new Float64Array(n); let n1 = 0;
  for (let i = 0; i < n; i++) { s[i] = scoreAt(rows[i]); n1 += Y[rows[i]]; }
  const base = n1 / n;
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => s[b] - s[a] || rows[a] - rows[b]);
  const m = Math.max(1, Math.floor(n / 10));
  let e = 0; for (let i = 0; i < m; i++) e += Y[rows[ord[i]]];
  const freqTop = e / m;
  return { n, base, freqTop, lift: base > 0 ? freqTop / base : null };
}
function quantileEdges(rows, scoreAt, nb = 10) {
  const s = Array.from(rows, (r) => scoreAt(r)).sort((a, b) => a - b);
  const edges = [];
  for (let q = 1; q < nb; q++) edges.push(s[Math.floor((q * s.length) / nb)]);
  return edges;
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
function monotoneCheck(cal) {
  const usable = cal.filter((c2) => c2.n >= GATE.invMinN && c2.freq != null);
  let gross = 0;
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1].freq, cur = usable[i].freq;
    if (cur < prev - Math.max(GATE.invAbs, GATE.invRel * prev)) gross++;
  }
  const rho = spearman(usable.map((c2, i) => i), usable.map((c2) => c2.freq));
  return { gross, rho, monotona: gross === 0 && rho != null && rho >= GATE.calibSpearmanMin };
}

// ─── barrido: (evento × población × score), todo elegido en train ────────────
console.log("\n═══ BARRIDO WALK-FORWARD (dirección y bordes por celda, SOLO train) ═══");
const cells = [];
for (const evKey of DOWN_EVENTS) {
  const Y = EVCOLS[evKey];
  const YU = EVCOLS[MIRROR[evKey]];
  for (const pk of POPS) {
    const ix = popIdx[pk];
    if (ix.conf.length < 5000) continue;
    let bTr = 0; for (const r of ix.train) bTr += Y[r]; bTr /= ix.train.length;
    for (const sk of SCORE_KEYS) {
      const s0 = SCORES[sk];
      const a0 = aucOf(ix.train, s0, Y);
      if (a0 == null) continue;
      const dir = a0 >= 0.5 ? 1 : -1;
      const sAt = dir > 0 ? s0 : (r) => 1 - s0(r);
      const tr = evalSplit(ix.train, sAt, Y);
      const trH1 = evalSplit(ix.trainH1, sAt, Y), trH2 = evalSplit(ix.trainH2, sAt, Y);
      const cf = evalSplit(ix.conf, sAt, Y);
      const cfH1 = evalSplit(ix.confH1, sAt, Y), cfH2 = evalSplit(ix.confH2, sAt, Y);
      const edges = quantileEdges(ix.train, sAt, 10);
      const mono = monotoneCheck(calibBins(ix.conf, sAt, Y, edges));
      const up = evalSplit(ix.conf, sAt, YU);
      const pass = cf.lift >= GATE.liftTop && cfH1.lift >= GATE.liftHalves && cfH2.lift >= GATE.liftHalves && mono.monotona;
      cells.push({
        evento: evKey, pop: pk, score: sk, dir,
        aucTr: a0 >= 0.5 ? a0 : 1 - a0,
        baseTr: bTr, liftTr: tr.lift, liftTrH1: trH1.lift, liftTrH2: trH2.lift,
        nConf: cf.n, baseConf: cf.base, freqTopConf: cf.freqTop,
        liftConf: cf.lift, liftConfH1: cfH1.lift, liftConfH2: cfH2.lift,
        monotona: mono.monotona, rho: mono.rho, gross: mono.gross,
        liftUpConf: up.lift, baseUpConf: up.base, pass,
      });
    }
    console.log(`  ${evKey} × ${pk} listo (${((Date.now() - t0) / 1000) | 0}s)`);
  }
}
OUT.cells = cells;
if (!cells.length) {
  console.error("✗ El barrido no produjo NINGUNA celda evaluable (poblaciones con <5000 filas de confirmación o AUC incalculable en todas): sin eventos que califiquen no hay lente. Revisar datos/poblaciones antes de re-ejecutar.");
  process.exit(1);
}

// ─── protocolo PRIMARIO: selección en train por celda (evento×población) ─────
console.log("\n═══ PRIMARIO WALK-FORWARD: mejor score POR TRAIN en cada (evento×población) ═══");
const header = ["evento", "pop", "score(dir)", "AUCtr", "liftTr", "baseCf", "liftCf", "H1", "H2", "mono", "liftUp", "GATE"];
console.log(header.map((h2) => h2.padEnd(11)).join(""));
const primaries = [];
for (const evKey of DOWN_EVENTS) {
  for (const pk of POPS) {
    if (pk === "REGOFF") continue; // informativo, no candidato de publicación
    const sub = cells.filter((c2) => c2.evento === evKey && c2.pop === pk);
    if (!sub.length) continue;
    sub.sort((a, b) => b.liftTr - a.liftTr || b.aucTr - a.aucTr);
    const w = sub[0];
    primaries.push(w);
    console.log([w.evento, w.pop, `${w.score}(${w.dir > 0 ? "+" : "−"})`, w.aucTr.toFixed(4), `${w.liftTr.toFixed(2)}×`,
      f1(w.baseConf), `${w.liftConf.toFixed(2)}×`, `${w.liftConfH1.toFixed(2)}×`, `${w.liftConfH2.toFixed(2)}×`,
      w.monotona ? "sí" : "NO", `${w.liftUpConf.toFixed(2)}×`, w.pass ? "PASA ✓" : "falla"]
      .map((x) => String(x).padEnd(11)).join(""));
  }
}
OUT.primaries = primaries;

// ─── tabla exploratoria: cualquier celda que pase el gate ────────────────────
const passers = cells.filter((c2) => c2.pass && c2.pop !== "REGOFF");
console.log(`\n═══ EXPLORATORIO: celdas que pasan el gate (${passers.length} de ${cells.length}) — multiple testing, interpretar con cautela ═══`);
passers.sort((a, b) => b.liftConf - a.liftConf);
for (const w of passers) {
  console.log([w.evento, w.pop, `${w.score}(${w.dir > 0 ? "+" : "−"})`, w.aucTr.toFixed(4), `${w.liftTr.toFixed(2)}×`,
    f1(w.baseConf), `${w.liftConf.toFixed(2)}×`, `${w.liftConfH1.toFixed(2)}×`, `${w.liftConfH2.toFixed(2)}×`,
    w.monotona ? "sí" : "NO", `${w.liftUpConf.toFixed(2)}×`, "PASA ✓"]
    .map((x) => String(x).padEnd(11)).join(""));
}
OUT.passers = passers;

// ─── detalle del mejor candidato primario que pase (si existe) ───────────────
const bestPrimary = primaries.filter((c2) => c2.pass).sort((a, b) => b.liftConf - a.liftConf)[0] ?? null;
const bestAny = passers[0] ?? null;
OUT.bestPrimary = bestPrimary; OUT.bestAny = bestAny;
function detail(cell) {
  const Y = EVCOLS[cell.evento];
  const ix = popIdx[cell.pop];
  const s0 = SCORES[cell.score];
  const sAt = cell.dir > 0 ? s0 : (r) => 1 - s0(r);
  const edges = quantileEdges(ix.train, sAt, 10);
  const calTr = calibBins(ix.train, sAt, Y, edges);
  const calCf = calibBins(ix.conf, sAt, Y, edges);
  console.log(`\n— Calibración ${cell.evento}×${cell.pop}×${cell.score}: bin | n_tr | %ev_tr | n_cf | %ev_cf`);
  for (let b = 0; b < 10; b++)
    console.log(`  ${String(b + 1).padStart(3)} | ${String(calTr[b].n).padStart(7)} | ${f1(calTr[b].freq).padStart(7)} | ${String(calCf[b].n).padStart(7)} | ${f1(calCf[b].freq).padStart(7)}`);
  return { edges, calTrain: calTr, calConf: calCf };
}
if (bestPrimary) OUT.bestPrimaryDetail = detail(bestPrimary);
if (bestAny && bestAny !== bestPrimary) OUT.bestAnyDetail = detail(bestAny);

const verdict = bestPrimary ? "REFUTA (primario pasa)" : passers.length ? "MATIZA (solo pases exploratorios)" : "CONFIRMA NO PUBLICAR";
console.log(`\n→ RESULTADO LENTE 2: ${verdict}`);
OUT.resultado = verdict;
fs.writeFileSync(OUTPATH, JSON.stringify(OUT, null, 1));
console.log(`Guardado: ${OUTPATH} · ${((Date.now() - t0) / 1000) | 0}s`);
