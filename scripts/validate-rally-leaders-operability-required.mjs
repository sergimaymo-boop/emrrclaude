import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const start = await readFile("api/rally-scan/start.js", "utf8");
assert.match(start, /operabilityStatus.*OPERABLE|OPERABLE.*operabilityStatus/, "rally scan must filter for OPERABLE assets only");
console.log("validate-rally-leaders-operability-required OK");
