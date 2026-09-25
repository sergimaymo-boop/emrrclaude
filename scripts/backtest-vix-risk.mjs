/**
 * BACKTEST del SEMÁFORO DE RIESGO (VIX) — análisis OFFLINE, reproducible.
 *
 * Valida los umbrales (VIX <16 / 16-21 / >=21) y las cifras que muestran
 * src/services/marketRiskRefresh.ts + src/components/MarketRiskGauge.tsx.
 * Cada día se clasifica por el CIERRE del VIX y se mide lo que hizo el S&P 500 DESPUÉS
 * (sin lookahead: todo se mide desde el cierre del día t):
 *   · caída brusca 5d  = el mínimo INTRADÍA de las 5 sesiones siguientes queda >3% por debajo del
 *                        cierre de t (misma definición que el script original — es la cifra del panel)
 *   · rentabilidad 5d / 20d = cierre t+5 / t+20 frente al cierre de t (media, mediana, % positivas)
 *   · peor caída 20d   = mínimo intradía de las 20 sesiones siguientes frente al cierre de t, acotada
 *                        a 0 (si nunca bajó de la entrada, 0): lo que habrías visto perder tras entrar
 *   · vol. realizada 20d = desviación típica muestral de los retornos diarios t+1..t+20, anualizada
 *   · "esperar a la calma" (días ALTO): precio del primer día en que el VIX vuelve a <21 (o <16)
 *                        frente al de t. Positivo = esperar obligó a comprar MÁS CARO. No incluye
 *                        dividendos (favorecen entrar ya) ni intereses de la caja (favorecen esperar).
 *   · episodios        = rachas de días de la misma zona, fusionadas si las separan ≤20 sesiones
 *                        (los días de VIX alto van en racimos: n días ≠ n observaciones independientes;
 *                        además las ventanas de 5/20 sesiones se solapan).
 *
 * Modos:
 *   node scripts/backtest-vix-risk.mjs                          → LOCAL (por defecto, sin red):
 *        data/sp500-history.json (^VIX 1990→, ^GSPC, SPY ajustado). Se regenera con
 *        scripts/sp500-fetch-history.mjs (está en .gitignore).
 *   node scripts/backtest-vix-risk.mjs --file=/ruta/copia.json   → otra copia local (p. ej. congelada)
 *   node scripts/backtest-vix-risk.mjs --out=backtests/vix-risk-2026-09-25.json → guarda el JSON
 *   node scripts/backtest-vix-risk.mjs --source=yahoo [--range=5y] → modo ORIGINAL: Yahoo en vivo
 *        (^GSPC + ^VIX, 5 años por defecto). Es la muestra corta de la que salían los 7/13/29%.
 *
 * Cifras canónicas: backtests/vix-risk-2026-09-25.json (^GSPC 1990-01-02 → 2026-08-07).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── Parámetros ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const SOURCE = args.source === "yahoo" ? "yahoo" : "local";
const FILE = path.resolve(typeof args.file === "string" ? args.file : "data/sp500-history.json");
const RANGE = typeof args.range === "string" ? args.range : "5y";
const OUT = typeof args.out === "string" ? path.resolve(args.out) : null;

// Umbrales del semáforo — DEBEN coincidir con levelFromVix() de src/services/marketRiskRefresh.ts
const LOW_MAX = 16;
const MID_MAX = 21;
const H5 = 5;
const H20 = 20;
const DROP = -3; // % "caída brusca"
const ZONES = ["BAJO", "MEDIO", "ALTO"];
const zoneOf = (v, lo = LOW_MAX, hi = MID_MAX) => (v < lo ? "BAJO" : v < hi ? "MEDIO" : "ALTO");

// ── Estadística ────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sdev = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); // muestral (n−1)
};
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
};
const pct = (num, den) => (den ? (num / den) * 100 : null);
const rd = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const asc = (a) => [...a].sort((x, y) => x - y);

// ── Datos ──────────────────────────────────────────────────────────────────────
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
async function yahooBars(sym, range) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`,
    { headers: { "User-Agent": UA } },
  );
  const d = await r.json();
  const x = d?.chart?.result?.[0];
  if (!x?.timestamp) throw new Error(`Yahoo sin datos para ${sym}`);
  const q = x.indicators.quote[0];
  return x.timestamp
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[i], high: q.high[i], low: q.low[i] }))
    .filter((b) => Number.isFinite(b.close) && Number.isFinite(b.low));
}

function loadLocal(file) {
  if (!fs.existsSync(file)) {
    console.error(`No existe ${file}.\nGenéralo con: node scripts/sp500-fetch-history.mjs  (o usa --source=yahoo)`);
    process.exit(1);
  }
  const raw = fs.readFileSync(file);
  const d = JSON.parse(raw);
  const s = d?.series ?? {};
  const ok = (b) => Number.isFinite(b?.close) && Number.isFinite(b?.low) && Number.isFinite(b?.high) && b.close > 0;
  const gspc = (s["^GSPC"] ?? []).filter(ok).map(({ date, close, high, low }) => ({ date, close, high, low }));
  const vix = (s["^VIX"] ?? []).filter((b) => Number.isFinite(b?.close)).map(({ date, close }) => ({ date, close }));
  // SPY con dividendos (retorno total): máximos/mínimos escalados por adj/close del mismo día
  const spyTR = (s.SPY ?? [])
    .filter((b) => ok(b) && Number.isFinite(b.adj))
    .map((b) => {
      const f = b.adj / b.close;
      return { date: b.date, close: b.adj, high: b.high * f, low: b.low * f };
    });
  if (!gspc.length || !vix.length) {
    console.error(`${file} no contiene ^GSPC y ^VIX.`);
    process.exit(1);
  }
  return {
    gspc,
    vix,
    spyTR,
    meta: {
      file: path.relative(process.cwd(), file) || file,
      bytes: raw.length,
      sha256: crypto.createHash("sha256").update(raw).digest("hex"),
      fetchedAt: d.fetchedAt ?? null,
    },
  };
}

// ── Motor ──────────────────────────────────────────────────────────────────────
// Una fila por día con VIX y ≥5 sesiones posteriores (condición del script original);
// las métricas a 20 sesiones quedan en null si aún no hay 20 sesiones posteriores.
function buildRows(idx, vix) {
  const at = new Map(idx.map((b, i) => [b.date, i]));
  const rows = [];
  for (const v of vix) {
    const i = at.get(v.date);
    if (i === undefined || i + H5 >= idx.length) continue;
    const p0 = idx[i].close;
    let min5 = Infinity;
    let min5c = Infinity;
    for (let k = 1; k <= H5; k++) {
      min5 = Math.min(min5, idx[i + k].low);
      min5c = Math.min(min5c, idx[i + k].close);
    }
    const row = {
      date: v.date,
      i,
      vix: v.close,
      zone: zoneOf(v.close),
      drop5: (min5 / p0 - 1) * 100,
      drop5c: (min5c / p0 - 1) * 100, // contraste: solo cierres (sin mínimos intradía)
      ret5: (idx[i + H5].close / p0 - 1) * 100,
      ret20: null,
      dd20: null,
      rv20: null,
    };
    if (i + H20 < idx.length) {
      let min20 = Infinity;
      const lr = [];
      for (let k = 1; k <= H20; k++) {
        min20 = Math.min(min20, idx[i + k].low);
        lr.push(Math.log(idx[i + k].close / idx[i + k - 1].close));
      }
      row.ret20 = (idx[i + H20].close / p0 - 1) * 100;
      row.dd20 = Math.min(0, (min20 / p0 - 1) * 100);
      row.rv20 = sdev(lr) * Math.sqrt(252) * 100;
    }
    rows.push(row);
  }
  return rows;
}

function zoneStats(rows, total) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const r5 = rows.map((r) => r.ret5);
  const w20 = rows.filter((r) => r.ret20 != null);
  const r20 = w20.map((r) => r.ret20);
  const s5 = asc(r5);
  const s20 = asc(r20);
  const dd = asc(w20.map((r) => r.dd20));
  const rv = asc(w20.map((r) => r.rv20));
  return {
    n,
    pctDias: total ? rd(pct(n, total), 1) : undefined,
    pCaida3_5d: rd(pct(rows.filter((r) => r.drop5 < DROP).length, n), 1),
    pCaida3_5d_soloCierres: rd(pct(rows.filter((r) => r.drop5c < DROP).length, n), 1),
    ret5: { media: rd(mean(r5)), mediana: rd(quantile(s5, 0.5)), pctPositivas: rd(pct(r5.filter((x) => x > 0).length, n), 1) },
    n20: w20.length,
    ret20: {
      media: rd(mean(r20)),
      mediana: rd(quantile(s20, 0.5)),
      pctPositivas: rd(pct(r20.filter((x) => x > 0).length, r20.length), 1),
      desviacion: rd(sdev(r20)),
      p10: rd(quantile(s20, 0.1)),
      p90: rd(quantile(s20, 0.9)),
    },
    peorCaida20d: {
      p5: rd(quantile(dd, 0.05)),
      p10: rd(quantile(dd, 0.1)),
      p25: rd(quantile(dd, 0.25)),
      mediana: rd(quantile(dd, 0.5)),
      p75: rd(quantile(dd, 0.75)),
      media: rd(mean(dd)),
      pctPeorQue5: rd(pct(dd.filter((x) => x < -5).length, dd.length), 1),
      pctPeorQue10: rd(pct(dd.filter((x) => x < -10).length, dd.length), 1),
    },
    volRealizada20dAnualMediana: rd(quantile(rv, 0.5), 1),
  };
}

function table(rows) {
  const out = { rango: rows.length ? [rows[0].date, rows.at(-1).date] : null };
  for (const z of ZONES) out[z] = zoneStats(rows.filter((r) => r.zone === z), rows.length);
  out.TODOS = zoneStats(rows);
  return out;
}

// Rachas de una zona (posiciones de sesión), fusionadas si el hueco es ≤ gap sesiones.
function episodes(rows, zone, gap = H20) {
  const eps = [];
  for (const r of rows) {
    if (r.zone !== zone) continue;
    const last = eps.at(-1);
    if (last && r.i - last.lastI <= gap) {
      last.rows.push(r);
      last.lastI = r.i;
    } else eps.push({ rows: [r], lastI: r.i });
  }
  return eps.map((e) => ({ desde: e.rows[0].date, hasta: e.rows.at(-1).date, dias: e.rows.length, rows: e.rows }));
}

// ¿Depende la media de un solo episodio? Media sin cada episodio y media de medias (cada episodio pesa 1).
function episodeRobustness(rows, zone) {
  const eps = episodes(rows, zone);
  const w = (rs, k) => rs.filter((r) => r[k] != null).map((r) => r[k]);
  const all = rows.filter((r) => r.zone === zone);
  const loo = (k) => {
    let worst = null;
    for (const e of eps) {
      const m = mean(w(all.filter((r) => !e.rows.includes(r)), k));
      if (m != null && (worst == null || m < worst.media)) worst = { media: rd(m), sinEpisodio: `${e.desde}→${e.hasta} (${e.dias} días)` };
    }
    return worst;
  };
  const epMeans = (k) => eps.map((e) => mean(w(e.rows, k))).filter((x) => x != null);
  const m20 = epMeans("ret20");
  const top = [...eps].sort((a, b) => b.dias - a.dias).slice(0, 6).map((e) => ({
    desde: e.desde, hasta: e.hasta, dias: e.dias,
    ret20Media: rd(mean(w(e.rows, "ret20"))), pCaida3_5d: rd(pct(e.rows.filter((r) => r.drop5 < DROP).length, e.rows.length), 1),
  }));
  return {
    episodios: eps.length,
    diasMediosPorEpisodio: rd(all.length / (eps.length || 1), 1),
    peorMediaQuitandoUnEpisodio: { ret5: loo("ret5"), ret20: loo("ret20") },
    ret20MediaDeMediasPorEpisodio: rd(mean(m20)),
    ret20ErrorEstandarEntreEpisodios: m20.length > 1 ? rd(sdev(m20) / Math.sqrt(m20.length)) : null,
    ret20PctEpisodiosPositivos: rd(pct(m20.filter((x) => x > 0).length, m20.length), 1),
    episodiosMasLargos: top,
  };
}

// "Mejor esperar": en cada día ALTO, esperar al primer cierre con VIX < nivel y comparar precios.
function waitUntilCalm(rows, idx, vix, level) {
  const vixAt = new Map(vix.map((v) => [v.date, v.close]));
  const vByI = idx.map((b) => vixAt.get(b.date));
  const next = new Array(idx.length).fill(-1); // primera sesión > i con VIX < level
  for (let i = idx.length - 2; i >= 0; i--) {
    const v = vByI[i + 1];
    next[i] = v != null && v < level ? i + 1 : next[i + 1];
  }
  const cost = [];
  const waits = [];
  let censurados = 0;
  for (const r of rows) {
    if (r.zone !== "ALTO") continue;
    const u = next[r.i];
    if (u < 0) { censurados++; continue; }
    cost.push((idx[u].close / idx[r.i].close - 1) * 100);
    waits.push(u - r.i);
  }
  const sc = asc(cost);
  const sw = asc(waits);
  return {
    esperarHastaVixMenorQue: level,
    n: cost.length,
    censurados,
    pctDiasEnQueEsperarDioMejorPrecio: rd(pct(cost.filter((x) => x < 0).length, cost.length), 1),
    diferenciaPrecio: { media: rd(mean(cost)), mediana: rd(quantile(sc, 0.5)), p10: rd(quantile(sc, 0.1)), p90: rd(quantile(sc, 0.9)) },
    esperaSesiones: { mediana: rd(quantile(sw, 0.5), 0), p90: rd(quantile(sw, 0.9), 0), max: sw.at(-1) ?? null },
  };
}

function thresholdsReport(rows) {
  const vs = asc(rows.map((r) => r.vix));
  const scale = (lo, hi) => {
    const o = {};
    for (const z of ZONES) {
      const rs = rows.filter((r) => zoneOf(r.vix, lo, hi) === z);
      const s = zoneStats(rs, rows.length);
      o[z] = { n: s.n, pctDias: s.pctDias, pCaida3_5d: s.pCaida3_5d, ret20Media: s.ret20?.media, peorCaida20dMediana: s.peorCaida20d?.mediana };
    }
    return o;
  };
  const buckets = [[0, 12], [12, 14], [14, 16], [16, 18], [18, 21], [21, 25], [25, 30], [30, 40], [40, Infinity]];
  const fine = buckets.map(([a, b]) => {
    const s = zoneStats(rows.filter((r) => r.vix >= a && r.vix < b), rows.length);
    return {
      vix: b === Infinity ? `>=${a}` : `${a}-${b}`,
      n: s.n,
      pctDias: s.pctDias,
      pCaida3_5d: s.pCaida3_5d,
      ret5Media: s.ret5?.media ?? null,
      ret20Media: s.ret20?.media ?? null,
      ret20Mediana: s.ret20?.mediana ?? null,
      ret20PctPositivas: s.ret20?.pctPositivas ?? null,
      peorCaida20dMediana: s.peorCaida20d?.mediana ?? null,
      volRealizada20dMediana: s.volRealizada20dAnualMediana ?? null,
    };
  });
  const t1 = quantile(vs, 1 / 3);
  const t2 = quantile(vs, 2 / 3);
  return {
    vixMediana: rd(quantile(vs, 0.5)),
    tercilesVix: [rd(t1), rd(t2)],
    escala_16_21_panel: scale(16, 21),
    escala_15_20_indicadores: scale(15, 20),
    escala_terciles: scale(t1, t2),
    tramosFinos: fine,
  };
}

// ── Informe por consola ────────────────────────────────────────────────────────
const f = (x, d = 2, plus = false) => (x == null ? "—" : `${plus && x > 0 ? "+" : ""}${x.toFixed(d)}`);
function printTable(title, t) {
  console.log(`\n${title}${t.rango ? `  [${t.rango[0]} → ${t.rango[1]}]` : ""}`);
  console.log("zona   |     n | %días | caída>3% 5d | ret5 media/med   | ret20 media/med  | %pos20 | peor caída 20d med/p10 | vol20d");
  for (const z of [...ZONES, "TODOS"]) {
    const s = t[z];
    if (!s?.n) continue;
    console.log(
      `${z.padEnd(6)} | ${String(s.n).padStart(5)} | ${f(s.pctDias ?? 100, 0).padStart(5)} | ${`${f(s.pCaida3_5d, 1)}%`.padStart(11)} | ` +
        `${`${f(s.ret5.media, 2, true)} / ${f(s.ret5.mediana, 2, true)}`.padStart(16)} | ${`${f(s.ret20.media, 2, true)} / ${f(s.ret20.mediana, 2, true)}`.padStart(16)} | ` +
        `${`${f(s.ret20.pctPositivas, 0)}%`.padStart(6)} | ${`${f(s.peorCaida20d.mediana)} / ${f(s.peorCaida20d.p10)}`.padStart(22)} | ${f(s.volRealizada20dAnualMediana, 1)}%`,
    );
  }
}

// ── Ejecución ──────────────────────────────────────────────────────────────────
let gspc;
let vix;
let spyTR = [];
let dataset;
if (SOURCE === "yahoo") {
  gspc = await yahooBars("^GSPC", RANGE); // ^GSPC por coherencia con el VIX (mismo subyacente)
  vix = await yahooBars("^VIX", RANGE);
  dataset = { source: "yahoo", range: RANGE, fetchedAt: new Date().toISOString() };
} else {
  const L = loadLocal(FILE);
  gspc = L.gspc;
  vix = L.vix.filter((v) => v.date >= "1990-01-01");
  spyTR = L.spyTR;
  dataset = { source: "local", ...L.meta };
}

const rows = buildRows(gspc, vix);
if (!rows.length) {
  console.error("Sin días utilizables (¿VIX e índice sin fechas comunes?)");
  process.exit(1);
}
const lastBar = gspc.at(-1).date;
const fiveYearsAgo = `${Number(lastBar.slice(0, 4)) - 5}${lastBar.slice(4)}`;
console.log(`VIX ${vix.length} barras · S&P500 (^GSPC) ${gspc.length} barras · días analizados ${rows.length} (${rows[0].date} → ${rows.at(-1).date}) · última barra ${lastBar}`);

const full = table(rows);
printTable("MUESTRA COMPLETA — S&P 500 (^GSPC, sin dividendos)", full);
console.log(`  contraste caída>3% en 5d medida SOLO con cierres: ${[...ZONES, "TODOS"].map((z) => `${z} ${f(full[z].pCaida3_5d_soloCierres, 1)}%`).join(" · ")}`);

const SUBS = [
  ["1990-2009", (r) => r.date < "2010-01-01"],
  ["2010-2026", (r) => r.date >= "2010-01-01"],
  [`ultimos5anos (${fiveYearsAgo}→)`, (r) => r.date >= fiveYearsAgo],
  ["1990s", (r) => r.date < "2000-01-01"],
  ["2000s", (r) => r.date >= "2000-01-01" && r.date < "2010-01-01"],
  ["2010s", (r) => r.date >= "2010-01-01" && r.date < "2020-01-01"],
  ["2020s", (r) => r.date >= "2020-01-01"],
];
const subperiods = {};
for (const [name, fn] of SUBS) {
  const rs = rows.filter(fn);
  if (!rs.length) continue;
  subperiods[name] = table(rs);
  printTable(`SUBPERIODO ${name}`, subperiods[name]);
}

let spyCheck = null;
if (spyTR.length) {
  const spyRows = buildRows(spyTR, vix);
  spyCheck = { nota: "SPY con dividendos (cierre ajustado); máximos/mínimos escalados por adj/close", completa: table(spyRows) };
  printTable("CONTRASTE — SPY con dividendos (retorno total)", spyCheck.completa);
}

// Estabilidad del hallazgo clave: ¿la rentabilidad media tras días ALTO es peor que tras BAJO/MEDIO?
const stability = {};
for (const [name, t] of [["completa", full], ...Object.entries(subperiods)]) {
  const a = t.ALTO;
  const b = t.BAJO;
  const m = t.MEDIO;
  if (!a?.n || !b?.n) continue;
  stability[name] = {
    ratioCaidaAltoVsBajo: rd(a.pCaida3_5d / (b.pCaida3_5d || NaN), 1),
    ret5Media: { BAJO: b.ret5.media, MEDIO: m?.ret5?.media ?? null, ALTO: a.ret5.media },
    ret20Media: { BAJO: b.ret20.media, MEDIO: m?.ret20?.media ?? null, ALTO: a.ret20.media },
    ret20Mediana: { BAJO: b.ret20.mediana, MEDIO: m?.ret20?.mediana ?? null, ALTO: a.ret20.mediana },
    altoNoPeorQueBajo_ret20Media: a.ret20.media != null && b.ret20.media != null ? a.ret20.media >= b.ret20.media : null,
    altoNoPeorQueBajo_ret20Mediana: a.ret20.mediana != null && b.ret20.mediana != null ? a.ret20.mediana >= b.ret20.mediana : null,
    altoNoPeorQueBajo_ret5Media: a.ret5.media >= b.ret5.media,
  };
}
console.log("\nESTABILIDAD (ALTO vs BAJO por subperiodo): ret5 media / ret20 media / ret20 mediana — ¿ALTO ≥ BAJO?");
for (const [k, s] of Object.entries(stability)) {
  console.log(
    `  ${k.padEnd(30)} caída ×${f(s.ratioCaidaAltoVsBajo, 1)} · ret5 ${f(s.ret5Media.ALTO, 2, true)} vs ${f(s.ret5Media.BAJO, 2, true)} (${s.altoNoPeorQueBajo_ret5Media ? "sí" : "NO"})` +
      ` · ret20 ${f(s.ret20Media.ALTO, 2, true)} vs ${f(s.ret20Media.BAJO, 2, true)} (${s.altoNoPeorQueBajo_ret20Media ? "sí" : "NO"})` +
      ` · mediana20 ${f(s.ret20Mediana.ALTO, 2, true)} vs ${f(s.ret20Mediana.BAJO, 2, true)} (${s.altoNoPeorQueBajo_ret20Mediana ? "sí" : "NO"})`,
  );
}

const robustness = {};
for (const z of ZONES) robustness[z] = episodeRobustness(rows, z);
console.log("\nEPISODIOS (rachas fusionadas si hueco ≤20 sesiones):");
for (const z of ZONES) {
  const e = robustness[z];
  console.log(
    `  ${z.padEnd(5)} ${String(e.episodios).padStart(4)} episodios · ${f(e.diasMediosPorEpisodio, 1)} días/episodio · ret20 media-de-medias ${f(e.ret20MediaDeMediasPorEpisodio, 2, true)}% (EE ${f(e.ret20ErrorEstandarEntreEpisodios)}) · ` +
      `peor media quitando 1 episodio: ret20 ${f(e.peorMediaQuitandoUnEpisodio.ret20?.media, 2, true)}% (sin ${e.peorMediaQuitandoUnEpisodio.ret20?.sinEpisodio ?? "—"})`,
  );
}

const waitCalm = { completa: [waitUntilCalm(rows, gspc, vix, MID_MAX), waitUntilCalm(rows, gspc, vix, LOW_MAX)] };
for (const [name, fn] of SUBS) {
  const rs = rows.filter(fn);
  if (rs.some((r) => r.zone === "ALTO")) waitCalm[name] = [waitUntilCalm(rs, gspc, vix, MID_MAX)];
}
console.log("\n¿'MEJOR ESPERAR'? Días ALTO: comprar ya vs esperar al primer cierre con VIX por debajo del nivel");
for (const [k, list] of Object.entries(waitCalm)) {
  for (const w of list) {
    console.log(
      `  ${k.padEnd(30)} VIX<${w.esperarHastaVixMenorQue}: n=${w.n} · esperar dio mejor precio ${f(w.pctDiasEnQueEsperarDioMejorPrecio, 1)}% de las veces · ` +
        `precio al esperar ${f(w.diferenciaPrecio.media, 2, true)}% media / ${f(w.diferenciaPrecio.mediana, 2, true)}% mediana · espera mediana ${w.esperaSesiones.mediana} sesiones (p90 ${w.esperaSesiones.p90})`,
    );
  }
}

const thr = thresholdsReport(rows);
console.log(`\nUMBRALES: mediana VIX ${f(thr.vixMediana)} · terciles reales ${f(thr.tercilesVix[0], 1)} / ${f(thr.tercilesVix[1], 1)} (el panel usa 16/21)`);
for (const [k, sc] of [["16/21 (panel)", thr.escala_16_21_panel], ["15/20 (Indicadores)", thr.escala_15_20_indicadores], ["terciles", thr.escala_terciles]]) {
  console.log(`  ${k.padEnd(20)} ${ZONES.map((z) => `${z} ${f(sc[z].pCaida3_5d, 1)}% (${f(sc[z].pctDias, 0)}% días)`).join(" · ")}`);
}
console.log("  tramo VIX | n     | caída>3% 5d | ret20 media | ret20 mediana | %pos20 | peor caída 20d med | vol20d");
for (const b of thr.tramosFinos) {
  console.log(
    `  ${b.vix.padEnd(9)} | ${String(b.n).padStart(5)} | ${`${f(b.pCaida3_5d, 1)}%`.padStart(11)} | ${f(b.ret20Media, 2, true).padStart(11)} | ${f(b.ret20Mediana, 2, true).padStart(13)} | ${`${f(b.ret20PctPositivas, 0)}%`.padStart(6)} | ${f(b.peorCaida20dMediana).padStart(18)} | ${f(b.volRealizada20dMediana, 1)}%`,
  );
}

// Cifras que se cablean en el panel (redondeadas): marketRiskRefresh.ts → VIX_RISK_EVIDENCE.
// Las caídas se dan como magnitud positiva con 1 decimal (el panel escribe "caída del 3,4%").
const panelZone = (z) => {
  const dd = asc(rows.filter((r) => r.zone === z && r.dd20 != null).map((r) => r.dd20));
  return {
    pCaida3_5d: Math.round(full[z].pCaida3_5d),
    peorCaida20dTipica: rd(-quantile(dd, 0.5), 1),
    peorCaida20dUnaDeDiez: rd(-quantile(dd, 0.1), 1),
  };
};
const wait21 = waitCalm.completa[0];
const panel = {
  periodo: `${full.rango[0].slice(0, 4)}-${full.rango[1].slice(0, 4)}`,
  indice: "S&P 500 (^GSPC)",
  BAJO: panelZone("BAJO"),
  MEDIO: panelZone("MEDIO"),
  ALTO: { ...panelZone("ALTO"), esperarVix21PctMejorPrecio: wait21.pctDiasEnQueEsperarDioMejorPrecio },
};
console.log(
  `\n→ Cifras del panel (marketRiskRefresh.ts · ${panel.indice}, ${panel.periodo}):` +
    ZONES.map((z) => ` ${z} caída>3% ~${panel[z].pCaida3_5d}% · peor caída 20d típica ${panel[z].peorCaida20dTipica}% / 1 de cada 10 >${panel[z].peorCaida20dUnaDeDiez}%`).join(" |") +
    ` | esperar a VIX<21 dio mejor precio el ${panel.ALTO.esperarVix21PctMejorPrecio}% de las veces. Si difieren de las cableadas, actualizar allí.`,
);

if (OUT) {
  const result = {
    estudio: "Semáforo de riesgo VIX — frecuencia de caídas bruscas y rentabilidad posterior por zona",
    generadoUtc: new Date().toISOString(),
    comando: `node scripts/backtest-vix-risk.mjs ${process.argv.slice(2).join(" ")}`.trim(),
    dataset: { ...dataset, primeraBarraVix: vix[0]?.date ?? null, ultimaBarraIndice: lastBar },
    definiciones: {
      zonas: `BAJO: VIX < ${LOW_MAX} · MEDIO: ${LOW_MAX} ≤ VIX < ${MID_MAX} · ALTO: VIX ≥ ${MID_MAX} (cierre del día t)`,
      pCaida3_5d: `% de días en que el mínimo intradía de las ${H5} sesiones siguientes cae más de un ${-DROP}% bajo el cierre de t`,
      ret5_ret20: `cierre t+${H5} / t+${H20} frente al cierre de t (índice sin dividendos; el contraste SPY sí los incluye)`,
      peorCaida20d: `mínimo intradía de las ${H20} sesiones siguientes frente al cierre de t, acotado a 0 (percentiles: p5 = el 5% peor)`,
      volRealizada20d: `desviación típica muestral de los retornos diarios t+1..t+${H20}, anualizada (×√252)`,
      episodios: `rachas de días de la misma zona fusionadas si las separan ≤${H20} sesiones`,
      esperarALaCalma: "precio del primer cierre con VIX por debajo del nivel frente al precio de t; positivo = esperar obligó a comprar más caro. Sin dividendos ni intereses de caja",
      avisoSolape: "las ventanas de 5/20 sesiones se solapan y los días ALTO van en racimos: el número de observaciones independientes es muy inferior al de días",
    },
    panel,
    muestraCompleta: full,
    subperiodos: subperiods,
    estabilidadAltoVsBajo: stability,
    episodios: robustness,
    esperarALaCalma: waitCalm,
    umbrales: thr,
    contrasteSpyRetornoTotal: spyCheck,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`\nGuardado: ${path.relative(process.cwd(), OUT)}`);
}
