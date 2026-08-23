import {
  PROVIDER_EXCHANGES,
  UNIVERSE_MODE,
  UNIVERSE_PENDING_FILTERS,
  dedupeUniverseAssets,
  getExcludedInstrumentLabels,
  isEligibleForUniverse,
  mapUniverseAsset,
  summarizeUniverseAssets,
} from "./universeEngine.js";
import { getStaticAssetsForExchange, STATIC_UNIVERSE_VERSION, STATIC_TOTAL_COUNT } from "./staticUniverse.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const PHASE = "6";
const PROVIDER_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 86400;
const ASSET_SAMPLE_LIMIT = 50;
const PLACEHOLDER_PARTS = ["your_", "_here", "placeholder"];
const universeCache = new Map();

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

function readUniverseCache() {
  const entry = universeCache.get(UNIVERSE_MODE);
  if (!entry) return null;
  const ageMs = Date.now() - entry.cachedAtMs;
  return {
    payload: entry.payload,
    cachedAtUtc: entry.cachedAtUtc,
    cacheStatus: ageMs <= CACHE_TTL_SECONDS * 1000 ? "HIT" : "STALE",
  };
}

function writeUniverseCache(payload) {
  const cachedAtMs = Date.now();
  const cachedAtUtc = new Date(cachedAtMs).toISOString();
  const cachePayload = {
    ...payload,
    cacheStatus: "HIT",
    cachedAtUtc,
    ttlSeconds: CACHE_TTL_SECONDS,
  };
  universeCache.set(UNIVERSE_MODE, { payload: cachePayload, cachedAtMs, cachedAtUtc });
  return {
    ...payload,
    cacheStatus: "MISS",
    cachedAtUtc,
    ttlSeconds: CACHE_TTL_SECONDS,
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const providerResponse = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "EMRR-2.0-Tendencias/phase-6-universe",
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

async function fetchEodhdExchangeList(providerExchange) {
  const apiKey = getEnv().EODHD_API_KEY;
  if (!isConfiguredSecret(apiKey)) return { ok: false, reason: "EODHD_API_KEY is not configured." };

  const url = `https://eodhd.com/api/exchange-symbol-list/${encodeURIComponent(
    providerExchange,
  )}?api_token=${encodeURIComponent(apiKey)}&fmt=json`;
  const result = await fetchJson(url);
  if (!result.ok) return result;
  if (!Array.isArray(result.data)) return { ok: false, reason: "EODHD did not return a symbol array." };
  return { ok: true, rows: result.data };
}

export async function buildUniverseResponse(options = {}) {
  if (!isRealApiEnabled()) {
    return {
      ok: false,
      app: APP_NAME,
      phase: PHASE,
      mode: "REAL_API_DISABLED",
      universeMode: UNIVERSE_MODE,
      timestampUtc: new Date().toISOString(),
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      error: "REAL_API_CALLS_DISABLED",
      message: "ENABLE_REAL_API_CALLS is not true; automatic universe discovery did not call providers.",
      includedMarkets: PROVIDER_EXCHANGES,
      assets: [],
      summary: summarizeUniverseAssets([], []),
      pendingFilters: UNIVERSE_PENDING_FILTERS,
    };
  }

  // Try static universe first (no API call), fall back to EODHD if static is empty
  const exchangeResults = await Promise.all(
    PROVIDER_EXCHANGES.map(async (exchangeConfig) => {
      // 1. Static universe (free, instant, no API key)
      const staticRows = getStaticAssetsForExchange(exchangeConfig.providerExchange);
      if (staticRows.length > 0) {
        const filteredRows = staticRows.filter((row) => isEligibleForUniverse(row, exchangeConfig));
        return { ok: true, exchangeConfig, rows: filteredRows, rawRows: staticRows, source: "STATIC" };
      }
      // 2. EODHD fallback (paid, dynamic)
      const result = await fetchEodhdExchangeList(exchangeConfig.providerExchange);
      if (!result.ok) return { ok: false, exchangeConfig, reason: result.reason, rows: [], source: "EODHD_FAILED" };
      const filteredRows = result.rows.filter((row) => isEligibleForUniverse(row, exchangeConfig));
      return { ok: true, exchangeConfig, rows: filteredRows, rawRows: result.rows, source: "EODHD" };
    }),
  );

  const assets = dedupeUniverseAssets(
    exchangeResults.flatMap((result) =>
      result.rows.map((row) => mapUniverseAsset(row, result.exchangeConfig)),
    ),
  );
  const shouldReturnFullAssets = options.includeFullAssets === true;
  const assetSample = shouldReturnFullAssets ? assets : assets.slice(0, ASSET_SAMPLE_LIMIT);
  const sources = [...new Set(exchangeResults.map(r => r.source))];

  return {
    ok: assets.length > 0,
    app: APP_NAME,
    phase: PHASE,
    mode: "CONTROLLED_REAL_DATA",
    universeMode: UNIVERSE_MODE,
    timestampUtc: new Date().toISOString(),
    cacheStatus: "BYPASS",
    cachedAtUtc: null,
    ttlSeconds: CACHE_TTL_SECONDS,
    provider: sources.includes("EODHD") ? "EODHD" : "STATIC",
    staticUniverseVersion: STATIC_UNIVERSE_VERSION,
    staticUniverseTotal: STATIC_TOTAL_COUNT,
    includedMarkets: PROVIDER_EXCHANGES,
    excludedInstruments: getExcludedInstrumentLabels(),
    exchangeResults: exchangeResults.map((result) => ({
      ok: result.ok,
      providerExchange: result.exchangeConfig.providerExchange,
      market: result.exchangeConfig.market,
      rawRows: result.rawRows?.length ?? result.rows.length,
      rows: result.rows.length,
      filteredRows: result.rows.length,
      reason: result.reason,
    })),
    summary: summarizeUniverseAssets(assets, exchangeResults),
    rawProviderSymbolsDiscovered: exchangeResults.reduce(
      (total, result) => total + (result.rawRows?.length ?? result.rows.length),
      0,
    ),
    assetOutput: {
      sampleOnly: !shouldReturnFullAssets,
      internalFullAssets: shouldReturnFullAssets,
      returned: assetSample.length,
      totalDiscovered: assets.length,
      limit: ASSET_SAMPLE_LIMIT,
    },
    pendingFilters: UNIVERSE_PENDING_FILTERS,
    warnings: [
      "Universe Engine discovery is metadata-only in this step.",
      "Public response returns only a small sample to avoid a screener-style massive asset list.",
      "Assets with OPERABLE status are rule-based candidates, not final broker-confirmed instruments.",
      "TOP 8 remains blocked until history, liquidity, spread and operability filters are fully applied.",
    ],
    assets: assetSample,
  };
}

// NOTE: No default export — universe.js is a shared library used internally
// by scan-snapshot and rally-scan. It does NOT count as a Vercel function.
// (Vercel Hobby plan limit: 12 serverless functions)
