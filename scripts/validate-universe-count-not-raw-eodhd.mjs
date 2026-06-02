import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const universeSource = await readFile("api/universe.js", "utf8");
const snapshotSource = await readFile("api/_lib/scanSnapshot.js", "utf8");

assert.match(universeSource, /filteredRows/);
assert.match(universeSource, /rawProviderSymbolsDiscovered/);
assert.match(universeSource, /isEligibleForUniverse/);
assert.match(snapshotSource, /universeDiscovered:\s*activeAssets\.length/);
assert.match(snapshotSource, /universeAfterFilters:\s*eligibleAssets\.length/);

console.log("Universe count not raw EODHD validation OK.");
