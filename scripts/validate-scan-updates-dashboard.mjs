import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");

assert.match(dashboardSource, /SCAN FULL running/);
assert.match(dashboardSource, /CONTINUE SCAN running/);
assert.match(dashboardSource, /isScanning:\s*true/);
assert.match(dashboardSource, /startScanSnapshot/);
assert.match(dashboardSource, /continueScanSnapshot/);
assert.match(dashboardSource, /buildDashboardTop8FromScanSnapshot/);
assert.match(dashboardSource, /mergeScanSnapshotUniverseStatus/);
assert.match(dashboardSource, /coveragePercent/);
assert.match(dashboardSource, /fetchMasterIndicators/);
assert.match(dashboardSource, /setSystemStatus\(nextSystemStatus\)/);
assert.match(dashboardSource, /setFearGreed\(\{/);
assert.match(dashboardSource, /setSectors\(unavailableSectors\)/);
assert.match(dashboardSource, /setTop8\(nextTop8\)/);
assert.match(dashboardSource, /lastRealDataUpdate/);
assert.match(emptyDataSource, /unavailableTop8: Top8Asset\[\] = \[\]/);
assert.doesNotMatch(dashboardSource, /runMockScan|refreshed\.top8|refreshed\.fearGreed|lastMockRefresh|MOCK_SCAN|MIXED_REFRESH/);

console.log("Scan updates dashboard validation OK.");
