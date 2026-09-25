// INV-07 + INV-03: un scan PARCIAL nunca se presenta ni se persiste como global.
//   · Servidor (handler vivo api/scan-snapshot.js): las respuestas parciales llevan
//     PARTIAL_BATCH_ONLY / isPartialResult y Redis (last_scan_snapshot) se escribe UNA sola
//     vez, en el batch que completa el 100 %, con isGlobalTop8Final === true.
//   · Dashboard: un parcial se etiqueta "TOP 8 PARTIAL DIAGNOSTIC - coverage N%" y el estado
//     del sistema lo marca PARTIAL (nunca GLOBAL / REAL).
// Reescrito 25-sep-2026: antes buscaba texto en el helper muerto de scanSnapshot.js y en
// Top8Grid.tsx (componente que el dashboard ya no renderiza).
import assert from "node:assert/strict";
import { importFrontend, invoke, prepareScanFixtures, readRepoFile, repoUrl, runScanSnapshot } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const responses = await runScanSnapshot(handler, { batchSize: 50 });
const partials = responses.filter(({ body }) => body.batchesCompleted < body.batchesTotal);
assert.ok(partials.length >= 2, "se necesitan varios batches parciales para la prueba");

// ── Servidor: parciales nunca globales ──
for (const { status, body } of partials) {
  assert.equal(status, 206, "parcial → HTTP 206");
  assert.equal(body.status, "PARTIAL_BATCH_ONLY");
  assert.equal(body.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(body.isPartialResult, true);
  assert.equal(body.isGlobalTop8Final, false);
  assert.equal(body.scanCompletedAtUtc, null, "un parcial no tiene hora de fin de scan");
}

// ── Servidor: Redis solo se escribe al completar ──
const saves = fixture.kv.writesTo("last_scan_snapshot");
assert.equal(saves.length, 1, "last_scan_snapshot se escribe exactamente una vez por scan completo");
assert.equal(saves[0].value.isGlobalTop8Final, true);
assert.equal(saves[0].value.coveragePercent, 100);
assert.equal(saves[0].value.scanId, responses.at(-1).body.scanId);

// Un scan que se queda a medias (solo start + algunos continue) no toca Redis.
const before = fixture.kv.writes.length;
const abandonedStart = await invoke(handler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });
const abandoned = await invoke(handler, {
  method: "POST",
  query: { action: "continue" },
  body: { snapshotToken: abandonedStart.body.snapshotToken },
});
assert.equal(abandoned.body.isGlobalTop8Final, false);
assert.equal(fixture.kv.writes.length, before, "un scan interrumpido a mitad NO sobrescribe el último scan global en Redis");

// ── Dashboard ──
const { refresh, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
});
const partialStatus = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, partials.at(-1).body);
const stats = partialStatus.technical.universeStats;
assert.equal(stats.resultScope, "PARTIAL_BATCH_ONLY");
assert.equal(stats.top8Source, "PARTIAL");
assert.equal(stats.source, "PARTIAL");
assert.equal(stats.operationalDataStatus, "DATA_UNAVAILABLE", "un parcial nunca es dato operativo REAL");
assert.equal(partialStatus.operationalDataStatus, "DATA_UNAVAILABLE");
assert.equal(partialStatus.operationalDecisionAllowed, false);
assert.deepEqual(partialStatus.lastScan, empty.initialSystemStatus.lastScan, "un parcial no actualiza 'Último scan'");

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /TOP 8 PARTIAL DIAGNOSTIC - coverage \$\{snapshot\.coveragePercent\}%/, "etiqueta de parcial con su cobertura");
assert.match(dashboard, /snapshot\.isGlobalTop8Final\s*\n?\s*\?\s*"GLOBAL_TOP8_FINAL"/, "el modo GLOBAL solo sale de isGlobalTop8Final");
assert.doesNotMatch(dashboard, /GLOBAL_TOP8_FINAL.*coveragePercent < 100/s);

console.log("Partial never global validation OK: parciales etiquetados PARTIAL y Redis solo escrito al 100 %.");
