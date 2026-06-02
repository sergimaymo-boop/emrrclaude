import { EXCLUDED_INSTRUMENT_KEYWORDS, classifyOperabilityFromMetadata } from "./operabilityEngine.js";

export const UNIVERSE_MODE = "DYNAMIC_UNIVERSE_METADATA_DISCOVERY";

export const PROVIDER_EXCHANGES = [
  { region: "USA", market: "Nasdaq/NYSE", providerExchange: "US", allowedExchanges: ["NASDAQ", "NYSE"] },
  { region: "Europe", market: "Xetra", providerExchange: "XETRA", allowedExchanges: ["XETRA"] },
  { region: "Europe", market: "Euronext Amsterdam", providerExchange: "AS", allowedExchanges: ["EURONEXT", "AMSTERDAM"] },
  { region: "Europe", market: "Euronext Paris", providerExchange: "PA", allowedExchanges: ["EURONEXT", "PARIS"] },
  { region: "Europe", market: "Euronext Brussels", providerExchange: "BR", allowedExchanges: ["EURONEXT", "BRUSSELS"] },
  { region: "Europe", market: "Euronext Lisbon", providerExchange: "LS", allowedExchanges: ["EURONEXT", "LISBON"] },
  { region: "Europe", market: "Borsa Italiana", providerExchange: "MI", allowedExchanges: ["BORSA ITALIANA", "MILAN", "ITALY"] },
  { region: "Europe", market: "SIX", providerExchange: "SW", allowedExchanges: ["SIX", "SWISS"] },
  { region: "Europe", market: "LSE", providerExchange: "LSE", allowedExchanges: ["LSE", "LONDON"] },
];

export const UNIVERSE_PENDING_FILTERS = [
  "HISTORY_SUFFICIENCY",
  "LIQUIDITY",
  "SPREAD",
  "IBKR_PERMISSION_CONFIRMATION",
];

const ALLOWED_UNIVERSE_TYPES = new Set(["COMMON STOCK"]);
const EXCLUDED_TICKER_SUFFIXES = ["-W", "-R", "WT", ".WS", "-P", "-WT"];

const EXCHANGE_ALIASES = {
  NASDAQ: "NASDAQ",
  NAS: "NASDAQ",
  NYSE: "NYSE",
  XETRA: "XETRA",
  ETR: "XETRA",
  EURONEXT: "EURONEXT",
  EPA: "EURONEXT",
  PARIS: "EURONEXT",
  AMS: "EURONEXT",
  AMSTERDAM: "EURONEXT",
  EBR: "EURONEXT",
  BRUSSELS: "EURONEXT",
  LSE: "LSE",
  LONDON: "LSE",
  BIT: "BORSA_ITALIANA",
  MIL: "BORSA_ITALIANA",
  MILAN: "BORSA_ITALIANA",
  SIX: "SIX",
  VTX: "SIX",
  SWISS: "SIX",
};

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function upper(value) {
  return normalizeText(value).toUpperCase();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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

function normalizeProviderExchange(row, exchangeConfig) {
  const explicit = upper(firstString(row.Exchange, row.exchange, row.ExchangeCode, row.exchangeCode));
  const providerExchange = upper(exchangeConfig.providerExchange);
  const market = upper(exchangeConfig.market);
  const text = explicit || providerExchange || market;

  if (text.includes("NASDAQ")) return "NASDAQ";
  if (text.includes("NYSE")) return "NYSE";
  if (text.includes("XETRA") || text === "ETR") return "XETRA";
  if (text.includes("EURONEXT") || ["AS", "PA", "BR", "LS", "EPA", "AMS", "EBR"].includes(text)) return "EURONEXT";
  if (text.includes("LSE") || text.includes("LONDON")) return "LSE";
  if (text.includes("MILAN") || text.includes("ITAL") || ["BIT", "MIL", "MI"].includes(text)) return "BORSA_ITALIANA";
  if (text.includes("SIX") || text.includes("SWISS") || ["VTX", "SW"].includes(text)) return "SIX";
  return EXCHANGE_ALIASES[text] ?? text;
}

function hasAllowedExchange(row, exchangeConfig) {
  const normalized = normalizeProviderExchange(row, exchangeConfig);
  if (exchangeConfig.providerExchange === "US") return ["NASDAQ", "NYSE"].includes(normalized);
  return ["XETRA", "EURONEXT", "LSE", "BORSA_ITALIANA", "SIX"].includes(normalized);
}

function isDelistedOrInactive(row) {
  const status = upper(firstString(row.Status, row.status));
  const delisted = row.isDelisted ?? row.IsDelisted ?? row.Delisted ?? row.delisted;
  if (delisted === true) return true;
  if (typeof delisted === "string" && ["TRUE", "1", "YES"].includes(upper(delisted))) return true;
  return Boolean(status) && !["ACTIVE", "LISTED", "TRADING"].includes(status);
}

export function isEligibleForUniverse(row, exchangeConfig) {
  const type = upper(firstString(row.Type, row.type));
  const ticker = firstString(row.Code, row.code, row.Symbol, row.symbol);
  if (!ALLOWED_UNIVERSE_TYPES.has(type)) return false;
  if (!hasAllowedExchange(row, exchangeConfig)) return false;
  if (isDelistedOrInactive(row)) return false;
  if (EXCLUDED_TICKER_SUFFIXES.some((suffix) => upper(ticker).endsWith(suffix))) return false;
  return true;
}

export function inferCanonicalExchange(exchangeConfig, providerExchangeName) {
  const text = upper(providerExchangeName);
  if (text.includes("NASDAQ")) return "NASDAQ";
  if (text.includes("NYSE")) return "NYSE";
  if (text.includes("XETRA")) return "XETRA";
  if (text.includes("MILAN") || text.includes("ITAL")) return "BORSA_ITALIANA";
  if (text.includes("SIX") || text.includes("SWISS")) return "SIX";
  if (text.includes("LONDON") || text.includes("LSE")) return "LSE";
  if (text.includes("EURONEXT") || ["AS", "PA", "BR", "LS"].includes(exchangeConfig.providerExchange)) {
    return "EURONEXT";
  }
  if (exchangeConfig.providerExchange === "US") return "USA_SUPPORTED";
  return exchangeConfig.market.toUpperCase().replaceAll(" ", "_");
}

export function mapUniverseAsset(row, exchangeConfig) {
  const instrument = classifyOperabilityFromMetadata(row);
  const providerSymbol = `${instrument.code}.${exchangeConfig.providerExchange}`;
  const canonicalExchange = inferCanonicalExchange(exchangeConfig, normalizeProviderExchange(row, exchangeConfig));

  return {
    canonicalId: `${canonicalExchange}:${instrument.code}:${instrument.currency || "UNKNOWN"}`,
    ticker: instrument.code,
    providerSymbol,
    name: instrument.name,
    region: exchangeConfig.region,
    market: exchangeConfig.market,
    providerExchange: exchangeConfig.providerExchange,
    exchange: canonicalExchange,
    currency: instrument.currency || null,
    isin: instrument.isin || null,
    instrumentType: instrument.type || "UNKNOWN",
    marketCapitalization: firstNumber(row.MarketCapitalization, row.MarketCap, row.marketCapitalization, row.marketCap),
    averageVolume: firstNumber(row.AverageVolume, row.AvgVolume, row.averageVolume, row.avgVolume),
    operabilityStatus: instrument.status,
    operabilityReasons: instrument.reasons,
  };
}

export function dedupeUniverseAssets(assets) {
  const byKey = new Map();
  for (const asset of assets) {
    const key = asset.isin || `${asset.providerSymbol}:${asset.currency}`;
    if (!byKey.has(key)) byKey.set(key, asset);
  }
  return [...byKey.values()];
}

export function summarizeUniverseAssets(assets, exchangeResults) {
  return {
    totalDiscovered: assets.length,
    operable: assets.filter((asset) => asset.operabilityStatus === "OPERABLE").length,
    notOperable: assets.filter((asset) => asset.operabilityStatus === "NOT_OPERABLE").length,
    unknown: assets.filter((asset) => asset.operabilityStatus === "UNKNOWN").length,
    exchangesRequested: exchangeResults.length,
    exchangesOk: exchangeResults.filter((result) => result.ok).length,
    exchangesFailed: exchangeResults.filter((result) => !result.ok).length,
  };
}

export function getExcludedInstrumentLabels() {
  return EXCLUDED_INSTRUMENT_KEYWORDS.map((keyword) => keyword.trim()).filter(Boolean);
}
