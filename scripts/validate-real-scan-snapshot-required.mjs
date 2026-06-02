import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const startEndpoint = await readFile("api/scan-snapshot/start.js", "utf8");
const continueEndpoint = await readFile("api/scan-snapshot/continue.js", "utf8");
const finalizeEndpoint = await readFile("api/scan-snapshot/finalize.js", "utf8");

assert.match(dashboardSource, /startScanSnapshot/);
assert.match(dashboardSource, /continueScanSnapshot/);
assert.match(dashboardSource, /applySnapshotResult\(startScanSnapshot\(\)/);
assert.doesNotMatch(dashboardSource, /fetchTop8Status/);
assert.doesNotMatch(dashboardSource, /runMockScan|refreshMockDashboardData|staticTop8|fallbackTop8|sampleTop8/);
assert.match(refreshSource, /POST/);
assert.match(refreshSource, /\/api\/scan-snapshot\/start/);
assert.match(refreshSource, /\/api\/scan-snapshot\/continue/);

for (const endpointSource of [startEndpoint, continueEndpoint, finalizeEndpoint]) {
  assert.match(endpointSource, /request\.method !== "POST"/);
  assert.match(endpointSource, /METHOD_NOT_ALLOWED/);
  assert.match(endpointSource, /QUERY_NOT_ALLOWED/);
}

assert.match(startEndpoint, /buildUniverseResponse\(\{ includeFullAssets: true \}\)/);
assert.match(startEndpoint, /processNextSnapshotBatch/);
assert.match(continueEndpoint, /decodeScanSnapshotToken/);
assert.match(finalizeEndpoint, /COVERAGE_PERCENT_BELOW_100/);

console.log("Real scan snapshot required validation OK.");
