/**
 * Market Breadth — servicio frontend (módulo NUEVO, independiente).
 * Consume el veredicto agregado de mercado desde /api/market-breadth (GET cacheado).
 * No toca ningún otro servicio; el panel del dashboard lo usa de forma aislada.
 */

export type MarketBreadthVerdict = "BULLISH" | "DETERIORATING" | "PULLBACK_IMMINENT" | "UNKNOWN";

export interface MarketBreadthIndicators {
  pctAboveMA50: number;
  pctAboveMA200: number;
  advancePct: number;
  declinePct: number;
  newHighPct: number;
  newLowPct: number;
  netHighLow: number;
  distributionPct: number;
  slopeUpPct: number;
  avgRs20: number;
  mcclellan: number;
}

export interface MarketBreadthResult {
  ok: boolean;
  verdict: MarketBreadthVerdict;
  score: number | null;
  color: string;
  label: string;
  indicators?: MarketBreadthIndicators;
  alerts?: string[];
  sample?: { analyzed: number; skipped: number; adNet: number };
  spyBullish?: boolean | null;
  activeMarkets?: string[];
  cachedAtUtc?: string;
  fromCache?: boolean;
  reason?: string;
}

export function initialMarketBreadth(): MarketBreadthResult {
  return {
    ok: true,
    verdict: "UNKNOWN",
    score: null,
    color: "#64748b",
    label: "Calculando amplitud de mercado…",
  };
}

export async function fetchMarketBreadth(): Promise<MarketBreadthResult> {
  try {
    const res = await fetch("/api/market-breadth", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return initialMarketBreadth();
    const data = await res.json();
    if (!data || data.ok === false) return initialMarketBreadth();
    return data as MarketBreadthResult;
  } catch {
    return initialMarketBreadth();
  }
}
