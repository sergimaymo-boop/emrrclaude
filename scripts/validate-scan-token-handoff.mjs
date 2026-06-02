import assert from "node:assert/strict";
import {
  attachSnapshotToken,
  decodeScanSnapshotToken,
  finalizeScanSnapshot,
} from "../api/_lib/scanSnapshot.js";

process.env.SCAN_SNAPSHOT_SIGNING_SECRET = "handoff_secret";

const state = {
  scanId: "scan-token-test",
  scanStartedAtUtc: "2026-06-01T15:00:00.000Z",
  lastBatchCompletedAtUtc: "2026-06-01T15:01:00.000Z",
  scanCompletedAtUtc: null,
  universeHash: "hash",
  activeMarkets: ["USA"],
  universeDiscovered: 100,
  universeAfterFilters: 100,
  batchSize: 50,
  batchesTotal: 2,
  batchesCompleted: 1,
  completedBatchIndexes: [1],
  nextBatchIndex: 2,
  coveragePercent: 50,
  estimatedProviderCalls: 202,
  actualProviderCalls: 101,
  costPolicy: {},
  recommendedNextAction: "CONTINUE_SCAN",
  status: "PARTIAL_BATCH_ONLY",
  topCandidates: [],
  diagnostics: { processedBatches: [], blockedReasons: [] },
};

const signed = attachSnapshotToken(state);
assert.ok(signed.snapshotToken);
assert.equal(signed.tokenStatus, "SIGNED");

const decoded = decodeScanSnapshotToken(signed.snapshotToken);
assert.equal(decoded.ok, true);
assert.equal(decoded.state.scanId, state.scanId);
assert.equal(decoded.state.nextBatchIndex, 2);

const tampered = `${signed.snapshotToken.slice(0, -2)}xx`;
assert.equal(decodeScanSnapshotToken(tampered).ok, false);
assert.equal(finalizeScanSnapshot(decoded.state).isGlobalTop8Final, false);

console.log("Scan token handoff validation OK.");
