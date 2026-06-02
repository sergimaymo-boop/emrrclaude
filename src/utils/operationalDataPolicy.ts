import type {
  AssetMarketDisplayStatus,
  DataCacheStatus,
  DataMode,
  DataProvider,
  DataQuality,
  OperationalDataStatus,
  ScoreInputIntegrity,
} from "../types";

const VALID_OPERATIONAL_DATA_QUALITY = new Set<DataQuality>(["CLEAN", "GOOD"]);
const NON_OPERATIONAL_DATA_MODES = new Set<DataMode>([
  "LAST_CLOSE",
  "ERROR",
  "DATA_UNAVAILABLE",
  "SCANNING",
  "PARTIAL_DATA",
  "LAST_SESSION",
]);
const NON_OPERATIONAL_CACHE_STATES = new Set<DataCacheStatus>(["STALE", "ERROR", "NOT_AVAILABLE"]);

export const REAL_SCORE_INPUT_INTEGRITY: ScoreInputIntegrity = {
  EMA20: "REAL",
  EMA50: "REAL",
  RS: "REAL",
  Momentum: "REAL",
  Continuity: "REAL",
  RVOL: "REAL",
  Liquidity: "REAL",
  Spread: "REAL",
  ATR: "REAL",
};

export const ERROR_SCORE_INPUT_INTEGRITY: ScoreInputIntegrity = {
  EMA20: "ERROR",
  EMA50: "ERROR",
  RS: "ERROR",
  Momentum: "ERROR",
  Continuity: "ERROR",
  RVOL: "ERROR",
  Liquidity: "ERROR",
  Spread: "ERROR",
  ATR: "ERROR",
};

interface OperationalDataPolicyInput {
  marketStatus: AssetMarketDisplayStatus;
  dataMode: DataMode;
  dataQuality?: DataQuality | string | null;
  provider?: DataProvider | string | null;
  cacheStatus?: DataCacheStatus | string | null;
  timestampUtc?: string | null;
  scoreInputIntegrity?: ScoreInputIntegrity;
}

export interface OperationalDataPolicyResult {
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: boolean;
  operationalBlockReasons: string[];
}

function hasProvider(provider: OperationalDataPolicyInput["provider"]): boolean {
  return provider === "EODHD" || provider === "Finnhub";
}

function hasTimestamp(timestampUtc: string | null | undefined): boolean {
  if (!timestampUtc) return false;
  const parsed = new Date(timestampUtc);
  return !Number.isNaN(parsed.getTime());
}

function hasRealScoreInputs(scoreInputIntegrity: ScoreInputIntegrity | undefined): boolean {
  if (!scoreInputIntegrity) return false;
  return Object.values(scoreInputIntegrity).every((status) => status === "REAL");
}

function hasValidOperationalQuality(dataQuality: OperationalDataPolicyInput["dataQuality"]): boolean {
  return VALID_OPERATIONAL_DATA_QUALITY.has(dataQuality as DataQuality);
}

function hasFreshProviderData(input: OperationalDataPolicyInput): boolean {
  return (
    input.dataMode === "REAL" &&
    hasProvider(input.provider) &&
    hasTimestamp(input.timestampUtc) &&
    !NON_OPERATIONAL_CACHE_STATES.has(input.cacheStatus as DataCacheStatus)
  );
}

export function deriveOperationalDataPolicy(input: OperationalDataPolicyInput): OperationalDataPolicyResult {
  const blockedReasons: string[] = [];
  const isOpen = input.marketStatus === "OPEN";
  const isClosed = input.marketStatus === "CLOSED" || input.marketStatus === "HOLIDAY" || input.marketStatus === "LAST";
  const hasFreshData = hasFreshProviderData(input);

  if (NON_OPERATIONAL_DATA_MODES.has(input.dataMode)) blockedReasons.push(`${input.dataMode}_DATA_NOT_OPERATIONAL`);
  if (!hasProvider(input.provider)) blockedReasons.push("REAL_PROVIDER_REQUIRED");
  if (!hasTimestamp(input.timestampUtc)) blockedReasons.push("REAL_TIMESTAMP_REQUIRED");
  if (NON_OPERATIONAL_CACHE_STATES.has(input.cacheStatus as DataCacheStatus)) blockedReasons.push("FRESH_OR_LAST_CLOSE_REQUIRED");
  if (!hasValidOperationalQuality(input.dataQuality)) blockedReasons.push("CLEAN_OR_GOOD_DATA_REQUIRED");
  if (!hasRealScoreInputs(input.scoreInputIntegrity)) blockedReasons.push("REAL_SCORE_INPUTS_REQUIRED");

  if (isOpen) {
    const operationalDecisionAllowed = hasFreshData && hasValidOperationalQuality(input.dataQuality) && hasRealScoreInputs(input.scoreInputIntegrity);
    return {
      operationalDataStatus: operationalDecisionAllowed ? "REAL" : "ERROR",
      operationalDecisionAllowed,
      operationalBlockReasons: operationalDecisionAllowed ? [] : [...new Set(blockedReasons)],
    };
  }

  if (isClosed) {
    return {
      operationalDataStatus: hasFreshData ? "LAST_CLOSE" : "DATA_UNAVAILABLE",
      operationalDecisionAllowed: false,
      operationalBlockReasons: [
        "MARKET_NOT_OPEN",
        ...(hasFreshData ? ["LAST_CLOSE_IS_NOT_LIVE"] : [...new Set(blockedReasons)]),
      ],
    };
  }

  return {
    operationalDataStatus: "ERROR",
    operationalDecisionAllowed: false,
    operationalBlockReasons: ["MARKET_STATUS_UNKNOWN", ...new Set(blockedReasons)],
  };
}
