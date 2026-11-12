/**
 * ESTUDIO 12 — RÉGIMEN DE MERCADO PARA RALLY-TEST: trailing según el ciclo, exposición
 * según el ciclo y momento de carga (12-nov-2026, petición expresa de Sergi)
 * ====================================================================================
 * Rally-Test es PROTEGIDO (§10e): este estudio MIDE. Nada cambia en la estrategia. Un
 * "SUPERA" es un CANDIDATO que necesita ganar una 2.ª auditoría con datos nuevos y el OK
 * de Sergi, y solo se aplicaría en una revisión trimestral.
 *
 * Base: LAB-M189 v1.1 (M189s10 · K5 · SCORE[10,40] · R63 · trailing fijo 45% a cierres ·
 * RESCAN2), dataset canon reparado 2016-08 → 2026-09-01, ensemble de 10 fases, 20 y 50 pb.
 * Estados de régimen: scripts/estudio12-estados.mjs (19 estados + 2 de CNN informativos),
 * calculados con datos ≤ cierre i y aplicados SIEMPRE con un día de retraso.
 *
 * ⚠ GATES PRE-REGISTRADOS — este fichero y el de estados se commitean ANTES de ejecutar
 *   y no se tocan después. Lo que ya se sabía al escribirlos (estudios 3, 9, 10 y 11): los
 *   stops fijos ceñidos hacen whipsaw; recortar exposición con CODICIA o con SPY<EMA200 no
 *   pasó; entrar en MIEDO pasó sus gates con dependencia de caídas en V. Este estudio no
 *   repite esas pruebas tal cual: amplía los estados y prueba mecánicas nuevas.
 *
 * ── U1 · TRAILING SEGÚN EL RÉGIMEN (re-simulación) ───────────────────────────────────
 *   13 estados (R1..R6, G1..G4, K1, K3 y S0 = "siempre", referencia) × anchura ceñida
 *   {15%, 25%, 35%} × 4 mecánicas:
 *     M1a pico      : con el estado ON el trailing pasa de 45% a la anchura ceñida, anclado
 *                     al máximo desde la entrada; al saltar → RESCAN2 (puede recomprar).
 *     M1b re-ancla  : igual, pero al activarse el estado el ancla se pone en el precio de
 *                     ese momento (como recolocar la orden TRAIL en el bróker).
 *     M2a pico+veto : M1a + el ticker que salta no se puede recomprar en 21 sesiones.
 *     M2b re-ancla+veto.
 *   (S0 no tiene re-ancla: 3 anchuras × {sin veto, veto 21} = 6 configs.) Total 150.
 * ── U2 · EXPOSICIÓN SEGÚN EL RÉGIMEN (overlay diario sobre la curva de v1.1) ─────────
 *   12 estados (R1..R6, G1..G4, K1, K3) × exposición con el estado ON {50%, 0%}. El resto
 *   en caja al 0%. Coste COST_BPS·|Δexposición|. Serie derivada de la CURVA (§10c).
 * ── U3 · MOMENTO DE CARGA (sobre la curva de v1.1) ───────────────────────────────────
 *   9 estados (F1..F5, R5, K2, K4 + CF de CNN solo informativo): retorno de la estrategia a
 *   63 sesiones entrando al cierre SIGUIENTE a un día ON, frente a entrar cualquier día; y
 *   política de aportaciones: una aportación cada 21 sesiones, invertida al recibirla (A) o
 *   guardada en caja hasta la primera señal ON, con espera máxima de 126 sesiones (B).
 *   También se informa (sin gate) del retorno tras los estados de CODICIA.
 *
 * GATES U1 y U2 — un candidato SUPERA si cumple a 20 pb Y a 50 pb una de las dos rutas:
 *   Ruta RENTABILIDAD: Δtrain ≥ +2,0 pp · Δconfirm ≥ +2,0 pp · caída máx. (10 años, peor
 *     fase) ≤ base + 5 pp · ≥ 8/10 fases con más CAGR de 10 años que la base.
 *   Ruta PROTECCIÓN:   Δtrain ≥ −1,0 pp · Δconfirm ≥ −1,0 pp · caída máx. ≤ base − 5 pp ·
 *     MAR de 10 años ≥ base + 0,08 · ≥ 8/10 fases con menos caída máx. que la base.
 *   Comunes: año 2022 (media de fases) ≥ base − 3 pp. Solo U1: 10/10 fases distintas
 *     (anti-colapso) y ≤ 4 saltos de stop al año (cada salto obliga a re-escanear a mano).
 *   (Δ = media de las 10 fases del candidato − media de las 10 fases de v1.1.)
 * FASE 2, solo para quien supere la fase 1 (script aparte, mismos umbrales fijados aquí):
 *   · leave-one-out por episodio del estado: apagando CADA episodio debe seguir cumpliendo
 *     su ruta con umbrales a la mitad (RENT +1,0/+1,0 · PROT −1,5/−1,5 y caída −2,5 pp);
 *   · vecinos: misma mecánica y estado con la anchura (o exposición) adyacente → mismo signo
 *     de Δtrain y de Δconfirm (meseta, no pico);
 *   · U1: réplica con trailing INTRADÍA (máximos/mínimos del día);
 *   · ventana nueva 2-sep → 11-nov-2026 (dataset extendido, nunca vista): descriptiva.
 *   Entre finalistas se elige por TRAIN (mayor MAR de train). Confirm no vota.
 * GATES U3 — a 20 pb Y a 50 pb:
 *   C1 exceso a 63 sesiones ≥ +3,0 pp en TRAIN y en CONFIRM por separado (media de fases) y
 *      exceso positivo en ≥ 8/10 fases en cada tramo;
 *   C2 quitando el mejor episodio el exceso global sigue ≥ +1,5 pp, y ≥ 4 episodios positivos;
 *   C3 la política B (esperar la señal) acaba con al menos la misma riqueza que A (invertir al
 *      recibir) en TRAIN y en CONFIRM (media de fases ≥ 1,00) y en ≥ 8/10 fases en cada tramo.
 *   C1+C2 sin C3 = "viento de cola cuando ocurre, pero no compensa esperar con el dinero parado".
 *   C1+C2+C3 = candidato a regla de carga.
 * Sin t de Student: las 10 fases correlacionan 0,92 (n efectivo ≈ 2). Se decide por magnitud
 * y consistencia. Multiplicidad declarada: 150 + 24 + 9 pruebas; por eso se exige train Y
 * confirm, dos costes, vecinos, episodios y una 2.ª auditoría antes de proponer nada.
 *
 * FE DE ERRATAS (12-nov-2026, tras la 1.ª ejecución; los gates NO cambian): el tramo de
 * confirmación de U3 pedía el dato del día TO+1, que no existe → media NaN y la columna
 * "confirm" salía vacía. Corregido acotando el bucle a TO. U1 y U2 no se ven afectados.
 *
 * Salida: backtests/estudio12-regimen[-50bp].json
 */
import fs from "node:fs";
import { simular, PHASES10, SPLIT, TO, I2022b, dates, D, COST_BPS, mean, isNum } from "./lab-day-core.mjs";
import { ESTADOS, episodiosDe } from "./estudio12-estados.mjs";

const OUT = `backtests/estudio12-regimen${COST_BPS > 0.003 ? "-50bp" : ""}.json`;
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0 };
const F45 = { tipo: "FIJO", w: 0.45 };
const f = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
const pp = (x) => (isNum(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}` : "—");
const cagr = (c, a, b) => Math.pow(c[b] / c[a], 252 / (b - a)) - 1;
const mddDe = (c, a, b) => { let p = 0, m = 0; for (let i = a; i <= b; i++) { const v = c[i]; if (v == null) continue; if (v > p) p = v; m = Math.max(m, 1 - v / p); } return m; };
const celda = (c, FROM) => ({ tr: cagr(c, FROM, SPLIT), cf: cagr(c, SPLIT, TO), full: cagr(c, FROM, TO), mdd: mddDe(c, FROM, TO), r22: c[I2022b] / c[SPLIT] - 1 });
function agrega(celdas, extra = {}) {
  const m = (k) => mean(celdas.map((x) => x[k]));
  const mddPeor = Math.max(...celdas.map((x) => x.mdd));
  return { tr: m("tr"), cf: m("cf"), full: m("full"), mddPeor, mar: m("full") / mddPeor, r22: m("r22"), ...extra };
}
function ruta(c, b, celdas, bCeldas, { u1 = false } = {}) {
  const dTr = c.tr - b.tr, dCf = c.cf - b.cf, dMdd = c.mddPeor - b.mddPeor, dMar = c.mar - b.mar;
  const masCagr = celdas.filter((x, k) => x.full > bCeldas[k].full).length, menosDD = celdas.filter((x, k) => x.mdd < bCeldas[k].mdd).length;
  const comunes = c.r22 >= b.r22 - 0.03 && (!u1 || (c.fasesDistintas === 10 && c.stopsY <= 4));
  const rent = dTr >= 0.02 && dCf >= 0.02 && dMdd <= 0.05 && masCagr >= 8 && comunes;
  const prot = dTr >= -0.01 && dCf >= -0.01 && dMdd <= -0.05 && dMar >= 0.08 && menosDD >= 8 && comunes;
  return { dTr, dCf, dMdd, dMar, masCagr, menosDD, comunes, rent, prot, supera: rent || prot };
}

// ── base v1.1 ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
const baseSim = PHASES10.map((FROM) => simular({ ...BASE, scfg: F45, FROM }));
const bCeldas = baseSim.map((s, k) => celda(s.curve, PHASES10[k]));
const base = agrega(bCeldas, { stopsY: mean(baseSim.map((s) => s.stopsY)) });
console.log(`ESTUDIO 12 · ${(COST_BPS * 1e4).toFixed(0)} pb · ${dates[0]} → ${dates[TO]}`);
console.log(`BASE v1.1: train ${f(base.tr)} · confirm ${f(base.cf)} · 10 años ${f(base.full)} · caída máx. (peor fase) ${f(base.mddPeor)} · MAR ${base.mar.toFixed(2)} · 2022 ${f(base.r22)} · saltos/año ${base.stopsY.toFixed(2)}\n`);

// ── U1 · trailing según el régimen ───────────────────────────────────────────
const siempre = new Array(D).fill(true);
const ESTADOS_U1 = ["R1", "R2", "R3", "R4", "R5", "R6", "G1", "G2", "G3", "G4", "K1", "K3"];
const MEC = [["M1a pico", false, 0], ["M1b re-ancla", true, 0], ["M2a pico+veto", false, 21], ["M2b re-ancla+veto", true, 21]];
const cfgsU1 = [];
for (const e of ESTADOS_U1) for (const w of [0.15, 0.25, 0.35]) for (const [mec, reancla, cd] of MEC) cfgsU1.push({ estado: e, nombre: ESTADOS[e].nombre, w, mec, reancla, cd, on: ESTADOS[e].on });
for (const w of [0.15, 0.25, 0.35]) for (const [mec, cd] of [["M1a pico", 0], ["M2a pico+veto", 21]]) cfgsU1.push({ estado: "S0", nombre: "SIEMPRE (referencia)", w, mec, reancla: false, cd, on: siempre });
const U1 = [];
for (const [n, c] of cfgsU1.entries()) {
  const sims = PHASES10.map((FROM) => simular({ ...BASE, cooldown: c.cd, FROM, scfg: { tipo: "REGIMEN", w: 0.45, wTight: c.w, on: (i) => c.on[i] === true, reancla: c.reancla } }));
  const celdas = sims.map((s, k) => celda(s.curve, PHASES10[k]));
  const a = agrega(celdas, { stopsY: mean(sims.map((s) => s.stopsY)), fasesDistintas: new Set(celdas.map((x) => Math.round(x.cf * 1e10))).size });
  U1.push({ estado: c.estado, nombre: c.nombre, wTight: c.w, mec: c.mec, ...a, ...ruta(a, base, celdas, bCeldas, { u1: true }), celdas });
  if ((n + 1) % 10 === 0) process.stderr.write(`  U1 ${n + 1}/${cfgsU1.length} · ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
}

// ── U2 · exposición según el régimen (overlay) ───────────────────────────────
function overlay(curve, FROM, expoDe) {
  const eq = new Array(D).fill(null); eq[FROM] = 1; let ePrev = 1;
  for (let i = FROM + 1; i <= TO; i++) { const e = expoDe(i); eq[i] = eq[i - 1] * (1 + e * (curve[i] / curve[i - 1] - 1) - COST_BPS * Math.abs(e - ePrev)); ePrev = e; }
  return eq;
}
const U2 = [];
for (const e of ESTADOS_U1) for (const x of [0.5, 0]) {
  const on = ESTADOS[e].on;
  const celdas = baseSim.map((s, k) => celda(overlay(s.curve, PHASES10[k], (i) => (on[i - 1] ? x : 1)), PHASES10[k]));
  const a = agrega(celdas);
  U2.push({ estado: e, nombre: ESTADOS[e].nombre, expoOn: x, ...a, ...ruta(a, base, celdas, bCeldas), celdas });
}

// ── U3 · momento de carga ────────────────────────────────────────────────────
const H = 63, ESPERA = 126, CADA = 21;
function carga(e) {
  const on = ESTADOS[e].on, { ep, n: nEp } = episodiosDe(on);
  const tramo = (a, b) => {                       // exceso por fase en [a, b)
    const exc = [];
    for (const [k, FROM] of PHASES10.entries()) {
      const c = baseSim[k].curve, lo = Math.max(a, FROM + 20), todos = [], senal = [];
      for (let i = lo; i + 1 + H <= Math.min(b, TO); i++) { const r = c[i + 1 + H] / c[i + 1] - 1; todos.push(r); if (on[i]) senal.push(r); }
      if (senal.length >= 5) exc.push({ exc: mean(senal) - mean(todos), n: senal.length, mSenal: mean(senal), mTodos: mean(todos), pos: senal.filter((r) => r > 0).length / senal.length });
    }
    return exc;
  };
  const tr = tramo(0, SPLIT), cf = tramo(SPLIT, TO + 1);
  // episodios (muestra completa)
  const porEp = Array.from({ length: nEp }, () => []), sinEp = Array.from({ length: nEp }, () => []), glob = [];
  for (const [k, FROM] of PHASES10.entries()) {
    const c = baseSim[k].curve, todos = [], filas = [];
    for (let i = FROM + 20; i + 1 + H <= TO; i++) { const r = c[i + 1 + H] / c[i + 1] - 1; todos.push(r); if (on[i]) filas.push([ep[i], r]); }
    if (!filas.length) continue;
    const mT = mean(todos); glob.push(mean(filas.map((x) => x[1])) - mT);
    for (let q = 0; q < nEp; q++) {
      const dentro = filas.filter((x) => x[0] === q).map((x) => x[1]), fuera = filas.filter((x) => x[0] !== q).map((x) => x[1]);
      if (dentro.length) porEp[q].push(mean(dentro) - mT);
      if (fuera.length) sinEp[q].push(mean(fuera) - mT);
    }
  }
  const epExc = porEp.map((v) => (v.length ? mean(v) : null));
  const mejor = epExc.reduce((b, v, q) => (v != null && (b < 0 || v > epExc[b]) ? q : b), -1);
  // política de aportaciones
  const politica = (a, fin) => PHASES10.map((FROM, k) => {
    const c = baseSim[k].curve; let wA = 0, wB = 0, n = 0, esperaMedia = 0;
    for (let t = Math.max(a, FROM); t + ESPERA + 1 <= fin; t += CADA) {
      let d = t + ESPERA;
      for (let q = t; q < t + ESPERA; q++) if (on[q]) { d = q + 1; break; }
      wA += c[fin] / c[t]; wB += c[fin] / c[d]; n++; esperaMedia += d - t;
    }
    return n ? { ratio: wB / wA, n, esperaMedia: esperaMedia / n } : null;
  }).filter(Boolean);
  const pTr = politica(0, SPLIT), pCf = politica(SPLIT, TO);
  const r = {
    estado: e, nombre: ESTADOS[e].nombre, diasOn: on.filter(Boolean).length, episodios: nEp,
    train: { exceso: mean(tr.map((x) => x.exc)), fasesPos: tr.filter((x) => x.exc > 0).length, fases: tr.length, mSenal: mean(tr.map((x) => x.mSenal)), mTodos: mean(tr.map((x) => x.mTodos)), pctPos: mean(tr.map((x) => x.pos)) },
    confirm: { exceso: mean(cf.map((x) => x.exc)), fasesPos: cf.filter((x) => x.exc > 0).length, fases: cf.length, mSenal: mean(cf.map((x) => x.mSenal)), mTodos: mean(cf.map((x) => x.mTodos)), pctPos: mean(cf.map((x) => x.pos)) },
    excesoGlobal: mean(glob), episodiosExceso: epExc, episodiosPositivos: epExc.filter((v) => v != null && v > 0).length,
    sinMejorEpisodio: mejor >= 0 && sinEp[mejor].length ? mean(sinEp[mejor]) : null,
    politicaTrain: { ratio: mean(pTr.map((x) => x.ratio)), fasesB: pTr.filter((x) => x.ratio >= 1).length, espera: mean(pTr.map((x) => x.esperaMedia)) },
    politicaConfirm: { ratio: mean(pCf.map((x) => x.ratio)), fasesB: pCf.filter((x) => x.ratio >= 1).length, espera: mean(pCf.map((x) => x.esperaMedia)) },
  };
  r.C1 = r.train.exceso >= 0.03 && r.confirm.exceso >= 0.03 && r.train.fasesPos >= 8 && r.confirm.fasesPos >= 8;
  r.C2 = isNum(r.sinMejorEpisodio) && r.sinMejorEpisodio >= 0.015 && r.episodiosPositivos >= 4;
  r.C3 = r.politicaTrain.ratio >= 1 && r.politicaConfirm.ratio >= 1 && r.politicaTrain.fasesB >= 8 && r.politicaConfirm.fasesB >= 8;
  return r;
}
const U3 = ["F1", "F2", "F3", "F4", "F5", "R5", "K2", "K4", "CF"].map(carga);
const U3codicia = ["G1", "G2", "G3", "G4", "K1", "K3", "CG"].map(carga);

// ── salida ───────────────────────────────────────────────────────────────────
const fila1 = (r) => `${(r.estado + " " + r.nombre).padEnd(26)} ${String((r.wTight ?? r.expoOn) * 100).padStart(3)}% ${(r.mec ?? "").padEnd(18)} train ${pp(r.dTr).padStart(6)} · confirm ${pp(r.dCf).padStart(6)} · caída ${pp(r.dMdd).padStart(6)} · MAR ${r.mar.toFixed(2)} (${pp(r.dMar / 100 * 100)}) · 2022 ${f(r.r22).padStart(7)}${r.stopsY != null ? ` · saltos/año ${r.stopsY.toFixed(1).padStart(4)}` : ""} · fases +CAGR ${r.masCagr}/10 −caída ${r.menosDD}/10 ${r.supera ? (r.rent ? "✅ RENT" : "✅ PROT") : ""}`;
console.log(`── U1 · TRAILING SEGÚN EL RÉGIMEN: ${U1.filter((r) => r.supera).length} de ${U1.length} superan la fase 1 a este coste`);
console.log("   (Δ en puntos porcentuales frente a v1.1; se listan las 12 mejores por Δconfirm y las que superan)");
for (const r of [...U1].sort((a, b) => b.dCf - a.dCf).slice(0, 12)) console.log("   " + fila1(r));
for (const r of U1.filter((x) => x.supera)) console.log(" ✅ " + fila1(r));
console.log(`\n── U2 · EXPOSICIÓN SEGÚN EL RÉGIMEN: ${U2.filter((r) => r.supera).length} de ${U2.length} superan la fase 1 a este coste`);
for (const r of [...U2].sort((a, b) => b.dMar - a.dMar)) console.log("   " + fila1(r));
console.log(`\n── U3 · MOMENTO DE CARGA (retorno de la estrategia a ${H} sesiones tras un día ON vs un día cualquiera)`);
const fila3 = (r) => `${(r.estado + " " + r.nombre).padEnd(26)} días ${String(r.diasOn).padStart(4)} · episodios ${String(r.episodios).padStart(2)} (+${r.episodiosPositivos}) · exceso train ${pp(r.train.exceso).padStart(6)} (${r.train.fasesPos}/${r.train.fases}) · confirm ${pp(r.confirm.exceso).padStart(6)} (${r.confirm.fasesPos}/${r.confirm.fases}) · sin mejor ep. ${pp(r.sinMejorEpisodio).padStart(6)} · esperar/invertir ya: train ${r.politicaTrain.ratio.toFixed(2)} confirm ${r.politicaConfirm.ratio.toFixed(2)} · C1 ${r.C1 ? "✓" : "✗"} C2 ${r.C2 ? "✓" : "✗"} C3 ${r.C3 ? "✓" : "✗"}`;
for (const r of U3) console.log("   " + fila3(r));
console.log("   — tras estados de CODICIA (informativo):");
for (const r of U3codicia) console.log("   " + fila3(r));
fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, dataset: { from: dates[0], to: dates[TO] }, base, U1, U2, U3, U3codicia }, null, 1));
console.log(`\nGuardado ${OUT} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
