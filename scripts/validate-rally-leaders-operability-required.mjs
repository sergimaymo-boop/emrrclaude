// Solo se escanean activos OPERABLE: Rally Leaders, Rally-Test y el SCAN FULL descartan del
// universo los activos NOT_OPERABLE / UNKNOWN antes de gastar una sola llamada a proveedor.
// Prueba de comportamiento sobre los handlers vivos inyectando activos no operables AL PRINCIPIO
// del universo (donde caerían en el primer batch si no se filtraran).
// Reescrito 25-sep-2026: antes buscaba texto en api/rally-scan/start.js, que ya no existe.
import assert from "node:assert/strict";
import { invoke, prepareScanFixtures, repoUrl, runRallyScan, setStub, stubModules } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
await stubModules({ "api/_lib/universeResponse.js": {} });
const realUniverseModule = await import(`${repoUrl("api/_lib/universeResponse.js")}?validator-real`);
const realUniverse = await realUniverseModule.buildUniverseResponse({ includeFullAssets: true });
const operable = realUniverse.assets.filter((asset) => asset.operabilityStatus === "OPERABLE");
const template = operable[0];
const blocked = [
  { ...template, ticker: "NOPE1", providerSymbol: "NOPE1.US", operabilityStatus: "NOT_OPERABLE", operabilityReasons: ["VALIDATOR_NOT_OPERABLE"] },
  { ...template, ticker: "UNKN1", providerSymbol: "UNKN1.US", operabilityStatus: "UNKNOWN", operabilityReasons: ["VALIDATOR_UNKNOWN"] },
];
const blockedSymbols = new Set(blocked.map((asset) => asset.providerSymbol));
setStub("api/_lib/universeResponse.js", "buildUniverseResponse", async (options) => {
  const universe = await realUniverseModule.buildUniverseResponse(options);
  return { ...universe, assets: [...blocked, ...universe.assets] };
});

const rallyHandler = (await import(repoUrl("api/rally-scan.js"))).default;
const scanHandler = (await import(repoUrl("api/scan-snapshot.js"))).default;

for (const test of [false, true]) {
  const label = test ? "Rally-Test" : "Rally Leaders";
  fixture.historyCalls.length = 0;
  const responses = await runRallyScan(rallyHandler, { test });
  assert.equal(responses[0].body.universeCount, operable.length, `${label}: universeCount = solo operables`);
  assert.equal(responses.at(-1).body.isRallyFinal, true);
  const touched = fixture.historyCalls.filter((symbol) => blockedSymbols.has(symbol));
  assert.deepEqual(touched, [], `${label}: nunca descarga histórico de activos no operables`);
  assert.ok(responses.at(-1).body.top10.every((asset) => !blockedSymbols.has(asset.providerSymbol)));
}

fixture.historyCalls.length = 0;
const scanStart = await invoke(scanHandler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });
assert.equal(scanStart.body.universeDiscovered, operable.length, "SCAN FULL: universo = solo operables");
assert.ok(fixture.historyCalls.length > 0);
assert.ok(fixture.historyCalls.every((symbol) => !blockedSymbols.has(symbol)), "SCAN FULL: el primer batch no incluye no operables");

console.log("Rally Leaders operability required validation OK: NOT_OPERABLE/UNKNOWN nunca se escanean.");
