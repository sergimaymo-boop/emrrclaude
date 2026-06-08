const SCORE_WEIGHTS = {
  trend: 25,
  momentum: 20,
  relativeStrength: 20,
  liquidity: 15,
  volatility: 10,
  drawdown: 10,
};

const MIN_AVG_VALUE_20 = 5_000_000;
const MAX_ATR_PERCENT_FOR_LOW_RISK = 4;
const MAX_ATR_PERCENT_FOR_MEDIUM_RISK = 8;
const MAX_DRAWDOWN_20_FOR_LOW_RISK = 8;
const MAX_DRAWDOWN_20_FOR_MEDIUM_RISK = 15;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function scaled(value, min, max) {
  if (!isFiniteNumber(value) || min === max) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

export function calculateDynamicTrailing(atrPercent) {
  if (!isFiniteNumber(atrPercent) || atrPercent <= 0) {
    return {
      trailing_adjusted: null,
      trailing_medium: null,
      trailing_wide: null,
      blockedReasons: ["INVALID_ATR_PERCENT"],
    };
  }

  return {
    trailing_adjusted: round(atrPercent * 0.65),
    trailing_medium: round(atrPercent * 1),
    trailing_wide: round(atrPercent * 1.45),
    blockedReasons: [],
  };
}

export function validateScoreInput(input) {
  const blockedReasons = [];
  const technicals = input?.technicals;

  if (!technicals) blockedReasons.push("TECHNICALS_MISSING");
  if (input?.eligibleForScore === false) blockedReasons.push("UNIVERSE_ELIGIBILITY_NOT_COMPLETE");
  if (Array.isArray(input?.eligibilityBlockedReasons)) {
    blockedReasons.push(...input.eligibilityBlockedReasons);
  }
  if (input?.operabilityStatus === "UNKNOWN") blockedReasons.push("OPERABILITY_UNKNOWN_CANNOT_EXEC");
  if (input?.operabilityStatus === "NOT_OPERABLE") blockedReasons.push("NOT_OPERABLE_FOR_OPERATIONAL_TOP8");
  if (input?.dataQuality && !["CLEAN", "GOOD"].includes(input.dataQuality)) blockedReasons.push("DATA_QUALITY_NOT_GOOD");

  if (technicals) {
    // Hard required — if missing, score is meaningless
    const hardRequiredFields = ["ema20", "ema50", "atrPercent", "momentum20", "avgValue20"];
    // Soft optional — if missing, score neutral (50) for that component
    const softOptionalFields = ["rvol", "ema20SlopePercent", "rs60", "maxDrawdown20"];

    for (const field of hardRequiredFields) {
      if (!isFiniteNumber(technicals[field])) blockedReasons.push(`INSUFFICIENT_${field.toUpperCase()}`);
    }
    // Soft fields: warn only, do not hard-block
    for (const field of softOptionalFields) {
      if (!isFiniteNumber(technicals[field])) {
        // Will score 0 for this component — acceptable degradation
      }
    }

    if (isFiniteNumber(technicals.avgValue20) && technicals.avgValue20 < MIN_AVG_VALUE_20) {
      blockedReasons.push("LIQUIDITY_BELOW_PHASE6_MINIMUM");
    }
  }

  return blockedReasons;
}

export function calculateScore(input) {
  const blockedReasons = validateScoreInput(input);
  const trailing = calculateDynamicTrailing(input?.technicals?.atrPercent);

  if (blockedReasons.length > 0 || trailing.blockedReasons.length > 0) {
    return {
      score: null,
      conviction: null,
      risk: "BLOCKED",
      action: "BLOCKED",
      trailing,
      scoreBreakdown: null,
      blockedReasons: [...blockedReasons, ...trailing.blockedReasons],
    };
  }

  const technicals = input.technicals;
  const trend = technicals.ema20 > technicals.ema50 ? 100 : scaled(technicals.ema20 - technicals.ema50, -5, 5);
  // Slope may be null if not enough bars — use 50 (neutral) as fallback
  const slopeScore = isFiniteNumber(technicals.ema20SlopePercent) ? scaled(technicals.ema20SlopePercent, -3, 5) : 50;
  const momentum = (scaled(technicals.momentum20, -12, 18) + slopeScore) / 2;
  // RS vs benchmark — 50 (neutral) if benchmark unavailable
  const relativeStrength = isFiniteNumber(technicals.rs60) ? scaled(technicals.rs60, -12, 18) : 50;
  const liquidity = scaled(technicals.avgValue20, MIN_AVG_VALUE_20, MIN_AVG_VALUE_20 * 20);
  const volatility = 100 - scaled(technicals.atrPercent, 1, 12);
  // Drawdown — 50 (neutral) if not calculable
  const drawdown = isFiniteNumber(technicals.maxDrawdown20) ? 100 - scaled(technicals.maxDrawdown20, 0, 25) : 50;

  const weightedScore =
    (trend * SCORE_WEIGHTS.trend +
      momentum * SCORE_WEIGHTS.momentum +
      relativeStrength * SCORE_WEIGHTS.relativeStrength +
      liquidity * SCORE_WEIGHTS.liquidity +
      volatility * SCORE_WEIGHTS.volatility +
      drawdown * SCORE_WEIGHTS.drawdown) /
    100;

  // Apply optional EPS quality adjustment (additive, clamped to [0,100]).
  // epsAdjustment is populated by classifyEpsQuality() in epsEngine.js:
  //   EXCELENTE (+4), BUENO (+2), NEUTRO (0), DÉBIL (−3), RIESGO_GAP (−6).
  const epsAdj = isFiniteNumber(input?.epsAdjustment) ? input.epsAdjustment : 0;
  const score = round(clamp(weightedScore + epsAdj, 0, 100), 2);
  const conviction = round(clamp(score * 0.75 + Math.min(technicals.rvol, 2) * 12.5, 0, 100), 2);
  const risk = classifyRisk(technicals);

  return {
    score,
    conviction,
    risk,
    action: score >= 70 && conviction >= 65 && risk !== "HIGH" ? "WATCH" : "STANDBY",
    trailing,
    scoreBreakdown: {
      trend: round(trend, 2),
      momentum: round(momentum, 2),
      relativeStrength: round(relativeStrength, 2),
      liquidity: round(liquidity, 2),
      volatility: round(volatility, 2),
      drawdown: round(drawdown, 2),
      weights: SCORE_WEIGHTS,
    },
    blockedReasons: [],
  };
}

export function classifyRisk(technicals) {
  if (!technicals || !isFiniteNumber(technicals.atrPercent)) {
    return "BLOCKED";
  }
  // maxDrawdown20 may be null if insufficient bars — use ATR only for risk
  if (!isFiniteNumber(technicals.maxDrawdown20)) {
    return technicals.atrPercent <= MAX_ATR_PERCENT_FOR_LOW_RISK ? "LOW"
      : technicals.atrPercent <= MAX_ATR_PERCENT_FOR_MEDIUM_RISK ? "MEDIUM" : "HIGH";
  }

  if (
    technicals.atrPercent <= MAX_ATR_PERCENT_FOR_LOW_RISK &&
    technicals.maxDrawdown20 <= MAX_DRAWDOWN_20_FOR_LOW_RISK
  ) {
    return "LOW";
  }

  if (
    technicals.atrPercent <= MAX_ATR_PERCENT_FOR_MEDIUM_RISK &&
    technicals.maxDrawdown20 <= MAX_DRAWDOWN_20_FOR_MEDIUM_RISK
  ) {
    return "MEDIUM";
  }

  return "HIGH";
}

export function rankOperationalTop8(candidates) {
  return candidates
    .filter((candidate) => candidate.operabilityStatus === "OPERABLE")
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => right.score - left.score || right.conviction - left.conviction)
    .slice(0, 8)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
