/**
 * TEST DE REGRESIÓN del módulo de precios — reproduce los DOS bugs del 9-sep-2026
 * y verifica que hoy se detectan. Correr SIEMPRE tras tocar scripts/precios.mjs.
 *   node scripts/test-precios.mjs
 */
import fs from "node:fs";
import { cotizar, cotizarCierres, variacionCartera } from "./precios.mjs";

let fallos = 0;
const ok = (c, msg) => { console.log(`${c ? "✅" : "❌"} ${msg}`); if (!c) fallos++; };

// ── T1: el módulo NO puede leer chartPreviousClose (BUG 1, por inspección) ──────
const src = fs.readFileSync("scripts/precios.mjs", "utf8");
const usos = src.split("\n").filter((l) => l.includes("chartPreviousClose") && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
ok(usos.length === 0, `T1 chartPreviousClose no se usa en código (${usos.length} usos activos)`);

// ── T2: el cierre anterior tiene FECHA y es reciente ───────────────────────────
const c = await cotizar(["DELL", "MRNA"]);
for (const x of Object.values(c)) {
  const dias = Math.round((Date.now() - Date.parse(x.fechaAnterior)) / 86400000);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(x.fechaAnterior) && dias <= 6,
     `T2 ${x.sym}: cierre anterior fechado ${x.fechaAnterior} (hace ${dias} días)`);
}

// ── T3: el dato viene etiquetado cierre/en-curso (BUG 2) ───────────────────────
ok(Object.values(c).every((x) => typeof x.esCierre === "boolean"),
   `T3 cada precio dice si es CIERRE o EN CURSO (ahora: ${Object.values(c)[0].esCierre ? "cierre" : "en curso"})`);

// ── T4: cotizarCierres() se niega a mentir con el mercado abierto ──────────────
{
  const abierto = Object.values(c).some((x) => !x.esCierre);
  let lanzo = false;
  try { await cotizarCierres(["DELL"], { contrastar: false }); } catch { lanzo = true; }
  ok(abierto ? lanzo : !lanzo, `T4 cotizarCierres ${abierto ? "aborta con el mercado abierto" : "devuelve cierres con el mercado cerrado"}`);
}

// ── T5: aritmética de cartera — media ponderada, nunca suma (error de Sergi) ────
{
  const r = variacionCartera([
    { ticker: "A", uds: 1, precio: 110, precioRef: 100 },   // +10%
    { ticker: "B", uds: 1, precio: 110, precioRef: 100 },   // +10%
    { ticker: "C", uds: 1, precio: 110, precioRef: 100 },   // +10%
  ]);
  ok(Math.abs(r.variacionPct - 10) < 1e-9, `T5a tres valores al +10% → cartera +${r.variacionPct.toFixed(2)}% (debe ser 10, no 30)`);
  ok(Math.abs(r.sumaPorcentajesINVALIDA - 30) < 1e-9, `T5b la suma ingenua (30%) se expone marcada como INVÁLIDA`);
}
{
  // ponderación real: un valor grande que sube poco pesa más que uno pequeño que sube mucho
  const r = variacionCartera([
    { ticker: "GRANDE", uds: 100, precio: 101, precioRef: 100 },  // +1% con 100x de peso
    { ticker: "CHICO", uds: 1, precio: 150, precioRef: 100 },     // +50% con 1x
  ]);
  ok(r.variacionPct > 1 && r.variacionPct < 2, `T5c ponderación correcta: +${r.variacionPct.toFixed(2)}% (entre 1 y 2, no 25,5 de media simple)`);
}

// ── T6: guarda de movimiento extremo no confirmado (G4) ────────────────────────
ok(src.includes("VAR_DIARIA_SOSPECHOSA") && src.includes("se aborta (G4)"),
   "T6 existe la guarda que aborta ante un movimiento extremo sin confirmar");
// ── T7: guarda de coherencia entre rangos (G3a) — la que caza el BUG 1 ─────────
ok(src.includes("difiere según el rango") && src.includes("(G3a)"),
   "T7 existe la guarda que aborta si el cierre depende del rango pedido");

// ── T8: estadoSesion — BUG 3 (22-oct-2026): marketState AUSENTE tras el cierre ─
{
  const { estadoSesion } = await import("./precios.mjs");
  const hoy = "2026-10-22", t = (h) => Date.parse(`2026-10-22T${h}Z`);
  const cierreNull = estadoSesion({ estado: null, ultimaFecha: hoy, hoy, horaMercado: "2026-10-22T20:00:01Z", ahora: t("21:09:00") });
  ok(cierreNull.esCierre, "T8a estado ausente, último precio de hace 69 min → CIERRE (no 'mercado abierto')");
  const vivoNull = estadoSesion({ estado: null, ultimaFecha: hoy, hoy, horaMercado: "2026-10-22T16:58:00Z", ahora: t("17:03:00") });
  ok(!vivoNull.esCierre, "T8b estado ausente, último precio de hace 5 min → EN CURSO");
  ok(!estadoSesion({ estado: "REGULAR", ultimaFecha: hoy, hoy, horaMercado: null }).esCierre, "T8c REGULAR → EN CURSO");
  ok(estadoSesion({ estado: "POST", ultimaFecha: hoy, hoy, horaMercado: null }).esCierre, "T8d POST → CIERRE");
  ok(estadoSesion({ estado: "POSTPOST", ultimaFecha: hoy, hoy, horaMercado: null }).esCierre, "T8e POSTPOST → CIERRE");
  ok(estadoSesion({ estado: "PREPRE", ultimaFecha: "2026-10-21", hoy, horaMercado: null }).esCierre, "T8f PREPRE con última barra de ayer → CIERRE");
  ok(estadoSesion({ estado: null, ultimaFecha: "2026-10-21", hoy, horaMercado: null }).esCierre, "T8g sin estado ni hora y última barra de ayer → CIERRE");
}
// ── T9: la variación diaria nunca se calcula contra la propia última barra (BUG 4) ─
ok(Object.values(c).every((x) => x.fechaAnterior < x.fecha), "T9 el cierre anterior es de una sesión ESTRICTAMENTE anterior a la última barra");

// ── T10: maximosDesde — el ancla del trailing nunca queda por debajo del máximo ─
{
  const { maximosDesde } = await import("./precios.mjs");
  const m = await maximosDesde(["MRNA"], "2026-09-08");
  ok(m.MRNA.maxIntradia >= m.MRNA.maxCierre && m.MRNA.sesiones > 20, `T10 MRNA: máx. intradía ${m.MRNA.maxIntradia.toFixed(2)} ≥ máx. cierre ${m.MRNA.maxCierre.toFixed(2)} (${m.MRNA.sesiones} sesiones)`);
}

console.log(`\n${fallos ? `❌ ${fallos} FALLO(S)` : "✅ TODO CORRECTO"} — ${fallos ? "NO usar el módulo hasta arreglarlo" : "el módulo de precios es fiable"}`);
process.exit(fallos ? 1 : 0);
