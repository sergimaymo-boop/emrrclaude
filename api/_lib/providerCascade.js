/**
 * PROVIDER CASCADE SYSTEM
 *
 * Tries providers in priority order, stops at first success.
 * No data mixing: result always comes from a single provider.
 *
 * QUOTE PRIORITY (EODHD cancelled June 2026):
 *   TNX only: FRED (Federal Reserve) → Finnhub → Yahoo → Stooq
 *   All others: Finnhub → Yahoo → Stooq
 *
 * HISTORICAL PRIORITY:
 *   1. Yahoo Finance (free, no key)
 *   2. Stooq       (free, no key, CSV, EU + US)
 *
 * FRED (fred.stlouisfed.org):
 *   Series DGS10 = 10-Year Treasury Constant Maturity Rate
 *   Most authoritative source for TNX. Free API, unlimited calls.
 *   Returns EOD data — valid for closed-market display.
 */

const TIMEOUT_MS = 7000;

// ─── Symbol mappings ──────────────────────────────────────────────────────────

// EODHD suffix → Finnhub prefix (indices use ^ prefix)
const EODHD_TO_FINNHUB = {
  "SPY.US":     "SPY",
  "LQD.US":     "LQD",
  "HYG.US":     "HYG",
  "VIX.INDX":   "^VIX",
  "VVIX.INDX":  "^VVIX",
  "US10Y.GBOND":"^TNX",
  "MOVE.INDX":  "MOVE",
};

// EODHD exchange suffix → Yahoo Finance suffix
const EODHD_TO_YAHOO_SUFFIX = {
  US:    "",
  XETRA: ".DE",
  PA:    ".PA",
  AS:    ".AS",
  BR:    ".BR",
  LS:    ".LS",
  MI:    ".MI",
  SW:    ".SW",
  LSE:   ".L",
  L:     ".L",
};

// Direct Yahoo overrides for special symbols
const YAHOO_DIRECT = {
  "VIX.INDX":    "^VIX",
  "VVIX.INDX":   "^VVIX",
  "US10Y.GBOND": "^TNX",
  "MOVE.INDX":   "^MOVE",
};

// EODHD suffix → Stooq suffix
const EODHD_TO_STOOQ_SUFFIX = {
  US:    ".US",
  XETRA: ".DE",
  PA:    ".FR",
  AS:    ".NL",
  BR:    ".BE",
  LS:    ".PT",
  MI:    ".IT",
  SW:    ".CH",
  LSE:   ".UK",
};

const STOOQ_DIRECT = {
  "VIX.INDX":    "^VIX",
  "US10Y.GBOND": "^TNX",
};

// ─── Symbol converters ────────────────────────────────────────────────────────

export function toFinnhubSymbol(eodhdSymbol) {
  return EODHD_TO_FINNHUB[eodhdSymbol] ?? null;
}

export function toYahooSymbol(eodhdSymbol) {
  if (YAHOO_DIRECT[eodhdSymbol]) return YAHOO_DIRECT[eodhdSymbol];
  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return null;
  const ticker = parts[0];
  const suffix = parts.slice(1).join(".");
  const yahoSuffix = EODHD_TO_YAHOO_SUFFIX[suffix];
  if (yahoSuffix === undefined) return null;
  return ticker + yahoSuffix;
}

export function toStooqSymbol(eodhdSymbol) {
  if (STOOQ_DIRECT[eodhdSymbol]) return STOOQ_DIRECT[eodhdSymbol];
  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return null;
  const ticker = parts[0].toLowerCase();
  const suffix = parts.slice(1).join(".");
  const stooqSuffix = EODHD_TO_STOOQ_SUFFIX[suffix];
  if (stooqSuffix === undefined) return null;
  return ticker + stooqSuffix;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url, extraHeaders = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; EMRR/2.0)",
        ...extraHeaders,
      },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, reason: "Request failed or timed out" };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, reason: "Request failed or timed out" };
  } finally {
    clearTimeout(t);
  }
}

function finiteOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Individual provider fetchers ─────────────────────────────────────────────

async function fetchEodhdQuote(eodhdSymbol, apiKey) {
  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(eodhdSymbol)}?api_token=${encodeURIComponent(apiKey)}&fmt=json`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "EODHD", reason: r.reason };

  const d = r.data;
  const price = finiteOrNull(d.close ?? d.price ?? d.last ?? d.c);
  const previousClose = finiteOrNull(d.previousClose ?? d.previous_close ?? d.pc ?? d.prev_close);
  const changePercent = finiteOrNull(d.change_p ?? d.changePercent ?? d.dp)
    ?? (price && previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null);

  if (!price) return { ok: false, provider: "EODHD", reason: "No valid price in response" };
  return { ok: true, provider: "EODHD", price, previousClose, changePercent };
}

async function fetchFinnhubQuote(eodhdSymbol, apiKey) {
  const symbol = toFinnhubSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Finnhub", reason: `No Finnhub mapping for ${eodhdSymbol}` };

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "Finnhub", reason: r.reason };

  const d = r.data;
  const price = finiteOrNull(d.c);
  const previousClose = finiteOrNull(d.pc);
  const changePercent = finiteOrNull(d.dp)
    ?? (price && previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null);

  if (!price || price === 0) return { ok: false, provider: "Finnhub", reason: "No valid price (c=0 or missing)" };
  return { ok: true, provider: "Finnhub", price, previousClose, changePercent };
}

async function fetchYahooQuote(eodhdSymbol) {
  const symbol = toYahooSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Yahoo", reason: `No Yahoo mapping for ${eodhdSymbol}` };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d&includePrePost=false`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "Yahoo", reason: r.reason };

  const meta = r.data?.chart?.result?.[0]?.meta;
  if (!meta) return { ok: false, provider: "Yahoo", reason: "No chart result" };

  const price = finiteOrNull(meta.regularMarketPrice);
  const previousClose = finiteOrNull(meta.previousClose ?? meta.chartPreviousClose);
  const changePercent = finiteOrNull(meta.regularMarketChangePercent)
    ?? (price && previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null);

  if (!price) return { ok: false, provider: "Yahoo", reason: "No valid price" };
  return { ok: true, provider: "Yahoo", price, previousClose, changePercent };
}

async function fetchStooqQuote(eodhdSymbol) {
  const symbol = toStooqSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Stooq", reason: `No Stooq mapping for ${eodhdSymbol}` };

  // Stooq returns CSV: Date,Open,High,Low,Close,Volume
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=d;o;h;l;c;v&h&e=csv`;
  const r = await fetchText(url);
  if (!r.ok) return { ok: false, provider: "Stooq", reason: r.reason };

  const lines = r.text.trim().split("\n").filter(l => l && !l.startsWith("Date"));
  if (lines.length === 0) return { ok: false, provider: "Stooq", reason: "No data rows" };

  const parts = lines[lines.length - 1].split(",");
  const price = finiteOrNull(parts[4]); // Close
  if (!price || price <= 0) return { ok: false, provider: "Stooq", reason: "Invalid price in CSV" };

  return { ok: true, provider: "Stooq", price, previousClose: null, changePercent: null };
}

// ─── Historical bar fetchers ──────────────────────────────────────────────────

async function fetchEodhdHistory(eodhdSymbol, apiKey, fromDate) {
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(eodhdSymbol)}?api_token=${encodeURIComponent(apiKey)}&fmt=json&period=d&from=${encodeURIComponent(fromDate)}`;
  const r = await fetchJson(url);
  if (!r.ok || !Array.isArray(r.data)) return { ok: false, provider: "EODHD", reason: r.reason ?? "Not an array" };

  const bars = r.data
    .map(row => ({
      date: row.date?.slice(0, 10) ?? "",
      open: finiteOrNull(row.open),
      high: finiteOrNull(row.high),
      low: finiteOrNull(row.low),
      close: finiteOrNull(row.adjusted_close ?? row.close),
      volume: finiteOrNull(row.volume) ?? 0,
    }))
    .filter(b => b.date && b.close && b.close > 0);

  if (bars.length === 0) return { ok: false, provider: "EODHD", reason: "No valid bars" };
  return { ok: true, provider: "EODHD", bars };
}

async function fetchYahooHistory(eodhdSymbol, lookbackDays) {
  const symbol = toYahooSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Yahoo", reason: `No Yahoo mapping for ${eodhdSymbol}` };

  const range = lookbackDays > 180 ? "1y" : lookbackDays > 90 ? "6mo" : "3mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "Yahoo", reason: r.reason };

  const result = r.data?.chart?.result?.[0];
  if (!result) return { ok: false, provider: "Yahoo", reason: "No chart result" };

  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  const bars = ts
    .map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: finiteOrNull(q.open?.[i]),
      high: finiteOrNull(q.high?.[i]),
      low: finiteOrNull(q.low?.[i]),
      close: finiteOrNull(q.close?.[i]),
      volume: finiteOrNull(q.volume?.[i]) ?? 0,
    }))
    .filter(b => b.close && b.close > 0);

  if (bars.length === 0) return { ok: false, provider: "Yahoo", reason: "No valid bars" };
  return { ok: true, provider: "Yahoo", bars };
}

async function fetchStooqHistory(eodhdSymbol, lookbackDays) {
  const symbol = toStooqSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Stooq", reason: `No Stooq mapping for ${eodhdSymbol}` };

  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetchText(url);
  if (!r.ok) return { ok: false, provider: "Stooq", reason: r.reason };

  const lines = r.text.trim().split("\n").filter(l => l && !l.startsWith("Date"));
  if (lines.length === 0) return { ok: false, provider: "Stooq", reason: "No data rows" };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const bars = lines
    .map(line => {
      const [date, open, high, low, close, volume] = line.split(",");
      return {
        date: date?.trim() ?? "",
        open: finiteOrNull(open),
        high: finiteOrNull(high),
        low: finiteOrNull(low),
        close: finiteOrNull(close),
        volume: finiteOrNull(volume) ?? 0,
      };
    })
    .filter(b => b.date >= cutoffStr && b.close && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) return { ok: false, provider: "Stooq", reason: "No valid bars after filter" };
  return { ok: true, provider: "Stooq", bars };
}

// ─── FRED (Federal Reserve) — TNX only ───────────────────────────────────────

async function fetchFredTNX(apiKey) {
  // DGS10 = 10-Year Treasury Constant Maturity Rate (most authoritative source)
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${encodeURIComponent(apiKey)}&sort_order=desc&limit=2&file_type=json`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "FRED", reason: r.reason };

  const obs = r.data?.observations;
  if (!Array.isArray(obs) || obs.length === 0) return { ok: false, provider: "FRED", reason: "No observations" };

  // Latest valid value (FRED uses "." for missing data on weekends/holidays)
  const latest = obs.find(o => o.value && o.value !== ".");
  if (!latest) return { ok: false, provider: "FRED", reason: "No valid observation (weekend/holiday)" };

  const price = finiteOrNull(latest.value);
  if (!price) return { ok: false, provider: "FRED", reason: "Invalid value from FRED" };

  // Calculate change vs previous observation
  const prev = obs.find(o => o !== latest && o.value && o.value !== ".");
  const previousClose = prev ? finiteOrNull(prev.value) : null;
  const changePercent = previousClose && previousClose !== 0
    ? ((price - previousClose) / previousClose) * 100
    : null;

  return { ok: true, provider: "FRED", price, previousClose, changePercent, date: latest.date };
}

// ─── Public cascade functions ─────────────────────────────────────────────────

const TNX_SYMBOLS = new Set(["US10Y.GBOND", "TNX", "^TNX"]);

/**
 * Cascade quote: Finnhub → Yahoo → Stooq
 * For TNX: FRED (Federal Reserve) → Finnhub → Yahoo → Stooq
 */
export async function cascadeQuote(eodhdSymbol, env = {}) {
  const tried = [];
  const isTNX = TNX_SYMBOLS.has(eodhdSymbol);

  // TNX special: FRED first (Federal Reserve = most authoritative)
  if (isTNX && env.FRED_API_KEY) {
    const r = await fetchFredTNX(env.FRED_API_KEY);
    tried.push({ provider: "FRED", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  }

  // 1. Finnhub
  if (env.FINNHUB_API_KEY) {
    const r = await fetchFinnhubQuote(eodhdSymbol, env.FINNHUB_API_KEY);
    tried.push({ provider: "Finnhub", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  } else {
    tried.push({ provider: "Finnhub", ok: false, reason: "Key not configured" });
  }

  // 2. Yahoo Finance (no key)
  const yahoo = await fetchYahooQuote(eodhdSymbol);
  tried.push({ provider: "Yahoo", ok: yahoo.ok, reason: yahoo.reason });
  if (yahoo.ok) return { ...yahoo, triedProviders: tried };

  // 3. Stooq (no key, delayed)
  const stooq = await fetchStooqQuote(eodhdSymbol);
  tried.push({ provider: "Stooq", ok: stooq.ok, reason: stooq.reason });
  if (stooq.ok) return { ...stooq, triedProviders: tried };

  return {
    ok: false,
    provider: "none",
    reason: "All providers failed",
    triedProviders: tried,
  };
}

/**
 * Cascade historical bars: EODHD → Yahoo → Stooq
 * Returns { ok, provider, bars, triedProviders }
 */
export async function cascadeHistory(eodhdSymbol, lookbackDays = 260, env = {}) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - lookbackDays);
  const fromDateStr = fromDate.toISOString().slice(0, 10);
  const tried = [];

  // 1. EODHD
  if (env.EODHD_API_KEY) {
    const r = await fetchEodhdHistory(eodhdSymbol, env.EODHD_API_KEY, fromDateStr);
    tried.push({ provider: "EODHD", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  } else {
    tried.push({ provider: "EODHD", ok: false, reason: "Key not configured" });
  }

  // 2. Yahoo Finance (no key)
  const yahoo = await fetchYahooHistory(eodhdSymbol, lookbackDays);
  tried.push({ provider: "Yahoo", ok: yahoo.ok, reason: yahoo.reason });
  if (yahoo.ok) return { ...yahoo, triedProviders: tried };

  // 3. Stooq (no key)
  const stooq = await fetchStooqHistory(eodhdSymbol, lookbackDays);
  tried.push({ provider: "Stooq", ok: stooq.ok, reason: stooq.reason });
  if (stooq.ok) return { ...stooq, triedProviders: tried };

  return {
    ok: false,
    provider: "none",
    reason: "All providers failed",
    triedProviders: tried,
    bars: [],
  };
}
