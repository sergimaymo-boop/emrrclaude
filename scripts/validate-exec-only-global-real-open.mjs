// EXEC solo con TOP 8 GLOBAL + datos REALES + mercado ABIERTO (INV-02, CLAUDE.md §4.3).
// Tabla de verdad de deriveOperationalDataPolicy (utils/operationalDataPolicy.ts, ÚNICA autoridad
// de estado operativo): parte del único caso que autoriza la decisión y rompe cada condición por
// separado — cualquiera basta para bloquear. Además:
//   · un activo cuyo scope no es GLOBAL (p.ej. de un parcial) nunca es operativo aunque su
//     cotización sea fresca;
//   · el estado del dashboard (System Status) nunca autoriza EXEC por sí mismo;
//   · el motor del servidor nunca emite EXEC (solo WATCH/STANDBY/BLOCKED).
// Reescrito 25-sep-2026: parte de la versión anterior buscaba texto en decorateSnapshotAsset
// (scanSnapshot.js), ruta que el endpoint vivo ya no ejecuta.
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, isolateFromProduction, repoUrl, sampleFinalSnapshot, sampleVisibleQuotes,
  US_OPEN_UTC, withFrozenNow,
} from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const { policy, refresh, empty } = await importFrontend({
  policy: "src/utils/operationalDataPolicy.ts",
  refresh: "src/services/realDataRefresh.ts",
  empty: "src/data/emptyDashboardData.ts",
});

const qualifying = {
  marketStatus: "OPEN",
  dataMode: "REAL",
  dataQuality: "GOOD",
  provider: "Finnhub",
  cacheStatus: "MISS",
  timestampUtc: "2026-06-03T15:00:00.000Z",
  scoreInputIntegrity: { ...policy.REAL_SCORE_INPUT_INTEGRITY },
};
const decide = (overrides) => policy.deriveOperationalDataPolicy({ ...qualifying, ...overrides });

const allowed = decide({});
assert.equal(allowed.operationalDecisionAllowed, true, "el caso completo autoriza la decisión operativa");
assert.equal(allowed.operationalDataStatus, "REAL");
assert.deepEqual(allowed.operationalBlockReasons, []);

const breakers = [
  ...["CLOSED", "HOLIDAY", "LAST", "UNKNOWN"].map((marketStatus) => ({ marketStatus })),
  ...["LAST_CLOSE", "ERROR", "DATA_UNAVAILABLE", "SCANNING", "PARTIAL_DATA", "LAST_SESSION"].map((dataMode) => ({ dataMode })),
  ...["WARNING", "STALE", "INVALID", "NOT_AVAILABLE", null].map((dataQuality) => ({ dataQuality })),
  ...["none", null].map((provider) => ({ provider })),
  ...["STALE", "ERROR", "NOT_AVAILABLE"].map((cacheStatus) => ({ cacheStatus })),
  ...[null, "no-es-una-fecha"].map((timestampUtc) => ({ timestampUtc })),
  ...Object.keys(policy.REAL_SCORE_INPUT_INTEGRITY).map((input) => ({ scoreInputIntegrity: { ...qualifying.scoreInputIntegrity, [input]: "ERROR" } })),
  { scoreInputIntegrity: undefined },
];
for (const breaker of breakers) {
  const result = decide(breaker);
  assert.equal(result.operationalDecisionAllowed, false, `debe bloquear con ${JSON.stringify(breaker)}`);
  assert.ok(result.operationalBlockReasons.length > 0, `con motivo explícito: ${JSON.stringify(breaker)}`);
}
assert.equal(decide({ marketStatus: "CLOSED" }).operationalDataStatus, "LAST_CLOSE", "mercado cerrado + dato fresco = LAST_CLOSE, no REAL");

// Solo el scope GLOBAL puede ser operativo.
await withFrozenNow(US_OPEN_UTC, async () => {
  const [globalAsset] = refresh.buildDashboardTop8FromScanSnapshot(sampleFinalSnapshot());
  const partialAsset = { ...globalAsset, resultScope: "PARTIAL_BATCH_ONLY" };
  const [globalMerged] = refresh.mergeVisibleTop8Quotes([globalAsset], sampleVisibleQuotes([globalAsset])).top8;
  const [partialMerged] = refresh.mergeVisibleTop8Quotes([partialAsset], sampleVisibleQuotes([partialAsset])).top8;
  assert.equal(globalMerged.operationalDecisionAllowed, true);
  assert.equal(partialMerged.operationalDecisionAllowed, false, "un activo sin scope GLOBAL nunca es operativo");
  assert.equal(partialMerged.dataMode, "DATA_UNAVAILABLE");
});

// El estado agregado del dashboard nunca autoriza EXEC.
const finalStatus = refresh.mergeScanSnapshotUniverseStatus(empty.initialSystemStatus, sampleFinalSnapshot());
assert.equal(finalStatus.operationalDecisionAllowed, false);
assert.ok(finalStatus.operationalBlockReasons.includes("EXEC_REQUIRES_FINAL_REAL_PRICE_AND_OPEN_MARKET"));
assert.equal(refresh.updateSystemStatusForDataMode(finalStatus, "REAL", null).operationalDecisionAllowed, false);

// El motor del servidor nunca emite EXEC por sí mismo.
const { calculateScore } = await import(repoUrl("api/_lib/scoreEngine.js"));
const strong = calculateScore({
  operabilityStatus: "OPERABLE", marketStatus: "OPEN", dataQuality: "GOOD", eligibleForScore: true,
  eligibilityBlockedReasons: [], executionBlockedReasons: [],
  technicals: { ema20: 110, ema50: 100, ema20SlopePercent: 4, atrPercent: 2, momentum20: 15, avgValue20: 2e8, rvol: 2, rs60: 15, maxDrawdown20: 2 },
});
assert.ok(["WATCH", "STANDBY", "BLOCKED"].includes(strong.action), `el servidor no decide EXEC (emitió ${strong.action})`);

console.log(`EXEC only global real open validation OK: ${breakers.length} condiciones de bloqueo verificadas.`);
