import assert from "node:assert/strict";
import { validateUniverseEligibility } from "../api/_lib/eligibilityEngine.js";

const baseTechnicalResult = {
  ok: true,
  validBars: 260,
  blockedReasons: [],
  technicals: {
    lastClose: 50,
    avgVolume20: 250_000,
    avgValue20: 12_500_000,
    atrPercent: 2,
  },
};

const base = {
  asset: { region: "USA", operabilityStatus: "OPERABLE" },
  technicalResult: baseTechnicalResult,
  spreadPercent: 0.1,
  spreadStatus: "VERIFIED",
  marketStatus: "OPEN",
  dataQuality: "GOOD",
};

assert.equal(validateUniverseEligibility(base).eligibleForScore, true);

assert.match(
  validateUniverseEligibility({ ...base, technicalResult: { ...baseTechnicalResult, validBars: 79 } }).blockedReasons.join(","),
  /INSUFFICIENT_HISTORY_ABSOLUTE/,
);
assert.match(
  validateUniverseEligibility({ ...base, technicalResult: { ...baseTechnicalResult, validBars: 259 } }).blockedReasons.join(","),
  /INSUFFICIENT_HISTORY_FOR_FULL_SCORE/,
);
assert.match(
  validateUniverseEligibility({
    ...base,
    technicalResult: { ...baseTechnicalResult, technicals: { ...baseTechnicalResult.technicals, lastClose: 4.99 } },
  }).blockedReasons.join(","),
  /PRICE_BELOW_MINIMUM/,
);
assert.match(
  validateUniverseEligibility({
    ...base,
    technicalResult: { ...baseTechnicalResult, technicals: { ...baseTechnicalResult.technicals, avgVolume20: 199_999 } },
  }).blockedReasons.join(","),
  /ILLIQUID_AVG_VOLUME_20_BELOW_MINIMUM/,
);
assert.match(
  validateUniverseEligibility({
    ...base,
    technicalResult: { ...baseTechnicalResult, technicals: { ...baseTechnicalResult.technicals, avgValue20: 9_999_999 } },
  }).blockedReasons.join(","),
  /ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM/,
);

const thresholds = validateUniverseEligibility(base).thresholds;
assert.equal(thresholds.minAvgValue20, 10_000_000);
assert.equal(thresholds.maxSpreadPercent, 0.35);

console.log("Eligibility thresholds validation OK.");
