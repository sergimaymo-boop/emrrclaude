#!/usr/bin/env node
/**
 * BACKTEST — FEAR & GREED (módulo informativo, nunca backtesteado hasta el 25-sep-2026)
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Qué se valida: lo que ENSEÑA el panel `src/components/FearGreedPanel.tsx`, que pinta lo
 * que devuelve `api/_lib/fearGreedHandler.js`:
 *   · Fuente PRIMARIA: índice CNN Business (score 0-100 + rating CNN).
 *   · Fuente de RESPALDO (solo si CNN cae): composite interno de 7 indicadores
 *     (VIX 25% · SPY 15% · HYG 15% · MOVE 15% · VVIX 10% · LQD 10% · TNX 10%).
 *   · Etiquetas: Miedo Extremo ≤25 · Miedo ≤45 · Neutral ≤55 · Codicia ≤75 · Codicia Extrema.
 *   · Colores: rojo (miedo extremo) → naranja → gris → verde suave → verde fuerte (codicia extrema).
 *
 * Pregunta: ¿tiene valor PREDICTIVO lo que se muestra? Para cada rating (y decil de score)
 * se miden los retornos FUTUROS del SPY (5/20/60 sesiones: media, mediana, % positivos) y el
 * riesgo de caída (P(caída >5% en las 20 sesiones siguientes)), con estabilidad por
 * subperiodos, robustez con 1 día de retraso, leave-one-episode-out y t de Newey-West.
 *
 * Fidelidad: las funciones de puntuación NO se re-teclean — se EXTRAEN del propio
 * fearGreedHandler.js en tiempo de ejecución (no están exportadas) y se contrastan contra una
 * réplica escrita a mano sobre una malla densa de entradas; si difieren en un solo punto, aborta.
 *
 * Sin lookahead: la señal del día t usa SOLO cierres ≤ t (niveles VIX/MOVE/VVIX al cierre de t,
 * % del día de SPY/HYG/LQD/TNX = cierre t / cierre sesión previa). El retorno futuro se mide
 * desde el cierre de t (y, como control, desde el cierre de t+1).
 *
 * Datos: Yahoo Finance diario (period1=0, cierres brutos para el % del día como hace producción;
 * cierres AJUSTADOS del SPY para los retornos futuros) + histórico CNN
 * (production.dataviz.cnn.io/index/fearandgreed/graphdata/<inicio>). Caché en disco para que la
 * re-ejecución sea determinista (`--offline`).
 *
 * Uso:
 *   node scripts/backtest-fear-greed.mjs [--end 2026-09-24] [--cache DIR] [--offline] [--refresh]
 *                                        [--out backtests/fear-greed-2026-09-25.json]
 *
 * Este fichero EXPORTA sus utilidades (carga de datos, estadística) para
 * scripts/backtest-monetary-cycle.mjs; el estudio SOLO se ejecuta si se lanza directamente
 * (guarda de main — lección de lab-excovid.mjs: nada de estudios como efecto de importación).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ─── CLI ──────────────────────────────────────────────────────────────────────
export function parseArgs(argv, defaults) {
  const o = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") o.offline = true;
    else if (a === "--refresh") o.refresh = true;
    else if (a === "--end") o.end = argv[++i];
    else if (a === "--cache") o.cache = argv[++i];
    else if (a === "--out") o.out = argv[++i];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.end)) throw new Error(`--end inválido: ${o.end}`);
  fs.mkdirSync(o.cache, { recursive: true });
  return o;
}

export function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

// ─── Datos: Yahoo diario ──────────────────────────────────────────────────────
const nyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const nyDate = (ts) => nyFmt.format(new Date(ts * 1000));

/**
 * Serie diaria de Yahoo. Conserva los HUECOS (close=null) como marcadores: producción no
 * calcula variación si la sesión previa viene vacía, y aquí tampoco.
 * @returns {{symbol, bars:[{date, close|null, adj|null}], fetchedAt, url, sha256}}
 */
export async function loadYahoo(sym, opts) {
  const file = path.join(opts.cache, `yahoo_${sym.replace(/[^A-Za-z0-9]/g, "_")}.json`);
  let wrap = null;
  if (!opts.refresh && fs.existsSync(file)) wrap = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!wrap) {
    if (opts.offline) throw new Error(`--offline y sin caché para ${sym} (${file})`);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplit`;
    let r = null;
    for (let attempt = 0; attempt < 4; attempt++) {           // Yahoo devuelve 429 transitorios
      if (attempt) await new Promise((ok) => setTimeout(ok, 3000 * attempt));
      r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (r.ok || (r.status !== 429 && r.status < 500)) break;
      await r.arrayBuffer().catch(() => null);
    }
    if (!r.ok) throw new Error(`Yahoo ${sym} HTTP ${r.status}`);
    const payload = await r.json();
    wrap = { fetchedAt: new Date().toISOString(), url, payload };
    fs.writeFileSync(file, JSON.stringify(wrap));
  }
  const res = wrap.payload?.chart?.result?.[0];
  if (!res?.timestamp) throw new Error(`Yahoo ${sym}: respuesta sin serie`);
  if (res.meta?.dataGranularity && res.meta.dataGranularity !== "1d") throw new Error(`Yahoo ${sym}: granularidad ${res.meta.dataGranularity} (se esperaba 1d)`);
  const q = res.indicators.quote[0];
  const adj = res.indicators.adjclose?.[0]?.adjclose ?? [];
  const byDate = new Map();
  res.timestamp.forEach((ts, i) => {
    const date = nyDate(ts);
    if (date > opts.end) return;                       // fuera de la ventana (incluye la vela EN CURSO)
    const c = Number.isFinite(q.close[i]) && q.close[i] > 0 ? q.close[i] : null;
    const a = Number.isFinite(adj[i]) && adj[i] > 0 ? adj[i] : null;
    byDate.set(date, { date, close: c, adj: a });       // si hubiera fecha duplicada, gana la última
  });
  const bars = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  return { symbol: sym, bars, fetchedAt: wrap.fetchedAt, url: wrap.url, sha256: sha256(JSON.stringify(bars)) };
}

/** Informe de calidad de una serie (informativo, no aborta salvo serie vacía). */
export function seriesQuality(s) {
  const valid = s.bars.filter((b) => b.close !== null);
  if (!valid.length) throw new Error(`${s.symbol}: serie vacía`);
  let maxJump = { pct: 0, date: null };
  for (let i = 1; i < s.bars.length; i++) {
    const a = s.bars[i - 1].close, b = s.bars[i].close;
    if (a && b) { const p = (b / a - 1) * 100; if (Math.abs(p) > Math.abs(maxJump.pct)) maxJump = { pct: +p.toFixed(2), date: s.bars[i].date }; }
  }
  return {
    symbol: s.symbol, first: valid[0].date, last: valid.at(-1).date, bars: s.bars.length,
    nullCloses: s.bars.length - valid.length, maxDailyJumpPct: maxJump, fetchedAt: s.fetchedAt, sha256: s.sha256,
  };
}

// ─── As-of sobre el calendario del SPY ────────────────────────────────────────
const DAY_MS = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Índice de la última barra con fecha ≤ date (búsqueda binaria), o -1. */
function lastIdxLE(bars, date) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/** Nivel al cierre de `date` (último cierre válido ≤ date, con antigüedad ≤ maxStale días naturales). */
export function asOfLevel(s, date, maxStale = 5) {
  let i = lastIdxLE(s.bars, date);
  while (i >= 0 && s.bars[i].close === null) i--;
  if (i < 0 || daysBetween(s.bars[i].date, date) > maxStale) return null;
  return s.bars[i].close;
}

/**
 * % del día al cierre de `date`, como el quote de producción: última sesión ≤ date contra la
 * sesión INMEDIATAMENTE anterior; si cualquiera de las dos viene vacía → null (hueco).
 */
export function asOfChange(s, date, maxStale = 5) {
  const i = lastIdxLE(s.bars, date);
  if (i < 1) return null;
  const c = s.bars[i].close, p = s.bars[i - 1].close;
  if (c === null || p === null || daysBetween(s.bars[i].date, date) > maxStale) return null;
  return (c / p - 1) * 100;
}

// ─── Calendario maestro + retornos futuros del SPY ────────────────────────────
/**
 * @param spy serie Yahoo del SPY (se usan cierres AJUSTADOS → retorno total)
 * @returns {dates, adj, fwd:{h:[]}, dd20:[], vol20:[], fwdL1:{h:[]}, dd20L1:[]}
 */
export function forwardPanel(spy, horizons = [5, 20, 60], ddWin = 20) {
  const bars = spy.bars.filter((b) => b.adj !== null);
  const dates = bars.map((b) => b.date), adj = bars.map((b) => b.adj), n = bars.length;
  const fwd = {}, fwdL1 = {};
  for (const h of horizons) {
    fwd[h] = adj.map((v, i) => (i + h < n ? adj[i + h] / v - 1 : null));
    fwdL1[h] = adj.map((v, i) => (i + 1 + h < n ? adj[i + 1 + h] / adj[i + 1] - 1 : null));
  }
  const ddFrom = (base) => adj.map((_, i) => {
    const s = i + base; if (s + ddWin >= n) return null;
    let m = Infinity; for (let k = s + 1; k <= s + ddWin; k++) m = Math.min(m, adj[k]);
    return m / adj[s] - 1;
  });
  const vol20 = adj.map((_, i) => {
    if (i + ddWin >= n) return null;
    const r = []; for (let k = i + 1; k <= i + ddWin; k++) r.push(Math.log(adj[k] / adj[k - 1]));
    const mu = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
  });
  return { dates, adj, n, horizons, fwd, fwdL1, dd20: ddFrom(0), dd20L1: ddFrom(1), vol20 };
}

// ─── Estadística ──────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const r2 = (x, k = 2) => (x === null || !Number.isFinite(x) ? null : +x.toFixed(k));
export const pct = (x, k = 2) => (x === null ? null : r2(x * 100, k));

/** Rangos promedio (empates → media de rangos). */
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function pearson(x, y) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); }
export function spearman(x, y) { return x.length > 2 ? pearson(ranks(x), ranks(y)) : null; }
export { pearson };

/**
 * Diferencia de medias (grupo − resto) vía MCO con dummy y error estándar HAC Newey-West
 * (Bartlett, L retardos). Los retornos a h sesiones SE SOLAPAN: la t "ingenua" estaría
 * inflada ~√h. Aun así la NW con pocos episodios es optimista → indicativa, no un test
 * (lección §10c: los gates se deciden por magnitud y consistencia, no por la t).
 */
export function nwDiff(y, d, L) {
  const n = y.length; let n1 = 0, s0 = 0, s1 = 0;
  for (let t = 0; t < n; t++) { if (d[t]) { n1++; s1 += y[t]; } else s0 += y[t]; }
  const n0 = n - n1; if (n1 < 5 || n0 < 5) return null;
  const a = s0 / n0, b = s1 / n1 - a;
  const e = y.map((v, t) => v - a - (d[t] ? b : 0));
  const det = n * n1 - n1 * n1;
  const inv = [[n1 / det, -n1 / det], [-n1 / det, n / det]];
  const gam = (l) => { let m00 = 0, m01 = 0, m10 = 0, m11 = 0; for (let t = l; t < n; t++) { const xt = d[t] ? 1 : 0, xs = d[t - l] ? 1 : 0, p = e[t] * e[t - l]; m00 += p; m01 += p * xs; m10 += xt * p; m11 += xt * xs * p; } return [[m00, m01], [m10, m11]]; };
  const G0 = gam(0); const S = [[G0[0][0], G0[0][1]], [G0[1][0], G0[1][1]]];
  for (let l = 1; l <= L; l++) { const w = 1 - l / (L + 1), G = gam(l); S[0][0] += 2 * w * G[0][0]; S[0][1] += w * (G[0][1] + G[1][0]); S[1][0] += w * (G[1][0] + G[0][1]); S[1][1] += 2 * w * G[1][1]; }
  const mul = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
  const V = mul(mul(inv, S), inv);
  const se = Math.sqrt(Math.max(V[1][1], 0));
  return { diff: b, se, t: se > 0 ? b / se : null };
}

/** Episodios: días del grupo separados por más de `gap` sesiones abren un episodio nuevo. */
export function episodes(idxs, gap = 20) {
  const eps = []; let cur = null;
  for (const i of idxs) { if (cur && i - cur.last <= gap) { cur.last = i; cur.members.push(i); } else { cur = { first: i, last: i, members: [i] }; eps.push(cur); } }
  return eps;
}

/**
 * Estadística de un grupo de días (índices del calendario maestro) sobre el panel futuro.
 * @param lag1 si true, retornos medidos desde el cierre de t+1 (control de ejecución).
 */
export function groupStats(panel, idxs, { lag1 = false } = {}) {
  const out = { n: idxs.length };
  for (const h of panel.horizons) {
    const src = lag1 ? panel.fwdL1[h] : panel.fwd[h];
    const v = idxs.map((i) => src[i]).filter((x) => x !== null);
    out[`fwd${h}`] = { n: v.length, mean: pct(mean(v)), median: pct(median(v)), pctPos: v.length ? r2((v.filter((x) => x > 0).length / v.length) * 100, 1) : null };
  }
  const dd = idxs.map((i) => (lag1 ? panel.dd20L1 : panel.dd20)[i]).filter((x) => x !== null);
  out.dd20 = { n: dd.length, pDrop5: dd.length ? r2((dd.filter((x) => x <= -0.05).length / dd.length) * 100, 1) : null, meanMinRet: pct(mean(dd)) };
  if (!lag1) { const vv = idxs.map((i) => panel.vol20[i]).filter((x) => x !== null); out.fwdVol20 = pct(mean(vv), 1); }
  return out;
}

/**
 * Tabla por grupos + t NW contra el resto de la muestra + episodios + leave-one-episode-out.
 * @param rows [{i, key}] días de la muestra con su grupo
 */
export function bucketTable(panel, rows, order, { lag1 = false, withRobust = true } = {}) {
  const table = {};
  const all = rows.map((r) => r.i);
  table.__BASE__ = groupStats(panel, all, { lag1 });
  for (const k of order) {
    const idxs = rows.filter((r) => r.key === k).map((r) => r.i);
    if (!idxs.length) { table[k] = { n: 0 }; continue; }
    const st = groupStats(panel, idxs, { lag1 });
    st.shareOfDays = r2((idxs.length / all.length) * 100, 1);
    if (withRobust) {
      const eps = episodes(idxs);
      st.episodes = eps.length;
      st.largestEpisodeSharePct = r2((Math.max(...eps.map((e) => e.members.length)) / idxs.length) * 100, 1);
      // t NW (grupo − resto) sobre la muestra CONTIGUA con retorno futuro definido
      st.nwVsRest = {};
      for (const h of panel.horizons) {
        const src = lag1 ? panel.fwdL1[h] : panel.fwd[h];
        const sub = rows.filter((r) => src[r.i] !== null);
        const nw = nwDiff(sub.map((r) => src[r.i]), sub.map((r) => r.key === k), h);
        st.nwVsRest[`fwd${h}`] = nw ? { diffPp: pct(nw.diff), t: r2(nw.t) } : null;
      }
      // leave-one-episode-out: ¿depende el resultado de UN episodio?
      if (eps.length >= 3) {
        const loeo = eps.map((e) => {
          const drop = new Set(e.members); const keep = idxs.filter((i) => !drop.has(i));
          const f20 = keep.map((i) => panel.fwd[20][i]).filter((x) => x !== null);
          const f60 = keep.map((i) => panel.fwd[60][i]).filter((x) => x !== null);
          const dd = keep.map((i) => panel.dd20[i]).filter((x) => x !== null);
          return { from: panel.dates[e.first], to: panel.dates[e.last], days: e.members.length, fwd20: mean(f20), fwd60: mean(f60), pDrop5: dd.length ? dd.filter((x) => x <= -0.05).length / dd.length : null };
        });
        const pick = (key, fn) => loeo.reduce((best, x) => (x[key] !== null && (best === null || fn(x[key], best[key])) ? x : best), null);
        const mn60 = pick("fwd60", (a, b) => a < b), mx60 = pick("fwd60", (a, b) => a > b);
        const mnDD = pick("pDrop5", (a, b) => a < b), mxDD = pick("pDrop5", (a, b) => a > b);
        st.leaveOneEpisodeOut = {
          fwd60MeanRange: [pct(mn60?.fwd60), pct(mx60?.fwd60)],
          fwd60MinWhenDropping: mn60 ? `${mn60.from}→${mn60.to} (${mn60.days} d)` : null,
          fwd60MaxWhenDropping: mx60 ? `${mx60.from}→${mx60.to} (${mx60.days} d)` : null,
          fwd20MeanRange: [pct(Math.min(...loeo.map((x) => x.fwd20).filter((x) => x !== null))), pct(Math.max(...loeo.map((x) => x.fwd20).filter((x) => x !== null)))],
          pDrop5Range: [mnDD ? r2(mnDD.pDrop5 * 100, 1) : null, mxDD ? r2(mxDD.pDrop5 * 100, 1) : null],
        };
      }
    }
    table[k] = st;
  }
  return table;
}

/** Deciles por VALOR (cortes de cuantil; con scores discretos los tamaños no son iguales). */
export function decileRows(rows, scoreOf) {
  const v = rows.map(scoreOf).sort((a, b) => a - b);
  const cuts = []; for (let q = 1; q < 10; q++) cuts.push(v[Math.floor((q * v.length) / 10)]);
  return { cuts, rows: rows.map((r) => { const s = scoreOf(r); let d = 1; for (const c of cuts) if (s >= c) d++; return { ...r, key: `D${d}` }; }) };
}

/** IC de Spearman score↔retorno futuro (muestra completa y por subperiodo). */
export function icTable(panel, rows, scoreOf, periods) {
  const out = {};
  const one = (rs) => { const o = {}; for (const h of panel.horizons) { const sub = rs.filter((r) => panel.fwd[h][r.i] !== null); o[`fwd${h}`] = r2(spearman(sub.map(scoreOf), sub.map((r) => panel.fwd[h][r.i])), 3); } const sd = rs.filter((r) => panel.dd20[r.i] !== null); o.dd20 = r2(spearman(sd.map(scoreOf), sd.map((r) => panel.dd20[r.i])), 3); return o; };
  out.full = one(rows);
  for (const [name, from, to] of periods) out[name] = one(rows.filter((r) => panel.dates[r.i] >= from && panel.dates[r.i] <= to));
  return out;
}

/**
 * ¿Aporta algo MÁS ALLÁ del VIX? Dentro de cada tramo de VIX se compara el grupo con el resto.
 * Si dentro del tramo no hay diferencia, toda la "señal" era el propio nivel del VIX.
 * @param rows filas con `vix` (nivel al cierre de t)
 */
export function vixControlled(panel, rows, isGroup, bins = [[0, 20, "VIX<20"], [20, 30, "VIX 20-30"], [30, 1e9, "VIX>=30"]]) {
  const out = {};
  const pack = (idxs) => { const s = groupStats(panel, idxs); return { n: idxs.length, fwd20: s.fwd20.mean, fwd60: s.fwd60.mean, pDrop5: s.dd20.pDrop5, vol20: s.fwdVol20 }; };
  for (const [lo, hi, name] of bins) {
    const inBin = rows.filter((r) => r.vix !== null && r.vix >= lo && r.vix < hi);
    out[name] = { group: pack(inBin.filter(isGroup).map((r) => r.i)), rest: pack(inBin.filter((r) => !isGroup(r)).map((r) => r.i)) };
  }
  return out;
}

/** Tabla compacta para consola. */
export function printTable(title, table, order) {
  console.log(`\n${title}`);
  console.log("grupo              n     %días  epis | f5 media  f20 media  f20 med  f20 %+ | f60 media  f60 med  f60 %+ | P(caída>5%/20s) | t(f60 vs resto)");
  for (const k of ["__BASE__", ...order]) {
    const s = table[k]; if (!s || !s.n) { console.log(`${k.padEnd(16)} ${"0".padStart(5)}`); continue; }
    const f = (x, w = 8) => String(x ?? "—").padStart(w);
    console.log(`${(k === "__BASE__" ? "TODOS" : k).padEnd(16)} ${f(s.n, 5)} ${f(s.shareOfDays ?? 100, 7)} ${f(s.episodes ?? "", 5)} | ${f(s.fwd5.mean)} ${f(s.fwd20.mean, 10)} ${f(s.fwd20.median)} ${f(s.fwd20.pctPos, 7)} | ${f(s.fwd60.mean, 9)} ${f(s.fwd60.median)} ${f(s.fwd60.pctPos, 7)} | ${f(s.dd20.pDrop5, 15)} | ${f(s.nwVsRest?.fwd60?.t ?? "", 8)}`);
  }
}

// ─── Réplica de fearGreedHandler.js ───────────────────────────────────────────
// Réplica ESCRITA A MANO (documentación legible). La que se USA es la extraída del fuente.
const REPLICA = {
  vixScore: (v) => (v < 12 ? 100 : v < 15 ? 80 : v < 20 ? 60 : v < 25 ? 35 : 10),
  spyScore: (c) => (c > 1 ? 90 : c > 0.3 ? 70 : c > 0 ? 55 : c > -0.5 ? 40 : 20),
  hygScore: (c) => (c > 0.2 ? 85 : c > 0 ? 65 : c < -0.3 ? 20 : 35),
  moveScore: (m) => (m < 70 ? 90 : m < 85 ? 70 : m < 100 ? 50 : m < 115 ? 30 : 10),
  vvixScore: (v) => (v < 80 ? 90 : v < 90 ? 70 : v < 100 ? 50 : v < 110 ? 35 : 15),
  lqdScore: (c) => (c > 0.15 ? 85 : c > 0 ? 65 : c < -0.2 ? 20 : 35),
  tnxScore: (c) => { const m = Math.abs(c); return m < 1 ? 80 : m < 2 ? 60 : m < 4 ? 40 : 20; },
  toRating: (s) => (s <= 25 ? "EXTREME_FEAR" : s <= 45 ? "FEAR" : s <= 55 ? "NEUTRAL" : s <= 75 ? "GREED" : "EXTREME_GREED"),
};
const REPLICA_WEIGHTS = { VIX: 0.25, SPY: 0.15, HYG: 0.15, MOVE: 0.15, VVIX: 0.10, LQD: 0.10, TNX: 0.10 };

/** Extrae del FUENTE de producción las funciones puras (no exportadas) y los pesos. */
export function loadHandlerScoring() {
  const file = path.join(ROOT, "api/_lib/fearGreedHandler.js");
  const src = fs.readFileSync(file, "utf8");
  const fns = {};
  for (const name of Object.keys(REPLICA)) {
    const m = src.match(new RegExp(`function ${name}\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!m) throw new Error(`No encuentro function ${name} en ${file}`);
    fns[name] = new Function(m[1], m[2]); // funciones puras del propio repo, sin efectos
  }
  const weights = {};
  for (const [k, v] of [["VIX", "sVix"], ["SPY", "sSpy"], ["HYG", "sHyg"], ["MOVE", "sMove"], ["VVIX", "sVvix"], ["LQD", "sLqd"], ["TNX", "sTnx"]]) {
    const m = src.match(new RegExp(`${v}\\s*\\*\\s*([0-9.]+)`));
    if (!m) throw new Error(`No encuentro el peso de ${v}`);
    weights[k] = Number(m[1]);
  }
  // Contraste réplica ↔ fuente sobre malla densa (paso 0,001 en % y 0,01 en niveles)
  let checks = 0;
  const grid = (lo, hi, step) => { const a = []; for (let x = lo; x <= hi + 1e-9; x += step) a.push(+x.toFixed(4)); return a; };
  const cases = [
    ["vixScore", grid(5, 90, 0.01)], ["moveScore", grid(40, 250, 0.01)], ["vvixScore", grid(50, 220, 0.01)],
    ["spyScore", grid(-12, 12, 0.001)], ["hygScore", grid(-8, 8, 0.001)], ["lqdScore", grid(-8, 8, 0.001)], ["tnxScore", grid(-30, 30, 0.001)],
    ["toRating", grid(0, 100, 1)],
  ];
  for (const [name, xs] of cases) for (const x of xs) { checks++; if (fns[name](x) !== REPLICA[name](x)) throw new Error(`FIDELIDAD: ${name}(${x}) fuente=${fns[name](x)} réplica=${REPLICA[name](x)}`); }
  for (const k of Object.keys(REPLICA_WEIGHTS)) if (weights[k] !== REPLICA_WEIGHTS[k]) throw new Error(`FIDELIDAD: peso ${k} fuente=${weights[k]} réplica=${REPLICA_WEIGHTS[k]}`);
  return { fns, weights, sourceSha256: sha256(src), fidelityChecks: checks };
}

/** Composite interno EXACTO del handler (null si falta algún componente: aquí se exigen 7/7). */
export function internalComposite(sc, x) {
  const parts = { VIX: x.vix, SPY: x.spy, HYG: x.hyg, MOVE: x.move, VVIX: x.vvix, LQD: x.lqd, TNX: x.tnx };
  if (Object.values(parts).some((v) => v === null || !Number.isFinite(v))) return null;
  const s = {
    VIX: sc.fns.vixScore(x.vix), SPY: sc.fns.spyScore(x.spy), HYG: sc.fns.hygScore(x.hyg), MOVE: sc.fns.moveScore(x.move),
    VVIX: sc.fns.vvixScore(x.vvix), LQD: sc.fns.lqdScore(x.lqd), TNX: sc.fns.tnxScore(x.tnx),
  };
  let raw = 0; for (const k of Object.keys(s)) raw += s[k] * sc.weights[k];
  const score = Math.round(raw);
  return { score, rating: sc.fns.toRating(score), comp: s };
}

// ─── CNN ──────────────────────────────────────────────────────────────────────
const CNN_RATING_MAP = { "extreme fear": "EXTREME_FEAR", fear: "FEAR", neutral: "NEUTRAL", greed: "GREED", "extreme greed": "EXTREME_GREED" };

/** Histórico CNN. Devuelve también el diagnóstico de disponibilidad (rellenos a 50, etc.). */
export async function loadCnn(opts, start = "2020-08-01") {
  const file = path.join(opts.cache, `cnn_graphdata_${start}.json`);
  let wrap = null;
  if (!opts.refresh && fs.existsSync(file)) wrap = JSON.parse(fs.readFileSync(file, "utf8"));
  const probes = [];
  if (!wrap) {
    if (opts.offline) throw new Error(`--offline y sin caché CNN (${file})`);
    // Sonda: ¿cuánto histórico sirve CNN? (inicio 2018/2019/2020-07 → HTTP 500 el 25-sep-2026)
    for (const s of ["2018-01-01", "2020-07-01", start]) {
      const url = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${s}`;
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA, referer: "https://www.cnn.com/markets/fear-and-greed" }, signal: AbortSignal.timeout(30000) });
      probes.push({ start: s, http: r.status });
      if (s === start) {
        if (!r.ok) throw new Error(`CNN HTTP ${r.status} para inicio ${start}`);
        wrap = { fetchedAt: new Date().toISOString(), url, probes, payload: await r.json() };
        fs.writeFileSync(file, JSON.stringify(wrap));
      } else { await r.arrayBuffer().catch(() => null); }
    }
  }
  const pts = (wrap.payload?.fear_and_greed_historical?.data ?? []).map((p) => ({
    date: new Date(p.x).toISOString().slice(0, 10), time: new Date(p.x).toISOString().slice(11, 19), y: p.y, rating: CNN_RATING_MAP[String(p.rating).toLowerCase()] ?? null,
  }));
  // Rellenos: rachas de ≥5 valores EXACTAMENTE 50 (CNN los usa como placeholder en 2020-21);
  // el tramo usable empieza tras la ÚLTIMA racha. Solo puntos de cierre (00:00 UTC) ≤ end.
  let lastRunEnd = -1, run = 0;
  const runs = [];
  pts.forEach((p, i) => { if (p.y === 50) { run++; if (run === 5) runs.push({ fromIdx: i - 4 }); if (run >= 5) { runs.at(-1).toIdx = i; lastRunEnd = i; } } else run = 0; });
  const usable = pts.filter((p, i) => i > lastRunEnd && p.time === "00:00:00" && p.date <= opts.end && p.rating);
  return {
    fetchedAt: wrap.fetchedAt, url: wrap.url, probes: wrap.probes ?? probes, totalPoints: pts.length,
    firstPoint: pts[0]?.date ?? null,
    placeholderRuns: runs.map((r) => ({ from: pts[r.fromIdx].date, to: pts[r.toIdx].date, n: r.toIdx - r.fromIdx + 1 })),
    anomaliesInPlaceholderZone: pts.filter((p, i) => i <= lastRunEnd && p.y !== 50).map((p) => `${p.date}=${p.y}`),
    usable, sha256: sha256(JSON.stringify(usable)),
  };
}

// ─── Estudio ──────────────────────────────────────────────────────────────────
const RATINGS = ["EXTREME_FEAR", "FEAR", "NEUTRAL", "GREED", "EXTREME_GREED"];
const DECILES = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"];

async function main() {
  const opts = parseArgs(process.argv.slice(2), {
    end: "2026-09-24", cache: path.join(os.tmpdir(), "emrr-backtest-cache"), offline: false, refresh: false,
    out: path.join(ROOT, "backtests/fear-greed-2026-09-25.json"),
  });
  console.log(`BACKTEST FEAR & GREED · fin ${opts.end} · caché ${opts.cache}`);

  const sc = loadHandlerScoring();
  console.log(`Fidelidad: ${sc.fidelityChecks} comprobaciones réplica↔fuente OK · pesos ${JSON.stringify(sc.weights)}`);

  const SYMS = ["SPY", "^VIX", "HYG", "LQD", "^TNX", "^MOVE", "^VVIX"];
  const S = {};
  for (const s of SYMS) S[s] = await loadYahoo(s, opts);
  const quality = SYMS.map((s) => seriesQuality(S[s]));
  for (const q of quality) console.log(`  ${q.symbol.padEnd(6)} ${q.first}→${q.last} barras ${q.bars} huecos ${q.nullCloses} salto máx ${q.maxDailyJumpPct.pct}% (${q.maxDailyJumpPct.date})`);

  // Contraste con la copia congelada de data/sp500-history.json (cierres brutos, fechas comunes)
  const crossCheck = {};
  const frozen = ["/private/tmp/claude-501/sp500-history-frozen-2026-09-25.json", path.join(ROOT, "data/sp500-history.json")].find((f) => fs.existsSync(f));
  if (frozen) {
    const fz = JSON.parse(fs.readFileSync(frozen, "utf8")).series ?? {};
    for (const s of ["SPY", "^VIX", "HYG", "LQD", "^TNX"]) {
      const m = new Map((fz[s] ?? []).map((b) => [b.date, b.close]));
      let n = 0, maxRel = 0;
      for (const b of S[s].bars) if (b.close !== null && m.has(b.date) && Number.isFinite(m.get(b.date))) { n++; maxRel = Math.max(maxRel, Math.abs(b.close / m.get(b.date) - 1)); }
      crossCheck[s] = { commonDates: n, maxRelDiffPct: r2(maxRel * 100, 4) };
    }
    console.log(`Contraste con ${path.basename(frozen)}: ${JSON.stringify(crossCheck)}`);
  }

  const panel = forwardPanel(S.SPY);

  // ── Composite interno, día a día, sobre el calendario del SPY ──
  const signal = [];
  let skipped = 0;
  for (let i = 0; i < panel.n; i++) {
    const d = panel.dates[i];
    const x = {
      vix: asOfLevel(S["^VIX"], d), move: asOfLevel(S["^MOVE"], d), vvix: asOfLevel(S["^VVIX"], d),
      spy: asOfChange(S.SPY, d), hyg: asOfChange(S.HYG, d), lqd: asOfChange(S.LQD, d), tnx: asOfChange(S["^TNX"], d),
    };
    const c = internalComposite(sc, x);
    if (!c) { if (d >= "2007-04-12") skipped++; continue; }
    signal.push({ i, date: d, score: c.score, key: c.rating, vix: x.vix, comp: c.comp });
  }
  const s0 = signal[0].date, s1 = signal.at(-1).date;
  console.log(`\nComposite interno: ${signal.length} días ${s0}→${s1} (7/7 componentes reales; ${skipped} días sin algún componente desde 2007-04-12)`);

  const PERIODS_INT = [["P1_2007-2012", "2007-01-01", "2012-12-31"], ["P2_2013-2019", "2013-01-01", "2019-12-31"], ["P3_2020-2026", "2020-01-01", "2026-12-31"]];
  const internal = {
    sample: { from: s0, to: s1, days: signal.length, daysMissingComponent: skipped },
    ratingDistributionPct: Object.fromEntries(RATINGS.map((k) => [k, r2((signal.filter((r) => r.key === k).length / signal.length) * 100, 1)])),
    scoreStats: { min: Math.min(...signal.map((r) => r.score)), max: Math.max(...signal.map((r) => r.score)), mean: r2(mean(signal.map((r) => r.score)), 1), distinctValues: new Set(signal.map((r) => r.score)).size },
    byRating: bucketTable(panel, signal, RATINGS),
    byRatingLag1: bucketTable(panel, signal, RATINGS, { lag1: true, withRobust: false }),
    bySubperiod: {},
    ic: icTable(panel, signal, (r) => r.score, PERIODS_INT),
    icVixOnly: icTable(panel, signal, (r) => -r.vix, PERIODS_INT),
    correlationScoreVsMinusVix: r2(spearman(signal.map((r) => r.score), signal.map((r) => -r.vix)), 3),
    vixControlled: {
      EXTREME_FEAR_vs_rest: vixControlled(panel, signal, (r) => r.key === "EXTREME_FEAR"),
      FEAR_or_EXTREME_FEAR_vs_rest: vixControlled(panel, signal, (r) => r.key === "EXTREME_FEAR" || r.key === "FEAR"),
      EXTREME_GREED_vs_rest: vixControlled(panel, signal, (r) => r.key === "EXTREME_GREED", [[0, 15, "VIX<15"], [15, 20, "VIX 15-20"]]),
    },
  };
  printTable("COMPOSITE INTERNO — por rating (muestra completa)", internal.byRating, RATINGS);
  for (const [name, from, to] of PERIODS_INT) {
    const rows = signal.filter((r) => r.date >= from && r.date <= to);
    internal.bySubperiod[name] = bucketTable(panel, rows, RATINGS, { withRobust: false });
    printTable(`  subperiodo ${name}`, internal.bySubperiod[name], RATINGS);
  }
  const decI = decileRows(signal, (r) => r.score);
  internal.deciles = { cuts: decI.cuts, table: bucketTable(panel, decI.rows, DECILES, { withRobust: false }) };
  printTable(`COMPOSITE INTERNO — deciles de score (cortes ${decI.cuts.join("/")})`, internal.deciles.table, DECILES);
  console.log("IC Spearman composite:", JSON.stringify(internal.ic));
  console.log("IC Spearman −VIX solo :", JSON.stringify(internal.icVixOnly));

  // ── CNN ──
  const cnn = await loadCnn(opts);
  const dateIdx = new Map(panel.dates.map((d, i) => [d, i]));
  const cnnRows = cnn.usable.filter((p) => dateIdx.has(p.date)).map((p) => ({ i: dateIdx.get(p.date), date: p.date, score: p.y, key: p.rating, vix: asOfLevel(S["^VIX"], p.date) }));
  // Sincronía: ¿el punto CNN fechado D refleja el cierre de D? (ΔCNN vs retorno SPY de D, D-1, D+1)
  const ret1 = (i) => (i > 0 && i < panel.n ? panel.adj[i] / panel.adj[i - 1] - 1 : null);
  const sync = {};
  for (const [lbl, off] of [["sameDay", 0], ["prevDay", -1], ["nextDay", 1]]) {
    const xs = [], ys = [];
    for (let k = 1; k < cnnRows.length; k++) { const a = cnnRows[k - 1], b = cnnRows[k]; if (b.i - a.i !== 1) continue; const r = ret1(b.i + off); if (r === null) continue; xs.push(b.score - a.score); ys.push(r); }
    sync[lbl] = r2(pearson(xs, ys), 3);
  }
  const PERIODS_CNN = [["C1_2021-2022", "2021-01-01", "2022-12-31"], ["C2_2023-2024", "2023-01-01", "2024-12-31"], ["C3_2025-2026", "2025-01-01", "2026-12-31"]];
  const cnnOut = {
    availability: {
      endpoint: "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/<inicio>",
      probes: cnn.probes, firstPointServed: cnn.firstPoint, totalPoints: cnn.totalPoints,
      placeholderRuns: cnn.placeholderRuns, anomaliesInPlaceholderZone: cnn.anomaliesInPlaceholderZone,
      usableFrom: cnnRows[0]?.date, usableTo: cnnRows.at(-1)?.date, usableDays: cnnRows.length, fetchedAt: cnn.fetchedAt, sha256: cnn.sha256,
      note: "CNN rechaza inicios anteriores a ~2020-08 (HTTP 500) y hasta 2021-01-21 sirve rellenos a 50 con valores anómalos (2-4) intercalados: solo es usable desde 2021-01-22 (~5,7 años).",
    },
    timingCheck_corr_dCNN_vs_SPYret: sync,
    ratingDistributionPct: Object.fromEntries(RATINGS.map((k) => [k, r2((cnnRows.filter((r) => r.key === k).length / cnnRows.length) * 100, 1)])),
    byRating: bucketTable(panel, cnnRows, RATINGS),
    byRatingLag1: bucketTable(panel, cnnRows, RATINGS, { lag1: true, withRobust: false }),
    bySubperiod: {},
    ic: icTable(panel, cnnRows, (r) => r.score, PERIODS_CNN),
    icVixOnlySameWindow: icTable(panel, cnnRows, (r) => -r.vix, PERIODS_CNN),
    vixControlled: {
      EXTREME_FEAR_vs_rest: vixControlled(panel, cnnRows, (r) => r.key === "EXTREME_FEAR"),
      EXTREME_GREED_vs_rest: vixControlled(panel, cnnRows, (r) => r.key === "EXTREME_GREED", [[0, 15, "VIX<15"], [15, 20, "VIX 15-20"]]),
    },
  };
  console.log(`\nCNN usable ${cnnOut.availability.usableFrom}→${cnnOut.availability.usableTo} (${cnnRows.length} días) · sincronía ΔCNN↔SPY ${JSON.stringify(sync)}`);
  printTable("CNN — por rating", cnnOut.byRating, RATINGS);
  for (const [name, from, to] of PERIODS_CNN) {
    const rows = cnnRows.filter((r) => r.date >= from && r.date <= to);
    cnnOut.bySubperiod[name] = bucketTable(panel, rows, RATINGS, { withRobust: false });
    printTable(`  subperiodo ${name}`, cnnOut.bySubperiod[name], RATINGS);
  }
  const decC = decileRows(cnnRows, (r) => r.score);
  cnnOut.deciles = { cuts: decC.cuts.map((c) => r2(c, 1)), table: bucketTable(panel, decC.rows, DECILES, { withRobust: false }) };
  printTable(`CNN — deciles (cortes ${cnnOut.deciles.cuts.join("/")})`, cnnOut.deciles.table, DECILES);
  console.log("IC Spearman CNN:", JSON.stringify(cnnOut.ic));
  console.log("IC Spearman −VIX (misma ventana CNN):", JSON.stringify(cnnOut.icVixOnlySameWindow));
  console.log("Control por VIX — interno:", JSON.stringify(internal.vixControlled));
  console.log("Control por VIX — CNN:", JSON.stringify(cnnOut.vixControlled));

  // ── Mismo periodo, composite interno (comparable con CNN) + concordancia de respaldo ──
  const intByDate = new Map(signal.map((r) => [r.date, r]));
  const pairs = cnnRows.filter((r) => intByDate.has(r.date)).map((r) => ({ cnn: r, int: intByDate.get(r.date) }));
  const same = pairs.filter((p) => p.cnn.key === p.int.key).length;
  const adjacent = pairs.filter((p) => Math.abs(RATINGS.indexOf(p.cnn.key) - RATINGS.indexOf(p.int.key)) <= 1).length;
  const confusion = Object.fromEntries(RATINGS.map((a) => [a, Object.fromEntries(RATINGS.map((b) => [b, pairs.filter((p) => p.cnn.key === a && p.int.key === b).length]))]));
  const internalOnCnnWindow = signal.filter((r) => r.date >= cnnRows[0].date && r.date <= cnnRows.at(-1).date);
  const agreement = {
    days: pairs.length,
    pearson: r2(pearson(pairs.map((p) => p.cnn.score), pairs.map((p) => p.int.score)), 3),
    spearman: r2(spearman(pairs.map((p) => p.cnn.score), pairs.map((p) => p.int.score)), 3),
    sameRatingPct: r2((same / pairs.length) * 100, 1), sameOrAdjacentPct: r2((adjacent / pairs.length) * 100, 1),
    meanAbsDiffPts: r2(mean(pairs.map((p) => Math.abs(p.cnn.score - p.int.score))), 1),
    confusion_rowsCNN_colsInternal: confusion,
    internalByRatingOnCnnWindow: bucketTable(panel, internalOnCnnWindow, RATINGS, { withRobust: false }),
  };
  console.log(`\nCNN vs interno (${pairs.length} días): Pearson ${agreement.pearson} · mismo rating ${agreement.sameRatingPct}% · mismo/adyacente ${agreement.sameOrAdjacentPct}% · |dif| media ${agreement.meanAbsDiffPts} pts`);
  printTable("COMPOSITE INTERNO en la ventana CNN", agreement.internalByRatingOnCnnWindow, RATINGS);

  // Frontera de color vs etiqueta (UI): CNN usa intervalos semiabiertos sobre el score CRUDO,
  // el panel colorea por el score REDONDEADO con ≤25/≤45/≤55/≤75.
  const colorBand = (s) => (s <= 25 ? "EXTREME_FEAR" : s <= 45 ? "FEAR" : s <= 55 ? "NEUTRAL" : s <= 75 ? "GREED" : "EXTREME_GREED");
  const mismatch = cnn.usable.filter((p) => colorBand(Math.round(p.y)) !== p.rating);
  const uiBoundary = { cnnDaysColorDisagreesWithLabel: mismatch.length, examples: mismatch.slice(0, 6).map((p) => `${p.date} raw ${p.y.toFixed(2)} → ${Math.round(p.y)} etiqueta ${p.rating} color ${colorBand(Math.round(p.y))}`) };
  console.log(`UI: días CNN con color ≠ etiqueta en la frontera: ${mismatch.length}`);

  // ── Veredicto y textos propuestos (cifras TEMPLADAS desde los resultados de esta ejecución) ──
  const es = (x, k = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(k).replace(".", ","));
  const B = cnnOut.byRating.__BASE__, EF = cnnOut.byRating.EXTREME_FEAR, EG = cnnOut.byRating.EXTREME_GREED;
  const subs = Object.values(cnnOut.bySubperiod);
  const efSubAbove = subs.filter((t) => t.EXTREME_FEAR?.n && t.EXTREME_FEAR.fwd60.mean > t.__BASE__.fwd60.mean).length;
  const efSubN = subs.filter((t) => t.EXTREME_FEAR?.n).length;
  const efLo = EF.leaveOneEpisodeOut?.fwd60MeanRange ?? [null, null];
  const efDD = EF.leaveOneEpisodeOut?.pDrop5Range ?? [null, null];
  const IB = internal.byRating.__BASE__, IEF = internal.byRating.EXTREME_FEAR, IEG = internal.byRating.EXTREME_GREED;
  const D1 = internal.deciles.table.D1, D10 = internal.deciles.table.D10;
  const fromC = cnnRows[0].date, toC = cnnRows.at(-1).date;
  const yC = `${fromC.slice(2, 4)}-${toC.slice(2, 4)}`;
  const verdict = {
    cnn_displayed: {
      extremeFear: `ÚNICO tramo con valor: SPY +${es(EF.fwd60.mean)}% medio a 60 ses. vs +${es(B.fwd60.mean)}% cualquier día (mediana ${es(EF.fwd60.median)} vs ${es(B.fwd60.median)}; ${es(EF.fwd60.pctPos, 0)}% vs ${es(B.fwd60.pctPos, 0)}% positivos), por encima de la media en ${efSubAbove}/${efSubN} subperiodos, leave-one-episode-out ${es(efLo[0])}–${es(efLo[1])}%, lag-1 ${es(cnnOut.byRatingLag1.EXTREME_FEAR.fwd60.mean)}%; ${EF.episodes} episodios, t NW ${es(EF.nwVsRest.fwd60.t, 2)} (indicativa). Vol. realizada posterior ${es(EF.fwdVol20)}% vs ${es(B.fwdVol20)}%. P(caída>5%/20s) ${es(EF.dd20.pDrop5)}% vs ${es(B.dd20.pDrop5)}% pero NO robusto (LOEO ${es(efDD[0])}–${es(efDD[1])}%: depende de abr-2025). Aporta más allá del VIX (con VIX 20-30: +${es(cnnOut.vixControlled.EXTREME_FEAR_vs_rest["VIX 20-30"].group.fwd60)}% vs +${es(cnnOut.vixControlled.EXTREME_FEAR_vs_rest["VIX 20-30"].rest.fwd60)}% a 60 ses.).`,
      extremeGreed: `NO es señal de venta: P(caída>5%/20s) ${es(EG.dd20.pDrop5)}% vs ${es(B.dd20.pDrop5)}% (LOEO ${es(EG.leaveOneEpisodeOut?.pDrop5Range?.[0])}–${es(EG.leaveOneEpisodeOut?.pDrop5Range?.[1])}%), retorno 60 ses. +${es(EG.fwd60.mean)}% vs +${es(B.fwd60.mean)}% (t ${es(EG.nwVsRest.fwd60.t, 2)}, inestable entre subperiodos; ${EG.n} días, ${EG.episodes} episodios).`,
      middleBuckets: `Miedo / Neutral / Codicia: sin ventaja consistente (t 60 ses. ${es(cnnOut.byRating.FEAR.nwVsRest.fwd60.t, 2)} / ${es(cnnOut.byRating.NEUTRAL.nwVsRest.fwd60.t, 2)} / ${es(cnnOut.byRating.GREED.nwVsRest.fwd60.t, 2)}); deciles D2-D10 planos. Neutral a 20 ses. sale por debajo (t ${es(cnnOut.byRating.NEUTRAL.nwVsRest.fwd20.t, 2)}) sin mecanismo y tras ~15 comparaciones: no concluyente.`,
      sampleCaveat: `Muestra CNN corta (${fromC}→${toC}, ${cnnRows.length} sesiones) y mayoritariamente alcista: sin un bear market prolongado salvo 2022. Con el composite interno en 2007-12, tras miedo extremo hubo una caída adicional >5% en 20 ses. el ${es(internal.bySubperiod["P1_2007-2012"].EXTREME_FEAR.dd20.pDrop5, 0)}% de las veces (media del periodo ${es(internal.bySubperiod["P1_2007-2012"].__BASE__.dd20.pDrop5, 0)}%): el rebote medio llega, pero no sin sustos.`,
      colorScale: "Rojo=miedo extremo / verde=codicia es correcto como ESTRÉS ACTUAL, engañoso como PRONÓSTICO: tras miedo extremo el retorno medio fue MAYOR, tras codicia extrema no peor.",
    },
    internal_fallback: {
      summary: `Composite ≈ VIX invertido (Spearman ${es(internal.correlationScoreVsMinusVix, 2)}): riesgo de caída monótono (D1 ${es(D1.dd20.pDrop5)}% → D10 ${es(D10.dd20.pDrop5)}% P(caída>5%/20s), signo estable 3/3 subperiodos), retorno débilmente contrario (IC 60 ses. ${es(internal.ic.full.fwd60, 3)}), pero el VIX SOLO predice mejor (IC ${es(internal.icVixOnly.full.fwd60, 3)} / riesgo ${es(internal.icVixOnly.full.dd20, 3)} vs ${es(internal.ic.full.dd20, 3)}). Miedo extremo: P(caída>5%/20s) ${es(IEF.dd20.pDrop5)}% vs ${es(IB.dd20.pDrop5)}% (robusto, LOEO ${es(IEF.leaveOneEpisodeOut?.pDrop5Range?.[0])}–${es(IEF.leaveOneEpisodeOut?.pDrop5Range?.[1])}%); codicia extrema ${es(IEG.dd20.pDrop5)}%.`,
      notASubstituteForCnn: `Coincide con CNN solo el ${es(agreement.sameRatingPct)}% de los días (Pearson ${es(agreement.pearson, 2)}, |dif| media ${es(agreement.meanAbsDiffPts)} pts): cuando CNN marcó codicia extrema el interno NUNCA lo hizo (${agreement.confusion_rowsCNN_colsInternal.EXTREME_GREED.EXTREME_GREED}/${EG.n}); con miedo extremo CNN, el interno dijo codicia ${agreement.confusion_rowsCNN_colsInternal.EXTREME_FEAR.GREED} días.`,
      designFlaw: (() => {
        const share = (y) => { const g = signal.filter((r) => r.date.startsWith(y)); return g.length ? (g.filter((r) => r.comp.TNX < 80).length / g.length) * 100 : null; };
        const yLast = signal.at(-1).date.slice(0, 4);
        return `El componente TNX puntúa el % de variación del NIVEL del yield: con yields de ~0,7% (2020) penalizó el ${es(share("2020"), 0)}% de los días, en ${yLast} (~4,4%) el ${es(share(yLast), 0)}% — el umbral deriva con el nivel de tipos, no con el estrés.`;
      })(),
    },
    uiIssues: [
      `Color ≠ etiqueta en ${uiBoundary.cnnDaysColorDisagreesWithLabel} de ${cnn.usable.length} días CNN: el panel colorea por score REDONDEADO con ≤25/45/55/75 y CNN etiqueta el score CRUDO con <25/45/55/75 (p.ej. "Miedo" pintado en rojo de miedo extremo). Arreglo: colorear por rating.`,
      "El respaldo interno usa la MISMA escala y etiquetas que CNN sin serlo (ver notASubstituteForCnn).",
    ],
  };
  const proposedUiTexts = {
    note: "Textos propuestos para que el panel diga SOLO lo que soporta la evidencia. Líneas referidas a HEAD del 25-sep-2026.",
    "src/components/FearGreedPanel.tsx": {
      "L105-111 + L155 (color)": "Colorear por RATING, no por score: const RATING_COLOR = { EXTREME_FEAR: \"#ef4444\", FEAR: \"#f97316\", NEUTRAL: \"#64748b\", GREED: \"#4ade80\", EXTREME_GREED: \"#15803d\" }; const color = RATING_COLOR[fgData.rating] ?? getColor(fgData.score);",
      "L165 (cabecera, fuente interna)": "Índice interno (CNN no disponible) · ${n}/7 · escala propia, no comparable con CNN",
      "tras L218 (nueva línea 'lectura', ancho completo, 9px gris) — fuente CNN": {
        EXTREME_FEAR: `Hist. ${yC}: tras miedo extremo, SPY +${es(EF.fwd60.mean)}% medio a 60 ses. (media +${es(B.fwd60.mean)}%) · más volátil`,
        FEAR: `Hist. ${yC}: sin ventaja — lo que siguió fue similar a la media`,
        NEUTRAL: `Hist. ${yC}: sin ventaja — lo que siguió fue similar a la media`,
        GREED: `Hist. ${yC}: sin ventaja — lo que siguió fue similar a la media`,
        EXTREME_GREED: `Hist. ${yC}: caídas >5% en 20 ses. raras (${es(EG.dd20.pDrop5)}% vs ${es(B.dd20.pDrop5, 0)}%) · retorno sin ventaja`,
      },
      "tras L218 — fuente interna (todas las etiquetas)": `Escala ≈ VIX: más miedo = más riesgo de caída a 20 ses. (${es(D1.dd20.pDrop5, 0)}% vs ${es(D10.dd20.pDrop5, 0)}% en los extremos); no anticipa el retorno`,
      "tras la lectura (nueva línea 'validación')": {
        CNN: `Validación: CNN ${fromC.slice(0, 7)}→${toC.slice(0, 7)} (${cnnRows.length} ses.). Solo el miedo extremo mostró ventaja; no es señal de compra/venta.`,
        INTERNAL: `Validación: composite interno ${internal.sample.from.slice(0, 7)}→${internal.sample.to.slice(0, 7)} (${internal.sample.days} ses.); coincide con CNN el ${es(agreement.sameRatingPct, 0)}% de los días.`,
      },
      "L139 (sin dato)": "Sin cambio: 'No se usa en Score, Ranking ni EXEC' es correcto.",
    },
  };

  const result = {
    study: "backtest-fear-greed", generatedAt: new Date().toISOString(), asOfEnd: opts.end,
    scope: {
      displayed: "src/components/FearGreedPanel.tsx ← GET /api/fear-greed (api/_lib/fearGreedHandler.js). No entra en Score, Ranking ni EXEC.",
      primarySource: "CNN Business F&G (score + rating CNN)", fallbackSource: "composite interno 7 indicadores (solo si CNN cae)",
    },
    methodology: {
      signal: "Día t = sesión del SPY. Niveles VIX/MOVE/VVIX = cierre ≤ t (antigüedad ≤5 días naturales). % del día de SPY/HYG/LQD/TNX = cierre bruto de la última sesión ≤ t contra la sesión inmediatamente anterior (null si hay hueco), igual que el quote de producción. Composite con 7/7 componentes reales (el handler rellena con 50 y declara NO disponible con <4/7).",
      forward: "Retorno total del SPY (cierres ajustados) de t a t+5/20/60 sesiones; P(caída>5%/20s) = mínimo de cierres t+1..t+20 ≤ −5% vs cierre de t; vol. realizada 20s anualizada. Control lag-1: todo medido desde el cierre de t+1.",
      inference: "t Newey-West (Bartlett, L=h) de la diferencia grupo−resto; episodios = días del grupo separados >20 sesiones; leave-one-episode-out. Las t con ventanas solapadas y pocos episodios son INDICATIVAS (§10c).",
      noFitting: "No se ajusta ningún umbral: se evalúan los umbrales y etiquetas desplegados tal cual. Los deciles usan cortes de toda la muestra (descriptivo).",
      fidelity: `Funciones extraídas de api/_lib/fearGreedHandler.js (sha256 ${sc.sourceSha256.slice(0, 16)}…) y contrastadas con réplica en ${sc.fidelityChecks} puntos.`,
    },
    data: { yahoo: quality, crossCheckVsFrozenHistory: crossCheck },
    internalComposite: internal,
    cnn: cnnOut,
    cnnVsInternalAgreement: agreement,
    uiColorVsLabelBoundary: uiBoundary,
    verdict,
    proposedUiTexts,
  };
  console.log("\nVEREDICTO:", JSON.stringify(verdict, null, 1));
  console.log("\nTEXTOS PROPUESTOS:", JSON.stringify(proposedUiTexts, null, 1));
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(result, null, 1));
  console.log(`\n→ ${path.relative(ROOT, opts.out)}`);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
