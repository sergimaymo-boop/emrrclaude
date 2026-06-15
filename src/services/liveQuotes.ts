/**
 * Cotizaciones EN VIVO compartidas — punto único para enriquecer el PRECIO mostrado de cualquier
 * módulo (FABLE 5, FABLE01, watchlist de Amplitud) reutilizando /api/visible-top8-quotes
 * (cascade Finnhub→Yahoo→Stooq, US+EU).
 *
 * IMPORTANTE: esto NO toca la señal ni el ranking — esos se calculan en el scan con los cierres
 * completos. Aquí solo se sustituye el precio/‍% del día que se VISUALIZA. Si una cotización no
 * está disponible, el caller conserva el cierre cacheado (degrada, no rompe). Aislado: nunca lanza.
 */
export interface LiveQuote { price: number; changePercent: number | null; }

function currencyOf(symbol: string): "USD" | "EUR" | "GBX" {
  const suf = symbol.split(".")[1] ?? "";
  if (suf === "" || suf === "US") return "USD";
  if (suf === "L" || suf === "LSE") return "GBX";
  return "EUR"; // MI, PA, AS, DE, SW, BR, LS…
}

/** Ticker sin sufijo de mercado, en mayúsculas (clave del mapa). */
export const liveTickerOf = (symbol: string): string => symbol.replace(/\.[A-Z]+$/, "").toUpperCase();

/**
 * Devuelve un mapa ticker→{price, changePercent} en vivo para los símbolos dados (máx 12 por llamada).
 * Mapa vacío si falla — el caller debe conservar entonces los valores del cierre.
 */
export async function fetchLiveQuoteMap(symbols: string[]): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const uniq = [...new Set((symbols ?? []).filter(Boolean))].slice(0, 12);
  if (uniq.length === 0) return out;
  try {
    const res = await fetch("/api/visible-top8-quotes", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        selectedAssets: uniq.map((sym) => ({
          ticker: sym.replace(/\.[A-Z]+$/, ""),
          name: sym,
          exchange: sym.split(".")[1] ?? "US",
          currency: currencyOf(sym),
          providerSymbol: sym,
        })),
      }),
    });
    if (!res.ok) return out;
    const data = await res.json();
    const assets: Array<{ ticker?: string; price?: number; changePercent?: number }> = data?.assets ?? [];
    for (const q of assets) {
      if (q && typeof q.price === "number" && Number.isFinite(q.price) && q.price > 0) {
        out.set(String(q.ticker ?? "").toUpperCase(), {
          price: q.price,
          changePercent: typeof q.changePercent === "number" && Number.isFinite(q.changePercent) ? q.changePercent : null,
        });
      }
    }
  } catch {
    /* conserva los cierres en el caller */
  }
  return out;
}
