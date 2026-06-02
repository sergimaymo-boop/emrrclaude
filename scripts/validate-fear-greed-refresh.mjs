import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const panelSource = await readFile("src/components/FearGreedPanel.tsx", "utf8");

assert.match(emptyDataSource, /unavailableFearGreed/);
assert.match(emptyDataSource, /dataMode:\s*"ERROR"/);
assert.match(emptyDataSource, /source:\s*"none"/);
assert.match(emptyDataSource, /affectsScore:\s*false/);
assert.match(emptyDataSource, /affectsRanking:\s*false/);
assert.match(emptyDataSource, /affectsExec:\s*false/);
assert.match(emptyDataSource, /operationalDataStatus:\s*"DATA_UNAVAILABLE"/);
assert.match(dashboardSource, /NO_APPROVED_REAL_FEAR_GREED_SOURCE/);
assert.doesNotMatch(dashboardSource, /refreshFearGreed|MOCK/);
assert.match(panelSource, /Fear & Greed unavailable/);
assert.match(panelSource, /DATA UNAVAILABLE/);
assert.match(panelSource, /not used for Score, Ranking or EXEC/);

console.log("Fear & Greed refresh validation OK.");
