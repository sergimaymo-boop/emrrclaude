import assert from "node:assert/strict";

const baseUrl = (process.argv[2] ?? "https://emrr-2-tendencias.vercel.app").replace(/\/$/, "");

const forbiddenBundleMarkers = [
  "Mock visual refresh completed",
  "Mock scan completed",
  "MOCK_READY",
  "MOCK_CACHE",
  "MOCK_FALLBACK",
  "mockData",
  "runMockScan",
  "staticTop8",
  "fallbackTop8",
  "demoTop8",
  "fixtureTop8",
];

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    text: await response.text(),
  };
}

async function fetchStatus(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return response.status;
}

const html = await fetchText("/");
assert.equal(html.status, 200, "Production dashboard HTML must return HTTP 200");

const assetMatch = html.text.match(/<script[^>]+src="([^"]+index-[^"]+\.js)"/);
assert.ok(assetMatch, "Production HTML must reference a Vite JS asset");

const assetPath = assetMatch[1];
assert.notEqual(
  assetPath,
  "/assets/index-BGTr6Ewp.js",
  "Production must not serve the known old mock bundle /assets/index-BGTr6Ewp.js",
);

const asset = await fetchText(assetPath);
assert.equal(asset.status, 200, "Production JS asset must return HTTP 200");

for (const marker of forbiddenBundleMarkers) {
  assert.ok(!asset.text.includes(marker), `Production bundle must not contain ${marker}`);
}

assert.ok(
  !(/\bNVDA\b[\s\S]{0,800}\bASML\b[\s\S]{0,800}\bMSFT\b/.test(asset.text) ||
    /\bNVDA\b[\s\S]{0,800}\bAVGO\b[\s\S]{0,800}\bLLY\b/.test(asset.text) ||
    /\bASML\b[\s\S]{0,800}\bSAP\b[\s\S]{0,800}\bAIR\b/.test(asset.text)),
  "Production bundle must not contain fixed TOP 8 ticker sequences",
);

const requiredRoutes = [
  "/api/health",
  "/api/providers-status",
  "/api/universe",
  "/api/master-indicators",
  "/api/visible-top8-quotes",
  "/api/scan-snapshot/start",
  "/api/scan-snapshot/continue",
  "/api/scan-snapshot/finalize",
];

for (const route of requiredRoutes) {
  const status = await fetchStatus(route);
  assert.notEqual(status, 404, `${route} must not return 404 in production`);
}

console.log(`Vercel production deployment validation OK for ${baseUrl}`);
