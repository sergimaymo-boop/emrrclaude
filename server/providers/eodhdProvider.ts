import { blockRealApiCall } from "../guards/apiCostGuard";
import { resolveProviderState } from "./mockProvider";
import type { ProviderAdapter } from "./types";

export const eodhdProvider: ProviderAdapter = {
  name: "EODHD",
  role: "primary",
  getStatus(config) {
    return {
      provider: "EODHD",
      state: resolveProviderState(config.eodhdApiKey),
      role: "primary",
      realCallsEnabled: false,
    };
  },
  blockQuoteRequest(symbol) {
    return blockRealApiCall("EODHD", `quote:${symbol}`);
  },
};
