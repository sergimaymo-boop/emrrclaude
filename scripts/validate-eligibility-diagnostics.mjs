import assert from "node:assert/strict";
import { buildEligibilityDiagnostics } from "../api/_lib/candidateEvaluationEngine.js";

const diagnostics = buildEligibilityDiagnostics([
  {
    ticker: "A",
    eligibility: { eligibleForScore: false, blockedReasons: ["INSUFFICIENT_HISTORY_FOR_FULL_SCORE", "PRICE_BELOW_MINIMUM"] },
    technicalResult: { blockedReasons: [] },
    blockedReasons: [],
    executionBlockedReasons: [],
    operabilityReasons: [],
  },
  {
    ticker: "B",
    eligibility: { eligibleForScore: false, blockedReasons: ["ILLIQUID_AVG_VOLUME_20_BELOW_MINIMUM", "SPREAD_NOT_VERIFIED"] },
    technicalResult: { blockedReasons: [] },
    blockedReasons: [],
    executionBlockedReasons: [],
    operabilityReasons: [],
  },
], { batchSize: 100 });

assert.equal(diagnostics.eligibilityDiagnosticsAvailable, true);
assert.equal(diagnostics.batchSize, 100);
assert.equal(diagnostics.passedEligibility, 0);
assert.equal(diagnostics.blockedReasons.insufficientHistory, 1);
assert.equal(diagnostics.blockedReasons.belowMinPrice, 1);
assert.equal(diagnostics.blockedReasons.belowMinVolume, 1);
assert.equal(diagnostics.blockedReasons.spreadTooWide, 1);

console.log("Eligibility diagnostics validation OK.");
