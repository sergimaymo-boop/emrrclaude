import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiSource = await readFile("api/master-indicators.js", "utf8");
const serviceSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const gridSource = await readFile("src/components/MasterIndicatorsGrid.tsx", "utf8");

assert.match(apiSource, /TNX_PROVIDER_UNRESOLVED/);
assert.match(apiSource, /dataMode:\s*price === null \? "DATA_UNAVAILABLE"/);
assert.match(serviceSource, /value:\s*indicator\.symbol === "TNX" \? "N\/A"/);
assert.match(serviceSource, /dataMode:\s*"DATA_UNAVAILABLE" as const/);
assert.match(gridSource, /if \(mode === "ERROR"\) return "RED"/);
assert.match(gridSource, /return "WHITE_GREY"/);

console.log("TNX DATA_UNAVAILABLE neutral validation OK.");
