/**
 * Optimal2026 — frontend service
 * Fetches the last computed snapshot from /api/optimal2026 (KV cache).
 * Live price enrichment: updates price / pctDay from real-time providers.
 * Aislado: un fallo aquí NUNCA afecta a otros módulos (devuelve estado/seguro).
 */

import { fetchLiveQuoteMap, liveTickerOf } from "./liveQuotes";

export interface Optimal2026Item {
  rank: number;
  symbol: string;
  name: string;
  score: number | null;
  allocationPct: number;
  price: number | null;
  pctDay: number | null;
  priceRefreshedAt?: string | null; // ISO timestamp cuando se enriqueció el precio en vivo
  riskAdjMom: number | null;  // señal primaria: (retLong − retSkip) / vol63
  retLong: number | null;     // retorno momentum largo 9m %
  rsLong: number | null;      // fuerza relativa vs SPY (ventana larga) %
  vol63: number | null;       // volatilidad anualizada 3m %
  r2: number | null;          // calidad de tendencia (R²)
  align: number | null;       // alineación EMA 0-3
  stopPct: number | null;
  stopPrice: number | null;
  stopBand: "TR" | "TN" | "TA" | null;
}

export interface Optimal2026Result {
  ok: boolean;
  items: Optimal2026Item[];
  regime?: "RISK_ON" | "RISK_OFF";
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

/**
 * Enriquece los items de Optimal2026 con PRECIO EN TIEMPO REAL (price + pctDay) vía el helper
 * compartido (cascade Finnhub→Yahoo→Stooq, US y EU) — el MISMO que usa FABLE01, probado y estable.
 * El precio del scan es el último CIERRE (correcto para la señal); esto solo actualiza lo que se
 * MUESTRA. Conserva el cierre si la cotización no está disponible. Aislado: nunca afecta a otros módulos.
 */
export async function enrichOptimal2026WithLiveQuotes(
  items: Optimal2026Item[],
): Promise<Optimal2026Item[]> {
  if (!Array.isArray(items) || items.length === 0) return items;
  const map = await fetchLiveQuoteMap(items.map((it) => it.symbol));
  if (map.size === 0) return items;
  const now = new Date().toISOString();
  return items.map((it) => {
    const q = map.get(liveTickerOf(it.symbol));
    return q
      ? { ...it, price: q.price, pctDay: q.changePercent ?? it.pctDay, priceRefreshedAt: now }
      : it;
  });
}
