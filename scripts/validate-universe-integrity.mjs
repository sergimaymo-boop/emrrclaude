import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const systemSource = await readFile("src/components/SystemStatusCards.tsx", "utf8");
const scanSnapshotSource = await readFile("api/_lib/scanSnapshot.js", "utf8");

assert.match(domainSource, /universeDiscovered: number/);
assert.match(domainSource, /universeOperable: number/);
assert.match(domainSource, /universeEligibleForScore: number/);
assert.match(domainSource, /universeRanked: number/);
assert.match(domainSource, /finalTop8Count: number/);
assert.match(domainSource, /operationalDataStatus: OperationalDataStatus/);
assert.match(refreshSource, /startScanSnapshot/);
assert.match(refreshSource, /continueScanSnapshot/);
assert.match(refreshSource, /mergeScanSnapshotUniverseStatus/);
assert.match(refreshSource, /source:\s*"METADATA_ONLY"/);
assert.match(scanSnapshotSource, /universeDiscovered/);
assert.match(scanSnapshotSource, /universeAfterFilters/);
assert.match(scanSnapshotSource, /batchesTotal/);
assert.match(scanSnapshotSource, /coveragePercent/);
assert.match(systemSource, /Universe Discovered/);
assert.match(systemSource, /Operational Data/);

console.log("Universe integrity validation OK.");
