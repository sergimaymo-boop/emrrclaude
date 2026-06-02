import type { ApiBlockedCall, ApiProviderName, ApiProviderPublicState } from "../../shared/types";

export interface ProviderRuntimeConfig {
  eodhdApiKey?: string;
  finnhubApiKey?: string;
}

export interface ProviderPublicStatus {
  provider: ApiProviderName;
  state: ApiProviderPublicState;
  role: "primary" | "fallback";
  realCallsEnabled: false;
}

export interface ProviderAdapter {
  name: ApiProviderName;
  role: "primary" | "fallback";
  getStatus(config: ProviderRuntimeConfig): ProviderPublicStatus;
  blockQuoteRequest(symbol: string): ApiBlockedCall;
}
