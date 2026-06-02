import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");
const tsconfigSource = await readFile("tsconfig.app.json", "utf8");

assert.doesNotMatch(dashboardSource, /mockTop8|MOCK_TOP8_PRICE_REFERENCES|runMockScan/);
assert.match(top8Source, /TOP 8 DATA UNAVAILABLE/);
assert.match(top8Source, /No synthetic prices/);
assert.doesNotMatch(tsconfigSource, /src\/mocks/);

console.log("TOP 8 synthetic price removal validation OK.");
