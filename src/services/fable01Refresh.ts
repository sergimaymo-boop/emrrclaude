/**
 * FABLE01 — servicio frontend (módulo independiente).
 * Top-10 de SALUD DE TENDENCIA con ASIGNACIÓN DE CAPITAL (allocation % + trailing TR/TN/TA),
 * calculado durante el scan sobre todo el universo US+EU y servido cacheado desde /api/fable01.
 * Aislado: un fallo aquí no afecta a otros módulos (devuelve estado vacío).
 */

import { fetchLiveQuoteMap, liveTickerOf } from "./liveQuotes";

export type TrailingBand = "TR" | "TN" | "TA";

export interface Fable01Item {
  rank: number;
  symbol: string;
  name: string;
  score: number;             // 0-100 salud de tendencia
  allocationPct: number;     // 0-100; todos suman 100; débiles pueden ser 0
  price: number | null;
  pctDay: number | null;     // % desde el cierre de la última sesión
  trailingBand: TrailingBand;
  trailingStopPct: number | null;
  trailingStopPrice: number | null;
  trailingLevelsPct: { TR: number | null; TN: number | null; TA: number | null } | null;
  rs60: number | null;       // fuerza relativa vs SPY (60 sesiones, %)
  slope20: number | null;    // pendiente de la tendencia corta (%)
}

export interface Fable01Result {
  ok: boolean;
  items: Fable01Item[];
  badge?: number;            // 0-100 fiabilidad honesta (mecánica de rotación, con haircut)
  oos?: { cagr: number; maxDD: number; mar: number; winPos: number; beatsSpy: string; tradesYr?: number };
  deploymentPct?: number;    // % de capital a desplegar ahora (100 risk-on / 35 risk-off)
  regimeRiskOn?: boolean;    // régimen SPY (true=risk-on)
  universeCount?: number;
  activeMarkets?: string[];
  cachedAtUtc?: string;
  reason?: string;
}

export function initialFable01(): Fable01Result {
  return { ok: true, items: [] };
}

export async function fetchFable01(): Promise<Fable01Result> {
  try {
    const res = await fetch("/api/fable01", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return initialFable01();
    const data = await res.json();
    if (!data || data.ok === false) return initialFable01();
    return data as Fable01Result;
  } catch {
    return initialFable01();
  }
}

/**
 * Enriquece los items de FABLE01 con PRECIO EN TIEMPO REAL (price + pctDay) vía el helper
 * compartido (cascade Finnhub→Yahoo→Stooq, US y EU). El precio del scan es el último CIERRE
 * (correcto para la señal); esto solo actualiza lo que se MUESTRA. Conserva el cierre si la
 * cotización no está disponible. Aislado: nunca afecta a otros módulos.
 */
export async function enrichFable01WithLiveQuotes(items: Fable01Item[]): Promise<Fable01Item[]> {
  if (!Array.isArray(items) || items.length === 0) return items;
  const map = await fetchLiveQuoteMap(items.map((it) => it.symbol));
  if (map.size === 0) return items;
  return items.map((it) => {
    const q = map.get(liveTickerOf(it.symbol));
    return q ? { ...it, price: q.price, pctDay: q.changePercent ?? it.pctDay } : it;
  });
}
