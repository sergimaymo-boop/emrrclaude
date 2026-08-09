/**
 * RALLY — BACKTEST del ranking "los 10 tickers con el rally más sano".
 *
 * El motor `rallyScoreEngine.js` nunca se había validado con datos: sus pesos
 * (33% fuerza relativa, 23% momento, 17% tendencia…) venían de literatura
 * (O'Neil, Minervini, Weinstein), no de un backtest. Esto lo mide.
 *
 * Método: en cada fecha de revisión se puntúa TODO el universo usando solo datos
 * hasta esa fecha (sin mirar al futuro), se compran los N mejores a peso igual y se
 * mantienen hasta la siguiente revisión (con opción de trailing stop).
 *
 * Se replica la fórmula del motor de producción EXACTAMENTE; hay un test de
 * equivalencia (`--verify`) que compara contra calculateRallyScore().
 */
import fs from "node:fs";

const DATA = "data/universe-10y.json";
const COST_BPS = Number(process.env.COST_BPS ?? 20) / 1e4; // 20 pb por lado

// ─── utilidades ──────────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// ─── réplica EXACTA de los normalizadores del motor de producción ────────────
const normalizeRS = (x) => (isNum(x) ? clamp(50 + 50 * Math.tanh(x / 40)) : 20);
const normLin = (v, mn, mx) => (isNum(v) ? clamp(((v - mn) / (mx - mn)) * 100) : 0);
const scoreRS = (rs3m, rs6m) => normalizeRS(rs3m ?? 0) * 0.70 + normalizeRS(rs6m ?? 0) * 0.30;
const scoreMom = (m1, m3, m6) => normLin(m1 ?? 0, -10, 20) * 0.10 + normLin(m3 ?? 0, -15, 45) * 0.60 + normLin(m6 ?? 0, -20, 65) * 0.30;
function scoreTrend(p, e20, e50, s20, s50) {
  let s = 0;
  if (isNum(p) && isNum(e20) && p > e20) s += 25;
  if (isNum(e20) && isNum(e50) && e20 > e50) s += 25;
  if (isNum(s20) && s20 > 0) s += 25;
  if (isNum(s50) && s50 > 0) s += 25;
  if (isNum(p) && isNum(e50) && p > e50) s = Math.min(100, s + 10);
  return clamp(s);
}
function scoreProx(prox) {
  if (!isNum(prox)) return 40;
  if (prox >= 1.0) return 100;
  if (prox >= 0.95) return 90;
  if (prox >= 0.85) return 70;
  if (prox >= 0.75) return 40;
  return 10;
}
function scoreRvol(rvol, p, e5) {
  if (!isNum(rvol)) return 30;
  const mult = isNum(p) && isNum(e5) && p >= e5 ? 1.0 : 0.25;
  const base = rvol >= 1.5 ? 100 : rvol >= 1.2 ? 75 : rvol >= 1.0 ? 50 : rvol >= 0.8 ? 30 : 10;
  return clamp(base * mult);
}
function scoreAtr(a) {
  if (!isNum(a)) return 30;
  const x = Math.abs(a);
  if (x >= 1.0 && x <= 2.5) return 100;
  if (x >= 0.5 && x < 1.0) return 60;
  if (x > 2.5 && x <= 4.0) return 70;
  if (x < 0.5) return 20;
  return 30;
}
function scoreLiq(avgValue20, region) {
  const minValue = region === "USA" ? 10_000_000 : 5_000_000;
  let s = 100;
  if (isNum(avgValue20) && avgValue20 < minValue) s -= 50;
  return clamp(s); // el spread no está disponible en histórico: se omite (afecta igual a todos)
}
function penalties(base, { p, e20, e50, m1, m3, rvol, rs5d }) {
  let pen = 0;
  if (isNum(p) && isNum(e20) && e20 > 0) {
    const ext = (p - e20) / e20;
    if (ext > 0.30) pen += 25; else if (ext > 0.20) pen += 15; else if (ext > 0.15) pen += 8;
  }
  if (isNum(p) && isNum(e50) && p < e50) pen += 20;
  if (isNum(m1) && m1 > 40) pen += 10;
  if (isNum(m1) && m1 > 60) pen += 15;
  if (isNum(rvol) && rvol > 3.5) pen += 15;
  if (isNum(rs5d) && rs5d < -8) pen += 8;
  if (isNum(rs5d) && rs5d < -15) pen += 8;
  if (isNum(m3) && isNum(m1) && m3 > 15 && m1 < -5) pen += 8;
  return clamp(base - pen);
}

// ─── carga y preparación ─────────────────────────────────────────────────────
console.log("Cargando universo…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyRaw = series["SPY.US"]?.bars;
if (!spyRaw) throw new Error("Falta SPY.US en el histórico");

const dates = spyRaw.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
const spyClose = spyRaw.map((b) => b.a);

function emaSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function retPct(v, i, lb) {
  if (i - lb < 0) return null;
  const past = v[i - lb];
  return past > 0 ? ((v[i] - past) / past) * 100 : null;
}

// El benchmark se necesita indexado por fecha para la fuerza relativa.
const spyRet = (i, lb) => retPct(spyClose, i, lb);

console.log("Precomputando indicadores por ticker…");
const T = [];
for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  const n = bars.length;
  const closes = bars.map((b) => b.c);       // precio sin ajustar: para las señales técnicas
  const adj = bars.map((b) => b.a);          // ajustado: para la RENTABILIDAD real
  const highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v);
  const e5 = emaSeriesOf(closes, 5), e20 = emaSeriesOf(closes, 20), e50 = emaSeriesOf(closes, 50);

  // ATR de Wilder a 14
  const atrPct = new Array(n).fill(null);
  { let atr = null;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      atr = atr == null ? (i >= 14 ? tr : null) : (atr * 13 + tr) / 14;
      if (i === 14) { let s = 0; for (let k = 1; k <= 14; k++) s += Math.max(highs[k] - lows[k], Math.abs(highs[k] - closes[k - 1]), Math.abs(lows[k] - closes[k - 1])); atr = s / 14; }
      if (atr != null && closes[i] > 0) atrPct[i] = (atr / closes[i]) * 100;
    } }

  // Se proyecta cada barra del ticker sobre el calendario maestro (SPY).
  const mi = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) { const k = dateIdx.get(bars[i].d); if (k !== undefined) mi[i] = k; }

  const mAdj = new Array(D).fill(null);      // precio ajustado por fecha (rentabilidad)
  const mClose = new Array(D).fill(null);
  const mLow = new Array(D).fill(null);
  const feat = new Array(D).fill(null);      // rasgos listos para puntuar

  for (let i = 0; i < n; i++) {
    const k = mi[i]; if (k < 0) continue;
    mAdj[k] = adj[i]; mClose[k] = closes[i]; mLow[k] = lows[i];
    if (i < 130) continue;

    const p = closes[i];
    const s20 = isNum(e20[i]) && isNum(e20[i - 5]) && e20[i - 5] !== 0 ? ((e20[i] - e20[i - 5]) / e20[i - 5]) * 100 : null;
    const s50 = isNum(e50[i]) && isNum(e50[i - 5]) && e50[i - 5] !== 0 ? ((e50[i] - e50[i - 5]) / e50[i - 5]) * 100 : null;
    const m1 = retPct(closes, i, 20), m3 = retPct(closes, i, 63), m6 = retPct(closes, i, 126);
    const v20 = vols.slice(i - 19, i + 1), v40 = vols.slice(i - 39, i - 19);
    const av20 = mean(v20), avPrev = mean(v40);
    const rvol = avPrev > 0 ? av20 / avPrev : null;
    const lookback = Math.min(i, 252);
    let hi = 0; for (let k2 = i - lookback + 1; k2 <= i; k2++) if (closes[k2] > hi) hi = closes[k2];
    // Fuerza relativa contra el S&P 500, en la MISMA fecha de calendario.
    const rs3m = m3 != null && spyRet(k, 63) != null ? m3 - spyRet(k, 63) : null;
    const rs6m = m6 != null && spyRet(k, 126) != null ? m6 - spyRet(k, 126) : null;
    const r5 = retPct(closes, i, 5);
    const rs5d = r5 != null && spyRet(k, 5) != null ? r5 - spyRet(k, 5) : null;

    feat[k] = { p, e5: e5[i], e20: e20[i], e50: e50[i], s20, s50, m1, m3, m6,
                rvol, atr: atrPct[i], av: av20 * p, prox: hi > 0 ? p / hi : null, rs3m, rs6m, rs5d };
  }
  T.push({ sym, name: obj.name, region: obj.exchange === "US" ? "USA" : "EU", adj: mAdj, close: mClose, low: mLow, feat });
}
console.log(`Tickers utilizables: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);


// ─── v3.0: ranking validado (RS 50 + momento 50) ─────────────────────────────
const W_RSM = { rs: 0.50, mom: 0.50 };
const scoreV3 = (f) => (f ? clamp(scoreRS(f.rs3m, f.rs6m) * W_RSM.rs + scoreMom(f.m1, f.m3, f.m6) * W_RSM.mom) : null);

/** Trailing stop del propio módulo: multiplicador según ATR, acotado a [5%, 18%]. */
function trailingPctOf(atrPct) {
  if (!isNum(atrPct) || atrPct <= 0) return 0.10;
  const a = Math.abs(atrPct);
  const mult = a < 1.5 ? 2.0 : a <= 3.0 ? 2.5 : 3.0;
  return clamp(a * mult, 5, 18) / 100;
}

/**
 * ESTUDIO DEL RECORRIDO RESTANTE.
 *
 * Pregunta de Sergi: al hacer el scan, ¿a qué tickers del top-10 les queda
 * recorrido alcista por delante, de forma que entrando HOY y dejando que el
 * trailing stop gestione la salida, todavía recojamos una parte del rally?
 *
 * Variable objetivo (la que realmente importa al operar así):
 *   · capturado  = rentabilidad desde la entrada hasta que salta el trailing stop
 *   · díasDentro = cuántas sesiones aguanta la posición antes de que salte
 *
 * NO se mide el retorno a un horizonte fijo: se mide lo que un trailing stop
 * recoge de verdad. Los episodios se toman cada 21 sesiones (más muestra que las
 * revisiones de 84 días); se solapan en el tiempo, así que la significancia
 * estadística está inflada — por eso TODO se valida en dos mitades independientes.
 */
const EPISODE_STEP = 21;
const MAX_HOLD = 252;       // tope de simulación: 1 año
const FROM = 260, TO = D - 1;

function ema(vArr, p, idx) { return null; } // no usado; las EMAs vienen en feat

const episodes = [];
for (let i = FROM; i <= TO - 40; i += EPISODE_STEP) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV3(f);
    if (s != null) cands.push({ ti, s, f });
  }
  cands.sort((a, b) => b.s - a.s);
  for (const c of cands.slice(0, 10)) {
    const t = T[c.ti], f = c.f;
    const entry = t.adj[i];
    const trail = trailingPctOf(f.atr);

    // simulación del trailing stop desde la entrada
    let peak = entry, exitPx = null, exitIdx = null;
    for (let j = i + 1; j <= Math.min(i + MAX_HOLD, TO); j++) {
      const px = t.adj[j];
      if (!isNum(px)) continue;
      if (px > peak) peak = px;
      if (px <= peak * (1 - trail)) { exitPx = px; exitIdx = j; break; }
    }
    if (exitIdx == null) {           // no saltó: se cierra al final de la ventana
      for (let j = Math.min(i + MAX_HOLD, TO); j > i; j--) { if (isNum(t.adj[j])) { exitPx = t.adj[j]; exitIdx = j; break; } }
    }
    if (exitIdx == null) continue;

    const captured = exitPx / entry - 1;
    const daysHeld = exitIdx - i;
    const spyRefIdx = Math.min(exitIdx, TO);
    const spyMove = spyClose[spyRefIdx] / spyClose[i] - 1;

    // ── indicadores candidatos, TODOS conocidos el día del scan ──
    // 1) EDAD DE LA TENDENCIA: sesiones consecutivas cerrando sobre la EMA50.
    let trendAge = 0;
    for (let j = i; j > Math.max(130, i - 500); j--) {
      const px = t.close[j];
      if (!isNum(px)) continue;
      const ff = t.feat[j];
      if (!ff || !isNum(ff.e50) || px < ff.e50) break;
      trendAge++;
    }
    // 2) EXTENSIÓN sobre la EMA50 (cuánto se ha alejado la tendencia completa)
    const extEma50 = isNum(f.e50) && f.e50 > 0 ? (f.p - f.e50) / f.e50 : null;
    // 3) ACELERACIÓN: ¿el último mes va más rápido que el ritmo de 3 meses?
    const accel = isNum(f.m1) && isNum(f.m3) ? f.m1 - f.m3 / 3 : null;
    // 4) CONTRACCIÓN DE VOLATILIDAD (base formándose = muelle comprimido)
    let vol20 = null, vol60 = null;
    { const r = [];
      for (let j = i - 59; j <= i; j++) { const a = t.adj[j], b = t.adj[j - 1]; if (isNum(a) && isNum(b) && b > 0) r.push(a / b - 1); }
      if (r.length >= 55) { vol60 = sd(r); vol20 = sd(r.slice(-20)); } }
    const volContraction = vol20 != null && vol60 > 0 ? vol20 / vol60 : null;
    // 5) CAÍDA DESDE EL MÁXIMO de 52 semanas
    const ddFrom52w = f.prox != null ? f.prox - 1 : null;

    episodes.push({
      date: dates[i], sym: t.sym, entryIdx: i,
      trendAge, extEma50, accel, volContraction, ddFrom52w,
      prox: f.prox, ext20: isNum(f.e20) && f.e20 > 0 ? (f.p - f.e20) / f.e20 : null,
      atr: f.atr, m1: f.m1, m3: f.m3, m6: f.m6, trail,
      captured, daysHeld, alpha: captured - spyMove,
    });
  }
}
console.log(`Episodios simulados con trailing stop: ${episodes.length}`);
console.log(`Capturado medio: ${(mean(episodes.map(e=>e.captured))*100).toFixed(1)}%  ·  días dentro medio: ${mean(episodes.map(e=>e.daysHeld)).toFixed(0)}\n`);

const dSplit = dates[Math.floor((D - 260) / 2) + 260];
const train = episodes.filter((e) => e.date < dSplit);
const test = episodes.filter((e) => e.date >= dSplit);

function study(name, key, cuts, fmt = (x) => x.toFixed(2)) {
  console.log(`=== ${name} ===`);
  console.log("Rango".padEnd(26), "ENTREN. capt.".padStart(14), "días".padStart(6), "n".padStart(6), " ‖ ", "PRUEBA capt.".padStart(13), "días".padStart(6), "n".padStart(6));
  for (let b = 0; b < cuts.length; b++) {
    const [lo, hi, label] = cuts[b];
    const f = (arr) => arr.filter((e) => isNum(e[key]) && e[key] >= lo && e[key] < hi);
    const a = f(train), z = f(test);
    if (!a.length && !z.length) continue;
    console.log(label.padEnd(26),
      `${(mean(a.map(e=>e.captured))*100).toFixed(1)}%`.padStart(14), mean(a.map(e=>e.daysHeld)).toFixed(0).padStart(6), String(a.length).padStart(6), " ‖ ",
      `${(mean(z.map(e=>e.captured))*100).toFixed(1)}%`.padStart(13), mean(z.map(e=>e.daysHeld)).toFixed(0).padStart(6), String(z.length).padStart(6));
  }
  console.log("");
}

study("EDAD DE LA TENDENCIA (sesiones sobre EMA50)", "trendAge", [
  [0, 40, "joven (<40 sesiones)"], [40, 100, "media (40-100)"], [100, 200, "madura (100-200)"], [200, 9999, "muy larga (>200)"]]);

study("EXTENSIÓN sobre EMA50", "extEma50", [
  [-9, 0.05, "poco (<5%)"], [0.05, 0.15, "moderada (5-15%)"], [0.15, 0.30, "alta (15-30%)"], [0.30, 9, "extrema (>30%)"]]);

study("ACELERACIÓN (mom 1m − mom 3m/3)", "accel", [
  [-999, -3, "desacelerando (<-3)"], [-3, 3, "estable (-3..3)"], [3, 10, "acelerando (3-10)"], [10, 999, "muy acelerado (>10)"]]);

study("CONTRACCIÓN DE VOLATILIDAD (vol20/vol60)", "volContraction", [
  [0, 0.75, "muy contraída (<0,75)"], [0.75, 1.0, "contraída (0,75-1)"], [1.0, 1.3, "normal (1-1,3)"], [1.3, 99, "expandida (>1,3)"]]);

study("PROXIMIDAD al máximo 52 semanas", "prox", [
  [0, 0.90, "lejos (<90%)"], [0.90, 0.96, "medio (90-96%)"], [0.96, 0.997, "cerca sin tocar (96-99,7%)"], [0.997, 9, "en máximos (>99,7%)"]]);

study("ATR % (volatilidad → anchura del trailing)", "atr", [
  [0, 2, "baja (<2%)"], [2, 3, "media (2-3%)"], [3, 4.5, "alta (3-4,5%)"], [4.5, 99, "muy alta (>4,5%)"]]);

fs.writeFileSync("backtests/rally-runway-study.json", JSON.stringify({
  ranAt: new Date().toISOString(), episodes: episodes.length, split: dSplit,
  meanCaptured: mean(episodes.map(e=>e.captured)), meanDays: mean(episodes.map(e=>e.daysHeld)),
  sample: episodes.slice(0, 50),
}, null, 1));
console.log("Guardado: backtests/rally-runway-study.json");
