/**
 * Yahoo Finance provider — no API key required.
 * Used as fallback when EODHD fails for quotes and historical bars.
 *
 * Symbol mapping:
 *   EODHD "AAPL.US"     → Yahoo "AAPL"
 *   EODHD "SIE.XETRA"   → Yahoo "SIE.DE"
 *   EODHD "MC.PA"       → Yahoo "MC.PA"
 *   EODHD "US10Y.GBOND" → Yahoo "^TNX"
 *   EODHD "VIX.INDX"    → Yahoo "^VIX"
 */

const PROVIDER_TIMEOUT_MS = 8000;

// Direct overrides for symbols that need special mapping
const DIRECT_OVERRIDES = {
  "VIX.INDX":    "^VIX",
  "VVIX.INDX":   "^VVIX",
  "MOVE.INDX":   "^MOVE",
  "US10Y.GBOND": "^TNX",
  "TNX":         "^TNX",
  "VIX":         "^VIX",
  "VVIX":        "^VVIX",
  "MOVE":        "^MOVE",
};

// EODHD exchange suffix → Yahoo Finance suffix
const EXCHANGE_SUFFIX_MAP = {
  "US":    "",        // AAPL.US → AAPL
  "XETRA": ".DE",     // SIE.XETRA → SIE.DE
  "PA":    ".PA",     // MC.PA → MC.PA (same)
  "AS":    ".AS",     // ASML.AS → ASML.AS (same)
  "BR":    ".BR",     // SOLB.BR → SOLB.BR (same)
  "LS":    ".LS",     // EDP.LS → EDP.LS (same)
  "MI":    ".MI",     // ENI.MI → ENI.MI (same)
  "SW":    ".SW",     // NESN.SW → NESN.SW (same)
  "LSE":   ".L",      // SHEL.LSE → SHEL.L
  "L":     ".L",
};

export function toYahooSymbol(eodhdSymbol) {
  if (!eodhdSymbol) return null;

  // Check direct overrides first
  if (DIRECT_OVERRIDES[eodhdSymbol]) return DIRECT_OVERRIDES[eodhdSymbol];

  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return eodhdSymbol; // No suffix — use as-is

  const ticker = parts[0];
  const suffix = parts.slice(1).join(".");
  const yahooSuffix = EXCHANGE_SUFFIX_MAP[suffix];

  if (yahooSuffix === undefined) return null; // Unknown exchange — skip
  return ticker + yahooSuffix;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; EMRR/2.0)",
      },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `Yahoo HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, reason: "Yahoo request failed or timed out" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch real-time quote from Yahoo Finance.
 * Returns { ok, price, previousClose, changePercent, symbol } or { ok: false, reason }
 */
export async function fetchYahooQuote(eodhdSymbol) {
  const yahooSymbol = toYahooSymbol(eodhdSymbol);
  if (!yahooSymbol) return { ok: false, reason: `No Yahoo mapping for ${eodhdSymbol}` };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d&includePrePost=false`;
  const result = await fetchJson(url);
  if (!result.ok) return result;

  const chart = result.data?.chart;
  if (chart?.error) return { ok: false, reason: `Yahoo error: ${chart.error.description}` };

  const meta = chart?.result?.[0]?.meta;
  if (!meta) return { ok: false, reason: "Yahoo returned no chart result" };

  const price = meta.regularMarketPrice ?? null;
  if (price === null || !Number.isFinite(price)) return { ok: false, reason: "Yahoo returned no valid price" };

  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const changePercent = previousClose && previousClose !== 0
    ? ((price - previousClose) / previousClose) * 100
    : (meta.regularMarketChangePercent ?? null);

  return {
    ok: true,
    provider: "Yahoo",
    yahooSymbol,
    price,
    previousClose,
    changePercent,
    dataQuality: previousClose !== null ? "GOOD" : "WARNING",
  };
}

/**
 * Fetch historical OHLCV bars from Yahoo Finance.
 * Returns { ok, bars: [{ date, open, high, low, close, volume }] } or { ok: false, reason }
 */
export async function fetchYahooHistory(eodhdSymbol, lookbackDays = 260) {
  const yahooSymbol = toYahooSymbol(eodhdSymbol);
  if (!yahooSymbol) return { ok: false, reason: `No Yahoo mapping for ${eodhdSymbol}` };

  // Map lookback days to Yahoo range parameter
  const range = lookbackDays > 180 ? "1y" : lookbackDays > 90 ? "6mo" : "3mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${range}&includePrePost=false`;

  const result = await fetchJson(url);
  if (!result.ok) return result;

  const chart = result.data?.chart;
  if (chart?.error) return { ok: false, reason: `Yahoo error: ${chart.error.description}` };

  const chartResult = chart?.result?.[0];
  if (!chartResult) return { ok: false, reason: "Yahoo returned no chart result" };

  const timestamps = chartResult.timestamp ?? [];
  const quotes = chartResult.indicators?.quote?.[0] ?? {};
  const { open = [], high = [], low = [], close = [], volume = [] } = quotes;

  if (timestamps.length === 0) return { ok: false, reason: "Yahoo returned no bars" };

  const bars = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open:   Number.isFinite(open[i])   ? open[i]   : null,
      high:   Number.isFinite(high[i])   ? high[i]   : null,
      low:    Number.isFinite(low[i])    ? low[i]    : null,
      close:  Number.isFinite(close[i])  ? close[i]  : null,
      volume: Number.isFinite(volume[i]) ? volume[i] : null,
    }))
    .filter((bar) => bar.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) return { ok: false, reason: "Yahoo bars had no valid close prices" };

  return { ok: true, provider: "Yahoo", yahooSymbol, bars };
}
