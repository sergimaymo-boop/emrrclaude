import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const policySource = await readFile("src/utils/operationalDataPolicy.ts", "utf8");
const domainSource = await readFile("shared/types/domain.ts", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");

assert.match(domainSource, /export type OperationalDataStatus = "REAL" \| "LAST_CLOSE" \| "ERROR" \| "DATA_UNAVAILABLE"/);
assert.match(domainSource, /export type DataMode = "REAL" \| "LAST_CLOSE" \| "ERROR" \| "DATA_UNAVAILABLE" \| "SCANNING" \| "PARTIAL_DATA" \| "LAST_SESSION"/);
assert.match(policySource, /"SCANNING"/);
assert.match(policySource, /"PARTIAL_DATA"/);
assert.match(policySource, /"LAST_SESSION"/);
assert.doesNotMatch(policySource, /"MOCK"|"MIXED"/);
assert.match(policySource, /LAST_CLOSE/);
assert.match(policySource, /CLEAN_OR_GOOD_DATA_REQUIRED/);
assert.match(policySource, /REAL_SCORE_INPUTS_REQUIRED/);
assert.match(policySource, /LAST_CLOSE_IS_NOT_LIVE/);
assert.match(refreshSource, /deriveOperationalDataPolicy/);
assert.match(refreshSource, /operationalDecisionAllowed:\s*false/);
assert.match(refreshSource, /DATA_UNAVAILABLE/);
assert.doesNotMatch(refreshSource, /MOCK|MIXED|MOCK_FALLBACK/);
assert.match(top8Source, /NO OPERATION/);

console.log("Operational data policy validation OK.");
