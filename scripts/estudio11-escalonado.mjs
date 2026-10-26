/**
 * ESTUDIO 11 — ENTRADA ESCALONADA EN 3 TRAMOS vs TODO DE UNA VEZ (Rally-Test v1.1) · 27-oct-2026
 * =============================================================================================
 * Petición de Sergi: "dame tu mejor modelo". Rally-Test es PROTEGIDO (§10e): este estudio MIDE;
 * un "pasa" es una PROPUESTA (2.ª auditoría + OK de Sergi + aplicar en la revisión trimestral).
 * Origen: la caída de oct-2026 (entrada completa el 8-sep, justo en máximos del sector). Se
 * descartaron como hipótesis nuevas las ya cerradas: tope de correlación (estudio 9: confirm 62,7 vs
 * 64,6, caída igual), volatilidad objetivo, topes de peso, recortar en codicia/tendencia (estudio 10).
 * No hay datos de sector en el universo: no se inventa un tope por sector.
 *
 * ⚠ GATES PRE-REGISTRADOS (commiteados ANTES de ejecutar; no se tocan después):
 *   Estrategia por tramo: v1.1 (M189s10·K5·SCORE·R63·F45·RESCAN2), cada tramo con su propia fase.
 *   LUMP   = todo el capital entra en la sesión s.
 *   TRAMOS = 1/3 en s, 1/3 en s+21, 1/3 en s+42; el capital no desplegado rinde 0% (caja).
 *            Cada tramo es una trayectoria v1.1 independiente que arranca en su sesión (simular FROM).
 *   Se evalúa el AÑO siguiente a la entrada (252 sesiones desde s), con s cada 21 sesiones desde la
 *   sesión 260 hasta TO−294; ambas estrategias sobre las MISMAS fechas. Costes 20 y 50 pb.
 *   Métricas por entrada: retorno a 252 ses. y caída pico-valle máxima dentro del año.
 *   T1  pérdida media de retorno del año ≤ 7,0 pp (la caja cuesta; se tolera hasta aquí)
 *   T2  reducción de P(retorno del año < 0) ≥ 4,0 pp
 *   T3  reducción del percentil 90 de la caída máxima dentro del año ≥ 4,0 pp
 *   T4  T2 y T3 se cumplen TAMBIÉN por separado en las entradas anteriores a 2022 y en las de 2022 en adelante
 *   T5  los cuatro, a 20 pb Y a 50 pb
 * Entradas solapadas (cada 21 sesiones, año de 252): no son independientes; no se calcula t. Se decide por
 * magnitud y consistencia (§10c). NO PASA = no se propone nada.
 */
import fs from "node:fs";
import { simular, TO, SPLIT, dates, COST_BPS } from "./lab-day-core.mjs";

const OUT = `backtests/estudio11-escalonado${COST_BPS > 0.003 ? "-50bp" : ""}.json`;
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0, scfg: { tipo: "FIJO", w: 0.45 } };
const H = 252, STEP = 21;
const cache = new Map();
const curva = (F) => { if (!cache.has(F)) cache.set(F, simular({ ...BASE, FROM: F }).curve); return cache.get(F); };

const entradas = [];
for (let s = 260; s + 2 * STEP + H <= TO; s += STEP) {
  const c0 = curva(s), c1 = curva(s + STEP), c2 = curva(s + 2 * STEP);
  let pkL = 1, ddL = 0, pkT = 1, ddT = 0, vL, vT;
  for (let k = 0; k <= H; k++) {
    const i = s + k;
    vL = c0[i] / c0[s];
    // tramos: cada uno vale su fracción en caja (1/3) hasta su entrada y luego crece con su trayectoria
    const t0 = c0[i] / c0[s];
    const t1 = i < s + STEP ? 1 : c1[i] / c1[s + STEP];
    const t2 = i < s + 2 * STEP ? 1 : c2[i] / c2[s + 2 * STEP];
    vT = (t0 + t1 + t2) / 3;
    pkL = Math.max(pkL, vL); ddL = Math.max(ddL, 1 - vL / pkL);
    pkT = Math.max(pkT, vT); ddT = Math.max(ddT, 1 - vT / pkT);
  }
  entradas.push({ s, fecha: dates[s], lump: { r: vL - 1, dd: ddL }, tramos: { r: vT - 1, dd: ddT } });
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const p90 = (a) => [...a].sort((x, y) => x - y)[Math.floor(0.9 * (a.length - 1))];
function resumen(sub) {
  const L = sub.map((e) => e.lump), T = sub.map((e) => e.tramos);
  return {
    n: sub.length,
    retLump: mean(L.map((x) => x.r)), retTramos: mean(T.map((x) => x.r)),
    pNeg: [L.filter((x) => x.r < 0).length / sub.length, T.filter((x) => x.r < 0).length / sub.length],
    ddP90: [p90(L.map((x) => x.dd)), p90(T.map((x) => x.dd))],
  };
}
const g = (r) => ({
  T1: r.retLump - r.retTramos <= 0.07,
  T2: r.pNeg[0] - r.pNeg[1] >= 0.04,
  T3: r.ddP90[0] - r.ddP90[1] >= 0.04,
});
const todos = resumen(entradas), pre = resumen(entradas.filter((e) => e.s < SPLIT)), post = resumen(entradas.filter((e) => e.s >= SPLIT));
const gt = g(todos), gpre = g(pre), gpost = g(post);
const T4 = gpre.T2 && gpre.T3 && gpost.T2 && gpost.T3;
const pasa = gt.T1 && gt.T2 && gt.T3 && T4;
const f = (x) => (x * 100).toFixed(1) + "%";
console.log(`ESTUDIO 11 · ${(COST_BPS * 1e4).toFixed(0)} pb · ${entradas.length} entradas (cada ${STEP} ses., año de ${H})`);
for (const [n, r] of [["TODAS", todos], ["antes de 2022", pre], ["2022 en adelante", post]]) {
  console.log(`${n.padEnd(17)} n=${String(r.n).padStart(3)} · retorno año: todo-de-una-vez ${f(r.retLump)} vs 3 tramos ${f(r.retTramos)} (Δ ${f(r.retTramos - r.retLump)}) · P(año<0) ${f(r.pNeg[0])} → ${f(r.pNeg[1])} · caída p90 ${f(r.ddP90[0])} → ${f(r.ddP90[1])}`);
}
console.log(`gates (todas): ${JSON.stringify(gt)} · T4 por mitades: ${T4} · ${pasa ? "✅ PASA" : "❌ NO PASA"}`);
fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, todos, pre, post, gt, gpre, gpost, T4, pasa, entradas }, null, 1));
