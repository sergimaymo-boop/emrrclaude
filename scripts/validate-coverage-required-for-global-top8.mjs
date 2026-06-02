import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperSource = await readFile("api/_lib/scanSnapshot.js", "utf8");
const dashboardSource = await readFile("src/services/realDataRefresh.ts", "utf8");

assert.match(helperSource, /coveragePercent === 100/);
assert.match(helperSource, /state\.batchesCompleted === state\.batchesTotal/);
assert.match(helperSource, /GLOBAL_TOP8_FINAL/);
assert.match(dashboardSource, /response\.isGlobalTop8Final !== true \|\| response\.coveragePercent !== 100/);
assert.match(dashboardSource, /GLOBAL_TOP8_REQUIRES_100_PERCENT_COVERAGE/);

console.log("Coverage-required global TOP 8 validation OK.");
