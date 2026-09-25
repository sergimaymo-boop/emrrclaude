// Continuación de la política de spread (fase 11.6) para Europa/Euronext: sin bid/ask
// verificable, un activo europeo se PUNTÚA y puede figurar en el TOP 8 como WATCH, pero NUNCA
// genera EXEC; la política no admite spreads proxy ni cambios de configuración/proveedor.
// Además, en el SCAN FULL vivo (sin proveedor de spread desde la cancelación de EODHD), ningún
// candidato queda ejecutable aunque el mercado esté abierto.
//
// NOTA: SPREAD_CONTINUATION_POLICY.unverifiedSpreadGlobalTop8Allowed vale `true` desde el
// 25-sep-2026 (coherente con classifySpreadPolicy: entra en TOP 8 solo como WATCH; EXEC prohibido).
// Reescrito 25-sep-2026: la versión anterior exigía la regla antigua y leía api/top8-batch-single.js.
import assert from "node:assert/strict";
import { buildOperationalTop8FromEvaluations, evaluateCandidate } from "../api/_lib/candidateEvaluationEngine.js";
import { SPREAD_CONTINUATION_POLICY, classifySpreadPolicy, getSpreadContinuationPolicy } from "../api/_lib/spreadPolicy.js";
import { invoke, prepareScanFixtures, repoUrl, syntheticBars, US_OPEN_UTC, withFrozenNow } from "./validate-harness.mjs";

const policy = getSpreadContinuationPolicy();
assert.deepEqual(policy, { ...SPREAD_CONTINUATION_POLICY });
policy.unverifiedSpreadExecAllowed = true;
assert.equal(getSpreadContinuationPolicy().unverifiedSpreadExecAllowed, false, "la política se entrega como copia inmutable");
assert.equal(SPREAD_CONTINUATION_POLICY.spreadContinuationPolicy, "EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK");
assert.equal(SPREAD_CONTINUATION_POLICY.currentEuropeEuronextMode, "DIAGNOSTIC_ONLY");
for (const flag of ["unverifiedSpreadExecAllowed", "configurationChangeAllowed", "providerChangeAllowed", "persistenceAllowed", "spreadProxyOperationalAllowed"]) {
  assert.equal(SPREAD_CONTINUATION_POLICY[flag], false, `${flag} debe ser false`);
}
assert.equal(SPREAD_CONTINUATION_POLICY.requiresVerifiedBidAsk, true);

const unavailable = { ok: false, provider: "none", providerSymbol: "P116.AS", spreadPercent: null, blockedReason: "SPREAD_NOT_AVAILABLE" };
const classified = classifySpreadPolicy({ spreadPercent: null, spreadStatus: unavailable });
assert.equal(classified.spreadContinuationPolicy, "EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK");
assert.equal(classified.unverifiedSpreadExecAllowed, false);
assert.equal(classified.requiresVerifiedBidAsk, true);
assert.equal(classified.canGenerateExec, false);

const europeAsset = {
  canonicalId: "EURONEXT:P116:EUR", ticker: "P116", providerSymbol: "P116.AS", region: "Europe", market: "Euronext",
  providerExchange: "AS", exchange: "EURONEXT", currency: "EUR", operabilityStatus: "OPERABLE", operabilityReasons: [],
};
const evaluate = (spreadPercent, spreadStatus) => evaluateCandidate({
  asset: europeAsset, historicalBars: syntheticBars({ dailyPct: 0.3 }), benchmarkBars: syntheticBars({ start: 400, dailyPct: 0.05 }),
  spreadPercent, spreadStatus, marketStatus: "OPEN", dataQuality: "GOOD",
});
const withoutSpread = evaluate(null, unavailable);
assert.equal(withoutSpread.eligibility.eligibleForScore, true, "Europa sin spread verificado se puntúa");
assert.equal(withoutSpread.eligibility.eligibleForExecution, false, "…pero nunca es ejecutable");
assert.notEqual(withoutSpread.action, "EXEC");
assert.equal(buildOperationalTop8FromEvaluations([withoutSpread]).length, 1, "puede figurar en el TOP 8 como WATCH");
assert.equal(evaluate(0.1, { ok: true, spreadPercent: 0.1 }).eligibility.eligibleForExecution, true, "con bid/ask verificado sí es ejecutable");

// SCAN FULL vivo con el mercado abierto: ningún candidato ejecutable sin spread verificado.
await prepareScanFixtures();
const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const batch = await withFrozenNow(US_OPEN_UTC, () => invoke(handler, { method: "POST", query: { action: "start" }, body: { batchSize: 50 } }));
assert.ok(batch.body.topCandidates.length > 0);
for (const candidate of batch.body.topCandidates) {
  assert.notEqual(candidate.action, "EXEC", `${candidate.ticker}: sin spread verificado nunca EXEC`);
  assert.equal(candidate.eligibility.eligibleForExecution, false);
  assert.ok(candidate.eligibility.executionBlockedReasons.includes("SPREAD_NOT_VERIFIED"));
}

console.log("Phase 11.6 validation OK: Europa/Euronext sin bid/ask verificable → WATCH sí, EXEC nunca (también en el scan vivo).");
