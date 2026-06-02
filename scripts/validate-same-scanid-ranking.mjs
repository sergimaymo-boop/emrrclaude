import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperSource = await readFile("api/_lib/scanSnapshot.js", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");

assert.match(helperSource, /scanId: snapshotState\.scanId/);
assert.match(helperSource, /universeHash/);
assert.match(helperSource, /SNAPSHOT_UNIVERSE_HASH_CHANGED/);
assert.match(refreshSource, /scanId: response\.scanId/);
assert.match(refreshSource, /snapshotToken/);

console.log("Same scanId ranking validation OK.");
