/**
 * ESTUDIO 10 — TIMING DE EXPOSICIÓN DE RALLY-TEST (LAB-M189 v1.1) · 26-oct-2026
 * ================================================================================
 * Petición de Sergi: ¿se puede invertir más en miedo extremo y menos en codicia
 * extrema para subir la rentabilidad? Se prueban TRES hipótesis y NO más.
 * Rally-Test es PROTEGIDO (§10e): este estudio solo MIDE; un "pasa" es una PROPUESTA.
 *
 * ⚠ GATES PRE-REGISTRADOS (commiteados ANTES de ejecutar; no se tocan después):
 *
 * Señales (todas con datos ≤ cierre i; efecto desde i+1; sin lookahead):
 *   VIX     = ^VIX diario (Yahoo, relleno hacia delante en festivos).
 *   vixPct  = percentil del VIX de i dentro de sus últimas 252 sesiones (0..1).
 *   spyDD   = 1 − SPY[i] / máx(SPY[i-251..i])           (cierres ajustados)
 *   CODICIA = vixPct ≤ 0,10  Y  spyDD ≤ 0,02            (mercado en máximos con calma)
 *   MIEDO   = vixPct ≥ 0,90  O  spyDD ≥ 0,10            (estrés o corrección)
 *   TEND−   = SPY[i] < media exponencial de 200 sesiones de SPY
 *
 * Hipótesis (una definición por hipótesis; sin barridos de umbrales):
 *   H1  RECORTAR EN CODICIA: exposición 50% el día siguiente a CODICIA, 100% si no.
 *   H2  RECORTAR EN TENDENCIA BAJISTA: exposición 50% si TEND−, 100% si no.
 *   H3  INVERTIR MÁS EN MIEDO: retorno de la estrategia a 63 sesiones DESDE los días
 *       MIEDO frente a todos los días (mide si "entrar en miedo" paga más).
 * El caso base es la propia estrategia v1.1 al 100% (caja = 0% de rendimiento).
 * Overlay sobre netRet derivado de la CURVA (trampa de costes §10c): netRet[i]=curve[i]/curve[i-1]−1;
 * coste = COST_BPS · |Δexposición| por cambio. Beneficio y coste se miden en la MISMA muestra
 * COMPLETA (lección del cortacircuitos del 4-sep: nada de medir con COVID incluido y excluido).
 *
 * GATES H1 y H2 (los dos a 20 pb Y a 50 pb, ensemble de 10 fases, todos obligatorios):
 *   P1  CAGR de confirmación 2022-26 (media de fases) ≥ base − 1,0 pp
 *   P2  CAGR de train (media de fases) ≥ base − 1,0 pp
 *   P3  caída pico-valle de la muestra completa (peor fase) ≤ base − 5,0 pp
 *   P4  MAR completo (CAGR/MaxDD) ≥ base + 0,08
 *   P5  leave-one-out por episodio de señal: quitando CUALQUIER episodio (grupo de días de
 *       señal separados >60 sesiones) se siguen cumpliendo P1 y P3
 *   P6  mejora en ≥ 8 de 10 fases en MAR completo (ojo: las fases correlacionan 0,92; n efectivo ≈ 2)
 * GATE H3 (a 20 pb): sobre el conjunto de fases, retorno medio a 63 sesiones tras días MIEDO
 *   supera al de todos los días en ≥ +3,0 pp, en ≥ 8/10 fases, Y sigue ≥ +1,5 pp quitando el
 *   mejor episodio de MIEDO, Y hay ≥ 4 episodios de MIEDO con exceso positivo.
 * Un único "pasa" no basta: se exige que NINGÚN gate quede dudoso por episodio único (§10c estudio 9).
 * Veredicto "NO PASA" = no se propone nada. "PASA" = PROPUESTA a Sergi, aplicable solo en la
 * revisión trimestral con su OK, tras 2 auditorías seguidas (persistencia §10c).
 */
import fs from "node:fs";
import { simular, PHASES10, SPLIT, TO, dates, D, spyClose, COST_BPS, segMetrics, mean, isNum } from "./lab-day-core.mjs";

const OUT = `backtests/estudio10-timing${COST_BPS > 0.003 ? "-50bp" : ""}.json`;
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0, scfg: { tipo: "FIJO", w: 0.45 } };

// ── VIX alineado por fecha ───────────────────────────────────────────────────
async function cargaVix() {
  const cache = "/private/tmp/claude-501/estudio10-vix.json";
  let j;
  if (fs.existsSync(cache)) j = JSON.parse(fs.readFileSync(cache, "utf8"));
  else {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=12y&interval=1d", { headers: { "User-Agent": "Mozilla/5.0" } });
    j = await r.json(); fs.mkdirSync("/private/tmp/claude-501", { recursive: true }); fs.writeFileSync(cache, JSON.stringify(j));
  }
  const res = j.chart.result[0], ts = res.timestamp, c = res.indicators.quote[0].close;
  const m = new Map(); ts.forEach((t, i) => { if (isNum(c[i])) m.set(new Date(t * 1000).toISOString().slice(0, 10), c[i]); });
  const out = new Array(D).fill(null); let last = null;
  for (let i = 0; i < D; i++) { if (m.has(dates[i])) last = m.get(dates[i]); out[i] = last; }
  return out;
}
const VIX = await cargaVix();

// ── señales ──────────────────────────────────────────────────────────────────
const vixPct = new Array(D).fill(null), spyDD = new Array(D).fill(null), tendNeg = new Array(D).fill(false);
{
  let ema = null; const k = 2 / 201;
  for (let i = 0; i < D; i++) {
    const s = spyClose[i];
    if (isNum(s)) ema = ema == null ? s : s * k + ema * (1 - k);
    if (i >= 251 && isNum(VIX[i])) { let le = 0, n = 0; for (let q = i - 251; q <= i; q++) if (isNum(VIX[q])) { n++; if (VIX[q] <= VIX[i]) le++; } if (n > 200) vixPct[i] = le / n; }
    if (i >= 251 && isNum(s)) { let mx = 0; for (let q = i - 251; q <= i; q++) if (isNum(spyClose[q]) && spyClose[q] > mx) mx = spyClose[q]; spyDD[i] = 1 - s / mx; }
    tendNeg[i] = i >= 200 && isNum(s) && ema != null && s < ema;
  }
}
const CODICIA = dates.map((_, i) => vixPct[i] != null && spyDD[i] != null && vixPct[i] <= 0.10 && spyDD[i] <= 0.02);
const MIEDO = dates.map((_, i) => vixPct[i] != null && spyDD[i] != null && (vixPct[i] >= 0.90 || spyDD[i] >= 0.10));

// episodios = grupos de días de señal separados > 60 sesiones
function episodios(flag) {
  const ep = new Array(D).fill(-1); let id = -1, last = -999;
  for (let i = 0; i < D; i++) if (flag[i]) { if (i - last > 60) id++; ep[i] = id; last = i; }
  return { ep, n: id + 1 };
}
const EPC = episodios(CODICIA), EPM = episodios(MIEDO), EPT = episodios(tendNeg);

// ── overlay ──────────────────────────────────────────────────────────────────
function overlay(curve, FROM, expoFn) {   // expoFn(i) = exposición para el día i (señal de i-1)
  const eq = new Array(D).fill(null); eq[FROM] = 1; let ePrev = 1, peak = 1, mdd = 0;
  for (let i = FROM + 1; i < D; i++) {
    const net = curve[i] / curve[i - 1] - 1; const e = expoFn(i);
    eq[i] = eq[i - 1] * (1 + e * net - COST_BPS * Math.abs(e - ePrev)); ePrev = e;
    if (eq[i] > peak) peak = eq[i]; mdd = Math.max(mdd, 1 - eq[i] / peak);
  }
  return { eq, mdd };
}
const yrs = (a, b) => (b - a) / 252;
const cagr = (eq, a, b) => Math.pow(eq[b] / eq[a], 1 / yrs(a, b)) - 1;

function evalH(nombre, flag, ep, nEp, skipEp = -2) {
  const filas = PHASES10.map((FROM) => {
    const s = simular({ ...BASE, FROM });
    const base = { eq: s.curve, mdd: (() => { let p = 0, m = 0; for (let i = FROM; i < D; i++) { const v = s.curve[i]; if (v == null) continue; if (v > p) p = v; m = Math.max(m, 1 - v / p); } return m; })() };
    const ov = overlay(s.curve, FROM, (i) => (flag[i - 1] && ep[i - 1] !== skipEp ? 0.5 : 1));
    return {
      FROM,
      base: { cf: cagr(base.eq, SPLIT, TO), tr: cagr(base.eq, FROM, SPLIT), full: cagr(base.eq, FROM, TO), mdd: base.mdd },
      ov: { cf: cagr(ov.eq, SPLIT, TO), tr: cagr(ov.eq, FROM, SPLIT), full: cagr(ov.eq, FROM, TO), mdd: ov.mdd },
    };
  });
  const m = (f) => mean(filas.map(f));
  const r = {
    nombre, episodios: nEp, diasSenal: flag.filter(Boolean).length,
    base: { cf: m((x) => x.base.cf), tr: m((x) => x.base.tr), full: m((x) => x.base.full), mddPeor: Math.max(...filas.map((x) => x.base.mdd)) },
    ov: { cf: m((x) => x.ov.cf), tr: m((x) => x.ov.tr), full: m((x) => x.ov.full), mddPeor: Math.max(...filas.map((x) => x.ov.mdd)) },
    fasesMejoranMAR: filas.filter((x) => x.ov.full / x.ov.mdd > x.base.full / x.base.mdd).length,
  };
  r.marBase = r.base.full / r.base.mddPeor; r.marOv = r.ov.full / r.ov.mddPeor;
  r.dCf = r.ov.cf - r.base.cf; r.dTr = r.ov.tr - r.base.tr; r.dMdd = r.ov.mddPeor - r.base.mddPeor; r.dMar = r.marOv - r.marBase;
  return r;
}
const gate = (r) => ({
  P1: r.dCf >= -0.01, P2: r.dTr >= -0.01, P3: r.dMdd <= -0.05, P4: r.dMar >= 0.08, P6: r.fasesMejoranMAR >= 8,
});

const RES = {};
for (const [nombre, flag, E] of [["H1 recortar en CODICIA", CODICIA, EPC], ["H2 recortar en TENDENCIA BAJISTA", tendNeg, EPT]]) {
  const r = evalH(nombre, flag, E.ep, E.n);
  r.gates = gate(r);
  // P5 leave-one-out por episodio
  r.loo = [];
  for (let e = 0; e < E.n; e++) { const x = evalH(nombre, flag, E.ep, E.n, e); r.loo.push({ sinEpisodio: e, dCf: x.dCf, dMdd: x.dMdd }); }
  r.gates.P5 = r.loo.every((x) => x.dCf >= -0.015 && x.dMdd <= -0.03);   // P5: ni P1 ni P3 dependen de un episodio
  r.pasa = Object.values(r.gates).every(Boolean);
  RES[nombre] = r;
}

// ── H3: invertir más en miedo ────────────────────────────────────────────────
const H = 63, fw = [];
for (const FROM of PHASES10) {
  const s = simular({ ...BASE, FROM });
  const all = [], por = new Map(); let fearAll = [];
  for (let i = FROM + 252; i + H <= TO; i++) {
    const r = s.curve[i + H] / s.curve[i] - 1; all.push(r);
    if (MIEDO[i]) { fearAll.push(r); const e = EPM.ep[i]; (por.get(e) ?? por.set(e, []).get(e)).push(r); }
  }
  const mAll = mean(all);
  const eps = [...por.entries()].map(([e, v]) => ({ e, n: v.length, exceso: mean(v) - mAll }));
  const exc = mean(fearAll) - mAll;
  const sinMejor = eps.length > 1 ? (() => { const peor = eps.sort((a, b) => b.exceso - a.exceso)[0].e; const rest = [...por.entries()].filter(([e]) => e !== peor).flatMap(([, v]) => v); return mean(rest) - mAll; })() : null;
  fw.push({ FROM, mediaTodos: mAll, mediaMiedo: mean(fearAll), exceso: exc, excesoSinMejorEpisodio: sinMejor, episodiosPositivos: eps.filter((x) => x.exceso > 0).length, episodios: eps.length, n: fearAll.length });
}
const h3 = {
  fases: fw, excesoMedio: mean(fw.map((x) => x.exceso)), fasesConExceso3pp: fw.filter((x) => x.exceso >= 0.03).length,
  excesoSinMejor: mean(fw.map((x) => x.excesoSinMejorEpisodio).filter(isNum)), episodiosPositivosMin: Math.min(...fw.map((x) => x.episodiosPositivos)),
};
h3.gates = { exceso3pp: h3.excesoMedio >= 0.03, fases8de10: h3.fasesConExceso3pp >= 8, sinMejor1_5pp: h3.excesoSinMejor >= 0.015, episodios4: h3.episodiosPositivosMin >= 4 };
h3.pasa = Object.values(h3.gates).every(Boolean);
RES.H3 = h3;

const f = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
console.log(`ESTUDIO 10 · ${(COST_BPS * 1e4).toFixed(0)} pb · señales: CODICIA ${CODICIA.filter(Boolean).length} días (${EPC.n} episodios) · MIEDO ${MIEDO.filter(Boolean).length} días (${EPM.n} episodios) · TEND− ${tendNeg.filter(Boolean).length} días`);
for (const k of ["H1 recortar en CODICIA", "H2 recortar en TENDENCIA BAJISTA"]) {
  const r = RES[k];
  console.log(`\n${k}  → ${r.pasa ? "✅ PASA" : "❌ NO PASA"}  gates ${JSON.stringify(r.gates)}`);
  console.log(`  confirm ${f(r.base.cf)} → ${f(r.ov.cf)} (${f(r.dCf)}) · train ${f(r.base.tr)} → ${f(r.ov.tr)} (${f(r.dTr)}) · full ${f(r.base.full)} → ${f(r.ov.full)}`);
  console.log(`  DD peor fase ${f(r.base.mddPeor)} → ${f(r.ov.mddPeor)} (${f(r.dMdd)}) · MAR ${r.marBase.toFixed(2)} → ${r.marOv.toFixed(2)} · fases que mejoran MAR ${r.fasesMejoranMAR}/10`);
}
console.log(`\nH3 invertir más en MIEDO → ${h3.pasa ? "✅ PASA" : "❌ NO PASA"} gates ${JSON.stringify(h3.gates)}`);
console.log(`  exceso medio a 63 ses. tras MIEDO ${f(h3.excesoMedio)} · fases ≥+3pp ${h3.fasesConExceso3pp}/10 · sin el mejor episodio ${f(h3.excesoSinMejor)} · episodios positivos (mín.) ${h3.episodiosPositivosMin}`);
fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, res: RES }, null, 1));
console.log(`\nGuardado ${OUT}`);
