import { cascadeQuote } from "./_lib/providerCascade.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "VISIBLE_TOP8_QUOTES";
const ENDPOINT_VERSION = "DATA_INTEGRITY_FIX_2026_06_01";
const CACHE_TTL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 5_000;
// Tope de assets por llamada. 12 (no 8) para que el top-10 de FABLE01/FABLE 5 quepa en UNA
// petición; el bucle es Promise.all (paralelo), así que el coste temporal no crece. El Top 8
// sigue enviando ≤8 (compatible). Es enriquecimiento de precio en vivo, no fuente de ranking.
const MAX_ASSETS = 12;

const quoteCache = new Map();

async function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function normalizeSelectedAssets(body) {
  if (!body || !Array.isArray(body.selectedAssets)) return [];
  const seen = new Set();
  const assets = [];

  for (const item of body.selectedAssets) {
    const ticker = String(item?.ticker ?? "").trim().toUpperCase();
    const providerSymbol = String(item?.providerSymbol ?? "").trim().toUpperCase();
    if (!ticker || !providerSymbol || seen.has(`${ticker}:${providerSymbol}`)) continue;
    seen.add(`${ticker}:${providerSymbol}`);
    assets.push({
      ticker,
      name: String(item?.name ?? ticker).trim(),
      exchange: String(item?.exchange ?? item?.market ?? "UNKNOWN").trim(),
      currency: ["USD", "EUR", "GBX"].includes(item?.currency) ? item.currency : "USD",
      providerSymbolEodhd: providerSymbol,
      scanId: typeof body.scanId === "string" ? body.scanId : null,
    });
  }

  return assets;
}

function json(res, statusCode, body) {
  res.status(statusCode).json({
    ...body,
    app: APP_NAME,
    endpoint: ENDPOINT,
    endpointVersion: ENDPOINT_VERSION,
    timestampUtc: new Date().toISOString(),
  });
}

function realApiCallsEnabled() {
  return process.env.ENABLE_REAL_API_CALLS === "true";
}

function finiteNumber(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampFromProvider(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildUnavailableAsset(asset, reason, dataQuality = "NOT_AVAILABLE") {
  return {
    ticker: asset.ticker,
    name: asset.name,
    exchange: asset.exchange,
    currency: asset.currency,
    providerSymbol: null,
    provider: "none",
    price: null,
    previousClose: null,
    changePercent: null,
    timestampUtc: null,
    dataQuality,
    cacheStatus: "NOT_AVAILABLE",
    dataMode: "ERROR",
    operationalDataStatus: "DATA_UNAVAILABLE",
    operationalDecisionAllowed: false,
    operationalBlockReasons: ["VISIBLE_QUOTE_DATA_UNAVAILABLE", "PRICE_ENRICHMENT_ONLY_NOT_RANKING_SOURCE", "NO_SUBSTITUTE_DATA_USED"],
    scanId: asset.scanId ?? null,
    error: reason,
  };
}

function buildQuoteAsset(asset, quote, cacheStatus) {
  const changePercent =
    quote.previousClose && quote.previousClose > 0 ? ((quote.price - quote.previousClose) / quote.previousClose) * 100 : null;

  return {
    ticker: asset.ticker,
    name: asset.name,
    exchange: asset.exchange,
    currency: asset.currency,
    providerSymbol: quote.providerSymbol,
    provider: quote.provider,
    price: quote.price,
    previousClose: quote.previousClose,
    changePercent,
    timestampUtc: quote.timestampUtc,
    dataQuality: quote.dataQuality,
    cacheStatus,
    dataMode: "REAL",
    operationalDataStatus: "REAL",
    operationalDecisionAllowed: false,
    operationalBlockReasons: ["PRICE_ENRICHMENT_ONLY_NOT_RANKING_SOURCE", "SCORE_INPUTS_NOT_VALIDATED_BY_QUOTES_ENDPOINT", "NO_SUBSTITUTE_DATA_USED"],
    scanId: asset.scanId ?? null,
    error: null,
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getEodhdQuote(asset) {
  const apiKey = process.env.EODHD_API_KEY;
  if (!apiKey || !asset.providerSymbolEodhd) return null;

  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(asset.providerSymbolEodhd)}?api_token=${encodeURIComponent(apiKey)}&fmt=json`;
  const payload = await fetchJson(url);
  const data = Array.isArray(payload) ? payload[0] : payload;
  const price = finiteNumber(data?.close ?? data?.price ?? data?.last ?? data?.c);
  if (!price || price <= 0) return null;

  const previousClose = finiteNumber(data?.previousClose ?? data?.previous_close ?? data?.pc ?? data?.previousClosePrice);
  const timestampUtc = timestampFromProvider(data?.timestamp ?? data?.date ?? data?.datetime) ?? new Date().toISOString();

  return {
    provider: "EODHD",
    providerSymbol: asset.providerSymbolEodhd,
    price,
    previousClose,
    timestampUtc,
    dataQuality: previousClose ? "CLEAN" : "GOOD",
  };
}

async function getVisibleQuote(asset) {
  const cached = quoteCache.get(asset.ticker);
  const now = Date.now();

  if (cached && now - cached.cachedAt < CACHE_TTL_SECONDS * 1000) {
    return buildQuoteAsset(asset, cached.quote, "HIT");
  }

  if (!realApiCallsEnabled()) {
    return buildUnavailableAsset(asset, "REAL_API_CALLS_DISABLED", "NOT_CONFIGURED");
  }

  const env = process.env;
  const isConfigured = (v) => v && v.trim() && !v.includes("placeholder");

  // Cascade: Finnhub → TwelveData → Yahoo → Stooq
  const result = await cascadeQuote(asset.providerSymbolEodhd, {
    FINNHUB_API_KEY:     isConfigured(env.FINNHUB_API_KEY)     ? env.FINNHUB_API_KEY     : null,
    TWELVE_DATA_API_KEY: isConfigured(env.TWELVE_DATA_API_KEY) ? env.TWELVE_DATA_API_KEY : null,
    FMP_API_KEY:         isConfigured(env.FMP_API_KEY)         ? env.FMP_API_KEY         : null,
    FRED_API_KEY:        isConfigured(env.FRED_API_KEY)        ? env.FRED_API_KEY        : null,
  });

  if (result.ok) {
    const quote = {
      provider: result.provider,
      providerSymbol: asset.providerSymbolEodhd,
      price: result.price,
      previousClose: result.previousClose,
      timestampUtc: new Date().toISOString(),
      dataQuality: result.previousClose ? "CLEAN" : "GOOD",
    };
    quoteCache.set(asset.ticker, { quote, cachedAt: now });
    return buildQuoteAsset(asset, quote, "MISS");
  }

  return buildUnavailableAsset(asset, result.reason ?? "ALL_PROVIDERS_FAILED");
}

function summarizeProviders(assets) {
  return assets.reduce(
    (summary, asset) => {
      const provider = asset.provider ?? "none";
      summary[provider] = (summary[provider] ?? 0) + 1;
      return summary;
    },
    { EODHD: 0, Finnhub: 0, none: 0 },
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      allowedMethods: ["GET", "POST"],
    });
    return;
  }

  const queryKeys = Object.keys(req.query ?? {});
  if (queryKeys.length > 0) {
    json(res, 400, {
      ok: false,
      error: "QUERY_NOT_ALLOWED",
      allowedQueryKeys: [],
      receivedQueryKeys: queryKeys,
    });
    return;
  }

  const body = req.method === "POST" ? await readJsonBody(req) : {};
  const selectedAssets = req.method === "POST" ? normalizeSelectedAssets(body) : [];
  if (req.method === "GET") {
    json(res, 200, {
      ok: true,
      mode: "PRICE_ENRICHMENT_ONLY",
      realApiCallsEnabled: realApiCallsEnabled(),
      maxAssets: MAX_ASSETS,
      selectedTickers: [],
      acceptsExternalSymbols: false,
      rankingSource: false,
      universeExecutionAllowed: false,
      fullRunAllowed: false,
      providerSummary: { EODHD: 0, Finnhub: 0, none: 0 },
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      assets: [],
      message: "POST selectedAssets from an already ranked scan snapshot to enrich prices. GET does not expose a fixed substitute list.",
    });
    return;
  }

  if (req.method === "POST" && selectedAssets.length === 0) {
    json(res, 400, {
      ok: false,
      error: "SELECTED_SNAPSHOT_ASSETS_REQUIRED",
      message: "POST requires selectedAssets from the already ranked scan snapshot.",
    });
    return;
  }

  if (selectedAssets.length > MAX_ASSETS) {
    json(res, 400, {
      ok: false,
      error: "MAX_VISIBLE_QUOTES_EXCEEDED",
      maxAssets: MAX_ASSETS,
    });
    return;
  }

  const invalidSymbols = selectedAssets.filter((asset) => {
    if (asset.providerSymbolEodhd.includes(",") || asset.providerSymbolEodhd.includes("/") || asset.providerSymbolEodhd.includes("?")) {
      return true;
    }
    return asset.providerSymbolEodhd.split(".").length < 2;
  });
  if (invalidSymbols.length > 0) {
    json(res, 400, {
      ok: false,
      error: "PROVIDER_SYMBOL_NOT_ALLOWED",
      invalidTickers: invalidSymbols.map((asset) => asset.ticker),
      acceptsExternalSymbols: false,
    });
    return;
  }

  const assets = await Promise.all(selectedAssets.map((asset) => getVisibleQuote(asset)));

  json(res, 200, {
    ok: true,
    mode: "PRICE_ENRICHMENT_ONLY",
    realApiCallsEnabled: realApiCallsEnabled(),
    maxAssets: MAX_ASSETS,
    selectedTickers: selectedAssets.map((asset) => asset.ticker),
    scanId: typeof body.scanId === "string" ? body.scanId : null,
    acceptsExternalSymbols: false,
    rankingSource: false,
    universeExecutionAllowed: false,
    fullRunAllowed: false,
    providerSummary: summarizeProviders(assets),
    cacheTtlSeconds: CACHE_TTL_SECONDS,
    assets,
  });
}
