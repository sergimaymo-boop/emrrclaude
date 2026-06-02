import type { SystemStatus, Top8Asset } from "../types";
import { getRegionalMarketStates, isMarketOpen } from "./marketHours";
import { createTimestampPair } from "./time";

export function refreshSystemMarketStatus(systemStatus: SystemStatus): SystemStatus {
  const timestamp = createTimestampPair();
  const regions = getRegionalMarketStates();
  const marketMode =
    regions.europe === "OPEN" && regions.unitedStates === "OPEN"
      ? "BOTH_OPEN"
      : regions.europe === "OPEN"
        ? "EU_OPEN"
        : regions.unitedStates === "OPEN"
          ? "US_OPEN"
          : "CLOSED";

  return {
    ...systemStatus,
    marketHours: marketMode === "CLOSED" ? "CLOSED" : "OPEN",
    marketMode,
    updatedAt: timestamp,
  };
}

export function refreshTop8MarketStatus(top8: Top8Asset[]): Top8Asset[] {
  return top8.map((asset) => {
    const marketStatus = isMarketOpen(asset.market);
    if (marketStatus !== "OPEN" && asset.action === "EXEC") {
      return {
        ...asset,
        action: "CLOSED_CONTEXT",
        operationalDecisionAllowed: false,
        operationalBlockReasons: [...new Set([...asset.operationalBlockReasons, "MARKET_NOT_OPEN"])],
        execDisabledReason: "Market closed - EXEC disabled",
      };
    }
    return asset;
  });
}
