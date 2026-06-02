import assert from "node:assert/strict";
import { buildSnapshotPlan } from "../api/_lib/scanSnapshot.js";

const universe = {
  assets: [
    { region: "USA", exchange: "NASDAQ", providerExchange: "US", ticker: "A", providerSymbol: "A.US", currency: "USD", operabilityStatus: "OPERABLE" },
    { region: "USA", exchange: "NYSE", providerExchange: "US", ticker: "B", providerSymbol: "B.US", currency: "USD", operabilityStatus: "OPERABLE" },
    { region: "Europe", exchange: "EURONEXT", providerExchange: "PA", ticker: "C", providerSymbol: "C.PA", currency: "EUR", operabilityStatus: "OPERABLE" },
  ],
};

const usOpenEuClosed = "2026-06-02T17:35:00.000Z";
const plan = buildSnapshotPlan(universe, usOpenEuClosed, { batchSize: 100 });

assert.deepEqual(plan.state.activeMarkets, ["USA"]);
assert.equal(plan.state.universeDiscovered, 2);
assert.equal(plan.state.universeAfterFilters, 2);
assert.equal(plan.batchPlan.totalOperableCandidates, 2);
assert.equal(plan.batchPlan.batchSize, 100);

console.log("Active-market universe filter validation OK.");
