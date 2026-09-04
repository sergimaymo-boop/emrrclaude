/**
 * "RED PARA DORMIR TRANQUILOS" — cortacircuitos de cartera (mandato Sergi 4-sep-2026)
 * ===================================================================================
 * Sergi: "necesitamos red para dormir tranquilos dentro de lo malo cuando ocurra".
 *
 * DIAGNÓSTICO PREVIO: el trailing 45% actual protege POSICIÓN A POSICIÓN, no la
 * cartera. En un crash todo cae a la vez y el stop llega tarde: durante el COVID
 * la cartera hizo −47% CON el stop puesto. Para dormir hace falta otra cosa.
 *
 * MECANISMO NUEVO (no usado por ningún otro módulo — Supreme usa régimen SPY-EMA200,
 * esto es un stop sobre el EQUITY del propio módulo):
 *   · Si el equity cae `dd` desde su máximo → LIQUIDAR TODO a caja.
 *   · Reentrada: tras N sesiones (DELAY) o cuando la amplitud del universo se
 *     recupera (BREADTH, % de tickers con momentum 63d positivo).
 *   · Al reentrar se re-ancla el pico (si no, un crash dejaría el interruptor
 *     disparado para siempre).
 *
 * EJES: dd {10,12,15,20,25}% × reentrada {DELAY 10/21/42, BREADTH 40/50%}
 * Base: v1.1 (M189s10 · K5 · SCORE · R63 · trailing F45 · RESCAN2).
 *
 * MÉTRICAS CLAVE PARA "DORMIR": no la media, sino el DOLOR — DD real pico-valle,
 * DD del COVID, DD del 2022, peor año, y el coste en rentabilidad de la red.
 * Doble lectura con y sin COVID (mandato del 3-sep). Test pareado vs v1.1.
 *
 * Salida: backtests/lab-red-dormir[-50bp].json
 */
import fs from "node:fs";
import {
  simular, PHASES10, SPLIT, TO, dates, D, COST_BPS, isNum, mean, sd, segMetrics,
  ddReal, retSeg, mom, memo, T, f1,
} from "./lab-day-core.mjs";
import { segMetricsEx, COVID_A, COVID_B } from "./lab-excovid.mjs";

const OUT = COST_BPS > 0.003 ? "backtests/lab-red-dormir-50bp.json" : "backtests/lab-red-dormir.json";
const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2" };

const N = T.length;
function breadth63(i) {
  return memo(`b63:${i}`, () => {
    let pos = 0, tot = 0;
    for (let ti = 0; ti < N; ti++) {
      if (!isNum(T[ti].adj[i])) continue;
      const m = mom(ti, i, 63, 0);
      if (m == null) continue;
      tot++; if (m > 0) pos++;
    }
    return tot >= 100 ? pos / tot : null;
  });
}

const CONFIGS = [{ name: "v1.1 SIN red", cfg: V11 }];
for (const dd of [0.10, 0.12, 0.15, 0.20, 0.25]) {
  for (const n of [10, 21, 42])
    CONFIGS.push({ name: `DD${(dd * 100).toFixed(0)}·espera${n}`, cfg: { ...V11, breaker: { dd, reentry: { tipo: "DELAY", n } } } });
  for (const umbral of [0.40, 0.50])
    CONFIGS.push({ name: `DD${(dd * 100).toFixed(0)}·amplitud${(umbral * 100).toFixed(0)}`, cfg: { ...V11, breaker: { dd, reentry: { tipo: "BREADTH", umbral, fn: breadth63 } } } });
}

// peor año natural de la curva (lo que de verdad quita el sueño)
const AÑOS = [...new Set(dates.map((d) => d.slice(0, 4)))].filter((y) => y >= "2017");
function peorAño(curve, FROM) {
  let peor = Infinity, cual = null;
  for (const y of AÑOS) {
    const a = dates.findIndex((d) => d >= `${y}-01-01`), b0 = dates.findIndex((d) => d >= `${+y + 1}-01-01`);
    const b = b0 < 0 ? TO : b0 - 1;
    if (a < FROM || b <= a) continue;
    const r = retSeg(curve, a, b);
    if (isNum(r) && r < peor) { peor = r; cual = y; }
  }
  return { peor: isFinite(peor) ? peor : null, año: cual };
}

console.log(`RED PARA DORMIR (${(COST_BPS * 1e4).toFixed(0)} pb) — ${CONFIGS.length} configuraciones × ${PHASES10.length} fases\n`);
const RES = CONFIGS.map(({ name, cfg }) => {
  const cells = PHASES10.map((FROM) => {
    const s = simular({ ...cfg, FROM });
    const py = peorAño(s.curve, FROM);
    return {
      train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO),
      fullEx: segMetricsEx(s.curve, FROM, TO), trainEx: segMetricsEx(s.curve, FROM, SPLIT),
      fullCon: segMetrics(s.curve, FROM, TO),   // muestra COMPLETA: el coste honesto
      ddFull: ddReal(s.curve, FROM, TO, FROM),
      ddCovid: ddReal(s.curve, Math.max(COVID_A, FROM), COVID_B, FROM),
      ret2022: retSeg(s.curve, SPLIT, dates.findIndex((d) => d >= "2023-01-01") - 1),
      peorAño: py.peor, añoMalo: py.año,
      disparos: s.disparos ?? 0, pctFuera: s.pctFuera ?? 0,
    };
  });
  const g = (f, c) => cells.map((x) => x[f][c]).filter(isNum);
  // ⚠ GUARDA ANTI-COLAPSO (auditoría 4-sep-2026): este script armaba sus celdas a
  // mano y NO llamaba a evaluar(), saltándose la guarda del núcleo. Cualquier regla
  // a nivel de CARTERA colapsa el ensemble por construcción (liquida en las mismas
  // fechas en todas las fases → UNA sola trayectoria), fingiendo una potencia
  // estadística inexistente. Con <10/10 el resultado NO es adjudicable.
  const fasesDistintas = new Set(cells.map((c) => Math.round(c.confirm.cagr * 1e10))).size;
  return {
    name, cells, fasesDistintas,
    fullExMean: mean(g("fullEx", "cagr")), trainExWorst: Math.min(...g("trainEx", "cagr")),
    confirmMean: mean(g("confirm", "cagr")), trainWorst: Math.min(...g("train", "cagr")),
    ddFullWorst: Math.max(...cells.map((c) => c.ddFull)),
    ddCovidWorst: Math.max(...cells.map((c) => c.ddCovid)),
    ret2022Mean: mean(cells.map((c) => c.ret2022).filter(isNum)),
    peorAñoMedio: mean(cells.map((c) => c.peorAño).filter(isNum)),
    disparosAño: mean(cells.map((c) => c.disparos)) / ((TO - 305) / 252),
    pctFuera: mean(cells.map((c) => c.pctFuera)),
  };
});

const base = RES[0];
for (const r of RES) {
  const d = PHASES10.map((_, k) => r.cells[k].fullEx.cagr - base.cells[k].fullEx.cagr).filter(isNum);
  const m = mean(d), se = sd(d) / Math.sqrt(d.length);
  r.costeMedio = m; r.tCoste = se > 0 ? m / se : 0;
  // COSTE COHERENTE: misma muestra que el beneficio (completa, con COVID). Es el
  // número honesto para una regla que CAMBIA LA EXPOSICIÓN durante el crash.
  const dCon = PHASES10.map((_, k) => {
    const a = base.cells[k], b = r.cells[k];
    return (b.fullCon ?? null) != null && (a.fullCon ?? null) != null ? b.fullCon.cagr - a.fullCon.cagr : null;
  }).filter(isNum);
  if (dCon.length) {
    const mc = mean(dCon), sec = sd(dCon) / Math.sqrt(dCon.length);
    r.costeConCovid = mc; r.tCosteConCovid = sec > 0 ? mc / sec : 0;
  }
}

console.log("config                 fullEx  trExWorst │ DDreal  DDcovid  2022   peorAño │ coste  t     disp/a  %fuera");
console.log("─".repeat(118));
for (const r of RES) {
  console.log(
    `${r.name.padEnd(22)} ${f1(r.fullExMean).padStart(6)} ${f1(r.trainExWorst).padStart(9)} │ ` +
    `${f1(r.ddFullWorst).padStart(6)} ${f1(r.ddCovidWorst).padStart(7)} ${f1(r.ret2022Mean).padStart(6)} ${f1(r.peorAñoMedio).padStart(8)} │ ` +
    `${f1(r.costeMedio).padStart(6)} ${r.tCoste.toFixed(1).padStart(5)} ${r.disparosAño.toFixed(1).padStart(6)} ${(r.pctFuera * 100).toFixed(0).padStart(6)}%` +
    (r.fasesDistintas < 10 ? `  ⚠COLAPSO ${r.fasesDistintas}/10` : "")
  );
}
console.log("\n⚠ Las filas COLAPSO tienen n efectivo < 10 → NO adjudicables (regla del laboratorio).");
console.log("⚠ El coste mostrado es EX-COVID: para reglas que cambian la exposición eso REGALA el crash");
console.log("  al que se protege. El coste coherente (muestra completa) está en el JSON como costeConCovid.");

console.log("\n═══ LA PREGUNTA DE SERGI: ¿cuánto cuesta dormir tranquilo? ═══");
const conRed = RES.filter((r) => r.name !== "v1.1 SIN red");
conRed.sort((a, b) => a.ddFullWorst - b.ddFullWorst);
console.log("Ordenado por MENOR caída máxima (lo que quita el sueño):\n");
console.log("config                 DDreal  (vs v1.1)  │ coste rentabilidad/año  │ COVID  peorAño");
for (const r of conRed.slice(0, 8)) {
  console.log(`  ${r.name.padEnd(22)} ${f1(r.ddFullWorst).padStart(6)} (${f1(r.ddFullWorst - base.ddFullWorst).padStart(6)}) │ ${f1(r.costeMedio).padStart(8)} (t=${r.tCoste.toFixed(1).padStart(5)})      │ ${f1(r.ddCovidWorst).padStart(6)} ${f1(r.peorAñoMedio).padStart(7)}`);
}
console.log(`\n  v1.1 SIN red           ${f1(base.ddFullWorst)}          │        —              │ ${f1(base.ddCovidWorst)} ${f1(base.peorAñoMedio)}`);

fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, results: RES }, null, 1));
console.log(`\nGuardado: ${OUT}`);
