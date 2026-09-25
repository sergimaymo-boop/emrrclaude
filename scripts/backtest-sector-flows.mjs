#!/usr/bin/env node
/**
 * BACKTEST — FLUJOS DE CAPITAL + RANKING SECTORIAL + GATE DEL FILTRO 4 (25-sep-2026)
 *
 * Pregunta del dueño: lo que ENSEÑAN los módulos sectoriales, ¿tiene valor predictivo?
 * Solo mide. No toca producción, no cambia lógica (§0 y §10c de CLAUDE.md).
 *
 * QUÉ CALCULA PRODUCCIÓN (leído del código el 25-sep-2026)
 *   A) Flujos de Capital — GET /api/sector-leaders-data?mode=intraday → IntraDayFlowsPanel
 *      · 10 ETFs: ITA XLU XLP GLD XLV SOXX IGV KBE XLE XLK (+ SPY de referencia).
 *      · intradayChange = último precio / apertura − 1 (velas de 5 min de Yahoo). Con el
 *        mercado cerrado = cierre vs apertura de la ÚLTIMA sesión (changeBasis close_vs_open).
 *        NUNCA vs cierre anterior.
 *      · relativeVolume = media de las 3 últimas velas de 5 min / media de las anteriores de la
 *        MISMA sesión, tope 5 (RVOL_CAP) → depende de la hora del día.
 *      · flowScore = clamp(chg% · √rvol · 10, −100, 100) → orden y badge #1..#10.
 *      · UI: chg>0 → "▲ Dinero Entrando", chg<0 → "▼ Dinero Saliendo"; mejor acción del
 *        sector (vs cierre anterior) con badge "✓ INVERTIBLE" / "S&P500".
 *   B) Ranking EOD — GET /api/sector-leaders-data (sin mode): 9 SPDR, performance5d =
 *      último cierre / primer cierre de range=5d − 1 (= 4 sesiones), estados LEADING >2 %,
 *      ACCELERATING >0, WEAKENING >−2, FALLING. ⚠ Ningún componente lo consume hoy.
 *   C) Filtro 4 de OptimalSignalPanel ("Sector con flujo institucional"): pasa si el
 *      intradayChange del ETF del sector del candidato (mapa STOCK_SECTOR) > 0,3 (abierto) /
 *      0,2 (cerrado); ticker sin mapear → pasa. ⚠ Señal Óptima NO se renderiza desde la
 *      consolidación del 24-jul-2026: el filtro es código dormido.
 *
 * PROXY (no hay histórico intradía de años): vela DIARIA. La señal "flujo" = cierre/apertura − 1
 * de la sesión t, que es EXACTAMENTE lo que el panel muestra tras el cierre (ÚLTIMA SESIÓN) y lo
 * que el filtro 4 evalúa con umbral 0,2. Retornos futuros desde el CIERRE de t (y desde la
 * APERTURA de t+1) sobre cierres AJUSTADOS → sin lookahead. Fidelidad del proxy medida contra
 * velas de 5 min (60 sesiones) y test intradía real con velas de 60 min (~730 sesiones).
 *
 * ESTADÍSTICA (honesta): media de excesos vs cesta equiponderada de los mismos ETFs; t de
 * Newey-West (lag = 2h, mín. 5) porque las ventanas de 5 y 20 sesiones se SOLAPAN; t con
 * muestra no solapada como contraste; bootstrap de bloques (bloque ≥ 60 sesiones, semilla
 * fija) para las comparaciones agrupadas (correlación entre sectores del mismo día). Muchas
 * pruebas → |t| ≈ 2 aparece por azar; exigir |t| ≥ 3 Y estabilidad por subperiodos.
 * sd MUESTRAL (n−1) — no la poblacional de rally-study-lib.
 *
 * DATOS: copia congelada de data/sp500-history.json (SPDR + SPY) + descarga Yahoo de los que
 * faltan (ITA GLD SOXX IGV KBE) + copia congelada de data/universe-10y.json (gate a nivel
 * acción). Caché de descargas en /private/tmp/claude-501 (re-ejecución offline y determinista;
 * --refresh fuerza la descarga). La vela de HOY (sesión en curso) se descarta siempre.
 *
 * Uso:  node --max-old-space-size=6144 scripts/backtest-sector-flows.mjs [--refresh]
 * Salida: backtests/sector-flows-2026-09-25.json
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "./rally-study-lib.mjs";

// ─── Configuración ────────────────────────────────────────────────────────────
const RUN_DATE = "2026-09-25";               // sesión en curso el día del estudio → se descarta
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = "/private/tmp/claude-501";
// Copias congeladas en /tmp (se purgan): si faltan, se usa la del repo — el JSON guarda el sha256 usado.
const firstExisting = (...ps) => ps.find((p) => fs.existsSync(p)) ?? ps[0];
const FROZEN = process.env.SF_FROZEN ?? firstExisting(`${TMP}/sp500-history-frozen-2026-09-25.json`, path.join(REPO, "data/sp500-history.json"));
const UNIVERSE = process.env.SF_UNIVERSE ?? firstExisting(`${TMP}/universe-10y-frozen-sf-2026-09-25.json`, path.join(REPO, "data/universe-10y.json"));
const CACHE = process.env.SF_CACHE ?? `${TMP}/sector-flows-yahoo-cache-2026-09-25.json`;
const OUT = path.join(REPO, "backtests/sector-flows-2026-09-25.json");
const REFRESH = process.argv.includes("--refresh");
const SEED = 20260925;
const BOOT_REPS = 2000;
const HORIZONS = [1, 5, 20];

// Réplica de producción (api/sector-leaders-data.js)
const FLOW_ETFS = ["ITA", "XLU", "XLP", "GLD", "XLV", "SOXX", "IGV", "KBE", "XLE", "XLK"];
const FLOW_KEY = { ITA: "defense", XLU: "utilities", XLP: "staples", GLD: "gold", XLV: "healthcare",
  SOXX: "semis", IGV: "software", KBE: "banks", XLE: "energy", XLK: "tech" };
const EOD_ETFS = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLC", "XLRE"];
const EOD_LEGACY = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP"];           // los 7 con historia desde 1999
const SPDR_ORIG9 = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY"]; // robustez del proxy de flujos
const RVOL_CAP = 5;
const FLOW_THRESHOLD_OPEN = 0.3, FLOW_THRESHOLD_CLOSED = 0.2;                    // OptimalSignalPanel.tsx
const DOWNLOAD_DAILY = [...new Set([...FLOW_ETFS, ...EOD_ETFS, ...SPDR_ORIG9, "SPY"])];
const DOWNLOAD_INTRADAY = [...FLOW_ETFS, "SPY"];

// Mapa STOCK_SECTOR de OptimalSignalPanel.tsx (copia literal, 25-sep-2026) — solo para el gate
const STOCK_SECTOR_RAW = {
  staples: "KO PEP PG WMT COST CL MO PM KHC GIS HSY K SJM CPB CAG TSN HRL MKC CHD CLX EL KMB COTY",
  utilities: "NEE SO DUK AEP SRE EXC XEL PCG WEC CMS ETR PPL EIX FE CNP NI ATO LNT OGE",
  defense: "LMT RTX NOC GD LHX HII TDG BA TXT LDOS CACI SAIC CAT DE HON GE MMM EMR ROK PH ITW IR CMI PCAR",
  gold: "NEM GOLD FCX AEM WPM FNV AUY KGC HL PAAS CF MOS NUE STLD RS ECL DD DOW LYB PPG",
  healthcare: "UNH LLY JNJ ABBV MRK TMO ABT DHR BMY AMGN GILD ISRG SYK BSX MDT EW HUM CVS MCK CI CNC HCA ZBH BAX BDX HOLX IQV RMD DXCM PODD ALGN IDXX BIIB REGN VRTX ILMN MRNA PFE JAZZ ALNY",
  semis: "NVDA AMD INTC QCOM AVGO TXN MU LRCX KLAC AMAT ADI ON MCHP SWKS QRVO MRVL MPWR ENPH STM WOLF",
  software: "MSFT ORCL CRM NOW INTU ADBE IBM CSCO AKAM NET FTNT PANW CRWD ZS OKTA DDOG SNOW MDB TEAM WDAY VEEV HUBS ZM DOCU SPLK COUP NICE PAYC GOOGL GOOG META NFLX DIS CMCSA CHTR TMUS VZ T ATVI EA",
  banks: "JPM BAC WFC C GS MS AXP BLK SCHW USB TFC PNC COF STT BK MTB RF KEY CFG FITB HBAN ZION CMA SIVB V MA PYPL SQ FIS FISV GPN WEX ALLY",
  energy: "XOM CVX COP EOG SLB MPC PXD DVN HES OXY FANG PSX VLO HAL BKR APA MRO CXO WMB KMI OKE ET EPD MPLX",
  tech: "AAPL ACN HPQ HPE DELL NTAP WDC STX CDW KEYS TRMB JNPR ZBRA FFIV VIAV CTSH DXC EPAM GLOB AMZN TSLA UBER LYFT SHOP TWLO",
};
const STOCK_SECTOR = {};
for (const [k, list] of Object.entries(STOCK_SECTOR_RAW)) for (const t of list.split(/\s+/)) STOCK_SECTOR[t] = k;
const KEY_ETF = Object.fromEntries(Object.entries(FLOW_KEY).map(([etf, k]) => [k, etf]));

// ─── Utilidades numéricas ─────────────────────────────────────────────────────
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meanOf = (a) => { let s = 0, n = 0; for (const x of a) if (isNum(x)) { s += x; n++; } return n ? s / n : NaN; };
const sdSample = (a) => { const v = a.filter(isNum); const n = v.length; if (n < 2) return NaN; const m = meanOf(v); let s = 0; for (const x of v) s += (x - m) ** 2; return Math.sqrt(s / (n - 1)); };
const r2 = (x, d = 2) => (isNum(x) ? +x.toFixed(d) : null);
const bps = (x) => (isNum(x) ? +(x * 1e4).toFixed(1) : null);
const pct = (x, d = 1) => (isNum(x) ? +(x * 100).toFixed(d) : null);
const nwLag = (h) => Math.max(5, 2 * h);

/** t de Newey-West (kernel de Bartlett) de la media de x (sin NaN). */
function nwT(x, L) {
  const v = x.filter(isNum); const n = v.length;
  if (n < 10) return { mean: NaN, t: NaN, se: NaN, n };
  const m = meanOf(v);
  const e = v.map((y) => y - m);
  let s = 0; for (let i = 0; i < n; i++) s += e[i] * e[i];
  let lrv = s / n;
  for (let l = 1; l <= L; l++) {
    let g = 0; for (let i = l; i < n; i++) g += e[i] * e[i - l];
    lrv += 2 * (1 - l / (L + 1)) * (g / n);
  }
  const se = Math.sqrt(Math.max(lrv, 1e-30) / n);
  return { mean: m, t: m / se, se, n };
}
/** t clásico con muestra NO solapada (una observación cada h sesiones, desfase 0). */
function nonOverlapT(x, h) {
  const v = []; for (let i = 0; i < x.length; i += h) if (isNum(x[i])) v.push(x[i]);
  const n = v.length; if (n < 10) return { t: NaN, n };
  const m = meanOf(v); const s = sdSample(v);
  return { t: m / (s / Math.sqrt(n)), n };
}
/** Spearman con rangos medios (empates). */
function spearmanRho(xs, ys) {
  const n = xs.length; if (n < 3) return NaN;
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let j = 0; j < n;) { let k = j; while (k + 1 < n && idx[k + 1][0] === idx[j][0]) k++; const avg = (j + k) / 2; for (let q = j; q <= k; q++) r[idx[q][1]] = avg; j = k + 1; }
    return r;
  };
  const rx = rank(xs), ry = rank(ys); const mx = meanOf(rx), my = meanOf(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

// ─── Descarga Yahoo (con caché) ───────────────────────────────────────────────
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) EMRR-backtest/1.0";
async function yahooChart(sym, params) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${params}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r || !Array.isArray(r.timestamp)) throw new Error("sin result");
      return r;
    } catch (e) {
      if (attempt === 4) throw new Error(`${sym} ${params}: ${e.message}`);
      await sleep(900 * attempt);
    } finally { clearTimeout(to); }
  }
  return null;
}
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function etParts(tsSec) {
  const p = Object.fromEntries(etFmt.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const fin = (v) => (isNum(v) && v > 0 ? v : null);
function parseDaily(r) {
  const q = r.indicators?.quote?.[0] ?? {}; const adj = r.indicators?.adjclose?.[0]?.adjclose ?? [];
  const out = []; const seen = new Set();
  r.timestamp.forEach((ts, i) => {
    const c = fin(q.close?.[i]); if (c === null) return;
    const { date } = etParts(ts); if (seen.has(date)) return; seen.add(date);
    out.push([date, fin(q.open?.[i]), fin(q.high?.[i]), fin(q.low?.[i]), c, fin(adj[i]) ?? c, isNum(q.volume?.[i]) ? q.volume[i] : null]);
  });
  return out;
}
function parseIntraday(r) {
  const q = r.indicators?.quote?.[0] ?? {};
  const out = [];
  r.timestamp.forEach((ts, i) => {
    const { date, hm } = etParts(ts);
    out.push([date, hm, fin(q.open?.[i]), fin(q.high?.[i]), fin(q.low?.[i]), fin(q.close?.[i]), isNum(q.volume?.[i]) ? q.volume[i] : null]);
  });
  return out;
}
// ⚠ TRAMPA (verificada 25-sep-2026): range=max&interval=1d devuelve velas MENSUALES en silencio
// (meta.dataGranularity "1mo"; XLC llega semanal). period1=0&period2=… sí devuelve diario.
// Por eso se exige la granularidad pedida en cada respuesta.
async function yahooChecked(sym, params, gran) {
  const r = await yahooChart(sym, params);
  const ok = [].concat(gran);
  if (!ok.includes(r.meta?.dataGranularity)) throw new Error(`${sym}: granularidad ${r.meta?.dataGranularity} ≠ ${ok.join("/")}`);
  return r;
}
async function loadCache() {
  if (!REFRESH && fs.existsSync(CACHE)) {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    if (c.version === 2) return c;
  }
  const cache = { version: 2, fetchedAt: new Date().toISOString(), source: "Yahoo chart v8 (query1)", daily: {}, m60: {}, m5: {} };
  for (const s of DOWNLOAD_DAILY) {
    cache.daily[s] = parseDaily(await yahooChecked(s, "period1=0&period2=9999999999&interval=1d&events=div%7Csplit&includePrePost=false", "1d"));
    await sleep(250);
  }
  for (const s of DOWNLOAD_INTRADAY) {
    cache.m60[s] = parseIntraday(await yahooChecked(s, "range=730d&interval=60m&includePrePost=false", ["60m", "1h"])); await sleep(250);
    cache.m5[s] = parseIntraday(await yahooChecked(s, "range=60d&interval=5m&includePrePost=false", "5m")); await sleep(250);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  return cache;
}
const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// ─── Series diarias normalizadas {date,o,h,l,c,a,v} ───────────────────────────
function fromFrozen(frozen, sym) {
  const bars = frozen.series?.[sym]; if (!bars) return null;
  return bars.filter((b) => b.date < RUN_DATE && fin(b.close) !== null)
    .map((b) => ({ date: b.date, o: fin(b.open), h: fin(b.high), l: fin(b.low), c: b.close, a: fin(b.adj) ?? b.close, v: isNum(b.vol) ? b.vol : null }));
}
function fromCache(cache, sym) {
  const rows = cache.daily?.[sym]; if (!rows) return null;
  return rows.filter((r) => r[0] < RUN_DATE).map(([date, o, h, l, c, a, v]) => ({ date, o, h, l, c, a, v }));
}

/** Controles de calidad por símbolo (el fetch histórico rellenaba open=close si faltaba). */
function sanity(bars) {
  const byYear = {}; let miss = 0, eq = 0, hl = 0, gap = 0;
  for (let k = 0; k < bars.length; k++) {
    const b = bars[k]; const y = b.date.slice(0, 4);
    byYear[y] ??= { n: 0, openEqClose: 0, missingOpen: 0 };
    byYear[y].n++;
    if (b.o === null) { miss++; byYear[y].missingOpen++; }
    else if (b.o === b.c) { eq++; byYear[y].openEqClose++; }
    if (b.o !== null && b.h !== null && b.l !== null && (b.h < Math.max(b.o, b.c) * (1 - 1e-6) || b.l > Math.min(b.o, b.c) * (1 + 1e-6))) hl++;
    if (k > 0 && b.o !== null && Math.abs(b.o / bars[k - 1].c - 1) > 0.15) gap++;
  }
  const badYears = Object.entries(byYear).filter(([, s]) => (s.openEqClose + s.missingOpen) / s.n > 0.05).map(([y, s]) => `${y}:${s.openEqClose + s.missingOpen}/${s.n}`);
  return { n: bars.length, first: bars[0]?.date, last: bars.at(-1)?.date, missingOpen: miss, openEqClose: eq, openEqClosePct: pct(eq / bars.length, 2), hlViolations: hl, gapsOver15pct: gap, suspiciousYears: badYears };
}

/** Contraste frozen vs descarga fresca en las fechas comunes (retornos ajustados y apertura/cierre). */
function crossCheck(a, b) {
  const mb = new Map(b.map((x) => [x.date, x]));
  let n = 0, maxRet = 0, maxCod = 0, prev = null;
  for (const x of a) {
    const y = mb.get(x.date); if (!y) { prev = null; continue; }
    if (prev) {
      const ra = x.a / prev.x.a - 1, rb = y.a / prev.y.a - 1;
      maxRet = Math.max(maxRet, Math.abs(ra - rb));
    }
    if (x.o && y.o) maxCod = Math.max(maxCod, Math.abs((x.c / x.o) - (y.c / y.o)));
    n++; prev = { x, y };
  }
  return { commonDates: n, maxAbsDiffAdjReturnBps: bps(maxRet), maxAbsDiffCloseOverOpenBps: bps(maxCod) };
}

// ─── Panel: calendario común + matrices ───────────────────────────────────────
function buildPanel(syms, seriesOf, { from = null, to = null } = {}) {
  const maps = syms.map((s) => new Map(seriesOf[s].map((b) => [b.date, b])));
  let dates = [...maps[0].keys()];
  dates = dates.filter((d) => (!from || d >= from) && (!to || d <= to) && maps.every((m) => { const b = m.get(d); return b && b.o !== null && b.c > 0 && b.a > 0; }));
  dates.sort();
  const N = syms.length, T = dates.length;
  const mk = () => syms.map(() => new Float64Array(T).fill(NaN));
  const O = mk(), C = mk(), A = mk(), V = mk();
  for (let i = 0; i < N; i++) for (let t = 0; t < T; t++) {
    const b = maps[i].get(dates[t]); O[i][t] = b.o; C[i][t] = b.c; A[i][t] = b.a; V[i][t] = isNum(b.v) && b.v > 0 ? b.v : NaN;
  }
  return { syms, dates, N, T, O, C, A, V };
}
function addSignals(P) {
  const { N, T, O, C, A, V } = P;
  const mk = () => Array.from({ length: N }, () => new Float64Array(T).fill(NaN));
  P.cod = mk(); P.rvol = mk(); P.flow = mk(); P.mom4 = mk(); P.mom126 = mk();
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < T; t++) {
      P.cod[i][t] = C[i][t] / O[i][t] - 1;
      if (t >= 20) {
        let s = 0, k = 0; for (let q = t - 20; q < t; q++) if (isNum(V[i][q])) { s += V[i][q]; k++; }
        if (k >= 15 && isNum(V[i][t])) P.rvol[i][t] = V[i][t] / (s / k);
      }
      if (isNum(P.rvol[i][t])) P.flow[i][t] = Math.max(-100, Math.min(100, P.cod[i][t] * 100 * Math.sqrt(Math.min(P.rvol[i][t], RVOL_CAP)) * 10));
      if (t >= 4) P.mom4[i][t] = C[i][t] / C[i][t - 4] - 1;                  // réplica range=5d (cierre sin ajustar)
      if (t >= 126) P.mom126[i][t] = A[i][t] / A[i][t - 126] - 1;            // referencia, NO usada por el dashboard
    }
  }
  // Retornos futuros: desde el cierre de t y desde la apertura de t+1 (ajustada con el factor de la propia vela)
  P.fwd = {}; P.ex = {};
  for (const h of [...HORIZONS, 60]) {
    for (const entry of ["close", "open1"]) {
      const f = mk();
      for (let i = 0; i < N; i++) for (let t = 0; t + h < T; t++) {
        if (entry === "close") f[i][t] = A[i][t + h] / A[i][t] - 1;
        else { const aOpen = O[i][t + 1] * (A[i][t + 1] / C[i][t + 1]); f[i][t] = A[i][t + h] / aOpen - 1; }
      }
      const e = mk();
      for (let t = 0; t < T; t++) {
        let s = 0, k = 0; for (let i = 0; i < N; i++) if (isNum(f[i][t])) { s += f[i][t]; k++; }
        if (k === N) for (let i = 0; i < N; i++) e[i][t] = f[i][t] - s / k;
      }
      P.fwd[`${entry}_${h}`] = f; P.ex[`${entry}_${h}`] = e;
    }
  }
  return P;
}

// ─── Subperiodos ──────────────────────────────────────────────────────────────
function periodsFor(dates, cuts) {
  // cuts: [["2006-2010","2006-01-01","2010-12-31"], ...]
  return cuts.map(([label, a, b]) => ({ label, idx: dates.map((d, t) => (d >= a && d <= b ? t : -1)).filter((t) => t >= 0) }));
}

const r3 = (x) => (isNum(x) ? +x.toFixed(3) : null);
function seedOf(name) { let h = 2166136261; for (const ch of name) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h ^ SEED) >>> 0; }

// ─── Resumen de una serie diaria (cartera o diferencial) ──────────────────────
function summarize(xArr, h, dates, periods, unit = "bps") {
  const x = Array.from(xArr); const L = nwLag(h); const fmt = unit === "bps" ? bps : r3;
  const all = nwT(x, L); const fx = x.filter(isNum);
  const hit = fx.length ? fx.filter((v) => v > 0).length / fx.length : NaN;
  const no = nonOverlapT(x, h);
  const per = periods.map((p) => { const r = nwT(p.idx.map((t) => x[t]), L); return { label: p.label, mean: fmt(r.mean), tNW: r2(r.t), n: r.n }; });
  const byY = {}; x.forEach((v, t) => { if (isNum(v)) (byY[dates[t].slice(0, 4)] ??= []).push(v); });
  const ys = Object.values(byY).filter((a) => a.length >= 60).map(meanOf);
  const sg = Math.sign(all.mean);
  return { n: all.n, mean: fmt(all.mean), unit, hitPct: pct(hit), tNW: r2(all.t), nwLag: L, tNonOverlap: r2(no.t), nNonOverlap: no.n,
    yearsSameSign: `${ys.filter((m) => Math.sign(m) === sg).length}/${ys.length}`, periods: per };
}

// ─── Selectores (índices de sector elegidos en t con la información del cierre de t) ──
function rankAt(sig, t, N) {
  const v = []; for (let i = 0; i < N; i++) { if (!isNum(sig[i][t])) return null; v.push([sig[i][t], i]); }
  v.sort((a, b) => b[0] - a[0] || a[1] - b[1]); return v.map((p) => p[1]);
}
const selTop = (sig, k) => (P, t) => { const r = rankAt(P[sig], t, P.N); return r ? r.slice(0, k) : null; };
const selBot = (sig, k) => (P, t) => { const r = rankAt(P[sig], t, P.N); return r ? r.slice(-k) : null; };
const selLS = (sig, k) => (P, t) => { const r = rankAt(P[sig], t, P.N); return r ? { long: r.slice(0, k), short: r.slice(-k) } : null; };
const selSign = (sig) => (P, t) => {       // "Dinero Entrando" (>0) menos "Dinero Saliendo" (<0)
  const L = [], S = []; for (let i = 0; i < P.N; i++) { const v = P[sig][i][t]; if (!isNum(v)) return null; if (v > 0) L.push(i); else if (v < 0) S.push(i); }
  return L.length && S.length ? { long: L, short: S } : null;
};

function portTest(P, selector, periods, { horizons = HORIZONS, entries = ["close", "open1"] } = {}) {
  const out = {};
  for (const entry of entries) for (const h of horizons) {
    const key = `${entry}_${h}`; const ex = P.ex[key]; const x = new Array(P.T).fill(NaN);
    for (let t = 0; t < P.T; t++) {
      const S = selector(P, t); if (!S) continue;
      const avg = (ix) => { let s = 0; for (const i of ix) { if (!isNum(ex[i][t])) return NaN; s += ex[i][t]; } return s / ix.length; };
      x[t] = Array.isArray(S) ? avg(S) : avg(S.long) - avg(S.short);
    }
    out[key] = summarize(x, h, P.dates, periods);
  }
  return out;
}
function icTest(P, sig, periods, { horizons = HORIZONS, entries = ["close"] } = {}) {
  const out = {};
  for (const entry of entries) for (const h of horizons) {
    const key = `${entry}_${h}`; const ex = P.ex[key]; const x = new Array(P.T).fill(NaN);
    for (let t = 0; t < P.T; t++) {
      const a = [], b = []; let ok = true;
      for (let i = 0; i < P.N; i++) { if (!isNum(P[sig][i][t]) || !isNum(ex[i][t])) { ok = false; break; } a.push(P[sig][i][t]); b.push(ex[i][t]); }
      if (ok) x[t] = spearmanRho(a, b);
    }
    out[key] = summarize(x, h, P.dates, periods, "ic");
  }
  return out;
}
function turnover(P, selector) {
  let sum = 0, n = 0, prev = null;
  for (let t = 0; t < P.T; t++) {
    const S = selector(P, t); if (!Array.isArray(S)) { prev = null; continue; }
    if (prev) { sum += S.filter((i) => !prev.includes(i)).length / S.length; n++; }
    prev = S;
  }
  return n ? sum / n : NaN;
}

// ─── Comparación agrupada A vs B con bootstrap de bloques por FECHA ───────────
// Agrega por fecha (sumas y cuentas) → el remuestreo por bloques respeta la correlación
// entre sectores del mismo día y el solapamiento de ventanas (bloque ≥ 60 y ≥ 3h sesiones).
function newAgg(T) { return { sA: new Float64Array(T), nA: new Float64Array(T), pA: new Float64Array(T), sB: new Float64Array(T), nB: new Float64Array(T), pB: new Float64Array(T) }; }
function aggAdd(g, t, grp, v) { if (!isNum(v) || !grp) return; if (grp === "A") { g.sA[t] += v; g.nA[t]++; if (v > 0) g.pA[t]++; } else { g.sB[t] += v; g.nB[t]++; if (v > 0) g.pB[t]++; } }
function bootAgg(g, idx, h, name, reps = BOOT_REPS) {
  const T = idx.length; const B = Math.min(T, Math.max(60, 3 * h)); const nb = Math.ceil(T / B);
  const rng = mulberry32(seedOf(name));
  const aS = [], bS = [], dS = [];
  for (let r = 0; r < reps; r++) {
    let SA = 0, NA = 0, SB = 0, NB = 0;
    for (let k = 0; k < nb; k++) {
      const st = Math.floor(rng() * T);
      for (let j = 0; j < B; j++) { const t = idx[(st + j) % T]; SA += g.sA[t]; NA += g.nA[t]; SB += g.sB[t]; NB += g.nB[t]; }
    }
    const mA = NA ? SA / NA : NaN, mB = NB ? SB / NB : NaN; aS.push(mA); bS.push(mB); dS.push(mA - mB);
  }
  return { aS, bS, dS };
}
function pooledStats(g, h, dates, periods, name) {
  const all = dates.map((_, t) => t);
  const point = (idx) => {
    let SA = 0, NA = 0, SB = 0, NB = 0, PA = 0, PB = 0;
    for (const t of idx) { SA += g.sA[t]; NA += g.nA[t]; SB += g.sB[t]; NB += g.nB[t]; PA += g.pA[t]; PB += g.pB[t]; }
    return { NA, NB, mA: SA / NA, mB: SB / NB, hA: PA / NA, hB: PB / NB };
  };
  const q = (arr, p) => { const s = arr.filter(isNum).sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const b0 = point(all); const bs = bootAgg(g, all, h, name);
  const res = {
    nA: b0.NA, nB: b0.NB, shareA_pct: pct(b0.NA / (b0.NA + b0.NB)),
    meanA_bps: bps(b0.mA), zA: r2(b0.mA / sdSample(bs.aS)), hitA_pct: pct(b0.hA),
    meanB_bps: bps(b0.mB), zB: r2(b0.mB / sdSample(bs.bS)), hitB_pct: pct(b0.hB),
    diff_bps: bps(b0.mA - b0.mB), diffZ: r2((b0.mA - b0.mB) / sdSample(bs.dS)), diffCI95_bps: [bps(q(bs.dS, 0.025)), bps(q(bs.dS, 0.975))],
    periods: [],
  };
  for (const p of periods) {
    if (p.idx.length < 120) continue;
    const pp = point(p.idx); const pb = bootAgg(g, p.idx, h, `${name}|${p.label}`, 500);
    res.periods.push({ label: p.label, diff_bps: bps(pp.mA - pp.mB), diffZ: r2((pp.mA - pp.mB) / sdSample(pb.dS)), meanA_bps: bps(pp.mA), meanB_bps: bps(pp.mB), nA: pp.NA, nB: pp.NB });
  }
  return res;
}
function pooledPanel(P, classify, periods, name, { horizons = [...HORIZONS, 60], entries = ["close", "open1"], kinds = ["excess", "absolute"] } = {}) {
  const out = {};
  for (const kind of kinds) for (const entry of entries) for (const h of horizons) {
    const key = `${entry}_${h}`; const f = kind === "absolute" ? P.fwd[key] : P.ex[key];
    const g = newAgg(P.T);
    for (let t = 0; t < P.T; t++) for (let i = 0; i < P.N; i++) aggAdd(g, t, classify(P, i, t), f[i][t]);
    out[`${kind}|${key}`] = pooledStats(g, h, P.dates, periods, `${name}|${kind}|${key}`);
  }
  return out;
}

// ─── Test del gate a nivel ACCIÓN (candidatos tipo Rally: top-N por mom9m) ────
function loadUniverseFrozen() {
  const raw = JSON.parse(fs.readFileSync(UNIVERSE, "utf8"));
  const spy = raw.series["SPY.US"].bars; const cal = spy.map((b) => b.d); const calIdx = new Map(cal.map((d, i) => [d, i]));
  const D = cal.length; const tick = [];
  for (const [sym, obj] of Object.entries(raw.series)) {
    if (sym === "SPY.US") continue;
    const bars = obj.bars; if (!bars || bars.length < 300) continue;         // mismo corte que rally-study-lib
    const adj = new Float64Array(D).fill(NaN), m9 = new Float64Array(D).fill(NaN);
    for (let i = 0; i < bars.length; i++) {
      const k = calIdx.get(bars[i].d); if (k === undefined) continue;
      adj[k] = bars[i].a;
      if (i >= 200 && bars[i - 189].a > 0) m9[k] = bars[i].a / bars[i - 189].a - 1;   // sesiones PROPIAS, ajustado (convención de producción)
    }
    const base = sym.replace(/\.US$/, ""); const isUS = sym.endsWith(".US");
    tick.push({ sym, base, sector: isUS ? STOCK_SECTOR[base] ?? null : null, adj, m9 });
  }
  return { cal, D, tick, spyAdj: Float64Array.from(spy.map((b) => b.a)), fetchedAt: raw.fetchedAt, nTickers: tick.length };
}
function stockGateTest(U, F, periodsCuts) {
  const fIdx = new Map(F.dates.map((d, t) => [d, t]));
  const etfI = Object.fromEntries(F.syms.map((s, i) => [s, i]));
  const days = []; for (let k = 0; k < U.D; k++) if (fIdx.has(U.cal[k])) days.push(k);
  const T = U.D; const HZ = [1, 5, 20, 60];
  const res = { sample: `${U.cal[days[0]]} → ${U.cal[days.at(-1)]}`, universeTickers: U.nTickers, mappedInUniverse: U.tick.filter((x) => x.sector).length };
  const periods = periodsFor(U.cal, periodsCuts);
  for (const topN of [10, 30]) {
    const aggs = {}; for (const kind of ["stockAbs", "stockVsSPY", "sectorEtfAbs"]) for (const h of HZ) aggs[`${kind}|${h}`] = newAgg(T);
    let candDays = 0, mappedCandDays = 0, passDays = 0; const inTop = new Map(); const events = []; let prevK = null;
    for (const k of days) {
      const list = U.tick.filter((x) => isNum(x.m9[k]) && isNum(x.adj[k])).sort((a, b) => b.m9[k] - a.m9[k]).slice(0, topN);
      const t = fIdx.get(U.cal[k]);
      const kPrev = prevK; prevK = k;
      for (const c of list) {
        candDays++;
        const wasIn = kPrev !== null && inTop.get(c.sym) === kPrev; inTop.set(c.sym, k);
        if (!c.sector) continue;
        mappedCandDays++;
        const ei = etfI[KEY_ETF[c.sector]]; const cod = F.cod[ei][t];
        const grp = cod * 100 > FLOW_THRESHOLD_CLOSED ? "A" : "B"; if (grp === "A") passDays++;
        for (const h of HZ) {
          if (k + h >= U.D) continue;
          const fStock = c.adj[k + h] / c.adj[k] - 1;           // NaN si el valor no cotiza en k+h → se ignora
          const spyF = U.spyAdj[k + h] / U.spyAdj[k] - 1;
          aggAdd(aggs[`stockAbs|${h}`], k, grp, fStock);
          aggAdd(aggs[`stockVsSPY|${h}`], k, grp, fStock - spyF);
          if (t + h < F.T) aggAdd(aggs[`sectorEtfAbs|${h}`], k, grp, F.A[ei][t + h] / F.A[ei][t] - 1);
        }
        // Coste de ESPERAR a que el gate pase (entrada nueva en el top-N): ln(P_s/P_t), s = 1er día con sector > 0,2 %
        if (topN === 10 && !wasIn && kPrev !== null) {
          let s = null; for (let j = 0; j <= 20; j++) { const kk = k + j; if (kk >= U.D) break; const tt = fIdx.get(U.cal[kk]); if (tt === undefined) break; if (F.cod[ei][tt] * 100 > FLOW_THRESHOLD_CLOSED) { s = kk; break; } }
          if (s !== null && isNum(c.adj[s]) && isNum(c.adj[k])) events.push({ wait: s - k, cost: Math.log(c.adj[s] / c.adj[k]), date: U.cal[k] });
          else events.push({ wait: null, cost: NaN, date: U.cal[k] });
        }
      }
    }
    const block = { candidateDays: candDays, mappedCandidateDays: mappedCandDays, mappedShare_pct: pct(mappedCandDays / candDays), passShare_pct: pct(passDays / mappedCandDays), tests: {} };
    for (const [key, g] of Object.entries(aggs)) { const h = +key.split("|")[1]; block.tests[key] = pooledStats(g, h, U.cal, periods, `stockgate|top${topN}|${key}`); }
    if (topN === 10) {
      const ok = events.filter((e) => e.wait !== null); const costs = ok.map((e) => e.cost); const waited = ok.filter((e) => e.wait > 0);
      const sorted = [...costs].sort((a, b) => a - b);
      block.waitCost = {
        entryEvents: events.length, gatePassedWithin20: ok.length, passSameDay_pct: pct(ok.filter((e) => e.wait === 0).length / events.length),
        meanWaitSessions: r2(meanOf(ok.map((e) => e.wait))), meanCost_bps: bps(meanOf(costs)), medianCost_bps: bps(sorted[Math.floor(sorted.length / 2)]),
        tSimple: r2(meanOf(costs) / (sdSample(costs) / Math.sqrt(costs.length))),
        whenWaited: { n: waited.length, meanCost_bps: bps(meanOf(waited.map((e) => e.cost))), paidMore_pct: pct(waited.filter((e) => e.cost > 0).length / waited.length) },
        note: "coste = ln(precio el día en que el sector pasa > 0,2 % / precio el día en que el valor entra en el top-10); positivo = el gate hace comprar MÁS caro",
      };
    }
    res[`top${topN}`] = block;
  }
  return res;
}

// ─── "Mejor acción del sector hoy" (topMover del panel, vs cierre anterior) ────
// Réplica: de los 6 holdings de FLOW_SECTORS se elige el de MAYOR variación vs cierre anterior.
// ¿Bate a sus pares (media equiponderada de los holdings disponibles) en 1/5/20 sesiones?
const FLOW_HOLDINGS = { defense: "LMT RTX NOC GD LHX HII", utilities: "NEE SO DUK AEP SRE EXC", staples: "PG KO PEP COST WMT CL",
  gold: "NEM GOLD FCX AEM WPM FNV", healthcare: "UNH LLY JNJ ABBV MRK TMO", semis: "NVDA AMD INTC QCOM AVGO TXN",
  software: "MSFT ORCL CRM NOW INTU ADBE", banks: "JPM BAC WFC C GS MS", energy: "XOM CVX COP EOG SLB MPC", tech: "AAPL MSFT NVDA AVGO ORCL ACN" };
function topMoverTest(U) {
  const bySym = new Map(U.tick.map((x) => [x.sym, x]));
  const coverage = {}; const sectors = [];
  for (const [k, list] of Object.entries(FLOW_HOLDINGS)) {
    const hs = list.split(" "); const got = hs.filter((h) => bySym.has(`${h}.US`));
    coverage[k] = { inUniverse: got.length, missing: hs.filter((h) => !got.includes(h)) };
    sectors.push({ k, ticks: got.map((h) => bySym.get(`${h}.US`)) });
  }
  const periods = periodsFor(U.cal, [["2016-2021", "2016-01-01", "2021-12-31"], ["2022-2026", "2022-01-01", "2026-12-31"]]);
  const out = { coverage, rule: "pick = holding con mayor variación cierre/cierre anterior del día t; exceso vs media equiponderada de los holdings del sector; ≥4 holdings con dato y ≥8 sectores por día", tests: {} };
  for (const h of HORIZONS) {
    const best = new Array(U.D).fill(NaN), worst = new Array(U.D).fill(NaN);
    for (let k = 1; k + h < U.D; k++) {
      let sB = 0, sW = 0, n = 0;
      for (const sec of sectors) {
        const v = sec.ticks.filter((tk) => isNum(tk.adj[k]) && isNum(tk.adj[k - 1]) && isNum(tk.adj[k + h]));
        if (v.length < 4) continue;
        const chg = v.map((tk) => tk.adj[k] / tk.adj[k - 1] - 1); const fw = v.map((tk) => tk.adj[k + h] / tk.adj[k] - 1); const ew = meanOf(fw);
        let b = 0, w = 0; for (let j = 1; j < v.length; j++) { if (chg[j] > chg[b]) b = j; if (chg[j] < chg[w]) w = j; }
        sB += fw[b] - ew; sW += fw[w] - ew; n++;
      }
      if (n >= 8) { best[k] = sB / n; worst[k] = sW / n; }
    }
    out.tests[`topMover_vs_peers|close_${h}`] = summarize(best, h, U.cal, periods);
    out.tests[`worstMover_vs_peers|close_${h}`] = summarize(worst, h, U.cal, periods);
  }
  return out;
}

// ─── Multiplicidad: cuántas pruebas y cuántas "significativas" por azar ────────
function multiplicity(res) {
  const ts = [];
  const walk = (o, path) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return;                                   // 'periods' (subperiodos) no cuentan
    if (isNum(o.tNW) && "mean" in o && "hitPct" in o) ts.push([path, o.tNW]);
    if (isNum(o.diffZ) && "diff_bps" in o && "nA" in o) ts.push([path, o.diffZ]);
    for (const [k, v] of Object.entries(o)) walk(v, `${path}/${k}`);
  };
  walk(res, "");
  const abs = ts.map(([, t]) => Math.abs(t));
  return { tests: ts.length, absT_ge2: abs.filter((a) => a >= 2).length, absT_ge3: abs.filter((a) => a >= 3).length, expectedByChanceAt2: Math.round(ts.length * 0.0455),
    note: "cuenta cada estadístico de muestra completa (sin subperiodos ni controles); las pruebas NO son independientes (mismos datos, horizontes solapados)",
    absT_ge3_list: ts.filter(([, t]) => Math.abs(t) >= 3).map(([p, t]) => `${p} ${t}`) };
}

// ─── Test intradía REAL con velas de 60 min (~730 sesiones) ───────────────────
function hourlyTest(cache, daily, dailyPanel) {
  const BARS = ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"];
  const syms = FLOW_ETFS; const N = syms.length;
  const hmap = syms.map((s) => { const m = new Map(); for (const [d, hm, , , , c] of cache.m60[s]) { if (d >= RUN_DATE || !isNum(c)) continue; (m.get(d) ?? m.set(d, {}).get(d))[hm] = c; } return m; });
  const dmap = syms.map((s) => new Map(daily[s].map((b) => [b.date, b])));
  const dates = [...hmap[0].keys()].filter((d) => syms.every((_, i) => { const x = hmap[i].get(d); const b = dmap[i].get(d); return x && b && b.o && BARS.every((hm) => isNum(x[hm])); })).sort();
  const T = dates.length; const pIdx = new Map(dailyPanel.dates.map((d, t) => [d, t]));
  const out = { sample: `${dates[0]} → ${dates.at(-1)}`, sessions: T, excludedHalfDaysOrGaps: hmap[0].size - T, snapshots: {} };
  const periods = periodsFor(dates, [["2023-2024", "2023-01-01", "2024-12-31"], ["2025-2026", "2025-01-01", "2026-12-31"]]);
  for (const [label, barStart] of [["10:30 ET (15:30 Canarias)", "09:30"], ["12:30 ET (17:30 Canarias)", "11:30"], ["14:30 ET (19:30 Canarias)", "13:30"]]) {
    const P = { N, T, dates, syms, sig: [], ex: {}, fwd: {} };
    P.sig = syms.map((_, i) => Float64Array.from(dates, (d) => hmap[i].get(d)[barStart] / dmap[i].get(d).o - 1));
    const rod = syms.map((_, i) => Float64Array.from(dates, (d) => dmap[i].get(d).c / hmap[i].get(d)[barStart] - 1));
    const cod = syms.map((_, i) => Float64Array.from(dates, (d) => dmap[i].get(d).c / dmap[i].get(d).o - 1));
    const exOf = (f) => { const e = syms.map(() => new Float64Array(T).fill(NaN)); for (let t = 0; t < T; t++) { let s = 0, k = 0; for (let i = 0; i < N; i++) if (isNum(f[i][t])) { s += f[i][t]; k++; } if (k === N) for (let i = 0; i < N; i++) e[i][t] = f[i][t] - s / N; } return e; };
    P.fwd.rod_0 = rod; P.ex.rod_0 = exOf(rod);
    for (const h of [1, 5]) {         // desde el cierre de la sesión de la señal (panel diario)
      const f = syms.map(() => new Float64Array(T).fill(NaN));
      for (let t = 0; t < T; t++) { const pt = pIdx.get(dates[t]); if (pt === undefined) continue; for (let i = 0; i < N; i++) { const pi = dailyPanel.syms.indexOf(syms[i]); f[i][t] = dailyPanel.fwd[`close_${h}`][pi][pt]; } }
      P.fwd[`close_${h}`] = f; P.ex[`close_${h}`] = exOf(f);
    }
    // persistencia: ¿el "Dinero Entrando" de las 10:30 sigue entrando al cierre?
    let rhoS = 0, rhoN = 0, signSame = 0, signN = 0, top3InTop3 = 0;
    for (let t = 0; t < T; t++) {
      const a = syms.map((_, i) => P.sig[i][t]), b = syms.map((_, i) => cod[i][t]);
      const rho = spearmanRho(a, b); if (isNum(rho)) { rhoS += rho; rhoN++; }
      for (let i = 0; i < N; i++) if (a[i] !== 0 && b[i] !== 0) { signN++; if (Math.sign(a[i]) === Math.sign(b[i])) signSame++; }
      const ra = rankAt(P.sig, t, N).slice(0, 3); const rb = rankAt(cod, t, N).slice(0, 3); top3InTop3 += ra.filter((i) => rb.includes(i)).length / 3;
    }
    const tests = {};
    const hz = { rod: { key: "rod_0", h: 1 }, c1: { key: "close_1", h: 1 }, c5: { key: "close_5", h: 5 } };
    for (const [nm, sel] of [["top3", selTop("sig", 3)], ["LS_top3_bottom3", selLS("sig", 3)], ["Entrando_menos_Saliendo", selSign("sig")]]) {
      tests[nm] = {};
      for (const [hn, { key, h }] of Object.entries(hz)) {
        const x = new Array(T).fill(NaN);
        for (let t = 0; t < T; t++) { const S = sel(P, t); if (!S) continue; const avg = (ix) => { let s = 0; for (const i of ix) { if (!isNum(P.ex[key][i][t])) return NaN; s += P.ex[key][i][t]; } return s / ix.length; }; x[t] = Array.isArray(S) ? avg(S) : avg(S.long) - avg(S.short); }
        tests[nm][hn] = summarize(x, h, dates, periods);
      }
    }
    const gate = {};
    for (const [hn, { key, h }] of Object.entries(hz)) for (const kind of ["absolute", "excess"]) {
      const f = kind === "absolute" ? P.fwd[key] : P.ex[key]; const g = newAgg(T);
      for (let t = 0; t < T; t++) for (let i = 0; i < N; i++) aggAdd(g, t, P.sig[i][t] * 100 > FLOW_THRESHOLD_OPEN ? "A" : "B", f[i][t]);
      gate[`${kind}|${hn}`] = pooledStats(g, h, dates, periods, `hourgate|${label}|${kind}|${hn}`);
    }
    out.snapshots[label] = {
      persistence: { meanSpearmanVsCloseRanking: r3(rhoS / rhoN), sameSignAtClose_pct: pct(signSame / signN), top3StillTop3AtClose_pct: pct(top3InTop3 / T) },
      tests, gateOpenThreshold03: gate,
    };
  }
  out.legend = "rod = resto de la sesión (del snapshot al cierre); c1/c5 = 1 y 5 sesiones desde el cierre del día de la señal; exceso vs cesta equiponderada de los 10 ETFs";
  return out;
}

// ─── Fidelidad del proxy: réplica exacta del cálculo de producción con velas de 5 min ──
function fidelity5m(cache, daily, dailyPanel) {
  const syms = FLOW_ETFS; const out = { perTime: {}, perEtf: {} };
  const pIdx = new Map(dailyPanel.dates.map((d, t) => [d, t]));
  const rvolAt = (vols, lastIdx) => {        // idéntico a fetchIntraday5min
    const recent = vols.slice(Math.max(0, lastIdx - 2), lastIdx + 1).filter((v) => v > 0);
    const early = vols.slice(0, Math.max(1, lastIdx - 2)).filter((v) => v > 0);
    const rA = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const eA = early.length ? early.reduce((a, b) => a + b, 0) / early.length : rA;
    return eA > 0 && rA > 0 ? rA / eA : null;
  };
  const times = { "10:15": 9, "12:00": 30, "15:00": 66, "15:55 (cierre)": 77 };
  const rv = Object.fromEntries(Object.keys(times).map((k) => [k, []]));
  const diffs = [], pairsChg = [], pairsRvol = []; const byDay = new Map(); let sessions = 0;
  for (const s of syms) {
    const m = new Map(); for (const row of cache.m5[s]) { if (row[0] >= RUN_DATE) continue; (m.get(row[0]) ?? m.set(row[0], []).get(row[0])).push(row); }
    const dm = new Map(daily[s].map((b) => [b.date, b])); const pi = dailyPanel.syms.indexOf(s);
    let n = 0, sumAbs = 0, maxAbs = 0;
    for (const [d, rows] of m) {
      if (rows.length !== 78) continue; const b = dm.get(d); if (!b || !b.o) continue;
      const vols = rows.map((r) => r[6] ?? 0); const closes = rows.map((r) => r[5]);
      if (!isNum(closes[77])) continue;
      const prodChg = closes[77] / b.o - 1; const cod = b.c / b.o - 1; const df = prodChg - cod;
      diffs.push(Math.abs(df)); sumAbs += Math.abs(df); maxAbs = Math.max(maxAbs, Math.abs(df)); n++;
      pairsChg.push([prodChg, cod]);
      for (const [lab, idx] of Object.entries(times)) { const r = rvolAt(vols, idx); if (r !== null) rv[lab].push(r); }
      const pt = pIdx.get(d); const rClose = rvolAt(vols, 77);
      if (pt !== undefined && isNum(dailyPanel.rvol[pi][pt]) && rClose !== null) pairsRvol.push([rClose, dailyPanel.rvol[pi][pt]]);
      const dayRow = byDay.get(d) ?? byDay.set(d, {}).get(d);
      dayRow[s] = { prodFlow: rClose !== null ? prodChg * 100 * Math.sqrt(Math.min(rClose, RVOL_CAP)) * 10 : NaN, proxyFlow: pt !== undefined ? dailyPanel.flow[pi][pt] : NaN, prodChg, cod };
    }
    sessions = Math.max(sessions, n);
    out.perEtf[s] = { sessions: n, meanAbsDiff_bps: bps(sumAbs / n), maxAbsDiff_bps: bps(maxAbs) };
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  for (const [lab, arr] of Object.entries(rv)) out.perTime[lab] = { n: arr.length, median: r2(q(arr, 0.5)), p10: r2(q(arr, 0.1)), p90: r2(q(arr, 0.9)), cappedAt5_pct: pct(arr.filter((v) => v >= RVOL_CAP).length / arr.length), above1_pct: pct(arr.filter((v) => v > 1).length / arr.length) };
  let rhoRank = 0, rhoN = 0, top1Same = 0, signFlip = 0, signN = 0;
  for (const row of byDay.values()) {
    const ks = syms.filter((s) => row[s] && isNum(row[s].prodFlow) && isNum(row[s].proxyFlow)); if (ks.length !== syms.length) continue;
    const rho = spearmanRho(ks.map((s) => row[s].prodFlow), ks.map((s) => row[s].proxyFlow)); if (isNum(rho)) { rhoRank += rho; rhoN++; }
    const best = (f) => ks.reduce((a, s) => (row[s][f] > row[a][f] ? s : a), ks[0]); if (best("prodFlow") === best("proxyFlow")) top1Same++;
    for (const s of ks) { signN++; if (Math.sign(row[s].prodChg) !== Math.sign(row[s].cod)) signFlip++; }
  }
  out.sessions = sessions;
  out.changeProdVsDailyProxy = { meanAbsDiff_bps: bps(meanOf(diffs)), p95AbsDiff_bps: bps(q(diffs, 0.95)), spearman: r3(spearmanRho(pairsChg.map((p) => p[0]), pairsChg.map((p) => p[1]))), signFlips_pct: pct(signFlip / signN) };
  out.flowScoreRankProdVsProxy = { days: rhoN, meanSpearman: r3(rhoRank / rhoN), sameRank1_pct: pct(top1Same / rhoN) };
  out.rvolProdAtCloseVsDailyRvol = { n: pairsRvol.length, spearman: r3(spearmanRho(pairsRvol.map((p) => p[0]), pairsRvol.map((p) => p[1]))) };
  out.note = "rvol de producción = media de las 3 últimas velas de 5 min / media de las anteriores de la sesión: depende de la HORA, no de si hay volumen anómalo";
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  const frozen = JSON.parse(fs.readFileSync(FROZEN, "utf8"));
  const cache = await loadCache();
  const daily = {}; const provenance = {};
  for (const s of DOWNLOAD_DAILY) {
    const fz = fromFrozen(frozen, s); const fr = fromCache(cache, s);
    daily[s] = fr;           // serie fresca (verificada idéntica a la congelada en todas las fechas comunes)
    provenance[s] = { source: fz ? "Yahoo " + cache.fetchedAt + " (= frozen en fechas comunes)" : "Yahoo " + cache.fetchedAt + " (no está en el frozen)", ...sanity(fr), crossCheckVsFrozen: fz ? crossCheck(fz, fr) : null };
  }
  const xc = Object.values(provenance).filter((p) => p.crossCheckVsFrozen);
  if (xc.some((p) => p.crossCheckVsFrozen.maxAbsDiffAdjReturnBps > 0.5 || p.crossCheckVsFrozen.maxAbsDiffCloseOverOpenBps > 0.5)) throw new Error("La descarga fresca NO coincide con el frozen — revisar antes de seguir");

  const CUTS_FLOWS = [["2006-2010", "2006-01-01", "2010-12-31"], ["2011-2015", "2011-01-01", "2015-12-31"], ["2016-2020", "2016-01-01", "2020-12-31"], ["2021-2026", "2021-01-01", "2026-12-31"], ["TRAIN ≤2021", "2006-01-01", "2021-12-31"], ["CONFIRM 2022-26", "2022-01-01", "2026-12-31"]];
  const CUTS_LONG = [["1999-2005", "1999-01-01", "2005-12-31"], ["2006-2012", "2006-01-01", "2012-12-31"], ["2013-2019", "2013-01-01", "2019-12-31"], ["2020-2026", "2020-01-01", "2026-12-31"]];
  const CUTS_EOD9 = [["2018-2021", "2018-01-01", "2021-12-31"], ["2022-2026", "2022-01-01", "2026-12-31"]];

  // ── Paneles ──
  const F = addSignals(buildPanel(FLOW_ETFS, daily));
  const O9 = addSignals(buildPanel(SPDR_ORIG9, daily));
  const E9 = addSignals(buildPanel(EOD_ETFS, daily));
  const E7 = addSignals(buildPanel(EOD_LEGACY, daily));
  const SPY1 = addSignals(buildPanel(["SPY"], daily, { from: F.dates[0] }));
  const pF = periodsFor(F.dates, CUTS_FLOWS), pO9 = periodsFor(O9.dates, CUTS_LONG), pE9 = periodsFor(E9.dates, CUTS_EOD9), pE7 = periodsFor(E7.dates, CUTS_LONG);
  for (const P of [F, O9, E9, E7]) {           // control: el exceso medio transversal es 0 por construcción
    let mx = 0; for (let t = 0; t < P.T; t++) { let s = 0, k = 0; for (let i = 0; i < P.N; i++) if (isNum(P.ex.close_1[i][t])) { s += P.ex.close_1[i][t]; k++; } if (k) mx = Math.max(mx, Math.abs(s / k)); }
    if (mx > 1e-12) throw new Error("exceso transversal ≠ 0");
  }
  console.log(`paneles: F ${F.dates[0]}→${F.dates.at(-1)} (${F.T}) · O9 ${O9.T} · E9 ${E9.dates[0]} (${E9.T}) · E7 ${E7.T}`);

  // ── Controles del arnés ──
  const lead = (P, sig) => P[sig].map((row) => Float64Array.from(row, (_, t) => (t + 1 < P.T ? row[t + 1] : NaN)));
  F.codLead = lead(F, "cod");
  const rngP = mulberry32(seedOf("placebo"));
  const placeboSel = (P, t) => { const idx = [...Array(P.N).keys()]; for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rngP() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.slice(0, 3); };
  const controls = {
    positiveLeak_top3_by_codOfTomorrow: portTest(F, selTop("codLead", 3), pF, { horizons: [1], entries: ["close"] }),
    placebo_random3: portTest(F, placeboSel, pF, { horizons: [1, 5, 20], entries: ["close"] }),
  };

  // ── A) Flujos de Capital (10 ETFs de producción) ──
  const flows = {
    universe: FLOW_ETFS, sample: `${F.dates[0]} → ${F.dates.at(-1)}`, sessions: F.T,
    signals: {
      rank1_flowScore: portTest(F, selTop("flow", 1), pF),
      top3_flowScore: portTest(F, selTop("flow", 3), pF),
      bottom3_flowScore: portTest(F, selBot("flow", 3), pF),
      LS_top3_bottom3_flowScore: portTest(F, selLS("flow", 3), pF),
      top3_cod: portTest(F, selTop("cod", 3), pF),
      LS_top3_bottom3_cod: portTest(F, selLS("cod", 3), pF),
      Entrando_menos_Saliendo: portTest(F, selSign("cod"), pF),
      IC_cod: icTest(F, "cod", pF, { entries: ["close", "open1"] }),
      IC_flowScore: icTest(F, "flow", pF, { entries: ["close", "open1"] }),
    },
    turnoverTop3_flowScore_perDay: r3(turnover(F, selTop("flow", 3))),
    buckets: {
      Entrando_vs_Saliendo: pooledPanel(F, (P, i, t) => (P.cod[i][t] > 0 ? "A" : P.cod[i][t] < 0 ? "B" : null), pF, "bucket-sign", { horizons: HORIZONS }),
    },
    robustness_SPDR9_1999: {
      universe: SPDR_ORIG9, sample: `${O9.dates[0]} → ${O9.dates.at(-1)}`,
      top3_flowScore: portTest(O9, selTop("flow", 3), pO9, { entries: ["close"] }),
      LS_top3_bottom3_cod: portTest(O9, selLS("cod", 3), pO9, { entries: ["close"] }),
      IC_cod: icTest(O9, "cod", pO9),
    },
  };
  console.log("flows ok", (Date.now() - t0) / 1000);

  // ── B) Volumen relativo diario (proxy del "Vol x") ──
  const rvolRes = {
    definition: "rvol diario = volumen de la sesión / media de las 20 sesiones previas (proxy estándar; el de producción es intradía y depende de la hora — ver proxyFidelity)",
    spikeShare_pct: { ge1_5: pct(countWhere(F, (i, t) => F.rvol[i][t] >= 1.5) / countWhere(F, (i, t) => isNum(F.rvol[i][t]))), ge2: pct(countWhere(F, (i, t) => F.rvol[i][t] >= 2) / countWhere(F, (i, t) => isNum(F.rvol[i][t]))) },
    upDay_rvolGE2_vs_rest: pooledPanel(F, (P, i, t) => (isNum(P.rvol[i][t]) && P.cod[i][t] > 0 ? (P.rvol[i][t] >= 2 ? "A" : "B") : null), pF, "rvol-up", { horizons: HORIZONS, entries: ["close"] }),
    downDay_rvolGE2_vs_rest: pooledPanel(F, (P, i, t) => (isNum(P.rvol[i][t]) && P.cod[i][t] < 0 ? (P.rvol[i][t] >= 2 ? "A" : "B") : null), pF, "rvol-down", { horizons: HORIZONS, entries: ["close"] }),
    anyDay_rvolGE2_vs_rest: pooledPanel(F, (P, i, t) => (isNum(P.rvol[i][t]) ? (P.rvol[i][t] >= 2 ? "A" : "B") : null), pF, "rvol-any", { horizons: HORIZONS, entries: ["close"] }),
    top3_rvol: portTest(F, selTop("rvol", 3), pF, { entries: ["close"] }),
  };
  console.log("rvol ok", (Date.now() - t0) / 1000);

  // ── C) Ranking EOD (range=5d → 4 sesiones) + estados ──
  const stateOf = (v) => (v * 100 > 2 ? "LEADING" : v * 100 > 0 ? "ACCELERATING" : v * 100 > -2 ? "WEAKENING" : "FALLING");
  const eodBlock = (P, periods, tag) => ({
    universe: P.syms, sample: `${P.dates[0]} → ${P.dates.at(-1)}`, sessions: P.T,
    top3_mom4: portTest(P, selTop("mom4", 3), periods, { entries: ["close"] }),
    LS_top3_bottom3_mom4: portTest(P, selLS("mom4", 3), periods, { entries: ["close"] }),
    IC_mom4: icTest(P, "mom4", periods),
    LEADING_vs_rest: pooledPanel(P, (Q, i, t) => (isNum(Q.mom4[i][t]) ? (stateOf(Q.mom4[i][t]) === "LEADING" ? "A" : "B") : null), periods, `${tag}-lead`, { horizons: HORIZONS, entries: ["close"], kinds: ["excess"] }),
    FALLING_vs_rest: pooledPanel(P, (Q, i, t) => (isNum(Q.mom4[i][t]) ? (stateOf(Q.mom4[i][t]) === "FALLING" ? "A" : "B") : null), periods, `${tag}-fall`, { horizons: HORIZONS, entries: ["close"], kinds: ["excess"] }),
    reference_top3_mom126_NOT_USED_BY_DASHBOARD: portTest(P, selTop("mom126", 3), periods, { entries: ["close"] }),
  });
  const eod = { production9: eodBlock(E9, pE9, "e9"), legacy7_1999: eodBlock(E7, pE7, "e7"), flows10_reference_mom126: portTest(F, selTop("mom126", 3), pF, { entries: ["close"] }) };
  console.log("eod ok", (Date.now() - t0) / 1000);

  // ── D) Gate del filtro 4 ──
  const gate = {
    rule: "pasa si chg% del ETF del sector > 0,2 (mercado cerrado = vela diaria) — variante 0,3 (umbral con mercado abierto aplicado a la sesión completa)",
    sectorLevel_thr02: pooledPanel(F, (P, i, t) => (P.cod[i][t] * 100 > FLOW_THRESHOLD_CLOSED ? "A" : "B"), pF, "gate02"),
    sectorLevel_thr03: pooledPanel(F, (P, i, t) => (P.cod[i][t] * 100 > FLOW_THRESHOLD_OPEN ? "A" : "B"), pF, "gate03", { entries: ["close"] }),
    passRateBySector_pct: Object.fromEntries(F.syms.map((s, i) => [s, pct(countWhere(F, (ii, t) => ii === i && F.cod[i][t] * 100 > FLOW_THRESHOLD_CLOSED) / F.T)])),
    perSector_absolute_close_20: Object.fromEntries(F.syms.map((s, i) => [s, pooledPanel(F, (P, ii, t) => (ii === i ? (P.cod[i][t] * 100 > FLOW_THRESHOLD_CLOSED ? "A" : "B") : null), [], `gate-sec-${s}`, { horizons: [20], entries: ["close"], kinds: ["absolute"] })["absolute|close_20"]]).map(([s, r]) => [s, { diff_bps: r.diff_bps, diffZ: r.diffZ, meanPass_bps: r.meanA_bps, meanFail_bps: r.meanB_bps }])),
    spyTimeSeries_thr02: pooledPanel(SPY1, (P, i, t) => (P.cod[i][t] * 100 > FLOW_THRESHOLD_CLOSED ? "A" : "B"), [], "gate-spy", { kinds: ["absolute"], entries: ["close"] }),
    stockLevel: null,
  };
  const U = loadUniverseFrozen();
  gate.stockLevel = stockGateTest(U, F, [["2017-2021", "2016-01-01", "2021-12-31"], ["2022-2026", "2022-01-01", "2026-12-31"]]);
  gate.stockLevel.universeFetchedAt = U.fetchedAt;
  flows.topMover = topMoverTest(U);
  console.log("gate ok", (Date.now() - t0) / 1000);

  // ── E) Intradía real (60 min) y fidelidad del proxy (5 min) ──
  const hourly = hourlyTest(cache, daily, F);
  const fidelity = fidelity5m(cache, daily, F);
  console.log("intraday ok", (Date.now() - t0) / 1000);

  const out = {
    study: "sector-flows-2026-09-25", generatedAt: new Date().toISOString(), script: "scripts/backtest-sector-flows.mjs",
    question: "¿Tienen valor predictivo lo que muestran Flujos de Capital (IntraDayFlowsPanel), el ranking sectorial EOD y el filtro 4 de OptimalSignalPanel?",
    productionReplica: {
      flowsEndpoint: "GET /api/sector-leaders-data?mode=intraday", flowEtfs: FLOW_ETFS,
      intradayChange: "último/apertura − 1 (abierto: open_to_last; cerrado: close_vs_open de la última sesión) — nunca vs cierre anterior",
      relativeVolume: "media 3 últimas velas 5m / media de las anteriores de la sesión, tope 5", flowScore: "clamp(chg%·√rvol·10, ±100) → rank #1..#10",
      ui: "chg>0 → ▲ Dinero Entrando · chg<0 → ▼ Dinero Saliendo · mejor acción del sector vs cierre anterior con ✓ INVERTIBLE / S&P500",
      eodEndpoint: "GET /api/sector-leaders-data (sin mode): 9 SPDR, performance5d = 4 sesiones, LEADING>2/ACCELERATING>0/WEAKENING>−2/FALLING — sin consumidor en el frontend",
      filter4: "OptimalSignalPanel.tsx: pasa si intradayChange del ETF del sector > 0,3 (abierto) / 0,2 (cerrado); sin mapear → pasa. Señal Óptima NO se renderiza (desactivada 24-jul-2026)",
    },
    data: { provenance, frozenSp500History: { path: FROZEN, sha256: sha256File(FROZEN), fetchedAt: frozen.fetchedAt }, universe: { path: UNIVERSE, sha256: sha256File(UNIVERSE) }, cache: { path: CACHE, fetchedAt: cache.fetchedAt, sha256: sha256File(CACHE) }, runDateExcluded: RUN_DATE,
      trap: "range=max&interval=1d de Yahoo devuelve velas MENSUALES (dataGranularity 1mo) — usar period1/period2" },
    conventions: { signal: "cierre de t", returns: "cierres ajustados; entrada en el cierre de t (close_h) o en la apertura de t+1 (open1_h)", excess: "vs cesta equiponderada de los mismos ETFs", tStat: "Newey-West lag max(5,2h) + t no solapada; agrupados: bootstrap de bloques por fecha (≥60 sesiones, 2000 réplicas, semilla fija)", units: "bps = puntos básicos por ventana de h sesiones" },
    controls, flows, rvol: rvolRes, eod, gate, intradayHourly: hourly, proxyFidelity: fidelity,
    runtimeSec: +((Date.now() - t0) / 1000).toFixed(1),
  };
  out.multiplicity = multiplicity({ flows, rvol: rvolRes, eod, gate, intradayHourly: hourly });

  // ── Titulares (sacados de los resultados, no tecleados) ──
  const mt = (o) => `${o.mean} (t ${o.tNW})`;
  const pz = (o) => `${o.diff_bps} (z ${o.diffZ})`;
  const s1030 = Object.values(hourly.snapshots)[0];
  out.headline = {
    flowsDaily_top3_vs_basket_bps: { h1: mt(flows.signals.top3_flowScore.close_1), h5: mt(flows.signals.top3_flowScore.close_5), h20: mt(flows.signals.top3_flowScore.close_20),
      confirm2022_26: flows.signals.top3_flowScore.close_20.periods.find((p) => p.label.startsWith("CONFIRM")) },
    flowsDaily_rank1_bps: { h1: mt(flows.signals.rank1_flowScore.close_1), h5: mt(flows.signals.rank1_flowScore.close_5), h20: mt(flows.signals.rank1_flowScore.close_20) },
    flowsDaily_Entrando_minus_Saliendo_bps: { h1: mt(flows.signals.Entrando_menos_Saliendo.close_1), h5: mt(flows.signals.Entrando_menos_Saliendo.close_5), h20: mt(flows.signals.Entrando_menos_Saliendo.close_20) },
    flowsDaily_from_next_open_top3_bps: { h1: mt(flows.signals.top3_flowScore.open1_1), h5: mt(flows.signals.top3_flowScore.open1_5), h20: mt(flows.signals.top3_flowScore.open1_20) },
    intraday_1030ET_top3_bps: { restOfDay: mt(s1030.tests.top3.rod), nextDay: mt(s1030.tests.top3.c1), next5: mt(s1030.tests.top3.c5), sameSignAtClose_pct: s1030.persistence.sameSignAtClose_pct },
    topMover_vs_peers_bps: { h1: mt(flows.topMover.tests["topMover_vs_peers|close_1"]), h5: mt(flows.topMover.tests["topMover_vs_peers|close_5"]), h20: mt(flows.topMover.tests["topMover_vs_peers|close_20"]) },
    volProduction: { medianAtClose: fidelity.perTime["15:55 (cierre)"].median, medianMidday: fidelity.perTime["12:00"].median, spearmanVsDailyRvol: fidelity.rvolProdAtCloseVsDailyRvol.spearman },
    eod9_top3_mom4_bps: { h1: mt(eod.production9.top3_mom4.close_1), h5: mt(eod.production9.top3_mom4.close_5), h20: mt(eod.production9.top3_mom4.close_20) },
    eod_FALLING_vs_rest_excess_bps: { e9_h5: pz(eod.production9.FALLING_vs_rest["excess|close_5"]), e7_1999_h5: pz(eod.legacy7_1999.FALLING_vs_rest["excess|close_5"]) },
    gate_sector_pass_minus_fail_absolute_bps: { h1: pz(gate.sectorLevel_thr02["absolute|close_1"]), h5: pz(gate.sectorLevel_thr02["absolute|close_5"]), h20: pz(gate.sectorLevel_thr02["absolute|close_20"]), h60: pz(gate.sectorLevel_thr02["absolute|close_60"]) },
    gate_sector_pass_minus_fail_excess_bps: { h1: pz(gate.sectorLevel_thr02["excess|close_1"]), h5: pz(gate.sectorLevel_thr02["excess|close_5"]), h20: pz(gate.sectorLevel_thr02["excess|close_20"]), h60: pz(gate.sectorLevel_thr02["excess|close_60"]) },
    gate_candidateStock_top10_pass_minus_fail_bps: { h1: pz(gate.stockLevel.top10.tests["stockAbs|1"]), h5: pz(gate.stockLevel.top10.tests["stockAbs|5"]), h20: pz(gate.stockLevel.top10.tests["stockAbs|20"]), h60: pz(gate.stockLevel.top10.tests["stockAbs|60"]), passShare_pct: gate.stockLevel.top10.passShare_pct },
    gate_waitCost: gate.stockLevel.top10.waitCost,
    multiplicity: { tests: out.multiplicity.tests, absT_ge3: out.multiplicity.absT_ge3,
      analystCheck: "revisada a mano la lista absT_ge3_list (25-sep-2026): las 28 apuntan a REVERSIÓN (líderes/aprobados peor, perdedores/FALLING mejor); ninguna a continuidad del 'flujo'" },
  };

  out.verdicts = {
    flujosDeCapital: "NO se sostiene la lectura 'Dinero Entrando/Saliendo' como señal: los líderes del día (por flowScore o por % desde la apertura) no baten a la cesta equiponderada a 1, 5 ni 20 sesiones. Entre 2006 y 2021 hubo una LEVE REVERSIÓN (líderes −2 a −9 pb por ventana); en 2022-26 es ≈0. Intradía (60 min, 2023-26) solo aparece una continuidad mínima de la primera hora hasta el cierre (+2,5 pb, t≈1,8) que no pasa al día siguiente. El panel es DESCRIPTIVO: mide variación de precio desde la apertura, no flujos de dinero.",
    volumenRelativo: "El 'Vol x' de producción (3 últimas velas de 5 min / resto de la sesión) es un RELOJ: mediana ~0,5x a media sesión y ~4x al cierre en TODOS los ETFs (25 % topado a 5), correlación −0,07 con el volumen relativo real. No informa de volumen anómalo. El volumen relativo diario (vs media 20) tampoco da una señal robusta (|z|<2,5, ~5 % de días).",
    mejorAccionDelSector: "La acción 'topMover' (la que más sube de 6) no bate a sus pares a 1/5/20 sesiones (≈0 pb). Si acaso rebota la que MÁS cae (reversión a corto).",
    rankingEOD: "El endpoint EOD (4 sesiones, LEADING/FALLING) no tiene consumidor en el frontend. Si se mostrara, engañaría: el top-3 no bate a la cesta y los sectores 'FALLING' son los que luego baten al resto (reversión, z≈3-4,7). Ni siquiera el momentum sectorial de 6 meses (referencia) aporta en esta muestra.",
    filtro4: "INÚTIL para seleccionar y levemente PERJUDICIAL para el timing: pasar el filtro (sector > +0,2 % en la sesión) precede retornos ABSOLUTOS del sector MENORES a 1-20 sesiones (−6 a −17 pb, z −2,4 a −3,3, mismo signo en todos los subperiodos), neutro en relativo, y sin mejora en los candidatos tipo Rally (todas las diferencias ≤0 a 5-60 sesiones, no significativas); cuando obliga a esperar, se compra de media ~0,3 % más caro. Además es código dormido (Señal Óptima no se renderiza) y su mapa valor→ETF mezcla sectores (industriales→ITA, químicas/acero→GLD, AMZN/TSLA→XLK, V/MA→KBE). No se toca lógica: decide el lead.",
  };
  out.proposedTexts = [
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 277, current: "Flujos de Capital", proposed: "Sectores · Variación del día" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 428, current: "▲ Dinero Entrando", proposed: "▲ Suben desde la apertura" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 456, current: "▼ Dinero Saliendo", proposed: "▼ Bajan desde la apertura" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 418, current: "(línea de base, se mantiene)", proposed: "AÑADIR debajo: «Validación 2006-26 (diario, 10 ETFs): el líder del día no batió a la cesta a 1, 5 ni 20 sesiones. Descriptivo, no predictivo.»" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 168, current: "✓ INVERTIBLE", proposed: "MÁX. ALZA HOY" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 232, current: "S&P500", proposed: "acción EE. UU." },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 94, current: "Vol ${x}x / Vol ≥${x}x", proposed: "V15'/ses ${x}x (o retirarlo: al cierre marca ~4x siempre)" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 349, current: "Analizando flujos intraday…", proposed: "Leyendo variación intradía…" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 351, current: "10 ETFs · 30 stocks", proposed: "10 ETFs · 60 cotizaciones" },
    { file: "src/components/IntraDayFlowsPanel.tsx", line: 369, current: "Error al obtener datos — no se pudieron actualizar los flujos", proposed: "Error al obtener datos — no se pudo actualizar el mapa sectorial" },
    { file: "src/components/StickyMiniHeader.tsx", line: 54, current: "Flujos… / Paso 1 / 4  —  Rotación sectorial", proposed: "Sectores… / Paso 1 / 4  —  Variación sectorial del día" },
    { file: "src/pages/DashboardPage.tsx", line: 1014, current: "Error en scan de flujos — se mantiene el último dato", proposed: "Error en el mapa sectorial — se mantiene el último dato" },
    { file: "src/pages/DashboardPage.tsx", line: 1015, current: "Flujos detectados — ${sectors} sectores analizados", proposed: "Mapa sectorial actualizado — ${sectors} sectores" },
    { file: "src/components/OptimalSignalPanel.tsx", line: 228, current: "Sector con flujo institucional", proposed: "Sector en positivo hoy (dormido)" },
    { file: "src/components/OptimalSignalPanel.tsx", line: 236, current: "Sector de ${t} sin flujo positivo hoy", proposed: "Sector de ${t} sin subida > umbral hoy" },
    { file: "src/components/OptimalSignalPanel.tsx", line: 237, current: "${t} — sector confirmado por los 2 motores (flujo pendiente)", proposed: "${t} — sector sin mapear, filtro no aplicado" },
    { file: "src/components/ConvergenceSignalBanner.tsx", line: 521, current: "Flujo sectorial no confirmado", proposed: "Sector sin subida > umbral hoy" },
    { file: "api/sector-leaders-data.js", line: 5, current: "Intraday mode: detects WHERE institutional money is moving RIGHT NOW", proposed: "Intraday mode: variación de precio por sector desde la apertura — descriptivo; no mide flujos (backtest 25-sep-2026)" },
    { file: "CLAUDE.md", line: 307, current: "Ranking de momentum sectorial", proposed: "Mapa sectorial intradía (descriptivo, sin valor predictivo — backtests/sector-flows-2026-09-25.json); modo EOD sin consumidor" },
  ];
  out.sideFindings = [
    "Yahoo range=max&interval=1d devuelve velas MENSUALES (dataGranularity 1mo) — el script usa period1/period2 y exige granularidad.",
    "El holding GOLD de 'Oro / Metales' es hoy Gold.com, Inc. (Barrick cotiza como B desde 2025); AEM/WPM/FNV no son S&P 500 → la etiqueta 'S&P500' es falsa para ese sector.",
    "api/_lib/staticUniverse.js: solo 335 valores US y NO incluye AAPL, BRK.B ni HII (el universo de SCAN FULL/Rally/Rally-Test). Fuera de alcance: investigar sin tocar estrategia.",
    "Filtro 4 y ConvergenceSignalBanner son código dormido (Señal Óptima desactivada 24-jul-2026).",
    "SPY en el panel: el 'Vol' se pinta ámbar con ≥2x → tras el cierre SIEMPRE ámbar (mediana ~4x).",
  ];
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log("escrito", OUT, out.runtimeSec, "s");
}
function countWhere(P, pred) { let n = 0; for (let i = 0; i < P.N; i++) for (let t = 0; t < P.T; t++) if (pred(i, t)) n++; return n; }
main().catch((e) => { console.error(e); process.exit(1); });
