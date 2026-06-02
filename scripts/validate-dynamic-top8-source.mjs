import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");
const masterSource = await readFile("MASTER_CODEX_V1.md", "utf8");

assert.match(dashboardSource, /startScanSnapshot/);
assert.match(dashboardSource, /continueScanSnapshot/);
assert.match(dashboardSource, /buildDashboardTop8FromScanSnapshot/);
assert.match(refreshSource, /response\.isGlobalTop8Final !== true \|\| response\.coveragePercent !== 100/);
assert.match(refreshSource, /top8Source:\s*"DYNAMIC"/);
assert.match(refreshSource, /resultScope:\s*"GLOBAL_TOP8_FINAL"/);
assert.match(top8Source, /Source \{top8Source\} · Scope \{resultScope\}/);
assert.match(top8Source, /TOP 8 DATA UNAVAILABLE/);
assert.match(masterSource, /TOP 8 visible debe derivar siempre del pipeline dinamico/);
assert.doesNotMatch(dashboardSource, /mockTop8|runMockScan/);
assert.doesNotMatch(refreshSource, /MOCK_FALLBACK|MIXED/);

console.log("Dynamic TOP 8 source validation OK.");
