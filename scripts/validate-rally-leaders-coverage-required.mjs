import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const start = await readFile("api/rally-scan/start.js", "utf8");
const cont  = await readFile("api/rally-scan/continue.js", "utf8");
assert.match(start, /coveragePercent/, "must track coveragePercent");
assert.match(start, /isRallyFinal/, "must have isRallyFinal flag");
assert.match(cont,  /coveragePercent/, "continue must track coveragePercent");
assert.match(start, /saveLastRallySnapshot/, "must save to Redis only when complete");
console.log("validate-rally-leaders-coverage-required OK");
