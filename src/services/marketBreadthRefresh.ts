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

export interface RankTickerFeatures {
  ret20: number | null; ret60: number | null; rsi14: number | null;
  distMA50: number | null; distMA200: number | null;
  dist52H: number | null; dist52L: number | null;
  atrPct: number | null; rvol: number | null;
  aboveMA200: boolean; lastClose: number | null;
}
export interface RankTicker {
  symbol: string;
  name: string;
  probUp: number;
  score: number;
  features: RankTickerFeatures;
}

export interface MarketBreadthResult {
  ok: boolean;
  verdict: MarketBreadthVerdict;
  score: number | null;
  color: string;
  label: string;
  indicators?: MarketBreadthIndicators;
  alerts?: string[];
  horizonDays?: number;
  topTickers?: RankTicker[];
  rankHorizonDays?: number;
  rankBaseUp?: number;
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

/**
 * Orquesta el recálculo bajo demanda del veredicto de amplitud: encadena el loop
 * multi-batch (start → continue… → final), igual que el frontend orquesta el scan.
 * Devuelve el veredicto final (o el último cacheado si algo falla). Pensado para el
 * botón SCAN: un run intradía (close-based, no contamina el histórico nocturno).
 * @param onProgress callback opcional con el % de cobertura (0-100) para feedback de UI.
 */
export async function runBreadthScan(onProgress?: (coverage: number) => void): Promise<MarketBreadthResult> {
  const post = (body?: unknown) =>
    fetch(`/api/market-breadth?action=${body ? "continue" : "start"}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  try {
    let data = await post();
    let guard = 0;
    while (data && data.isFinal === false && data.breadthToken && guard < 30) {
      if (onProgress && typeof data.coveragePercent === "number") onProgress(data.coveragePercent);
      data = await post({ breadthToken: data.breadthToken });
      guard += 1;
    }
    if (data && data.isFinal) {
      if (onProgress) onProgress(100);
      return data as MarketBreadthResult;
    }
    // No completó (p.ej. REAL_API_CALLS_DISABLED) → servir el último cacheado.
    return await fetchMarketBreadth();
  } catch {
    return await fetchMarketBreadth();
  }
}
