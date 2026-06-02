export const TOP8_COST_POLICY_VERSION = "PHASE_8_COST_POLICY_V1";

export const TOP8_COST_POLICY_STATUS = Object.freeze({
  SAFE_DRY_RUN: "SAFE_DRY_RUN",
  MANUAL_APPROVAL_REQUIRED: "MANUAL_APPROVAL_REQUIRED",
  COST_TOO_HIGH: "COST_TOO_HIGH",
  NOT_OPERATIONAL_FULL_RUN: "NOT_OPERATIONAL_FULL_RUN",
});

export const TOP8_COST_POLICY_LIMITS = Object.freeze({
  manualBatchLimitPerSession: 1,
  fullUniverseExecutionAllowed: false,
  excessiveFullRunProviderCalls: 5000,
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getBatchPlanSummary(batchPlan) {
  if (!batchPlan) return null;

  return {
    strategy: batchPlan.strategy ?? "UNKNOWN",
    batchSize: toFiniteNumber(batchPlan.batchSize),
    totalOperableCandidates: toFiniteNumber(batchPlan.totalOperableCandidates),
    totalBatches: toFiniteNumber(batchPlan.totalBatches),
    estimatedProviderCallsPerFullBatch: toFiniteNumber(batchPlan.estimatedProviderCallsPerFullBatch),
    estimatedProviderCallsForAllBatches: toFiniteNumber(batchPlan.estimatedProviderCallsForAllBatches),
  };
}

export function classifyTop8FullRunCost(batchPlan) {
  const summary = getBatchPlanSummary(batchPlan);
  if (!summary) return TOP8_COST_POLICY_STATUS.NOT_OPERATIONAL_FULL_RUN;

  if (summary.estimatedProviderCallsForAllBatches > TOP8_COST_POLICY_LIMITS.excessiveFullRunProviderCalls) {
    return TOP8_COST_POLICY_STATUS.COST_TOO_HIGH;
  }

  if (summary.totalBatches > TOP8_COST_POLICY_LIMITS.manualBatchLimitPerSession) {
    return TOP8_COST_POLICY_STATUS.NOT_OPERATIONAL_FULL_RUN;
  }

  return TOP8_COST_POLICY_STATUS.MANUAL_APPROVAL_REQUIRED;
}

function classifyImmediateStatus({ dryRun, executionRequested, fullUniverseRequested, batchPlan }) {
  if (dryRun && !executionRequested) return TOP8_COST_POLICY_STATUS.SAFE_DRY_RUN;
  if (fullUniverseRequested && batchPlan) return classifyTop8FullRunCost(batchPlan);
  if (fullUniverseRequested) return TOP8_COST_POLICY_STATUS.MANUAL_APPROVAL_REQUIRED;
  return TOP8_COST_POLICY_STATUS.MANUAL_APPROVAL_REQUIRED;
}

function recommendedNextActionForStatus(status) {
  if (status === TOP8_COST_POLICY_STATUS.SAFE_DRY_RUN) {
    return "Review cost metadata only. Do not execute real batches without explicit manual approval.";
  }

  if (status === TOP8_COST_POLICY_STATUS.MANUAL_APPROVAL_REQUIRED) {
    return "If explicitly approved, execute only one manual batch with runId and confirm=EXECUTE_BATCH.";
  }

  if (status === TOP8_COST_POLICY_STATUS.COST_TOO_HIGH) {
    return "Do not run the full universe. Use dry-run metadata and approve at most one controlled batch per manual session.";
  }

  return "Full universe execution is not operational. Use manual dry-run batches only.";
}

export function buildTop8CostPolicy({
  batchPlan = null,
  selectedBatch = null,
  providerCallsPlanned = 0,
  dryRun = true,
  executionRequested = false,
  fullUniverseRequested = false,
  blockedReasons = [],
} = {}) {
  const batchPlanSummary = getBatchPlanSummary(batchPlan);
  const selectedBatchEstimate = toFiniteNumber(selectedBatch?.estimatedProviderCalls);
  const plannedCalls = toFiniteNumber(providerCallsPlanned);
  const estimatedProviderCalls = dryRun ? selectedBatchEstimate : plannedCalls;
  const estimatedFullRunProviderCalls = batchPlanSummary?.estimatedProviderCallsForAllBatches ?? estimatedProviderCalls;
  const status = classifyImmediateStatus({
    dryRun,
    executionRequested,
    fullUniverseRequested,
    batchPlan,
  });
  const fullRunStatus = classifyTop8FullRunCost(batchPlan);
  const recommendedNextAction = recommendedNextActionForStatus(status);

  return {
    version: TOP8_COST_POLICY_VERSION,
    status,
    fullRunStatus,
    fullUniverseExecutionAllowed: TOP8_COST_POLICY_LIMITS.fullUniverseExecutionAllowed,
    manualApprovalRequired: true,
    manualApprovalTokenRequired: "confirm=EXECUTE_BATCH",
    recommendedManualBatchLimitPerSession: TOP8_COST_POLICY_LIMITS.manualBatchLimitPerSession,
    estimatedProviderCalls,
    estimatedFullRunProviderCalls,
    estimatedProviderCallsPerFullBatch: batchPlanSummary?.estimatedProviderCallsPerFullBatch ?? selectedBatchEstimate,
    selectedBatchNumber: selectedBatch?.batchNumber ?? null,
    selectedBatchAssets: selectedBatch?.selectedAssets ?? null,
    totalBatches: batchPlanSummary?.totalBatches ?? selectedBatch?.totalBatches ?? null,
    totalOperableCandidates: batchPlanSummary?.totalOperableCandidates ?? selectedBatch?.totalOperableCandidates ?? null,
    blockedReasons,
    recommendedNextAction,
    warnings: [
      "Phase 8 cost policy is planning-only and does not authorize full-universe execution.",
      "Dry-run metadata is safe; execute=true still requires runId and confirm=EXECUTE_BATCH.",
      "No automatic scanner, polling, cron, worker or persistent storage is active.",
    ],
  };
}

export function addTop8CostPolicyMetadata(payload, options = {}) {
  const costPolicy = buildTop8CostPolicy(options);

  return {
    ...payload,
    costPolicy,
    estimatedProviderCalls: costPolicy.estimatedProviderCalls,
    estimatedFullRunProviderCalls: costPolicy.estimatedFullRunProviderCalls,
    manualApprovalRequired: costPolicy.manualApprovalRequired,
    recommendedNextAction: costPolicy.recommendedNextAction,
    fullUniverseExecutionAllowed: costPolicy.fullUniverseExecutionAllowed,
  };
}
