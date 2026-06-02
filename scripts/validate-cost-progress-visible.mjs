import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const panelSource = await readFile("src/components/ScanStatusPanel.tsx", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");

assert.match(domainSource, /coveragePercent/);
assert.match(domainSource, /estimatedProviderCalls/);
assert.match(domainSource, /actualProviderCalls/);
assert.match(panelSource, /Coverage \{scanState\.coveragePercent\}%/);
assert.match(panelSource, /Calls \{scanState\.actualProviderCalls\}\/\{scanState\.estimatedProviderCalls/);
assert.match(dashboardSource, /recommendedNextAction/);

console.log("Cost and progress visible validation OK.");
