import assert from "node:assert/strict";
import {
  attachSnapshotToken,
  buildSnapshotPlan,
  decodeScanSnapshotToken,
  processNextSnapshotBatch,
} from "../api/_lib/scanSnapshot.js";

process.env.ENABLE_REAL_API_CALLS = "true";
process.env.EODHD_API_KEY = "test_key";
process.env.SCAN_SNAPSHOT_SIGNING_SECRET = "test_scan_secret";

function buildBars() {
  const start = new Date("2026-03-24T00:00:00.000Z");
  return Array.from({ length: 70 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const close = 100 + index;
    return {
      date: date.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 2_000_000 + index * 10_000,
    };
  });
}

function buildAsset(index) {
  return {
    canonicalId: `NASDAQ:CSNAP${index}:USD`,
    ticker: `CSNAP${index}`,
    providerSymbol: `CSNAP${index}.US`,
    name: `Continuable Snapshot ${index}`,
    region: "USA",
    market: "Nasdaq/NYSE",
    providerExchange: "US",
    exchange: "NASDAQ",
    currency: "USD",
    isin: `USCSNAP${String(index).padStart(4, "0")}`,
    instrumentType: "Common Stock",
    operabilityStatus: "OPERABLE",
    operabilityReasons: ["OPERABLE_COMMON_EQUITY_METADATA"],
  };
}

global.fetch = async (url) => {
  const text = String(url);
  if (text.includes("/api/eod/")) return { ok: true, json: async () => buildBars() };
  if (text.includes("/api/real-time/")) return { ok: true, json: async () => ({ bid: 169.9, ask: 170.1, close: 170 }) };
  return { ok: false, status: 404, json: async () => ({}) };
};

const universe = {
  ok: true,
  summary: {
    totalDiscovered: 120,
    operable: 120,
    notOperable: 0,
    unknown: 0,
  },
  assets: Array.from({ length: 120 }, (_, index) => buildAsset(index)),
};
const scanStartedAtUtc = "2026-06-01T15:00:00.000Z";
const { eligibleAssets, state } = buildSnapshotPlan(universe, scanStartedAtUtc, { batchSize: 50 });

assert.equal(eligibleAssets.length, 120);
assert.equal(state.batchSize, 50);
assert.equal(state.batchesTotal, 3);
assert.equal(state.coveragePercent, 0);

const firstBatch = await processNextSnapshotBatch({ state, eligibleAssets });
assert.equal(firstBatch.batchesCompleted, 1);
assert.equal(firstBatch.nextBatchIndex, 2);
assert.equal(firstBatch.coveragePercent, 33.33);
assert.equal(firstBatch.resultScope, "PARTIAL_BATCH_ONLY");
assert.equal(firstBatch.isGlobalTop8Final, false);
assert.equal(firstBatch.top8Status, "TOP_8_PARTIAL_DIAGNOSTIC");
assert.ok(firstBatch.actualProviderCalls > 0);
assert.ok(firstBatch.topCandidates.every((asset) => asset.scanId === firstBatch.scanId));

const signed = attachSnapshotToken(firstBatch);
assert.equal(signed.tokenStatus, "SIGNED");
assert.ok(signed.snapshotToken);

const decoded = decodeScanSnapshotToken(signed.snapshotToken);
assert.equal(decoded.ok, true);
assert.equal(decoded.state.scanId, firstBatch.scanId);

console.log("Continuable scan snapshot validation OK.");
