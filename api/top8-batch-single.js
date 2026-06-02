import { buildTop8BatchPlan, getTop8Batch } from "./_lib/top8BatchPlanner.js";
import { addTop8CostPolicyMetadata } from "./_lib/top8CostPolicy.js";
import { runControlledTop8Pipeline } from "./_lib/top8Pipeline.js";
import { TOP8_BATCH_EXECUTION_MODE, buildPartialBatchResultMetadata } from "./_lib/top8ResultMetadata.js";
import { getSpreadContinuationPolicy } from "./_lib/spreadPolicy.js";
import { buildUniverseResponse } from "./universe.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const PHASE = "11.1";
const UNIVERSE_MODE = "DYNAMIC_UNIVERSE";
const MAX_OUTPUT_ASSETS = 8;
const EXECUTION_CONFIRMATION = "EXECUTE_BATCH";
const AUTHORIZED_BATCH_NUMBER = 1;
const PHASE_11_4_LAST_REAL_RUN_SUMMARY = Object.freeze({
  source: "PHASE_11_4_MANUAL_DIAGNOSTIC_AUDIT",
  endpoint: "/api/top8-batch-single",
  batchNumber: 1,
  httpStatus: 409,
  ok: false,
  error: "NO_ELIGIBLE_ASSETS_AFTER_VALIDATION",
  providerCallsPlanned: 51,
  actualProviderCalls: 51,
  estimatedProviderCalls: 51,
  selectedAssets: 25,
  assetsReturned: 0,
  evaluationSummary: {
    analyzed: 25,
    eligibleForScore: 0,
    blocked: 25,
  },
  primaryBlockingReason: "SPREAD_NOT_VERIFIED",
  providerBlockingReason: "SPREAD_NOT_AVAILABLE",
  resultScope: "PARTIAL_BATCH_ONLY",
  isPartialResult: true,
  isGlobalTop8Final: false,
  fullUniverseExecutionAllowed: false,
});
const KNOWN_ELIGIBILITY_BLOCKING_CATEGORIES = Object.freeze([
  "INSUFFICIENT_HISTORY",
  "PROVIDER_HISTORY_NO_VALID_BARS",
  "PROVIDER_HISTORY_REQUEST_FAILED",
  "SPREAD_NOT_VERIFIED",
  "SPREAD_NOT_AVAILABLE",
  "SPREAD_DIAGNOSTIC_ONLY",
  "SPREAD_BLOCKS_EXEC",
  "EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK",
  "ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM",
  "INVALID_ATR_PERCENT",
  "DATA_QUALITY_NOT_GOOD",
  "MARKET_NOT_OPEN",
]);

function sendJson(response, statusCode, payload) {
  if (response && typeof response.status === "function") {
    return response.status(statusCode).json(payload);
  }

  if (response && typeof response.writeHead === "function") {
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
    return undefined;
  }

  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getSingleQueryValue(value) {
  if (Array.isArray(value)) return null;
  return typeof value === "string" ? value.trim() : null;
}

function parseBatchNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasOnlyAllowedQuery(query) {
  const keys = Object.keys(query ?? {});
  return keys.every((key) => ["batch", "execute", "confirm"].includes(key));
}

function summarizeSelectedBatch(batch) {
  return {
    batchNumber: batch.batchNumber,
    batchSize: batch.batchSize,
    selectedAssets: batch.assets.length,
    totalOperableCandidates: batch.totalOperableCandidates,
    totalBatches: batch.totalBatches,
    estimatedProviderCalls: batch.assets.length * 2 + 1,
  };
}

function buildSingleInvocationMetadata() {
  return {
    singleInvocation: true,
    globalAggregationAvailable: false,
    finalizationAvailable: false,
    requiresPersistenceForGlobalFinal: true,
  };
}

function buildDryRunEligibilityDiagnosticMetadata() {
  return {
    eligibilityDiagnosticsAvailable: false,
    diagnosticMode: "DRY_RUN_COST_METADATA_ONLY",
    spreadContinuationDecision: getSpreadContinuationPolicy(),
    requiresRealExecutionForPerAssetReasons: true,
    knownBlockingCategories: [...KNOWN_ELIGIBILITY_BLOCKING_CATEGORIES],
    lastRealRunSummary: PHASE_11_4_LAST_REAL_RUN_SUMMARY,
    diagnosticNote:
      "Dry-run does not call history or spread providers, so exact per-asset blocking reasons are unavailable until a manual execution response includes eligibilityDiagnostics.",
  };
}

function buildSingleInvocationResponse(payload, costOptions = {}) {
  const response = addTop8CostPolicyMetadata(payload, costOptions);
  const recommendedNextAction = costOptions.dryRun && !costOptions.executionRequested
    ? "Review single-invocation dry-run metadata only. Do not execute real providers without explicit Phase 11.1 authorization."
    : "Single-invocation execution requires explicit Phase 11.1 authorization and confirm=EXECUTE_BATCH; it remains partial and not global TOP 8.";
  const costPolicy = {
    ...response.costPolicy,
    manualApprovalTokenRequired: "confirm=EXECUTE_BATCH",
    recommendedNextAction,
    warnings: [
      "Phase 11.1 single-invocation mode does not authorize full-universe execution.",
      "Dry-run metadata is safe; execute=true still requires confirm=EXECUTE_BATCH.",
      "No automatic scanner or persistent storage is active.",
      "Single-invocation mode avoids cross-function state handoff and does not create global finalization.",
    ],
  };

  return {
    ...response,
    costPolicy,
    recommendedNextAction,
    ...buildSingleInvocationMetadata(),
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    return sendJson(response, 405, {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Only GET is allowed for controlled single-invocation TOP 8 batch validation.",
    });
  }

  const query = request.query ?? {};
  if (!hasOnlyAllowedQuery(query)) {
    return sendJson(response, 400, {
      ok: false,
      error: "QUERY_NOT_ALLOWED",
      message: "Only numeric batch, optional execute=true and optional confirm=EXECUTE_BATCH are allowed. Stateful run queries, tickers, lists and custom exchanges are blocked.",
    });
  }

  const batchNumber = parseBatchNumber(getSingleQueryValue(query.batch));
  const execute = getSingleQueryValue(query.execute) === "true";
  const confirm = getSingleQueryValue(query.confirm);
  const timestampUtc = new Date().toISOString();

  if (batchNumber === null) {
    return sendJson(response, 400, buildSingleInvocationResponse({
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: "CONTROLLED_REAL_DATA",
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      dryRun: !execute,
      providerCallsPlanned: 0,
      manualExecutionRequired: true,
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: execute ? TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION : TOP8_BATCH_EXECUTION_MODE.DRY_RUN,
      }),
      error: "BATCH_REQUIRED",
      blockedReasons: ["BATCH_REQUIRED"],
      assets: [],
      message: "Provide batch=1 for Phase 11.1 single-invocation validation.",
    }, {
      dryRun: !execute,
      executionRequested: execute,
      providerCallsPlanned: 0,
      blockedReasons: ["BATCH_REQUIRED"],
    }));
  }

  if (batchNumber !== AUTHORIZED_BATCH_NUMBER) {
    return sendJson(response, 400, buildSingleInvocationResponse({
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: "CONTROLLED_REAL_DATA",
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      dryRun: !execute,
      providerCallsPlanned: 0,
      manualExecutionRequired: true,
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: execute ? TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION : TOP8_BATCH_EXECUTION_MODE.DRY_RUN,
      }),
      error: "BATCH_NOT_AUTHORIZED_PHASE_11_1",
      blockedReasons: ["BATCH_NOT_AUTHORIZED_PHASE_11_1"],
      assets: [],
      message: "Phase 11.1 allows only batch=1. No batch 2, full-run or retry flow is authorized.",
    }, {
      dryRun: !execute,
      executionRequested: execute,
      providerCallsPlanned: 0,
      blockedReasons: ["BATCH_NOT_AUTHORIZED_PHASE_11_1"],
    }));
  }

  if (execute && confirm !== EXECUTION_CONFIRMATION) {
    return sendJson(response, 400, buildSingleInvocationResponse({
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: "CONTROLLED_REAL_DATA",
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      dryRun: false,
      providerCallsPlanned: 0,
      manualExecutionRequired: true,
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION,
      }),
      error: "EXECUTION_CONFIRMATION_REQUIRED",
      blockedReasons: ["EXECUTION_CONFIRMATION_REQUIRED"],
      assets: [],
      message: "Single-invocation execution requires confirm=EXECUTE_BATCH to prevent accidental real provider calls.",
    }, {
      dryRun: false,
      executionRequested: true,
      providerCallsPlanned: 0,
      blockedReasons: ["EXECUTION_CONFIRMATION_REQUIRED"],
    }));
  }

  const universe = await buildUniverseResponse({ includeFullAssets: true });

  if (!universe.ok) {
    return sendJson(response, 409, buildSingleInvocationResponse({
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: universe.mode,
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      error: "UNIVERSE_DISCOVERY_NOT_READY",
      universeSummary: universe.summary,
      providerCallsPlanned: 0,
      manualExecutionRequired: true,
      blockedReasons: [universe.error ?? "UNIVERSE_DISCOVERY_FAILED"],
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: execute ? TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION : TOP8_BATCH_EXECUTION_MODE.DRY_RUN,
      }),
      assets: [],
      message: "Single-invocation batch cannot run until automatic universe discovery returns candidates.",
    }, {
      dryRun: !execute,
      executionRequested: execute,
      providerCallsPlanned: 0,
      blockedReasons: [universe.error ?? "UNIVERSE_DISCOVERY_FAILED"],
    }));
  }

  const batchPlan = buildTop8BatchPlan(universe.assets);
  const selectedBatch = getTop8Batch(universe.assets, batchNumber);
  const selectedBatchSummary = summarizeSelectedBatch(selectedBatch);

  if (selectedBatch.assets.length === 0) {
    return sendJson(response, 404, buildSingleInvocationResponse({
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: "CONTROLLED_REAL_DATA",
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      error: "BATCH_NOT_FOUND",
      batchNumber,
      batchPlan: {
        strategy: batchPlan.strategy,
        totalOperableCandidates: batchPlan.totalOperableCandidates,
        totalBatches: batchPlan.totalBatches,
        batchSize: batchPlan.batchSize,
      },
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: execute ? TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION : TOP8_BATCH_EXECUTION_MODE.DRY_RUN,
        selectedBatch: {
          totalBatches: batchPlan.totalBatches,
        },
      }),
      assets: [],
    }, {
      batchPlan,
      dryRun: true,
      providerCallsPlanned: 0,
      blockedReasons: ["BATCH_NOT_FOUND"],
    }));
  }

  if (!execute) {
    return sendJson(response, 200, buildSingleInvocationResponse({
      ok: true,
      app: APP_NAME,
      phase: PHASE,
      mode: "CONTROLLED_REAL_DATA",
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      dryRun: true,
      executeRequired: "execute=true",
      confirmationRequiredForExecution: `confirm=${EXECUTION_CONFIRMATION}`,
      providerCallsPlanned: 0,
      manualExecutionRequired: true,
      universeSummary: universe.summary,
      batchPlan: {
        strategy: batchPlan.strategy,
        totalOperableCandidates: batchPlan.totalOperableCandidates,
        totalBatches: batchPlan.totalBatches,
        batchSize: batchPlan.batchSize,
        estimatedProviderCallsPerFullBatch: batchPlan.estimatedProviderCallsPerFullBatch,
      },
      selectedBatch: selectedBatchSummary,
      ...buildDryRunEligibilityDiagnosticMetadata(),
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: TOP8_BATCH_EXECUTION_MODE.DRY_RUN,
        selectedBatch: selectedBatchSummary,
      }),
      warnings: [
        "Dry run only. No historical or spread provider calls were executed.",
        "Single-invocation mode avoids Vercel runtime memory handoff and does not create a global TOP 8.",
        "Use execute=true with confirm=EXECUTE_BATCH only after explicit authorization.",
      ],
      assets: [],
    }, {
      batchPlan,
      selectedBatch: selectedBatchSummary,
      dryRun: true,
      providerCallsPlanned: 0,
    }));
  }

  const pipeline = await runControlledTop8Pipeline({
    assets: selectedBatch.assets,
    maxCandidatesPerRun: selectedBatch.batchSize,
    marketStatus: "UNKNOWN",
    dataQuality: "GOOD",
  });

  if (!pipeline.ok) {
    return sendJson(response, 409, buildSingleInvocationResponse({
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: "CONTROLLED_REAL_DATA",
      universeMode: UNIVERSE_MODE,
      timestampUtc,
      dryRun: false,
      manualExecutionRequired: true,
      error: pipeline.error,
      universeSummary: universe.summary,
      selectedBatch: selectedBatchSummary,
      evaluationSummary: pipeline.summary,
      eligibilityDiagnostics: pipeline.eligibilityDiagnostics,
      providerCallsPlanned: pipeline.providerCallsPlanned,
      maxOutputAssets: MAX_OUTPUT_ASSETS,
      ...buildPartialBatchResultMetadata({
        batchExecutionMode: TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION,
        selectedBatch: selectedBatchSummary,
        actualProviderCalls: pipeline.providerCallsPlanned,
      }),
      blockedReasons: [pipeline.error],
      warnings: [
        "Single-invocation batch execution is partial and does not represent global TOP 8.",
        "No EXEC is generated by Phase 11.1.",
        "No run state, persistence or finalization is created by this endpoint.",
      ],
      assets: [],
    }, {
      batchPlan,
      selectedBatch: selectedBatchSummary,
      dryRun: false,
      executionRequested: true,
      providerCallsPlanned: pipeline.providerCallsPlanned,
      blockedReasons: [pipeline.error],
    }));
  }

  return sendJson(response, 200, buildSingleInvocationResponse({
    ok: true,
    app: APP_NAME,
    phase: PHASE,
    mode: "CONTROLLED_REAL_DATA",
    universeMode: UNIVERSE_MODE,
    timestampUtc,
    dryRun: false,
    manualExecutionRequired: true,
    universeSummary: universe.summary,
    selectedBatch: selectedBatchSummary,
    evaluationSummary: pipeline.summary,
    eligibilityDiagnostics: pipeline.eligibilityDiagnostics,
    providerCallsPlanned: pipeline.providerCallsPlanned,
    maxOutputAssets: MAX_OUTPUT_ASSETS,
    ...buildPartialBatchResultMetadata({
      batchExecutionMode: TOP8_BATCH_EXECUTION_MODE.MANUAL_EXECUTION,
      selectedBatch: selectedBatchSummary,
      actualProviderCalls: pipeline.providerCallsPlanned,
    }),
    warnings: [
      "Single-invocation batch result is partial and does not represent global TOP 8.",
      "No run state, persistence or finalization is created by this endpoint.",
    ],
    assets: pipeline.assets,
  }, {
    batchPlan,
    selectedBatch: selectedBatchSummary,
    dryRun: false,
    executionRequested: true,
    providerCallsPlanned: pipeline.providerCallsPlanned,
  }));
}
