export const OPERABILITY_PROFILE = {
  legalEntity: "SPANISH_SL",
  broker: "IBKR",
  regulatoryFramework: "PRIIPS",
};

export const OPERABILITY_STATUSES = ["OPERABLE", "NOT_OPERABLE", "UNKNOWN"];

export const EXCLUDED_INSTRUMENT_KEYWORDS = [
  "ETF",
  "ETN",
  "WARRANT",
  "RIGHT",
  "RIGHTS",
  "PREFERRED",
  "PREFERENCE",
  "PREF ",
  "UNIT",
  "UNITS",
  "SPAC",
  "ACQUISITION CORP",
  "ACQUISITION COMPANY",
  "FUND",
  "TRUST",
  "BOND",
  "NOTE",
  "CERTIFICATE",
  "OPTION",
  "FUTURE",
  "CFD",
  "CRYPTO",
];

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

export function classifyOperabilityFromMetadata(row) {
  const code = firstString(row.Code, row.code, row.Symbol, row.symbol);
  const name = firstString(row.Name, row.name);
  const type = firstString(row.Type, row.type);
  const exchange = firstString(row.Exchange, row.exchange);
  const currency = firstString(row.Currency, row.currency);
  const isin = firstString(row.Isin, row.ISIN, row.isin);
  const combined = upper(`${code} ${name} ${type}`);

  if (!code || !name || !currency) {
    return {
      status: "UNKNOWN",
      reasons: ["MISSING_REQUIRED_METADATA"],
      code,
      name,
      type,
      exchange,
      currency,
      isin,
    };
  }

  const excludedKeyword = EXCLUDED_INSTRUMENT_KEYWORDS.find((keyword) => combined.includes(keyword));
  if (excludedKeyword) {
    return {
      status: "NOT_OPERABLE",
      reasons: [`EXCLUDED_INSTRUMENT_${excludedKeyword.replaceAll(" ", "_")}`],
      code,
      name,
      type,
      exchange,
      currency,
      isin,
    };
  }

  const normalizedType = upper(type);
  const looksLikeCommonStock =
    normalizedType === "" ||
    normalizedType.includes("COMMON") ||
    normalizedType.includes("STOCK") ||
    normalizedType.includes("EQUITY") ||
    normalizedType.includes("SHARE");

  if (!looksLikeCommonStock) {
    return {
      status: "UNKNOWN",
      reasons: ["INSTRUMENT_TYPE_NOT_CONFIRMED_AS_COMMON_STOCK"],
      code,
      name,
      type,
      exchange,
      currency,
      isin,
    };
  }

  return {
    status: "OPERABLE",
    reasons: ["COMMON_STOCK_METADATA_RULE", "IBKR_PRIIPS_NOT_CONFIRMED_YET"],
    code,
    name,
    type,
    exchange,
    currency,
    isin,
  };
}

export function getExecutionBlocksForOperability(operabilityStatus) {
  if (operabilityStatus === "OPERABLE") return [];
  if (operabilityStatus === "NOT_OPERABLE") return ["NOT_OPERABLE_FOR_SPANISH_SL_IBKR_PRIIPS"];
  return ["OPERABILITY_UNKNOWN_CANNOT_EXEC"];
}
