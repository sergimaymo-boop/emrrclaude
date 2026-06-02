import { calculateSpreadPercent } from "./spreadDataProvider.js";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export const SPREAD_VERIFICATION_STATUS = Object.freeze({
  DIAGNOSTIC_ONLY: "SPREAD_VERIFICATION_DIAGNOSTIC_ONLY",
  NOT_VERIFIED: "SPREAD_NOT_VERIFIED",
  BLOCKS_EXEC: "SPREAD_BLOCKS_EXEC",
});

export const SPREAD_VERIFICATION_POLICY = Object.freeze({
  version: "PHASE_11_7_SPREAD_VERIFICATION_POLICY_V1",
  spreadVerificationMode: "PUNCTUAL_MANUAL_BID_ASK_DESIGN_ONLY",
  verificationResultScope: "DIAGNOSTIC_ONLY",
  requiresRealBidAsk: true,
  execAllowed: false,
  globalTop8Allowed: false,
  allowedProviderChecks: "EXISTING_CONFIGURED_SOURCES_ONLY",
  configurationChangeAllowed: false,
  persistenceAllowed: false,
  newProviderAllowed: false,
  proxySpreadAllowed: false,
  mockDataAllowed: false,
});

export function getSpreadVerificationPolicy() {
  return { ...SPREAD_VERIFICATION_POLICY };
}

function buildBaseResult() {
  return {
    ...getSpreadVerificationPolicy(),
    diagnosticOnly: true,
    execAllowed: false,
    globalTop8Allowed: false,
    provider: null,
    providerSymbol: null,
    bid: null,
    ask: null,
    spreadPercent: null,
    blockedReasons: [],
    warnings: [
      "Phase 11.7 verifies bid/ask only as diagnostics; it does not authorize EXEC or global TOP 8.",
    ],
  };
}

export function evaluateBidAskSpreadVerification({
  bid = null,
  ask = null,
  provider = null,
  providerSymbol = null,
  timestampUtc = null,
  dataContext = null,
  isMock = false,
  isProxySpread = false,
  substituteUsed = false,
} = {}) {
  const result = buildBaseResult();
  const bidPrice = toNumber(bid);
  const askPrice = toNumber(ask);
  const blockedReasons = [];

  if (!hasText(provider)) blockedReasons.push("PROVIDER_REQUIRED");
  if (!hasText(providerSymbol)) blockedReasons.push("PROVIDER_SYMBOL_REQUIRED");
  if (!hasText(timestampUtc) && !hasText(dataContext)) blockedReasons.push("DATA_CONTEXT_REQUIRED");
  if (isMock === true) blockedReasons.push("MOCK_DATA_NOT_ALLOWED");
  if (isProxySpread === true) blockedReasons.push("SPREAD_PROXY_NOT_ALLOWED");
  if (substituteUsed === true) blockedReasons.push("SUBSTITUTE_DATA_NOT_ALLOWED_FOR_VERIFICATION");
  if (!isFiniteNumber(bidPrice)) blockedReasons.push("BID_REQUIRED");
  if (!isFiniteNumber(askPrice)) blockedReasons.push("ASK_REQUIRED");
  if (isFiniteNumber(bidPrice) && bidPrice <= 0) blockedReasons.push("BID_MUST_BE_POSITIVE");
  if (isFiniteNumber(askPrice) && isFiniteNumber(bidPrice) && askPrice <= bidPrice) {
    blockedReasons.push("ASK_MUST_BE_GREATER_THAN_BID");
  }

  if (blockedReasons.length > 0) {
    return {
      ...result,
      verificationStatus: SPREAD_VERIFICATION_STATUS.NOT_VERIFIED,
      executionPolicy: SPREAD_VERIFICATION_STATUS.BLOCKS_EXEC,
      provider: hasText(provider) ? provider.trim() : null,
      providerSymbol: hasText(providerSymbol) ? providerSymbol.trim() : null,
      bid: bidPrice,
      ask: askPrice,
      blockedReasons,
    };
  }

  return {
    ...result,
    verificationStatus: SPREAD_VERIFICATION_STATUS.DIAGNOSTIC_ONLY,
    executionPolicy: SPREAD_VERIFICATION_STATUS.BLOCKS_EXEC,
    provider: provider.trim(),
    providerSymbol: providerSymbol.trim(),
    bid: bidPrice,
    ask: askPrice,
    spreadPercent: calculateSpreadPercent({ bid: bidPrice, ask: askPrice }),
    blockedReasons,
  };
}
