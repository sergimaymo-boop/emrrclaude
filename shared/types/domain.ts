export type MarketHoursStatus = "OPEN" | "CLOSED" | "HOLIDAY" | "STALE";

export type AssetMarketDisplayStatus = MarketHoursStatus | "LAST";

export type DataMode = "REAL" | "LAST_CLOSE" | "ERROR" | "DATA_UNAVAILABLE" | "SCANNING" | "PARTIAL_DATA" | "LAST_SESSION";

// Refleja los proveedores REALES de la cascada de cotización (api/_lib/providerCascade.js):
// Finnhub → Yahoo → Stooq → FMP → TwelveData, más FRED (macro) y EODHD (histórico controlado).
// Mantener sincronizado con los literales `provider:` que devuelve la cascada.
export type DataProvider =
  | "EODHD"
  | "Finnhub"
  | "Yahoo"
  | "Stooq"
  | "FMP"
  | "TwelveData"
  | "FRED"
  | "none";

export type DataCacheStatus = "BYPASS" | "MISS" | "HIT" | "STALE" | "ERROR" | "NOT_AVAILABLE";

export type OperationalDataStatus = "REAL" | "LAST_CLOSE" | "ERROR" | "DATA_UNAVAILABLE";

export type ScoreInputIntegrityStatus = "REAL" | "ERROR";

export interface ScoreInputIntegrity {
  EMA20: ScoreInputIntegrityStatus;
  EMA50: ScoreInputIntegrityStatus;
  RS: ScoreInputIntegrityStatus;
  Momentum: ScoreInputIntegrityStatus;
  Continuity: ScoreInputIntegrityStatus;
  RVOL: ScoreInputIntegrityStatus;
  Liquidity: ScoreInputIntegrityStatus;
  Spread: ScoreInputIntegrityStatus;
  ATR: ScoreInputIntegrityStatus;
}

export type Top8Source = "DYNAMIC" | "PARTIAL" | "UNAVAILABLE";

export type Top8ResultScope = "GLOBAL" | "GLOBAL_TOP8_FINAL" | "PARTIAL_BATCH_ONLY" | "UNAVAILABLE";

export type DataQuality =
  | "CLEAN"
  | "GOOD"
  | "WARNING"
  | "STALE"
  | "INVALID"
  | "NOT_AVAILABLE"
  | "NOT_CONFIGURED";

export type ActionStatus =
  | "EXEC"
  | "WATCH"
  | "HOLD"
  | "STANDBY"
  | "EXTENDED"
  | "BLOCKED"
  | "CLOSED_CONTEXT";

export type HealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "PARTIAL_DATA"
  | "MARKET_CLOSED"
  | "ERROR";

export type ColorToken =
  | "GREEN_HARD"
  | "GREEN_SOFT"
  | "YELLOW"
  | "ORANGE"
  | "RED"
  | "DARK_GREY"
  | "WHITE_GREY";

export type MasterIndicatorStatus = "LIVE" | "LAST" | "CLOSED" | "CACHE" | "NOT_AVAILABLE";

export type FearGreedState =
  | "EXTREME FEAR"
  | "FEAR"
  | "NEUTRAL"
  | "GREED"
  | "EXTREME GREED";

export type SectorState = "LEADING" | "ACCELERATING" | "WEAKENING" | "FALLING";

export interface TimestampPair {
  utc: string;
  local: string;
}

export interface UniverseStats {
  us: number;
  europe: number;
  total: number;
  universeDiscovered: number;
  universeOperable: number;
  universeEligibleForScore: number;
  universeRanked: number;
  finalTop8Count: number;
  source: "METADATA_ONLY" | "PARTIAL" | "REAL" | "DATA_UNAVAILABLE";
  top8Source: Top8Source;
  resultScope: Top8ResultScope;
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: boolean;
  operationalBlockReasons: string[];
  scanId?: string | null;
  universeHash?: string | null;
  activeMarkets?: string[];
  activeUniverseCounts?: {
    us: number;
    europe: number;
  };
  batchesTotal?: number;
  batchesCompleted?: number;
  nextBatchIndex?: number | null;
  coveragePercent?: number;
  candidatesAnalysed?: number;
  estimatedProviderCalls?: number;
  actualProviderCalls?: number;
  dataIntegrityScore?: number | null;
  costPolicy?: Record<string, unknown> | null;
  recommendedNextAction?: string | null;
}

export interface SystemStatus {
  apiStatus: "REAL_READY" | "OFFLINE" | "ERROR";
  cache: "REAL_CACHE" | "EMPTY" | "ERROR";
  dashboardDataMode: DataMode;
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: boolean;
  operationalBlockReasons: string[];
  lastRealDataUpdate: TimestampPair | null;
  technical: {
    eodhdStatus: "STANDBY" | "OFFLINE";
    finnhubStatus: "STANDBY" | "OFFLINE";
    cacheEntries: number;
    apiCalls: number;
    blockedCalls: number;
    uptimeMinutes: number;
    universeStats: UniverseStats;
    sampleLabel: string;
  };
  health: HealthStatus;
  marketHours: MarketHoursStatus;
  marketMode: "EU_OPEN" | "US_OPEN" | "BOTH_OPEN" | "CLOSED" | "STALE";
  readiness: "READY";
  lastScan: TimestampPair;
  updatedAt: TimestampPair;
}

export interface FearGreed {
  value: number;
  state: FearGreedState;
  color: ColorToken;
  source: "none" | "CNN";
  status: "NOT_AVAILABLE" | "REAL";
  dataMode: DataMode;
  provider: DataProvider;
  affectsScore: false;
  affectsRanking: false;
  affectsExec: false;
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: false;
  operationalBlockReasons: string[];
  timestamp: TimestampPair;
}

export interface MasterIndicator {
  symbol: "SPY" | "LQD" | "MOVE" | "VIX" | "VVIX" | "HYG" | "TNX";
  name: string;
  value: string;
  changePercent: number;
  source: DataProvider;
  dataMode: DataMode;
  provider: DataProvider;
  cacheStatus: DataCacheStatus;
  priceTimestamp: TimestampPair;
  status: MasterIndicatorStatus;
  color: ColorToken;
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: false;
  operationalBlockReasons: string[];
  timestamp: TimestampPair;
}

export interface SectorLeader {
  sector: string;
  performance: number;
  state: SectorState;
  color: ColorToken;
  dataMode: DataMode;
  source: "real" | "none";
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: false;
  operationalBlockReasons: string[];
}

export interface Top8Asset {
  rank: number;
  ticker: string;
  name: string;
  market: string;
  marketStatus: AssetMarketDisplayStatus;
  price: string;
  priceChangePercent: number;
  dataMode: DataMode;
  priceDataMode: DataMode;
  provider: DataProvider;
  providerSymbol: string;
  currency: "USD" | "EUR" | "GBX";
  previousClose: string | null;
  cacheStatus: DataCacheStatus;
  priceTimestamp: TimestampPair;
  top8Source: Top8Source;
  resultScope: Top8ResultScope;
  operationalDataStatus: OperationalDataStatus;
  operationalDecisionAllowed: boolean;
  operationalBlockReasons: string[];
  scoreInputIntegrity: ScoreInputIntegrity;
  execDisabledReason?: string;
  score: number;
  conviction: number;
  ema20: string;
  ema50: string;
  slope: string;
  rs: string;
  rvol: string;
  atr: string;
  atrPercent: string;
  momentum: string;
  trend: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  trailingAdjusted: string;
  trailingMedium: string;
  trailingWide: string;
  action: ActionStatus;
  dataQuality: DataQuality;
  timestamp: TimestampPair;
  scanId?: string;
  scanStartedAtUtc?: string;
  scanCompletedAtUtc?: string | null;
  providerTimestamp?: string | null;
  staleReason?: string | null;
}

export interface ScanState {
  label: string;
  isScanning: boolean;
  lastRun: TimestampPair;
  lastRealDataUpdate: TimestampPair | null;
  lastScanClicked: TimestampPair;
  scanExecutionMode: "REAL_QUOTES_REFRESH" | "SCAN_SNAPSHOT" | "PARTIAL_BATCH_ONLY" | "GLOBAL_TOP8_FINAL" | "NO_REAL_DATA" | "ERROR";
  refreshedCount: number;
  scanId?: string | null;
  snapshotToken?: string | null;
  status?: string;
  resultScope?: Top8ResultScope | "DATA_UNAVAILABLE";
  coveragePercent?: number;
  batchesTotal?: number;
  batchesCompleted?: number;
  nextBatchIndex?: number | null;
  estimatedProviderCalls?: number;
  actualProviderCalls?: number;
  candidatesAnalysed?: number;
  recommendedNextAction?: string | null;
}
