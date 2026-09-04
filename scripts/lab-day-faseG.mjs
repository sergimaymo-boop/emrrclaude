/**
 * LAB-DAY FASE G — INDICADORES CLÁSICOS (pregunta de Sergi, 4-sep-2026):
 * "¿solo tienes en cuenta el momentum? ¿no has probado otros indicadores para
 * que el motor sea más potente?"
 *
 * Lo ya probado en fases anteriores (todo perdió contra M189s10): Sharpe-momentum,
 * calidad de tendencia (pendiente×R²), suavidad FIP, fuerza relativa vs SPY,
 * proximidad a máximos 252d, consistencia mensual, aceleración, correlación,
 * amplitud, histéresis... Lo que FALTABA: los clásicos de manual — RSI, MACD,
 * cruce de medias (golden cross), y VOLUMEN (el dataset lo trae y nunca se usó).
 *
 * Se prueban en DOS papeles:
 *   · MOTOR AUTÓNOMO (¿pueden sustituir al momentum?)
 *   · INCLINACIÓN sobre M189s10 (¿pueden mejorarlo como confirmación?)
 * Construcción fija v1.1 (K5·SCORE·R63·F45·RESCAN2) para aislar el eje señal.
 * Ensemble 10 fases · elegir por TRAIN · gate: batir a v1.1 en trainWorst SIN
 * perder confirm (media ni peor fase). Salida: backtests/lab-day-faseG.json
 */
import fs from "node:fs";
import { evaluar, fila, T, RET, dates, D, mom, squash, isNum } from "./lab-day-core.mjs";

const N = T.length;

// ─── series precomputadas por ticker (O(N·D), una vez) ───────────────────────
console.log("Precomputando RSI(14), MACD(12/26/9), SMA50/200 y flujo de volumen…");
const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8")).series;
const dateIdx = new Map(dates.map((d, i) => [d, i]));

const RSI = [], MACDN = [], HIST = [], S50 = [], S200 = [], FLOW = [], VSURGE = [];
for (let ti = 0; ti < N; ti++) {
  const adj = T[ti].adj;
  // volumen alineado al calendario maestro
  const vol = new Array(D).fill(null);
  for (const b of (raw[T[ti].sym]?.bars ?? [])) {
    const k = dateIdx.get(b.d);
    if (k != null && isNum(b.v)) vol[k] = b.v;
  }
  // RSI(14) de Wilder sobre cierre ajustado
  const rsi = new Array(D).fill(null);
  let ag = 0, al = 0, inicializado = false, cnt = 0;
  for (let i = 1; i < D; i++) {
    const r = RET[ti][i];
    if (r == null) continue;
    const g = Math.max(r, 0), l = Math.max(-r, 0);
    cnt++;
    if (!inicializado) { ag += g; al += l; if (cnt === 14) { ag /= 14; al /= 14; inicializado = true; } continue; }
    ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  RSI.push(rsi);
  // MACD 12/26/9 (EMAs sobre ajustado), normalizado por precio
  const e12 = new Array(D).fill(null), e26 = new Array(D).fill(null);
  let a12 = null, a26 = null;
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  const macd = new Array(D).fill(null), sig = new Array(D).fill(null);
  let a9 = null;
  for (let i = 0; i < D; i++) {
    const p = adj[i];
    if (!isNum(p)) continue;
    a12 = a12 == null ? p : p * k12 + a12 * (1 - k12);
    a26 = a26 == null ? p : p * k26 + a26 * (1 - k26);
    e12[i] = a12; e26[i] = a26;
    const m = a12 - a26;
    macd[i] = m;
    a9 = a9 == null ? m : m * k9 + a9 * (1 - k9);
    sig[i] = a9;
  }
  MACDN.push(macd.map((m, i) => (m != null && isNum(adj[i]) && adj[i] > 0 ? m / adj[i] : null)));
  HIST.push(macd.map((m, i) => (m != null && sig[i] != null && isNum(adj[i]) && adj[i] > 0 ? (m - sig[i]) / adj[i] : null)));
  // SMA50 / SMA200
  const s50 = new Array(D).fill(null), s200 = new Array(D).fill(null);
  let sum50 = 0, sum200 = 0, n50 = 0, n200 = 0;
  const buf = [];
  for (let i = 0; i < D; i++) {
    const p = adj[i];
    buf.push(isNum(p) ? p : null);
    if (isNum(p)) { sum50 += p; n50++; sum200 += p; n200++; }
    if (buf.length > 50) { const q = buf[buf.length - 51]; if (q != null) { sum50 -= q; n50--; } }
    if (buf.length > 200) { const q = buf[buf.length - 201]; if (q != null) { sum200 -= q; n200--; } }
    if (n50 >= 40) s50[i] = sum50 / n50;
    if (n200 >= 160) s200[i] = sum200 / n200;
  }
  S50.push(s50); S200.push(s200);
  // FLUJO: volumen con signo, 63 sesiones → [−1,1] (acumulación vs distribución)
  const flow = new Array(D).fill(null), vsurge = new Array(D).fill(null);
  for (let i = 63; i < D; i++) {
    let sv = 0, tv = 0, v21 = 0, n21 = 0, v126 = 0, n126 = 0;
    for (let k = i - 62; k <= i; k++) {
      const r = RET[ti][k], v = vol[k];
      if (r == null || !isNum(v)) continue;
      sv += Math.sign(r) * v; tv += v;
    }
    if (tv > 0) flow[i] = sv / tv;
    for (let k = i - 20; k <= i; k++) { const v = vol[k]; if (isNum(v)) { v21 += v; n21++; } }
    for (let k = i - 125; k <= i; k++) { const v = vol[k]; if (isNum(v)) { v126 += v; n126++; } }
    if (n21 >= 15 && n126 >= 90 && v126 > 0) vsurge[i] = (v21 / n21) / (v126 / n126);
  }
  FLOW.push(flow); VSURGE.push(vsurge);
}
console.log("Series listas.\n");

// ─── señales: motores autónomos y tilts sobre M189s10 ────────────────────────
const sM = (ti, i) => { const m = mom(ti, i, 189, 10); return m == null || m <= 0 ? null : squash(m, 0.75, 0.75); };
const SIGS = [
  // MOTORES AUTÓNOMOS (¿sustituyen al momentum?)
  { key: "RSI_TREND", fn: (ti, i) => {                     // fuerza RSI en tendencia
    const r = RSI[ti][i], p = T[ti].adj[i], s2 = S200[ti][i];
    if (r == null || !isNum(p) || s2 == null || p < s2 || r < 50) return null;
    return { score: squash(r, 65, 15), mRaw: r };
  }},
  { key: "MACD_TREND", fn: (ti, i) => {                    // MACD normalizado positivo
    const h = HIST[ti][i], mn = MACDN[ti][i];
    if (h == null || mn == null || h <= 0) return null;
    return { score: squash(mn, 0.05, 0.05), mRaw: mn };
  }},
  { key: "GOLDEN", fn: (ti, i) => {                        // cruce dorado, score por separación
    const p = T[ti].adj[i], a = S50[ti][i], b = S200[ti][i];
    if (!isNum(p) || a == null || b == null || p < b || a < b) return null;
    return { score: squash(a / b - 1, 0.10, 0.10), mRaw: a / b - 1 };
  }},
  { key: "FLUJO_VOL", fn: (ti, i) => {                     // acumulación por volumen con signo
    const f = FLOW[ti][i], m63 = mom(ti, i, 63, 0);
    if (f == null || m63 == null || m63 <= 0) return null;
    return { score: squash(f, 0.15, 0.15), mRaw: f };
  }},
  // TILTS sobre M189s10 (¿lo mejoran como confirmación?)
  { key: "M189+RSI", fn: (ti, i) => {
    const s = sM(ti, i), r = RSI[ti][i];
    if (s == null || r == null) return null;
    return { score: 0.8 * s + 0.2 * squash(r, 60, 15), mRaw: mom(ti, i, 189, 10) };
  }},
  { key: "M189+MACD", fn: (ti, i) => {
    const s = sM(ti, i), mn = MACDN[ti][i];
    if (s == null || mn == null) return null;
    return { score: 0.8 * s + 0.2 * squash(mn, 0.03, 0.05), mRaw: mom(ti, i, 189, 10) };
  }},
  { key: "M189+FLUJO", fn: (ti, i) => {
    const s = sM(ti, i), f = FLOW[ti][i];
    if (s == null || f == null) return null;
    return { score: 0.8 * s + 0.2 * squash(f, 0.10, 0.15), mRaw: mom(ti, i, 189, 10) };
  }},
  { key: "M189+VSURGE", fn: (ti, i) => {                   // confirmación por pico de volumen
    const s = sM(ti, i), v = VSURGE[ti][i];
    if (s == null || v == null) return null;
    return { score: 0.85 * s + 0.15 * squash(v - 1, 0.10, 0.30), mRaw: mom(ti, i, 189, 10) };
  }},
  { key: "M189×GOLDEN", fn: (ti, i) => {                   // momentum FILTRADO por cruce dorado
    const s = sM(ti, i), a = S50[ti][i], b = S200[ti][i];
    if (s == null || a == null || b == null || a < b) return null;
    return { score: s, mRaw: mom(ti, i, 189, 10) };
  }},
  { key: "M189×RSI>50", fn: (ti, i) => {                   // momentum FILTRADO por RSI>50
    const s = sM(ti, i), r = RSI[ti][i];
    if (s == null || r == null || r < 50) return null;
    return { score: s, mRaw: mom(ti, i, 189, 10) };
  }},
];

const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2" };
console.log(`FASE G: ${SIGS.length} señales clásicas × 10 fases (construcción v1.1 fija)`);
const RES = [{ name: "v1.1 (M189s10) ★", ...evaluar({ ...BASE }) }];
for (const s of SIGS) {
  RES.push({ name: s.key, ...evaluar({ ...BASE, signalFn: s.fn, sigKey: "G" + s.key }) });
  process.stdout.write(".");
}
console.log("\n");

const base = RES[0];
RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("señal                           trWorst  trMean ‖ cfMean cfWorst ‖ riesgo");
for (const r of RES) console.log(fila(r.name, r));

console.log("\nGATE (batir v1.1 en trainWorst Y no perder cfMean/cfWorst, 10/10 fases):");
let alguno = false;
for (const r of RES) {
  if (r === base) continue;
  const pasa = r.trainWorst > base.trainWorst && r.confirmMean >= base.confirmMean - 1e-12 && r.confirmWorst >= base.confirmWorst - 1e-12 && r.fasesDistintas === 10;
  if (pasa) { alguno = true; console.log(`  ✅ ${r.name}`); }
}
if (!alguno) console.log("  ninguno pasa — el momentum simple sigue siendo el rey en este universo");

fs.writeFileSync("backtests/lab-day-faseG.json", JSON.stringify({ ranAt: new Date().toISOString(), results: RES }, null, 1));
console.log("\nGuardado: backtests/lab-day-faseG.json");
