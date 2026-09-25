// Un SCAN FULL parcial se puede REANUDAR: el dashboard guarda el token de continuación en
// localStorage ("emrr_scan_state") y lo borra en cuanto el scan llega al 100 % o se lanza uno nuevo.
// Prueba de COMPORTAMIENTO de los helpers internos de DashboardPage.tsx (storeScanState /
// loadStoredScanState / clearSessionCacheForNewScan), expuestos solo en el bundle de prueba.
// Además: la reanudación usa el token guardado y el tamaño de batch pedido es uno que el
// servidor acepta (parseSnapshotBatchSize lo acota a 50–100).
// Reescrito 25-sep-2026: antes exigía el texto "continue scan (batch", batchSize: 100 en el
// servicio y ActionButtons.continueLabel (componente que ya no se renderiza).
import assert from "node:assert/strict";
import {
  captureFetch, ensureBrowserGlobals, importFrontend, installMemoryLocalStorage, isolateFromProduction, jsonResponse,
  readRepoFile, repoUrl,
} from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();
const store = installMemoryLocalStorage();
const { dash, refresh } = await importFrontend(
  { dash: "src/pages/DashboardPage.tsx", refresh: "src/services/realDataRefresh.ts" },
  { exposePrivate: { "src/pages/DashboardPage.tsx": ["storeScanState", "loadStoredScanState", "clearSessionCacheForNewScan"] } },
);
const KEY = "emrr_scan_state";

dash.storeScanState({ scanId: "scan-1", snapshotToken: "tok-3", coveragePercent: 25, batchesTotal: 12, batchesCompleted: 3, nextBatchIndex: 3 });
const saved = JSON.parse(store.get(KEY));
assert.equal(saved.snapshotToken, "tok-3", "el token del parcial se guarda para reanudar");
assert.equal(saved.nextBatchIndex, 3);
assert.deepEqual(dash.loadStoredScanState(), { ...saved }, "y se recupera al recargar");

dash.storeScanState({ scanId: "scan-1", snapshotToken: "tok-12", coveragePercent: 100 });
assert.equal(store.has(KEY), false, "al 100 % no queda token reanudable");
dash.storeScanState({ scanId: "scan-2", snapshotToken: "tok-1", coveragePercent: 8 });
dash.storeScanState({ scanId: "scan-2", snapshotToken: null, coveragePercent: 8 });
assert.equal(store.has(KEY), false, "sin token no se guarda estado reanudable");

store.set(KEY, JSON.stringify({ scanId: "scan-3" }));
assert.equal(dash.loadStoredScanState(), null, "un estado sin token no se reanuda");
store.set(KEY, "{no es json");
assert.equal(dash.loadStoredScanState(), null, "un estado corrupto no rompe la carga");

store.set(KEY, JSON.stringify({ scanId: "scan-4", snapshotToken: "tok" }));
store.set("emrr_session_cache", "{}");
dash.clearSessionCacheForNewScan();
assert.equal(store.has(KEY), false, "un scan nuevo descarta el token anterior");
assert.equal(store.has("emrr_session_cache"), false);

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /Previous scan available - batch/, "al recargar se ofrece continuar el scan previo");
assert.match(dashboard, /continueScanSnapshot\(paused\.snapshotToken\)/, "la reanudación usa el token guardado");

const { parseSnapshotBatchSize } = await import(repoUrl("api/_lib/scanSnapshot.js"));
const requests = captureFetch(() => jsonResponse({ ok: true }));
await refresh.startScanSnapshot();
const effective = parseSnapshotBatchSize(requests[0].body.batchSize);
assert.ok(effective >= 50 && effective <= 100, `el servidor ejecuta batches de 50–100 (pedido ${requests[0].body.batchSize} → ${effective})`);
assert.deepEqual([0, 25, 100, 1000, "x"].map(parseSnapshotBatchSize), [50, 50, 100, 100, 100], "batchSize saneado a [50, 100]");

console.log("Scan continue localStorage token validation OK: token guardado solo mientras el scan es parcial.");
