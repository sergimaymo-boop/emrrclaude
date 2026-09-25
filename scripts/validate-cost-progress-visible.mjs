// Coste y progreso del SCAN FULL, medidos y visibles:
//   · el handler vivo contabiliza las llamadas a proveedor de forma EXACTA y acumulada
//     (1 SPY + 2 por activo en cada batch → total = batchesTotal + 2·universo) y el start
//     publica la estimación por batch;
//   · System Status recibe cobertura, batches y llamadas del scan;
//   · se VEN (render real): ScanSummaryBar enseña la cobertura con su alcance (PARCIAL/COMPLETO)
//     y System Status la cobertura y "Batches completados / total".
// Reescrito 25-sep-2026: la versión anterior comprobaba ScanStatusPanel.tsx, que el dashboard
// ya no renderiza (pasaba sobre un componente muerto).
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, loadOperableUniverse, prepareScanFixtures, readRepoFile, renderMarkup, repoUrl, runScanSnapshot,
} from "./validate-harness.mjs";

const domain = readRepoFile("shared/types/domain.ts");
for (const field of ["coveragePercent", "estimatedProviderCalls", "actualProviderCalls"]) assert.match(domain, new RegExp(field));

await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const operable = await loadOperableUniverse();
const responses = await runScanSnapshot(handler, { batchSize: 50 });
const first = responses[0].body;
assert.equal(first.estimatedProviderCalls, 50 * 2 + 1, "estimación por batch = 2 llamadas por activo + SPY");
let previous = 0;
for (const { body } of responses) {
  assert.ok(body.actualProviderCalls > previous, "las llamadas reales se acumulan batch a batch");
  previous = body.actualProviderCalls;
}
const final = responses.at(-1).body;
assert.equal(final.actualProviderCalls, final.batchesTotal + 2 * operable.length, "contabilidad exacta del coste del scan");

ensureBrowserGlobals();
const React = await import("react");
const { refresh, empty, bar, cards } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
  bar: "src/components/ScanSummaryBar.tsx",
  cards: "src/components/SystemStatusCards.tsx",
});
const partialStatus = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, responses[4].body);
const stats = partialStatus.technical.universeStats;
assert.equal(stats.actualProviderCalls, responses[4].body.actualProviderCalls);
assert.equal(stats.coveragePercent, responses[4].body.coveragePercent);
assert.equal(partialStatus.technical.apiCalls, responses[4].body.actualProviderCalls);

const coverage = responses[4].body.coveragePercent;
const barMarkup = await renderMarkup(React.createElement(bar.ScanSummaryBar, { systemStatus: partialStatus }));
assert.match(barMarkup, new RegExp(`Cobertura</span><span[^>]*>${coverage}%<`), "la barra resumen enseña la cobertura");
assert.match(barMarkup, />PARCIAL</, "…y que el scan es parcial");
const cardsMarkup = await renderMarkup(React.createElement(cards.SystemStatusCards, { systemStatus: partialStatus }));
assert.match(cardsMarkup, new RegExp(`Cobertura</span><strong[^>]*>${coverage}%<`));
assert.match(cardsMarkup, new RegExp(`Batches</span><strong[^>]*>5 / ${final.batchesTotal}<`));
const finalMarkup = await renderMarkup(React.createElement(bar.ScanSummaryBar, { systemStatus: refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, final) }));
assert.match(finalMarkup, />COMPLETO</);

assert.match(readRepoFile("src/pages/DashboardPage.tsx"), /recommendedNextAction: snapshot\.recommendedNextAction/);

console.log("Cost and progress visible validation OK: llamadas contabilizadas y cobertura/batches a la vista.");
