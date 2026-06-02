import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activeFiles = [
  "shared/types/domain.ts",
  "src/pages/DashboardPage.tsx",
  "src/components/Top8Grid.tsx",
  "src/components/FearGreedPanel.tsx",
  "src/components/MasterIndicatorsGrid.tsx",
  "src/components/SystemStatusCards.tsx",
  "src/components/ScanStatusPanel.tsx",
  "src/components/TechnicalHeader.tsx",
  "src/services/realDataRefresh.ts",
  "src/data/emptyDashboardData.ts",
  "src/utils/operationalDataPolicy.ts",
  "api/visible-top8-quotes.js",
];

for (const file of activeFiles) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /\bMOCK\b/, `${file} must not expose MOCK in active dashboard data path`);
  assert.doesNotMatch(source, /\bMIXED\b/, `${file} must not expose MIXED in active dashboard data path`);
  assert.doesNotMatch(source, /MOCK_FALLBACK/, `${file} must not expose MOCK_FALLBACK`);
  assert.doesNotMatch(source, /FALLBACK_USED/, `${file} must not expose fallback data`);
}

const tsconfigSource = await readFile("tsconfig.app.json", "utf8");
assert.doesNotMatch(tsconfigSource, /src\/mocks/);
assert.doesNotMatch(tsconfigSource, /src\/engines\/scannerEngine\.ts/);

console.log("No MOCK/MIXED/fallback active-data validation OK.");
