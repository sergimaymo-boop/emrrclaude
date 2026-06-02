import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");
const fearSource = await readFile("src/components/FearGreedPanel.tsx", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const exportSource = await readFile("src/utils/export.ts", "utf8");

assert.match(domainSource, /export type DataMode = "REAL" \| "LAST_CLOSE" \| "ERROR" \| "DATA_UNAVAILABLE" \| "SCANNING" \| "PARTIAL_DATA" \| "LAST_SESSION"/);
assert.doesNotMatch(domainSource, /"MOCK" \| "REAL"/);
assert.doesNotMatch(domainSource, /"MIXED"/);
assert.doesNotMatch(domainSource, /MOCK_FALLBACK/);
assert.match(domainSource, /dashboardDataMode: DataMode/);
assert.match(domainSource, /priceDataMode: DataMode/);

assert.doesNotMatch(dashboardSource, /runMockScan|mockTop8|mockFearGreed|MOCK_SCAN|MIXED_REFRESH/);
assert.match(dashboardSource, /initialSystemStatus/);
assert.match(dashboardSource, /unavailableTop8/);
assert.match(dashboardSource, /startScanSnapshot/);
assert.match(dashboardSource, /buildDashboardTop8FromScanSnapshot/);
assert.match(dashboardSource, /coveragePercent/);
assert.match(dashboardSource, /DATA_UNAVAILABLE/);

assert.match(emptyDataSource, /dashboardDataMode:\s*"DATA_UNAVAILABLE"/);
assert.match(emptyDataSource, /top8Source:\s*"UNAVAILABLE"/);
assert.match(emptyDataSource, /resultScope:\s*"UNAVAILABLE"/);
assert.doesNotMatch(emptyDataSource, /dataMode:\s*"MOCK"|MIXED|MOCK_FALLBACK/);

assert.match(top8Source, /TOP 8 DATA UNAVAILABLE/);
assert.match(top8Source, /No fixed list/);
assert.doesNotMatch(top8Source, /MOCK_FALLBACK|MIXED/);
assert.match(fearSource, /Fear & Greed unavailable/);
assert.doesNotMatch(fearSource, /Mock refresh|MOCK/);
assert.match(refreshSource, /deriveDashboardDataMode/);
assert.doesNotMatch(refreshSource, /Mixed real price|Mock data|MOCK_FALLBACK/);
assert.match(exportSource, /DataMode/);
assert.match(exportSource, /OperationalData/);

console.log("Data mode integrity validation OK.");
