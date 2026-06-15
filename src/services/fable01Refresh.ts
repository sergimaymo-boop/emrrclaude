/**
 * FABLE01 — servicio frontend (módulo independiente).
 * Top-10 de SALUD DE TENDENCIA con ASIGNACIÓN DE CAPITAL (allocation % + trailing TR/TN/TA),
 * calculado durante el scan sobre todo el universo US+EU y servido cacheado desde /api/fable01.
 * Aislado: un fallo aquí no afecta a otros módulos (devuelve estado vacío).
 */

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

// Moneda según el sufijo del símbolo (solo para el endpoint de cotizaciones; no afecta a la señal).
function currencyOf(symbol: string): "USD" | "EUR" | "GBX" {
  const suf = symbol.split(".")[1] ?? "";
  if (suf === "" || suf === "US") return "USD";
  if (suf === "L" || suf === "LSE") return "GBX";
  return "EUR"; // MI, PA, AS, DE, SW, BR, LS…
}

/**
 * Enriquece los items de FABLE01 con PRECIO EN TIEMPO REAL (price + pctDay) usando el mismo
 * endpoint de cotizaciones en vivo que el Top 8 (cascade Finnhub→Yahoo→Stooq, US y EU).
 * El precio del scan es el último CIERRE (correcto para la señal/trend); esto solo actualiza
 * lo que se MUESTRA. Si una cotización no está disponible, conserva el valor cacheado (no rompe).
 * Aislado: un fallo aquí nunca afecta a otros módulos.
 */
export async function enrichFable01WithLiveQuotes(items: Fable01Item[]): Promise<Fable01Item[]> {
  if (!Array.isArray(items) || items.length === 0) return items;
  try {
    const res = await fetch("/api/visible-top8-quotes", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        selectedAssets: items.slice(0, 12).map((it) => ({
          ticker: it.symbol.replace(/\.[A-Z]+$/, ""),
          name: it.name,
          exchange: it.symbol.split(".")[1] ?? "US",
          currency: currencyOf(it.symbol),
          providerSymbol: it.symbol,
        })),
      }),
    });
    if (!res.ok) return items;
    const data = await res.json();
    const quotes: Array<{ ticker?: string; price?: number; changePercent?: number }> = data?.assets ?? [];
    const byTicker = new Map(quotes.map((q) => [String(q.ticker ?? "").toUpperCase(), q]));
    return items.map((it) => {
      const q = byTicker.get(it.symbol.replace(/\.[A-Z]+$/, "").toUpperCase());
      if (q && typeof q.price === "number" && Number.isFinite(q.price) && q.price > 0) {
        return {
          ...it,
          price: q.price,
          pctDay: typeof q.changePercent === "number" && Number.isFinite(q.changePercent) ? q.changePercent : it.pctDay,
        };
      }
      return it;
    });
  } catch {
    return items;
  }
}
