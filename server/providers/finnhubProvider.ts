import { blockRealApiCall } from "../guards/apiCostGuard";
import { resolveProviderState } from "./mockProvider";
import type { ProviderAdapter } from "./types";

export const finnhubProvider: ProviderAdapter = {
  name: "Finnhub",
  role: "fallback",
  getStatus(config) {
    return {
      provider: "Finnhub",
      state: resolveProviderState(config.finnhubApiKey),
      role: "fallback",
      realCallsEnabled: false,
    };
  },
  blockQuoteRequest(symbol) {
    return blockRealApiCall("Finnhub", `quote:${symbol}`);
  },
};
