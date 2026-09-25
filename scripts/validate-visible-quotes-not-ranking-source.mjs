// Las cotizaciones visibles NO son fuente de ranking:
//   · el endpoint (api/visible-top8-quotes.js) no importa — ni directa ni transitivamente —
//     ningún módulo de score/ranking/universo; solo proveedores de cotización;
//   · devuelve los activos en el MISMO orden en que se le piden, sea cual sea su precio;
//   · el dashboard pide precio para el TOP 8 ya rankeado (≤ 8, en su orden, con su scanId) y al
//     fusionar las cotizaciones conserva el orden y los rangos del scan.
// Reescrito 25-sep-2026: antes exigía el texto MAX_VISIBLE_TOP8_EXCEEDED (renombrado a
// MAX_VISIBLE_QUOTES_EXCEEDED al subir el tope a 12) y otras cadenas literales.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  captureFetch, ensureBrowserGlobals, importFrontend, invoke, isolateFromProduction, jsonResponse, readRepoFile,
  repoPath, repoUrl, ROOT, sampleFinalSnapshot, sampleScanCandidate, sampleVisibleQuotes, setFetchResponder, stubModules,
} from "./validate-harness.mjs";

// ── Grafo de imports del endpoint ──
const RANKING_MODULES = [
  "scoreEngine.js", "candidateEvaluationEngine.js", "top8Pipeline.js", "top8BatchPlanner.js", "scanSnapshot.js",
  "rallyScoreEngine.js", "rallyScoreEngineTest.js", "eligibilityEngine.js", "universeResponse.js", "universeEngine.js", "technicalEngine.js",
];
const seen = new Set();
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const source = readRepoFile(file);
  for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const target = relative(ROOT, resolve(dirname(repoPath(file)), match[1] ?? match[2]));
    if (existsSync(repoPath(target))) walk(target);
  }
};
walk("api/visible-top8-quotes.js");
assert.ok(seen.has("api/_lib/providerCascade.js"), "el recorrido del grafo alcanza los proveedores (no es vacío)");
const rankingImports = [...seen].filter((file) => RANKING_MODULES.some((name) => file.endsWith(`/${name}`)));
assert.deepEqual(rankingImports, [], "el endpoint de cotizaciones no puede depender de módulos de ranking");

// ── El endpoint respeta el orden pedido ──
isolateFromProduction();
process.env.ENABLE_REAL_API_CALLS = "true";
const prices = { "ASML.AS": 700, "META.US": 612, "AMD.US": 150 };
await stubModules({
  "api/_lib/providerCascade.js": {
    cascadeQuote: async (symbol) => ({ ok: true, provider: "Finnhub", price: prices[symbol], previousClose: prices[symbol], changePercent: 0 }),
  },
});
const handler = (await import(repoUrl("api/visible-top8-quotes.js"))).default;
const requested = [["AMD", "AMD.US"], ["ASML", "ASML.AS"], ["META", "META.US"]];
const response = await invoke(handler, {
  method: "POST",
  query: {},
  body: { scanId: "scan-order", selectedAssets: requested.map(([ticker, providerSymbol]) => ({ ticker, providerSymbol, exchange: "X", currency: "USD" })) },
});
assert.equal(response.body.rankingSource, false);
assert.deepEqual(response.body.assets.map((item) => item.ticker), ["AMD", "ASML", "META"], "mismo orden que la petición, no por precio");
assert.ok(response.body.assets.every((item) => item.operationalBlockReasons.includes("PRICE_ENRICHMENT_ONLY_NOT_RANKING_SOURCE")));

// ── Dashboard: pide el TOP 8 rankeado y conserva su orden ──
ensureBrowserGlobals();
const { refresh } = await importFrontend({ refresh: "src/services/realDataRefresh.ts" });
const ranked = refresh.buildDashboardTop8FromScanSnapshot(sampleFinalSnapshot(
  Array.from({ length: 10 }, (_, index) => sampleScanCandidate({ ticker: `R${index + 1}`, providerSymbol: `R${index + 1}.US`, rank: index + 1, score: 90 - index })),
));
assert.equal(ranked.length, 8, "el dashboard nunca muestra más de 8");
const requests = captureFetch(() => jsonResponse({ ok: true, assets: [] }));
await refresh.fetchVisibleTop8Quotes(ranked);
setFetchResponder(null);
assert.deepEqual(requests[0].body.selectedAssets.map((item) => item.ticker), ranked.map((asset) => asset.ticker), "se piden en el orden del ranking");
assert.equal(requests[0].body.scanId, "scan-validator");

const quotes = sampleVisibleQuotes(ranked);
quotes.assets.reverse().forEach((quote, index) => { quote.price = 10 + index * 50; });
const merged = refresh.mergeVisibleTop8Quotes(ranked, quotes).top8;
assert.deepEqual(merged.map((asset) => asset.ticker), ranked.map((asset) => asset.ticker), "las cotizaciones no reordenan el TOP 8");
assert.deepEqual(merged.map((asset) => asset.rank), [1, 2, 3, 4, 5, 6, 7, 8]);

assert.match(readRepoFile("src/pages/DashboardPage.tsx"), /fetchVisibleTop8Quotes\(nextTop8\)/, "el dashboard enriquece el TOP 8 que salió del scan");

console.log("Visible quotes not ranking source validation OK: sin dependencias de ranking y orden del scan intacto.");
