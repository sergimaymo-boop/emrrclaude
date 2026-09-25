// Ningún rastro de datos mock/mixtos en la ruta de producción del dashboard (INV-04).
// El conjunto de ficheros se DERIVA del grafo real de imports de src/main.tsx (metafile de
// esbuild): todo módulo que el navegador llega a cargar se revisa, y un componente nuevo entra
// solo — la versión anterior usaba una lista a mano que se pudrió al retirar SectorLeaders.tsx.
// También se revisa el endpoint de cotizaciones visibles y, si existe, el bundle de dist/.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readRepoFile, repoPath, ROOT } from "./validate-harness.mjs";

const { build } = await import("esbuild");
const result = await build({
  entryPoints: [repoPath("src/main.tsx")],
  absWorkingDir: ROOT,
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  logLevel: "silent",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "tesseract.js"],
});
const liveFiles = Object.keys(result.metafile.inputs).filter((file) => !file.includes("node_modules"));
for (const essential of ["src/pages/DashboardPage.tsx", "src/services/realDataRefresh.ts", "src/utils/operationalDataPolicy.ts", "src/components/RallyPanel.tsx"]) {
  assert.ok(liveFiles.includes(essential), `el grafo de producción debe incluir ${essential}`);
}

const forbidden = [
  /\bMOCK\b/, /\bMIXED\b/, /mockData/i, /mockTop8/i, /mockFearGreed/i, /runMockScan/i, /MOCK_FALLBACK/, /MOCK_TOP8/,
  /Mock visual refresh completed/, /Mock scan completed/, /MOCK_READY/, /MOCK_CACHE/, /CNN Fear & Greed \(mock\)/,
];
for (const file of [...liveFiles, "api/visible-top8-quotes.js"]) {
  const source = readRepoFile(file);
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `${file} (ruta de producción) no debe contener ${pattern}`);
  }
}

assert.equal(existsSync(repoPath("src/mocks")), false, "src/mocks no debe existir");
assert.equal(existsSync(repoPath("src/engines/scannerEngine.ts")), false, "scannerEngine (ruta mock) no debe existir");

const distAssets = repoPath("dist/assets");
if (existsSync(distAssets)) {
  for (const file of readdirSync(distAssets).filter((name) => name.endsWith(".js"))) {
    const source = readRepoFile(join("dist/assets", file));
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `dist/assets/${file} no debe contener ${pattern}`);
  }
}

console.log(`Production dashboard no-mock validation OK: ${liveFiles.length} módulos de producción revisados.`);
