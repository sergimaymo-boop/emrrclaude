// Un indicador recién descargado (cacheStatus MISS = no venía de la caché del servidor) es dato
// REAL y así se muestra: nunca se etiqueta "MISS" ni se degrada por el estado de la caché.
//   · mergeMasterIndicators: MISS/HIT → dataMode REAL, status LIVE, informativo (no EXEC);
//   · indicatorBadge / IndicatorRow (lo que ve el usuario en el panel Fear & Greed): LIVE con la
//     bolsa de EE.UU. abierta, CIERRE con ella cerrada — jamás el texto "MISS".
// Reescrito 25-sep-2026: antes buscaba un `if (status === "MISS") return "FETCHED"` que ya no existe.
import assert from "node:assert/strict";
import {
  ALL_CLOSED_UTC, ensureBrowserGlobals, importFrontend, isolateFromProduction, renderMarkup, US_OPEN_UTC, withFrozenNow,
} from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const React = await import("react");
const { refresh, grid, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  grid: "src/components/MasterIndicatorsGrid.tsx",
  empty: "src/data/emptyDashboardData.ts",
});

const apiIndicator = (symbol, cacheStatus) => ({
  symbol, name: symbol, price: 512.34, previousClose: 505, changePercent: 1.45, priceDate: "2026-06-03",
  providerUsed: "Finnhub", dataMode: "REAL", timestampUtc: "2026-06-03T15:00:00.000Z", dataQuality: "GOOD", cacheStatus,
});

await withFrozenNow(US_OPEN_UTC, async () => {
  const { indicators } = refresh.mergeMasterIndicators(empty.unavailableMasterIndicators, {
    ok: true,
    indicators: [apiIndicator("SPY", "MISS"), apiIndicator("HYG", "HIT")],
  });
  for (const symbol of ["SPY", "HYG"]) {
    const indicator = indicators.find((item) => item.symbol === symbol);
    assert.equal(indicator.dataMode, "REAL", `${symbol}: un fetch fresco es dato REAL`);
    assert.equal(indicator.status, "LIVE");
    assert.equal(indicator.operationalDataStatus, "REAL");
    assert.equal(indicator.operationalDecisionAllowed, false);
    assert.deepEqual(indicator.operationalBlockReasons, ["MASTER_INDICATOR_INFORMATIONAL_ONLY"]);
  }
  const spy = indicators.find((item) => item.symbol === "SPY");
  assert.equal(grid.indicatorBadge(spy, { lastSuccessUtc: US_OPEN_UTC, lastFetchFailed: false }).text, "LIVE");
  const markup = await renderMarkup(React.createElement(grid.IndicatorRow, { ind: spy, feed: { lastSuccessUtc: US_OPEN_UTC, lastFetchFailed: false } }));
  assert.match(markup, /512\.34/, "se muestra el valor real");
  assert.match(markup, />LIVE</);
  assert.doesNotMatch(markup, /MISS/, "el estado de caché nunca se enseña como 'MISS'");

  await withFrozenNow(ALL_CLOSED_UTC, async () => {
    assert.equal(grid.indicatorBadge(spy, { lastSuccessUtc: ALL_CLOSED_UTC, lastFetchFailed: false }).text, "CIERRE", "EE.UU. cerrado → CIERRE, no LIVE");
  });
});

console.log("Master indicators REAL-not-MISS validation OK: un fetch fresco se muestra LIVE/CIERRE, nunca MISS.");
