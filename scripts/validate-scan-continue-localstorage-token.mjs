import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const serviceSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const actionSource = await readFile("src/components/ActionButtons.tsx", "utf8");

assert.match(dashboardSource, /SCAN_STATE_STORAGE_KEY\s*=\s*"emrr_scan_state"/);
assert.match(dashboardSource, /window\.localStorage\.setItem/);
assert.match(dashboardSource, /window\.localStorage\.getItem/);
assert.match(dashboardSource, /snapshotToken/);
assert.match(dashboardSource, /continue scan \(batch/);
assert.match(serviceSource, /continueScanSnapshot\(snapshotToken: string\)/);
assert.match(serviceSource, /batchSize:\s*100/);
assert.match(actionSource, /continueLabel/);

console.log("Scan continue localStorage token validation OK.");
