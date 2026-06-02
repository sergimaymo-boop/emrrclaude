import type { ApiHealthResponse, ApiProvidersStatusResponse } from "../../shared/types";
import { getRuntimeEnv, resolveApiCostGuard } from "../guards/apiCostGuard";
import { eodhdProvider } from "./eodhdProvider";
import { finnhubProvider } from "./finnhubProvider";
import type { ProviderRuntimeConfig } from "./types";

export function getProviderRuntimeConfig(env = getRuntimeEnv()): ProviderRuntimeConfig {
  return {
    eodhdApiKey: env.EODHD_API_KEY,
    finnhubApiKey: env.FINNHUB_API_KEY,
  };
}

export function createApiHealthResponse(environment: string): ApiHealthResponse {
  const config = getProviderRuntimeConfig();
  const eodhdStatus = eodhdProvider.getStatus(config);
  const finnhubStatus = finnhubProvider.getStatus(config);

  return {
    ok: true,
    app: "EMRR 2.0 / Tendencias",
    phase: "3",
    environment,
    timestampUtc: new Date().toISOString(),
    realApiCallsEnabled: false,
    providers: {
      eodhd: eodhdStatus.state,
      finnhub: finnhubStatus.state,
    },
  };
}

export function createProvidersStatusResponse(): ApiProvidersStatusResponse {
  const guard = resolveApiCostGuard();

  return {
    primaryProvider: "EODHD",
    secondaryProviderConfiguredOnly: "Finnhub",
    providerSubstitutionAllowed: false,
    realApiCallsEnabled: false,
    apiCalls: 0,
    blockedCalls: guard.blockedCalls,
    mode: "REAL_API_DISABLED",
    message:
      "EODHD is the primary provider and Finnhub is the configured secondary provider. Real API calls are disabled by the cost guard.",
  };
}
