const ALLOWED_SYMBOLS = ["SPY", "LQD", "HYG", "VIX", "VVIX", "TNX", "MOVE"];

const SYMBOL_DETAILS = {
  SPY: { name: "S&P 500 ETF", eodhdSymbol: "SPY.US", finnhubSymbol: "SPY", currency: "USD" },
  LQD: { name: "Investment Grade Credit", eodhdSymbol: "LQD.US", finnhubSymbol: "LQD", currency: "USD" },
  HYG: { name: "High Yield Credit", eodhdSymbol: "HYG.US", finnhubSymbol: "HYG", currency: "USD" },
  VIX: { name: "Equity Volatility", eodhdSymbol: "VIX.INDX", finnhubSymbol: "^VIX", currency: "index" },
  VVIX: { name: "VIX Volatility", eodhdSymbol: "VVIX.INDX", finnhubSymbol: "^VVIX", currency: "index" },
  TNX: { name: "10Y Yield", eodhdSymbol: "US10Y.GBOND", finnhubSymbol: "^TNX", currency: "%" },
  MOVE: { name: "Treasury Volatility", eodhdSymbol: "MOVE.INDX", finnhubSymbol: "MOVE", currency: "index" },
};

const PLACEHOLDER_PARTS = ["your_", "_here", "placeholder"];
const PROVIDER_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 60;
const quoteCache = new Map();
const INFORMATIONAL_INDICATOR_META = {
  isInformationalOnly: true,
  affectsScore: false,
  affectsRanking: false,
  affectsExec: false,
};

function getEnv() {
  return globalThis.process?.env ?? {};
}

function isConfiguredSecret(value) {
  if (!value || !value.trim()) return false;
  const normalized = value.trim().toLowerCase();
  return !PLACEHOLDER_PARTS.some((part) => normalized.includes(part));
}

function isRealApiEnabled() {
  return getEnv().ENABLE_REAL_API_CALLS === "true";
}

function sendJson(response, statusCode, payload) {
  if (response && typeof response.status === "function") {
    return response.status(statusCode).json(payload);
  }

  if (response && typeof response.writeHead === "function") {
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
    return undefined;
  }

  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function buildIndicatorMetadata(symbol, price) {
  const details = SYMBOL_DETAILS[symbol];

  if (symbol !== "TNX") {
    return INFORMATIONAL_INDICATOR_META;
  }

  return {
    ...INFORMATIONAL_INDICATOR_META,
    diagnosticStatus: price === null ? "TNX_PROVIDER_UNRESOLVED" : "TNX_PROVIDER_VALID",
    providerSymbolsTried: {
      eodhd: details.eodhdSymbol,
      finnhub: details.finnhubSymbol,
    },
  };
}

function createQuote(symbol, fields = {}) {
  const details = SYMBOL_DETAILS[symbol];
  const price = fields.price ?? null;

  return {
    symbol,
    name: details.name,
    price,
    previousClose: fields.previousClose ?? null,
    changePercent: fields.changePercent ?? null,
    currency: details.currency,
    providerUsed: fields.providerUsed ?? "none",
    timestampUtc: new Date().toISOString(),
    dataMode: price === null ? "DATA_UNAVAILABLE" : fields.dataMode ?? "REAL",
    dataQuality: fields.dataQuality ?? "NOT_CONFIGURED",
    marketStatus: "UNKNOWN",
    message: fields.message,
    cacheStatus: fields.cacheStatus ?? "BYPASS",
    cachedAtUtc: fields.cachedAtUtc ?? null,
    ttlSeconds: fields.ttlSeconds ?? CACHE_TTL_SECONDS,
    ...buildIndicatorMetadata(symbol, price),
  };
}

function withCacheMeta(quote, cacheStatus, cachedAtUtc, message) {
  return {
    ...quote,
    cacheStatus,
    cachedAtUtc,
    ttlSeconds: CACHE_TTL_SECONDS,
    message: message ?? quote.message,
  };
}

function readCachedQuote(symbol) {
  const entry = quoteCache.get(symbol);
  if (!entry) return null;

  const ageMs = Date.now() - entry.cachedAtMs;
  return {
    quote: entry.quote,
    cachedAtUtc: entry.cachedAtUtc,
    cacheStatus: ageMs <= CACHE_TTL_SECONDS * 1000 ? "HIT" : "STALE",
  };
}

function writeCachedQuote(symbol, quote) {
  const cachedAtMs = Date.now();
  const cachedAtUtc = new Date(cachedAtMs).toISOString();
  const cacheableQuote = withCacheMeta(quote, "HIT", cachedAtUtc);
  quoteCache.set(symbol, { quote: cacheableQuote, cachedAtMs, cachedAtUtc });
  return withCacheMeta(quote, "MISS", cachedAtUtc);
}

function aggregateCacheStatus(indicators) {
  if (indicators.some((indicator) => indicator.cacheStatus === "MISS")) return "MISS";
  if (indicators.some((indicator) => indicator.cacheStatus === "STALE")) return "STALE";
  if (indicators.length > 0 && indicators.every((indicator) => indicator.cacheStatus === "HIT")) return "HIT";
  return "BYPASS";
}

function latestCachedAt(indicators) {
  const timestamps = indicators
    .map((indicator) => indicator.cachedAtUtc)
    .filter((cachedAtUtc) => typeof cachedAtUtc === "string");

  if (timestamps.length === 0) return null;
  return timestamps.sort().at(-1) ?? null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function calculateChangePercent(price, previousClose) {
  if (price === null || previousClose === null || previousClose === 0) return null;
  return ((price - previousClose) / previousClose) * 100;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const providerResponse = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "EMRR-2.0-Tendencias/phase-4",
      },
      signal: controller.signal,
    });

    if (!providerResponse.ok) {
      return { ok: false, reason: `Provider returned HTTP ${providerResponse.status}.` };
    }

    return { ok: true, data: await providerResponse.json() };
  } catch {
    return { ok: false, reason: "Provider request failed." };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEodhdQuote(symbol) {
  const apiKey = getEnv().EODHD_API_KEY;
  if (!isConfiguredSecret(apiKey)) return { ok: false, reason: "EODHD_API_KEY is not configured." };

  const details = SYMBOL_DETAILS[symbol];
  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(details.eodhdSymbol)}?api_token=${encodeURIComponent(apiKey ?? "")}&fmt=json`;
  const providerResult = await fetchJson(url);
  if (!providerResult.ok) return providerResult;

  const data = providerResult.data;
  const price = firstNumber(data.close, data.price, data.last, data.c);
  const previousClose = firstNumber(data.previousClose, data.previous_close, data.pc, data.prev_close);
  const changePercent = firstNumber(data.change_p, data.changePercent, data.dp) ?? calculateChangePercent(price, previousClose);

  if (price === null) return { ok: false, reason: "EODHD did not return a valid price." };

  return {
    ok: true,
    quote: createQuote(symbol, {
      price,
      previousClose,
      changePercent,
      providerUsed: "EODHD",
      dataQuality: previousClose === null || changePercent === null ? "WARNING" : "GOOD",
    }),
  };
}

async function getControlledQuote(symbol) {
  if (!isRealApiEnabled()) {
    return createQuote(symbol, {
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      dataQuality: "NOT_CONFIGURED",
      message:
        "Real API calls are disabled. Set ENABLE_REAL_API_CALLS=true in Vercel only when Phase 5 real-data validation is authorized.",
    });
  }

  const env = getEnv();
  const cached = readCachedQuote(symbol);

  if (cached?.cacheStatus === "HIT") {
    return withCacheMeta(cached.quote, "HIT", cached.cachedAtUtc);
  }

  if (!isConfiguredSecret(env.EODHD_API_KEY)) {
    return createQuote(symbol, {
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      dataQuality: "NOT_CONFIGURED",
      message: "EODHD_API_KEY is not configured. Provider substitutes are disabled by operational data policy.",
    });
  }

  const eodhdResult = await fetchEodhdQuote(symbol);
  if (eodhdResult.ok) return writeCachedQuote(symbol, eodhdResult.quote);

  return createQuote(symbol, {
    cacheStatus: "BYPASS",
    cachedAtUtc: null,
    dataQuality: "NOT_AVAILABLE",
    message: `Primary provider returned no valid quote data. EODHD: ${eodhdResult.reason}. Provider substitutes are disabled.`,
  });
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    return sendJson(response, 405, {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Only GET is allowed for Phase 5 controlled Master Indicators validation.",
    });
  }

  const indicators = await Promise.all(ALLOWED_SYMBOLS.map((symbol) => getControlledQuote(symbol)));
  const cacheStatus = aggregateCacheStatus(indicators);

  return sendJson(response, 200, {
    ok: indicators.some((indicator) => indicator.price !== null),
    app: "EMRR 2.0 / Tendencias",
    phase: "5",
    mode: isRealApiEnabled() ? "CONTROLLED_REAL_DATA" : "REAL_API_DISABLED",
    realApiCallsEnabled: isRealApiEnabled(),
    cacheStatus,
    cachedAtUtc: latestCachedAt(indicators),
    ttlSeconds: CACHE_TTL_SECONDS,
    maxSymbols: ALLOWED_SYMBOLS.length,
    symbols: ALLOWED_SYMBOLS,
    indicators,
    message:
      "Phase 5 endpoint is limited to the approved Master Indicators allowlist. No scanner, ranking, scoring, or trailing logic is executed.",
  });
}
