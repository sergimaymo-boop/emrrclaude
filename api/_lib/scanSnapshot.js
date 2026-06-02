import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { buildTop8BatchPlan, getTop8Batch, prioritizeUniverseCandidates } from "./top8BatchPlanner.js";
import { runControlledTop8Pipeline } from "./top8Pipeline.js";

const SNAPSHOT_TOKEN_VERSION = "SCAN_SNAPSHOT_V1";
const DEFAULT_BATCH_SIZE = 100;
const MIN_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_PROVIDER_CALLS_PER_INVOCATION = 150; // Reduced from 201 — keeps batches safely within Vercel Hobby 10s timeout
const MAX_TOP_CANDIDATES = 8;
const DEFAULT_MAX_METADATA_PRE_ELIGIBLE_ASSETS = 600;
const SESSION_STATUS = Object.freeze({
  READY_FOR_NEXT_BATCH: "READY_FOR_NEXT_BATCH",
  PARTIAL_BATCH_ONLY: "PARTIAL_BATCH_ONLY",
  GLOBAL_TOP8_FINAL: "GLOBAL_TOP8_FINAL",
  DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
  ERROR: "ERROR",
});

function nowUtc() {
  return new Date().toISOString();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getEnv() {
  return globalThis.process?.env ?? {};
}

function getSigningSecret() {
  const env = getEnv();
  const secret = env.SCAN_SNAPSHOT_SIGNING_SECRET || env.EODHD_API_KEY || "";
  return typeof secret === "string" && secret.trim().length > 0 ? secret : null;
}

function signPayload(encodedPayload) {
  const secret = getSigningSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function encodeScanSnapshotToken(state) {
  const encodedPayload = base64UrlEncode(JSON.stringify({ version: SNAPSHOT_TOKEN_VERSION, state }));
  const signature = signPayload(encodedPayload);
  if (!signature) return null;
  return `${encodedPayload}.${signature}`;
}

export function decodeScanSnapshotToken(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, error: "SNAPSHOT_TOKEN_REQUIRED" };
  }

  const [encodedPayload, signature] = token.split(".");
  const expectedSignature = signPayload(encodedPayload);
  if (!expectedSignature) return { ok: false, error: "SNAPSHOT_SIGNING_SECRET_NOT_CONFIGURED" };

  const actual = Buffer.from(signature ?? "", "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, error: "SNAPSHOT_TOKEN_INVALID_SIGNATURE" };
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(encodedPayload));
    if (decoded?.version !== SNAPSHOT_TOKEN_VERSION || !decoded.state) {
      return { ok: false, error: "SNAPSHOT_TOKEN_INVALID_PAYLOAD" };
    }
    return { ok: true, state: decoded.state };
  } catch {
    return { ok: false, error: "SNAPSHOT_TOKEN_INVALID_JSON" };
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parseSnapshotBatchSize(value) {
  return clampInteger(value, DEFAULT_BATCH_SIZE, MIN_BATCH_SIZE, MAX_BATCH_SIZE);
}

export function parseMaxProviderCallsPerInvocation(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_PROVIDER_CALLS_PER_INVOCATION;
  return Math.max(parsed, DEFAULT_MAX_PROVIDER_CALLS_PER_INVOCATION);
}

function stableUniverseAssetKey(asset) {
  return [
    asset?.region ?? "",
    asset?.exchange ?? "",
    asset?.providerExchange ?? "",
    asset?.ticker ?? "",
    asset?.providerSymbol ?? "",
    asset?.isin ?? "",
    asset?.currency ?? "",
  ].join(":");
}

export function buildScanUniverseHash(assets = []) {
  const keys = assets.map(stableUniverseAssetKey).sort();
  return createHash("sha256").update(JSON.stringify(keys)).digest("hex").slice(0, 32);
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + offset + (nth - 1) * 7));
}

function isUsDst(date) {
  const year = date.getUTCFullYear();
  const starts = nthWeekdayOfMonth(year, 2, 0, 2);
  const ends = nthWeekdayOfMonth(year, 10, 0, 1);
  return date >= starts && date < ends;
}

function minutesUtc(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function inRange(date, startMinutes, endMinutes) {
  const minutes = minutesUtc(date);
  return minutes >= startMinutes && minutes < endMinutes;
}

function marketStatusForExchange(exchange, date) {
  if (isWeekend(date)) return "CLOSED";
  const normalized = String(exchange ?? "").toUpperCase();

  if (normalized.includes("NASDAQ") || normalized.includes("NYSE") || normalized === "USA_SUPPORTED") {
    return inRange(date, isUsDst(date) ? 13 * 60 + 30 : 14 * 60 + 30, isUsDst(date) ? 20 * 60 : 21 * 60)
      ? "OPEN"
      : "CLOSED";
  }

  if (normalized.includes("LSE") || normalized.includes("LONDON")) {
    return inRange(date, 8 * 60, 16 * 60 + 30) ? "OPEN" : "CLOSED";
  }

  if (
    normalized.includes("XETRA") ||
    normalized.includes("EURONEXT") ||
    normalized.includes("BORSA") ||
    normalized.includes("ITALIANA") ||
    normalized.includes("SIX")
  ) {
    return inRange(date, 7 * 60, 15 * 60 + 30) ? "OPEN" : "CLOSED";
  }

  return "CLOSED";
}

export function getActiveMarketsAt(timestampUtc) {
  const date = new Date(timestampUtc);
  const usOpen = marketStatusForExchange("NASDAQ", date) === "OPEN" || marketStatusForExchange("NYSE", date) === "OPEN";
  const europeOpen = ["XETRA", "EURONEXT", "BORSA_ITALIANA", "SIX", "LSE"].some(
    (exchange) => marketStatusForExchange(exchange, date) === "OPEN",
  );

  if (usOpen && europeOpen) return ["USA", "Europe"];
  if (usOpen) return ["USA"];
  if (europeOpen) return ["Europe"];
  return [];
}

function filterActiveUniverseAssets(assets, scanStartedAtUtc) {
  const activeMarkets = getActiveMarketsAt(scanStartedAtUtc);
  return assets.filter((asset) => {
    if (!activeMarkets.includes(asset.region)) return false;
    return marketStatusForExchange(asset.exchange, new Date(scanStartedAtUtc)) === "OPEN";
  });
}

function filterActiveOperableAssets(assets, scanStartedAtUtc) {
  return filterActiveUniverseAssets(assets, scanStartedAtUtc).filter((asset) => asset?.operabilityStatus === "OPERABLE");
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function estimatedMetadataPrice(asset) {
  return firstFiniteNumber(
    asset?.price,
    asset?.lastPrice,
    asset?.previousClose,
    asset?.close,
    asset?.metadata?.price,
    asset?.metadata?.lastPrice,
    asset?.metadata?.previousClose,
  );
}

function knownHistorySessions(asset) {
  return firstFiniteNumber(
    asset?.historySessions,
    asset?.historyDays,
    asset?.validHistoryDays,
    asset?.validHistorySessions,
    asset?.metadata?.historySessions,
    asset?.metadata?.historyDays,
    asset?.metadata?.validHistoryDays,
  );
}

function passesMetadataPreEligibility(asset) {
  const price = estimatedMetadataPrice(asset);
  if (price !== null && price < 5) return false;

  const historySessions = knownHistorySessions(asset);
  if (historySessions !== null && historySessions < 260) return false;

  return true;
}

function buildMetadataPreEligibilityDiagnostics(activeAssets, operableAssets, preEligibleAssets, selectedAssets) {
  const typeExcluded = activeAssets.filter((asset) => asset?.type && asset.type !== "Common Stock").length;
  const belowMinPrice = operableAssets.filter((asset) => {
    const price = estimatedMetadataPrice(asset);
    return price !== null && price < 5;
  }).length;
  const insufficientKnownHistory = operableAssets.filter((asset) => {
    const historySessions = knownHistorySessions(asset);
    return historySessions !== null && historySessions < 260;
  }).length;

  return {
    activeAssets: activeAssets.length,
    operableAssets: operableAssets.length,
    preEligibleAssets: preEligibleAssets.length,
    selectedForBatching: selectedAssets.length,
    metadataFilters: {
      belowMinPrice,
      insufficientKnownHistory,
      typeExcluded,
    },
    maxSelectedForHobbyScan: DEFAULT_MAX_METADATA_PRE_ELIGIBLE_ASSETS,
    note: "Metadata-only pre-eligibility is applied before provider-call batches. Missing metadata is not treated as failure.",
  };
}

function filterEstimatedEligibleAssets(activeAssets) {
  const operableAssets = activeAssets.filter((asset) => asset?.operabilityStatus === "OPERABLE");
  const preEligibleAssets = operableAssets.filter(passesMetadataPreEligibility);
  const selectedAssets = prioritizeUniverseCandidates(preEligibleAssets).slice(0, DEFAULT_MAX_METADATA_PRE_ELIGIBLE_ASSETS);

  return {
    eligibleAssets: selectedAssets,
    diagnostics: buildMetadataPreEligibilityDiagnostics(activeAssets, operableAssets, preEligibleAssets, selectedAssets),
  };
}

function calculateCoveragePercent(completed, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((completed / total) * 10000) / 100);
}

function riskRank(risk) {
  if (risk === "LOW") return 0;
  if (risk === "MEDIUM") return 1;
  if (risk === "HIGH") return 2;
  return 9;
}

function dataQualityRank(dataQuality) {
  if (dataQuality === "CLEAN") return 0;
  if (dataQuality === "GOOD") return 1;
  if (dataQuality === "WARNING") return 2;
  return 9;
}

function candidateLiquidity(asset) {
  return asset?.technicalResult?.technicals?.avgValue20 ?? 0;
}

export function sortSnapshotTopCandidates(assets = []) {
  return [...assets].sort((left, right) => {
    const scoreDelta = (right.score ?? -1) - (left.score ?? -1);
    if (scoreDelta !== 0) return scoreDelta;

    const convictionDelta = (right.conviction ?? -1) - (left.conviction ?? -1);
    if (convictionDelta !== 0) return convictionDelta;

    const riskDelta = riskRank(left.risk) - riskRank(right.risk);
    if (riskDelta !== 0) return riskDelta;

    const qualityDelta = dataQualityRank(left.dataQuality) - dataQualityRank(right.dataQuality);
    if (qualityDelta !== 0) return qualityDelta;

    return candidateLiquidity(right) - candidateLiquidity(left);
  });
}

function mergeTopCandidates(existing = [], next = []) {
  const byKey = new Map();
  for (const asset of [...existing, ...next]) {
    const key = asset.providerSymbol || asset.ticker;
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, asset);
      continue;
    }

    const best = sortSnapshotTopCandidates([current, asset])[0];
    byKey.set(key, best);
  }

  return sortSnapshotTopCandidates([...byKey.values()])
    .slice(0, MAX_TOP_CANDIDATES)
    .map((asset, index) => ({ ...asset, rank: index + 1 }));
}

function scoreInputIntegrityFromEvaluation(evaluation) {
  const technicals = evaluation?.technicalResult?.technicals ?? {};
  return {
    EMA20: Number.isFinite(technicals.ema20) ? "REAL" : "ERROR",
    EMA50: Number.isFinite(technicals.ema50) ? "REAL" : "ERROR",
    RS: Number.isFinite(technicals.rs60) ? "REAL" : "ERROR",
    Momentum: Number.isFinite(technicals.momentum20) ? "REAL" : "ERROR",
    Continuity: Number.isFinite(technicals.ema20SlopePercent) ? "REAL" : "ERROR",
    RVOL: Number.isFinite(technicals.rvol) ? "REAL" : "ERROR",
    Liquidity: Number.isFinite(technicals.avgValue20) ? "REAL" : "ERROR",
    Spread: evaluation?.spreadStatus?.ok === true ? "REAL" : "ERROR",
    ATR: Number.isFinite(technicals.atrPercent) ? "REAL" : "ERROR",
  };
}

function allInputsReal(scoreInputIntegrity) {
  return Object.values(scoreInputIntegrity).every((status) => status === "REAL");
}

function providerTimestampFromEvaluation(evaluation) {
  const lastDate = evaluation?.technicalResult?.technicals?.lastDate;
  if (!lastDate) return null;
  const date = new Date(`${String(lastDate).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildSnapshotIntegrity(evaluation, scanStartedAtUtc) {
  const scoreInputIntegrity = scoreInputIntegrityFromEvaluation(evaluation);
  const providerTimestamp = providerTimestampFromEvaluation(evaluation);
  const scanDate = String(scanStartedAtUtc).slice(0, 10);
  const providerDate = providerTimestamp ? providerTimestamp.slice(0, 10) : null;
  const staleReason = providerDate === scanDate ? null : "TECHNICALS_NOT_FROM_SCAN_DATE";
  const blockedReasons = [...new Set([...(evaluation?.blockedReasons ?? []), ...(staleReason ? [staleReason] : [])])];
  const operationalCandidate =
    evaluation?.marketStatus === "OPEN" &&
    evaluation?.dataQuality && ["CLEAN", "GOOD"].includes(evaluation.dataQuality) &&
    allInputsReal(scoreInputIntegrity) &&
    staleReason === null &&
    evaluation?.eligibility?.eligibleForScore === true;

  return {
    providerTimestamp,
    dataMode: operationalCandidate ? "REAL" : "ERROR",
    dataQuality: evaluation?.dataQuality ?? "NOT_AVAILABLE",
    marketStatus: evaluation?.marketStatus ?? "CLOSED",
    staleReason,
    scoreInputIntegrity,
    operationalCandidate,
    blockedReasons,
  };
}

function decorateSnapshotAsset(evaluation, snapshotState) {
  const integrity = buildSnapshotIntegrity(evaluation, snapshotState.scanStartedAtUtc);
  return {
    ...evaluation,
    scanId: snapshotState.scanId,
    scanStartedAtUtc: snapshotState.scanStartedAtUtc,
    scanCompletedAtUtc: snapshotState.scanCompletedAtUtc,
    provider: evaluation.historyStatus?.provider ?? "none",
    providerTimestamp: integrity.providerTimestamp,
    dataMode: integrity.dataMode,
    dataQuality: integrity.dataQuality,
    marketStatus: integrity.marketStatus,
    staleReason: integrity.staleReason,
    scoreInputIntegrity: integrity.scoreInputIntegrity,
    operationalDecisionAllowed: false,
    operationalBlockReasons: [
      ...new Set([
        ...integrity.blockedReasons,
        "EXEC_REQUIRES_GLOBAL_TOP8_FINAL",
        "NO_SUBSTITUTE_DATA_USED",
      ]),
    ],
    isSnapshotOperationalCandidate: integrity.operationalCandidate,
  };
}

function buildInitialState({
  universe,
  scanStartedAtUtc,
  activeAssets,
  eligibleAssets,
  preEligibilityDiagnostics,
  batchPlan,
  batchSize,
  maxProviderCallsPerInvocation,
}) {
  const activeUniverseCounts = activeAssets.reduce(
    (counts, asset) => {
      if (asset?.region === "USA") counts.us += 1;
      if (asset?.region === "Europe") counts.europe += 1;
      return counts;
    },
    { us: 0, europe: 0 },
  );

  return {
    scanId: randomUUID(),
    scanStartedAtUtc,
    lastBatchCompletedAtUtc: null,
    scanCompletedAtUtc: null,
    universeHash: buildScanUniverseHash(eligibleAssets),
    activeMarkets: getActiveMarketsAt(scanStartedAtUtc),
    activeUniverseCounts,
    rawProviderSymbolsDiscovered:
      universe?.rawProviderSymbolsDiscovered ??
      universe?.summary?.totalDiscovered ??
      activeAssets.length,
    universeDiscovered: activeAssets.length,
    universeAfterFilters: eligibleAssets.length,
    batchSize,
    batchesTotal: batchPlan.totalBatches,
    batchesCompleted: 0,
    completedBatchIndexes: [],
    nextBatchIndex: batchPlan.totalBatches > 0 ? 1 : null,
    coveragePercent: 0,
    estimatedProviderCalls: batchPlan.estimatedProviderCallsForAllBatches,
    actualProviderCalls: 0,
    maxProviderCallsPerInvocation,
    costPolicy: {
      batchSize,
      maxProviderCallsPerInvocation,
      estimatedProviderCallsPerFullBatch: batchPlan.estimatedProviderCallsPerFullBatch,
      estimatedProviderCallsForAllBatches: batchPlan.estimatedProviderCallsForAllBatches,
      polling: false,
      autoRefresh: false,
      backgroundJobs: false,
      persistence: false,
    },
    recommendedNextAction: batchPlan.totalBatches > 0 ? "CONTINUE_SCAN" : "DATA_UNAVAILABLE",
    status: batchPlan.totalBatches > 0 ? SESSION_STATUS.READY_FOR_NEXT_BATCH : SESSION_STATUS.DATA_UNAVAILABLE,
    topCandidates: [],
    diagnostics: {
      preEligibility: preEligibilityDiagnostics,
      processedBatches: [],
      blockedReasons: batchPlan.totalBatches > 0 ? [] : ["NO_ACTIVE_OPERABLE_UNIVERSE"],
    },
  };
}

function buildPublicState(state) {
  const coveragePercent = calculateCoveragePercent(state.batchesCompleted, state.batchesTotal);
  const completed = state.batchesTotal > 0 && state.batchesCompleted === state.batchesTotal && coveragePercent === 100;
  const usableTopCandidates = sortSnapshotTopCandidates(state.topCandidates ?? [])
    .filter((asset) => asset.isSnapshotOperationalCandidate === true)
    .slice(0, MAX_TOP_CANDIDATES)
    .map((asset, index) => ({ ...asset, rank: index + 1 }));
  const isGlobalTop8Final = completed && usableTopCandidates.length > 0;
  const status = isGlobalTop8Final
    ? SESSION_STATUS.GLOBAL_TOP8_FINAL
    : completed
      ? SESSION_STATUS.DATA_UNAVAILABLE
      : state.batchesCompleted > 0
        ? SESSION_STATUS.PARTIAL_BATCH_ONLY
        : state.status;

  return {
    ...state,
    status,
    coveragePercent,
    isGlobalTop8Final,
    isPartialResult: !isGlobalTop8Final,
    resultScope: isGlobalTop8Final ? "GLOBAL_TOP8_FINAL" : status === SESSION_STATUS.PARTIAL_BATCH_ONLY ? "PARTIAL_BATCH_ONLY" : "DATA_UNAVAILABLE",
    top8Status: isGlobalTop8Final ? "GLOBAL_TOP8_FINAL" : state.batchesCompleted > 0 ? "TOP_8_PARTIAL_DIAGNOSTIC" : "TOP_8_DATA_UNAVAILABLE",
    recommendedNextAction: isGlobalTop8Final
      ? "GLOBAL_TOP8_FINAL_AVAILABLE"
      : completed
        ? "NO_REAL_GLOBAL_TOP8_AVAILABLE_FROM_COMPLETED_SCAN"
        : "CONTINUE_SCAN",
    nextBatchIndex: completed ? null : state.nextBatchIndex,
    topCandidates: usableTopCandidates,
  };
}

function ensureSameUniverse(state, eligibleAssets) {
  const currentHash = buildScanUniverseHash(eligibleAssets);
  if (state.universeHash !== currentHash) {
    return { ok: false, error: "SNAPSHOT_UNIVERSE_HASH_CHANGED", currentHash };
  }
  return { ok: true, currentHash };
}

export function buildSnapshotPlan(universe, scanStartedAtUtc, options = {}) {
  const batchSize = parseSnapshotBatchSize(options.batchSize);
  const maxProviderCallsPerInvocation = parseMaxProviderCallsPerInvocation(options.maxProviderCallsPerInvocation);
  const activeAssets = filterActiveUniverseAssets(universe.assets ?? [], scanStartedAtUtc);
  const { eligibleAssets, diagnostics: preEligibilityDiagnostics } = filterEstimatedEligibleAssets(activeAssets);
  const batchPlan = buildTop8BatchPlan(eligibleAssets, { batchSize });
  const state = buildInitialState({
    universe,
    scanStartedAtUtc,
    activeAssets,
    eligibleAssets,
    preEligibilityDiagnostics,
    batchPlan,
    batchSize,
    maxProviderCallsPerInvocation,
  });

  return { eligibleAssets, batchPlan, state };
}

export async function processNextSnapshotBatch({ state, eligibleAssets }) {
  if (!state.nextBatchIndex || state.nextBatchIndex > state.batchesTotal) {
    return buildPublicState(state);
  }

  const duplicate = state.completedBatchIndexes.includes(state.nextBatchIndex);
  if (duplicate) {
    return buildPublicState({
      ...state,
      status: SESSION_STATUS.ERROR,
      diagnostics: {
        ...state.diagnostics,
        blockedReasons: [...new Set([...(state.diagnostics?.blockedReasons ?? []), "DUPLICATE_BATCH_INDEX"])],
      },
    });
  }

  const selectedBatch = getTop8Batch(eligibleAssets, state.nextBatchIndex, { batchSize: state.batchSize });
  const plannedProviderCalls = selectedBatch.assets.length * 2 + 1;
  if (plannedProviderCalls > state.maxProviderCallsPerInvocation) {
    return buildPublicState({
      ...state,
      status: SESSION_STATUS.PARTIAL_BATCH_ONLY,
      diagnostics: {
        ...state.diagnostics,
        blockedReasons: [
          ...new Set([
            ...(state.diagnostics?.blockedReasons ?? []),
            "MAX_PROVIDER_CALLS_PER_INVOCATION_REACHED",
          ]),
        ],
      },
    });
  }

  const pipeline = await runControlledTop8Pipeline({
    assets: selectedBatch.assets,
    maxCandidatesPerRun: state.batchSize,
    marketStatus: "OPEN",
    dataQuality: "GOOD",
  });
  const completedAtUtc = nowUtc();
  const decoratedTopCandidates = (pipeline.assets ?? []).map((asset) =>
    decorateSnapshotAsset(asset, {
      ...state,
      scanCompletedAtUtc: completedAtUtc,
    }),
  );
  const completedBatchIndexes = [...state.completedBatchIndexes, state.nextBatchIndex].sort((left, right) => left - right);
  const nextBatchIndex = completedBatchIndexes.length >= state.batchesTotal ? null : state.nextBatchIndex + 1;
  const nextState = {
    ...state,
    lastBatchCompletedAtUtc: completedAtUtc,
    scanCompletedAtUtc: nextBatchIndex === null ? completedAtUtc : null,
    batchesCompleted: completedBatchIndexes.length,
    completedBatchIndexes,
    nextBatchIndex,
    actualProviderCalls: state.actualProviderCalls + (pipeline.providerCallsPlanned ?? plannedProviderCalls),
    status: nextBatchIndex === null ? SESSION_STATUS.DATA_UNAVAILABLE : SESSION_STATUS.PARTIAL_BATCH_ONLY,
    topCandidates: mergeTopCandidates(state.topCandidates, decoratedTopCandidates),
    diagnostics: {
      ...state.diagnostics,
      processedBatches: [
        ...(state.diagnostics?.processedBatches ?? []),
        {
          batchIndex: selectedBatch.batchNumber,
          selectedAssets: selectedBatch.assets.length,
          providerCallsPlanned: pipeline.providerCallsPlanned ?? plannedProviderCalls,
          ok: pipeline.ok === true,
          error: pipeline.error ?? null,
          evaluationSummary: pipeline.summary,
          eligibilityDiagnostics: pipeline.eligibilityDiagnostics,
        },
      ],
      blockedReasons: [
        ...new Set([
          ...(state.diagnostics?.blockedReasons ?? []),
          ...(pipeline.ok ? [] : [pipeline.error ?? "BATCH_NO_ELIGIBLE_ASSETS"]),
        ]),
      ],
    },
  };

  return buildPublicState(nextState);
}

export async function continueScanSnapshot({ universe, tokenState, options = {} }) {
  const activeAssets = filterActiveUniverseAssets(universe.assets ?? [], tokenState.scanStartedAtUtc);
  const { eligibleAssets } = filterEstimatedEligibleAssets(activeAssets);
  const universeCheck = ensureSameUniverse(tokenState, eligibleAssets);
  if (!universeCheck.ok) {
    return buildPublicState({
      ...tokenState,
      status: SESSION_STATUS.ERROR,
      diagnostics: {
        ...tokenState.diagnostics,
        blockedReasons: [
          ...new Set([...(tokenState.diagnostics?.blockedReasons ?? []), universeCheck.error]),
        ],
      },
    });
  }

  const currentActiveMarkets = getActiveMarketsAt(nowUtc());
  if (JSON.stringify(currentActiveMarkets) !== JSON.stringify(tokenState.activeMarkets)) {
    return buildPublicState({
      ...tokenState,
      status: SESSION_STATUS.ERROR,
      diagnostics: {
        ...tokenState.diagnostics,
        blockedReasons: [
          ...new Set([...(tokenState.diagnostics?.blockedReasons ?? []), "ACTIVE_MARKET_STATE_CHANGED"]),
        ],
      },
    });
  }

  const state = {
    ...tokenState,
    maxProviderCallsPerInvocation: parseMaxProviderCallsPerInvocation(
      options.maxProviderCallsPerInvocation ?? tokenState.maxProviderCallsPerInvocation,
    ),
  };

  return processNextSnapshotBatch({ state, eligibleAssets });
}

export function attachSnapshotToken(publicState) {
  const {
    snapshotToken: _snapshotToken,
    tokenRequiredForContinuation: _tokenRequiredForContinuation,
    tokenStatus: _tokenStatus,
    ...stateForToken
  } = publicState;
  const token = publicState.isGlobalTop8Final ? null : encodeScanSnapshotToken(stateForToken);
  return {
    ...publicState,
    snapshotToken: token,
    tokenRequiredForContinuation: publicState.isGlobalTop8Final ? false : true,
    tokenStatus: token ? "SIGNED" : "SIGNING_SECRET_NOT_CONFIGURED",
  };
}

export function finalizeScanSnapshot(tokenState) {
  return buildPublicState(tokenState);
}
