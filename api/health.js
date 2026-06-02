import { TOP8_COST_POLICY_LIMITS, TOP8_COST_POLICY_VERSION } from "./_lib/top8CostPolicy.js";

const PLACEHOLDER_PARTS = ["your_", "_here", "placeholder"];
const CACHE_TTL_SECONDS = 60;

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
    ok: true,
    app: "EMRR 2.0 / Tendencias",
    phase: "6",
    environment: env.VITE_APP_ENV ?? env.NODE_ENV ?? "production",
    timestampUtc: new Date().toISOString(),
    realApiCallsEnabled,
    cache: {
      strategy: "EPHEMERAL_MEMORY",
      ttlSeconds: CACHE_TTL_SECONDS,
      persistence: "VERCEL_RUNTIME_ONLY",
    },
    providers: {
      eodhd: isConfiguredSecret(env.EODHD_API_KEY) ? "configured" : "not_configured",
      finnhub: isConfiguredSecret(env.FINNHUB_API_KEY) ? "configured" : "not_configured",
    },
    phase6Readiness: {
      universeEngineSpec: "registered",
      operabilityEngineSpec: "registered",
      scoreEngineSpec: "registered",
      automaticUniverseEngine: "metadata_discovery_active",
      operabilityEngine: "metadata_rule_classification_active",
      historicalDataProvider: "controlled_internal_active",
      spreadDataProvider: "controlled_internal_active",
      technicalEngine: "pure_engine_active",
      eligibilityEngine: "pure_engine_active",
      scoreEngine: "pure_engine_active",
      candidateEvaluationEngine: "pure_engine_active",
      top8Endpoint: "cost_gate_active",
      top8BatchEndpoint: "manual_dry_run_active",
      top8BatchSingleEndpoint: "single_invocation_dry_run_active",
      scanSnapshotEndpoint: "continuable_batching_active",
      top8RunEndpoint: "retired_from_production",
      top8FinalEndpoint: "retired_from_production",
    },
    phase8Readiness: {
      costPolicy: TOP8_COST_POLICY_VERSION,
      fullUniverseExecutionAllowed: TOP8_COST_POLICY_LIMITS.fullUniverseExecutionAllowed,
      manualBatchLimitPerSession: TOP8_COST_POLICY_LIMITS.manualBatchLimitPerSession,
      safeEndpointsExposeCostMetadata: true,
    },
    message:
      "EMRR production exposes metadata universe discovery, cost-gated /api/top8, diagnostic /api/top8-batch-single and continuable /api/scan-snapshot execution. Retired legacy top8-run/top8-batch/top8-final routes are not deployed on Vercel Hobby.",
  });
}
