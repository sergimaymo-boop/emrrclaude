import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const policySource = await readFile("src/utils/operationalDataPolicy.ts", "utf8");

assert.match(policySource, /input\.dataMode === "REAL"/);
assert.match(policySource, /CLEAN_OR_GOOD_DATA_REQUIRED/);
assert.match(policySource, /REAL_SCORE_INPUTS_REQUIRED/);
assert.match(refreshSource, /asset\.dataMode !== "REAL" \|\| asset\.priceDataMode !== "REAL"/);
assert.match(refreshSource, /operationalDecisionAllowed:\s*false/);
assert.doesNotMatch(refreshSource, /isMockExecEligible|Mock data|MIXED|MOCK/);

console.log("TOP 8 open-market EXEC real-data validation OK.");
