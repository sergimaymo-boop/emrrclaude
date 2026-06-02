import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const panelSource = await readFile("src/components/FearGreedPanel.tsx", "utf8");

assert.match(domainSource, /affectsScore: false/);
assert.match(domainSource, /affectsRanking: false/);
assert.match(domainSource, /affectsExec: false/);
assert.match(emptyDataSource, /unavailableFearGreed/);
assert.match(emptyDataSource, /status:\s*"NOT_AVAILABLE"/);
assert.match(emptyDataSource, /dataMode:\s*"ERROR"/);
assert.match(emptyDataSource, /provider:\s*"none"/);
assert.match(emptyDataSource, /NO_APPROVED_REAL_FEAR_GREED_SOURCE/);
assert.doesNotMatch(emptyDataSource, /source:\s*"mock"|dataMode:\s*"MOCK"|provider:\s*"mock"/);
assert.match(panelSource, /Fear & Greed unavailable/);
assert.match(panelSource, /DATA UNAVAILABLE/);
assert.match(panelSource, /fearGreed\.operationalDataStatus/);
assert.match(panelSource, /not used for Score, Ranking or EXEC/);
assert.doesNotMatch(panelSource, /MOCK|CNN Fear & Greed/);

console.log("Fear & Greed labeling validation OK.");
