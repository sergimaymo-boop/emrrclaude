// El universo NUNCA se filtra por horario de mercado (CLAUDE.md §1 y §3.2): con mercados
// abiertos o cerrados, SCAN FULL, Rally Leaders y Rally-Test escanean el MISMO universo
// operable; con mercados cerrados puntúan sobre los últimos cierres. El horario solo decide
// metadatos (activeMarkets) y el bloqueo de EXEC, jamás qué activos se analizan.
//
// Sustituye (25-sep-2026) a validate-europe-open-us-closed-excludes-us-assets.mjs y
// validate-active-market-universe-filter.mjs, que "pasaban" probando el buildSnapshotPlan
// muerto y afirmaban la regla CONTRARIA (excluir EE.UU. con su bolsa cerrada).
import assert from "node:assert/strict";
import { invoke, loadOperableUniverse, prepareScanFixtures, repoUrl, runScanSnapshot, withFrozenNow } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const scanHandler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const rallyHandler = (await import(repoUrl("api/rally-scan.js"))).default;
const { getActiveMarketsAt } = await import(repoUrl("api/_lib/scanSnapshot.js"));
const operable = await loadOperableUniverse();
const regions = new Set(operable.map((asset) => asset.region));
assert.ok(regions.has("USA") && regions.has("Europe"), "el universo operable incluye EE.UU. y Europa");

const moments = [
  { label: "Europa abierta / EE.UU. cerrado", iso: "2026-06-02T08:30:00.000Z", active: ["Europe"] },
  { label: "EE.UU. abierto / Europa cerrada", iso: "2026-06-02T17:00:00.000Z", active: ["USA"] },
  { label: "ambos abiertos", iso: "2026-06-02T14:00:00.000Z", active: ["USA", "Europe"] },
  { label: "ambos cerrados (sábado)", iso: "2026-06-06T12:00:00.000Z", active: [] },
  { label: "ambos cerrados (noche laborable)", iso: "2026-06-02T22:30:00.000Z", active: [] },
];

for (const moment of moments) {
  await withFrozenNow(moment.iso, async () => {
    assert.deepEqual(getActiveMarketsAt(moment.iso), moment.active, `${moment.label}: activeMarkets`);

    const scan = await invoke(scanHandler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });
    assert.equal(scan.status, 206, `${moment.label}: SCAN FULL arranca (no 409 por horario)`);
    assert.equal(scan.body.universeDiscovered, operable.length, `${moment.label}: SCAN FULL sobre TODO el universo operable`);
    assert.equal(scan.body.batchesTotal, Math.ceil(operable.length / 50));
    assert.deepEqual(scan.body.activeMarkets, moment.active, `${moment.label}: el horario solo se refleja como metadato`);

    for (const action of ["start", "test-start"]) {
      const rally = await invoke(rallyHandler, { method: "POST", query: { action }, body: {} });
      assert.equal(rally.status, 206, `${moment.label}: Rally ${action} arranca`);
      assert.equal(rally.body.universeCount, operable.length, `${moment.label}: Rally ${action} sobre TODO el universo operable`);
    }
  });
}

// Scan completo con AMBOS mercados cerrados: procesa EE.UU. y Europa y cierra como global.
fixture.historyCalls.length = 0;
const closedRun = await withFrozenNow("2026-06-06T12:00:00.000Z", () => runScanSnapshot(scanHandler, { batchSize: 50 }));
const processed = new Set(fixture.historyCalls);
assert.deepEqual(processed, new Set(operable.map((asset) => asset.providerSymbol)), "fin de semana: se analiza todo el universo");
assert.equal(closedRun.at(-1).body.status, "GLOBAL_TOP8_FINAL", "con mercados cerrados el scan oficial se completa igualmente");
assert.equal(closedRun.at(-1).body.coveragePercent, 100);

console.log(`Universe never filtered by market hours validation OK: ${operable.length} activos en los 5 escenarios horarios.`);
