/**
 * Market Breadth — servicio frontend (módulo NUEVO, independiente).
 * Consume el veredicto agregado de mercado desde /api/market-breadth (GET cacheado).
 * No toca ningún otro servicio; el panel del dashboard lo usa de forma aislada.
 */
import { fetchLiveQuoteMap, liveTickerOf } from "./liveQuotes";

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
export interface TrailingLevel { pct: number | null; price: number | null; }
export interface RankTicker {
  symbol: string;
  name: string;
  probUp: number;
  score: number;
  price?: number | null;
  pctChange?: number | null;
  trailing?: { min: TrailingLevel | null; med: TrailingLevel | null; wide: TrailingLevel | null };
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
  // Honestidad del dato (cliente): LOADING / OK / UNAVAILABLE (nunca hubo dato bueno).
  loadState?: "LOADING" | "OK" | "UNAVAILABLE";
  fetchedAtUtc?: string | null;
  refreshFailed?: boolean;
}

export function initialMarketBreadth(): MarketBreadthResult {
  return {
    ok: true,
    verdict: "UNKNOWN",
    score: null,
    color: "#64748b",
    label: "Calculando amplitud de mercado…",
    loadState: "LOADING",
    fetchedAtUtc: null,
    refreshFailed: false,
  };
}

// Tras un fallo: conserva el último veredicto bueno marcado SIN ACTUALIZAR; si nunca lo hubo, "No disponible".
export function markMarketBreadthFailed(prev: MarketBreadthResult, reason?: string): MarketBreadthResult {
  if (prev.loadState === "OK") return { ...prev, refreshFailed: true };
  return {
    ...initialMarketBreadth(),
    ok: false,
    label: "No disponible (fallo de la fuente)",
    reason,
    loadState: "UNAVAILABLE",
    refreshFailed: true,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

// Lanza ante fallo (red, timeout, HTTP, ok:false): el llamante decide con markMarketBreadthFailed.
export async function fetchMarketBreadth(): Promise<MarketBreadthResult> {
  const res = await fetchWithTimeout("/api/market-breadth", { method: "GET", headers: { accept: "application/json" } }, 8000);
  if (!res.ok) throw new Error(`MARKET_BREADTH_HTTP_${res.status}`);
  const data = await res.json();
  if (!data || data.ok === false) throw new Error(data?.reason ?? data?.error ?? "MARKET_BREADTH_UNAVAILABLE");
  return { ...(data as MarketBreadthResult), loadState: "OK", fetchedAtUtc: new Date().toISOString(), refreshFailed: false };
}

/**
 * Enriquece la watchlist (topTickers) con PRECIO EN TIEMPO REAL (price + pctChange) vía el helper
 * compartido (US+EU). Solo actualiza lo MOSTRADO; el veredicto, score y ranking del scan quedan
 * intactos. Conserva el cierre si la cotización no está disponible. No lanza nunca.
 */
export async function enrichBreadthWithLiveQuotes(result: MarketBreadthResult): Promise<MarketBreadthResult> {
  const items = result?.topTickers ?? [];
  if (items.length === 0) return result;
  const map = await fetchLiveQuoteMap(items.map((t) => t.symbol));
  if (map.size === 0) return result;
  const topTickers = items.map((t) => {
    const q = map.get(liveTickerOf(t.symbol));
    return q ? { ...t, price: q.price, pctChange: q.changePercent ?? t.pctChange } : t;
  });
  return { ...result, topTickers };
}

/**
 * Orquesta el recálculo bajo demanda del veredicto de amplitud: encadena el loop
 * multi-batch (start → continue… → final), igual que el frontend orquesta el scan.
 * Devuelve el veredicto final (o el último cacheado si algo falla; lanza si tampoco hay caché). Pensado para el
 * botón SCAN: un run intradía (close-based, no contamina el histórico nocturno).
 * @param onProgress callback opcional con el % de cobertura (0-100) para feedback de UI.
 */
export async function runBreadthScan(onProgress?: (coverage: number) => void): Promise<MarketBreadthResult> {
  const post = (body?: unknown) =>
    fetchWithTimeout(`/api/market-breadth?action=${body ? "continue" : "start"}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }, 30000).then((r) => r.json());

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
      return { ...(data as MarketBreadthResult), loadState: "OK", fetchedAtUtc: new Date().toISOString(), refreshFailed: false };
    }
    // No completó (p.ej. REAL_API_CALLS_DISABLED) → servir el último cacheado.
    return await fetchMarketBreadth();
  } catch {
    return await fetchMarketBreadth();
  }
}
