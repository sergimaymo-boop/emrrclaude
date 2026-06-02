import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");
const policySource = await readFile("src/utils/operationalDataPolicy.ts", "utf8");

assert.match(policySource, /dataMode:\s*DataMode/);
assert.match(policySource, /REAL_SCORE_INPUTS_REQUIRED/);
assert.match(refreshSource, /asset\.marketStatus !== "OPEN" && asset\.action === "EXEC"/);
assert.match(refreshSource, /!asset\.operationalDecisionAllowed \|\| asset\.dataMode !== "REAL" \|\| asset\.priceDataMode !== "REAL"/);
assert.match(refreshSource, /Quote unavailable - EXEC disabled/);
assert.match(refreshSource, /Data unavailable - EXEC disabled/);
assert.match(refreshSource, /Last close only - EXEC disabled/);
assert.doesNotMatch(refreshSource, /Mock data|Mixed real price|MOCK|MIXED/);
assert.match(top8Source, /asset\.execDisabledReason/);
assert.match(top8Source, /displayAction\(asset\.action\)/);
assert.match(top8Source, /asset\.operationalDecisionAllowed \? "OPERATIONAL" : "NO OPERATION"/);

console.log("EXEC real-data guard validation OK.");
