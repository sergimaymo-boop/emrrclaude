// Sin batches duplicados ni saltados en el SCAN FULL (handler vivo api/scan-snapshot.js):
//   · un scan completo procesa CADA activo operable exactamente una vez (cobertura real, sin
//     solapes) y los batches se numeran 1..N sin repetir;
//   · reenviar el MISMO token (reintento del frontend) reprocesa el mismo batch: no cuenta dos
//     veces ni se salta el siguiente (el estado vive en el token firmado, no en el servidor);
//   · un token de un scan ya completo se rechaza (SCAN_ALREADY_COMPLETE) sin llamar a proveedores.
// Reescrito 25-sep-2026: antes buscaba texto de processNextSnapshotBatch (ruta muerta).
import assert from "node:assert/strict";
import { invoke, loadOperableUniverse, prepareScanFixtures, repoUrl, runScanSnapshot } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const { signStateToken } = await import(repoUrl("api/_lib/scanSnapshot.js"));
const operable = await loadOperableUniverse();

// ── Scan completo: cada activo una vez, batches 1..N ──
const responses = await runScanSnapshot(handler, { batchSize: 50 });
const processed = fixture.historyCalls.splice(0);
assert.equal(processed.length, new Set(processed).size, "ningún activo se procesa dos veces en un scan");
assert.deepEqual(new Set(processed), new Set(operable.map((asset) => asset.providerSymbol)), "se procesa TODO el universo operable");
const batchIndexes = responses.map(({ body }) => body.diagnostics?.processedBatches?.[0]?.batchIndex);
assert.deepEqual(batchIndexes, Array.from({ length: responses.length }, (_, index) => index + 1), "batches numerados 1..N sin repetir");

// ── Reintento con el mismo token: idempotente ──
const start = await invoke(handler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });
const token = start.body.snapshotToken;
fixture.historyCalls.length = 0;
const first = await invoke(handler, { method: "POST", query: { action: "continue" }, body: { snapshotToken: token } });
const firstSymbols = fixture.historyCalls.splice(0);
const replay = await invoke(handler, { method: "POST", query: { action: "continue" }, body: { snapshotToken: token } });
const replaySymbols = fixture.historyCalls.splice(0);
for (const field of ["batchesCompleted", "nextBatchIndex", "coveragePercent", "batchesTotal"]) {
  assert.equal(replay.body[field], first.body[field], `reenviar el token no altera ${field}`);
}
assert.equal(first.body.batchesCompleted, 2, "el token del batch 1 continúa con el batch 2");
assert.deepEqual(replaySymbols, firstSymbols, "el reintento reprocesa el MISMO batch, no el siguiente");

// ── Token de un scan completo: rechazado sin coste ──
const completedState = {
  scanId: "scan-validator-complete", scanStartedAtUtc: new Date().toISOString(), universeHash: "x", activeMarkets: [],
  batchSize: 50, batchesTotal: 3, batchesCompleted: 3, nextBatchIndex: null, universeCount: 150,
  actualProviderCalls: 303, accProviderOk: 150, accProviderFail: 0, accumulatedTop8: [],
};
const completedToken = signStateToken(Buffer.from(JSON.stringify(completedState)).toString("base64url"));
const rejected = await invoke(handler, { method: "POST", query: { action: "continue" }, body: { snapshotToken: completedToken } });
assert.equal(rejected.status, 400);
assert.equal(rejected.body.error, "SCAN_ALREADY_COMPLETE");
assert.equal(fixture.historyCalls.length, 0, "un scan completo no vuelve a llamar a proveedores");

console.log(`No duplicate batches validation OK: ${processed.length} activos, cada uno una vez; reintentos idempotentes.`);
