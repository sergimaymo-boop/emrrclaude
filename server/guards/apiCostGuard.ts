import type { ApiBlockedCall, ApiProviderName } from "../../shared/types";

type RuntimeEnv = Record<string, string | undefined>;

const PHASE_3_REAL_API_CALLS_ENABLED = false;

export interface ApiCostGuardState {
  realApiCallsEnabled: false;
  requestedRealApiCalls: boolean;
  apiCalls: 0;
  blockedCalls: number;
  mode: "MOCK_ONLY";
  reason: string;
}

export function getRuntimeEnv(): RuntimeEnv {
  const runtime = globalThis as unknown as {
    process?: { env?: RuntimeEnv };
  };

  return runtime.process?.env ?? {};
}

export function resolveApiCostGuard(env: RuntimeEnv = getRuntimeEnv()): ApiCostGuardState {
  const requestedRealApiCalls = env.ENABLE_REAL_API_CALLS === "true";

  return {
    realApiCallsEnabled: PHASE_3_REAL_API_CALLS_ENABLED,
    requestedRealApiCalls,
    apiCalls: 0,
    blockedCalls: 0,
    mode: "MOCK_ONLY",
    reason: requestedRealApiCalls
      ? "Real API calls are blocked in Phase 3 even if ENABLE_REAL_API_CALLS is set."
      : "Phase 3 is mock-only and does not call external financial APIs.",
  };
}

export function blockRealApiCall(provider: ApiProviderName, operation: string): ApiBlockedCall {
  return {
    ok: false,
    blocked: true,
    provider,
    operation,
    reason: "External financial API calls are disabled in Phase 3.",
  };
}
