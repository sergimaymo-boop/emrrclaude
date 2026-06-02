import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serviceSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const gridSource = await readFile("src/components/MasterIndicatorsGrid.tsx", "utf8");

assert.match(serviceSource, /const nextDataMode: DataMode = isStale \? "LAST_CLOSE" : "REAL"/);
assert.match(serviceSource, /operationalBlockReasons:\s*\["MASTER_INDICATOR_INFORMATIONAL_ONLY"\]/);
assert.match(gridSource, /if \(status === "MISS"\) return "FETCHED"/);
assert.doesNotMatch(gridSource, />MISS</);

console.log("Master indicators REAL-not-MISS validation OK.");
