/**
 * FABLE 5 — servicio frontend (módulo independiente).
 * Top-10 de tendencia alcista LIMPIA sin pullback inminente, calculado durante el scan sobre
 * todo el universo US+EU y servido cacheado desde /api/fable5.
 */

import { fetchLiveQuoteMap, liveTickerOf } from "./liveQuotes";

export interface Fable5Trailing { pct: number | null; price: number | null; }

export interface Fable5Item {
  rank: number;
  symbol: string;
  name: string;
  price: number | null;
  pctDay: number | null;  // % desde el cierre de la última sesión
  score: number;
  trailing: { ajustado: Fable5Trailing | null; normal: Fable5Trailing | null; ampliado: Fable5Trailing | null };
  // contexto de la tendencia (informativo)
  r2: number | null;
  slope20: number | null;
  dist52H: number | null;
}

export interface Fable5Result {
  ok: boolean;
  items: Fable5Item[];
  universeCount?: number;
  activeMarkets?: string[];
  oosWin?: number;     // % win validado OOS del top-10
  horizon?: number;    // sesiones del horizonte calibrado
  cachedAtUtc?: string;
  reason?: string;
}

export function initialFable5(): Fable5Result {
  return { ok: true, items: [] };
}

export async function fetchFable5(): Promise<Fable5Result> {
  try {
    const res = await fetch("/api/fable5", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return initialFable5();
    const data = await res.json();
    if (!data || data.ok === false) return initialFable5();
    return data as Fable5Result;
  } catch {
    return initialFable5();
  }
}

/**
 * Enriquece los items de FABLE 5 con PRECIO EN TIEMPO REAL (price + pctDay) vía el helper
 * compartido (cascade Finnhub→Yahoo→Stooq, US y EU). Solo actualiza lo que se MUESTRA; la
 * señal/ranking del scan (cierres completos) queda intacta. Conserva el cierre si falla.
 */
export async function enrichFable5WithLiveQuotes(items: Fable5Item[]): Promise<Fable5Item[]> {
  if (!Array.isArray(items) || items.length === 0) return items;
  const map = await fetchLiveQuoteMap(items.map((it) => it.symbol));
  if (map.size === 0) return items;
  return items.map((it) => {
    const q = map.get(liveTickerOf(it.symbol));
    return q ? { ...it, price: q.price, pctDay: q.changePercent ?? it.pctDay } : it;
  });
}
