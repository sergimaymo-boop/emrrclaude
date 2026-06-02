import { buildScoreInputFromEligibility, validateUniverseEligibility } from "./eligibilityEngine.js";
import { calculateScore } from "./scoreEngine.js";
import { calculateTechnicals } from "./technicalEngine.js";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function evaluateCandidate({
  asset,
  historicalBars,
  benchmarkBars = [],
  spreadPercent = null,
  historyStatus = null,
  spreadStatus = null,
  marketStatus = "UNKNOWN",
  dataQuality = "UNKNOWN",
}) {
  const technicalResult = calculateTechnicals(safeArray(historicalBars), safeArray(benchmarkBars));
  const eligibility = validateUniverseEligibility({
    asset,
    technicalResult,
    spreadPercent,
    spreadStatus,
    marketStatus,
    dataQuality,
  });
  const scoreResult = calculateScore(
    buildScoreInputFromEligibility({
      asset,
      technicalResult,
      eligibility,
      marketStatus,
      dataQuality,
    }),
  );

  return {
    ticker: asset?.ticker ?? null,
    providerSymbol: asset?.providerSymbol ?? null,
    name: asset?.name ?? "",
    market: asset?.region ?? "UNKNOWN",
    exchange: asset?.exchange ?? "UNKNOWN",
    currency: asset?.currency ?? null,
    operabilityStatus: asset?.operabilityStatus ?? "UNKNOWN",
    operabilityReasons: asset?.operabilityReasons ?? ["ASSET_MISSING"],
    dataQuality,
    marketStatus,
    historyStatus,
    spreadStatus,
    technicalResult,
    eligibility,
    score: scoreResult.score,
    conviction: scoreResult.conviction,
    risk: scoreResult.risk,
    action: scoreResult.action,
    trailing: scoreResult.trailing,
    scoreBreakdown: scoreResult.scoreBreakdown,
    blockedReasons: [...new Set([...eligibility.blockedReasons, ...scoreResult.blockedReasons])],
    executionBlockedReasons: eligibility.executionBlockedReasons,
    warnings: eligibility.warnings,
  };
}

export function buildOperationalTop8FromEvaluations(evaluations) {
  const riskRank = { LOW: 0, MEDIUM: 1, HIGH: 2, BLOCKED: 3 };
  const dataQualityRank = { CLEAN: 0, GOOD: 1, WARNING: 2, STALE: 3, INVALID: 4, NOT_AVAILABLE: 5, NOT_CONFIGURED: 6 };

  return safeArray(evaluations)
    .filter((evaluation) => evaluation.operabilityStatus === "OPERABLE")
    .filter((evaluation) => evaluation.eligibility?.eligibleForScore === true)
    .filter((evaluation) => evaluation.score !== null)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;

      const convictionDelta = right.conviction - left.conviction;
      if (convictionDelta !== 0) return convictionDelta;

      const riskDelta = (riskRank[left.risk] ?? 9) - (riskRank[right.risk] ?? 9);
      if (riskDelta !== 0) return riskDelta;

      const qualityDelta = (dataQualityRank[left.dataQuality] ?? 9) - (dataQualityRank[right.dataQuality] ?? 9);
      if (qualityDelta !== 0) return qualityDelta;

      const leftLiquidity = left.technicalResult?.technicals?.avgValue20 ?? 0;
      const rightLiquidity = right.technicalResult?.technicals?.avgValue20 ?? 0;
      return rightLiquidity - leftLiquidity;
    })
    .slice(0, 8)
    .map((evaluation, index) => ({ ...evaluation, rank: index + 1 }));
}

export function summarizeEvaluations(evaluations) {
  const items = safeArray(evaluations);
  return {
    analyzed: items.length,
    eligibleForScore: items.filter((item) => item.eligibility?.eligibleForScore === true).length,
    blocked: items.filter((item) => item.eligibility?.eligibleForScore !== true).length,
    operable: items.filter((item) => item.operabilityStatus === "OPERABLE").length,
    notOperable: items.filter((item) => item.operabilityStatus === "NOT_OPERABLE").length,
    unknown: items.filter((item) => item.operabilityStatus === "UNKNOWN").length,
  };
}

function incrementReason(counts, reason) {
  if (typeof reason !== "string" || reason.length === 0) return;
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function sortedReasonCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function uniqueReasons(...reasonLists) {
  return [...new Set(reasonLists.flatMap((reasons) => safeArray(reasons)))];
}

function inferRootCauseCandidates(reasonCounts) {
  const reasons = Object.keys(reasonCounts);
  const candidates = [];

  if (reasons.includes("INSUFFICIENT_HISTORY")) {
    candidates.push("Historical provider returned fewer valid bars than the technical engine requires.");
  }

  if (reasons.includes("SPREAD_NOT_VERIFIED")) {
    candidates.push("Spread provider did not return a verifiable bid/ask spread for one or more assets.");
  }

  if (reasons.includes("ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM")) {
    candidates.push("Average traded value over 20 sessions is below the Phase 6 minimum liquidity threshold.");
  }

  if (reasons.includes("INVALID_ATR_PERCENT")) {
    candidates.push("ATR% could not be calculated as a positive finite value.");
  }

  if (reasons.includes("DATA_QUALITY_NOT_GOOD")) {
    candidates.push("Data quality was not CLEAN or GOOD for one or more assets.");
  }

  if (candidates.length === 0 && reasons.length > 0) {
    candidates.push("The batch was blocked by eligibility or score guardrails; inspect perAssetBlockedReasons.");
  }

  return candidates;
}

function buildBlockedReasonCategories(items) {
  const categories = {
    insufficientHistory: 0,
    belowMinPrice: 0,
    belowMinVolume: 0,
    spreadTooWide: 0,
    notOperable: 0,
    dataQualityFailed: 0,
    typeExcluded: 0,
  };

  for (const item of items) {
    const reasons = uniqueReasons(
      item.eligibility?.blockedReasons,
      item.technicalResult?.blockedReasons,
      item.blockedReasons,
      item.operabilityReasons,
      item.historyStatus?.blockedReason ? [item.historyStatus.blockedReason] : [],
      item.spreadStatus?.blockedReason ? [item.spreadStatus.blockedReason] : [],
    );

    if (reasons.some((reason) => reason.includes("HISTORY"))) categories.insufficientHistory += 1;
    if (reasons.some((reason) => reason.includes("PRICE_BELOW_MINIMUM"))) categories.belowMinPrice += 1;
    if (reasons.some((reason) => reason.includes("VOLUME") || reason.includes("VALUE_20"))) categories.belowMinVolume += 1;
    if (reasons.some((reason) => reason.includes("SPREAD"))) categories.spreadTooWide += 1;
    if (reasons.some((reason) => reason.includes("NOT_OPERABLE") || reason.includes("OPERABILITY"))) categories.notOperable += 1;
    if (reasons.some((reason) => reason.includes("DATA_QUALITY"))) categories.dataQualityFailed += 1;
    if (reasons.some((reason) => reason.includes("EXCLUDED_INSTRUMENT") || reason.includes("TYPE"))) categories.typeExcluded += 1;
  }

  return categories;
}

function buildAssetDiagnostic(evaluation) {
  const eligibilityBlockedReasons = safeArray(evaluation.eligibility?.blockedReasons);
  const technicalBlockedReasons = safeArray(evaluation.technicalResult?.blockedReasons);
  const scoreBlockedReasons = safeArray(evaluation.blockedReasons);
  const executionBlockedReasons = safeArray(evaluation.executionBlockedReasons);
  const historyBlockedReason = evaluation.historyStatus?.blockedReason ?? null;
  const spreadBlockedReason = evaluation.spreadStatus?.blockedReason ?? null;

  return {
    ticker: evaluation.ticker,
    providerSymbol: evaluation.providerSymbol,
    name: evaluation.name,
    market: evaluation.market,
    exchange: evaluation.exchange,
    currency: evaluation.currency,
    operabilityStatus: evaluation.operabilityStatus,
    eligibleForScore: evaluation.eligibility?.eligibleForScore === true,
    eligibleForExecution: evaluation.eligibility?.eligibleForExecution === true,
    dataQuality: evaluation.dataQuality,
    marketStatus: evaluation.marketStatus,
    history: {
      ok: evaluation.historyStatus?.ok === true,
      blockedReason: historyBlockedReason,
      barCount: evaluation.historyStatus?.barCount ?? evaluation.technicalResult?.validBars ?? null,
    },
    spread: {
      ok: evaluation.spreadStatus?.ok === true,
      blockedReason: spreadBlockedReason,
      spreadPercent: evaluation.spreadStatus?.spreadPercent ?? null,
      policy: evaluation.eligibility?.spreadPolicy ?? null,
    },
    technicals: {
      ok: evaluation.technicalResult?.ok === true,
      dataQuality: evaluation.technicalResult?.dataQuality ?? null,
      validBars: evaluation.technicalResult?.validBars ?? null,
      requiredBars: evaluation.technicalResult?.requiredBars ?? null,
      blockedReasons: technicalBlockedReasons,
    },
    eligibilityBlockedReasons,
    scoreBlockedReasons,
    executionBlockedReasons,
    blockedReasons: uniqueReasons(
      eligibilityBlockedReasons,
      technicalBlockedReasons,
      scoreBlockedReasons,
      executionBlockedReasons,
      historyBlockedReason ? [historyBlockedReason] : [],
      spreadBlockedReason ? [spreadBlockedReason] : [],
    ),
  };
}

export function buildEligibilityDiagnostics(evaluations, options = {}) {
  const items = safeArray(evaluations);
  const sampleLimit = Number.isInteger(options.sampleLimit) && options.sampleLimit > 0 ? options.sampleLimit : 25;
  const blockedItems = items.filter((item) => item.eligibility?.eligibleForScore !== true);
  const blockingReasonCounts = {};
  const providerReasonCounts = {};
  const technicalReasonCounts = {};
  const executionReasonCounts = {};
  const spreadPolicyCounts = {};

  for (const item of blockedItems) {
    for (const reason of uniqueReasons(item.eligibility?.blockedReasons, item.blockedReasons)) {
      incrementReason(blockingReasonCounts, reason);
    }

    for (const reason of safeArray(item.technicalResult?.blockedReasons)) {
      incrementReason(technicalReasonCounts, reason);
    }

    for (const reason of safeArray(item.executionBlockedReasons)) {
      incrementReason(executionReasonCounts, reason);
    }

    incrementReason(spreadPolicyCounts, item.eligibility?.spreadPolicy?.status);
    incrementReason(spreadPolicyCounts, item.eligibility?.spreadPolicy?.diagnosticStatus);
    incrementReason(spreadPolicyCounts, item.eligibility?.spreadPolicy?.executionPolicy);
    incrementReason(providerReasonCounts, item.historyStatus?.blockedReason);
    incrementReason(providerReasonCounts, item.spreadStatus?.blockedReason);
  }

  const sortedBlockingReasonCounts = sortedReasonCounts(blockingReasonCounts);
  const perAssetBlockedReasons = blockedItems.slice(0, sampleLimit).map(buildAssetDiagnostic);

  return {
    eligibilityDiagnosticsAvailable: true,
    diagnosticMode: "PIPELINE_EVALUATION",
    requiresRealExecutionForPerAssetReasons: false,
    analyzed: items.length,
    eligibleForScore: items.filter((item) => item.eligibility?.eligibleForScore === true).length,
    blocked: blockedItems.length,
    knownBlockingCategories: Object.keys(sortedBlockingReasonCounts),
    batchSize: options.batchSize ?? items.length,
    passedEligibility: items.filter((item) => item.eligibility?.eligibleForScore === true).length,
    blockedReasons: buildBlockedReasonCategories(blockedItems),
    blockingReasonCounts: sortedBlockingReasonCounts,
    providerReasonCounts: sortedReasonCounts(providerReasonCounts),
    technicalReasonCounts: sortedReasonCounts(technicalReasonCounts),
    executionReasonCounts: sortedReasonCounts(executionReasonCounts),
    spreadPolicyCounts: sortedReasonCounts(spreadPolicyCounts),
    perAssetSampleLimit: sampleLimit,
    perAssetTruncated: blockedItems.length > sampleLimit,
    perAssetBlockedReasons,
    rootCauseCandidates: inferRootCauseCandidates(sortedBlockingReasonCounts),
  };
}
