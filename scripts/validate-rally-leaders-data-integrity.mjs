import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const start = await readFile("api/rally-scan/start.js", "utf8");
const kv = await readFile("api/_lib/kvStorage.js", "utf8");
assert.match(start, /dataMode.*REAL|REAL.*dataMode/, "rally candidates must have REAL dataMode");
assert.match(kv, /last_rally_snapshot/, "KV storage must have rally key");
assert.match(kv, /saveLastRallySnapshot/, "must export saveLastRallySnapshot");
assert.match(kv, /loadLastRallySnapshot/, "must export loadLastRallySnapshot");
console.log("validate-rally-leaders-data-integrity OK");
