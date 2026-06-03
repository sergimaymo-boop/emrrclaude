import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const start = await readFile("api/rally-scan/start.js", "utf8");
assert.match(start, /isRealApiEnabled|ENABLE_REAL_API_CALLS/, "rally scan must check real API gate");
assert.match(start, /409/, "rally scan must return 409 when unavailable");
console.log("validate-rally-leaders-market-hours OK");
