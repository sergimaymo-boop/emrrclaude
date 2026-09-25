// INV-01: GLOBAL_TOP8_FINAL solo con coveragePercent === 100 — en el servidor (handler vivo
// de api/scan-snapshot.js) Y en el frontend (realDataRefresh.ts nunca muestra un TOP 8 global
// a partir de una respuesta sin cobertura completa, aunque traiga candidatos).
// Reescrito 25-sep-2026: antes solo buscaba texto en scanSnapshot.js (ruta muerta).
import assert from "node:assert/strict";
import { importFrontend, prepareScanFixtures, repoUrl, runScanSnapshot } from "./validate-harness.mjs";

await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const responses = await runScanSnapshot(handler, { batchSize: 50 });
assert.ok(responses.length > 1, "el universo debe requerir varios batches para que la prueba tenga sentido");

// ── Servidor ──
for (const { body } of responses) {
  const complete = body.batchesCompleted === body.batchesTotal;
  if (body.isGlobalTop8Final || body.status === "GLOBAL_TOP8_FINAL" || body.resultScope === "GLOBAL_TOP8_FINAL") {
    assert.equal(body.coveragePercent, 100, "GLOBAL_TOP8_FINAL exige coveragePercent === 100");
    assert.ok(complete, "GLOBAL_TOP8_FINAL exige batchesCompleted === batchesTotal");
    assert.equal(body.isGlobalTop8Final, true);
    assert.equal(body.status, "GLOBAL_TOP8_FINAL");
    assert.equal(body.resultScope, "GLOBAL_TOP8_FINAL");
  } else {
    assert.ok(body.coveragePercent < 100, "una respuesta no final no puede declarar cobertura completa");
    assert.equal(body.ok, false, "una respuesta parcial no es ok:true");
  }
}
const finals = responses.filter(({ body }) => body.isGlobalTop8Final);
assert.equal(finals.length, 1, "exactamente una respuesta final por scan");

// ── Frontend ──
const { refresh, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
});
const partial = responses[responses.length - 2].body;
const final = responses.at(-1).body;
assert.ok(partial.topCandidates.length > 0, "el parcial trae candidatos diagnósticos (para que la prueba no sea vacía)");

assert.deepEqual(refresh.buildDashboardTop8FromScanSnapshot(partial), [], "un parcial NUNCA produce TOP 8 en el dashboard");
assert.deepEqual(
  refresh.buildDashboardTop8FromScanSnapshot({ ...final, coveragePercent: 99 }),
  [],
  "isGlobalTop8Final sin cobertura 100 tampoco produce TOP 8",
);
assert.deepEqual(
  refresh.buildDashboardTop8FromScanSnapshot({ ...partial, coveragePercent: 100 }),
  [],
  "cobertura 100 sin isGlobalTop8Final tampoco produce TOP 8",
);
const top8 = refresh.buildDashboardTop8FromScanSnapshot(final);
assert.equal(top8.length, final.topCandidates.length, "el cierre al 100 % sí produce el TOP 8");
assert.ok(top8.every((asset) => asset.resultScope === "GLOBAL_TOP8_FINAL"));

const partialStatus = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, partial);
assert.ok(partialStatus.operationalBlockReasons.includes("GLOBAL_TOP8_REQUIRES_100_PERCENT_COVERAGE"));
assert.equal(partialStatus.technical.universeStats.finalTop8Count, 0, "un parcial no cuenta TOP 8 final");
assert.equal(partialStatus.technical.universeStats.resultScope, "PARTIAL_BATCH_ONLY");
const finalStatus = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, final);
assert.equal(finalStatus.technical.universeStats.resultScope, "GLOBAL_TOP8_FINAL");
assert.equal(finalStatus.technical.universeStats.finalTop8Count, final.topCandidates.length);

console.log("Coverage-required global TOP 8 validation OK: servidor y dashboard solo cierran al 100 %.");
