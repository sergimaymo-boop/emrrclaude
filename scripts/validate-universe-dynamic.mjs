// Las estadísticas de universo son ESTADO DINÁMICO: arrancan vacías (0 / UNAVAILABLE /
// METADATA_ONLY, sin decisión operativa) y cada respuesta de scan las sustituye por completo
// (mergeScanSnapshotUniverseStatus) — scanId, universo, batches, cobertura y llamadas del
// ÚLTIMO scan, nunca restos del anterior. El dashboard las aplica tanto al scan en vivo como al
// último scan guardado, y la cabecera las lee del estado.
// Reescrito 25-sep-2026: antes exigía mergeTop8UniverseStatus/universeStats.total en la
// cabecera (flujo /api/top8 retirado).
import assert from "node:assert/strict";
import { ensureBrowserGlobals, importFrontend, isolateFromProduction, readRepoFile, sampleFinalSnapshot } from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const domain = readRepoFile("shared/types/domain.ts");
assert.match(domain, /export interface UniverseStats/);
assert.match(domain, /universeStats: UniverseStats/);

const { refresh, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
});
const initial = empty.unavailableUniverseStats;
assert.deepEqual(
  [initial.universeDiscovered, initial.total, initial.finalTop8Count, initial.top8Source, initial.resultScope, initial.source, initial.operationalDecisionAllowed],
  [0, 0, 0, "UNAVAILABLE", "UNAVAILABLE", "METADATA_ONLY", false],
  "sin scan: universo vacío y no operativo",
);
assert.equal(empty.initialSystemStatus.technical.universeStats, initial);

const scanA = { ...sampleFinalSnapshot(), scanId: "scan-A", universeHash: "hash-A", universeDiscovered: 593, universeAfterFilters: 593, actualProviderCalls: 1200, activeMarkets: ["USA"] };
const scanB = {
  ...sampleFinalSnapshot([]), scanId: "scan-B", universeHash: "hash-B", status: "PARTIAL_BATCH_ONLY", resultScope: "PARTIAL_BATCH_ONLY",
  isGlobalTop8Final: false, isPartialResult: true, universeDiscovered: 300, universeAfterFilters: 300, batchesTotal: 6, batchesCompleted: 3,
  nextBatchIndex: 3, coveragePercent: 50, actualProviderCalls: 303, activeMarkets: [], snapshotToken: "tok", scanCompletedAtUtc: null,
};
const afterA = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, scanA).technical.universeStats;
const afterB = refresh.mergeScanSnapshotUniverseStatus({ ...empty.initialSystemStatus, technical: { ...empty.initialSystemStatus.technical, universeStats: afterA } }, scanB).technical.universeStats;
for (const [stats, scan] of [[afterA, scanA], [afterB, scanB]]) {
  assert.equal(stats.scanId, scan.scanId);
  assert.equal(stats.universeHash, scan.universeHash);
  assert.equal(stats.universeDiscovered, scan.universeDiscovered);
  assert.equal(stats.total, scan.universeDiscovered);
  assert.equal(stats.universeOperable, scan.universeAfterFilters);
  assert.equal(stats.batchesTotal, scan.batchesTotal);
  assert.equal(stats.batchesCompleted, scan.batchesCompleted);
  assert.equal(stats.coveragePercent, scan.coveragePercent);
  assert.equal(stats.actualProviderCalls, scan.actualProviderCalls);
  assert.deepEqual(stats.activeMarkets, scan.activeMarkets);
}
assert.equal(afterB.finalTop8Count, 0, "el scan parcial siguiente no hereda el TOP 8 final del anterior");
assert.equal(afterB.resultScope, "PARTIAL_BATCH_ONLY");

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /statusBase = mergeScanSnapshotUniverseStatus\(statusBase, snapshot\)/, "el scan en vivo actualiza el universo");
assert.match(dashboard, /setSystemStatus\(\(current\) => mergeScanSnapshotUniverseStatus\(current, snapshot\)\)/, "el último scan guardado también");
assert.match(readRepoFile("src/components/TechnicalHeader.tsx"), /systemStatus\.technical\.universeStats/, "la cabecera lee el estado");

console.log("Dynamic universe metadata validation OK: estado vacío inicial y sustitución completa por cada scan.");
