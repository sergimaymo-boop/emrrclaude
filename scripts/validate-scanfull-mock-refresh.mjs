import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const tsconfigSource = await readFile("tsconfig.app.json", "utf8");

assert.match(dashboardSource, /SCAN FULL running/);
assert.match(dashboardSource, /CONTINUE SCAN running/);
assert.match(dashboardSource, /startScanSnapshot/);
assert.match(dashboardSource, /continueScanSnapshot/);
assert.match(dashboardSource, /fetchMasterIndicators/);
assert.match(dashboardSource, /DATA_UNAVAILABLE/);
assert.match(dashboardSource, /coveragePercent/);
assert.doesNotMatch(dashboardSource, /runMockScan|refreshMockDashboardData|MOCK_SCAN|MIXED_REFRESH|lastMockRefresh/);
assert.doesNotMatch(tsconfigSource, /src\/mocks/);
assert.doesNotMatch(tsconfigSource, /src\/engines\/scannerEngine\.ts/);

console.log("SCAN FULL no-substitute-data validation OK.");
