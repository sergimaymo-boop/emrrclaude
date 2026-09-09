/**
 * ESTUDIO 9 — RALLY-TEST: BÚSQUEDA DE LA MÁXIMA RENTABILIDAD ROBUSTA (9-sep-2026)
 * ================================================================================
 * Mandato Sergi: "auditoría completa al más alto nivel… analiza con todas las
 * estrategias, todos los indicadores, mezclando… el modelo más ganador… utilizando
 * siempre la red del trailing stop (persigue el precio alcista)".
 *
 * ⚠️ PRE-REGISTRO — este fichero se COMMITEA ANTES de ejecutarse (vicio (a) de los
 * estudios 7 y lab-day, señalado dos veces por los auditores: gates no verificables).
 * Ninguna configuración se añade después de ver resultados. Toda comparación que se
 * haga fuera de esta lista es exploratoria y NO adjudica.
 *
 * QUÉ NO SE REPITE (ya refutado, §10c/§10e): ventana×salto del momentum, RS vs SPY,
 * MIX189+126, proximidad a máximos, consistencia, aceleración, RSI/MACD/cruce dorado/
 * volumen, K3-K7, EQ/MRAW/RANKPOW/IVOL, 14 anchuras fijas y adaptativas del stop,
 * cooldowns, JUMP, histéresis, cadencias, overlay de amplitud, cortacircuitos.
 *
 * EJES GENUINAMENTE NUEVOS (hipótesis explícita cada uno):
 *   1 RATCHET   — trailing que SE CIÑE al acumular ganancia (el "suelo móvil" de Sergi
 *                 llevado al límite: asegurar antes lo ganado). Riesgo: cortar a las
 *                 MRNA que pagan la estrategia (patrón F30 refutado).
 *   2 CORRCAP   — tope de valores correlacionados en el top-5 (la cartera real lleva
 *                 59% en un solo bloque). Riesgo: el edge ES la concentración (K5).
 *   3 RESID     — momentum RESIDUAL (beta-ajustado vs SPY, Blitz et al.) puro y como
 *                 inclinación 0,7/0,3. + composite de 3 horizontes (126/189/252 s10).
 *   4 VOLT      — exposición = min(1, objetivo/σ21 del SPY) aplicada en cada reforma
 *                 (cobertura de "momentum crash", Daniel-Moskowitz, SIN apalancar).
 *   5 CAPS      — topes de peso del top-5: [5,50] [15,30] [10,60] [8,45] (v1.1 = [10,40]).
 *   + INTRADÍA  — TODO se evalúa también con trailing sobre HIGH/LOW (réplica del TRAIL
 *                 de IBK que Sergi tiene puesto): es la cifra que él vivirá de verdad.
 *
 * GATES PRE-REGISTRADOS (todos relativos a v1.1 evaluada en la misma corrida):
 *   G1 trainWorst ≥ v1.1 + 2,0 pp  (elegir por TRAIN; mejora material — parsimonia)
 *   G2 confirmMean ≥ v1.1           (confirm no vota, pero NO puede perder)
 *   G3 confirmWorst ≥ v1.1
 *   G4 fasesDistintas = 10/10       (anti-colapso)
 *   G5 ddRealWorst ≤ v1.1 + 5 pp
 *   G6 G1-G5 se cumplen a 20 Y a 50 pb (dos corridas: COST_BPS=20 / COST_BPS=50)
 *   G7 t pareada de confirm vs v1.1 > −1  (no significativamente peor)
 *   G8 en INTRADÍA, trainWorst ≥ v1.1-intradía (la ventaja sobrevive a la ejecución real)
 *   ETAPA 2: solo combinaciones por pares de configs que pasen G1-G5+G7 en esta corrida y
 *   pertenezcan a ejes distintos; mismos gates. Sin parámetros libres nuevos.
 *   GANADOR: entre los que pasan TODO, el de mayor trainWorst a 20 pb (desempate trainMean).
 *   Si nadie pasa → v1.1 queda certificada por tercera vez y no se cambia nada.
 *
 * Salida: backtests/lab-estudio9[-50bp].json · veredicto: scripts/lab-estudio9-veredicto.mjs
 */
import fs from "node:fs";
import {
  evaluar, fila, T, RET, dates, D, spyClose, PHASES10, COST_BPS, mom, squash, memo, isNum, mean, sd, f1,
} from "./lab-day-core.mjs";

const OUT = COST_BPS > 0.003 ? "backtests/lab-estudio9-50bp.json" : "backtests/lab-estudio9.json";
const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2" };
const N = T.length;

// ─── máximos/mínimos AJUSTADOS para el trailing intradía ─────────────────────
console.log("Cargando máximos/mínimos intradía…");
const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8")).series;
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const H = [], L = [];
let barras = 0, corregidas = 0;
for (let ti = 0; ti < N; ti++) {
  const h = new Array(D).fill(null), l = new Array(D).fill(null);
  for (const b of (raw[T[ti].sym]?.bars ?? [])) {
    const k = dateIdx.get(b.d);
    if (k == null || !isNum(b.h) || !isNum(b.l) || !isNum(b.c) || b.c <= 0 || !isNum(b.a)) continue;
    const f = b.a / b.c, adj = T[ti].adj[k];
    let hh = b.h * f, ll = b.l * f;
    if (isNum(adj)) { if (hh < adj) { hh = adj; corregidas++; } if (ll > adj) { ll = adj; corregidas++; } }
    h[k] = hh; l[k] = ll; barras++;
  }
  H.push(h); L.push(l);
}
console.log(`  ${barras.toLocaleString("es-ES")} barras · ${corregidas} recortes high/low al cierre ajustado (${(corregidas / barras * 100).toFixed(2)}%)\n`);
const INTRA = { H, L };

// ─── señales nuevas ──────────────────────────────────────────────────────────
const spyRet = spyClose.map((p, i) => (i > 0 && isNum(p) && isNum(spyClose[i - 1]) && spyClose[i - 1] > 0 ? p / spyClose[i - 1] - 1 : null));
function resid(ti, i, W = 189, skip = 10) {
  return memo(`RES${W}s${skip}:${ti}:${i}`, () => {
    const end = i - skip, start = end - W + 1;
    if (start < 1) return null;
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = start; j <= end; j++) { const y = RET[ti][j], x = spyRet[j]; if (y == null || x == null) continue; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    if (n < W * 0.8) return null;
    const vx = sxx - sx * sx / n, beta = vx > 0 ? (sxy - sx * sy / n) / vx : 1;
    let s = 0;
    for (let j = start; j <= end; j++) { const y = RET[ti][j], x = spyRet[j]; if (y == null || x == null) continue; s += y - beta * x; }
    return s;
  });
}
const sigResid = (ti, i) => { const s = resid(ti, i); return s == null || s <= 0 ? null : { score: squash(s, 0.5, 0.5), mRaw: s }; };
const sigTilt = (ti, i) => {
  const m = mom(ti, i, 189, 10); if (m == null || m <= 0) return null;
  const s = resid(ti, i); if (s == null) return null;
  return { score: 0.7 * squash(m, 0.75, 0.75) + 0.3 * squash(s, 0.5, 0.5), mRaw: m };
};
const sigC3H = (ti, i) => {
  const m1 = mom(ti, i, 126, 10), m2 = mom(ti, i, 189, 10), m3 = mom(ti, i, 252, 10);
  if (m1 == null || m2 == null || m3 == null || m2 <= 0) return null;
  const c = (W) => 0.75 * W / 189;
  return { score: (squash(m1, c(126), c(126)) + squash(m2, c(189), c(189)) + squash(m3, c(252), c(252))) / 3, mRaw: m2 };
};
const spyVol21 = (i) => memo(`SV21:${i}`, () => { const a = []; for (let j = i - 20; j <= i; j++) if (spyRet[j] != null) a.push(spyRet[j]); return a.length >= 15 ? sd(a) * Math.sqrt(252) : null; });
const volTarget = (target) => (i) => { const v = spyVol21(i); return v == null || v <= 0 ? 1 : Math.min(1, target / v); };

// ─── configuraciones PRE-REGISTRADAS ─────────────────────────────────────────
const CONFIGS = [
  { eje: "REF", name: "v1.1 ★", cfg: V11 },
  { eje: "RATCHET", name: "RAT 45→35 @+50%", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[0.5, 0.35]] } } },
  { eje: "RATCHET", name: "RAT 45→30 @+50%", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[0.5, 0.30]] } } },
  { eje: "RATCHET", name: "RAT 45→35 @+100%", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[1.0, 0.35]] } } },
  { eje: "RATCHET", name: "RAT 45→30 @+100%", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[1.0, 0.30]] } } },
  { eje: "RATCHET", name: "RAT 45→35@+50→25@+100", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[0.5, 0.35], [1.0, 0.25]] } } },
  { eje: "RATCHET", name: "RAT 45→40@+30→30@+60→20@+100", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[0.3, 0.40], [0.6, 0.30], [1.0, 0.20]] } } },
  { eje: "RATCHET", name: "RAT 45→25 @+82% (candado)", cfg: { ...V11, scfg: { tipo: "RATCHET", w: 0.45, tramos: [[0.82, 0.25]] } } },
  ...[0.5, 0.6, 0.7].flatMap((rho) => [1, 2].map((max) => ({ eje: "CORRCAP", name: `CORR ρ>${rho} máx ${max}`, cfg: { ...V11, corrCap: { rho, max, win: 126 } } }))),
  { eje: "SEÑAL", name: "RESID189s10 puro", cfg: { ...V11, signalFn: sigResid, sigKey: "RES189s10" } },
  { eje: "SEÑAL", name: "M189s10 + 0,3·RESID", cfg: { ...V11, signalFn: sigTilt, sigKey: "TILTRES" } },
  { eje: "SEÑAL", name: "C3H 126/189/252 s10", cfg: { ...V11, signalFn: sigC3H, sigKey: "C3H" } },
  { eje: "VOLT", name: "VOLT objetivo 25%", cfg: { ...V11, expoFn: volTarget(0.25) } },
  { eje: "VOLT", name: "VOLT objetivo 35%", cfg: { ...V11, expoFn: volTarget(0.35) } },
  { eje: "CAPS", name: "CAPS [5,50]", cfg: { ...V11, wcfg: { modo: "SCORE", lo: 5, hi: 50 } } },
  { eje: "CAPS", name: "CAPS [15,30]", cfg: { ...V11, wcfg: { modo: "SCORE", lo: 15, hi: 30 } } },
  { eje: "CAPS", name: "CAPS [10,60]", cfg: { ...V11, wcfg: { modo: "SCORE", lo: 10, hi: 60 } } },
  { eje: "CAPS", name: "CAPS [8,45]", cfg: { ...V11, wcfg: { modo: "SCORE", lo: 8, hi: 45 } } },
];

// ─── evaluación ──────────────────────────────────────────────────────────────
const tPareada = (r, ref) => { const d = PHASES10.map((_, k) => r.cells[k].confirm.cagr - ref.cells[k].confirm.cagr); const m = mean(d), se = sd(d) / Math.sqrt(d.length); return { media: m, t: se > 0 ? m / se : 0, gana: d.filter((x) => x > 0).length }; };
const gates = (r, ref) => ({
  G1: r.trainWorst >= ref.trainWorst + 0.02 - 1e-12,
  G2: r.confirmMean >= ref.confirmMean - 1e-12,
  G3: r.confirmWorst >= ref.confirmWorst - 1e-12,
  G4: r.fasesDistintas === 10,
  G5: r.ddRealWorst <= ref.ddRealWorst + 0.05 + 1e-12,
});
function correr(list, refClose, refIntra) {
  const out = [];
  for (const c of list) {
    const t0 = Date.now();
    const close = evaluar(c.cfg);
    const intra = evaluar({ ...c.cfg, intradia: INTRA });
    const rc = refClose ?? close, ri = refIntra ?? intra;
    const g = gates(close, rc), tp = tPareada(close, rc);
    const G7 = tp.t > -1;
    const pasa = Object.values(g).every(Boolean) && G7;
    const G8 = intra.trainWorst >= ri.trainWorst - 1e-12;
    const strip = (r) => ({ trainMean: r.trainMean, trainWorst: r.trainWorst, confirmMean: r.confirmMean, confirmWorst: r.confirmWorst, ddRealWorst: r.ddRealWorst, dd2020Worst: r.dd2020Worst, ret2022Mean: r.ret2022Mean, stopsY: r.stopsY, fasesDistintas: r.fasesDistintas, cells: r.cells.map((x) => ({ train: x.train.cagr, confirm: x.confirm.cagr, dd: x.ddRealConfirm })) });
    out.push({ eje: c.eje, name: c.name, close: strip(close), intra: strip(intra), gates: { ...g, G7, G8 }, pasa, tConfirm: tp, ms: Date.now() - t0, _close: close, _intra: intra });
    process.stdout.write(".");
  }
  return out;
}
console.log(`ESTUDIO 9 · ${(COST_BPS * 1e4).toFixed(0)} pb · ${CONFIGS.length} configuraciones pre-registradas × 10 fases × {cierres, intradía}`);
const refRow = correr([CONFIGS[0]])[0];
const RES = [refRow, ...correr(CONFIGS.slice(1), refRow._close, refRow._intra)];
console.log("\n");

const cab = "config                          trWorst  trMean ‖ cfMean cfWorst ‖ riesgo";
console.log("═══ CIERRES (convención canon) ═══");
console.log(cab);
for (const r of RES) console.log(fila(r.name + (r.pasa ? " ✅" : ""), r._close));
console.log("\n═══ INTRADÍA (réplica del TRAIL de IBK — lo que Sergi vive de verdad) ═══");
console.log(cab);
for (const r of RES) console.log(fila(r.name + (r.gates.G8 ? " ✅G8" : ""), r._intra));

// ─── ETAPA 2: combinaciones de los que pasan (ejes distintos) ────────────────
const passers = RES.filter((r) => r.pasa && r.eje !== "REF");
const combos = [];
for (let a = 0; a < passers.length; a++) for (let b = a + 1; b < passers.length; b++) {
  if (passers[a].eje === passers[b].eje) continue;
  const ca = CONFIGS.find((c) => c.name === passers[a].name).cfg, cb = CONFIGS.find((c) => c.name === passers[b].name).cfg;
  combos.push({ eje: "COMBO", name: `${passers[a].name} + ${passers[b].name}`, cfg: { ...ca, ...cb } });
}
let RES2 = [];
if (combos.length) {
  console.log(`\n═══ ETAPA 2 · ${combos.length} combinaciones de los que pasan ═══`);
  RES2 = correr(combos, refRow._close, refRow._intra);
  console.log("\n" + cab);
  for (const r of RES2) console.log(fila(r.name + (r.pasa ? " ✅" : ""), r._close));
} else console.log("\nETAPA 2: sin combinaciones (menos de dos ejes distintos pasan los gates).");

console.log("\n═══ GATES a este coste ═══");
for (const r of [...RES, ...RES2]) if (r.eje !== "REF") console.log(`${r.pasa ? "✅" : "❌"} ${r.name.padEnd(36)} ${Object.entries(r.gates).map(([k, v]) => `${k}${v ? "✓" : "✗"}`).join(" ")} · Δconfirm ${f1(r.tConfirm.media)} t=${r.tConfirm.t.toFixed(2)} (${r.tConfirm.gana}/10)`);

fs.writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, nConfigs: CONFIGS.length, nCombos: combos.length,
  preRegistro: "G1 trainWorst≥v1.1+2pp · G2 cfMean≥v1.1 · G3 cfWorst≥v1.1 · G4 10/10 fases · G5 DD≤v1.1+5pp · G6 a 20 y 50 pb · G7 t>−1 · G8 trainWorst intradía ≥ v1.1 intradía · etapa 2 solo pares de passers de ejes distintos · ganador = mayor trainWorst",
  results: [...RES, ...RES2].map(({ _close, _intra, ...r }) => r),
}, null, 1));
console.log(`\nGuardado: ${OUT}`);
