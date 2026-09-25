// Integridad del dashboard: el estado que se ENSEÑA es honesto.
//   · DashboardPage: el TOP 8 sale del scan snapshot real (start → continue, cobertura), un fallo
//     de cotizaciones se marca VISIBLE_QUOTES_ENDPOINT_UNAVAILABLE y no hay rutas mock;
//   · System Status (render real con react-dom/server): el arranque sin datos dice
//     DATA_UNAVAILABLE / OFFLINE con su motivo; un fallo REAL (ERROR/OFFLINE) nunca se disfraza de
//     "CIERRE" aunque los mercados estén cerrados; con mercados cerrados y scan completo sin
//     fallos, el modo cierre se explica;
//   · la cabecera técnica no inventa un tamaño de universo ("—" sin scan).
// Reescrito 25-sep-2026: antes exigía SectorLeaders.tsx (retirado) y textos ingleses de
// SystemStatusCards/TechnicalHeader que ya no existen.
import assert from "node:assert/strict";
import { ensureBrowserGlobals, importFrontend, isolateFromProduction, readRepoFile, renderMarkup } from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
for (const required of [/startScanSnapshot\(\)/, /continueScanSnapshot\(/, /coveragePercent/, /"VISIBLE_QUOTES_ENDPOINT_UNAVAILABLE"/, /"SCAN_SNAPSHOT_ENDPOINT_UNAVAILABLE"/]) {
  assert.match(dashboard, required, `DashboardPage debe contener ${required}`);
}
assert.doesNotMatch(dashboard, /mockTop8|mockFearGreed|runMockScan|MOCK_SCAN|MIXED_REFRESH/);

const React = await import("react");
const { cards, header, empty } = await importFrontend({
  cards: "src/components/SystemStatusCards.tsx",
  header: "src/components/TechnicalHeader.tsx",
  empty: "src/data/emptyDashboardData.ts",
});
const render = (Component, systemStatus) => renderMarkup(React.createElement(Component, { systemStatus, onLogout: () => {} }));
const initial = empty.initialSystemStatus;

const initialMarkup = await render(cards.SystemStatusCards, initial);
assert.match(initialMarkup, /System Status/);
assert.match(initialMarkup, />DATA_UNAVAILABLE</, "arranque sin datos: DATA_UNAVAILABLE a la vista");
assert.match(initialMarkup, />OFFLINE</);
assert.match(initialMarkup, /REAL_DATA_NOT_LOADED/, "el motivo del bloqueo se muestra");
assert.match(initialMarkup, /Último scan<\/span><strong[^>]*>—</, "sin scan completado: '—'");

const closedComplete = {
  ...initial,
  marketMode: "CLOSED",
  apiStatus: "REAL_READY",
  cache: "REAL_CACHE",
  operationalDataStatus: "DATA_UNAVAILABLE",
  dashboardDataMode: "LAST_CLOSE",
  technical: { ...initial.technical, universeStats: { ...initial.technical.universeStats, coveragePercent: 100, universeDiscovered: 593, universeOperable: 593 } },
};
const closedMarkup = await render(cards.SystemStatusCards, closedComplete);
assert.match(closedMarkup, /Mercados cerrados — scan completado con datos del ÚLTIMO CIERRE/, "modo cierre explicado");
assert.match(closedMarkup, />CIERRE</);

const realFailure = { ...closedComplete, apiStatus: "ERROR", operationalDataStatus: "ERROR", dashboardDataMode: "ERROR" };
const failureMarkup = await render(cards.SystemStatusCards, realFailure);
assert.match(failureMarkup, />ERROR</, "un fallo real se enseña como ERROR");
assert.doesNotMatch(failureMarkup, /ÚLTIMO CIERRE/, "un fallo real nunca se disfraza de modo cierre");
assert.match(failureMarkup, /Razones de bloqueo/);

assert.match(await render(header.TechnicalHeader, initial), /Universe <strong[^>]*>—<\/strong>/, "sin scan la cabecera no inventa el universo");

console.log("Dashboard integrity validation OK: estado inicial honesto, fallos reales visibles y sin rutas mock.");
