// Ejecuta TODOS los scripts/validate-*.mjs, cada uno en su propio proceso (no se detiene en el
// primer fallo), imprime una tabla PASS/FAIL/SKIP y un resumen, y sale con código 1 si alguno falla.
//
//   npm run validate:all                       → suite local completa
//   node scripts/run-all-validators.mjs --include-network   → añade el humo de producción (solo GET)
//   node scripts/run-all-validators.mjs --filter=rally      → solo los que contienen "rally"
//   node scripts/run-all-validators.mjs --verbose           → salida completa de cada validador
//
// Reescrito 25-sep-2026: antes paraba en el PRIMER fallo, así que con ~40 validadores podridos la
// red de seguridad estaba de facto apagada. Por defensa en profundidad, los procesos hijos no
// heredan credenciales de Redis/proveedores/Telegram (los validadores nunca las necesitan).
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, "..");
const args = process.argv.slice(2);
const includeNetwork = args.includes("--include-network");
const verbose = args.includes("--verbose");
const filter = args.find((arg) => arg.startsWith("--filter="))?.slice("--filter=".length);
const TIMEOUT_MS = 180_000;
const CONCURRENCY = Math.max(1, Math.min(6, availableParallelism() - 1));

// Validadores que salen de la máquina: solo con su flag explícito (se listan como SKIP).
const OPT_IN = {
  "validate-vercel-production-deploy.mjs": { flag: "--include-network", reason: "red: GET a producción" },
};

const STRIPPED_ENV = /^(KV_|UPSTASH_|REDIS_|TELEGRAM_|CRON_SECRET$|FINNHUB_|EODHD_|TWELVE_DATA_|FMP_|FRED_|SCAN_SNAPSHOT_SIGNING_SECRET$|VERCEL_TOKEN$)/;
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !STRIPPED_ENV.test(key)));

function firstFailureLine(output) {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const assertion = lines.find((line) => /^AssertionError|^Error|^TypeError|^ReferenceError|^SyntaxError|ERR_[A-Z_]+/.test(line));
  const line = assertion ?? lines.at(-1) ?? "sin salida";
  return line.replace(/^AssertionError \[ERR_ASSERTION\]:\s*/, "").slice(0, 150);
}

function runValidator(file) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    const child = spawn(process.execPath, [join("scripts", file)], { cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("error", (error) => { output += `\n${error.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      const passed = code === 0 && !timedOut;
      resolveRun({
        file,
        status: passed ? "PASS" : "FAIL",
        ms,
        output,
        reason: passed ? "" : timedOut ? `TIMEOUT tras ${TIMEOUT_MS / 1000}s` : firstFailureLine(output),
      });
    });
  });
}

const allFiles = (await readdir(SCRIPTS_DIR))
  .filter((file) => file.startsWith("validate-") && file.endsWith(".mjs"))
  .filter((file) => !filter || file.includes(filter))
  .sort();
const skipped = allFiles
  .filter((file) => OPT_IN[file] && !(OPT_IN[file].flag === "--include-network" && includeNetwork))
  .map((file) => ({ file, status: "SKIP", ms: 0, output: "", reason: `${OPT_IN[file].reason} (usa ${OPT_IN[file].flag})` }));
const toRun = allFiles.filter((file) => !skipped.some((entry) => entry.file === file));

console.log(`Ejecutando ${toRun.length} validadores (${CONCURRENCY} en paralelo)${skipped.length ? `, ${skipped.length} omitidos por opt-in` : ""}…\n`);
const results = [];
const queue = [...toRun];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length > 0) results.push(await runValidator(queue.shift()));
}));

const rows = [...results, ...skipped].sort((a, b) => a.file.localeCompare(b.file));
const nameWidth = Math.max(...rows.map((row) => row.file.length));
for (const row of rows) {
  const time = row.status === "SKIP" ? "     " : `${(row.ms / 1000).toFixed(1).padStart(4)}s`;
  console.log(`${row.status.padEnd(4)}  ${time}  ${row.reason ? `${row.file.padEnd(nameWidth)}  ${row.reason}` : row.file}`);
}

const failed = rows.filter((row) => row.status === "FAIL");
for (const row of verbose ? results : failed) {
  console.log(`\n──── ${row.file} (${row.status}) ────`);
  const lines = row.output.trimEnd().split("\n");
  console.log((verbose ? lines : lines.slice(-25)).join("\n"));
}

const passed = rows.filter((row) => row.status === "PASS").length;
console.log(`\nResumen: ${passed} PASS · ${failed.length} FAIL · ${skipped.length} SKIP (de ${rows.length} validadores)`);
if (failed.length > 0) {
  console.log(`Fallan: ${failed.map((row) => row.file).join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("All validators completed OK.");
}
