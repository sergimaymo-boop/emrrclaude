// El tamaño del universo que se muestra NO es un número fijo:
//   · servidor (handler vivo api/scan-snapshot.js): universeDiscovered = universo operable REAL
//     del momento; si el universo cambia, el recuento cambia con él;
//   · frontend (render real): ScanSummaryBar, System Status y la cabecera técnica pintan los
//     recuentos del estado (universo, operables, TOP 8 final) — nunca una cifra escrita a mano.
// Reescrito 25-sep-2026: antes buscaba textos ingleses de SystemStatusCards/TechnicalHeader
// ("Universe Discovered", "Operable {…}") que ya no existen.
import assert from "node:assert/strict";
import {
  ensureBrowserGlobals, importFrontend, invoke, loadOperableUniverse, prepareScanFixtures, readRepoFile, renderMarkup, repoUrl,
} from "./validate-harness.mjs";

await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const start = () => invoke(handler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } });

const operable = await loadOperableUniverse();
assert.equal((await start()).body.universeDiscovered, operable.length, "recuento = universo operable real");
const { STATIC_ASSETS_BY_EXCHANGE } = await import(repoUrl("api/_lib/staticUniverse.js"));
const removed = STATIC_ASSETS_BY_EXCHANGE.US.splice(0, 3);
try {
  assert.equal((await start()).body.universeDiscovered, operable.length - 3, "si el universo cambia, el recuento cambia");
} finally {
  STATIC_ASSETS_BY_EXCHANGE.US.unshift(...removed);
}

const domain = readRepoFile("shared/types/domain.ts");
for (const field of ["universeDiscovered", "universeOperable", "universeEligibleForScore", "universeRanked", "finalTop8Count"]) {
  assert.match(domain, new RegExp(`${field}: number`), `UniverseStats.${field} es un dato del estado`);
}

ensureBrowserGlobals();
const React = await import("react");
const { bar, cards, header, empty } = await importFrontend({
  bar: "src/components/ScanSummaryBar.tsx",
  cards: "src/components/SystemStatusCards.tsx",
  header: "src/components/TechnicalHeader.tsx",
  empty: "src/data/emptyDashboardData.ts",
});
const withCounts = (universeDiscovered, universeOperable, finalTop8Count) => ({
  ...empty.initialSystemStatus,
  technical: {
    ...empty.initialSystemStatus.technical,
    universeStats: { ...empty.initialSystemStatus.technical.universeStats, universeDiscovered, universeOperable, finalTop8Count, coveragePercent: 100 },
  },
});
for (const [discovered, operableCount, top8] of [[587, 581, 8], [412, 400, 5]]) {
  const status = withCounts(discovered, operableCount, top8);
  const render = (Component) => renderMarkup(React.createElement(Component, { systemStatus: status, onLogout: () => {} }));
  const [barMarkup, cardsMarkup, headerMarkup] = await Promise.all([render(bar.ScanSummaryBar), render(cards.SystemStatusCards), render(header.TechnicalHeader)]);
  assert.match(barMarkup, new RegExp(`>${discovered}<`), `ScanSummaryBar muestra ${discovered}`);
  assert.match(headerMarkup, new RegExp(`>${discovered}<`), `cabecera muestra ${discovered}`);
  assert.match(cardsMarkup, new RegExp(`Universo total</span><strong[^>]*>${discovered}<`));
  assert.match(cardsMarkup, new RegExp(`Operable</span><strong[^>]*>${operableCount}<`));
  assert.match(cardsMarkup, new RegExp(`Final TOP 8</span><strong[^>]*>${top8}<`));
}

for (const file of ["src/components/ScanSummaryBar.tsx", "src/components/SystemStatusCards.tsx", "src/components/TechnicalHeader.tsx"]) {
  assert.doesNotMatch(readRepoFile(file), /6[.,]?960|\b603\b|\b593\b|\b596\b/, `${file}: sin tamaños de universo escritos a mano`);
}

console.log("Universe count not fixed validation OK: recuentos del universo real y pintados desde el estado.");
