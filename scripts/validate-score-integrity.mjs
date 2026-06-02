import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scoreSource = await readFile("api/_lib/scoreEngine.js", "utf8");
const domainSource = await readFile("shared/types/domain.ts", "utf8");
const policySource = await readFile("src/utils/operationalDataPolicy.ts", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");

assert.match(scoreSource, /const SCORE_WEIGHTS = \{/);
assert.match(scoreSource, /trend:\s*25/);
assert.match(scoreSource, /momentum:\s*20/);
assert.match(scoreSource, /relativeStrength:\s*20/);
assert.match(scoreSource, /liquidity:\s*15/);
assert.match(scoreSource, /volatility:\s*10/);
assert.match(scoreSource, /drawdown:\s*10/);
assert.doesNotMatch(scoreSource, /EMA20 \/ EMA50 = 20/);
assert.match(domainSource, /export interface ScoreInputIntegrity/);
assert.match(policySource, /EMA20:\s*"ERROR"/);
assert.match(policySource, /Spread:\s*"ERROR"/);
assert.match(policySource, /ATR:\s*"ERROR"/);
assert.match(policySource, /REAL_SCORE_INPUTS_REQUIRED/);
assert.match(refreshSource, /scoreInputIntegrity:\s*ERROR_SCORE_INPUT_INTEGRITY/);

console.log("Score integrity validation OK: formulas are unchanged and non-real score inputs block operational decisions.");
