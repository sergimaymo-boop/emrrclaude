import { TOP8_COST_POLICY_LIMITS, TOP8_COST_POLICY_VERSION } from "./_lib/top8CostPolicy.js";

const PLACEHOLDER_PARTS = ["your_", "_here", "placeholder"];
const CACHE_TTL_SECONDS = 60;
const INCLUDED_MARKETS = {
  usa: ["Nasdaq", "NYSE"],
  europe: ["Xetra", "Euronext", "Borsa Italiana", "SIX", "LSE"],
};

function getEnv() {
  return globalThis.process?.env ?? {};
}

function isConfiguredSecret(value) {
  if (!value || !value.trim()) return false;
  const normalized = value.trim().toLowerCase();
  return !PLACEHOLDER_PARTS.some((part) => normalized.includes(part));
}

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

export default function handler(_request, response) {
  const env = getEnv();
  const realApiCallsEnabled = env.ENABLE_REAL_API_CALLS === "true";

  return sendJson(response, 200, {
    primaryProvider: "EODHD",
    secondaryProviderConfiguredOnly: "Finnhub",
    providerSubstitutionAllowed: false,
    phase: "6",
    realApiCallsEnabled,
    apiCalls: 0,
    blockedCalls: 0,
    mode: realApiCallsEnabled ? "CONTROLLED_REAL_DATA" : "REAL_API_DISABLED",
    universeMode: "DYNAMIC_UNIVERSE_REQUIRED",
    includedMarkets: INCLUDED_MARKETS,
    universeEndpoint: "metadata_discovery_active",
    historicalDataProvider: "controlled_internal_active",
    spreadDataProvider: "controlled_internal_active",
    technicalEngine: "pure_engine_active",
    eligibilityEngine: "pure_engine_active",
    scoreEngine: "pure_engine_active",
    candidateEvaluationEngine: "pure_engine_active",
    top8Endpoint: "cost_gate_active",
    scanSnapshotEndpoint: "continuable_batching_active",
    top8BatchEndpoint: "manual_dry_run_active",
    top8BatchSingleEndpoint: "single_invocation_dry_run_active",
    top8RunEndpoint: "retired_from_production",
    top8FinalEndpoint: "retired_from_production",
    providers: {
      eodhd: isConfiguredSecret(env.EODHD_API_KEY) ? "configured" : "not_configured",
      finnhub: isConfiguredSecret(env.FINNHUB_API_KEY) ? "configured" : "not_configured",
    },
    costControls: {
      quoteMaxSymbolsPerRequest: 1,
      masterIndicatorsMaxSymbols: 7,
      universeExchangeListMaxRequests: 9,
      historicalProviderCallsPerCandidate: 1,
      spreadProviderCallsPerCandidate: 1,
      top8MaxCandidatesPerRun: 100,
      scanSnapshotBatchSizeRange: "50-100",
      scanSnapshotGlobalFinalRequiresCoveragePercent: 100,
      top8MaxOutputAssets: 8,
      top8CostPolicy: TOP8_COST_POLICY_VERSION,
      fullUniverseExecutionAllowed: TOP8_COST_POLICY_LIMITS.fullUniverseExecutionAllowed,
      recommendedManualBatchLimitPerSession: TOP8_COST_POLICY_LIMITS.manualBatchLimitPerSession,
      polling: false,
      autoRefresh: false,
      backgroundJobs: false,
      aggressiveRetries: false,
      cacheStrategy: "EPHEMERAL_MEMORY",
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    },
    message:
      "Provider status supports metadata-only /api/universe discovery, cost-gated /api/top8, /api/top8-batch-single dry-run diagnostics and continuable /api/scan-snapshot execution. Legacy top8-run/top8-batch/top8-final routes are retired from production to stay within Vercel Hobby limits.",
  });
}
