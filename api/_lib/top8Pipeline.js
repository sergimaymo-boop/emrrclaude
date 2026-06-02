import {
  evaluateCandidate,
  buildEligibilityDiagnostics,
  buildOperationalTop8FromEvaluations,
  summarizeEvaluations,
} from "./candidateEvaluationEngine.js";
import { fetchEodhdHistoricalBars } from "./historicalDataProvider.js";
import { fetchEodhdSpread } from "./spreadDataProvider.js";
import { buildTop8BatchPlan } from "./top8BatchPlanner.js";

const DEFAULT_MAX_CANDIDATES_PER_RUN = 100;
const BENCHMARK_SYMBOL = "SPY.US";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseMaxCandidates(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_CANDIDATES_PER_RUN;
  return Math.min(parsed, DEFAULT_MAX_CANDIDATES_PER_RUN);
}

export function getTop8CostGate(assets, options = {}) {
  const maxCandidates = parseMaxCandidates(options.maxCandidatesPerRun);
  const operableCandidates = safeArray(assets).filter((asset) => asset.operabilityStatus === "OPERABLE");

  if (operableCandidates.length > maxCandidates) {
    return {
      ok: false,
      blockedReason: "COST_GATE_REQUIRES_BATCHING_STRATEGY",
      maxCandidatesPerRun: maxCandidates,
      operableCandidates: operableCandidates.length,
      message:
        "Automatic universe has more operable candidates than the current manual cost gate allows. TOP 8 is not calculated to avoid massive provider calls.",
    };
  }

  return {
    ok: true,
    blockedReason: null,
    maxCandidatesPerRun: maxCandidates,
    operableCandidates: operableCandidates.length,
  };
}

export async function runControlledTop8Pipeline({
  assets,
  maxCandidatesPerRun,
  marketStatus = "UNKNOWN",
  dataQuality = "GOOD",
  fetchHistoricalBars = fetchEodhdHistoricalBars,
  fetchSpread = fetchEodhdSpread,
} = {}) {
  const costGate = getTop8CostGate(assets, { maxCandidatesPerRun });
  const candidates = safeArray(assets).filter((asset) => asset.operabilityStatus === "OPERABLE");

  if (!costGate.ok) {
    return {
      ok: false,
      error: costGate.blockedReason,
      costGate,
      batchPlan: buildTop8BatchPlan(assets, { batchSize: costGate.maxCandidatesPerRun }),
      evaluations: [],
      eligibilityDiagnostics: {
        eligibilityDiagnosticsAvailable: false,
        diagnosticMode: "COST_GATE_BLOCKED",
        requiresRealExecutionForPerAssetReasons: true,
        knownBlockingCategories: [],
        message: "Cost gate blocked the pipeline before per-asset historical and spread validation.",
      },
      assets: [],
      summary: {
        analyzed: 0,
        eligibleForScore: 0,
        blocked: 0,
        operable: candidates.length,
        notOperable: safeArray(assets).filter((asset) => asset.operabilityStatus === "NOT_OPERABLE").length,
        unknown: safeArray(assets).filter((asset) => asset.operabilityStatus === "UNKNOWN").length,
      },
      providerCallsPlanned: 0,
    };
  }

  const benchmarkHistory = await fetchHistoricalBars(BENCHMARK_SYMBOL);
  const benchmarkBars = benchmarkHistory.ok ? benchmarkHistory.bars : [];
  const evaluations = [];

  for (const asset of candidates) {
    const [historyResult, spreadResult] = await Promise.all([
      fetchHistoricalBars(asset.providerSymbol),
      fetchSpread(asset.providerSymbol),
    ]);

    evaluations.push(
      evaluateCandidate({
        asset,
        historicalBars: historyResult.ok ? historyResult.bars : [],
        benchmarkBars,
        spreadPercent: spreadResult.ok ? spreadResult.spreadPercent : null,
        historyStatus: {
          ok: historyResult.ok === true,
          provider: historyResult.provider ?? null,
          providerSymbol: historyResult.providerSymbol ?? asset.providerSymbol,
          blockedReason: historyResult.ok ? null : historyResult.blockedReason ?? "HISTORY_PROVIDER_FAILED",
          barCount: Array.isArray(historyResult.bars) ? historyResult.bars.length : 0,
        },
        spreadStatus: {
          ok: spreadResult.ok === true,
          provider: spreadResult.provider ?? null,
          providerSymbol: spreadResult.providerSymbol ?? asset.providerSymbol,
          blockedReason: spreadResult.ok ? null : spreadResult.blockedReason ?? "SPREAD_PROVIDER_FAILED",
          spreadPercent: spreadResult.spreadPercent ?? null,
        },
        marketStatus,
        dataQuality,
      }),
    );
  }

  const top8 = buildOperationalTop8FromEvaluations(evaluations);

  return {
    ok: top8.length > 0,
    error: top8.length > 0 ? null : "NO_ELIGIBLE_ASSETS_AFTER_VALIDATION",
    costGate,
    batchPlan: null,
    evaluations,
    eligibilityDiagnostics: buildEligibilityDiagnostics(evaluations, { batchSize: candidates.length }),
    assets: top8,
    summary: summarizeEvaluations(evaluations),
    providerCallsPlanned: candidates.length * 2 + 1,
  };
}
