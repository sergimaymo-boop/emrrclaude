import type { FearGreed, MasterIndicator, SystemStatus, TimestampPair, Top8Asset } from "../types";
import { createTimestampPair } from "../utils/time";

function unavailableTimestamp(): TimestampPair {
  return createTimestampPair();
}

const initialTimestamp = unavailableTimestamp();

export const unavailableUniverseStats: SystemStatus["technical"]["universeStats"] = {
  us: 0,
  europe: 0,
  total: 0,
  universeDiscovered: 0,
  universeOperable: 0,
  universeEligibleForScore: 0,
  universeRanked: 0,
  finalTop8Count: 0,
  source: "METADATA_ONLY",
  top8Source: "UNAVAILABLE",
  resultScope: "UNAVAILABLE",
  operationalDataStatus: "DATA_UNAVAILABLE",
  operationalDecisionAllowed: false,
  operationalBlockReasons: ["REAL_TOP8_NOT_AVAILABLE"],
};

export const initialSystemStatus: SystemStatus = {
  apiStatus: "OFFLINE",
  cache: "EMPTY",
  dashboardDataMode: "DATA_UNAVAILABLE",
  operationalDataStatus: "DATA_UNAVAILABLE",
  operationalDecisionAllowed: false,
  operationalBlockReasons: ["REAL_DATA_NOT_LOADED"],
  lastRealDataUpdate: null,
  technical: {
    eodhdStatus: "STANDBY",
    finnhubStatus: "STANDBY",
    cacheEntries: 0,
    apiCalls: 0,
    blockedCalls: 0,
    uptimeMinutes: 0,
    universeStats: unavailableUniverseStats,
    sampleLabel: "No substitute data",
  },
  health: "PARTIAL_DATA",
  marketHours: "CLOSED",
  marketMode: "CLOSED",
  readiness: "READY",
  lastScan: initialTimestamp,
  updatedAt: initialTimestamp,
};

export const unavailableFearGreed: FearGreed = {
  value: 0,
  state: "NEUTRAL",
  color: "WHITE_GREY",
  source: "none",
  status: "NOT_AVAILABLE",
  dataMode: "ERROR",
  provider: "none",
  affectsScore: false,
  affectsRanking: false,
  affectsExec: false,
  operationalDataStatus: "DATA_UNAVAILABLE",
  operationalDecisionAllowed: false,
  operationalBlockReasons: ["NO_APPROVED_REAL_FEAR_GREED_SOURCE"],
  timestamp: initialTimestamp,
};

const masterIndicatorDefinitions: Array<Pick<MasterIndicator, "symbol" | "name">> = [
  { symbol: "SPY", name: "S&P 500 ETF" },
  { symbol: "LQD", name: "Investment Grade Credit" },
  { symbol: "MOVE", name: "Treasury Volatility" },
  { symbol: "VIX", name: "Equity Volatility" },
  { symbol: "VVIX", name: "Volatility of Volatility" },
  { symbol: "HYG", name: "High Yield Credit" },
  { symbol: "TNX", name: "US 10Y Yield" },
];

export const unavailableMasterIndicators: MasterIndicator[] = masterIndicatorDefinitions.map((indicator) => ({
  ...indicator,
  value: "N/A",
  changePercent: 0,
  source: "none",
  dataMode: "ERROR",
  provider: "none",
  cacheStatus: "NOT_AVAILABLE",
  priceTimestamp: initialTimestamp,
  status: "NOT_AVAILABLE",
  color: "WHITE_GREY",
  operationalDataStatus: "DATA_UNAVAILABLE",
  operationalDecisionAllowed: false,
  operationalBlockReasons: ["MASTER_INDICATOR_DATA_NOT_LOADED"],
  timestamp: initialTimestamp,
}));

export const unavailableTop8: Top8Asset[] = [];
