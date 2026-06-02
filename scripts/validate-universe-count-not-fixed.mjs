import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const scanSnapshotSource = await readFile("api/_lib/scanSnapshot.js", "utf8");
const statusSource = await readFile("src/components/SystemStatusCards.tsx", "utf8");
const headerSource = await readFile("src/components/TechnicalHeader.tsx", "utf8");

assert.match(domainSource, /universeDiscovered: number/);
assert.match(domainSource, /universeOperable: number/);
assert.match(domainSource, /universeEligibleForScore: number/);
assert.match(domainSource, /universeRanked: number/);
assert.match(domainSource, /finalTop8Count: number/);
assert.match(scanSnapshotSource, /universeDiscovered/);
assert.match(scanSnapshotSource, /universeAfterFilters/);
assert.match(scanSnapshotSource, /batchesCompleted/);
assert.match(scanSnapshotSource, /coveragePercent/);
assert.doesNotMatch(statusSource, /6,960|6960/);
assert.match(statusSource, /Universe Discovered/);
assert.match(statusSource, /Universe Operable/);
assert.match(statusSource, /Eligible \/ Ranked/);
assert.match(headerSource, /Operable \{universeStats\.universeOperable/);

console.log("Universe count not fixed validation OK.");
