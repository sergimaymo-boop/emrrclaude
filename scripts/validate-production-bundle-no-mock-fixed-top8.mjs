import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const requireDist = process.argv.includes("--require-dist");

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await pathExists("dist/assets"))) {
  if (requireDist) {
    throw new Error("dist/assets must exist for production bundle validation after npm run build");
  }

  console.log("Production bundle validation skipped: dist/assets does not exist. Run after npm run build.");
  process.exit(0);
}

const forbidden = [
  /\bMOCK\b/,
  /\bMIXED\b/,
  /Mock visual refresh completed/,
  /Mock scan completed/,
  /mockData/,
  /MOCK_READY/,
  /MOCK_CACHE/,
  /mockTop8/,
  /runMockScan/,
  /MOCK_FALLBACK/,
  /MOCK_TOP8/,
  /staticTop8/,
  /fallbackTop8/,
  /demoTop8/,
  /fixtureTop8/,
  /CNN Fear & Greed \(mock\)/,
  /\bNVDA\b[\s\S]{0,500}\bMSFT\b[\s\S]{0,500}\bASML\b/,
  /\bNVDA\b[\s\S]{0,800}\bASML\b[\s\S]{0,800}\bMSFT\b/,
  /\bNVDA\b[\s\S]{0,800}\bAVGO\b[\s\S]{0,800}\bLLY\b/,
  /\bASML\b[\s\S]{0,800}\bSAP\b[\s\S]{0,800}\bAIR\b/,
];

const files = (await readdir("dist/assets")).filter((file) => file.endsWith(".js"));
assert.ok(files.length > 0, "dist/assets must contain JS bundles after build");

for (const file of files) {
  const source = await readFile(join("dist/assets", file), "utf8");
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `${file} must not contain forbidden production bundle marker ${pattern}`);
  }
}

console.log("Production bundle no mock/fixed TOP 8 validation OK.");
