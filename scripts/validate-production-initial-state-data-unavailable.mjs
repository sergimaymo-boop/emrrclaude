import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");

assert.match(emptyDataSource, /unavailableTop8: Top8Asset\[\] = \[\]/);
assert.match(emptyDataSource, /dashboardDataMode:\s*"DATA_UNAVAILABLE"/);
assert.match(emptyDataSource, /operationalDataStatus:\s*"DATA_UNAVAILABLE"/);
assert.match(emptyDataSource, /REAL_DATA_NOT_LOADED/);
assert.match(emptyDataSource, /REAL_TOP8_NOT_AVAILABLE/);

assert.match(dashboardSource, /useState<Top8Asset\[\]>\(unavailableTop8\)/);
assert.match(dashboardSource, /status:\s*"DATA_UNAVAILABLE"/);
assert.match(dashboardSource, /resultScope:\s*"UNAVAILABLE"/);
assert.match(dashboardSource, /recommendedNextAction:\s*"SCAN_FULL_REQUIRED"/);

assert.match(top8Source, /TOP 8 DATA UNAVAILABLE/);
assert.match(top8Source, /no real operational ranking available|Global operational TOP 8 is not available/);

console.log("Production initial DATA_UNAVAILABLE validation OK.");
