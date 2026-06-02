import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const activeProductionFiles = [
  "src/pages/DashboardPage.tsx",
  "src/components/Top8Grid.tsx",
  "src/data/emptyDashboardData.ts",
  "src/services/realDataRefresh.ts",
  "api/visible-top8-quotes.js",
  "api/_lib/scanSnapshot.js",
];

const fixedTop8Markers = [
  /\bNVDA\b/,
  /\bMSFT\b/,
  /\bASML\b/,
  /\bAVGO\b/,
  /\bLLY\b/,
  /\bstaticTop8\b/i,
  /\bfallbackTop8\b/i,
  /\bsampleTop8\b/i,
  /\bMOCK_TOP8\b/,
  /\bMOCK_TOP8_PRICE_REFERENCES\b/,
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
  return Promise.all(
    files
      .filter((file) => file.endsWith(".js"))
      .map(async (file) => [join("dist/assets", file), await readFile(join("dist/assets", file), "utf8")]),
  );
}

for (const file of activeProductionFiles) {
  const source = await readFile(file, "utf8");
  for (const pattern of fixedTop8Markers) {
    assert.doesNotMatch(source, pattern, `${file} must not contain fixed TOP 8 marker ${pattern}`);
  }
}

const quotesSource = await readFile("api/visible-top8-quotes.js", "utf8");
assert.match(quotesSource, /selectedAssets/, "visible quotes must require selected snapshot assets");
assert.match(quotesSource, /rankingSource:\s*false/, "visible quotes must not be a ranking source");
assert.match(quotesSource, /GET does not expose a fixed substitute list/, "GET must not expose default tickers");

for (const [file, source] of await readDistAssets()) {
  for (const pattern of fixedTop8Markers) {
    assert.doesNotMatch(source, pattern, `${file} production bundle must not contain fixed TOP 8 marker ${pattern}`);
  }
}

console.log("No fixed TOP 8 production validation OK.");
