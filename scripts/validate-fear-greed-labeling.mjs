// Fear & Greed etiquetado con honestidad y siempre informativo (no afecta a Score/Ranking/EXEC):
//   · servidor (handler vivo fearGreedHandler.js vía /api/fear-greed): CNN disponible → su valor
//     etiquetado "CNN Business"; CNN caído con ≥4 componentes reales → composite interno
//     etiquetado como tal; CNN caído y sin datos suficientes → ok:false NOT_AVAILABLE SIN score
//     (nunca un 50 inventado);
//   · frontend: el estado vacío por defecto es NOT_AVAILABLE/ERROR sin fuente, y el panel no pinta
//     ningún número mientras no haya un score real ("—", "No se usa en Score, Ranking ni EXEC").
// Reescrito 25-sep-2026: el panel cambió a textos en español ("No disponible", 26b278c) y la
// versión anterior buscaba los textos ingleses retirados.
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, invoke, isolateFromProduction, jsonResponse, readRepoFile, renderMarkup,
  repoUrl, setFetchResponder, stubModules,
} from "./validate-harness.mjs";

isolateFromProduction();
process.env.ENABLE_REAL_API_CALLS = "true";
let cascadeOk = false;
await stubModules({
  "api/_lib/providerCascade.js": {
    cascadeQuote: async () => (cascadeOk
      ? { ok: true, provider: "Finnhub", price: 18, previousClose: 17.5, changePercent: 0.4, triedProviders: [] }
      : { ok: false, triedProviders: [{ provider: "Finnhub", ok: false, reason: "DOWN" }] }),
  },
});
const marketData = (await import(repoUrl("api/market-data.js"))).default;
const fearGreed = () => invoke(marketData, { method: "GET", query: { source: "fear-greed" } });
const CNN = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

// CNN disponible.
setFetchResponder((url) => (url === CNN ? jsonResponse({ fear_and_greed: { score: 63.4, rating: "greed", timestamp: "2026-06-03T20:00:00Z" } }) : undefined));
const cnn = await fearGreed();
assert.equal(cnn.body.ok, true);
assert.equal(cnn.body.score, 63);
assert.equal(cnn.body.source, "CNN_BUSINESS");
assert.match(cnn.body.sourceLabel, /CNN Business/);

// CNN caído y sin componentes suficientes → NO disponible, sin score.
setFetchResponder(() => undefined);
const none = await fearGreed();
assert.equal(none.status, 200);
assert.equal(none.body.ok, false);
assert.equal(none.body.status, "NOT_AVAILABLE");
assert.equal(none.body.score, undefined, "sin fuente no hay score (ni un 50 de relleno)");
assert.match(none.body.reason, /CNN no disponible/);

// CNN caído con ≥4 componentes reales → composite interno etiquetado como tal.
cascadeOk = true;
const internal = await fearGreed();
assert.equal(internal.body.ok, true);
assert.equal(internal.body.source, "INTERNAL_COMPOSITE_FALLBACK");
assert.match(internal.body.sourceLabel, /composite interno \(CNN no disponible\)/);
assert.ok(internal.body.componentsAvailable >= 4);

const vercel = JSON.parse(readRepoFile("vercel.json"));
assert.ok(vercel.rewrites.some((rule) => rule.source === "/api/fear-greed" && rule.destination === "/api/market-data?source=fear-greed"));

// ── Frontend ──
assert.match(readRepoFile("shared/types/domain.ts"), /affectsScore: false;\s*affectsRanking: false;\s*affectsExec: false;/, "tipo FearGreed: informativo por contrato");
ensureBrowserGlobals();
const React = await import("react");
const { empty, panel } = await importFrontend({
  empty: "src/data/emptyDashboardData.ts",
  panel: "src/components/FearGreedPanel.tsx",
});
const fg = empty.unavailableFearGreed;
assert.equal(fg.status, "NOT_AVAILABLE");
assert.equal(fg.dataMode, "ERROR");
assert.equal(fg.provider, "none");
assert.equal(fg.source, "none");
assert.deepEqual([fg.affectsScore, fg.affectsRanking, fg.affectsExec, fg.operationalDecisionAllowed], [false, false, false, false]);
assert.deepEqual(fg.operationalBlockReasons, ["NO_APPROVED_REAL_FEAR_GREED_SOURCE"]);

const markup = await renderMarkup(React.createElement(panel.FearGreedPanel, { masterIndicators: empty.unavailableMasterIndicators }));
assert.match(markup, /Fear &amp; Greed/);
assert.match(markup, /class="fear-score">—</, "sin score real no se pinta ningún número");
assert.doesNotMatch(markup, /\/ 100/, "sin score real no hay medidor");
assert.match(markup, /No se usa en Score, Ranking ni EXEC/);
const panelSource = readRepoFile("src/components/FearGreedPanel.tsx");
assert.match(panelSource, /"No disponible \(fallo de la fuente\)" : "No disponible"/, "estados no disponibles explícitos");
assert.match(panelSource, /typeof d\.score !== "number" \|\| !Number\.isFinite\(d\.score\)/, "solo un score numérico real activa el medidor");
assert.doesNotMatch(panelSource, /MOCK|Mock refresh/);

console.log("Fear & Greed labeling validation OK: fuente etiquetada, nunca un score inventado y panel honesto.");
