// Rally Leaders no tiene listas fijas: el top-10 sale SOLO de los datos del scan.
//   · Comportamiento (handler vivo api/rally-scan.js): con datos sintéticos, el top-10 es
//     exactamente el de mayor momento a 9 meses calculado de forma independiente; si cambian
//     los datos (otra semilla), cambia el top-10 — ningún ticker está "reservado".
//   · Estático: ni el motor, ni el batch processor, ni el endpoint contienen tickers del
//     universo escritos a mano ni listas blancas/negras (comentarios excluidos).
// Reescrito 25-sep-2026: antes leía api/rally-scan/start.js, que ya no existe.
import assert from "node:assert/strict";
import {
  loadOperableUniverse, prepareScanFixtures, readRepoFile, referenceMom9m, repoUrl, runRallyScan,
  stripComments, symbolTrend, syntheticBars,
} from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const handler = (await import(repoUrl("api/rally-scan.js"))).default;
const operable = await loadOperableUniverse();

function expectedTop10(seed) {
  return operable
    .map((asset) => ({ symbol: asset.providerSymbol, mom9m: referenceMom9m(syntheticBars({ dailyPct: symbolTrend(asset.providerSymbol, seed) })) }))
    .sort((a, b) => b.mom9m - a.mom9m)
    .slice(0, 10)
    .map((item) => item.symbol);
}

const runs = [];
for (const seed of [0, 7]) {
  fixture.seed = seed;
  const final = (await runRallyScan(handler)).at(-1).body;
  assert.equal(final.isRallyFinal, true);
  const top10 = final.top10.map((asset) => asset.providerSymbol);
  assert.deepEqual(top10, expectedTop10(seed), `semilla ${seed}: el top-10 es el de mayor momento 9m de los DATOS`);
  runs.push(top10);
}
assert.notDeepEqual(new Set(runs[0]), new Set(runs[1]), "con otros datos el top-10 cambia: no hay lista fija");

// ── Estático: sin tickers del universo ni listas fijas en el código del módulo ──
const { STATIC_ASSETS_BY_EXCHANGE } = await import(repoUrl("api/_lib/staticUniverse.js"));
const universeTickers = new Set(Object.values(STATIC_ASSETS_BY_EXCHANGE).flat().map((row) => String(row.Code).toUpperCase()));
// Palabras de código que podrían coincidir con un ticker real (p.ej. POST = Post Holdings).
const CODE_WORDS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "USD", "EUR", "GBX", "GBP", "CHF",
  "OPEN", "CLOSED", "REAL", "GOOD", "WATCH", "ERROR", "SPY"]); // SPY = benchmark de fuerza relativa, no un candidato
const files = ["api/rally-scan.js", "api/_lib/rallyBatchProcessor.js", "api/_lib/rallyScoreEngine.js"];
for (const file of files) {
  const code = stripComments(readRepoFile(file));
  assert.doesNotMatch(code, /whitelist|blacklist|FIXED_TOP|fixedTop|staticTop|preferred_?ticker/i, `${file}: sin listas fijas`);
  const literals = [...code.matchAll(/["'`]([A-Z][A-Z0-9-]{1,9})(?:\.[A-Z]{1,6})?["'`]/g)].map((match) => match[1]);
  const hardcoded = [...new Set(literals.filter((literal) => universeTickers.has(literal) && literal.length >= 3))]
    .filter((literal) => !CODE_WORDS.has(literal));
  assert.deepEqual(hardcoded, [], `${file}: tickers del universo escritos a mano`);
}

console.log("Rally Leaders no fixed list validation OK: el top-10 sigue a los datos y el código no fija tickers.");
