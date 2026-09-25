// Master Indicators (SPY/LQD/HYG/VIX/VVIX/TNX/MOVE): datos reales, informativos y refrescados.
//   · /api/master-indicators → rewrite a /api/market-data?source=master-indicators (handler vivo
//     api/_lib/masterIndicatorsHandler.js); solo GET; allowlist exacta de 7 símbolos; cada
//     indicador es informativo (no afecta a Score, Ranking ni EXEC);
//   · sin API real: precios null / DATA_UNAVAILABLE y cero llamadas; con API real, un proveedor
//     que falla deja ESE indicador en DATA_UNAVAILABLE (nunca un valor de relleno);
//   · frontend: mergeMasterIndicators marca REAL / LAST_CLOSE (STALE) / NOT_AVAILABLE, nunca
//     autoriza EXEC; fetchMasterIndicators lanza si no llega ningún precio (se conserva el último
//     dato bueno) y el dashboard refresca cada 4 min.
// Reescrito 25-sep-2026: antes leía api/master-indicators.js, que se consolidó en market-data.js.
import assert from "node:assert/strict";
import {
  captureFetch, ensureBrowserGlobals, importFrontend, invoke, isolateFromProduction, jsonResponse, readRepoFile,
  repoUrl, stubModules,
} from "./validate-harness.mjs";

const SYMBOLS = ["SPY", "LQD", "HYG", "VIX", "VVIX", "TNX", "MOVE"];
isolateFromProduction();
const cascadeCalls = [];
await stubModules({
  "api/_lib/providerCascade.js": {
    cascadeQuote: async (symbol) => {
      cascadeCalls.push(symbol);
      if (symbol === "MOVE.INDX") return { ok: false, triedProviders: [{ provider: "Yahoo", ok: false, reason: "HTTP_500" }] };
      return { ok: true, provider: "Finnhub", price: 100 + cascadeCalls.length, previousClose: 100, changePercent: 1, priceDate: "2026-06-03", triedProviders: [{ provider: "Finnhub", ok: true }] };
    },
  },
});
const marketData = (await import(repoUrl("api/market-data.js"))).default;
const get = () => invoke(marketData, { method: "GET", query: { source: "master-indicators" } });

const vercel = JSON.parse(readRepoFile("vercel.json"));
assert.ok(
  vercel.rewrites.some((rule) => rule.source === "/api/master-indicators" && rule.destination === "/api/market-data?source=master-indicators"),
  "rewrite /api/master-indicators → market-data",
);

// ── Sin API real ──
delete process.env.ENABLE_REAL_API_CALLS;
const disabled = await get();
assert.equal(disabled.status, 200);
assert.equal(disabled.body.ok, false, "sin precios no hay ok:true");
assert.deepEqual(disabled.body.symbols, SYMBOLS, "allowlist exacta de 7 indicadores");
assert.equal(disabled.body.indicators.length, 7);
for (const indicator of disabled.body.indicators) {
  assert.equal(indicator.price, null, `${indicator.symbol}: sin API real no hay precio`);
  assert.equal(indicator.dataMode, "DATA_UNAVAILABLE");
  assert.equal(indicator.isInformationalOnly, true);
  assert.equal(indicator.affectsScore, false);
  assert.equal(indicator.affectsRanking, false);
  assert.equal(indicator.affectsExec, false);
}
assert.equal(cascadeCalls.length, 0, "sin API real no se llama a proveedores");
assert.equal((await invoke(marketData, { method: "POST", query: { source: "master-indicators" } })).status, 405, "solo GET");

// ── Con API real ──
process.env.ENABLE_REAL_API_CALLS = "true";
const live = await get();
assert.equal(live.body.ok, true);
const bySymbol = Object.fromEntries(live.body.indicators.map((indicator) => [indicator.symbol, indicator]));
assert.equal(bySymbol.SPY.dataMode, "REAL");
assert.equal(bySymbol.SPY.providerUsed, "Finnhub");
assert.equal(typeof bySymbol.SPY.price, "number");
assert.equal(bySymbol.MOVE.price, null, "proveedor caído → sin valor de relleno");
assert.equal(bySymbol.MOVE.dataMode, "DATA_UNAVAILABLE");
assert.equal(bySymbol.MOVE.providerUsed, "none");

// ── Frontend ──
ensureBrowserGlobals();
const { refresh, empty } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
});
assert.deepEqual(empty.unavailableMasterIndicators.map((indicator) => indicator.symbol).sort(), [...SYMBOLS].sort());
assert.ok(empty.unavailableMasterIndicators.every((indicator) => indicator.value === "N/A" && indicator.operationalDecisionAllowed === false));

const staleResponse = { ...live.body, indicators: live.body.indicators.map((indicator) => (indicator.symbol === "HYG" ? { ...indicator, cacheStatus: "STALE" } : indicator)) };
const merged = refresh.mergeMasterIndicators(empty.unavailableMasterIndicators, staleResponse).indicators;
const mergedBySymbol = Object.fromEntries(merged.map((indicator) => [indicator.symbol, indicator]));
assert.equal(mergedBySymbol.SPY.dataMode, "REAL");
assert.equal(mergedBySymbol.HYG.dataMode, "LAST_CLOSE", "dato cacheado caducado = último cierre, no REAL");
assert.equal(mergedBySymbol.MOVE.dataMode, "DATA_UNAVAILABLE");
assert.equal(mergedBySymbol.MOVE.status, "NOT_AVAILABLE");
assert.equal(mergedBySymbol.MOVE.value, "N/A");
assert.ok(merged.every((indicator) => indicator.operationalDecisionAllowed === false), "los indicadores nunca autorizan EXEC");

const requests = captureFetch((url) => jsonResponse(url === "/api/master-indicators" ? disabled.body : {}));
await assert.rejects(() => refresh.fetchMasterIndicators(), /MASTER_INDICATORS_UNAVAILABLE/, "sin ningún precio el feed se declara no disponible");
assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), ["GET /api/master-indicators"]);

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /mergeMasterIndicators\(unavailableMasterIndicators, response\)/);
assert.match(dashboard, /setInterval\(\(\) => \{\s*loadMasterIndicators\(\);\s*\}, 4 \* 60_000\)/, "refresco periódico cada 4 min");
assert.match(dashboard, /setIndicatorsFeed\(\(current\) => \(\{ \.\.\.current, lastFetchFailed: true \}\)\)/, "un fallo conserva el último dato bueno");

console.log("Master Indicators refresh validation OK: allowlist informativa, sin rellenos y refresco honesto.");
