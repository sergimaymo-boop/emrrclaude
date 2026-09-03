/**
 * LAB-DAY FASE B — BARRIDO DE SEÑALES (construcción v1.1 fija: K5·SCORE·R63·
 * F45·RESCAN2). Solo cambia la SEÑAL, para aislar el eje.
 *  B1  malla fina ventana×salto del momentum: W {147,168,189,210,231} × skip {0,5,10,15,21}
 *      (escala del score proporcional a W para comparar peras con peras)
 *  B2  fuerza RELATIVA vs SPY (RS 189s10)
 *  B3  mezcla de horizontes M189s10 + M126s10
 *  B4  momentum × proximidad al máximo 252d (George-Hwang)
 *  B5  momentum × consistencia mensual (Grinblatt-Moskowitz, meses verdes de 9)
 *  B6  momentum + aceleración (Δ señal en 63 sesiones)
 * Elegir por TRAIN; confirm no vota. Salida: backtests/lab-day-faseB.json
 */
import fs from "node:fs";
import { evaluar, fila, mom, spyMom, prox252, consistencia, squash, isNum, f1 } from "./lab-day-core.mjs";

const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2" };
const SIGS = [];

// B1 — malla ventana × salto (score con escala proporcional a la ventana)
for (const W of [147, 168, 189, 210, 231])
  for (const skip of [0, 5, 10, 15, 21]) {
    const c = 0.75 * (W / 189);
    SIGS.push({
      key: `M${W}s${skip}`,
      fn: (ti, i) => {
        const m = mom(ti, i, W, skip);
        if (m == null || m <= 0) return null;
        return { score: squash(m, c, c), mRaw: m };
      },
    });
  }
// B2 — fuerza relativa vs SPY
SIGS.push({
  key: "RS189s10",
  fn: (ti, i) => {
    const m = mom(ti, i, 189, 10), ms = spyMom(i, 189, 10);
    if (m == null || ms == null || m <= 0) return null;
    const rs = (1 + m) / (1 + ms) - 1;
    return { score: squash(rs, 0.6, 0.6), mRaw: m };
  },
});
// B3 — mezcla de horizontes (media de squashes; ambos deben ser positivos)
SIGS.push({
  key: "MIX189+126",
  fn: (ti, i) => {
    const a = mom(ti, i, 189, 10), b = mom(ti, i, 126, 10);
    if (a == null || b == null || a <= 0) return null;
    return { score: 0.5 * squash(a, 0.75, 0.75) + 0.5 * squash(b, 0.5, 0.5), mRaw: a };
  },
});
// B4 — momentum × proximidad al máximo 252d
SIGS.push({
  key: "M189s10×PROX",
  fn: (ti, i) => {
    const m = mom(ti, i, 189, 10), p = prox252(ti, i);
    if (m == null || m <= 0 || p == null) return null;
    return { score: 0.7 * squash(m, 0.75, 0.75) + 0.3 * squash(p, 0.92, 0.06), mRaw: m };
  },
});
// B5 — momentum × consistencia mensual
SIGS.push({
  key: "M189s10×CONS",
  fn: (ti, i) => {
    const m = mom(ti, i, 189, 10), c = consistencia(ti, i);
    if (m == null || m <= 0 || c == null) return null;
    return { score: 0.75 * squash(m, 0.75, 0.75) + 0.25 * (c / 9) * 100, mRaw: m };
  },
});
// B6 — momentum + aceleración (señal de hoy vs hace 63 sesiones)
SIGS.push({
  key: "M189s10+ACC",
  fn: (ti, i) => {
    const m = mom(ti, i, 189, 10), m0 = mom(ti, i - 63, 189, 10);
    if (m == null || m <= 0 || m0 == null) return null;
    return { score: 0.8 * squash(m, 0.75, 0.75) + 0.2 * squash(m - m0, 0.10, 0.30), mRaw: m };
  },
});

console.log(`FASE B: ${SIGS.length} señales × 10 fases (construcción fija ${JSON.stringify({ ...BASE, scfg: "F45", wcfg: "SCORE" })})`);
const t0 = Date.now();
const RES = [];
for (const s of SIGS) {
  const r = evaluar({ ...BASE, signalFn: s.fn, sigKey: s.key });
  RES.push({ name: s.key, ...r });
  process.stdout.write(".");
}
console.log(` ${((Date.now() - t0) / 1000).toFixed(0)}s`);

RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("\nseñal                           trWorst  trMean ‖ cfMean cfWorst ‖ riesgo");
for (const r of RES.slice(0, 15)) console.log(fila(r.name, r));
const base = RES.find((r) => r.name === "M189s10");
console.log("─".repeat(120));
console.log(fila("v1.1 (M189s10) — referencia", base));

fs.writeFileSync("backtests/lab-day-faseB.json", JSON.stringify({ ranAt: new Date().toISOString(), construccion: BASE, results: RES }, null, 1));
console.log("\nGuardado: backtests/lab-day-faseB.json");
