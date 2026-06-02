import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const serviceSource = await readFile("src/services/realDataRefresh.ts", "utf8");

assert.match(dashboardSource, /fetchMasterIndicators\(\)\s*\n\s*\.then/);
assert.match(dashboardSource, /deriveIndicatorsDataMode\(mergedIndicators\.indicators\)/);
assert.match(serviceSource, /export function deriveIndicatorsDataMode/);
assert.match(serviceSource, /if \(top8\.length === 0 && deriveIndicatorsDataMode\(indicators\) === "REAL"\) return "PARTIAL_DATA"/);
assert.match(serviceSource, /dashboardDataMode === "PARTIAL_DATA"/);

console.log("Dashboard indicators independent validation OK.");
