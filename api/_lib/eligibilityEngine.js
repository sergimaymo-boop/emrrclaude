import { SPREAD_POLICY_STATUS, classifySpreadPolicy } from "./spreadPolicy.js";

const MIN_PRICE = 5;
const MIN_HISTORY_ABSOLUTE_BARS = 80;
const MIN_HISTORY_FULL_SCORE_BARS = 260;
const MAX_SPREAD_PERCENT = 0.35;

const REGIONAL_THRESHOLDS = {
  USA: {
    minAvgVolume20: 200_000,
    minAvgValue20: 10_000_000,
  },
  Europe: {
    minAvgVolume20: 100_000,
    minAvgValue20: 5_000_000,
  },
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateUniverseEligibility({
  asset,
  technicalResult,
  spreadPercent = null,
  spreadStatus = null,
  marketStatus = "UNKNOWN",
  dataQuality = "UNKNOWN",
}) {
  const blockedReasons = [];
  const executionBlockedReasons = [];
  const warnings = [];
  const spreadPolicy = classifySpreadPolicy({ spreadPercent, spreadStatus, maxSpreadPercent: MAX_SPREAD_PERCENT });

  if (!asset) blockedReasons.push("ASSET_MISSING");

  if (asset?.operabilityStatus === "UNKNOWN") {
    blockedReasons.push("OPERABILITY_UNKNOWN_CANNOT_EXEC");
    executionBlockedReasons.push("OPERABILITY_UNKNOWN_CANNOT_EXEC");
  }
  if (asset?.operabilityStatus === "NOT_OPERABLE") {
    blockedReasons.push("NOT_OPERABLE_FOR_OPERATIONAL_TOP8");
    executionBlockedReasons.push("NOT_OPERABLE_FOR_OPERATIONAL_TOP8");
  }

  if (!technicalResult?.ok) {
    blockedReasons.push(...(technicalResult?.blockedReasons ?? ["TECHNICALS_MISSING"]));
  }

  const technicals = technicalResult?.technicals;
  if (technicals) {
    const thresholds = REGIONAL_THRESHOLDS[asset?.region] ?? REGIONAL_THRESHOLDS.Europe;
    const validBars = technicalResult?.validBars ?? 0;

    if (validBars < MIN_HISTORY_ABSOLUTE_BARS) {
      // Hard block: fewer than 80 bars — cannot calculate anything meaningful
      blockedReasons.push("INSUFFICIENT_HISTORY_ABSOLUTE");
    } else if (validBars < MIN_HISTORY_FULL_SCORE_BARS) {
      // Soft block: 80-259 bars — can score diagnostically, blocks operational EXEC
      // Per MASTER_CODEX: "Entre 80 y 259 sesiones quedan bloqueados para ranking real"
      // but CAN appear as WATCH/diagnostic in the panel
      executionBlockedReasons.push("INSUFFICIENT_HISTORY_FOR_FULL_SCORE");
      warnings.push("INSUFFICIENT_HISTORY_FOR_FULL_SCORE");
    }

    if (!isFiniteNumber(technicals.lastClose) || technicals.lastClose < MIN_PRICE) {
      blockedReasons.push("PRICE_BELOW_MINIMUM");
    }

    if (!isFiniteNumber(technicals.avgVolume20) || technicals.avgVolume20 < thresholds.minAvgVolume20) {
      blockedReasons.push("ILLIQUID_AVG_VOLUME_20_BELOW_MINIMUM");
    }

    if (!isFiniteNumber(technicals.avgValue20) || technicals.avgValue20 < thresholds.minAvgValue20) {
      blockedReasons.push("ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM");
    }

    if (!isFiniteNumber(technicals.atrPercent) || technicals.atrPercent <= 0) {
      blockedReasons.push("INVALID_ATR_PERCENT");
    }
  }

  if (spreadPolicy.verificationStatus === SPREAD_POLICY_STATUS.NOT_VERIFIED && spreadPolicy.status !== SPREAD_POLICY_STATUS.INVALID) {
    warnings.push("SPREAD_NOT_VERIFIED");
    // SPREAD_NOT_VERIFIED only blocks EXEC, NOT scoring.
    // Asset can appear in TOP 8 as WATCH/BLOCKED per MASTER_CODEX Fase 11.6:
    // allowedWhenUnverified: ["BLOCKED", "STANDBY", "WATCH_DIAGNOSTIC_ONLY"]
    executionBlockedReasons.push("SPREAD_NOT_VERIFIED");
  } else if (spreadPolicy.status === SPREAD_POLICY_STATUS.INVALID) {
    blockedReasons.push("INVALID_SPREAD");
  } else if (spreadPolicy.status === SPREAD_POLICY_STATUS.ABOVE_MAXIMUM) {
    blockedReasons.push("SPREAD_ABOVE_PHASE6_MAXIMUM");
  }

  if (marketStatus !== "OPEN") executionBlockedReasons.push("MARKET_NOT_OPEN");
  // DATA_QUALITY WARNING/STALE → block execution only, not scoring
  // DATA_QUALITY INVALID/NOT_CONFIGURED → hard block scoring
  if (["INVALID", "NOT_CONFIGURED"].includes(dataQuality)) {
    blockedReasons.push("DATA_QUALITY_INVALID");
  } else if (!["CLEAN", "GOOD"].includes(dataQuality)) {
    executionBlockedReasons.push("DATA_QUALITY_NOT_CLEAN_OR_GOOD");
    warnings.push("DATA_QUALITY_NOT_CLEAN_OR_GOOD");
  }

  return {
    eligibleForScore: blockedReasons.length === 0,
    eligibleForExecution: blockedReasons.length === 0 && executionBlockedReasons.length === 0,
    blockedReasons: [...new Set(blockedReasons)],
    executionBlockedReasons: [...new Set(executionBlockedReasons)],
    warnings,
    spreadPolicy,
    thresholds: {
      minPrice: MIN_PRICE,
      minHistoryAbsoluteBars: MIN_HISTORY_ABSOLUTE_BARS,
      minHistoryFullScoreBars: MIN_HISTORY_FULL_SCORE_BARS,
      minAvgVolume20: (REGIONAL_THRESHOLDS[asset?.region] ?? REGIONAL_THRESHOLDS.Europe).minAvgVolume20,
      minAvgValue20: (REGIONAL_THRESHOLDS[asset?.region] ?? REGIONAL_THRESHOLDS.Europe).minAvgValue20,
      maxSpreadPercent: MAX_SPREAD_PERCENT,
    },
  };
}

export function buildScoreInputFromEligibility({ asset, technicalResult, eligibility, marketStatus, dataQuality }) {
  return {
    operabilityStatus: asset?.operabilityStatus ?? "UNKNOWN",
    marketStatus,
    dataQuality,
    eligibleForScore: Boolean(eligibility?.eligibleForScore),
    eligibilityBlockedReasons: eligibility?.blockedReasons ?? [],
    executionBlockedReasons: eligibility?.executionBlockedReasons ?? [],
    technicals: technicalResult?.technicals ?? null,
  };
}
