// Marcas de tiempo REALES y separadas (sin marcas "mock"):
//   · lastRealDataUpdate (último dato real recibido) y lastScanClicked (última pulsación) son
//     campos distintos del estado;
//   · "Último scan" solo avanza con un scan COMPLETO: un parcial no lo toca y el completo pone
//     su hora real de fin (scanCompletedAtUtc) — nunca la hora de abrir la página;
//   · un indicador de último cierre (STALE) no cuenta como dato real nuevo;
//   · la UI enseña "—" mientras no hay scan completado.
// Reescrito 25-sep-2026: antes buscaba "Last real" en ScanStatusPanel.tsx (ya no se renderiza)
// y "Last Real Data" en SystemStatusCards (texto retirado).
import assert from "node:assert/strict";
import { ensureBrowserGlobals, importFrontend, isolateFromProduction, readRepoFile, renderMarkup, sampleFinalSnapshot } from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const domain = readRepoFile("shared/types/domain.ts");
assert.match(domain, /lastRealDataUpdate: TimestampPair \| null/);
assert.match(domain, /lastScanClicked: TimestampPair/);
assert.doesNotMatch(domain, /lastMockRefresh|mockRefreshTimestamp/);
const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /lastRealDataUpdate/);
assert.match(dashboard, /lastScanClicked: startedAt/);
assert.doesNotMatch(dashboard, /lastMockRefresh|mockRefreshTimestamp/);

const React = await import("react");
const { refresh, empty, cards, bar } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
  cards: "src/components/SystemStatusCards.tsx",
  bar: "src/components/ScanSummaryBar.tsx",
});
const initial = empty.initialSystemStatus;
assert.deepEqual(initial.lastScan, { utc: "", local: "—" }, "sin scan completado: '—', nunca la hora de carga");
assert.equal(initial.lastRealDataUpdate, null);

const final = sampleFinalSnapshot();
const partial = { ...final, isGlobalTop8Final: false, status: "PARTIAL_BATCH_ONLY", coveragePercent: 50, batchesCompleted: 6, scanCompletedAtUtc: null };
assert.deepEqual(refresh.mergeScanSnapshotUniverseStatus(initial, partial).lastScan, initial.lastScan, "un parcial no mueve 'Último scan'");
const afterFinal = refresh.mergeScanSnapshotUniverseStatus(initial, final);
assert.equal(afterFinal.lastScan.utc, new Date(final.scanCompletedAtUtc).toISOString(), "'Último scan' = hora real de fin del scan");

const stamp = { utc: "2026-06-03T15:00:00.000Z", local: "03/06 16:00" };
assert.equal(refresh.updateSystemStatusForDataMode(initial, "REAL", stamp).lastRealDataUpdate, stamp);
assert.equal(refresh.updateSystemStatusForDataMode(initial, "DATA_UNAVAILABLE", null).lastRealDataUpdate, null);

const indicator = (symbol, cacheStatus, timestampUtc) => ({ symbol, name: symbol, price: 10, previousClose: 9, changePercent: 1, providerUsed: "Finnhub", timestampUtc, dataQuality: "GOOD", cacheStatus });
const { lastRealDataUpdate } = refresh.mergeMasterIndicators(empty.unavailableMasterIndicators, {
  ok: true,
  indicators: [indicator("SPY", "MISS", "2026-06-03T14:00:00.000Z"), indicator("VIX", "STALE", "2026-06-03T18:00:00.000Z")],
});
assert.equal(lastRealDataUpdate.utc, "2026-06-03T14:00:00.000Z", "un último cierre (STALE) no cuenta como dato real nuevo");

for (const [name, Component] of [["SystemStatusCards", cards.SystemStatusCards], ["ScanSummaryBar", bar.ScanSummaryBar]]) {
  const before = await renderMarkup(React.createElement(Component, { systemStatus: initial }));
  const after = await renderMarkup(React.createElement(Component, { systemStatus: afterFinal }));
  assert.match(before, /Último scan<\/span><(strong|span)[^>]*>—</, `${name}: '—' sin scan completado`);
  assert.ok(after.includes(afterFinal.lastScan.local), `${name}: muestra la hora real del último scan completo`);
}

console.log("Separated real timestamps validation OK: 'Último scan' solo con scan completo y sin marcas mock.");
