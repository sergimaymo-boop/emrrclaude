// Carga en runtime (import real, no solo build) cada función serverless de api/ raíz +
// api/cron/, y confirma que expone `export default` (el contrato de handler que exige Vercel).
//
// POR QUÉ EXISTE (23-ago-2026): `npx vite build` solo compila src/ — no toca api/ en
// absoluto. Al mover api/universe.js a api/_lib/, casi se borra el fichero por error: el
// build pasó limpio porque nunca resolvió sus imports, y el fallo real (scan-snapshot.js,
// rally-scan.js y market-breadth.js importan buildUniverseResponse de ahí) solo habría
// aparecido en runtime, en producción, tumbando los tres scans. Este validador resuelve la
// MISMA cadena de imports que carga Vercel al arrancar la función — si algo la rompe
// (export borrado, ruta movida, ciclo, sintaxis), falla aquí, en local, antes del commit.
//
// Qué NO hace: no ejecuta ningún handler (cero llamadas HTTP/Redis/proveedores reales) —
// solo resuelve el grafo de imports de cada módulo. Rápido y sin efectos secundarios.
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_DIR = "api";
const MAX_VERCEL_FUNCTIONS = 12; // plan Hobby — ver CLAUDE.md §12

async function listEndpointFiles() {
  const root = (await readdir(API_DIR, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => join(API_DIR, e.name));
  let cron = [];
  try {
    cron = (await readdir(join(API_DIR, "cron"), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => join(API_DIR, "cron", e.name));
  } catch { /* sin carpeta cron/, no es un error */ }
  return [...root, ...cron].sort();
}

const files = await listEndpointFiles();
if (files.length === 0) {
  console.error("❌ No se encontró ningún fichero .js en api/ — ¿ruta incorrecta?");
  process.exit(1);
}

console.log(`Cargando ${files.length} función(es) serverless (import real, no ejecución de handler)…\n`);

const fallos = [];
for (const file of files) {
  const url = pathToFileURL(resolve(file)).href;
  try {
    const mod = await import(url);
    if (typeof mod.default !== "function") {
      fallos.push({ file, motivo: "no exporta `export default` como función — Vercel no la reconocería como endpoint HTTP" });
      console.log(`  ❌ ${file} — sin export default`);
    } else {
      console.log(`  ✅ ${file}`);
    }
  } catch (err) {
    fallos.push({ file, motivo: err?.message ?? String(err) });
    console.log(`  ❌ ${file} — ${err?.message ?? err}`);
  }
}

console.log("");
if (files.length > MAX_VERCEL_FUNCTIONS) {
  console.error(`❌ ${files.length} funciones en api/ raíz + cron/ — supera el límite de ${MAX_VERCEL_FUNCTIONS} del plan Hobby.`);
  process.exit(1);
}
console.log(`Funciones Vercel: ${files.length}/${MAX_VERCEL_FUNCTIONS}`);

if (fallos.length > 0) {
  console.error(`\n❌ ${fallos.length} de ${files.length} endpoint(s) fallaron al cargar:`);
  for (const f of fallos) console.error(`   - ${f.file}: ${f.motivo}`);
  process.exit(1);
}

console.log(`\n✅ Los ${files.length} endpoints cargan y exponen un handler válido.`);
