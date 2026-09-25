// Integridad de extremo a extremo del universo: lo que el SCAN FULL vivo mide es exactamente lo
// que System Status enseña.
//   · scan completo (handler vivo) → mergeScanSnapshotUniverseStatus: universo, operables,
//     batches, cobertura 100 y TOP 8 final idénticos a la respuesta; dato operativo REAL pero sin
//     decisión operativa a nivel dashboard;
//   · con fallos de proveedor, dataIntegrityScore = % de tickers con histórico real, y se pinta
//     ("Integridad datos") junto a "Datos operativos".
// Reescrito 25-sep-2026: antes buscaba "Universe Discovered"/"Operational Data" (textos retirados).
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, loadOperableUniverse, prepareScanFixtures, renderMarkup, repoUrl, runScanSnapshot,
} from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const operable = await loadOperableUniverse();
const failing = operable.filter((_, index) => index % 10 === 0).map((asset) => asset.providerSymbol);
failing.forEach((symbol) => fixture.failSymbols.add(symbol));

const final = (await runScanSnapshot(handler, { batchSize: 50 })).at(-1).body;
assert.equal(final.isGlobalTop8Final, true);
const expectedIntegrity = Math.round(((operable.length - failing.length) / operable.length) * 100);
assert.equal(final.dataIntegrityScore, expectedIntegrity, "integridad = % de tickers con histórico real");
const saved = fixture.kv.writesTo("last_scan_snapshot").at(-1).value;
assert.equal(saved.dataIntegrityScore, expectedIntegrity, "el snapshot guardado conserva la integridad");
assert.equal(saved.dataIntegrity.tickersFailed, failing.length, "los fallos se cuentan");
assert.equal(saved.dataIntegrity.tickersOk, operable.length - failing.length);
assert.ok(final.topCandidates.every((candidate) => !failing.includes(candidate.providerSymbol)), "un ticker sin datos no puede rankear");

ensureBrowserGlobals();
const React = await import("react");
const { refresh, empty, cards } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
  cards: "src/components/SystemStatusCards.tsx",
});
const status = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, final);
const stats = status.technical.universeStats;
assert.equal(stats.universeDiscovered, operable.length);
assert.equal(stats.universeOperable, final.universeAfterFilters);
assert.equal(stats.batchesTotal, final.batchesTotal);
assert.equal(stats.batchesCompleted, final.batchesTotal);
assert.equal(stats.coveragePercent, 100);
assert.equal(stats.finalTop8Count, final.topCandidates.length);
assert.ok(stats.finalTop8Count > 0 && stats.finalTop8Count <= 8);
assert.equal(stats.dataIntegrityScore, expectedIntegrity);
assert.equal(status.operationalDataStatus, "REAL", "scan global completo = dato operativo REAL…");
assert.equal(status.operationalDecisionAllowed, false, "…pero el dashboard no autoriza EXEC por sí mismo");

const markup = await renderMarkup(React.createElement(cards.SystemStatusCards, { systemStatus: status }));
assert.match(markup, /Datos operativos<\/span><strong[^>]*>REAL</);
assert.match(markup, new RegExp(`Integridad datos</span><strong[^>]*>${expectedIntegrity}%<`));
assert.match(markup, new RegExp(`Batches</span><strong[^>]*>${final.batchesTotal} / ${final.batchesTotal}<`));

console.log(`Universe integrity validation OK: scan → System Status coherente (integridad ${expectedIntegrity} %).`);
