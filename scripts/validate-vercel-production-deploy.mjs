// Humo de PRODUCCIÓN (red, solo GET — opt-in en run-all-validators con --include-network):
//   · el HTML sirve un bundle de Vite nuevo, sin marcadores mock ni secuencias de TOP 8 fijo;
//   · las rutas reales de la API responden (cualquier código salvo 404: un POST-only contestará
//     405 a este GET, lo que prueba que la función existe).
// Nunca hace POST ni llama a rutas con efectos (cron de Telegram, noticias, cartera IBK, scans).
// Reescrito 25-sep-2026: exigía /api/universe, que desde el 23-ago-2026 es una librería
// (api/_lib/universeResponse.js) y no un endpoint HTTP.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readRepoFile, repoPath } from "./validate-harness.mjs";

const baseUrl = (process.argv[2] ?? "https://emrrclaude.vercel.app").replace(/\/$/, "");

// Rutas GET sin efectos que el dashboard usa; cada una debe existir en el repo (rewrite de
// vercel.json o función en api/) para que esta lista no se desincronice del código.
const requiredRoutes = [
  "/api/master-indicators",
  "/api/fear-greed",
  "/api/market-regime",
  "/api/monetary-cycle",
  "/api/optimal2026",
  "/api/sp500",
  "/api/market-breadth",
  "/api/visible-top8-quotes",
  "/api/rally-scan/last",
  "/api/rally-test/last",
  "/api/scan-snapshot/start",
  "/api/scan-snapshot/continue",
  "/api/scan-snapshot/last",
];
const vercel = JSON.parse(readRepoFile("vercel.json"));
for (const route of requiredRoutes) {
  const rewritten = vercel.rewrites.some((rule) => rule.source === route);
  const isFunction = existsSync(repoPath(`${route.slice(1)}.js`));
  assert.ok(rewritten || isFunction, `${route} no existe en el repo (ni rewrite ni función)`);
}

const forbiddenBundleMarkers = [
  "Mock visual refresh completed", "Mock scan completed", "MOCK_READY", "MOCK_CACHE", "MOCK_FALLBACK",
  "mockData", "runMockScan", "staticTop8", "fallbackTop8", "demoTop8", "fixtureTop8",
];

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`, { method: "GET" });
  return { status: response.status, text: await response.text() };
}

const html = await fetchText("/");
assert.equal(html.status, 200, "Production dashboard HTML must return HTTP 200");
const assetMatch = html.text.match(/<script[^>]+src="([^"]+index-[^"]+\.js)"/);
assert.ok(assetMatch, "Production HTML must reference a Vite JS asset");
assert.notEqual(assetMatch[1], "/assets/index-BGTr6Ewp.js", "Production must not serve the known old mock bundle");
const asset = await fetchText(assetMatch[1]);
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

for (const route of requiredRoutes) {
  const { status } = await fetchText(route);
  assert.notEqual(status, 404, `${route} must not return 404 in production`);
}

console.log(`Vercel production deployment validation OK for ${baseUrl}`);
