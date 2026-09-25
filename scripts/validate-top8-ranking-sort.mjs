// Orden del TOP 8 (candidateEvaluationEngine.buildOperationalTop8FromEvaluations, usado por el
// handler vivo en cada batch): score ↓, convicción ↓, riesgo ↑ (LOW<MEDIUM<HIGH), calidad de
// dato ↑ (CLEAN<GOOD<WARNING) y liquidez ↓; solo OPERABLE + elegibles con score; máximo 8 y
// rangos 1..N. Además, el TOP 8 final del SCAN FULL son los 8 mejores scores de TODO el
// universo (la fusión entre batches no pierde ni inventa candidatos).
// Reescrito 25-sep-2026 como prueba de comportamiento (antes: regex, y parte sobre la ruta
// muerta sortSnapshotTopCandidates de scanSnapshot.js).
import assert from "node:assert/strict";
import {
  loadOperableUniverse, prepareScanFixtures, repoUrl, runScanSnapshot, symbolTrend, syntheticBars,
} from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const { buildOperationalTop8FromEvaluations, evaluateCandidate } = await import(repoUrl("api/_lib/candidateEvaluationEngine.js"));

// ── Criterios de orden, uno a uno ──
const candidate = (ticker, overrides = {}) => ({
  ticker,
  providerSymbol: `${ticker}.US`,
  operabilityStatus: "OPERABLE",
  eligibility: { eligibleForScore: true },
  score: 60,
  conviction: 50,
  risk: "MEDIUM",
  dataQuality: "GOOD",
  technicalResult: { technicals: { avgValue20: 20_000_000 } },
  ...overrides,
});
const order = (list) => buildOperationalTop8FromEvaluations(list).map((item) => item.ticker);

assert.deepEqual(order([candidate("A", { score: 50 }), candidate("B", { score: 70 }), candidate("C", { score: 60 })]), ["B", "C", "A"], "score descendente");
assert.deepEqual(order([candidate("A", { conviction: 40 }), candidate("B", { conviction: 80 })]), ["B", "A"], "empate de score → convicción descendente");
assert.deepEqual(order([candidate("A", { risk: "HIGH" }), candidate("B", { risk: "LOW" }), candidate("C", { risk: "MEDIUM" })]), ["B", "C", "A"], "empate → riesgo ascendente");
assert.deepEqual(order([candidate("A", { dataQuality: "WARNING" }), candidate("B", { dataQuality: "CLEAN" }), candidate("C")]), ["B", "C", "A"], "empate → calidad de dato");
assert.deepEqual(
  order([candidate("A", { technicalResult: { technicals: { avgValue20: 1e7 } } }), candidate("B", { technicalResult: { technicals: { avgValue20: 9e7 } } })]),
  ["B", "A"],
  "empate total → más liquidez primero",
);
assert.deepEqual(
  order([
    candidate("OK"),
    candidate("NOP", { operabilityStatus: "NOT_OPERABLE", score: 99 }),
    candidate("INEL", { eligibility: { eligibleForScore: false }, score: 99 }),
    candidate("NULL", { score: null }),
  ]),
  ["OK"],
  "solo OPERABLE, elegibles y con score entran en el ranking",
);
const ten = Array.from({ length: 10 }, (_, index) => candidate(`T${index}`, { score: 50 + index }));
const ranked = buildOperationalTop8FromEvaluations(ten);
assert.equal(ranked.length, 8, "máximo 8");
assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8], "rangos consecutivos 1..8");
assert.deepEqual(ranked.map((item) => item.ticker), ["T9", "T8", "T7", "T6", "T5", "T4", "T3", "T2"]);

// ── TOP 8 final del scan = los 8 mejores scores de todo el universo ──
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const responses = await runScanSnapshot(handler, { batchSize: 50 });
const final = responses.at(-1).body;
assert.equal(final.isGlobalTop8Final, true);
const finalScores = final.topCandidates.map((item) => item.score);
assert.deepEqual(final.topCandidates.map((item) => item.rank), finalScores.map((_, index) => index + 1), "rangos 1..N en el TOP 8 final");
assert.deepEqual([...finalScores].sort((a, b) => b - a), finalScores, "TOP 8 final ordenado por score descendente");

const operable = await loadOperableUniverse();
const referenceScores = operable
  .map((asset) => evaluateCandidate({
    asset,
    historicalBars: syntheticBars({ dailyPct: symbolTrend(asset.providerSymbol, fixture.seed) }),
    benchmarkBars: fixture.spyBars,
    spreadPercent: null,
    spreadStatus: { ok: false, blockedReason: "SPREAD_NOT_AVAILABLE", spreadPercent: null },
    marketStatus: "CLOSED",
    dataQuality: "GOOD",
  }))
  .filter((evaluation) => evaluation.eligibility.eligibleForScore && evaluation.score !== null)
  .map((evaluation) => evaluation.score)
  .sort((a, b) => b - a)
  .slice(0, 8);
assert.deepEqual(finalScores, referenceScores, "el TOP 8 final contiene los 8 mejores scores del universo completo");

console.log("TOP 8 ranking sort validation OK: criterios de desempate, tope 8 y mejores scores globales.");
