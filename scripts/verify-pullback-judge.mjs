// verify-pullback-judge.mjs — LENTE 3 (juez estadístico y de producto).
// Lee backtests/rally-pullback-study.json y deriva, de forma determinista,
// las cifras que fundamentan el juicio sobre el gate y el valor de producto.
// No modifica nada; solo lectura + aritmética.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = JSON.parse(readFileSync(join(ROOT, "backtests", "rally-pullback-study.json"), "utf8"));

const f = (x, d = 4) => Number(x).toFixed(d);
const pct = (x, d = 2) => (100 * x).toFixed(d) + "%";

// ---------- (1) ¿Es la falta de p-valores el problema? Test de dos proporciones
// sobre el lift del decil superior, con n naive y con n deflactado por
// dependencia (solape/cluster por día: deflactores 3x y 10x).
function zTwoProp(p1, n1, p0, n0) {
  const p = (p1 * n1 + p0 * n0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  return (p1 - p0) / se;
}
console.log("(1) Significación del lift observado (decil sup. vs resto), evento E1, confirmación 2022-2026");
for (const popKey of ["ALL", "LEAD50"]) {
  for (const which of ["combo", "individual"]) {
    const e = J.confirmacion[popKey][which];
    const nTop = Math.round(e.n / 10), nRest = e.n - nTop;
    // frecuencia del resto para que la media pondere a la base
    const pRest = (e.base * e.n - e.freqTop * nTop) / nRest;
    for (const defl of [1, 3, 10]) {
      const z = zTwoProp(e.freqTop, nTop / defl, pRest, nRest / defl);
      console.log(`  ${popKey} ${which.padEnd(10)} lift=${f(e.lift, 3)}  n_ef=n/${defl}  z=${f(z, 1)}`);
    }
  }
}

// ---------- (2) Lo que vería el usuario en términos absolutos
console.log("\n(2) Deltas absolutos de probabilidad diaria (confirmación)");
for (const popKey of ["ALL", "LEAD50"]) {
  const e = J.confirmacion[popKey].individual;
  console.log(`  ${popKey}: base ${pct(e.base)} → decil sup. rvol20 ${pct(e.freqTop)} (Δ=+${pct(e.freqTop - e.base)} puntos)`);
}
const conf = J.calibracion.conf;
console.log(`  Rango completo del score (bins 1→10, conf ALL): ${pct(conf[0].freq)} → ${pct(conf[9].freq)}`);

// ---------- (3) Compresión train→conf de la calibración (riesgo "dato incorrecto")
console.log("\n(3) Si se publicara la probabilidad del mapeo train, error relativo por bin en conf:");
for (let i = 0; i < 10; i++) {
  const tr = J.calibracion.train[i], cf = J.calibracion.conf[i];
  // freq puede venir null (bin sin filas) o 0 → dividir daría Infinity/NaN: reportar n/a
  const rel = Number.isFinite(cf.freq) && cf.freq > 0 && Number.isFinite(tr.freq)
    ? (tr.freq - cf.freq) / cf.freq
    : null;
  console.log(`  bin ${String(i + 1).padStart(2)}: train ${pct(tr.freq)}  conf ${pct(cf.freq)}  sobre/infra-estimación ${rel == null ? "n/a" : (100 * rel).toFixed(1) + "%"}`);
}

// ---------- (4) Aviso NO direccional: |mov t+1| > 1×ATR (E1 ∪ U1)
console.log("\n(4) Aviso no direccional 'movimiento fuerte mañana' (conf, universo ALL):");
const bDown = J.confirmacion.ALL.individual.base;      // P(E1)
const bUp = J.controlDireccionalidad.baseU1conf;       // P(U1)
const tDown = J.controlDireccionalidad.decilIndividual.down;
const tUp = J.controlDireccionalidad.decilIndividual.up;
const baseBig = bDown + bUp, topBig = tDown + tUp;     // sucesos disjuntos
console.log(`  P(|mov|>1×ATR) base: ${pct(baseBig)}  |  decil sup. rvol20: ${pct(topBig)}  lift=${f(topBig / baseBig, 2)}×`);
console.log(`  Es decir: la alerta acierta ~1 de cada ${(1 / topBig).toFixed(1)} veces; sin alerta, ~1 de cada ${(1 / baseBig).toFixed(1)}.`);
console.log(`  Simetría down/up en decil sup.: ${pct(tDown)} baja vs ${pct(tUp)} sube (ratio ${f(tDown / tUp, 2)}) → sin sesgo direccional útil.`);

// ---------- (5) LEAD50: mitad reciente (h2) del gate — la población donde se publicaría
const l = J.confirmacion.LEAD50;
console.log("\n(5) Líderes-50, mitad más reciente (2024-04→2026-08):");
console.log(`  combo lift h2 = ${f(l.combo.h2.lift, 2)}× (≈ sin señal)  |  individual h2 = ${f(l.individual.h2.lift, 2)}×`);

// ---------- (6) ¿Cuánta selección hubo en train? (multiplicidad sin corregir)
const nInd = J.indicadores.length, nCombos = J.combos.length, nEv = J.evento.candidatos.length;
console.log(`\n(6) Grados de libertad del investigador: ${nEv} eventos × ${nInd} indicadores × ${nCombos} combos evaluados en train; sin corrección de multiplicidad → el gate OOS estricto es la única defensa.`);
