import type {
  DataCacheStatus,
  DataMode,
  DataProvider,
  MasterIndicator,
  SystemStatus,
  TimestampPair,
  Top8Asset,
} from "../types";
import { isMarketOpen } from "../utils/marketHours";
import { deriveOperationalDataPolicy, ERROR_SCORE_INPUT_INTEGRITY } from "../utils/operationalDataPolicy";

export interface VisibleTop8Quote {
  ticker: string;
  name: string;
  exchange: string;
  currency: Top8Asset["currency"];
  providerSymbol: string | null;
  provider: DataProvider;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  timestampUtc: string | null;
  dataQuality: Top8Asset["dataQuality"];
  cacheStatus: DataCacheStatus;
  dataMode: DataMode;
  operationalDataStatus: Top8Asset["operationalDataStatus"];
  operationalDecisionAllowed: false;
  operationalBlockReasons: string[];
  error: string | null;
}

export interface VisibleTop8QuotesResponse {
  ok: boolean;
  endpoint: "VISIBLE_TOP8_QUOTES";
  realApiCallsEnabled: boolean;
  maxAssets: number;
  acceptsExternalSymbols: false;
  universeExecutionAllowed: false;
  fullRunAllowed: false;
  rankingSource: false;
  selectedTickers: string[];
  assets: VisibleTop8Quote[];
}

interface MasterIndicatorsApiResponse {
  ok: boolean;
  indicators?: Array<{
    symbol: MasterIndicator["symbol"];
    name: string;
    price: number | null;
    previousClose: number | null;
    changePercent: number | null;
    providerUsed: DataProvider | "none";
    dataMode?: DataMode;
    timestampUtc: string;
    dataQuality: MasterIndicator["dataMode"] | Top8Asset["dataQuality"] | string;
    cacheStatus: DataCacheStatus;
  }>;
}

interface Top8StatusApiResponse {
  ok: boolean;
  error?: string;
  assets?: Array<Record<string, unknown>>;
  universeSummary?: {
    totalDiscovered?: number;
    operable?: number;
    notOperable?: number;
    unknown?: number;
  };
  evaluationSummary?: {
    eligibleForScore?: number;
    blocked?: number;
  };
  fullUniverseExecutionAllowed?: boolean;
}

export interface ScanSnapshotResponse {
  ok: boolean;
  mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT";
  status: string;
  scanId: string;
  scanStartedAtUtc: string;
  lastBatchCompletedAtUtc: string | null;
  scanCompletedAtUtc: string | null;
  universeHash: string;
  activeMarkets: string[];
  activeUniverseCounts?: {
    us: number;
    europe: number;
  };
  universeDiscovered: number;
  universeAfterFilters: number;
  batchesTotal: number;
  batchesCompleted: number;
  nextBatchIndex: number | null;
  coveragePercent: number;
  estimatedProviderCalls: number;
  actualProviderCalls: number;
  resultScope: "GLOBAL_TOP8_FINAL" | "PARTIAL_BATCH_ONLY" | "DATA_UNAVAILABLE";
  isGlobalTop8Final: boolean;
  isPartialResult: boolean;
  snapshotToken: string | null;
  recommendedNextAction: string;
  diagnostics?: {
    processedBatches?: Array<{
      selectedAssets?: number;
      providerCallsPlanned?: number;
      evaluationSummary?: {
        analyzed?: number;
        eligibleForScore?: number;
        blocked?: number;
      };
    }>;
    blockedReasons?: string[];
  };
  assets?: Array<Record<string, unknown>>;
  topCandidates?: Array<Record<string, unknown>>;
  error?: string;
}

export interface Top8MergeResult {
  top8: Top8Asset[];
  realQuoteCount: number;
  staleQuoteCount: number;
  errorQuoteCount: number;
  lastRealDataUpdate: TimestampPair | null;
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url}_HTTP_${response.status}`);
    }

    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function timestampPairFromDate(date: Date): TimestampPair {
  return {
    utc: date.toISOString(),
    local: date.toLocaleString(),
  };
}

export function timestampPairFromUtc(utc: string | null | undefined): TimestampPair {
  if (!utc) return timestampPairFromDate(new Date());

  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? timestampPairFromDate(new Date()) : timestampPairFromDate(date);
}

function formatCurrencyValue(currency: Top8Asset["currency"], value: number): string {
  if (currency === "EUR") return `EUR ${value.toFixed(2)}`;
  if (currency === "GBX") return `GBX ${Math.round(value).toLocaleString("en-GB")}`;
  return `$${value.toFixed(2)}`;
}

function deriveGuardedAction(asset: Top8Asset): Top8Asset["action"] {
  if (asset.marketStatus !== "OPEN" && asset.action === "EXEC") return "CLOSED_CONTEXT";
  if (!asset.operationalDecisionAllowed || asset.dataMode !== "REAL" || asset.priceDataMode !== "REAL") {
    if (asset.marketStatus !== "OPEN") return asset.action === "EXEC" ? "CLOSED_CONTEXT" : asset.action;
    if (asset.action === "EXEC" || asset.action === "CLOSED_CONTEXT") return "BLOCKED";
  }
  return asset.action;
}

function execDisabledReason(asset: Top8Asset): string | undefined {
  if (asset.marketStatus !== "OPEN") return "Market closed - EXEC disabled";
  if (!asset.operationalDecisionAllowed) return asset.operationalBlockReasons.join(", ") || "Operational data unavailable - EXEC disabled";
  if (asset.dataMode === "ERROR") return "Quote unavailable - EXEC disabled";
  if (asset.dataMode === "DATA_UNAVAILABLE") return "Data unavailable - EXEC disabled";
  if (asset.dataMode === "LAST_CLOSE") return "Last close only - EXEC disabled";
  return undefined;
}

export async function fetchVisibleTop8Quotes(selectedAssets: Top8Asset[]): Promise<VisibleTop8QuotesResponse> {
  const response = await fetch("/api/visible-top8-quotes", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      scanId: selectedAssets[0]?.scanId ?? null,
      selectedAssets: selectedAssets.slice(0, 8).map((asset) => ({
        ticker: asset.ticker,
        name: asset.name,
        exchange: asset.market,
        currency: asset.currency,
        providerSymbol: asset.providerSymbol,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`VISIBLE_TOP8_QUOTES_HTTP_${response.status}`);
  }

  return response.json();
}

export async function fetchMasterIndicators(): Promise<MasterIndicatorsApiResponse> {
  const response = await fetch("/api/master-indicators", {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`MASTER_INDICATORS_HTTP_${response.status}`);
  }

  return response.json();
}

export async function fetchTop8Status(): Promise<Top8StatusApiResponse> {
  const response = await fetch("/api/top8", {
    method: "GET",
    headers: { accept: "application/json" },
  });

  return response.json();
}

export async function fetchLastScanSnapshot(): Promise<ScanSnapshotResponse | null> {
  try {
    const response = await fetch("/api/scan-snapshot/last", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.ok) return null;
    return { ...data, source: "LAST_SESSION_CACHE" } as ScanSnapshotResponse;
  } catch {
    return null;
  }
}

export async function startScanSnapshot(): Promise<ScanSnapshotResponse> {
  return fetchJsonWithTimeout<ScanSnapshotResponse>("/api/scan-snapshot/start", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ batchSize: 100 }),
  }, 30000); // 30s — each batch takes ~9s
}

export async function continueScanSnapshot(snapshotToken: string): Promise<ScanSnapshotResponse> {
  return fetchJsonWithTimeout<ScanSnapshotResponse>("/api/scan-snapshot/continue", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ snapshotToken }),
  }, 30000); // 30s — each batch takes ~9s
}

export async function finalizeScanSnapshot(snapshotToken: string): Promise<ScanSnapshotResponse> {
  return fetchJsonWithTimeout<ScanSnapshotResponse>("/api/scan-snapshot/finalize", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ snapshotToken }),
  });
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringFromUnknown(value: unknown, defaultValue = ""): string {
  return typeof value === "string" && value.length > 0 ? value : defaultValue;
}

function scoreInputIntegrityFromApi(asset: Record<string, unknown>) {
  const technicalResult = asset.technicalResult as { technicals?: Record<string, unknown> } | undefined;
  const technicals = technicalResult?.technicals ?? {};
  const spreadStatus = asset.spreadStatus as { ok?: unknown } | undefined;

  return {
    EMA20: numberFromUnknown(technicals.ema20) === null ? "ERROR" as const : "REAL" as const,
    EMA50: numberFromUnknown(technicals.ema50) === null ? "ERROR" as const : "REAL" as const,
    RS: numberFromUnknown(technicals.rs60) === null ? "ERROR" as const : "REAL" as const,
    Momentum: numberFromUnknown(technicals.momentum20) === null ? "ERROR" as const : "REAL" as const,
    Continuity: numberFromUnknown(technicals.ema20SlopePercent) === null ? "ERROR" as const : "REAL" as const,
    RVOL: numberFromUnknown(technicals.rvol) === null ? "ERROR" as const : "REAL" as const,
    Liquidity: numberFromUnknown(technicals.avgValue20) === null ? "ERROR" as const : "REAL" as const,
    Spread: spreadStatus?.ok === true ? "REAL" as const : "ERROR" as const,
    ATR: numberFromUnknown(technicals.atrPercent) === null ? "ERROR" as const : "REAL" as const,
  };
}

function allScoreInputsReal(scoreInputIntegrity: Top8Asset["scoreInputIntegrity"]): boolean {
  return Object.values(scoreInputIntegrity).every((status) => status === "REAL");
}

function formatPercentValue(value: unknown): string {
  const parsed = numberFromUnknown(value);
  return parsed === null ? "N/A" : `${parsed.toFixed(2)}%`;
}

function formatNumberValue(value: unknown): string {
  const parsed = numberFromUnknown(value);
  return parsed === null ? "N/A" : parsed.toFixed(2);
}

export function buildDashboardTop8FromTop8Status(response: Top8StatusApiResponse): Top8Asset[] {
  if (response.ok !== true || !Array.isArray(response.assets) || response.assets.length === 0) return [];

  return response.assets.slice(0, 8).map((asset, index) => {
    const technicalResult = asset.technicalResult as { technicals?: Record<string, unknown> } | undefined;
    const technicals = technicalResult?.technicals ?? {};
    const trailing = asset.trailing as Record<string, unknown> | undefined;
    const rank = numberFromUnknown(asset.rank) ?? index + 1;
    const scoreInputIntegrity = scoreInputIntegrityFromApi(asset);
    const hasRealScoreInputs = allScoreInputsReal(scoreInputIntegrity);
    const market = stringFromUnknown(asset.exchange, stringFromUnknown(asset.market, "UNKNOWN"));
    const marketStatus = isMarketOpen(market);
    const score = numberFromUnknown(asset.score) ?? 0;
    const conviction = numberFromUnknown(asset.conviction) ?? 0;
    const action = stringFromUnknown(asset.action, "BLOCKED") as Top8Asset["action"];
    const currency = (stringFromUnknown(asset.currency, "USD") as Top8Asset["currency"]) ?? "USD";
    const timestamp = timestampPairFromUtc(stringFromUnknown(technicals.lastDate, null as unknown as string));
    const policy = deriveOperationalDataPolicy({
      marketStatus,
      dataMode: hasRealScoreInputs ? "REAL" : "DATA_UNAVAILABLE",
      dataQuality: stringFromUnknown(asset.dataQuality, "NOT_AVAILABLE"),
      provider: "none",
      cacheStatus: "NOT_AVAILABLE",
      timestampUtc: timestamp.utc,
      scoreInputIntegrity,
    });
    const nextAsset: Top8Asset = {
      rank,
      ticker: stringFromUnknown(asset.ticker, "UNKNOWN"),
      name: stringFromUnknown(asset.name, stringFromUnknown(asset.ticker, "UNKNOWN")),
      market,
      marketStatus,
      price: "N/A",
      priceChangePercent: 0,
      dataMode: policy.operationalDataStatus === "REAL" ? "REAL" : "DATA_UNAVAILABLE",
      priceDataMode: "DATA_UNAVAILABLE",
      provider: "none",
      providerSymbol: stringFromUnknown(asset.providerSymbol, ""),
      currency,
      previousClose: null,
      cacheStatus: "NOT_AVAILABLE",
      priceTimestamp: timestamp,
      top8Source: "DYNAMIC",
      resultScope: "GLOBAL",
      operationalDataStatus: policy.operationalDataStatus,
      operationalDecisionAllowed: false,
      operationalBlockReasons: [
        ...new Set([
          ...policy.operationalBlockReasons,
          "VISIBLE_REAL_PRICE_REQUIRED_BEFORE_OPERATIONAL_DISPLAY",
        ]),
      ],
      scoreInputIntegrity,
      execDisabledReason: "Visible real price required before EXEC",
      score,
      conviction,
      ema20: formatNumberValue(technicals.ema20),
      ema50: formatNumberValue(technicals.ema50),
      slope: formatPercentValue(technicals.ema20SlopePercent),
      rs: formatPercentValue(technicals.rs60),
      rvol: formatNumberValue(technicals.rvol),
      atr: formatNumberValue(technicals.atr),
      atrPercent: formatPercentValue(technicals.atrPercent),
      momentum: formatPercentValue(technicals.momentum20),
      trend: "Engine ranked",
      risk: stringFromUnknown(asset.risk, "HIGH") as Top8Asset["risk"],
      trailingAdjusted: formatPercentValue(trailing?.trailing_adjusted),
      trailingMedium: formatPercentValue(trailing?.trailing_medium),
      trailingWide: formatPercentValue(trailing?.trailing_wide),
      action,
      dataQuality: stringFromUnknown(asset.dataQuality, "NOT_AVAILABLE") as Top8Asset["dataQuality"],
      timestamp,
    };

    return {
      ...nextAsset,
      action: deriveGuardedAction(nextAsset),
      execDisabledReason: execDisabledReason(nextAsset),
    };
  });
}

export function buildDashboardTop8FromScanSnapshot(response: ScanSnapshotResponse): Top8Asset[] {
  if (response.isGlobalTop8Final !== true || response.coveragePercent !== 100) return [];

  const assets = Array.isArray(response.assets) ? response.assets : response.topCandidates ?? [];
  const baseAssets = buildDashboardTop8FromTop8Status({
    ok: true,
    assets,
    universeSummary: {
      totalDiscovered: response.universeDiscovered,
      operable: response.universeAfterFilters,
    },
    evaluationSummary: {
      eligibleForScore: assets.length,
      blocked: 0,
    },
  });

  return baseAssets.map((asset) => ({
    ...asset,
    scanId: response.scanId,
    scanStartedAtUtc: response.scanStartedAtUtc,
    scanCompletedAtUtc: response.scanCompletedAtUtc,
    providerTimestamp: asset.priceTimestamp.utc,
    top8Source: "DYNAMIC",
    resultScope: "GLOBAL_TOP8_FINAL",
  }));
}

export function mergeScanSnapshotUniverseStatus(systemStatus: SystemStatus, response: ScanSnapshotResponse): SystemStatus {
  const isGlobal = response.isGlobalTop8Final === true && response.coveragePercent === 100;
  const blockedReasons = response.diagnostics?.blockedReasons ?? [response.error ?? "SCAN_SNAPSHOT_INCOMPLETE"];
  const activeUniverseCounts = response.activeUniverseCounts ?? { us: 0, europe: 0 };
  const candidatesAnalysed = response.diagnostics?.processedBatches?.reduce(
    (total, batch) => total + (batch.evaluationSummary?.analyzed ?? batch.selectedAssets ?? 0),
    0,
  ) ?? 0;

  return {
    ...systemStatus,
    operationalDataStatus: isGlobal ? "REAL" : response.status === "ERROR" ? "ERROR" : "DATA_UNAVAILABLE",
    operationalDecisionAllowed: false,
    operationalBlockReasons: isGlobal
      ? ["EXEC_REQUIRES_FINAL_REAL_PRICE_AND_OPEN_MARKET"]
      : [...new Set(["GLOBAL_TOP8_REQUIRES_100_PERCENT_COVERAGE", ...blockedReasons])],
    technical: {
      ...systemStatus.technical,
      apiCalls: response.actualProviderCalls ?? systemStatus.technical.apiCalls,
      blockedCalls: isGlobal ? systemStatus.technical.blockedCalls : systemStatus.technical.blockedCalls + 1,
      universeStats: {
        ...systemStatus.technical.universeStats,
        us: activeUniverseCounts.us,
        europe: activeUniverseCounts.europe,
        total: response.universeDiscovered ?? 0,
        universeDiscovered: response.universeDiscovered ?? 0,
        universeOperable: response.universeAfterFilters ?? 0,
        universeEligibleForScore: response.isGlobalTop8Final ? response.assets?.length ?? 0 : 0,
        universeRanked: isGlobal ? response.assets?.length ?? 0 : 0,
        finalTop8Count: isGlobal ? response.assets?.length ?? 0 : 0,
        source: isGlobal ? "REAL" : response.batchesCompleted > 0 ? "PARTIAL" : "DATA_UNAVAILABLE",
        top8Source: isGlobal ? "DYNAMIC" : response.batchesCompleted > 0 ? "PARTIAL" : "UNAVAILABLE",
        resultScope: isGlobal ? "GLOBAL_TOP8_FINAL" : response.batchesCompleted > 0 ? "PARTIAL_BATCH_ONLY" : "UNAVAILABLE",
        operationalDataStatus: isGlobal ? "REAL" : "DATA_UNAVAILABLE",
        operationalDecisionAllowed: false,
        operationalBlockReasons: isGlobal
          ? ["EXEC_REQUIRES_FINAL_REAL_PRICE_AND_OPEN_MARKET"]
          : [...new Set(["GLOBAL_TOP8_REQUIRES_100_PERCENT_COVERAGE", ...blockedReasons])],
        scanId: response.scanId,
        universeHash: response.universeHash,
        activeMarkets: response.activeMarkets,
        activeUniverseCounts,
        batchesTotal: response.batchesTotal,
        batchesCompleted: response.batchesCompleted,
        nextBatchIndex: response.nextBatchIndex,
        coveragePercent: response.coveragePercent,
        candidatesAnalysed,
        estimatedProviderCalls: response.estimatedProviderCalls,
        actualProviderCalls: response.actualProviderCalls,
        recommendedNextAction: response.recommendedNextAction,
      },
    },
  };
}

export function mergeTop8UniverseStatus(systemStatus: SystemStatus, response: Top8StatusApiResponse): SystemStatus {
  const universeSummary = response.universeSummary;
  if (!universeSummary) return systemStatus;

  const assetsLength = Array.isArray(response.assets) ? response.assets.length : 0;
  const isGlobalTop8 = response.ok === true && assetsLength > 0;
  const universeDiscovered = universeSummary.totalDiscovered ?? systemStatus.technical.universeStats.universeDiscovered;
  const universeOperable = universeSummary.operable ?? systemStatus.technical.universeStats.universeOperable;
  const universeEligibleForScore = response.evaluationSummary?.eligibleForScore ?? 0;

  return {
    ...systemStatus,
    operationalDataStatus: isGlobalTop8 ? "REAL" : "DATA_UNAVAILABLE",
    operationalDecisionAllowed: false,
    operationalBlockReasons: isGlobalTop8
      ? ["GLOBAL_TOP8_REQUIRES_REAL_SCORE_INPUT_AUDIT_BEFORE_EXEC"]
      : [response.error ?? "GLOBAL_TOP8_COST_GATE_NOT_AVAILABLE"],
    technical: {
      ...systemStatus.technical,
      universeStats: {
        ...systemStatus.technical.universeStats,
        us: systemStatus.technical.universeStats.us,
        europe: systemStatus.technical.universeStats.europe,
        total: universeDiscovered,
        universeDiscovered,
        universeOperable,
        universeEligibleForScore,
        universeRanked: isGlobalTop8 ? assetsLength : 0,
        finalTop8Count: assetsLength,
        source: "METADATA_ONLY",
        top8Source: isGlobalTop8 ? "DYNAMIC" : "PARTIAL",
        resultScope: isGlobalTop8 ? "GLOBAL" : "PARTIAL_BATCH_ONLY",
        operationalDataStatus: isGlobalTop8 ? "REAL" : "DATA_UNAVAILABLE",
        operationalDecisionAllowed: false,
        operationalBlockReasons: isGlobalTop8
          ? ["GLOBAL_TOP8_REQUIRES_REAL_SCORE_INPUT_AUDIT_BEFORE_EXEC"]
          : [response.error ?? "GLOBAL_TOP8_COST_GATE_NOT_AVAILABLE"],
      },
    },
  };
}

export function mergeVisibleTop8Quotes(currentTop8: Top8Asset[], response: VisibleTop8QuotesResponse): Top8MergeResult {
  const quoteByTicker = new Map(response.assets.map((quote) => [quote.ticker, quote]));
  let realQuoteCount = 0;
  let staleQuoteCount = 0;
  let errorQuoteCount = 0;
  let latestRealTimestamp: TimestampPair | null = null;

  const top8 = currentTop8.map((asset) => {
    const quote = quoteByTicker.get(asset.ticker);
    const marketStatus = isMarketOpen(asset.market);

    if (!quote || quote.price === null) {
      errorQuoteCount += 1;
      const policy = deriveOperationalDataPolicy({
        marketStatus,
        dataMode: "DATA_UNAVAILABLE",
        dataQuality: quote?.dataQuality ?? "NOT_AVAILABLE",
        provider: quote?.provider ?? "none",
        cacheStatus: quote?.cacheStatus ?? "NOT_AVAILABLE",
        timestampUtc: quote?.timestampUtc ?? null,
        scoreInputIntegrity: ERROR_SCORE_INPUT_INTEGRITY,
      });
      const nextAsset: Top8Asset = {
        ...asset,
        marketStatus,
        price: "N/A",
        priceChangePercent: 0,
        dataMode: "DATA_UNAVAILABLE",
        priceDataMode: "DATA_UNAVAILABLE",
        provider: quote?.provider ?? "none",
        providerSymbol: quote?.providerSymbol ?? asset.providerSymbol,
        cacheStatus: quote?.cacheStatus ?? "NOT_AVAILABLE",
        previousClose: null,
        operationalDataStatus: policy.operationalDataStatus,
        operationalDecisionAllowed: false,
        operationalBlockReasons: policy.operationalBlockReasons,
        scoreInputIntegrity: ERROR_SCORE_INPUT_INTEGRITY,
        execDisabledReason: "Quote unavailable - DATA UNAVAILABLE; EXEC disabled",
      };

      return {
        ...nextAsset,
        action: deriveGuardedAction(nextAsset),
      };
    }

    const priceTimestamp = timestampPairFromUtc(quote.timestampUtc);
    const priceDataMode: DataMode = quote.cacheStatus === "STALE" ? "LAST_CLOSE" : "REAL";
    const cardDataMode: DataMode =
      asset.top8Source === "DYNAMIC" &&
      (asset.resultScope === "GLOBAL" || asset.resultScope === "GLOBAL_TOP8_FINAL") &&
      allScoreInputsReal(asset.scoreInputIntegrity)
        ? priceDataMode
        : "DATA_UNAVAILABLE";
    const policy = deriveOperationalDataPolicy({
      marketStatus,
      dataMode: cardDataMode,
      dataQuality: quote.dataQuality,
      provider: quote.provider,
      cacheStatus: quote.cacheStatus,
      timestampUtc: quote.timestampUtc,
      scoreInputIntegrity:
        cardDataMode === "REAL" || cardDataMode === "LAST_CLOSE"
          ? asset.scoreInputIntegrity
          : ERROR_SCORE_INPUT_INTEGRITY,
    });
    if (priceDataMode === "LAST_CLOSE") staleQuoteCount += 1;
    else realQuoteCount += 1;

    if (!latestRealTimestamp || priceTimestamp.utc > latestRealTimestamp.utc) {
      latestRealTimestamp = priceTimestamp;
    }

    const nextAsset: Top8Asset = {
      ...asset,
      marketStatus,
      price: formatCurrencyValue(quote.currency, quote.price),
      priceChangePercent: quote.changePercent ?? asset.priceChangePercent,
      dataMode: cardDataMode,
      priceDataMode,
      provider: quote.provider,
      providerSymbol: quote.providerSymbol ?? asset.providerSymbol,
      currency: quote.currency,
      previousClose: quote.previousClose === null ? null : formatCurrencyValue(quote.currency, quote.previousClose),
      cacheStatus: quote.cacheStatus,
      priceTimestamp,
      dataQuality: quote.dataQuality,
      timestamp: priceTimestamp,
      operationalDataStatus: policy.operationalDataStatus,
      operationalDecisionAllowed: policy.operationalDecisionAllowed,
      operationalBlockReasons: policy.operationalBlockReasons,
      scoreInputIntegrity:
        cardDataMode === "REAL" || cardDataMode === "LAST_CLOSE"
          ? asset.scoreInputIntegrity
          : ERROR_SCORE_INPUT_INTEGRITY,
    };

    return {
      ...nextAsset,
      action: deriveGuardedAction(nextAsset),
      execDisabledReason: execDisabledReason(nextAsset),
    };
  });

  return {
    top8,
    realQuoteCount,
    staleQuoteCount,
    errorQuoteCount,
    lastRealDataUpdate: latestRealTimestamp,
  };
}

export function mergeMasterIndicators(
  currentIndicators: MasterIndicator[],
  response: MasterIndicatorsApiResponse,
): { indicators: MasterIndicator[]; realIndicatorCount: number; lastRealDataUpdate: TimestampPair | null } {
  const indicatorsBySymbol = new Map(response.indicators?.map((indicator) => [indicator.symbol, indicator]) ?? []);
  let realIndicatorCount = 0;
  let latestRealTimestamp: TimestampPair | null = null;

  const indicators: MasterIndicator[] = currentIndicators.map((indicator): MasterIndicator => {
    const apiIndicator = indicatorsBySymbol.get(indicator.symbol);

    if (!apiIndicator || apiIndicator.price === null) {
      return {
        ...indicator,
        dataMode: "DATA_UNAVAILABLE" as const,
        provider: "none" as const,
        source: "none" as const,
        cacheStatus: apiIndicator?.cacheStatus ?? "NOT_AVAILABLE",
        status: "NOT_AVAILABLE" as const,
        value: indicator.symbol === "TNX" ? "N/A" : indicator.value,
        operationalDataStatus: "DATA_UNAVAILABLE" as const,
        operationalDecisionAllowed: false as const,
        operationalBlockReasons: ["MASTER_INDICATOR_DATA_UNAVAILABLE"],
      };
    }

    const timestamp = timestampPairFromUtc(apiIndicator.timestampUtc);
    const isStale = apiIndicator.cacheStatus === "STALE";
    const provider: DataProvider = apiIndicator.providerUsed === "none" ? "none" : apiIndicator.providerUsed;
    const nextDataMode: DataMode = isStale ? "LAST_CLOSE" : "REAL";
    if (!isStale) realIndicatorCount += 1;
    if (!isStale && (!latestRealTimestamp || timestamp.utc > latestRealTimestamp.utc)) {
      latestRealTimestamp = timestamp;
    }

    return {
      ...indicator,
      value: indicator.symbol === "TNX" ? `${apiIndicator.price.toFixed(2)}%` : apiIndicator.price.toFixed(2),
      changePercent: apiIndicator.changePercent ?? indicator.changePercent,
      source: provider,
      dataMode: nextDataMode,
      provider,
      cacheStatus: apiIndicator.cacheStatus,
      priceTimestamp: timestamp,
      status: isStale ? "CACHE" : "LIVE",
      operationalDataStatus: isStale ? "LAST_CLOSE" : "REAL",
      operationalDecisionAllowed: false,
      operationalBlockReasons: ["MASTER_INDICATOR_INFORMATIONAL_ONLY"],
      color:
        (apiIndicator.changePercent ?? indicator.changePercent) > 0.05
          ? "GREEN_SOFT"
          : (apiIndicator.changePercent ?? indicator.changePercent) < -0.05
            ? "ORANGE"
            : "WHITE_GREY",
      timestamp,
    };
  });

  return {
    indicators,
    realIndicatorCount,
    lastRealDataUpdate: latestRealTimestamp,
  };
}

export function deriveIndicatorsDataMode(indicators: MasterIndicator[]): DataMode {
  const modes = indicators.map((indicator) => indicator.dataMode);
  if (modes.some((mode) => mode === "REAL")) return "REAL";
  if (modes.some((mode) => mode === "LAST_CLOSE" || mode === "LAST_SESSION")) return "LAST_CLOSE";
  if (modes.every((mode) => mode === "ERROR")) return "ERROR";
  return "DATA_UNAVAILABLE";
}

export function deriveDashboardDataMode(
  top8: Top8Asset[],
  indicators: MasterIndicator[],
  options: { isScanning?: boolean; coveragePercent?: number } = {},
): DataMode {
  if (options.isScanning) return "SCANNING";
  if (top8.length === 0 && (options.coveragePercent ?? 0) > 0) return "PARTIAL_DATA";
  if (top8.length === 0 && deriveIndicatorsDataMode(indicators) === "REAL") return "PARTIAL_DATA";
  if (top8.length === 0) return "DATA_UNAVAILABLE";
  const modes = [...top8.map((asset) => asset.dataMode), ...indicators.map((indicator) => indicator.dataMode)];
  if (modes.length === 0) return "DATA_UNAVAILABLE";
  if (modes.every((mode) => mode === "REAL")) return "REAL";
  if (modes.every((mode) => mode === "LAST_CLOSE")) return "LAST_CLOSE";
  if (modes.some((mode) => mode === "ERROR")) return "ERROR";
  if (modes.some((mode) => mode === "REAL" || mode === "LAST_CLOSE" || mode === "LAST_SESSION")) return "PARTIAL_DATA";
  return "DATA_UNAVAILABLE";
}

export function updateSystemStatusForDataMode(
  systemStatus: SystemStatus,
  dashboardDataMode: DataMode,
  lastRealDataUpdate: TimestampPair | null,
): SystemStatus {
  const hasRealDashboard = dashboardDataMode === "REAL";
  const hasRealInformationalData = Boolean(lastRealDataUpdate);
  const hasPartialDashboard = dashboardDataMode === "PARTIAL_DATA" || dashboardDataMode === "SCANNING" || dashboardDataMode === "LAST_SESSION";
  const hasUnavailableDashboard = dashboardDataMode === "ERROR" || dashboardDataMode === "DATA_UNAVAILABLE";

  return {
    ...systemStatus,
    apiStatus: dashboardDataMode === "ERROR" ? "ERROR" : hasRealDashboard || hasRealInformationalData ? "REAL_READY" : "OFFLINE",
    cache: dashboardDataMode === "ERROR" ? "ERROR" : hasRealDashboard || hasRealInformationalData ? "REAL_CACHE" : hasUnavailableDashboard ? "EMPTY" : "REAL_CACHE",
    dashboardDataMode,
    operationalDataStatus:
      systemStatus.operationalDataStatus === "REAL" && hasRealDashboard
        ? "REAL"
        : dashboardDataMode === "ERROR"
          ? "ERROR"
          : "DATA_UNAVAILABLE",
    operationalDecisionAllowed: false,
    operationalBlockReasons: [
      ...new Set([
        ...systemStatus.operationalBlockReasons,
        "DASHBOARD_INFORMATIONAL_ONLY",
        hasPartialDashboard ? `${dashboardDataMode}_IS_NOT_OPERATIONAL` : null,
        hasRealDashboard ? "EXEC_REQUIRES_SEPARATE_REAL_SCORE_INPUT_AUDIT" : "REAL_OPERATIONAL_DATA_UNAVAILABLE",
      ].filter((reason): reason is string => typeof reason === "string")),
    ],
    lastRealDataUpdate,
  };
}
