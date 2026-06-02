export const TOP8_RESULT_SCOPE = Object.freeze({
  PARTIAL_BATCH_ONLY: "PARTIAL_BATCH_ONLY",
  GLOBAL_TOP8_FINAL: "GLOBAL_TOP8_FINAL",
});

export const TOP8_BATCH_EXECUTION_MODE = Object.freeze({
  DRY_RUN: "DRY_RUN",
  MANUAL_EXECUTION: "MANUAL_EXECUTION",
});

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getRunFromUpdate(runUpdate) {
  return runUpdate?.run ?? null;
}

export function buildPartialBatchResultMetadata({
  batchExecutionMode = TOP8_BATCH_EXECUTION_MODE.DRY_RUN,
  selectedBatch = null,
  runUpdate = null,
  actualProviderCalls = null,
} = {}) {
  const run = getRunFromUpdate(runUpdate);

  return {
    batchExecutionMode,
    resultScope: TOP8_RESULT_SCOPE.PARTIAL_BATCH_ONLY,
    isPartialResult: true,
    isGlobalTop8Final: false,
    executedBatchCount: run?.completedBatchCount ?? 0,
    remainingBatchCount: run?.remainingBatchCount ?? selectedBatch?.totalBatches ?? null,
    actualProviderCalls: toNumberOrNull(actualProviderCalls),
  };
}

export function buildFinalTop8ResultMetadata(run) {
  return {
    resultScope: TOP8_RESULT_SCOPE.GLOBAL_TOP8_FINAL,
    isPartialResult: false,
    isGlobalTop8Final: true,
    executedBatchCount: run?.completedBatchCount ?? null,
    remainingBatchCount: run?.remainingBatchCount ?? 0,
    actualProviderCalls: 0,
  };
}
