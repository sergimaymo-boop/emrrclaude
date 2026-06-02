import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const activeProductionFiles = [
  "src/App.tsx",
  "src/main.tsx",
  "src/pages/DashboardPage.tsx",
  "src/pages/LoginPage.tsx",
  "src/components/ActionButtons.tsx",
  "src/components/FearGreedPanel.tsx",
  "src/components/MasterIndicatorsGrid.tsx",
  "src/components/ScanStatusPanel.tsx",
  "src/components/SectorLeaders.tsx",
  "src/components/StickyMiniHeader.tsx",
  "src/components/SystemStatusCards.tsx",
  "src/components/TechnicalHeader.tsx",
  "src/components/Top8Grid.tsx",
  "src/data/emptyDashboardData.ts",
  "src/services/realDataRefresh.ts",
  "src/utils/export.ts",
  "src/utils/operationalDataPolicy.ts",
  "src/utils/systemStatus.ts",
  "shared/types/domain.ts",
  "api/visible-top8-quotes.js",
];

const forbiddenProductionPatterns = [
  /\bMOCK\b/,
  /\bMIXED\b/,
  /mockData/i,
  /mockTop8/i,
  /mockFearGreed/i,
  /runMockScan/i,
  /MOCK_FALLBACK/,
  /MOCK_TOP8/,
  /Mock visual refresh completed/,
  /Mock scan completed/,
  /MOCK_READY/,
  /MOCK_CACHE/,
  /CNN Fear & Greed \(mock\)/,
];

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readDistAssets() {
  if (!(await pathExists("dist/assets"))) return [];
  const files = await readdir("dist/assets");
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  return Promise.all(jsFiles.map(async (file) => [join("dist/assets", file), await readFile(join("dist/assets", file), "utf8")]));
}

for (const file of activeProductionFiles) {
  const source = await readFile(file, "utf8");
  for (const pattern of forbiddenProductionPatterns) {
    assert.doesNotMatch(source, pattern, `${file} must not expose ${pattern} in production dashboard path`);
  }
}

assert.equal(await pathExists("src/mocks"), false, "src/mocks must not exist in production source");
assert.equal(await pathExists("src/engines/scannerEngine.ts"), false, "scannerEngine mock path must not exist");

for (const [file, source] of await readDistAssets()) {
  for (const pattern of forbiddenProductionPatterns) {
    assert.doesNotMatch(source, pattern, `${file} production bundle must not contain ${pattern}`);
  }
}

console.log("Production dashboard no-mock validation OK.");
