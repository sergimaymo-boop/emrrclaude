/**
 * US-market news digest — fetches general financial news from Finnhub
 * (existing FINNHUB_API_KEY) and filters to the headlines most relevant
 * to the US stock market, trimmed to short, push-friendly snippets.
 */

const FINNHUB_NEWS_URL = "https://finnhub.io/api/v1/news";
const NEWS_TIMEOUT_MS = 4000; // Reducido: el cron corre en paralelo; 4s es suficiente y evita agotar el timeout de 10s del plan Hobby
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

// Traduce un titular EN→ES vía MyMemory (gratuito, sin API key). Si falla o tarda,
// devuelve el original en inglés (fallback seguro — nunca rompe el digest).
const TRANSLATE_TIMEOUT_MS = 3500;
async function translateToSpanish(text) {
  if (typeof text !== "string" || text.trim().length === 0) return text;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return text;
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    // MyMemory devuelve a veces avisos de cuota en translatedText — filtra esos casos.
    if (typeof translated === "string" && translated.trim() && !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) {
      return translated.trim();
    }
    return text;
  } catch {
    return text;
  } finally {
    clearTimeout(timeout);
  }
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

  const selected = result.data
    .filter((item) => typeof item?.headline === "string" && typeof item?.datetime === "number")
    .filter((item) => item.datetime >= cutoffUnix)
    .filter((item) => {
      const haystack = `${item.headline} ${item.summary ?? ""}`.toLowerCase();
      return RELEVANCE_KEYWORDS.some((keyword) => haystack.includes(keyword));
    })
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, MAX_HEADLINES);

  // Traduce los titulares EN→ES en paralelo (fallback al inglés si la traducción falla).
  const headlines = await Promise.all(
    selected.map(async (item) => ({
      headline: await translateToSpanish(truncate(item.headline, 110)),
      source: typeof item.source === "string" ? item.source : null,
      url: typeof item.url === "string" ? item.url : null,
      datetimeUtc: new Date(item.datetime * 1000).toISOString(),
    })),
  );

  return { ok: true, headlines };
}
