import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const serviceSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const snapshotSource = await readFile("api/_lib/scanSnapshot.js", "utf8");

assert.match(dashboardSource, /async function runAutoChainedScan/);
assert.match(dashboardSource, /while\s*\(\s*snapshotNeedsContinuation\(snapshot\)\s*\)/);
assert.match(dashboardSource, /continueScanSnapshot\(snapshot\.snapshotToken/);
assert.match(dashboardSource, /MAX_AUTO_BATCH_RETRIES\s*=\s*2/);
assert.match(dashboardSource, /Analizando\.\.\. batch/);
assert.match(dashboardSource, /finalizeScanSnapshot\(snapshot\.snapshotToken\)/);
assert.match(serviceSource, /AbortController/);
assert.match(serviceSource, /timeoutMs\s*=\s*8000/);
assert.match(snapshotSource, /filterEstimatedEligibleAssets/);
assert.match(snapshotSource, /DEFAULT_MAX_METADATA_PRE_ELIGIBLE_ASSETS\s*=\s*600/);

console.log("Scan auto-chain validation OK.");
