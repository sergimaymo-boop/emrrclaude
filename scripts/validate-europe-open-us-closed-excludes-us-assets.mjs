import assert from "node:assert/strict";
import { buildSnapshotPlan, getActiveMarketsAt } from "../api/_lib/scanSnapshot.js";

const europeOpenUsClosedUtc = "2026-06-02T08:30:00.000Z";
const usOpenEuropeClosedUtc = "2026-06-02T17:00:00.000Z";
const bothClosedUtc = "2026-06-02T22:00:00.000Z";

const fakeUniverse = {
  summary: { totalDiscovered: 4 },
  assets: [
    {
      ticker: "EU1",
      providerSymbol: "EU1.XETRA",
      region: "Europe",
      exchange: "XETRA",
      providerExchange: "XETRA",
      currency: "EUR",
      operabilityStatus: "OPERABLE",
    },
    {
      ticker: "EU2",
      providerSymbol: "EU2.LSE",
      region: "Europe",
      exchange: "LSE",
      providerExchange: "LSE",
      currency: "GBX",
      operabilityStatus: "OPERABLE",
    },
    {
      ticker: "US1",
      providerSymbol: "US1.US",
      region: "USA",
      exchange: "NASDAQ",
      providerExchange: "US",
      currency: "USD",
      operabilityStatus: "OPERABLE",
    },
    {
      ticker: "US2",
      providerSymbol: "US2.US",
      region: "USA",
      exchange: "NYSE",
      providerExchange: "US",
      currency: "USD",
      operabilityStatus: "OPERABLE",
    },
  ],
};

const europeOnly = buildSnapshotPlan(fakeUniverse, europeOpenUsClosedUtc, { batchSize: 50 });
assert.deepEqual(getActiveMarketsAt(europeOpenUsClosedUtc), ["Europe"]);
assert.equal(europeOnly.eligibleAssets.length, 2);
assert.equal(europeOnly.eligibleAssets.every((asset) => asset.region === "Europe"), true);

const usaOnly = buildSnapshotPlan(fakeUniverse, usOpenEuropeClosedUtc, { batchSize: 50 });
assert.deepEqual(getActiveMarketsAt(usOpenEuropeClosedUtc), ["USA"]);
assert.equal(usaOnly.eligibleAssets.length, 2);
assert.equal(usaOnly.eligibleAssets.every((asset) => asset.region === "USA"), true);

const closed = buildSnapshotPlan(fakeUniverse, bothClosedUtc, { batchSize: 50 });
assert.deepEqual(getActiveMarketsAt(bothClosedUtc), []);
assert.equal(closed.eligibleAssets.length, 0);
assert.equal(closed.state.status, "DATA_UNAVAILABLE");

console.log("Europe-open / US-closed exclusion validation OK.");
