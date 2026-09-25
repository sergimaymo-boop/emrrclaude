// Guarda DINÁMICA de EXEC: la acción se recalcula con el estado de mercado de cada momento.
//   · refreshTop8MarketStatus (utils/systemStatus.ts, lo ejecuta el dashboard cada 60 s): al
//     cerrar el mercado un EXEC pasa a CLOSED_CONTEXT, sin decisión operativa y con motivo;
//     con el mercado abierto no toca nada;
//   · mergeVisibleTop8Quotes: el mismo activo apto con mercado abierto es EXEC y con mercado
//     cerrado es CLOSED_CONTEXT ("Market closed - EXEC disabled");
//   · si falla el endpoint de cotizaciones, el dashboard bloquea EXEC (VISIBLE_QUOTES_ENDPOINT_UNAVAILABLE);
//   · el TOP 8 es DINÁMICO: sale del scan (top8Source DYNAMIC / GLOBAL_TOP8_FINAL), nunca de una lista.
// Reescrito 25-sep-2026: antes buscaba texto en Top8Grid.tsx (el dashboard ya no lo renderiza).
import assert from "node:assert/strict";
import {
  ALL_CLOSED_UTC, ensureBrowserGlobals, importFrontend, isolateFromProduction, readRepoFile, sampleFinalSnapshot,
  sampleVisibleQuotes, US_OPEN_UTC, withFrozenNow,
} from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const { refresh, status } = await importFrontend({
  refresh: "src/services/realDataRefresh.ts",
  status: "src/utils/systemStatus.ts",
});

const top8 = refresh.buildDashboardTop8FromScanSnapshot(sampleFinalSnapshot());
assert.ok(top8.every((asset) => asset.top8Source === "DYNAMIC" && asset.resultScope === "GLOBAL_TOP8_FINAL"), "TOP 8 dinámico, del scan global");
const execAsset = { ...top8[0], action: "EXEC", operationalDecisionAllowed: true, operationalBlockReasons: [] };
const watchAsset = { ...top8[0], ticker: "WATCH1", action: "WATCH" };

await withFrozenNow(ALL_CLOSED_UTC, async () => {
  const [demoted, untouched] = status.refreshTop8MarketStatus([execAsset, watchAsset]);
  assert.equal(demoted.action, "CLOSED_CONTEXT", "mercado cerrado: EXEC → CLOSED_CONTEXT");
  assert.equal(demoted.operationalDecisionAllowed, false);
  assert.ok(demoted.operationalBlockReasons.includes("MARKET_NOT_OPEN"));
  assert.equal(demoted.execDisabledReason, "Market closed - EXEC disabled");
  assert.equal(untouched.action, "WATCH", "lo que no es EXEC no se toca");

  const closedMerge = refresh.mergeVisibleTop8Quotes([execAsset], sampleVisibleQuotes([execAsset])).top8[0];
  assert.equal(closedMerge.action, "CLOSED_CONTEXT");
  assert.equal(closedMerge.operationalDecisionAllowed, false);
  assert.equal(closedMerge.operationalDataStatus, "LAST_CLOSE");
  assert.equal(closedMerge.execDisabledReason, "Market closed - EXEC disabled");
});

await withFrozenNow(US_OPEN_UTC, async () => {
  const [kept] = status.refreshTop8MarketStatus([execAsset]);
  assert.equal(kept.action, "EXEC", "mercado abierto: la guarda de horario no degrada");
  const openMerge = refresh.mergeVisibleTop8Quotes([execAsset], sampleVisibleQuotes([execAsset])).top8[0];
  assert.equal(openMerge.action, "EXEC");
  assert.equal(openMerge.operationalDecisionAllowed, true);
});

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /setTop8\(\(current\) => refreshTop8MarketStatus\(current\)\)/, "el dashboard re-evalúa el TOP 8 con el mercado");
assert.match(dashboard, /setInterval\(refreshClockAndMarkets, 60_000\)/, "…cada 60 s");
assert.match(dashboard, /"VISIBLE_QUOTES_ENDPOINT_UNAVAILABLE"/, "fallo del endpoint de cotizaciones → motivo explícito");
assert.match(
  dashboard,
  /action: asset\.marketStatus === "OPEN" && \(asset\.action === "EXEC" \|\| asset\.action === "CLOSED_CONTEXT"\) \? "BLOCKED" : asset\.action/,
  "fallo del endpoint de cotizaciones → EXEC bloqueado",
);
assert.doesNotMatch(dashboard, /mockTop8|runMockScan/);

console.log("EXEC dynamic guard validation OK: EXEC se degrada con el mercado y con fallos de cotización.");
