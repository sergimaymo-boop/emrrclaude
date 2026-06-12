/**
 * LOS ESCOGIDOS — servicio frontend (módulo independiente).
 * Top-10 con mayor probabilidad alcista a 5 sesiones (~7 días naturales), calculado durante el
 * scan sobre TODO el universo US+EU y servido cacheado desde /api/escogidos.
 */

export interface EscogidoTrailing { pct: number | null; price: number | null; }

export interface Escogido {
  rank: number;
  symbol: string;
  name: string;
  price: number | null;
  ret7d: number | null;   // % desde el cierre de hace 5 sesiones (~7 días naturales)
  score: number;
  probUp: number;
  rsi3: number | null;
  downStreak: number;
  trailing: { corto: EscogidoTrailing | null; neutro: EscogidoTrailing | null; ampliado: EscogidoTrailing | null };
}

export interface EscogidosResult {
  ok: boolean;
  items: Escogido[];
  universeCount?: number;
  activeMarkets?: string[];
  horizonSessions?: number;
  baseUp?: number;
  cachedAtUtc?: string;
  reason?: string;
}

export function initialEscogidos(): EscogidosResult {
  return { ok: true, items: [] };
}

export async function fetchEscogidos(): Promise<EscogidosResult> {
  try {
    const res = await fetch("/api/escogidos", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return initialEscogidos();
    const data = await res.json();
    if (!data || data.ok === false) return initialEscogidos();
    return data as EscogidosResult;
  } catch {
    return initialEscogidos();
  }
}
