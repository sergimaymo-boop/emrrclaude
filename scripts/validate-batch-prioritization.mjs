import assert from "node:assert/strict";
import { buildTop8BatchPlan, getTop8Batch, prioritizeUniverseCandidates } from "../api/_lib/top8BatchPlanner.js";

const assets = [
  { region: "Europe", exchange: "SIX", providerExchange: "SW", ticker: "ZZZ", providerSymbol: "ZZZ.SW", operabilityStatus: "OPERABLE", marketCapitalization: 9 },
  { region: "USA", exchange: "NASDAQ", providerExchange: "US", ticker: "AAA", providerSymbol: "AAA.US", operabilityStatus: "OPERABLE", marketCapitalization: 10 },
  { region: "USA", exchange: "NASDAQ", providerExchange: "US", ticker: "BBB", providerSymbol: "BBB.US", operabilityStatus: "OPERABLE", marketCapitalization: 5000 },
  { region: "USA", exchange: "NYSE", providerExchange: "US", ticker: "CCC", providerSymbol: "CCC.US", operabilityStatus: "OPERABLE", marketCapitalization: 10000 },
];

const ordered = prioritizeUniverseCandidates(assets);
assert.deepEqual(ordered.map((asset) => asset.ticker), ["BBB", "AAA", "CCC", "ZZZ"]);

const plan = buildTop8BatchPlan(assets);
assert.equal(plan.batchSize, 100);
assert.equal(plan.totalBatches, 1);

const batch = getTop8Batch(assets, 1);
assert.deepEqual(batch.assets.map((asset) => asset.ticker), ["BBB", "AAA", "CCC", "ZZZ"]);

console.log("Batch prioritization validation OK.");
