import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const panelSource = await readFile("src/components/FearGreedPanel.tsx", "utf8");

assert.match(emptyDataSource, /unavailableFearGreed/);
assert.match(emptyDataSource, /status:\s*"NOT_AVAILABLE"/);
assert.match(emptyDataSource, /dataMode:\s*"ERROR"/);
assert.match(emptyDataSource, /NO_APPROVED_REAL_FEAR_GREED_SOURCE/);
assert.doesNotMatch(emptyDataSource, /FEAR_GREED_REFERENCE_VALUE|source:\s*"mock"|dataMode:\s*"MOCK"/);
assert.match(panelSource, /Fear & Greed unavailable/);
assert.doesNotMatch(panelSource, /MOCK|Mock refresh/);

console.log("Fear & Greed unavailable-source validation OK.");
