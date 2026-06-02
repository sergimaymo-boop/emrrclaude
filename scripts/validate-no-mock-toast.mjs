import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const toastSource = await readFile("src/components/Toast.tsx", "utf8");

for (const source of [dashboardSource, toastSource]) {
  assert.doesNotMatch(source, /Mock visual refresh completed/);
  assert.doesNotMatch(source, /Mock scan completed/);
  assert.doesNotMatch(source, /mock copied/i);
  assert.doesNotMatch(source, /mock ready/i);
  assert.doesNotMatch(source, /\bMOCK\b/);
}

assert.match(dashboardSource, /Scan snapshot failed - DATA UNAVAILABLE/);
assert.match(dashboardSource, /Partial diagnostic saved - continue scan to reach 100% coverage/);

console.log("No mock toast validation OK.");
