import { PROVIDER_EXCHANGES } from "./universeEngine.js";

const PROVIDER_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 86400;
const DEFAULT_LOOKBACK_DAYS = 260;
const MAX_BARS = 260;
const PLACEHOLDER_PARTS = ["your_", "_here", "placeholder"];
const historyCache = new Map();

const APPROVED_PROVIDER_SUFFIXES = new Set(PROVIDER_EXCHANGES.map((exchange) => exchange.providerExchange));

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

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeDate(value) {
  if (typeof value !== "string") return "";
  return value.slice(0, 10);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function isApprovedHistoricalProviderSymbol(providerSymbol) {
  if (typeof providerSymbol !== "string" || !providerSymbol.trim()) return false;
  if (providerSymbol.includes(",") || providerSymbol.includes("/") || providerSymbol.includes("?")) return false;
  const parts = providerSymbol.trim().split(".");
  if (parts.length < 2) return false;
  const suffix = parts.at(-1);
  return APPROVED_PROVIDER_SUFFIXES.has(suffix);
}

function readCache(cacheKey) {
  const entry = historyCache.get(cacheKey);
  if (!entry) return null;
  const ageMs = Date.now() - entry.cachedAtMs;
  return {
    ...entry.payload,
    cacheStatus: ageMs <= CACHE_TTL_SECONDS * 1000 ? "HIT" : "STALE",
    cachedAtUtc: entry.cachedAtUtc,
    ttlSeconds: CACHE_TTL_SECONDS,
  };
}

function writeCache(cacheKey, payload) {
  const cachedAtMs = Date.now();
  const cachedAtUtc = new Date(cachedAtMs).toISOString();
  const cachePayload = {
    ...payload,
    cacheStatus: "HIT",
    cachedAtUtc,
    ttlSeconds: CACHE_TTL_SECONDS,
  };
  historyCache.set(cacheKey, { payload: cachePayload, cachedAtMs, cachedAtUtc });
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
        "user-agent": "EMRR-2.0-Tendencias/phase-6-history",
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

function normalizeHistoricalRows(rows) {
  return rows
    .map((row) => ({
      date: normalizeDate(row.date ?? row.datetime),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.adjusted_close ?? row.close),
      volume: toNumber(row.volume),
    }))
    .filter((bar) =>
      Boolean(bar.date) &&
      bar.open !== null &&
      bar.high !== null &&
      bar.low !== null &&
      bar.close !== null &&
      bar.volume !== null &&
      bar.open > 0 &&
      bar.high > 0 &&
      bar.low > 0 &&
      bar.close > 0 &&
      bar.volume >= 0 &&
      bar.high >= bar.low,
    )
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_BARS);
}

export async function fetchEodhdHistoricalBars(providerSymbol, options = {}) {
  const normalizedSymbol = typeof providerSymbol === "string" ? providerSymbol.trim().toUpperCase() : "";
  const fromDate = options.fromDate ?? dateDaysAgo(DEFAULT_LOOKBACK_DAYS);
  const cacheKey = `EODHD:${normalizedSymbol}:${fromDate}`;

  if (!isApprovedHistoricalProviderSymbol(normalizedSymbol)) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bars: [],
      blockedReason: "PROVIDER_SYMBOL_NOT_IN_APPROVED_UNIVERSE_EXCHANGES",
    };
  }

  const cached = readCache(cacheKey);
  if (cached?.cacheStatus === "HIT") return cached;

  if (!isRealApiEnabled()) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bars: [],
      blockedReason: "REAL_API_CALLS_DISABLED",
    };
  }

  const apiKey = getEnv().EODHD_API_KEY;
  if (!isConfiguredSecret(apiKey)) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bars: [],
      blockedReason: "EODHD_API_KEY_NOT_CONFIGURED",
    };
  }

  const url = `https://eodhd.com/api/eod/${encodeURIComponent(normalizedSymbol)}?api_token=${encodeURIComponent(
    apiKey,
  )}&fmt=json&period=d&from=${encodeURIComponent(fromDate)}`;
  const providerResult = await fetchJson(url);

  if (!providerResult.ok) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bars: [],
      blockedReason: "PROVIDER_HISTORY_REQUEST_FAILED",
      message: providerResult.reason,
    };
  }

  if (!Array.isArray(providerResult.data)) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bars: [],
      blockedReason: "PROVIDER_HISTORY_NOT_ARRAY",
    };
  }

  const bars = normalizeHistoricalRows(providerResult.data);
  if (bars.length === 0) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bars,
      blockedReason: "PROVIDER_HISTORY_NO_VALID_BARS",
    };
  }

  return writeCache(cacheKey, {
    ok: true,
    provider: "EODHD",
    providerSymbol: normalizedSymbol,
    bars,
    barCount: bars.length,
  });
}
