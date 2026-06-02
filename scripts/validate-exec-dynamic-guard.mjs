import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");

assert.match(refreshSource, /top8Source:\s*"DYNAMIC"/);
assert.match(refreshSource, /resultScope:\s*"GLOBAL"/);
assert.match(refreshSource, /asset\.marketStatus !== "OPEN" && asset\.action === "EXEC"/);
assert.match(refreshSource, /!asset\.operationalDecisionAllowed \|\| asset\.dataMode !== "REAL" \|\| asset\.priceDataMode !== "REAL"/);
assert.match(dashboardSource, /unavailableTop8/);
assert.doesNotMatch(dashboardSource, /mockTop8|runMockScan/);
assert.doesNotMatch(refreshSource, /MOCK_FALLBACK|MIXED/);
assert.match(top8Source, /asset\.execDisabledReason/);
assert.match(top8Source, /asset\.resultScope/);
assert.match(top8Source, /asset\.operationalDataStatus/);

console.log("EXEC dynamic guard validation OK.");
