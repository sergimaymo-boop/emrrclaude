/**
 * MÉTRICAS EX-COVID + RE-AUDITORÍA DEL STOP (mandato Sergi 3-sep-2026)
 * =====================================================================
 * Sergi: "no tengas en cuenta los años del COVID... fue un cisne negro muy duro
 * que no quiero que cuente para crear el módulo Rally-Test".
 *
 * VENTANA EXCLUIDA (definida por los DATOS, no a ojo): del pico pre-crash del
 * SPY (2020-02-19) a la recuperación de ese mismo nivel (2020-08-10) — 120
 * sesiones, 4,7% de la muestra. ⚠ IDA Y VUELTA COMPLETA: excluir solo el
 * desplome y conservar el rebote sería sesgo grosero (quitar todo el dolor y
 * quedarse toda la recuperación).
 *
 * ⛔ PREMISA FALSA CORREGIDA (auditoría 4-sep-2026) — LEER ANTES DE USAR:
 * este fichero afirmaba que "al excluir el round trip completo, ninguna
 * estrategia gana ni pierde por el mero hecho de la exclusión". Es cierto para
 * el SPY (vuelve a su nivel) pero **FALSO para una cartera de momentum**: v1.1
 * hizo **+42,5% DENTRO de la ventana** (estaba invertida en el rebote).
 * Excluirla NO es neutral: penaliza a quien estuvo invertido y PREMIA a quien
 * estuvo en caja. Con el cortacircuitos de cartera el regalo medido fue de
 * **48,6 pp** de diferencia relativa, convirtiendo un coste real de −8,3 pp/año
 * en un falso "coste cero" de −1,05 pp.
 * ⇒ REGLA: `segMetricsEx` solo vale para comparar estrategias con EXPOSICIÓN
 * EQUIVALENTE durante la ventana. Para cualquier cosa que cambie la exposición
 * (cortacircuitos, overlays, timing, caja), beneficio y coste DEBEN medirse en
 * la MISMA muestra, y esa muestra debe ser la COMPLETA — porque el beneficio de
 * protegerse vive precisamente dentro del crash que se estaría excluyendo.
 *
 * MÉTODO: se EMPALMA la serie de retornos DIARIOS DERIVADOS DE LA CURVA
 * (netRet[i] = curve[i]/curve[i-1] − 1 — la convención correcta de la casa:
 * derivar de la curva incluye los costes de rotación; derivar de `dret` daría
 * CAGR fantasma), saltando la ventana, y se recompone una curva sintética sobre
 * la que se calculan CAGR y drawdown. La simulación NO se altera: la cartera
 * sigue operando durante el COVID (no hay teletransporte de posiciones), solo
 * se omite ese tramo al MEDIR.
 *
 * Se reporta SIEMPRE la doble lectura (con y sin COVID) para que el coste de la
 * suposición sea visible — quitar el peor episodio hace que TODA estrategia
 * parezca mejor de lo que es en la vida real.
 *
 * Salida: backtests/lab-excovid-stop.json
 */
import fs from "node:fs";
import { simular, PHASES10, SPLIT, TO, D, dates, COST_BPS, isNum, mean, sd, segMetrics, f1 } from "./lab-day-core.mjs";

// ─── ventana COVID (índices) ─────────────────────────────────────────────────
export const COVID_A = dates.findIndex((d) => d >= "2020-02-19");
export const COVID_B = dates.findIndex((d) => d >= "2020-08-10");
const enCovid = (i) => i > COVID_A && i <= COVID_B;

/** CAGR + MaxDD sobre el tramo [a,b] EXCLUYENDO la ventana COVID (empalme). */
export function segMetricsEx(curve, a, b) {
  const rets = [];
  for (let i = a + 1; i <= b; i++) {
    if (enCovid(i)) continue;
    const p = curve[i - 1], c = curve[i];
    if (!isNum(p) || !isNum(c) || p <= 0) continue;
    rets.push(c / p - 1);
  }
  if (!rets.length) return { cagr: null, mdd: null, mar: 0, sesiones: 0 };
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; if (eq > peak) peak = eq; const dd = 1 - eq / peak; if (dd > mdd) mdd = dd; }
  const years = rets.length / 252;
  return { cagr: Math.pow(eq, 1 / years) - 1, mdd, mar: mdd > 0 ? (Math.pow(eq, 1 / years) - 1) / mdd : 0, sesiones: rets.length };
}

// ─── barrido del stop, doble lectura ─────────────────────────────────────────
// ⚠ BUG CORREGIDO (auditoría 4-sep-2026): este bloque se ejecutaba COMO EFECTO DE
// IMPORTACIÓN — cualquier script que importara `segMetricsEx` corría el estudio
// entero y SOBRESCRIBÍA backtests/lab-excovid-stop.json (además, siempre al mismo
// nombre, así que una corrida a 20 pb pisaba el artefacto de 50 pb). Ahora solo
// corre cuando el fichero es el punto de entrada.
const esEntrada = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (!esEntrada) { /* importado solo por sus utilidades: no ejecutar el estudio */ }
else await (async () => {
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0 };
const CONFIGS = [
  { name: "SIN stop", scfg: { tipo: "NONE" } },
  ...[0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60].map((w) => ({ name: `F${(w * 100).toFixed(0)}`, scfg: { tipo: "FIJO", w } })),
  ...[1.0, 1.25].map((kv) => ({ name: `ADAPT×${kv}`, scfg: { tipo: "ADAPT", kv, lo: 0.20, hi: 0.60 } })),
];

console.log(`\nVentana COVID excluida: ${dates[COVID_A]} → ${dates[COVID_B]} (${COVID_B - COVID_A} sesiones)`);
console.log(`Costes: ${(COST_BPS * 1e4).toFixed(0)} pb/lado · ${CONFIGS.length} anchuras × ${PHASES10.length} fases\n`);

const RES = CONFIGS.map(({ name, scfg }) => {
  const cells = PHASES10.map((FROM) => {
    const s = simular({ ...BASE, scfg, FROM });
    return {
      // CON covid (convención hasta hoy)
      train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO),
      // EX covid (mandato de Sergi)
      trainEx: segMetricsEx(s.curve, FROM, SPLIT), confirmEx: segMetricsEx(s.curve, SPLIT, TO),
      fullEx: segMetricsEx(s.curve, FROM, TO),
      stopsY: s.stopsY,
    };
  });
  const g = (f, campo) => cells.map((c) => c[f][campo]).filter(isNum);
  return {
    name, scfg, cells,
    // con COVID
    trainWorst: Math.min(...g("train", "cagr")), confirmMean: mean(g("confirm", "cagr")),
    // ex COVID
    trainExWorst: Math.min(...g("trainEx", "cagr")), trainExMean: mean(g("trainEx", "cagr")),
    confirmExMean: mean(g("confirmEx", "cagr")), confirmExWorst: Math.min(...g("confirmEx", "cagr")),
    fullExMean: mean(g("fullEx", "cagr")), fullExDD: Math.max(...g("fullEx", "mdd")),
    fullExMar: mean(cells.map((c) => c.fullEx.mar).filter(isNum)),
    stopsY: mean(cells.map((c) => c.stopsY)),
  };
});

const sin = RES[0];
function pareadoEx(r) {                     // test pareado ex-COVID sobre el periodo COMPLETO
  const d = PHASES10.map((_, k) => r.cells[k].fullEx.cagr - sin.cells[k].fullEx.cagr).filter(isNum);
  const m = mean(d), s = sd(d), se = s / Math.sqrt(d.length);
  return { media: m, t: se > 0 ? m / se : 0, gana: d.filter((x) => x > 0).length, n: d.length };
}
for (const r of RES) r.pareadoEx = pareadoEx(r);

console.log("            ══ EX-COVID (mandato) ══        │ ══ CON COVID ══  │  Δ vs SIN-STOP (ex-COVID, pareado)");
console.log("anchura     trWorst  cfMean   full   DD    MAR │ trWorst  cfMean │   media    t    gana  st/a");
console.log("─".repeat(112));
for (const r of RES) {
  const p = r.pareadoEx;
  const sig = Math.abs(p.t) >= 2 ? "◄" : " ";
  console.log(
    `${r.name.padEnd(11)} ${f1(r.trainExWorst).padStart(7)} ${f1(r.confirmExMean).padStart(7)} ${f1(r.fullExMean).padStart(6)} ${f1(r.fullExDD).padStart(6)} ${r.fullExMar.toFixed(2).padStart(5)} │ ` +
    `${f1(r.trainWorst).padStart(7)} ${f1(r.confirmMean).padStart(7)} │ ${f1(p.media).padStart(7)} ${p.t.toFixed(2).padStart(6)}${sig} ${String(p.gana + "/" + p.n).padStart(6)} ${r.stopsY.toFixed(1).padStart(5)}`
  );
}

console.log("\n═══ EL COSTE DE LA SUPOSICIÓN (lo que cambia al quitar el COVID) ═══");
for (const r of RES) {
  const dTr = r.trainExWorst - r.trainWorst, dCf = r.confirmExMean - r.confirmMean;
  console.log(`  ${r.name.padEnd(11)} train peor-fase ${f1(dTr).padStart(7)} · confirm media ${f1(dCf).padStart(7)}   (ex-COVID − con-COVID)`);
}

const cand = RES.filter((r) => r.name !== "SIN stop");
cand.sort((a, b) => (b.trainExWorst - a.trainExWorst) || (b.trainExMean - a.trainExMean));
console.log(`\n🏆 GANADOR EX-COVID POR TRAIN (criterio de la casa): ${cand[0].name}`);
console.log(`   full ex-COVID ${f1(cand[0].fullExMean)} · DD ${f1(cand[0].fullExDD)} · MAR ${cand[0].fullExMar.toFixed(2)} · Δ vs sin-stop ${f1(cand[0].pareadoEx.media)} (t=${cand[0].pareadoEx.t.toFixed(2)})`);
console.log(`   SIN stop ex-COVID: full ${f1(sin.fullExMean)} · DD ${f1(sin.fullExDD)} · MAR ${sin.fullExMar.toFixed(2)}`);

fs.writeFileSync("backtests/lab-excovid-stop.json", JSON.stringify({
  ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4,
  ventanaCovid: { desde: dates[COVID_A], hasta: dates[COVID_B], sesiones: COVID_B - COVID_A },
  metodo: "empalme de retornos derivados de la CURVA (incluye costes), ida y vuelta completa excluida",
  results: RES,
}, null, 1));
console.log("\nGuardado: backtests/lab-excovid-stop.json");
})();
