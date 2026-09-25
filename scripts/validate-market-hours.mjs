import assert from "node:assert/strict";
import { isMarketOpen, getRegionalMarketStates } from "../src/utils/marketHours.ts";

assert.equal(isMarketOpen("Nasdaq", new Date("2026-06-01T14:00:00.000Z")), "OPEN");
assert.equal(isMarketOpen("NYSE", new Date("2026-01-05T14:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("NYSE", new Date("2026-01-05T15:00:00.000Z")), "OPEN");
assert.equal(isMarketOpen("Xetra", new Date("2026-06-01T07:30:00.000Z")), "OPEN");
assert.equal(isMarketOpen("Euronext", new Date("2026-06-01T16:00:00.000Z")), "CLOSED");
// LSE 08:00–16:30 hora de Londres: en verano (BST) = 07:00–15:30 UTC, en invierno = 08:00–16:30 UTC.
assert.equal(isMarketOpen("LSE", new Date("2026-06-01T15:00:00.000Z")), "OPEN");
assert.equal(isMarketOpen("LSE", new Date("2026-06-01T16:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("LSE", new Date("2026-12-01T16:00:00.000Z")), "OPEN");
// Continente en invierno (CET): 08:00–16:30 UTC.
assert.equal(isMarketOpen("Xetra", new Date("2026-12-01T07:30:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("Xetra", new Date("2026-12-01T16:15:00.000Z")), "OPEN");
// Festivos y cierres anticipados.
assert.equal(isMarketOpen("NYSE", new Date("2026-12-25T15:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("NYSE", new Date("2026-11-27T19:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("Xetra", new Date("2026-12-24T10:00:00.000Z")), "CLOSED");
assert.equal(isMarketOpen("Nasdaq", new Date("2026-06-06T14:00:00.000Z")), "CLOSED");

const bothOpen = getRegionalMarketStates(new Date("2026-06-01T14:00:00.000Z"));
assert.equal(bothOpen.europe, "OPEN");
assert.equal(bothOpen.unitedStates, "OPEN");
assert.equal(bothOpen.marketMode, "BOTH_OPEN");

console.log("Market hours validation OK.");
