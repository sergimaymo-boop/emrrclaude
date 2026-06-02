export type ApiProviderName = "EODHD" | "Finnhub";

export type ApiProviderPublicState = "configured" | "not_configured";

export type ApiMode = "REAL_API_DISABLED" | "CONTROLLED_REAL_DATA";

export type ApiCacheStatus = "HIT" | "MISS" | "BYPASS" | "STALE";

export type ApiDataQuality =
  | "CLEAN"
  | "GOOD"
  | "WARNING"
  | "STALE"
  | "INVALID"
  | "NOT_CONFIGURED"
  | "NOT_AVAILABLE";

export type ApiMasterIndicatorDiagnosticStatus = "TNX_PROVIDER_VALID" | "TNX_PROVIDER_UNRESOLVED";

export interface ApiProviderHealth {
  eodhd: ApiProviderPublicState;
  finnhub: ApiProviderPublicState;
}

export interface ApiHealthResponse {
  ok: true;
  app: "EMRR 2.0 / Tendencias";
  phase: "3" | "4" | "5" | "6";
  environment: string;
  timestampUtc: string;
  realApiCallsEnabled: boolean;
  providers: ApiProviderHealth;
  cache?: {
    strategy: "EPHEMERAL_MEMORY";
    ttlSeconds: number;
    persistence: "VERCEL_RUNTIME_ONLY";
  };
  phase6Readiness?: {
    universeEngineSpec: "registered";
    operabilityEngineSpec: "registered";
    scoreEngineSpec: "registered";
    automaticUniverseEngine: "not_implemented" | "metadata_discovery_active" | "implemented";
    operabilityEngine?: "not_implemented" | "metadata_rule_classification_active" | "implemented";
    historicalDataProvider?: "not_implemented" | "controlled_internal_active" | "implemented";
    spreadDataProvider?: "not_implemented" | "controlled_internal_active" | "implemented";
    technicalEngine?: "not_implemented" | "pure_engine_active" | "implemented";
    eligibilityEngine?: "not_implemented" | "pure_engine_active" | "implemented";
    scoreEngine?: "not_implemented" | "pure_engine_active" | "implemented";
    candidateEvaluationEngine?: "not_implemented" | "pure_engine_active" | "implemented";
    top8Endpoint: "blocked_until_dynamic_universe" | "cost_gate_active" | "active";
    top8BatchEndpoint?: "manual_dry_run_active" | "active";
  };
  message?: string;
}

export interface ApiProvidersStatusResponse {
  primaryProvider: "EODHD";
  secondaryProviderConfiguredOnly: "Finnhub";
  providerSubstitutionAllowed: false;
  phase?: "3" | "4" | "5" | "6";
  realApiCallsEnabled: boolean;
  apiCalls: 0;
  blockedCalls: number;
  mode: ApiMode;
  universeMode?: ApiTop8UniverseMode;
  includedMarkets?: {
    usa: string[];
    europe: string[];
  };
  universeEndpoint?: "metadata_discovery_active" | "inactive";
  historicalDataProvider?: "controlled_internal_active" | "inactive";
  spreadDataProvider?: "controlled_internal_active" | "inactive";
  technicalEngine?: "pure_engine_active" | "inactive";
  eligibilityEngine?: "pure_engine_active" | "inactive";
  scoreEngine?: "pure_engine_active" | "inactive";
  candidateEvaluationEngine?: "pure_engine_active" | "inactive";
  top8Endpoint?: "blocked_until_dynamic_universe" | "cost_gate_active" | "active";
  top8BatchEndpoint?: "manual_dry_run_active" | "active";
  providers?: ApiProviderHealth;
  costControls?: {
    quoteMaxSymbolsPerRequest: 1;
    masterIndicatorsMaxSymbols: 7;
    universeExchangeListMaxRequests?: 9;
    historicalProviderCallsPerCandidate?: 1;
    spreadProviderCallsPerCandidate?: 1;
    top8MaxCandidatesPerRun?: 100;
    top8MaxOutputAssets?: 8;
    polling: false;
    autoRefresh: false;
    backgroundJobs: false;
    aggressiveRetries: false;
    cacheStrategy?: "EPHEMERAL_MEMORY";
    cacheTtlSeconds?: number;
  };
  message: string;
}

export type ApiTop8UniverseMode = "DYNAMIC_UNIVERSE_REQUIRED" | "DYNAMIC_UNIVERSE";
export type ApiOperabilityStatus = "OPERABLE" | "NOT_OPERABLE" | "UNKNOWN";
export type ApiTop8ActionStatus = "WATCH" | "HOLD" | "STANDBY" | "BLOCKED" | "CLOSED_CONTEXT";
export type ApiTop8Risk = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export interface ApiTop8Trailing {
  trailing_adjusted: number | null;
  trailing_medium: number | null;
  trailing_wide: number | null;
}

export interface ApiTop8Technicals {
  ema20: number | null;
  ema50: number | null;
  ema20SlopePercent: number | null;
  atr: number | null;
  atrPercent: number | null;
  rvol: number | null;
  momentum5: number | null;
  momentum20: number | null;
  rs20: number | null;
  rs60: number | null;
  avgVolume20: number | null;
  avgValue20: number | null;
  maxDrawdown20: number | null;
  lastDate: string;
}

export interface ApiTop8Asset {
  rank?: number;
  ticker: string;
  providerSymbol: string;
  name: string;
  market: "USA" | "Europe";
  exchange: string;
  currency: string;
  price: number | null;
  changePercent: number | null;
  dataQuality: ApiDataQuality;
  marketStatus: "OPEN" | "CLOSED";
  technicals: ApiTop8Technicals | null;
  score: number | null;
  scoreBreakdown: Record<string, unknown> | null;
  conviction: number | null;
  risk: ApiTop8Risk;
  action: ApiTop8ActionStatus;
  trailing: ApiTop8Trailing;
  timestampUtc: string;
  providerUsed: ApiProviderName | "none";
  blockedReasons: string[];
  executionBlockedReasons: string[];
  warnings: string[];
}

export interface ApiTop8Response {
  ok: boolean;
  app: "EMRR 2.0 / Tendencias";
  phase: "6";
  mode: ApiMode;
  realApiCallsEnabled?: boolean;
  timestampUtc?: string;
  universeMode: ApiTop8UniverseMode;
  universeSize?: number;
  maxOutputAssets?: 8;
  cacheStatus?: ApiCacheStatus;
  cachedAtUtc?: string | null;
  ttlSeconds?: number;
  providerSummary?: Record<string, unknown>;
  universeSummary?: Record<string, number>;
  evaluationSummary?: Record<string, number>;
  costGate?: Record<string, unknown>;
  batchPlan?: Record<string, unknown> | null;
  providerCallsPlanned?: number;
  warnings?: string[];
  blockedReasons?: string[];
  analyzedAssets?: ApiTop8Asset[];
  assets: ApiTop8Asset[];
  error?:
    | "UNIVERSE_ENGINE_NOT_IMPLEMENTED"
    | "UNIVERSE_ELIGIBILITY_NOT_COMPLETE"
    | "UNIVERSE_DISCOVERY_NOT_READY"
    | "COST_GATE_REQUIRES_BATCHING_STRATEGY"
    | "NO_ELIGIBLE_ASSETS_AFTER_VALIDATION";
  message?: string;
}

export interface ApiUniverseAsset {
  canonicalId: string;
  ticker: string;
  providerSymbol: string;
  name: string;
  region: "USA" | "Europe";
  market: string;
  providerExchange: string;
  exchange: string;
  currency: string | null;
  isin: string | null;
  instrumentType: string;
  operabilityStatus: ApiOperabilityStatus;
  operabilityReasons: string[];
}

export interface ApiUniverseResponse {
  ok: boolean;
  app: "EMRR 2.0 / Tendencias";
  phase: "6";
  mode: ApiMode;
  universeMode: "DYNAMIC_UNIVERSE_METADATA_DISCOVERY";
  timestampUtc: string;
  cacheStatus: ApiCacheStatus;
  cachedAtUtc: string | null;
  ttlSeconds: number;
  provider?: "EODHD";
  includedMarkets: unknown[];
  excludedInstruments?: string[];
  exchangeResults?: Array<Record<string, unknown>>;
  summary: Record<string, number>;
  assetOutput?: {
    sampleOnly: boolean;
    returned: number;
    totalDiscovered: number;
    limit: number;
  };
  pendingFilters: string[];
  warnings?: string[];
  assets: ApiUniverseAsset[];
  error?: "REAL_API_CALLS_DISABLED";
  message?: string;
}

export interface ApiQuoteData {
  symbol: "SPY" | "LQD" | "HYG" | "VIX" | "VVIX" | "TNX" | "MOVE";
  name: string;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  currency: string;
  providerUsed: ApiProviderName | "none";
  timestampUtc: string;
  dataQuality: ApiDataQuality;
  marketStatus: "UNKNOWN";
  message?: string;
  cacheStatus?: ApiCacheStatus;
  cachedAtUtc?: string | null;
  ttlSeconds?: number;
  isInformationalOnly?: true;
  affectsScore?: false;
  affectsRanking?: false;
  affectsExec?: false;
  diagnosticStatus?: ApiMasterIndicatorDiagnosticStatus;
  providerSymbolsTried?: {
    eodhd: string;
    finnhub: string;
  };
}

export interface ApiBlockedCall {
  ok: false;
  blocked: true;
  provider: ApiProviderName;
  operation: string;
  reason: string;
}
