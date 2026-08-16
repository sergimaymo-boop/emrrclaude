/**
 * VERIFY-PULLBACK — LENTE 1 (auditor de corrección), 17-ago-2026.
 * Re-derivación INDEPENDIENTE del estudio rally-pullback-study.mjs sobre una
 * muestra determinista de ~34 tickers:
 *   (a) tasa base E1 (ret t+1 < −1,0×ATR%) en train (<2022) y confirmación (2022+)
 *   (b) AUC de RSI2 (percentil móvil, dirección invertida) en train y confirmación
 *   (c) AUC de rvol20 en confirmación (+ control espejo U1 al alza)
 *   (d) tests de lookahead: pctlArr/zArr del estudio vs fuerza bruta "solo previos"
 *   (e) caso borde: primera barra aceptada con h/l inválidos → NaN que mataría el ticker
 * Fórmulas re-implementadas desde cero (no copiadas), salvo pctlArr/zArr que se
 * copian LITERALMENTE del estudio SOLO para auditarlas contra fuerza bruta.
 * Determinista: muestra por paso fijo sobre símbolos ordenados.
 */
import fs from "node:fs";

const DATA = "data/universe-10y.json";
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyDates = series["SPY.US"].bars.map((b) => b.d);
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));
const kConfStart = spyDates.findIndex((d) => d >= "2022-01-01");

// ── muestra determinista: símbolos ordenados, paso fijo, ~34 tickers ─────────
const symsAll = Object.keys(series).filter((s) => s !== "SPY.US").sort();
const stride = Math.floor(symsAll.length / 34) || 1;
const sample = [];
for (let i = 0; i < symsAll.length && sample.length < 34; i += stride) {
  const b = series[symsAll[i]].bars;
  if (b && b.length >= 300) sample.push(symsAll[i]);
}
console.log(`Muestra determinista: ${sample.length} tickers (stride ${stride}):`);
console.log("  " + sample.join(", "));

// ── (e) caso borde en TODO el universo: primera barra aceptada con h/l malos ─
let edgeCases = [];
for (const sym of symsAll) {
  const bars = series[sym].bars;
  if (!bars || bars.length < 300) continue;
  let start = 0;
  while (start < bars.length && !(bars[start].c > 0 && bars[start].a > 0)) start++;
  if (bars.length - start < 300) continue;
  const b0 = bars[start];
  const ok0 = b0.c > 0 && b0.a > 0 && b0.h > 0 && b0.l > 0 && b0.h >= b0.l;
  if (!ok0) edgeCases.push(sym);
}
console.log(`\n(e) Tickers cuya PRIMERA barra aceptada tiene h/l inválidos (riesgo NaN→ticker excluido): ${edgeCases.length}` +
  (edgeCases.length ? " → " + edgeCases.join(", ") : ""));

// ── implementación INDEPENDIENTE de indicadores ──────────────────────────────
function myRsi(c, p) { // Wilder clásico: semilla = media de las p primeras variaciones
  const n = c.length, out = new Array(n).fill(NaN);
  if (n <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < n; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p;
    al = (al * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function myAtr14pct(h, l, c) { // Wilder 14 sobre OHLC ajustado, en % del cierre
  const n = c.length, out = new Array(n).fill(NaN);
  const tr = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = NaN;
  for (let i = 14; i < n; i++) {
    if (i === 14) { let s = 0; for (let q = 1; q <= 14; q++) s += tr[q]; a = s / 14; }
    else a = (a * 13 + tr[i]) / 14;
    if (Number.isFinite(a) && c[i] > 0) out[i] = (a / c[i]) * 100;
  }
  return out;
}
function myRvol20(vol) { // vol hoy / media de las 20 PREVIAS (excluye hoy)
  const n = vol.length, out = new Array(n).fill(NaN);
  for (let i = 20; i < n; i++) {
    let s = 0; for (let q = i - 20; q < i; q++) s += vol[q];
    const m = s / 20;
    if (m > 0 && vol[i] > 0) out[i] = vol[i] / m;
  }
  return out;
}
/** Percentil de fuerza bruta: x[i] frente a los ÚLTIMOS 252 valores FINITOS previos (mín 100). */
function brutePctl(x) {
  const n = x.length, out = new Array(n).fill(NaN);
  const prev = []; // todos los finitos previos, en orden
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (Number.isFinite(v)) {
      if (prev.length >= 100) {
        const win = prev.slice(-252);
        let less = 0, eq = 0;
        for (const b of win) { if (b < v) less++; else if (b === v) eq++; }
        out[i] = (less + 0.5 * eq) / win.length;
      }
      prev.push(v);
    }
  }
  return out;
}
function myAuc(scores, ys) { // Mann-Whitney con empates (rangos medios)
  const n = scores.length;
  let n1 = 0; for (const y of ys) n1 += y;
  const n0 = n - n1; if (!n1 || !n0) return null;
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let R1 = 0, i = 0;
  while (i < n) {
    let j = i; while (j + 1 < n && scores[ord[j + 1]] === scores[ord[i]]) j++;
    const rk = (i + j) / 2 + 1;
    for (let q = i; q <= j; q++) if (ys[ord[q]]) R1 += rk;
    i = j + 1;
  }
  return (R1 - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

// ── construir filas sobre la muestra ─────────────────────────────────────────
const rows = { split: [], e1: [], u1: [], pRsi2: [], pRvol: [] };
let nInvalidBars = 0;
for (const sym of sample) {
  const bars = series[sym].bars;
  let start = 0;
  while (start < bars.length && !(bars[start].c > 0 && bars[start].a > 0)) start++;
  const n = bars.length - start;
  const c = new Array(n), h = new Array(n), l = new Array(n), vol = new Array(n), mK = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i + start];
    const ok = b.c > 0 && b.a > 0 && b.h > 0 && b.l > 0 && b.h >= b.l;
    if (ok) { const f = b.a / b.c; c[i] = b.a; h[i] = b.h * f; l[i] = b.l * f; vol[i] = Number.isFinite(b.v) ? b.v : 0; }
    else { c[i] = c[i - 1]; h[i] = c[i]; l[i] = c[i]; vol[i] = 0; nInvalidBars++; }
    const k = dateIdx.get(b.d); mK[i] = k === undefined ? -1 : k;
  }
  const rsi2 = myRsi(c, 2), atrPct = myAtr14pct(h, l, c), rvol = myRvol20(vol);
  // ret10z: cadena tardía del estudio — la replico para aproximar su filtro de filas
  const ret10 = new Array(n).fill(NaN);
  for (let i = 10; i < n; i++) if (c[i - 10] > 0) ret10[i] = c[i] / c[i - 10] - 1;
  const z10 = new Array(n).fill(NaN);
  { const prev = [];
    for (let i = 0; i < n; i++) { const v = ret10[i]; if (!Number.isFinite(v)) continue;
      if (prev.length >= 100) { const win = prev.slice(-252); let s = 0, s2 = 0;
        for (const b of win) { s += b; s2 += b * b; }
        const m = s / win.length, sd = Math.sqrt(Math.max(0, s2 / win.length - m * m));
        if (sd > 0) z10[i] = (v - m) / sd; }
      prev.push(v); } }
  const pRsi2 = brutePctl(rsi2), pRvol = brutePctl(rvol), pZ10 = brutePctl(z10);
  for (let i = 190; i + 3 < n; i++) { // i>=190 ≈ exigencia sv4 (c[i-189]>0) del estudio
    if (mK[i] < 0 || c[i - 189] <= 0) continue;
    if (![atrPct[i], pRsi2[i], pRvol[i], pZ10[i]].every(Number.isFinite)) continue;
    const r1 = c[i + 1] / c[i] - 1;
    rows.split.push(mK[i] < kConfStart ? 0 : 1);
    rows.e1.push(r1 < (-1.0 * atrPct[i]) / 100 ? 1 : 0);
    rows.u1.push(r1 > (1.0 * atrPct[i]) / 100 ? 1 : 0);
    rows.pRsi2.push(pRsi2[i]);
    rows.pRvol.push(pRvol[i]);
  }
}
const NR = rows.split.length;
const sel = (splitVal) => {
  const iTr = [];
  for (let i = 0; i < NR; i++) if (rows.split[i] === splitVal) iTr.push(i);
  return iTr;
};
const iTrain = sel(0), iConf = sel(1);
const baseOf = (idxs, Y) => idxs.reduce((s, i) => s + Y[i], 0) / idxs.length;
const aucOn = (idxs, S, Y) => myAuc(idxs.map((i) => S[i]), idxs.map((i) => Y[i]));

console.log(`\nFilas muestra: ${NR.toLocaleString("es")} (train ${iTrain.length.toLocaleString("es")} · conf ${iConf.length.toLocaleString("es")}) · barras inválidas forward-fill: ${nInvalidBars}`);

// (a) tasa base E1
const bTr = baseOf(iTrain, rows.e1), bCf = baseOf(iConf, rows.e1), bU1 = baseOf(iConf, rows.u1);
console.log(`\n(a) Tasa base E1 — train: ${(bTr * 100).toFixed(2)}% (estudio 6,50%) · conf: ${(bCf * 100).toFixed(2)}% (estudio 6,46%) · U1 conf: ${(bU1 * 100).toFixed(2)}% (estudio 6,54%)`);

// (b) AUC RSI2 (dirección −1 fijada en train por el estudio → uso 1−p)
const sRsi2Inv = rows.pRsi2.map((p) => 1 - p);
const aR2tr = aucOn(iTrain, sRsi2Inv, rows.e1), aR2cf = aucOn(iConf, sRsi2Inv, rows.e1);
console.log(`(b) AUC rsi2(1−pctl) — train: ${aR2tr.toFixed(4)} (estudio 0,5453) · conf: ${aR2cf.toFixed(4)} (estudio 0,5137)`);

// (c) AUC rvol20 en conf + control espejo U1
const aRVtr = aucOn(iTrain, rows.pRvol, rows.e1);
const aRVcf = aucOn(iConf, rows.pRvol, rows.e1);
const aRVup = aucOn(iConf, rows.pRvol, rows.u1);
console.log(`(c) AUC rvol20(pctl) — train: ${aRVtr.toFixed(4)} (estudio 0,5916) · conf vs E1(baja): ${aRVcf.toFixed(4)} (estudio 0,5680) · conf vs U1(sube): ${aRVup.toFixed(4)} (estudio 0,5599)`);

// ── (d) tests de lookahead sobre pctlArr/zArr COPIADAS del estudio ───────────
const PCT_WIN = 252, PCT_MIN = 100, Z_WIN = 252, Z_MIN = 100;
function pctlArr(x) { // copia literal del estudio
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
function zArr(x) { // copia literal del estudio
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
// serie sintética determinista + serie real (rsi2 del primer ticker de la muestra)
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const rnd = lcg(12345);
const synth = Array.from({ length: 1500 }, () => rnd() * 100);
for (let i = 0; i < 1500; i += 97) synth[i] = NaN; // huecos para probar el manejo de NaN
const firstSym = sample[0];
{
  const bars = series[firstSym].bars;
  const c = bars.filter((b) => b.a > 0).map((b) => b.a);
  const real = myRsi(c, 2);
  let worstP = 0, worstZ = 0, nCmp = 0;
  for (const serie of [synth, real]) {
    const study = pctlArr(serie), mine = brutePctl(serie);
    const studyZ = zArr(serie);
    // z de fuerza bruta (mín 100, ventana 252, excluye hoy — divisor n como el estudio)
    const prev = [];
    const bruteZ = new Array(serie.length).fill(NaN);
    for (let i = 0; i < serie.length; i++) { const v = serie[i]; if (!Number.isFinite(v)) continue;
      if (prev.length >= 100) { const win = prev.slice(-252); let s = 0, s2 = 0;
        for (const b of win) { s += b; s2 += b * b; }
        const m = s / win.length, sd = Math.sqrt(Math.max(0, s2 / win.length - m * m));
        if (sd > 0) bruteZ[i] = (v - m) / sd; }
      prev.push(v); }
    for (let i = 0; i < serie.length; i++) {
      const a = study[i], b = mine[i];
      if (Number.isFinite(a) !== Number.isFinite(b)) { worstP = Infinity; }
      else if (Number.isFinite(a)) { worstP = Math.max(worstP, Math.abs(a - b)); nCmp++; }
      const za = studyZ[i], zb = bruteZ[i];
      if (Number.isFinite(za) && Number.isFinite(zb)) worstZ = Math.max(worstZ, Math.abs(za - zb));
    }
  }
  console.log(`\n(d) Lookahead — pctlArr estudio vs fuerza bruta (solo previos, excluye hoy): dif máx ${worstP === Infinity ? "DESAJUSTE DE VALIDEZ" : worstP.toExponential(2)} en ${nCmp} puntos comparados`);
  console.log(`    zArr estudio vs fuerza bruta: dif máx ${worstZ.toExponential(2)}`);
  console.log(`    → ${worstP < 1e-6 && worstZ < 1e-9 ? "SIN lookahead: el día t queda excluido de su propia ventana" : "REVISAR: discrepancia detectada"}`);
}

// test explícito de lookahead: perturbar el valor de HOY no debe cambiar el percentil de HOY
{
  const a = synth.slice();
  const pa = pctlArr(a);
  const i0 = 800;
  const b = synth.slice(); b[i0] = b[i0] + 5; // cambia solo hoy
  const pb = pctlArr(b);
  // el percentil de mañana en adelante SÍ puede cambiar (hoy entra en la ventana de mañana):
  const differs = (x, y) => !(Object.is(x, y) || (Number.isNaN(x) && Number.isNaN(y)));
  let changedFuture = false;
  for (let i = i0 + 1; i < synth.length; i++) if (differs(pa[i], pb[i])) { changedFuture = true; break; }
  // pero los percentiles ANTERIORES a hoy no deben cambiar jamás (el de hoy sí:
  // hoy se rankea contra la ventana previa, cambiar su valor cambia su rango — legítimo):
  let changedPast = false;
  for (let i = 0; i < i0; i++) if (differs(pa[i], pb[i])) { changedPast = true; break; }
  console.log(`    Perturbación en t=${i0}: pasado intacto ${changedPast ? "NO ✗" : "SÍ ✓"} · futuro afectado (esperado) ${changedFuture ? "SÍ ✓" : "NO"}`);
}
console.log("\nHecho.");
