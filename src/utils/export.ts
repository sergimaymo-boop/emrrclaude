import type { Top8Asset } from "../types";

export function formatTop8ForExport(top8: Top8Asset[]): string {
  return top8
    .map((asset) =>
      [
        `${asset.rank}. ${asset.ticker}`,
        asset.name,
        asset.market,
        asset.marketStatus,
        asset.price,
        `Change vs Prev Close ${asset.priceChangePercent > 0 ? "+" : ""}${asset.priceChangePercent.toFixed(2)}%`,
        `Score ${asset.score}`,
        `Conviction ${asset.conviction}`,
        `EMA20 ${asset.ema20}`,
        `EMA50 ${asset.ema50}`,
        `Slope ${asset.slope}`,
        `RS ${asset.rs}`,
        `RVOL ${asset.rvol}`,
        `ATR ${asset.atr}`,
        `ATR% ${asset.atrPercent}`,
        `Momentum ${asset.momentum}`,
        `Risk ${asset.risk}`,
        `trailing_adjusted ${asset.trailingAdjusted}`,
        `trailing_medium ${asset.trailingMedium}`,
        `trailing_wide ${asset.trailingWide}`,
        `Action ${asset.action}`,
        `Data ${asset.dataQuality}`,
        `DataMode ${asset.dataMode}`,
        `PriceMode ${asset.priceDataMode}`,
        `OperationalData ${asset.operationalDataStatus}`,
        `OperationalDecision ${asset.operationalDecisionAllowed ? "ALLOWED" : "BLOCKED"}`,
        `ScoreInputs ${Object.entries(asset.scoreInputIntegrity)
          .map(([component, status]) => `${component}:${status}`)
          .join(",")}`,
        `Provider ${asset.provider}`,
        `ProviderSymbol ${asset.providerSymbol}`,
        `Cache ${asset.cacheStatus}`,
        `PriceTimestamp ${asset.priceTimestamp.local}`,
        asset.operationalBlockReasons.length > 0 ? `OperationalBlocks ${asset.operationalBlockReasons.join(",")}` : null,
        asset.execDisabledReason ? `ExecGuard ${asset.execDisabledReason}` : null,
      ].join(" | "),
    )
    .join("\n");
}
