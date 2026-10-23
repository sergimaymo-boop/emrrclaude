/**
 * INFORME DE LA CARTERA REAL — herramienta ÚNICA para responder a Sergi (9-sep-2026)
 * ===================================================================================
 * Nació de los dos errores del 9-sep: escribir un script nuevo en /tmp cada vez que
 * pregunta "¿cómo va?" garantizaba repetir fallos. Esto los centraliza y aplica de
 * oficio las NORMAS de la casa:
 *   · precios SOLO por scripts/precios.mjs (validado, ver su cabecera)
 *   · aritmética de cartera = MEDIA PONDERADA (nunca sumar porcentajes)
 *   · las 3 capas obligatorias: rentabilidad sobre capital invertido · movimiento de
 *     los trailings · SUELO GARANTIZADO
 *   · avisos de calidad del dato SIEMPRE visibles (mandato Sergi 9-sep: "avísame
 *     cuando las bases de datos no den bien el dato")
 *   · las cantidades negativas se muestran en % (norma: nunca pérdidas en euros)
 *
 *   node scripts/cartera-informe.mjs
 */
import { cotizar, variacionCartera, maximosDesde } from "./precios.mjs";

// Cartera real: MISMO registro que scripts/cartera_ibk_export.py (REGISTRO) tras las
// compras del 25-sep (HPE nueva, +2.000 €). base = media ponderada de cierres 8-sep y
// compra nueva; coste = precio medio real; entry = desde cuándo se persigue el máximo.
// ⚠ Tras cada rebalanceo hay que actualizar AMBOS ficheros (export.py y este).
const CARTERA = [
  { t: "MRNA", uds: 16.28,  base: 149.34,  coste: 141.94, fx: 1.1578, entry: "2026-09-08" },
  { t: "MU",   uds: 2.42,   base: 1016.07, coste: 992.30, fx: 1.1579, entry: "2026-09-08" },
  { t: "DELL", uds: 4.63,   base: 540.77,  coste: 474.80, fx: 1.1580, entry: "2026-09-08" },
  { t: "WDC",  uds: 5.0004, base: 473.79,  coste: 468.86, fx: 1.1585, entry: "2026-09-08" },
  { t: "INTC", uds: 17.87,  base: 104.47,  coste: 97.84,  fx: 1.1627, entry: "2026-09-08" },
  { t: "HPE",  uds: 6.22,   base: 64.17,   coste: 64.17,  fx: 1.139,  entry: "2026-09-25" },
];
// Efectivo de la última foto (10-oct, sin operaciones desde entonces): se muestra solo
// como contexto del NAV. Si la foto es antigua, el informe lo dice.
const EFECTIVO_EUR = 12112.87, FOTO_EFECTIVO = "10-oct-2026", TRAIL = 0.45;
const f = (x, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
const eur = (x) => `${x.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

const syms = CARTERA.map((p) => p.t);
const q = await cotizar([...syms, "EURUSD=X"]);
const fx = q["EURUSD=X"].precio;
const avisos = Object.values(q).flatMap((x) => x.avisos.map((a) => `${x.sym}: ${a}`));
const enCurso = Object.values(q).some((x) => !x.esCierre && x.sym !== "EURUSD=X");

console.log(`INFORME DE CARTERA · ${new Date().toLocaleString("es-ES")} · ${enCurso ? "⚠ MERCADO ABIERTO (precios en curso, no cierres)" : "cierres de sesión"}`);
console.log(`EUR/USD ${fx.toFixed(4)} · línea base: cierres del 8-sep + compras del 25-sep\n`);

// ── CAPA 1: rentabilidad sobre el capital invertido ───────────────────────────
const vs = (campo) => variacionCartera(CARTERA.map((p) => ({ ticker: p.t, uds: p.uds, precio: q[p.t].precio, precioRef: p[campo] })), fx, fx);
const desdeBase = vs("base"), desdeCoste = vs("coste");
const hoy = variacionCartera(CARTERA.map((p) => ({ ticker: p.t, uds: p.uds, precio: q[p.t].precio, precioRef: q[p.t].cierreAnterior })), fx, fx);

console.log("① RENTABILIDAD SOBRE EL CAPITAL INVERTIDO");
console.log("ticker    uds     base 8-sep    ahora    desde base   hoy      valor      aporta hoy");
for (const p of CARTERA) {
  const b = desdeBase.filas.find((x) => x.ticker === p.t), h = hoy.filas.find((x) => x.ticker === p.t);
  console.log(`${p.t.padEnd(7)} ${String(p.uds).padStart(6)} ${p.base.toFixed(2).padStart(11)} ${q[p.t].precio.toFixed(2).padStart(9)} ${f(b.pct).padStart(11)} ${f(h.pct).padStart(8)} ${eur(b.valor).padStart(10)} ${(h.aportaPp >= 0 ? "+" : "") + h.aportaPp.toFixed(2) + " pp"}`);
}
console.log(`${"CARTERA".padEnd(14)} ${eur(desdeBase.valorRef).padStart(19)} ${eur(desdeBase.valor).padStart(9)} ${f(desdeBase.variacionPct).padStart(11)} ${f(hoy.variacionPct).padStart(8)}`);
console.log(`   (la suma de los % de hoy sería ${f(hoy.sumaPorcentajesINVALIDA)} — NO es una rentabilidad, se ignora)`);
const navHoy = desdeBase.valor + EFECTIVO_EUR;
console.log(`   NAV estimado: ${eur(navHoy)} (invertido ${eur(desdeBase.valor)} + efectivo ${eur(EFECTIVO_EUR)} de la foto del ${FOTO_EFECTIVO}) · umbral de aviso 23.500 €`);
console.log(`   Sobre el capital REALMENTE desembolsado: ${f(desdeCoste.variacionPct)}`);

// ── CAPA 2 y 3: trailings y suelo garantizado ─────────────────────────────────
console.log("\n② TRAILINGS (persiguen el MÁXIMO desde la entrada; IBK ancla al máximo intradía)   ③ SUELO GARANTIZADO si saltasen hoy");
console.log("ticker   máx.intradía (fecha)    stop     margen    suelo vs coste   le falta subir");
const maxs = await maximosDesde(syms, Object.fromEntries(CARTERA.map((p) => [p.t, p.entry])));
let sueloEur = 0, costeEur = 0;
for (const p of CARTERA) {
  const m = maxs[p.t];
  const ancla = Math.max(m.maxIntradia, q[p.t].precio);     // el trailing solo SUBE: nunca por debajo del máximo
  const stop = ancla * (1 - TRAIL);
  sueloEur += p.uds * stop / fx; costeEur += p.uds * p.coste / p.fx;
  const falta = (p.coste / (1 - TRAIL) / ancla - 1) * 100;
  console.log(`${p.t.padEnd(7)} ${ancla.toFixed(2).padStart(9)} (${m.fechaMaxIntradia.slice(5)}) ${stop.toFixed(2).padStart(9)} ${f((stop / q[p.t].precio - 1) * 100).padStart(9)} ${f((stop / p.coste - 1) * 100).padStart(14)}   ${falta > 0 ? `${falta.toFixed(0)}%` : "YA ASEGURA GANANCIA ✓"}`);
}
console.log(`CARTERA: si saltasen TODOS los stops hoy → ${f((sueloEur / costeEur - 1) * 100)} sobre el capital desembolsado`);

// ── CALIDAD DEL DATO (mandato de Sergi) ───────────────────────────────────────
console.log("\n④ CALIDAD DEL DATO");
if (!avisos.length) console.log("   ✅ Sin incidencias: precios validados (cierre fechado, contraste por rango y por vela de 1 minuto).");
else { console.log("   ⚠️ AVISOS DE LAS FUENTES — comunicar a Sergi:"); for (const a of avisos) console.log(`      · ${a}`); }
if (enCurso) console.log("   ℹ️ Mercado abierto: los precios cambiarán hasta el cierre. Para la línea base usar SIEMPRE cierres.");
