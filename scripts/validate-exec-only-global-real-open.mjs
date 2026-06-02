import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const policySource = await readFile("src/utils/operationalDataPolicy.ts", "utf8");
const helperSource = await readFile("api/_lib/scanSnapshot.js", "utf8");

assert.match(refreshSource, /resultScope === "GLOBAL_TOP8_FINAL"/);
assert.match(refreshSource, /asset\.marketStatus !== "OPEN"/);
assert.match(policySource, /input\.dataMode === "REAL"/);
assert.match(policySource, /hasRealScoreInputs/);
assert.match(helperSource, /EXEC_REQUIRES_GLOBAL_TOP8_FINAL/);
assert.match(helperSource, /evaluation\?\.marketStatus === "OPEN"/);
assert.doesNotMatch(refreshSource, /operationalDecisionAllowed:\s*true\s*,/);

console.log("EXEC only global real open validation OK.");
