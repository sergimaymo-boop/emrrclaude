/**
 * ESTUDIO 12 — ESTADOS DE RÉGIMEN (12-nov-2026)
 * Construye, sobre el calendario del dataset canon, los ESTADOS de mercado que el estudio 12
 * usa para (a) ceñir el trailing, (b) reducir exposición y (c) decidir cuándo cargar.
 * Cada estado es un booleano por sesión calculado SOLO con datos ≤ cierre de esa sesión
 * (los usos lo aplican con un día de retraso). Fuente de mercado: backtests/estudio12-mercado.json
 * (congelado con huella sha256). Si falta una serie o un estado sale degenerado, ABORTA.
 *
 * TENDENCIA / RIESGO
 *   R1 SPY<EMA200          SPY (ajustado) bajo su media exponencial de 200 sesiones
 *   R2 CRUCE_MUERTE        SMA50(SPY) < SMA200(SPY)   (lo contrario del "golden cross")
 *   R3 SPY<EMA50           SPY bajo su media exponencial de 50
 *   R4 HYG<EMA200          crédito high-yield (HYG ajustado) bajo su media de 200
 *   R5 VIX>=25             VIX de cierre ≥ 25
 *   R6 AMPLITUD<35%        < 35% del universo con momentum 189s10 positivo (semáforo "estrecho" del panel)
 * CODICIA / SOBRECOMPRA
 *   G1 CODICIA             VIX en su percentil ≤10% de 252 ses. Y SPY a ≤2% de su máximo de 252 (def. estudio 10)
 *   G2 RSI>=70             RSI de Wilder a 14 sesiones del SPY ≥ 70
 *   G3 SPY+10%_EMA200      SPY ≥ 10% por encima de su EMA200
 *   G4 FG_CODICIA          media de 5 ses. del Fear&Greed INTERNO (réplica exacta del handler) en su percentil ≥90% de 252
 * MIEDO / CORRECCIÓN
 *   F1 MIEDO               VIX en su percentil ≥90% de 252 O SPY ≥10% bajo su máximo de 252 (def. estudio 10)
 *   F2 RSI<=30             RSI14 del SPY ≤ 30
 *   F3 FIBO_38             SPY ha retrocedido ≥38,2% de su rango (mín-máx) de 252 sesiones
 *   F4 FG_MIEDO            media de 5 ses. del Fear&Greed interno en su percentil ≤10% de 252
 *   F5 CORRECCION_ALCISTA  SPY ≥5% bajo su máximo de 252 Y por encima de su EMA200 (la idea de Sergi)
 * LOS 5 PRIMEROS DEL SCAN (top-5 del día por la señal M189s10, independiente de la fase)
 *   K1 TOP5_ESTIRADO       media de (precio/EMA50−1) del top-5 en su percentil ≥90% de 252 sesiones
 *   K2 TOP5_NO_ESTIRADO    esa media en su percentil ≤10% de 252 sesiones
 *                          (la definición absoluta ≥30% / ≤5% salió degenerada —1,2% y 29% de los días— y se
 *                          cambió a percentil ANTES de calcular ningún resultado de la estrategia)
 *   K3 TOP5_RSI>=70        RSI14 medio del top-5 ≥ 70
 *   K4 TOP5_RSI<=50        RSI14 medio del top-5 ≤ 50
 * SOLO INFORMATIVO (CNN solo existe desde 2021-01: no hay train, no puede adjudicarse)
 *   CF CNN_MIEDO_EXTREMO · CG CNN_CODICIA_EXTREMA
 */
import fs from "node:fs";
import { T, dates, D, isNum, mean, breadth, scoreDia, sigM189s10 } from "./lab-day-core.mjs";
import { asOfLevel, asOfChange, loadHandlerScoring, internalComposite, sha256 } from "./backtest-fear-greed.mjs";

const M = JSON.parse(fs.readFileSync("backtests/estudio12-mercado.json", "utf8"));
for (const [s, o] of Object.entries(M.series)) if (sha256(JSON.stringify(o.bars)) !== o.sha256) throw new Error(`ABORTO: huella de ${s} no coincide — el fichero de mercado está alterado`);
const S = Object.fromEntries(Object.entries(M.series).map(([s, o]) => [s, { symbol: s, bars: o.bars }]));

// calendario largo (SPY de Yahoo desde 2015) para tener lookback antes de 2016-08
const C = S.SPY.bars.filter((b) => b.adj !== null).map((b) => b.date);
const NC = C.length, idxC = new Map(C.map((d, k) => [d, k]));
for (const d of dates) if (!idxC.has(d)) throw new Error(`ABORTO: la sesión ${d} del dataset no está en el SPY de mercado`);
const spy = S.SPY.bars.filter((b) => b.adj !== null).map((b) => b.adj);
const lvl = (sym, campo = "close") => C.map((d) => {
  const s = campo === "close" ? S[sym] : { bars: S[sym].bars.map((b) => ({ date: b.date, close: b.adj })) };
  return asOfLevel(s, d);
});
const vix = lvl("^VIX"), hyg = lvl("HYG", "adj");

const ema = (a, n) => { const k = 2 / (n + 1), o = new Array(a.length).fill(null); let e = null; for (let i = 0; i < a.length; i++) { if (!isNum(a[i])) { o[i] = e; continue; } e = e == null ? a[i] : a[i] * k + e * (1 - k); o[i] = e; } return o; };
const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const rsi14 = (a) => { const o = new Array(a.length).fill(null); let ag = 0, al = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0); if (i <= 14) { ag += g / 14; al += l / 14; if (i === 14) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } return o; };
const pctTrail = (a, win = 252, minN = 200) => a.map((v, i) => { if (!isNum(v) || i < win - 1) return null; let le = 0, n = 0; for (let q = i - win + 1; q <= i; q++) if (isNum(a[q])) { n++; if (a[q] <= v) le++; } return n >= minN ? le / n : null; });
const roll = (a, win, fn) => a.map((_, i) => { if (i < win - 1) return null; let r = null; for (let q = i - win + 1; q <= i; q++) if (isNum(a[q])) r = r == null ? a[q] : fn(r, a[q]); return r; });

const e200 = ema(spy, 200), e50 = ema(spy, 50), s50 = sma(spy, 50), s200 = sma(spy, 200);
const hygE200 = ema(hyg, 200), rsiSpy = rsi14(spy), vixPct = pctTrail(vix);
const mx252 = roll(spy, 252, Math.max), mn252 = roll(spy, 252, Math.min);
const spyDD = spy.map((v, i) => (mx252[i] ? 1 - v / mx252[i] : null));

// Fear & Greed interno (réplica EXACTA del handler de producción)
const sc = loadHandlerScoring();
const fgRaw = C.map((d) => {
  const x = { vix: asOfLevel(S["^VIX"], d), move: asOfLevel(S["^MOVE"], d), vvix: asOfLevel(S["^VVIX"], d),
    spy: asOfChange(S.SPY, d), hyg: asOfChange(S.HYG, d), lqd: asOfChange(S.LQD, d), tnx: asOfChange(S["^TNX"], d) };
  return internalComposite(sc, x)?.score ?? null;
});
const fg5 = fgRaw.map((_, i) => { const v = []; for (let q = Math.max(0, i - 4); q <= i; q++) if (isNum(fgRaw[q])) v.push(fgRaw[q]); return v.length >= 3 ? mean(v) : null; });
const fgPct = pctTrail(fg5);

const cnnMap = new Map((M.cnn?.usable ?? []).map((p) => [p.date, p.rating]));

// del calendario largo al índice del dataset
const K = dates.map((d) => idxC.get(d));
const st = (f) => dates.map((_, i) => { const k = K[i]; if (k < 260) return false; const v = f(k, i); return v === true; });
const ok = (...xs) => xs.every(isNum);

// top-5 del scan de cada día
const rsiT = T.map((t) => { const idx = [], vals = []; for (let i = 0; i < D; i++) if (isNum(t.adj[i])) { idx.push(i); vals.push(t.adj[i]); } const r = rsi14(vals), o = new Array(D).fill(null); idx.forEach((i, q) => { o[i] = r[q]; }); return o; });
const top5Ext = new Array(D).fill(null), top5Rsi = new Array(D).fill(null);
for (let i = 260; i < D; i++) {
  const top = scoreDia(i, sigM189s10, "M189s10").slice(0, 5);
  if (top.length < 5) continue;
  const ex = top.map((c) => T[c.ti].feat[i]?.ext50).filter(isNum), rs = top.map((c) => rsiT[c.ti][i]).filter(isNum);
  if (ex.length >= 4) top5Ext[i] = mean(ex);
  if (rs.length >= 4) top5Rsi[i] = mean(rs);
}

const top5ExtPct = pctTrail(top5Ext);

export const ESTADOS = {
  R1: { nombre: "SPY<EMA200", familia: "RIESGO", on: st((k) => ok(e200[k]) && spy[k] < e200[k]) },
  R2: { nombre: "CRUCE_MUERTE", familia: "RIESGO", on: st((k) => ok(s50[k], s200[k]) && s50[k] < s200[k]) },
  R3: { nombre: "SPY<EMA50", familia: "RIESGO", on: st((k) => ok(e50[k]) && spy[k] < e50[k]) },
  R4: { nombre: "HYG<EMA200", familia: "RIESGO", on: st((k) => ok(hyg[k], hygE200[k]) && hyg[k] < hygE200[k]) },
  R5: { nombre: "VIX>=25", familia: "RIESGO", on: st((k) => ok(vix[k]) && vix[k] >= 25) },
  R6: { nombre: "AMPLITUD<35%", familia: "RIESGO", on: st((k, i) => { const b = breadth(i); return isNum(b) && b < 0.35; }) },
  G1: { nombre: "CODICIA", familia: "CODICIA", on: st((k) => ok(vixPct[k], spyDD[k]) && vixPct[k] <= 0.10 && spyDD[k] <= 0.02) },
  G2: { nombre: "RSI>=70", familia: "CODICIA", on: st((k) => ok(rsiSpy[k]) && rsiSpy[k] >= 70) },
  G3: { nombre: "SPY+10%_EMA200", familia: "CODICIA", on: st((k) => ok(e200[k]) && spy[k] / e200[k] - 1 >= 0.10) },
  G4: { nombre: "FG_CODICIA", familia: "CODICIA", on: st((k) => ok(fgPct[k]) && fgPct[k] >= 0.90) },
  F1: { nombre: "MIEDO", familia: "MIEDO", on: st((k) => ok(vixPct[k], spyDD[k]) && (vixPct[k] >= 0.90 || spyDD[k] >= 0.10)) },
  F2: { nombre: "RSI<=30", familia: "MIEDO", on: st((k) => ok(rsiSpy[k]) && rsiSpy[k] <= 30) },
  F3: { nombre: "FIBO_38", familia: "MIEDO", on: st((k) => ok(mx252[k], mn252[k]) && mx252[k] > mn252[k] && (mx252[k] - spy[k]) / (mx252[k] - mn252[k]) >= 0.382) },
  F4: { nombre: "FG_MIEDO", familia: "MIEDO", on: st((k) => ok(fgPct[k]) && fgPct[k] <= 0.10) },
  F5: { nombre: "CORRECCION_ALCISTA", familia: "MIEDO", on: st((k) => ok(spyDD[k], e200[k]) && spyDD[k] >= 0.05 && spy[k] > e200[k]) },
  K1: { nombre: "TOP5_ESTIRADO", familia: "TOP5", on: st((k, i) => isNum(top5ExtPct[i]) && top5ExtPct[i] >= 0.90) },
  K2: { nombre: "TOP5_NO_ESTIRADO", familia: "TOP5", on: st((k, i) => isNum(top5ExtPct[i]) && top5ExtPct[i] <= 0.10) },
  K3: { nombre: "TOP5_RSI>=70", familia: "TOP5", on: st((k, i) => isNum(top5Rsi[i]) && top5Rsi[i] >= 70) },
  K4: { nombre: "TOP5_RSI<=50", familia: "TOP5", on: st((k, i) => isNum(top5Rsi[i]) && top5Rsi[i] <= 50) },
  CF: { nombre: "CNN_MIEDO_EXTREMO", familia: "CNN", on: dates.map((d) => cnnMap.get(d) === "EXTREME_FEAR") },
  CG: { nombre: "CNN_CODICIA_EXTREMA", familia: "CNN", on: dates.map((d) => cnnMap.get(d) === "EXTREME_GREED") },
};
export const SERIES = { K, spy, e200, e50, s50, s200, rsiSpy, vix, vixPct, spyDD, fg5, fgPct, top5Ext, top5ExtPct, top5Rsi, hyg, hygE200, fidelidadFG: sc.fidelityChecks };

/** Episodios de un estado: grupos de días ON separados por más de `gap` sesiones. */
export function episodiosDe(flag, gap = 60) {
  const ep = new Array(flag.length).fill(-1); let id = -1, last = -1e9;
  for (let i = 0; i < flag.length; i++) if (flag[i]) { if (i - last > gap) id++; ep[i] = id; last = i; }
  return { ep, n: id + 1 };
}

// Uso directo: tabla de frecuencias (NO son resultados de la estrategia; sirve para detectar estados degenerados)
if (import.meta.url === `file://${process.argv[1]}`.replace(/ /g, "%20") || process.argv[1]?.endsWith("estudio12-estados.mjs")) {
  const desde = 350, n = D - desde;
  console.log(`Fidelidad F&G interno: ${sc.fidelityChecks} comprobaciones réplica↔fuente OK · sesiones ${dates[desde]} → ${dates[D - 1]} (${n})`);
  console.log("estado                      días ON    %     episodios  cambios/año");
  for (const [k, e] of Object.entries(ESTADOS)) {
    const dias = e.on.slice(desde).filter(Boolean).length; let cambios = 0;
    for (let i = desde + 1; i < D; i++) if (e.on[i] !== e.on[i - 1]) cambios++;
    const { n: nEp } = episodiosDe(e.on.map((v, i) => i >= desde && v));
    const pct = dias / n;
    const aviso = k[0] !== "C" && (pct < 0.03 || pct > 0.6) ? "  ⚠ DEGENERADO" : "";
    console.log(`${k} ${e.nombre.padEnd(22)} ${String(dias).padStart(6)} ${(pct * 100).toFixed(1).padStart(6)}% ${String(nEp).padStart(8)} ${(cambios / (n / 252)).toFixed(1).padStart(10)}${aviso}`);
  }
}
