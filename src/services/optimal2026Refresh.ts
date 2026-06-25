/**
 * Optimal2026 — frontend service
 * Fetches the last computed snapshot from /api/optimal2026 (KV cache).
 * Live price enrichment: updates price / pctDay from real-time providers.
 */

export interface Optimal2026Item {
  rank: number;
  symbol: string;
  name: string;
  score: number | null;
  allocationPct: number;
  price: number | null;
  pctDay: number | null;
  riskAdjMom: number | null;  // primary signal: (ret252 - ret21) / vol63
  ret252: number | null;      // 12m return %
  rs252: number | null;       // relative strength vs SPY 12m %
  vol63: number | null;       // 3m annualized volatility %
  r2_252: number | null;      // trend quality (R²)
  align: number | null;       // EMA alignment 0-3
  stopPct: number | null;
  stopPrice: number | null;
  stopBand: "TR" | "TN" | "TA" | null;
}

export interface Optimal2026Result {
  ok: boolean;
  items: Optimal2026Item[];
  regime?: "FULL" | "HALF" | "ZERO";
  deployPct?: number;
  regimeReason?: string;
  badge?: number;
  oos?: {
    cagr: number;
    maxDD: number;
    mar: number;
    sharpe: number;
    winPos: number;
    beatsSpy: string;
    tradesYr?: number;
    testPeriod?: string;
  };
  universeCount?: number;
  activeMarkets?: string[];
  scanStartedAtUtc?: string;
  cachedAtUtc?: string;
  error?: string;
  message?: string;
}

export function initialOptimal2026(): Optimal2026Result {
  return { ok: true, items: [] };
}

export async function fetchOptimal2026(): Promise<Optimal2026Result> {
  const res = await fetch("/api/optimal2026");
  if (res.status === 404) {
    // No data yet — return empty state gracefully
    return { ok: true, items: [], message: "Sin datos aún. Ejecuta un scan completo." };
  }
  if (!res.ok) throw new Error(`Optimal2026 fetch failed: ${res.status}`);
  const data = await res.json();
  return data as Optimal2026Result;
}

// Live price enrichment — same pattern as fable01Refresh
export async function enrichOptimal2026WithLiveQuotes(
  items: Optimal2026Item[],
): Promise<Optimal2026Item[]> {
  if (!items || items.length === 0) return items;

  const symbols = items.map((i) => i.symbol).filter(Boolean);
  if (symbols.length === 0) return items;

  try {
    const qs = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`/api/visible-top8-quotes?${qs}`);
    if (!res.ok) return items;
    const data = await res.json();
    const quotes: Record<string, { price?: number; pctDay?: number }> = {};
    for (const q of data.quotes ?? []) {
      if (q.symbol) quotes[q.symbol] = { price: q.price, pctDay: q.pctDay };
    }
    return items.map((item) => {
      const q = quotes[item.symbol];
      if (!q) return item;
      return {
        ...item,
        price: q.price ?? item.price,
        pctDay: q.pctDay ?? item.pctDay,
      };
    });
  } catch {
    return items;
  }
}
