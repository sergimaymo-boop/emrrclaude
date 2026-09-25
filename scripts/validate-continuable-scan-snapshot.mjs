// SCAN FULL continuable: el handler VIVO (api/scan-snapshot.js) avanza batch a batch con un
// snapshotToken hasta el 100 % y solo entonces cierra el scan (CLAUDE.md §3.2).
// Reescrito 25-sep-2026: la versión anterior probaba buildSnapshotPlan/processNextSnapshotBatch
// de scanSnapshot.js, que el endpoint ya no usa (pasaba probando código muerto).
import assert from "node:assert/strict";
import { assertEnvelope, loadOperableUniverse, prepareScanFixtures, repoUrl, runScanSnapshot } from "./validate-harness.mjs";

await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const operable = await loadOperableUniverse();
assert.ok(operable.length > 100, `universo operable demasiado pequeño para probar batches: ${operable.length}`);

const responses = await runScanSnapshot(handler, { batchSize: 50 });
const first = responses[0].body;
const last = responses.at(-1).body;
const expectedBatches = Math.ceil(operable.length / 50);

assert.equal(first.batchesTotal, expectedBatches, "batchesTotal = ceil(universo operable / batchSize)");
assert.equal(responses.length, expectedBatches, "una invocación (start/continue) por batch, ni más ni menos");
assert.equal(first.mode, "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT");
assert.equal(responses[0].status, 206, "el primer batch de un scan multi-batch responde 206 (parcial)");
assert.equal(typeof first.snapshotToken, "string", "un scan parcial entrega token de continuación");
assert.ok(first.actualProviderCalls > 0, "el batch registra las llamadas a proveedor realizadas");

responses.forEach((response, index) => {
  const body = response.body;
  assertEnvelope(response, `respuesta ${index + 1}`);
  assert.equal(body.scanId, first.scanId, "todas las continuaciones pertenecen al mismo scanId");
  assert.equal(body.batchesCompleted, index + 1, "cada llamada completa exactamente un batch más");
  if (index > 0) {
    assert.ok(body.coveragePercent >= responses[index - 1].body.coveragePercent, "la cobertura nunca retrocede");
    assert.ok(body.actualProviderCalls >= responses[index - 1].body.actualProviderCalls, "las llamadas se acumulan entre batches");
  }
  const isLast = index === responses.length - 1;
  assert.equal(body.isGlobalTop8Final, isLast, `solo la última llamada cierra el scan (llamada ${index + 1})`);
  assert.equal(body.snapshotToken === null, isLast, `solo el cierre deja de emitir token (llamada ${index + 1})`);
});

assert.equal(responses.at(-1).status, 200);
assert.equal(last.ok, true);
assert.equal(last.status, "GLOBAL_TOP8_FINAL");
assert.equal(last.coveragePercent, 100);
assert.equal(last.nextBatchIndex, null);
assert.equal(last.batchesCompleted, last.batchesTotal);
assert.ok(last.topCandidates.length > 0 && last.topCandidates.length <= 8, "el cierre entrega un TOP 8 real (1..8)");

console.log(`Continuable scan snapshot validation OK: ${responses.length} batches → GLOBAL_TOP8_FINAL al 100 %.`);
