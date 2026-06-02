import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const scanPanelSource = await readFile("src/components/ScanStatusPanel.tsx", "utf8");
const systemStatusSource = await readFile("src/components/SystemStatusCards.tsx", "utf8");

assert.match(domainSource, /lastRealDataUpdate: TimestampPair \| null/);
assert.match(domainSource, /lastScanClicked: TimestampPair/);
assert.doesNotMatch(domainSource, /lastMockRefresh|mockRefreshTimestamp/);
assert.match(dashboardSource, /lastRealDataUpdate/);
assert.match(dashboardSource, /lastScanClicked/);
assert.doesNotMatch(dashboardSource, /lastMockRefresh|mockRefreshTimestamp/);
assert.match(scanPanelSource, /Last real/);
assert.doesNotMatch(scanPanelSource, /Last mock|MOCK/);
assert.match(systemStatusSource, /Last Real Data/);
assert.doesNotMatch(systemStatusSource, /Last Mock Refresh|MOCK/);

console.log("Separated real timestamps validation OK.");
