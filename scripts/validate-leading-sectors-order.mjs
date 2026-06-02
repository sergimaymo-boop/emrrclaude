import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/components/SectorLeaders.tsx", "utf8");

assert.match(source, /LEADING:\s*0/);
assert.match(source, /ACCELERATING:\s*1/);
assert.match(source, /WEAKENING:\s*2/);
assert.match(source, /FALLING:\s*3/);
assert.match(source, /stateDifference !== 0/);
assert.match(source, /return second\.performance - first\.performance/);

console.log("Leading sectors order validation OK.");
