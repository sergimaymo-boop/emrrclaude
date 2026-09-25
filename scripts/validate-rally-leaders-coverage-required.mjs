// Rally Leaders solo publica un top-10 FINAL con cobertura del 100 % (handler vivo
// api/rally-scan.js): los batches intermedios son RALLY_SCANNING (206, ok:false, con token) y
// Redis (last_rally_snapshot) se escribe UNA vez, en el batch que completa el universo, con
// isRallyFinal y coveragePercent 100. Mismo contrato para Rally-Test en su clave propia.
// Reescrito 25-sep-2026: antes leía api/rally-scan/{start,continue}.js, que ya no existen.
import assert from "node:assert/strict";
import { assertEnvelope, invoke, loadOperableUniverse, prepareScanFixtures, repoUrl } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/rally-scan.js"))).default;
const operable = await loadOperableUniverse();

for (const { test, key } of [
  { test: false, key: "last_rally_snapshot" },
  { test: true, key: "last_rally_test_snapshot" },
]) {
  const label = test ? "Rally-Test" : "Rally Leaders";
  const [startAction, continueAction] = test ? ["test-start", "test-continue"] : ["start", "continue"];
  const writesBefore = fixture.kv.writesTo(key).length;
  const responses = [];
  let response = await invoke(handler, { method: "POST", query: { action: startAction }, body: {} });
  for (;;) {
    responses.push(response);
    const body = response.body;
    const index = responses.length - 1;
    const isLast = !body.rallyToken;
    assertEnvelope(response, `${label} llamada ${index + 1}`);
    assert.equal(body.batchesCompleted, index + 1, `${label}: un batch por llamada`);
    assert.equal(body.isRallyFinal, isLast, `${label}: isRallyFinal solo en el último batch`);
    if (isLast) {
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.status, "RALLY_FINAL");
      assert.equal(body.coveragePercent, 100);
      assert.equal(body.batchesCompleted, body.batchesTotal);
      break;
    }
    assert.equal(response.status, 206);
    assert.equal(body.ok, false);
    assert.equal(body.status, "RALLY_SCANNING");
    assert.ok(body.coveragePercent < 100, `${label}: un parcial no declara cobertura completa`);
    assert.equal(fixture.kv.writesTo(key).length, writesBefore, `${label}: Redis intacto mientras el scan es parcial`);
    assert.ok(responses.length < 60, `${label}: el scan debe terminar`);
    response = await invoke(handler, { method: "POST", query: { action: continueAction }, body: { rallyToken: body.rallyToken } });
  }

  assert.ok(responses.length > 1, `${label}: el universo requiere varios batches`);
  assert.equal(responses[0].body.universeCount, operable.length, `${label}: scan sobre el universo operable completo`);
  const writes = fixture.kv.writesTo(key).slice(writesBefore);
  assert.equal(writes.length, 1, `${label}: ${key} se escribe exactamente una vez por scan`);
  assert.equal(writes[0].value.isRallyFinal, true);
  assert.equal(writes[0].value.coveragePercent, 100);
  assert.ok(writes[0].value.top10.length > 0 && writes[0].value.top10.length <= 10, `${label}: top-10 real (1..10)`);
  assert.equal(writes[0].value.scanId, responses.at(-1).body.scanId);
}

console.log("Rally Leaders coverage required validation OK: final solo al 100 % y una única escritura por scan.");
