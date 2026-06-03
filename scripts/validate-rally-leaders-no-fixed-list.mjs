import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const score = await readFile("api/_lib/rallyScoreEngine.js", "utf8");
const start = await readFile("api/rally-scan/start.js", "utf8");
assert.doesNotMatch(score, /AAPL|MSFT|NVDA|preferred_ticker/i, "no hardcoded tickers in score engine");
assert.doesNotMatch(start, /whitelist|blacklist|FIXED_TOP/i, "no fixed lists in rally scan");
console.log("validate-rally-leaders-no-fixed-list OK");
