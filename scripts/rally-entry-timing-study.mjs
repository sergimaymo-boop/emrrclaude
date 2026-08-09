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


// ─── puntuación v3.0 (RS+momento, sin penalizar) ─────────────────────────────
const W_RSM = { rs: 0.50, mom: 0.50, trend: 0, prox: 0, rvol: 0, atr: 0, liq: 0 };
function scoreOf(f, region) {
  if (!f) return null;
  const sRS = scoreRS(f.rs3m, f.rs6m);
  const sMom = scoreMom(f.m1, f.m3, f.m6);
  return clamp(sRS * W_RSM.rs + sMom * W_RSM.mom);
}

/**
 * ESTUDIO: dado que un ticker YA está en el top-10 del ranking (eso decide QUÉ
 * comprar), ¿el estado del propio ticker en el día de la revisión predice si es
 * buen MOMENTO de entrar, o si conviene esperar unos días a un retroceso?
 *
 * Variables de estado candidatas (todas conocidas el día de la revisión, sin mirar
 * al futuro): extensión sobre EMA20, deterioro de fuerza relativa 5 días, volumen
 * relativo, volatilidad ATR, proximidad al máximo de 52 semanas.
 *
 * Para cada variable: se divide en terciles y se mide el retorno FORWARD hasta la
 * siguiente revisión (~84 sesiones) y la caída máxima intra-periodo desde la entrada.
 * Si un tercil predice sistemáticamente mejor rentabilidad / menor caída, esa
 * variable sirve para un "score de entrada". Si no hay diferencia, se descarta.
 */
const REVIEW = 84;
const FROM = 260, TO = D - 1;

const episodes = []; // cada vez que un ticker aparece en el top-10 en una revisión
for (let i = FROM; i <= TO - REVIEW; i += REVIEW) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreOf(f, t.region);
    if (s != null) cands.push({ ti, s, f });
  }
  cands.sort((a, b) => b.s - a.s);
  const top = cands.slice(0, 10);
  for (const c of top) {
    const t = T[c.ti];
    const entryPx = t.adj[i];
    // siguiente fecha con precio válido, buscando hasta REVIEW sesiones adelante
    let exitIdx = null;
    for (let j = Math.min(i + REVIEW, TO); j > i; j--) { if (isNum(t.adj[j])) { exitIdx = j; break; } }
    if (exitIdx == null) continue;
    const exitPx = t.adj[exitIdx];
    const fwdRet = exitPx / entryPx - 1;
    const spyFwd = spyClose[exitIdx] / spyClose[i] - 1;
    // caída máxima intra-periodo desde el precio de entrada
    let minPx = entryPx;
    for (let j = i + 1; j <= exitIdx; j++) if (isNum(t.adj[j])) minPx = Math.min(minPx, t.adj[j]);
    const intraDD = minPx / entryPx - 1;

    const ext20 = isNum(c.f.e20) && c.f.e20 > 0 ? (c.f.p - c.f.e20) / c.f.e20 : null;
    episodes.push({
      date: dates[i], sym: t.sym, entryIdx: i,
      ext20, rs5d: c.f.rs5d, rvol: c.f.rvol, atr: c.f.atr, prox: c.f.prox, mom1m: c.f.m1,
      fwdRet, alpha: fwdRet - spyFwd, intraDD,
    });
  }
}
console.log(`Episodios (aparición en top-10 en una revisión): ${episodes.length}\n`);

function bucketStudy(name, getVal, buckets) {
  const withVal = episodes.filter((e) => isNum(getVal(e)));
  const sorted = [...withVal].sort((a, b) => getVal(a) - getVal(b));
  const n = sorted.length;
  console.log(`=== ${name} (n=${n}) ===`);
  console.log("Tercil".padEnd(28), "rango".padEnd(20), "alpha medio".padStart(12), "caída media".padStart(12), "% positivos".padStart(12));
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b * n) / buckets), z = Math.floor(((b + 1) * n) / buckets);
    const slice = sorted.slice(a, z);
    if (!slice.length) continue;
    const alpha = mean(slice.map((e) => e.alpha));
    const dd = mean(slice.map((e) => e.intraDD));
    const posPct = slice.filter((e) => e.alpha > 0).length / slice.length;
    const vals = slice.map(getVal);
    const label = buckets === 3 ? ["bajo", "medio", "alto"][b] : `q${b + 1}`;
    console.log(label.padEnd(28), `${vals[0].toFixed(1)}..${vals.at(-1).toFixed(1)}`.padEnd(20),
      `${(alpha * 100).toFixed(1)}%`.padStart(12), `${(dd * 100).toFixed(1)}%`.padStart(12), `${(posPct * 100).toFixed(0)}%`.padStart(12));
  }
  console.log("");
}

bucketStudy("EXTENSIÓN sobre EMA20 (%, x100 abajo)", (e) => (e.ext20 != null ? e.ext20 * 100 : null), 3);
bucketStudy("FUERZA RELATIVA 5 días (deterioro reciente)", (e) => e.rs5d, 3);
bucketStudy("VOLUMEN RELATIVO", (e) => e.rvol, 3);
bucketStudy("ATR % (volatilidad)", (e) => e.atr, 3);
bucketStudy("PROXIMIDAD al máximo 52 semanas", (e) => (e.prox != null ? e.prox * 100 : null), 3);
bucketStudy("MOMENTO 1 mes (persecución de subida reciente)", (e) => e.mom1m, 3);

// ─── partición temporal: ¿el patrón se sostiene fuera de muestra? ────────────
const half = episodes.filter((e) => true);
const dSplit = dates[Math.floor((D - 260) / 2) + 260];
const train = episodes.filter((e) => e.date < dSplit);
const test = episodes.filter((e) => e.date >= dSplit);
console.log(`Partición: entrenamiento ${train.length} episodios (< ${dSplit}) · prueba ${test.length} episodios (>= ${dSplit})\n`);

function extBucketReturn(subset, lo, hi) {
  const s = subset.filter((e) => e.ext20 != null && e.ext20 * 100 >= lo && e.ext20 * 100 < hi);
  return { n: s.length, alpha: mean(s.map((e) => e.alpha)), dd: mean(s.map((e) => e.intraDD)) };
}
console.log("=== ¿La extensión sobre EMA20 predice en AMBAS mitades? ===");
for (const [lo, hi, label] of [[-100, 5, "poco/nada extendido (<5%)"], [5, 15, "moderado (5-15%)"], [15, 100, "muy extendido (>15%)"]]) {
  const tr = extBucketReturn(train, lo, hi), te = extBucketReturn(test, lo, hi);
  console.log(`  ${label.padEnd(28)} entren: alpha ${(tr.alpha * 100).toFixed(1)}% dd ${(tr.dd * 100).toFixed(1)}% (n=${tr.n})   ‖   prueba: alpha ${(te.alpha * 100).toFixed(1)}% dd ${(te.dd * 100).toFixed(1)}% (n=${te.n})`);
}

fs.writeFileSync("backtests/rally-entry-timing-study.json", JSON.stringify({
  ranAt: new Date().toISOString(), episodesTotal: episodes.length, split: dSplit,
  episodes: episodes.map((e) => ({ ...e })),
}, null, 0));
console.log("\nGuardado: backtests/rally-entry-timing-study.json");

function proxBucketReturn(subset, lo, hi) {
  const s = subset.filter((e) => e.prox != null && e.prox * 100 >= lo && e.prox * 100 < hi);
  return { n: s.length, alpha: mean(s.map((e) => e.alpha)), dd: mean(s.map((e) => e.intraDD)), posPct: s.length ? s.filter(e=>e.alpha>0).length/s.length : 0 };
}
console.log("\n=== ¿La proximidad al máximo de 52 semanas predice en AMBAS mitades? ===");
for (const [lo, hi, label] of [[0, 96, "lejos del máximo (<96%)"], [96, 99.7, "cerca sin tocarlo (96-99,7%)"], [99.7, 101, "en el máximo o rompiendo (>99,7%)"]]) {
  const tr = proxBucketReturn(train, lo, hi), te = proxBucketReturn(test, lo, hi);
  console.log(`  ${label.padEnd(30)} entren: alpha ${(tr.alpha*100).toFixed(1)}% dd ${(tr.dd*100).toFixed(1)}% pos${(tr.posPct*100).toFixed(0)}% (n=${tr.n})   ‖   prueba: alpha ${(te.alpha*100).toFixed(1)}% dd ${(te.dd*100).toFixed(1)}% pos${(te.posPct*100).toFixed(0)}% (n=${te.n})`);
}

function momBucketReturn(subset, lo, hi) {
  const s = subset.filter((e) => e.mom1m != null && e.mom1m >= lo && e.mom1m < hi);
  return { n: s.length, alpha: mean(s.map((e) => e.alpha)), dd: mean(s.map((e) => e.intraDD)), posPct: s.length ? s.filter(e=>e.alpha>0).length/s.length : 0 };
}
console.log("\n=== ¿El momento a 1 mes predice en AMBAS mitades? ===");
for (const [lo, hi, label] of [[-100, 7, "sin acelerar (<7%)"], [7, 15, "moderado (7-15%)"], [15, 999, "acelerado (>15%)"]]) {
  const tr = momBucketReturn(train, lo, hi), te = momBucketReturn(test, lo, hi);
  console.log(`  ${label.padEnd(30)} entren: alpha ${(tr.alpha*100).toFixed(1)}% dd ${(tr.dd*100).toFixed(1)}% pos${(tr.posPct*100).toFixed(0)}% (n=${tr.n})   ‖   prueba: alpha ${(te.alpha*100).toFixed(1)}% dd ${(te.dd*100).toFixed(1)}% pos${(te.posPct*100).toFixed(0)}% (n=${te.n})`);
}
