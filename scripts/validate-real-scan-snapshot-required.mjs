// El TOP 8 solo puede salir del endpoint REAL de scan (api/scan-snapshot.js), nunca de datos
// sustitutos:
//   · start/continue solo aceptan POST (405 si no); start rechaza query extra (QUERY_NOT_ALLOWED);
//     continue exige token; no existe endpoint finalize (se guarda al completar, CLAUDE.md §3.2);
//   · con ENABLE_REAL_API_CALLS apagado: 409 DATA_UNAVAILABLE, cero activos y cero llamadas a
//     proveedores (INV-04: sin datos reales no hay TOP 8, jamás uno inventado);
//   · el frontend hace POST a /api/scan-snapshot/start y /continue y el dashboard encadena
//     start → continue sin fuentes alternativas.
// Reescrito 25-sep-2026: antes leía api/scan-snapshot/{start,continue,finalize}.js, que no existen.
import assert from "node:assert/strict";
import {
  assertEnvelope, captureFetch, ensureBrowserGlobals, importFrontend, invoke, prepareScanFixtures,
  readRepoFile, repoUrl,
} from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;

// ── Método y query ──
for (const action of ["start", "continue"]) {
  const wrong = await invoke(handler, { method: "GET", query: { action } });
  assert.equal(wrong.status, 405, `${action} por GET → 405`);
  assert.equal(wrong.body.error, "METHOD_NOT_ALLOWED");
  assertEnvelope(wrong, `${action} 405`);
}
const withQuery = await invoke(handler, { method: "POST", query: { action: "start", symbol: "AAPL" }, body: {} });
assert.equal(withQuery.status, 400);
assert.equal(withQuery.body.error, "QUERY_NOT_ALLOWED", "start no admite parámetros que alteren el universo");
const noToken = await invoke(handler, { method: "POST", query: { action: "continue" }, body: {} });
assert.equal(noToken.status, 400);
assert.equal(noToken.body.error, "SNAPSHOT_TOKEN_REQUIRED");
const finalize = await invoke(handler, { method: "POST", query: { action: "finalize" }, body: {} });
assert.equal(finalize.status, 400, "no existe acción finalize");
assert.equal(finalize.body.error, "UNKNOWN_ACTION");
const vercel = JSON.parse(readRepoFile("vercel.json"));
assert.ok(!vercel.rewrites.some((rule) => /finalize/.test(rule.source)), "vercel.json no enruta ningún finalize");
for (const route of ["start", "continue", "last"]) {
  assert.ok(
    vercel.rewrites.some((rule) => rule.source === `/api/scan-snapshot/${route}` && rule.destination === `/api/scan-snapshot?action=${route}`),
    `rewrite /api/scan-snapshot/${route} → handler único`,
  );
}

// ── Sin API real: 409 sin datos sustitutos ──
delete process.env.ENABLE_REAL_API_CALLS;
fixture.historyCalls.length = 0;
const gated = await invoke(handler, { method: "POST", query: { action: "start" }, body: {} });
assert.equal(gated.status, 409, "sin ENABLE_REAL_API_CALLS=true el scan no arranca");
assert.equal(gated.body.ok, false);
assert.equal(gated.body.status, "DATA_UNAVAILABLE");
assert.equal(gated.body.isGlobalTop8Final, false);
assert.deepEqual(gated.body.assets, [], "cero activos sustitutos");
assert.equal(fixture.historyCalls.length, 0, "cero llamadas a proveedores con la puerta cerrada");
assertEnvelope(gated, "start 409");
process.env.ENABLE_REAL_API_CALLS = "true";

// ── Frontend: POST reales, sin fuentes alternativas ──
ensureBrowserGlobals();
const { refresh } = await importFrontend({ refresh: "src/services/realDataRefresh.ts" });
const requests = captureFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
await refresh.startScanSnapshot();
await refresh.continueScanSnapshot("token-de-prueba");
assert.deepEqual(requests.map(({ url, method }) => `${method} ${url}`), [
  "POST /api/scan-snapshot/start",
  "POST /api/scan-snapshot/continue",
]);
assert.equal(requests[1].body.snapshotToken, "token-de-prueba", "continue envía el token del batch anterior");

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /let snapshot = await startScanSnapshot\(\)/, "el SCAN FULL arranca en el endpoint real");
assert.match(dashboard, /continueScanSnapshot\(snapshot\.snapshotToken/, "y continúa con su propio token");
assert.doesNotMatch(dashboard, /fetchTop8Status|runMockScan|refreshMockDashboardData|staticTop8|fallbackTop8|sampleTop8/);

console.log("Real scan snapshot required validation OK: POST reales, puerta de API real y sin datos sustitutos.");
