// El ranking sale de UN solo scan sobre UN solo universo:
//   · todos los candidatos de todas las respuestas (y del snapshot guardado) llevan el scanId
//     y la hora de inicio del scan que los produjo; el dashboard los sella con ese scanId y lo
//     envía al pedir cotizaciones;
//   · si el universo cambia entre start y continue (p.ej. un deploy a mitad de scan), la
//     continuación NO puede desalinear los batches en silencio: o rechaza el token o sigue
//     evaluando exactamente el universo con el que empezó (como hace Rally con eligibleTickers).
// Reescrito 25-sep-2026: antes comprobaba texto del helper muerto (ensureSameUniverse /
// SNAPSHOT_UNIVERSE_HASH_CHANGED de scanSnapshot.js), que el endpoint vivo ya no ejecuta.
import assert from "node:assert/strict";
import {
  captureFetch, ensureBrowserGlobals, importFrontend, invoke, loadOperableUniverse,
  prepareScanFixtures, repoUrl, runRallyScan, runScanSnapshot,
} from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const scanHandler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const rallyHandler = (await import(repoUrl("api/rally-scan.js"))).default;

// ── Un scanId por scan, en cada candidato ──
const responses = await runScanSnapshot(scanHandler, { batchSize: 50 });
const { scanId, scanStartedAtUtc, universeHash } = responses[0].body;
assert.match(scanId, /^scan-/);
for (const { body } of responses) {
  assert.equal(body.scanId, scanId, "el scanId no cambia entre batches");
  assert.equal(body.universeHash, universeHash, "el universeHash no cambia entre batches");
  for (const candidate of body.topCandidates ?? []) {
    assert.equal(candidate.scanId, scanId, `${candidate.ticker} debe llevar el scanId del scan`);
    assert.equal(candidate.scanStartedAtUtc, scanStartedAtUtc);
  }
}
const saved = fixture.kv.writesTo("last_scan_snapshot").at(-1).value;
assert.ok(saved.topCandidates.every((candidate) => candidate.scanId === saved.scanId), "el snapshot guardado es de un solo scan");

// ── Dashboard: sella y propaga el scanId ──
ensureBrowserGlobals();
const { refresh } = await importFrontend({ refresh: "src/services/realDataRefresh.ts" });
const top8 = refresh.buildDashboardTop8FromScanSnapshot(responses.at(-1).body);
assert.ok(top8.length > 0 && top8.every((asset) => asset.scanId === scanId), "cada tarjeta del TOP 8 lleva el scanId del scan");
const requests = captureFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, assets: [] }) }));
await refresh.fetchVisibleTop8Quotes(top8);
assert.equal(requests[0].body.scanId, scanId, "las cotizaciones se piden para el scanId mostrado");

// ── Rally: la continuación usa la lista de tickers capturada en start ──
const { STATIC_ASSETS_BY_EXCHANGE } = await import(repoUrl("api/_lib/staticUniverse.js"));
fixture.historyCalls.length = 0;
const rallyStart = await invoke(rallyHandler, { method: "POST", query: { action: "start" }, body: {} });
const rallyPayload = JSON.parse(Buffer.from(rallyStart.body.rallyToken.split(".")[0], "base64url").toString("utf8"));
const removedForRally = STATIC_ASSETS_BY_EXCHANGE.US.shift();
fixture.historyCalls.length = 0;
await invoke(rallyHandler, { method: "POST", query: { action: "continue" }, body: { rallyToken: rallyStart.body.rallyToken } });
assert.deepEqual(
  fixture.historyCalls,
  rallyPayload.eligibleTickers.slice(rallyPayload.batchSize, rallyPayload.batchSize * 2),
  "Rally continúa exactamente la lista de tickers del start aunque el universo cambie",
);
STATIC_ASSETS_BY_EXCHANGE.US.unshift(removedForRally);

// ── TOP 8: un cambio de universo a mitad de scan no puede saltarse activos en silencio ──
const universeAtStart = new Set((await loadOperableUniverse()).map((asset) => asset.providerSymbol));
fixture.historyCalls.length = 0;
let response = await invoke(scanHandler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });
const removed = STATIC_ASSETS_BY_EXCHANGE.US.shift(); // el universo cambia tras el start
try {
  while (response.body?.snapshotToken && response.status < 400) {
    response = await invoke(scanHandler, { method: "POST", query: { action: "continue" }, body: { snapshotToken: response.body.snapshotToken } });
  }
  if (response.status < 400 && response.body.coveragePercent === 100) {
    const universeNow = new Set((await loadOperableUniverse()).map((asset) => asset.providerSymbol));
    const processed = new Set(fixture.historyCalls);
    const skipped = [...universeAtStart].filter((symbol) => universeNow.has(symbol) && !processed.has(symbol));
    assert.deepEqual(
      skipped,
      [],
      "api/scan-snapshot.js handleContinue ignora el universeHash del token y re-trocea el universo ACTUAL por índice: " +
        `con un cambio de universo a mitad de scan declara coveragePercent 100 sin haber evaluado ${skipped.join(", ")} ` +
        "(presentes en el universo antes y después). Debe rechazar la continuación o conservar la lista del start.",
    );
  }
} finally {
  STATIC_ASSETS_BY_EXCHANGE.US.unshift(removed);
}

console.log("Same scanId ranking validation OK: un scanId por scan y universo coherente entre batches.");
