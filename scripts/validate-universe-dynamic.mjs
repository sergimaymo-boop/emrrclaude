import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const typeSource = await readFile("shared/types/domain.ts", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const headerSource = await readFile("src/components/TechnicalHeader.tsx", "utf8");

assert.match(typeSource, /interface UniverseStats/);
assert.match(typeSource, /universeStats: UniverseStats/);
assert.match(emptyDataSource, /universeDiscovered:\s*0/);
assert.match(emptyDataSource, /top8Source:\s*"UNAVAILABLE"/);
assert.match(refreshSource, /mergeTop8UniverseStatus/);
assert.match(refreshSource, /universeSummary\.totalDiscovered/);
assert.match(refreshSource, /source:\s*"METADATA_ONLY"/);
assert.match(headerSource, /technical\.universeStats/);
assert.match(headerSource, /universeStats\.total/);
assert.doesNotMatch(headerSource, /6960/);

console.log("Dynamic universe metadata validation OK.");
