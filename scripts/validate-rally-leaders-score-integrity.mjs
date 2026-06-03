import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const score = await readFile("api/_lib/rallyScoreEngine.js", "utf8");
// v2.0 weights: RS 33%, Momentum 23%, Trend 17%, proximity52w 7%
assert.match(score, /relativeStrength.*0\.33|0\.33.*relativeStrength/, "RS weight must be 33% (v2.0)");
assert.match(score, /momentum.*0\.23|0\.23.*momentum/, "Momentum weight must be 23% (v2.0)");
assert.match(score, /trend.*0\.17|0\.17.*trend/, "Trend weight must be 17% (v2.0)");
assert.match(score, /proximity52w.*0\.07|0\.07.*proximity52w/, "52W proximity weight must be 7% (v2.0)");
assert.match(score, /ELITE RALLY/, "must have ELITE RALLY range");
assert.match(score, /STRONG RALLY/, "must have STRONG RALLY range");
assert.match(score, /applyPenalties/, "must have penalty system");
assert.match(score, /normalizeRS/, "must use curve normalization for RS (v2.0)");
assert.match(score, /proximity52w|high52w/, "must have 52W high proximity (v2.0)");
assert.match(score, /directionMultiplier|isAccumulation/, "must have direction-aware RVOL (v2.0)");
console.log("validate-rally-leaders-score-integrity OK (v2.0)");
