import { isApprovedHistoricalProviderSymbol } from "./historicalDataProvider.js";

const PROVIDER_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 60;
const PLACEHOLDER_PARTS = ["your_", "_here", "placeholder"];
const spreadCache = new Map();

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

function firstNumber(...values) {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readCache(cacheKey) {
  const entry = spreadCache.get(cacheKey);
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
  spreadCache.set(cacheKey, { payload: cachePayload, cachedAtMs, cachedAtUtc });
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
        "user-agent": "EMRR-2.0-Tendencias/phase-6-spread",
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

export function calculateSpreadPercent({ bid, ask, mid = null, last = null }) {
  const bidPrice = toNumber(bid);
  const askPrice = toNumber(ask);
  const midPrice = toNumber(mid) ?? toNumber(last) ?? (bidPrice !== null && askPrice !== null ? (bidPrice + askPrice) / 2 : null);

  if (bidPrice === null || askPrice === null || midPrice === null) return null;
  if (bidPrice <= 0 || askPrice <= 0 || midPrice <= 0 || askPrice < bidPrice) return null;

  const spreadPercent = ((askPrice - bidPrice) / midPrice) * 100;
  return Math.round(spreadPercent * 10_000) / 10_000;
}

function parseSpreadPayload(data) {
  const bid = firstNumber(data.bid, data.bidPrice, data.b, data.bestBid);
  const ask = firstNumber(data.ask, data.askPrice, data.a, data.bestAsk);
  const last = firstNumber(data.close, data.price, data.last, data.c);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : last;
  const spreadPercent = calculateSpreadPercent({ bid, ask, mid, last });

  if (spreadPercent === null) {
    return {
      ok: false,
      blockedReason: "SPREAD_NOT_AVAILABLE",
      bid,
      ask,
      last,
      spreadPercent: null,
    };
  }

  return {
    ok: true,
    blockedReason: null,
    bid,
    ask,
    last,
    spreadPercent,
  };
}

export async function fetchEodhdSpread(providerSymbol) {
  const normalizedSymbol = typeof providerSymbol === "string" ? providerSymbol.trim().toUpperCase() : "";
  const cacheKey = `EODHD_SPREAD:${normalizedSymbol}`;

  if (!isApprovedHistoricalProviderSymbol(normalizedSymbol)) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      spreadPercent: null,
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
      spreadPercent: null,
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
      spreadPercent: null,
      blockedReason: "EODHD_API_KEY_NOT_CONFIGURED",
    };
  }

  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(normalizedSymbol)}?api_token=${encodeURIComponent(
    apiKey,
  )}&fmt=json`;
  const providerResult = await fetchJson(url);

  if (!providerResult.ok) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      spreadPercent: null,
      blockedReason: "PROVIDER_SPREAD_REQUEST_FAILED",
      message: providerResult.reason,
    };
  }

  const parsed = parseSpreadPayload(providerResult.data);
  if (!parsed.ok) {
    return {
      ok: false,
      provider: "EODHD",
      providerSymbol: normalizedSymbol,
      cacheStatus: "BYPASS",
      cachedAtUtc: null,
      ttlSeconds: CACHE_TTL_SECONDS,
      bid: parsed.bid,
      ask: parsed.ask,
      last: parsed.last,
      spreadPercent: null,
      blockedReason: parsed.blockedReason,
    };
  }

  return writeCache(cacheKey, {
    ok: true,
    provider: "EODHD",
    providerSymbol: normalizedSymbol,
    bid: parsed.bid,
    ask: parsed.ask,
    last: parsed.last,
    spreadPercent: parsed.spreadPercent,
  });
}
