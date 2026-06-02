import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const endpointSource = await readFile("api/visible-top8-quotes.js", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");

assert.match(endpointSource, /mode:\s*"PRICE_ENRICHMENT_ONLY"/);
assert.match(endpointSource, /rankingSource:\s*false/);
assert.match(endpointSource, /selectedAssets/);
assert.match(endpointSource, /PROVIDER_SYMBOL_NOT_ALLOWED/);
assert.match(endpointSource, /MAX_VISIBLE_TOP8_EXCEEDED/);
assert.match(endpointSource, /GET does not expose a fixed substitute list/);
assert.doesNotMatch(endpointSource, /sortTop8Candidates|scoreEngine|top8Pipeline|getFinnhubQuote|FALLBACK_USED/);
assert.match(refreshSource, /selectedAssets:\s*selectedAssets\.slice\(0, 8\)\.map/);
assert.match(refreshSource, /scanId:\s*selectedAssets\[0\]\?\.scanId/);
assert.match(dashboardSource, /fetchVisibleTop8Quotes\(nextTop8\)/);
assert.doesNotMatch(dashboardSource, /refreshed\.top8|mockTop8|runMockScan/);

console.log("Visible quotes not ranking source validation OK.");
