import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const fearSource = await readFile("src/components/FearGreedPanel.tsx", "utf8");
const sectorsSource = await readFile("src/components/SectorLeaders.tsx", "utf8");
const indicatorsSource = await readFile("src/components/MasterIndicatorsGrid.tsx", "utf8");
const systemSource = await readFile("src/components/SystemStatusCards.tsx", "utf8");
const technicalSource = await readFile("src/components/TechnicalHeader.tsx", "utf8");

assert.match(dashboardSource, /startScanSnapshot/);
assert.match(dashboardSource, /continueScanSnapshot/);
assert.match(dashboardSource, /coveragePercent/);
assert.match(dashboardSource, /VISIBLE_QUOTES_ENDPOINT_UNAVAILABLE/);
assert.match(dashboardSource, /DATA_UNAVAILABLE/);
assert.doesNotMatch(dashboardSource, /mockTop8|mockFearGreed|runMockScan|MOCK_SCAN|MIXED_REFRESH/);
assert.match(fearSource, /Fear & Greed unavailable/);
assert.match(fearSource, /DATA UNAVAILABLE/);
assert.doesNotMatch(fearSource, /MOCK|Mock refresh/);
assert.match(sectorsSource, /Sector leadership unavailable/);
assert.match(sectorsSource, /DATA UNAVAILABLE/);
assert.match(indicatorsSource, /operationalDataStatus/);
assert.match(indicatorsSource, /INFO ONLY/);
assert.doesNotMatch(indicatorsSource, /MIXED|MOCK/);
assert.match(systemSource, /Operational Decision/);
assert.doesNotMatch(systemSource, /Last Mock/);
assert.match(technicalSource, /Operational \{systemStatus\.operationalDataStatus\}/);
assert.doesNotMatch(technicalSource, /Mock technical status/);

console.log("Dashboard integrity validation OK.");
