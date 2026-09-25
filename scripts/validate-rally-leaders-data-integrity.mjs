// Integridad de datos de Rally Leaders (handler vivo api/rally-scan.js):
//   · el top-10 solo contiene candidatos con histórico REAL descargado (dataMode REAL);
//   · un ticker cuya descarga falla NO desaparece en silencio: se cuenta en tickersFallidos y
//     jamás entra en el top-10 (aunque "debiera" liderar);
//   · los pesos sugeridos suman EXACTAMENTE 100,0 %;
//   · persistencia aislada: producción escribe solo last_rally_snapshot y Rally-Test solo
//     last_rally_test_snapshot (CLAUDE.md §10e: un scan de test nunca pisa producción).
// Reescrito 25-sep-2026: antes leía api/rally-scan/start.js, que ya no existe.
import assert from "node:assert/strict";
import { loadOperableUniverse, prepareScanFixtures, readRepoFile, repoUrl, runRallyScan, symbolTrend } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/rally-scan.js"))).default;
const operable = await loadOperableUniverse();

// Los 5 tickers con la tendencia sintética más fuerte fallan al descargar.
const strongest = operable
  .map((asset) => asset.providerSymbol)
  .sort((a, b) => symbolTrend(b, fixture.seed) - symbolTrend(a, fixture.seed))
  .slice(0, 5);
strongest.forEach((symbol) => fixture.failSymbols.add(symbol));

for (const { test, key, otherKey } of [
  { test: false, key: "last_rally_snapshot", otherKey: "last_rally_test_snapshot" },
  { test: true, key: "last_rally_test_snapshot", otherKey: "last_rally_snapshot" },
]) {
  const label = test ? "Rally-Test" : "Rally Leaders";
  const writesBefore = fixture.kv.writes.length;
  const final = (await runRallyScan(handler, { test })).at(-1).body;
  assert.equal(final.isRallyFinal, true);

  assert.ok(final.top10.length > 0, `${label}: hay top-10`);
  for (const asset of final.top10) {
    assert.equal(asset.dataMode, "REAL", `${label}: ${asset.ticker} debe venir de histórico real`);
    assert.ok(!strongest.includes(asset.providerSymbol), `${label}: ${asset.providerSymbol} falló la descarga y no puede estar en el top-10`);
    assert.equal(asset.scanId, final.scanId);
  }
  assert.equal(final.tickersFallidos, strongest.length, `${label}: los fallos de descarga se cuentan, no se esconden`);

  const weightSum = final.top10.reduce((sum, asset) => sum + asset.suggestedWeightPct, 0);
  assert.equal(Math.round(weightSum * 10), 1000, `${label}: Σ pesos = 100,0 exacto (es ${weightSum})`);

  const newWrites = fixture.kv.writes.slice(writesBefore).map((write) => write.key);
  assert.deepEqual(newWrites, [key], `${label}: solo escribe ${key}`);
  assert.ok(!newWrites.includes(otherKey), `${label}: nunca escribe ${otherKey}`);
}

// Las dos claves existen en kvStorage y son distintas.
const kvSource = readRepoFile("api/_lib/kvStorage.js");
assert.match(kvSource, /KV_RALLY_KEY\s*=\s*"last_rally_snapshot"/);
assert.match(kvSource, /KV_RALLY_TEST_KEY\s*=\s*"last_rally_test_snapshot"/);

console.log("Rally Leaders data integrity validation OK: solo datos reales, fallos contados y claves aisladas.");
