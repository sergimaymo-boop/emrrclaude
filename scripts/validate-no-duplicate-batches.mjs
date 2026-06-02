import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperSource = await readFile("api/_lib/scanSnapshot.js", "utf8");

assert.match(helperSource, /completedBatchIndexes\.includes\(state\.nextBatchIndex\)/);
assert.match(helperSource, /DUPLICATE_BATCH_INDEX/);
assert.match(helperSource, /completedBatchIndexes = \[\.\.\.state\.completedBatchIndexes, state\.nextBatchIndex\]/);

console.log("No duplicate batches validation OK.");
