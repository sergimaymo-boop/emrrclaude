// Rally Leaders / Rally-Test sin datos simulados (INV-04):
//   · Estático: endpoint, batch processors y motores (producción y laboratorio) no contienen
//     rutas de datos mock/sintéticos/demo (comentarios excluidos).
//   · Comportamiento: si TODOS los proveedores fallan, el scan termina honesto — top-10 vacío y
//     todos los tickers contados como fallidos — y jamás rellena con tickers inventados.
// Reescrito 25-sep-2026: antes leía api/rally-scan/{start,continue}.js, que ya no existen.
import assert from "node:assert/strict";
import { loadOperableUniverse, prepareScanFixtures, readRepoFile, repoUrl, runRallyScan, stripComments } from "./validate-harness.mjs";

const files = [
  "api/rally-scan.js",
  "api/_lib/rallyBatchProcessor.js",
  "api/_lib/rallyScoreEngine.js",
  "api/_lib/rallyBatchProcessorTest.js",
  "api/_lib/rallyScoreEngineTest.js",
];
for (const file of files) {
  const code = stripComments(readRepoFile(file));
  assert.doesNotMatch(code, /mock|synthetic|fixture|dummy|fake[A-Z_]|sampleData|demoData|MOCK_|SYNTHETIC/i, `${file} no debe contener rutas de datos simulados`);
}

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/rally-scan.js"))).default;
const operable = await loadOperableUniverse();
operable.forEach((asset) => fixture.failSymbols.add(asset.providerSymbol));

for (const test of [false, true]) {
  const label = test ? "Rally-Test" : "Rally Leaders";
  const final = (await runRallyScan(handler, { test })).at(-1).body;
  assert.equal(final.coveragePercent, 100, `${label}: el scan recorre todo el universo aunque falle`);
  assert.deepEqual(final.top10, [], `${label}: sin datos reales no hay top-10 (ni sustituto)`);
  assert.equal(final.tickersFallidos, operable.length, `${label}: todos los fallos se cuentan`);
}

console.log("Rally Leaders no mock validation OK: sin rutas simuladas y top-10 vacío cuando no hay datos reales.");
