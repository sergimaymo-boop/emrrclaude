// Integridad del motor Rally Leaders v4.0 CERTIFICADO (CLAUDE.md §10b — parámetros de
// estrategia BLOQUEADOS: solo cambian con un estudio walk-forward que supere los gates de §10c).
// Comprueba por COMPORTAMIENTO, con cálculos de referencia independientes:
//   score = round(clamp(50 + 50·tanh(mom9m/75))) con mom9m = momento de 189 sesiones (puro:
//   no depende del SPY) · rangos ELITE/STRONG/ACTIVE/WATCH/DISCARD · <200 barras → DISCARD ·
//   stop = round(clamp(12 + 0,35·runway, 15, 45)) · pesos M9_RAW en [4, 20] con Σ = 100,0 exacto
//   · rotación 0,7·score + 0,3·runway · top-10 con desempate por mom9m · score mínimo 60.
// Reescrito 25-sep-2026: la versión anterior exigía los pesos de la v2.0 (RS 33 %…), retirada.
import assert from "node:assert/strict";
import { prepareScanFixtures, referenceMom9m, repoUrl, syntheticBars } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const engine = await import(repoUrl("api/_lib/rallyScoreEngine.js"));
const { runRallyBatch, mergeRallyCandidates } = await import(repoUrl("api/_lib/rallyBatchProcessor.js"));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const expectedScore = (mom9m) => Math.round(clamp(50 + 50 * Math.tanh(mom9m / 75), 0, 100));

assert.equal(engine.RALLY_ENGINE_VERSION, "4.0.0", "versión certificada del motor");
assert.deepEqual(
  engine.RALLY_RANGES.map((range) => [range.min, range.label]),
  [[90, "ELITE RALLY"], [80, "STRONG RALLY"], [70, "ACTIVE RALLY"], [60, "WATCH"], [0, "DISCARD"]],
);

const spyUp = syntheticBars({ start: 400, dailyPct: 0.08 });
const spyDown = syntheticBars({ start: 400, dailyPct: -0.08 });
for (const dailyPct of [-0.3, -0.05, 0.01, 0.05, 0.12, 0.2, 0.35, 0.6]) {
  const bars = syntheticBars({ dailyPct });
  const result = engine.calculateRallyScore({ bars, spyBars: spyUp });
  const mom9m = referenceMom9m(bars);
  assert.equal(result.ok, true);
  assert.equal(result.rallyScore, expectedScore(mom9m), `score v4 para mom9m=${mom9m.toFixed(2)} %`);
  assert.equal(result.label, engine.getRallyLabel(result.rallyScore).label);
  assert.ok(Math.abs(result.metrics.mom9m - mom9m) < 0.01, "metrics.mom9m = momento 189 sesiones");
  assert.equal(engine.calculateRallyScore({ bars, spyBars: spyDown }).rallyScore, result.rallyScore, "el score v4 no depende del SPY (momento puro)");
  assert.equal(result.trailingStop, engine.suggestedStopPct(result.runway?.score), "stop sugerido = función del recorrido");
}

const short = engine.calculateRallyScore({ bars: syntheticBars({ count: 199 }), spyBars: spyUp });
assert.equal(short.ok, false);
assert.equal(short.label, "DISCARD", "menos de 200 barras → DISCARD");

// Stop adaptativo 15–45 %.
assert.deepEqual([0, 50, 100].map((runway) => engine.suggestedStopPct(runway)), [15, 30, 45]);
assert.equal(engine.suggestedStopPct(-50), 15);
assert.equal(engine.suggestedStopPct(500), 45);

// Pesos M9_RAW: [4, 20], Σ = 100,0 exacto, monótonos en el momento.
const moms = [12, 25, 40, 55, 70, 90, 120, 160, 220, 300];
const weighted = engine.assignSuggestedWeights(moms.map((mom9m, index) => ({ ticker: `W${index}`, metrics: { mom9m } })));
const weights = weighted.map((asset) => asset.suggestedWeightPct);
assert.ok(weights.every((weight) => weight >= 4 && weight <= 20), `pesos dentro de [4, 20]: ${weights}`);
assert.equal(Math.round(weights.reduce((sum, weight) => sum + weight, 0) * 10), 1000, "Σ pesos = 100,0");
weights.slice(1).forEach((weight, index) => assert.ok(weight >= weights[index], "más momento → igual o más peso"));
const three = engine.assignSuggestedWeights([10, 50, 90].map((mom9m) => ({ metrics: { mom9m } }))).map((asset) => asset.suggestedWeightPct);
assert.equal(Math.round(three.reduce((a, b) => a + b, 0) * 10), 1000);
assert.ok(three.every((weight) => Math.abs(weight - 100 / 3) <= 0.1), "menos de 5 posiciones → equiponderado");

// Rotación 70/30.
assert.equal(engine.rotationRank(80, 50), 71);
assert.equal(engine.rotationRank(90, null), 78, "sin recorrido → neutro 50");

// Batch processor: score mínimo 60 y top-10 con desempate por mom9m crudo.
fixture.barsFor = (symbol) => syntheticBars({ dailyPct: symbol.startsWith("WEAK") ? 0.02 : 0.3 });
const batch = await runRallyBatch({
  eligibleAssets: [{ providerSymbol: "STRONG.US", ticker: "STRONG" }, { providerSymbol: "WEAK.US", ticker: "WEAK" }],
  batchIndex: 0, batchSize: 10, existingCandidates: [], spyBars: spyUp,
});
assert.deepEqual(batch.candidates.map((candidate) => candidate.ticker), ["STRONG"], "score < 60 no entra en el ranking");
const merged = mergeRallyCandidates(
  [],
  Array.from({ length: 14 }, (_, index) => ({ providerSymbol: `M${index}.US`, rallyScore: 100, metrics: { mom9m: 150 + index } })),
);
assert.equal(merged.length, 10, "top-10");
assert.deepEqual(merged.map((candidate) => candidate.metrics.mom9m), [163, 162, 161, 160, 159, 158, 157, 156, 155, 154], "desempate por mom9m crudo");

console.log("Rally Leaders score integrity validation OK: motor v4.0 certificado (score, stop, pesos, rotación, top-10).");
