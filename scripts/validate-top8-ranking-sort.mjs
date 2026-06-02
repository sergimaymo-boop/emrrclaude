import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const candidateSource = await readFile("api/_lib/candidateEvaluationEngine.js", "utf8");
const snapshotSource = await readFile("api/_lib/scanSnapshot.js", "utf8");

assert.match(candidateSource, /scoreDelta = right\.score - left\.score/);
assert.match(candidateSource, /convictionDelta = right\.conviction - left\.conviction/);
assert.match(candidateSource, /riskDelta = \(riskRank\[left\.risk\]/);
assert.match(candidateSource, /qualityDelta = \(dataQualityRank\[left\.dataQuality\]/);
assert.match(candidateSource, /rightLiquidity - leftLiquidity/);
assert.match(candidateSource, /\.slice\(0, 8\)/);
assert.match(snapshotSource, /sortSnapshotTopCandidates/);
assert.match(snapshotSource, /rank: index \+ 1/);

console.log("TOP 8 ranking sort validation OK.");
