// Rally Leaders y Rally-Test (handler vivo api/rally-scan.js) respetan la puerta de datos reales
// y devuelven 409 cuando no hay datos que analizar — nunca un top-10 inventado:
//   · ENABLE_REAL_API_CALLS distinto de "true" → 409 REAL_API_CALLS_DISABLED en start y continue
//     (producción y laboratorio) sin llamar a proveedores;
//   · universo no disponible → 409 RALLY_DATA_UNAVAILABLE;
//   · mercados CERRADOS no son motivo de 409: el scan corre sobre los últimos cierres (§3.2).
// Reescrito 25-sep-2026: antes leía api/rally-scan/start.js, que ya no existe.
import assert from "node:assert/strict";
import { assertEnvelope, invoke, prepareScanFixtures, repoUrl, setStub, stubModules, withFrozenNow } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
await stubModules({ "api/_lib/universeResponse.js": {} });
const handler = (await import(repoUrl("api/rally-scan.js"))).default;
const post = (action, body = {}) => invoke(handler, { method: "POST", query: { action }, body });

// Tokens legítimos obtenidos con la puerta abierta.
const prodToken = (await post("start")).body.rallyToken;
const testToken = (await post("test-start")).body.rallyToken;
assert.ok(prodToken && testToken);

// ── Puerta cerrada ──
delete process.env.ENABLE_REAL_API_CALLS;
fixture.historyCalls.length = 0;
for (const [action, body] of [["start", {}], ["test-start", {}], ["continue", { rallyToken: prodToken }], ["test-continue", { rallyToken: testToken }]]) {
  const response = await post(action, body);
  assert.equal(response.status, 409, `${action} sin API real → 409`);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "REAL_API_CALLS_DISABLED", `${action}: motivo explícito`);
  assert.equal(response.body.top10, undefined, `${action}: sin top-10 sustituto`);
  assertEnvelope(response, `${action} 409`);
}
assert.equal(fixture.historyCalls.length, 0, "con la puerta cerrada no se llama a ningún proveedor");
process.env.ENABLE_REAL_API_CALLS = "true";

// ── Universo no disponible ──
setStub("api/_lib/universeResponse.js", "buildUniverseResponse", async () => ({ ok: false, error: "UNIVERSE_NOT_READY", assets: [] }));
for (const action of ["start", "test-start"]) {
  const response = await post(action);
  assert.equal(response.status, 409, `${action} sin universo → 409`);
  assert.equal(response.body.status, "RALLY_DATA_UNAVAILABLE");
  assert.equal(response.body.error, "UNIVERSE_NOT_READY");
}
setStub("api/_lib/universeResponse.js", "buildUniverseResponse", async () => ({ ok: true, assets: [{ providerSymbol: "X.US", operabilityStatus: "NOT_OPERABLE" }] }));
const noOperable = await post("start");
assert.equal(noOperable.status, 409);
assert.equal(noOperable.body.error, "NO_OPERABLE_ASSETS");
setStub("api/_lib/universeResponse.js", "buildUniverseResponse", undefined);

// ── Mercados cerrados: NO es motivo de 409 ──
await withFrozenNow("2026-06-06T12:00:00.000Z", async () => {
  for (const action of ["start", "test-start"]) {
    const response = await post(action);
    assert.equal(response.status, 206, `${action} en fin de semana → scan normal sobre últimos cierres`);
    assert.deepEqual(response.body.activeMarkets, []);
  }
});

// ── Método ──
const wrongMethod = await invoke(handler, { method: "GET", query: { action: "start" } });
assert.equal(wrongMethod.status, 405);

console.log("Rally Leaders market-hours validation OK: puerta de API real, 409 sin datos y scan con mercados cerrados.");
