// INV-02 en el dashboard: EXEC solo con datos 100 % reales. Prueba de comportamiento sobre
// realDataRefresh.ts (buildDashboardTop8FromScanSnapshot + mergeVisibleTop8Quotes), que decide
// operationalDecisionAllowed a través de operationalDataPolicy.ts (única autoridad):
//   · recién salido del scan, sin precio visible real, ningún activo es operativo;
//   · cotización no disponible → DATA_UNAVAILABLE y EXEC → BLOCKED con motivo explícito;
//   · cotización de último cierre (STALE) → no operativo, EXEC → BLOCKED;
//   · un solo input del score no REAL (p.ej. spread sin verificar) → no operativo;
//   · solo el caso completo (9 inputs REAL + precio fresco de proveedor real + calidad buena +
//     mercado ABIERTO) permite la decisión operativa.
// Reescrito 25-sep-2026: antes buscaba texto en Top8Grid.tsx (el dashboard ya no lo renderiza).
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, isolateFromProduction, sampleFinalSnapshot, sampleScanCandidate,
  sampleVisibleQuotes, US_OPEN_UTC, withFrozenNow,
} from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const { refresh } = await importFrontend({ refresh: "src/services/realDataRefresh.ts" });

await withFrozenNow(US_OPEN_UTC, async () => {
  const base = refresh.buildDashboardTop8FromScanSnapshot(sampleFinalSnapshot());
  assert.equal(base.length, 1);
  assert.equal(base[0].operationalDecisionAllowed, false, "sin precio visible real no hay decisión operativa");
  assert.equal(base[0].priceDataMode, "DATA_UNAVAILABLE");
  assert.ok(base[0].operationalBlockReasons.includes("VISIBLE_REAL_PRICE_REQUIRED_BEFORE_OPERATIONAL_DISPLAY"));
  assert.ok(Object.values(base[0].scoreInputIntegrity).every((status) => status === "REAL"), "el candidato de prueba trae los 9 inputs REAL");

  const asExec = base.map((asset) => ({ ...asset, action: "EXEC" }));
  const merge = (quote, assets = asExec) => refresh.mergeVisibleTop8Quotes(assets, sampleVisibleQuotes(assets, quote)).top8[0];

  const unavailable = merge({ price: null, provider: "none", cacheStatus: "NOT_AVAILABLE", dataMode: "ERROR" });
  assert.equal(unavailable.dataMode, "DATA_UNAVAILABLE");
  assert.equal(unavailable.operationalDecisionAllowed, false);
  assert.equal(unavailable.action, "BLOCKED", "EXEC sin cotización → BLOCKED");
  assert.equal(unavailable.execDisabledReason, "Quote unavailable - DATA UNAVAILABLE; EXEC disabled");

  const lastClose = merge({ cacheStatus: "STALE" });
  assert.equal(lastClose.priceDataMode, "LAST_CLOSE");
  assert.equal(lastClose.operationalDecisionAllowed, false, "un último cierre nunca es operativo");
  assert.equal(lastClose.action, "BLOCKED");
  assert.ok(lastClose.execDisabledReason, "motivo de bloqueo visible");

  const unverifiedSpread = refresh.buildDashboardTop8FromScanSnapshot(
    sampleFinalSnapshot([sampleScanCandidate({ spreadStatus: { ok: false, spreadPercent: null, blockedReason: "SPREAD_NOT_AVAILABLE" } })]),
  ).map((asset) => ({ ...asset, action: "EXEC" }));
  const spreadCase = merge({}, unverifiedSpread);
  assert.equal(spreadCase.scoreInputIntegrity.Spread, "ERROR");
  assert.equal(spreadCase.operationalDecisionAllowed, false, "con un input del score no REAL no hay EXEC");
  assert.equal(spreadCase.action, "BLOCKED");
  assert.ok(spreadCase.operationalBlockReasons.includes("REAL_SCORE_INPUTS_REQUIRED"));

  const qualifying = merge({});
  assert.equal(qualifying.operationalDecisionAllowed, true, "el caso completo sí permite decisión operativa");
  assert.equal(qualifying.operationalDataStatus, "REAL");
  assert.equal(qualifying.action, "EXEC");
  assert.equal(qualifying.execDisabledReason, undefined);
});

console.log("EXEC real-data guard validation OK: EXEC solo con 9 inputs REAL, precio fresco y mercado abierto.");
