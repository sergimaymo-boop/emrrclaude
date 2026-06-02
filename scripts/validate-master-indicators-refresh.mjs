import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const gridSource = await readFile("src/components/MasterIndicatorsGrid.tsx", "utf8");
const apiSource = await readFile("api/master-indicators.js", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");

assert.match(dashboardSource, /fetchMasterIndicators/);
assert.match(dashboardSource, /mergeMasterIndicators/);
assert.match(refreshSource, /\/api\/master-indicators/);
assert.match(refreshSource, /status: "NOT_AVAILABLE"/);
assert.match(refreshSource, /dataMode: "DATA_UNAVAILABLE"/);
assert.match(refreshSource, /const nextDataMode: DataMode = isStale \? "LAST_CLOSE" : "REAL"/);
assert.match(gridSource, /operational policy labeled/);
assert.match(gridSource, /indicator\.dataMode/);
assert.match(gridSource, /indicator\.cacheStatus/);
assert.match(gridSource, /indicator\.operationalDataStatus/);
assert.doesNotMatch(gridSource, /MIXED|MOCK/);
assert.match(emptyDataSource, /unavailableMasterIndicators/);
assert.match(apiSource, /ALLOWED_SYMBOLS = \["SPY", "LQD", "HYG", "VIX", "VVIX", "TNX", "MOVE"\]/);

console.log("Master Indicators refresh validation OK.");
