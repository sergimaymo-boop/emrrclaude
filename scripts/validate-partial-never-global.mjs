import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperSource = await readFile("api/_lib/scanSnapshot.js", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");

assert.match(helperSource, /PARTIAL_BATCH_ONLY/);
assert.match(helperSource, /isPartialResult: !isGlobalTop8Final/);
assert.match(dashboardSource, /TOP 8 PARTIAL DIAGNOSTIC/);
assert.match(dashboardSource, /coverage \${snapshot\.coveragePercent}%/);
assert.match(top8Source, /TOP 8 DATA UNAVAILABLE/);
assert.doesNotMatch(dashboardSource, /GLOBAL_TOP8_FINAL.*coveragePercent < 100/s);

console.log("Partial never global validation OK.");
