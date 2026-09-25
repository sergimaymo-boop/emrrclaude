// El universo que se cuenta y se escanea es el FILTRADO (acciones comunes, bolsas permitidas,
// activas), nunca la lista cruda de símbolos del proveedor/estático:
//   · buildUniverseResponse (api/_lib/universeResponse.js, antes api/universe.js) descarta ETF,
//     warrants, OTC y deslistados; rawProviderSymbolsDiscovered sí los cuenta (es el crudo);
//   · el SCAN FULL informa universeDiscovered = universo filtrado y operable;
//   · el dashboard pinta ese recuento filtrado, jamás el crudo.
// Reescrito 25-sep-2026: antes leía api/universe.js (movido a _lib el 23-ago-2026) y texto de
// la ruta muerta de scanSnapshot.js.
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, invoke, prepareScanFixtures, repoUrl, sampleFinalSnapshot, stubModules,
} from "./validate-harness.mjs";

await prepareScanFixtures();
const junk = [
  { Code: "RAWETF", Name: "Raw ETF", Exchange: "NYSE", Currency: "USD", Type: "ETF", Status: "active" },
  { Code: "RAWX-W", Name: "Raw Warrant", Exchange: "NASDAQ", Currency: "USD", Type: "COMMON STOCK", Status: "active" },
  { Code: "RAWOTC", Name: "Raw OTC", Exchange: "OTC", Currency: "USD", Type: "COMMON STOCK", Status: "active" },
  { Code: "RAWDEL", Name: "Raw Delisted", Exchange: "NYSE", Currency: "USD", Type: "COMMON STOCK", Status: "Delisted" },
];
const realStatic = await import(`${repoUrl("api/_lib/staticUniverse.js")}?validator-real`);
await stubModules({
  "api/_lib/staticUniverse.js": {
    getStaticAssetsForExchange: (exchange) => [...realStatic.getStaticAssetsForExchange(exchange), ...(exchange === "US" ? junk : [])],
  },
});
const { buildUniverseResponse } = await import(repoUrl("api/_lib/universeResponse.js"));
const universe = await buildUniverseResponse({ includeFullAssets: true });
const symbols = new Set(universe.assets.map((asset) => asset.ticker));
for (const row of junk) assert.ok(!symbols.has(row.Code), `${row.Code} no es elegible y no entra en el universo`);
const rawRows = Object.keys(realStatic.STATIC_ASSETS_BY_EXCHANGE).reduce((sum, exchange) => sum + realStatic.getStaticAssetsForExchange(exchange).length, 0) + junk.length;
assert.equal(universe.rawProviderSymbolsDiscovered, rawRows, "el recuento crudo incluye lo descartado");
assert.ok(universe.assets.length <= rawRows - junk.length, "el universo filtrado es menor que el crudo");
assert.equal(universe.summary.totalDiscovered, universe.assets.length, "summary.totalDiscovered = universo filtrado");

const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const start = await invoke(handler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });
const operable = universe.assets.filter((asset) => asset.operabilityStatus === "OPERABLE").length;
assert.equal(start.body.universeDiscovered, operable, "SCAN FULL informa el universo filtrado y operable");
assert.ok(start.body.universeDiscovered < universe.rawProviderSymbolsDiscovered);

ensureBrowserGlobals();
const { refresh, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
});
const stats = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, { ...sampleFinalSnapshot(), universeDiscovered: 587, rawProviderSymbolsDiscovered: 9999 })
  .technical.universeStats;
assert.equal(stats.universeDiscovered, 587, "el dashboard usa el recuento filtrado");
assert.equal(stats.total, 587, "…también en el total mostrado");

console.log("Universe count not raw validation OK: ETF/warrants/OTC/deslistados fuera y recuento filtrado en pantalla.");
