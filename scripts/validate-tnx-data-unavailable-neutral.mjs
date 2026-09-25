// TNX (rentabilidad del bono a 10 años) sin proveedor = DATA_UNAVAILABLE NEUTRO:
//   · servidor (handler vivo masterIndicatorsHandler.js): precio null, DATA_UNAVAILABLE,
//     diagnóstico TNX_PROVIDER_UNRESOLVED con los símbolos probados — jamás un valor de relleno;
//     cuando el proveedor responde, TNX_PROVIDER_VALID;
//   · frontend: se muestra "N/A"/"—" con estado N/D en gris (no es una alarma roja: no es
//     riesgo, es ausencia de dato); el rojo "SIN DATO" queda para un fallo REAL del feed;
//   · con dato, el color sigue los intervalos de CLAUDE.md §6 (<3,5 % verde, 3,5–4,5 % ámbar, >4,5 % rojo).
// Reescrito 25-sep-2026: antes leía api/master-indicators.js, consolidado en market-data.js.
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, invoke, isolateFromProduction, renderMarkup, repoUrl, stubModules,
  US_OPEN_UTC, withFrozenNow,
} from "./validate-harness.mjs";

isolateFromProduction();
process.env.ENABLE_REAL_API_CALLS = "true";
let tnxAvailable = false;
await stubModules({
  "api/_lib/providerCascade.js": {
    cascadeQuote: async (symbol) => (symbol === "US10Y.GBOND" && !tnxAvailable)
      ? { ok: false, triedProviders: [{ provider: "Finnhub", ok: false, reason: "NO_DATA" }, { provider: "FRED", ok: false, reason: "NO_KEY" }] }
      : { ok: true, provider: "Finnhub", price: symbol === "US10Y.GBOND" ? 4.25 : 100, previousClose: 99, changePercent: 1, triedProviders: [{ provider: "Finnhub", ok: true }] },
  },
});
const marketData = (await import(repoUrl("api/market-data.js"))).default;
const tnxOf = async () => (await invoke(marketData, { method: "GET", query: { source: "master-indicators" } })).body.indicators.find((i) => i.symbol === "TNX");

const unresolved = await tnxOf();
assert.equal(unresolved.price, null, "TNX sin proveedor: sin valor inventado");
assert.equal(unresolved.dataMode, "DATA_UNAVAILABLE");
assert.equal(unresolved.providerUsed, "none");
assert.equal(unresolved.diagnosticStatus, "TNX_PROVIDER_UNRESOLVED");
assert.deepEqual(unresolved.providerSymbolsTried, { eodhd: "US10Y.GBOND", finnhub: "^TNX" });
assert.equal(unresolved.affectsExec, false);

tnxAvailable = true;
const resolved = await tnxOf();
assert.equal(resolved.price, 4.25);
assert.equal(resolved.diagnosticStatus, "TNX_PROVIDER_VALID");

// ── Frontend ──
ensureBrowserGlobals();
const React = await import("react");
const { refresh, grid, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  grid: "src/components/MasterIndicatorsGrid.tsx",
  empty: "src/data/emptyDashboardData.ts",
});
await withFrozenNow(US_OPEN_UTC, async () => {
  const tnxMissing = refresh.mergeMasterIndicators(empty.unavailableMasterIndicators, { ok: true, indicators: [unresolved] })
    .indicators.find((indicator) => indicator.symbol === "TNX");
  assert.equal(tnxMissing.value, "N/A");
  assert.equal(tnxMissing.status, "NOT_AVAILABLE");
  assert.equal(tnxMissing.dataMode, "DATA_UNAVAILABLE");

  const healthyFeed = { lastSuccessUtc: US_OPEN_UTC, lastFetchFailed: false };
  const badge = grid.indicatorBadge(tnxMissing, healthyFeed);
  assert.equal(badge.text, "N/D", "sin dato y feed sano → N/D");
  assert.notEqual(badge.color, "#ef4444", "la ausencia de TNX no se pinta como alarma roja");
  const markup = await renderMarkup(React.createElement(grid.IndicatorRow, { ind: tnxMissing, feed: healthyFeed }));
  assert.doesNotMatch(markup, /#ef4444/i, "fila de TNX sin dato: ningún rojo");
  assert.equal(grid.indicatorBadge(tnxMissing, { lastSuccessUtc: null, lastFetchFailed: true }).text, "SIN DATO", "un fallo real del feed sí se marca");

  const tnxLive = refresh.mergeMasterIndicators(empty.unavailableMasterIndicators, { ok: true, indicators: [resolved] })
    .indicators.find((indicator) => indicator.symbol === "TNX");
  assert.equal(tnxLive.value, "4.25%");
});
assert.equal(grid.getIndicatorColor("TNX", "3.20%", 0), "#10b981", "TNX < 3,5 % verde");
assert.equal(grid.getIndicatorColor("TNX", "4.25%", 0), "#eab308", "TNX 3,5–4,5 % ámbar");
assert.equal(grid.getIndicatorColor("TNX", "4.80%", 0), "#ef4444", "TNX > 4,5 % rojo");

console.log("TNX DATA_UNAVAILABLE neutral validation OK: sin valor inventado, N/D neutro e intervalos §6.");
