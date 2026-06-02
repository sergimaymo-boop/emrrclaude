import assert from "node:assert/strict";
import { isMarketOpen, getRegionalMarketStates } from "../src/utils/marketHours.ts";

assert.equal(isMarketOpen("Nasdaq", new Date("2026-06-01T14:00:00.000Z")), "OPEN");
assert.equal(isMarketOpen("NYSE", new Date("2026-01-05T14:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("NYSE", new Date("2026-01-05T15:00:00.000Z")), "OPEN");
assert.equal(isMarketOpen("Xetra", new Date("2026-06-01T07:30:00.000Z")), "OPEN");
assert.equal(isMarketOpen("Euronext", new Date("2026-06-01T16:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("LSE", new Date("2026-06-01T16:00:00.000Z")), "OPEN");
assert.equal(isMarketOpen("Nasdaq", new Date("2026-06-06T14:00:00.000Z")), "CLOSED");

const bothOpen = getRegionalMarketStates(new Date("2026-06-01T14:00:00.000Z"));
assert.equal(bothOpen.europe, "OPEN");
assert.equal(bothOpen.unitedStates, "OPEN");
assert.equal(bothOpen.marketMode, "BOTH_OPEN");

console.log("Market hours validation OK.");
