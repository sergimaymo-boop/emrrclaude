/**
 * US-market news digest — fetches general financial news from Finnhub
 * (existing FINNHUB_API_KEY) and filters to the headlines most relevant
 * to the US stock market, trimmed to short, push-friendly snippets.
 */

const FINNHUB_NEWS_URL = "https://finnhub.io/api/v1/news";
const NEWS_TIMEOUT_MS = 8000;
const MAX_HEADLINES = 5;
const MAX_AGE_HOURS = 20;

const RELEVANCE_KEYWORDS = [
  "stock", "stocks", "market", "markets", "s&p", "nasdaq", "dow jones", "dow",
  "fed ", "federal reserve", "rate cut", "rate hike", "interest rate", "inflation",
  "earnings", "treasury", "yield", "wall street", "tariff", "tariffs",
  "economy", "economic", "jobs report", "unemployment", "gdp", "recession", "powell",
];

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, reason: "request failed or timed out" };
  } finally {
    clearTimeout(timeout);
  }
}

function truncate(text, maxLen) {
  if (typeof text !== "string") return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1).trimEnd()}…` : trimmed;
}

export async function fetchUsMarketNewsDigest(env = {}) {
  const apiKey = env.FINNHUB_API_KEY;
  if (!apiKey) return { ok: false, reason: "FINNHUB_API_KEY not configured", headlines: [] };

  const url = `${FINNHUB_NEWS_URL}?category=general&token=${encodeURIComponent(apiKey)}`;
  const result = await fetchJson(url, NEWS_TIMEOUT_MS);

  if (!result.ok || !Array.isArray(result.data)) {
    return { ok: false, reason: result.reason ?? "invalid payload", headlines: [] };
  }

  const cutoffUnix = Math.floor(Date.now() / 1000) - MAX_AGE_HOURS * 3600;

  const headlines = result.data
    .filter((item) => typeof item?.headline === "string" && typeof item?.datetime === "number")
    .filter((item) => item.datetime >= cutoffUnix)
    .filter((item) => {
      const haystack = `${item.headline} ${item.summary ?? ""}`.toLowerCase();
      return RELEVANCE_KEYWORDS.some((keyword) => haystack.includes(keyword));
    })
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, MAX_HEADLINES)
    .map((item) => ({
      headline: truncate(item.headline, 110),
      source: typeof item.source === "string" ? item.source : null,
      url: typeof item.url === "string" ? item.url : null,
      datetimeUtc: new Date(item.datetime * 1000).toISOString(),
    }));

  return { ok: true, headlines };
}
