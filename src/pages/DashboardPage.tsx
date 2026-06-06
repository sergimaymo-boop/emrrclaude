import { useEffect, useRef, useState } from "react";
import { ActionButtons } from "../components/ActionButtons";
import { FearGreedPanel } from "../components/FearGreedPanel";
import { MasterIndicatorsGrid } from "../components/MasterIndicatorsGrid";
import { RallyLeadersPanel } from "../components/RallyLeadersPanel";
import { ScanStatusPanel } from "../components/ScanStatusPanel";
import { SectorLeaders } from "../components/SectorLeaders";
import { StickyMiniHeader } from "../components/StickyMiniHeader";
import { SystemStatusCards } from "../components/SystemStatusCards";
import { TechnicalHeader } from "../components/TechnicalHeader";
import { Toast } from "../components/Toast";
import { Top8Grid } from "../components/Top8Grid";
import {
  initialSystemStatus,
  unavailableFearGreed,
  unavailableMasterIndicators,
  unavailableSectors,
  unavailableTop8,
} from "../data/emptyDashboardData";
import {
  buildDashboardTop8FromScanSnapshot,
  continueScanSnapshot,
  deriveDashboardDataMode,
  deriveIndicatorsDataMode,
  fetchLastScanSnapshot,
  fetchMasterIndicators,
  fetchVisibleTop8Quotes,
  finalizeScanSnapshot,
  mergeMasterIndicators,
  mergeScanSnapshotUniverseStatus,
  mergeVisibleTop8Quotes,
  startScanSnapshot,
  updateSystemStatusForDataMode,
} from "../services/realDataRefresh";
import type { FearGreed, MasterIndicator, ScanState, SectorLeader, SystemStatus, TimestampPair, Top8Asset } from "../types";
import { ERROR_SCORE_INPUT_INTEGRITY } from "../utils/operationalDataPolicy";
import { refreshSystemMarketStatus, refreshTop8MarketStatus } from "../utils/systemStatus";
import { shareTop8 } from "../utils/export";
import { createTimestampPair } from "../utils/time";
import {
  type MarketRegime,
  type RallyState,
  continueRallyScan,
  fetchLastRallyScan,
  fetchMarketRegime,
  initialRallyState,
  startRallyScan,
} from "../services/rallyRefresh";
import { IntraDayFlowsPanel, type IntraDayFlowsState, initialFlowsState } from "../components/IntraDayFlowsPanel";

interface DashboardPageProps {
  onLogout: () => void;
}

interface ToastState {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

const SCAN_STATE_STORAGE_KEY = "emrr_scan_state";
const SESSION_CACHE_STORAGE_KEY = "emrr_session_cache";
const SESSION_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_AUTO_BATCH_RETRIES = 2;

interface SessionCache {
  masterIndicators?: {
    data: MasterIndicator[];
    timestamp: TimestampPair;
    dataMode: SystemStatus["dashboardDataMode"];
  };
  scanState?: Partial<ScanState>;
  top8Result?: {
    assets: Top8Asset[];
    timestamp: TimestampPair;
  };
  sessionTimestamp: string;
}

function loadStoredScanState(): Partial<ScanState> | null {
  try {
    const raw = window.localStorage.getItem(SCAN_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScanState>;
    if (!parsed.scanId || !parsed.snapshotToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeScanState(scanState: Partial<ScanState>) {
  if (!scanState.scanId || !scanState.snapshotToken || scanState.coveragePercent === 100) {
    window.localStorage.removeItem(SCAN_STATE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    SCAN_STATE_STORAGE_KEY,
    JSON.stringify({
      scanId: scanState.scanId,
      snapshotToken: scanState.snapshotToken,
      status: scanState.status,
      resultScope: scanState.resultScope,
      coveragePercent: scanState.coveragePercent,
      batchesTotal: scanState.batchesTotal,
      batchesCompleted: scanState.batchesCompleted,
      nextBatchIndex: scanState.nextBatchIndex,
      estimatedProviderCalls: scanState.estimatedProviderCalls,
      actualProviderCalls: scanState.actualProviderCalls,
      candidatesAnalysed: scanState.candidatesAnalysed,
      recommendedNextAction: scanState.recommendedNextAction,
    }),
  );
}

function loadSessionCache(): SessionCache | null {
  try {
    const raw = window.localStorage.getItem(SESSION_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCache;
    const timestamp = new Date(parsed.sessionTimestamp);
    if (Number.isNaN(timestamp.getTime())) return null;
    if (Date.now() - timestamp.getTime() > SESSION_CACHE_TTL_MS) {
      window.localStorage.removeItem(SESSION_CACHE_STORAGE_KEY);
      window.localStorage.removeItem(SCAN_STATE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSessionCache(cache: Partial<SessionCache>) {
  const current = loadSessionCache() ?? { sessionTimestamp: new Date().toISOString() };
  window.localStorage.setItem(
    SESSION_CACHE_STORAGE_KEY,
    JSON.stringify({
      ...current,
      ...cache,
      sessionTimestamp: new Date().toISOString(),
    }),
  );
}

function clearSessionCacheForNewScan() {
  window.localStorage.removeItem(SESSION_CACHE_STORAGE_KEY);
  window.localStorage.removeItem(SCAN_STATE_STORAGE_KEY);
}

export function DashboardPage({ onLogout }: DashboardPageProps) {
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(initialSystemStatus);
  const [fearGreed, setFearGreed] = useState<FearGreed>(unavailableFearGreed);
  const [masterIndicators, setMasterIndicators] = useState<MasterIndicator[]>(unavailableMasterIndicators);
  const [sectors, setSectors] = useState<SectorLeader[]>(unavailableSectors);
  const [top8, setTop8] = useState<Top8Asset[]>(unavailableTop8);
  const [scanState, setScanState] = useState<ScanState>({
    label: "Ready for SCAN FULL",
    isScanning: false,
    lastRun: initialSystemStatus.lastScan,
    lastRealDataUpdate: null,
    lastScanClicked: initialSystemStatus.lastScan,
    scanExecutionMode: "NO_REAL_DATA",
    refreshedCount: 0,
    scanId: null,
    snapshotToken: null,
    status: "DATA_UNAVAILABLE",
    resultScope: "UNAVAILABLE",
    coveragePercent: 0,
    batchesTotal: 0,
    batchesCompleted: 0,
    nextBatchIndex: null,
    estimatedProviderCalls: 0,
    actualProviderCalls: 0,
    candidatesAnalysed: 0,
    recommendedNextAction: "SCAN_FULL_REQUIRED",
  });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [exportText, setExportText] = useState("");
  const [rallyState, setRallyState] = useState<RallyState>(initialRallyState());
  const [marketRegime, setMarketRegime] = useState<MarketRegime>("UNKNOWN");
  const rallyAbortRef = useRef(false);
  const [flowsState, setFlowsState] = useState<IntraDayFlowsState>(initialFlowsState());

  function showToast(message: string, tone: ToastState["tone"]) {
    setToast({ id: Date.now(), message, tone });
  }

  useEffect(() => {
    const sessionCache = loadSessionCache();
    if (sessionCache?.masterIndicators?.data.length) {
      const cachedIndicators = sessionCache.masterIndicators.data.map((indicator) => ({
        ...indicator,
        dataMode: indicator.dataMode === "REAL" ? "LAST_SESSION" as const : indicator.dataMode,
        operationalBlockReasons: [
          ...new Set([...indicator.operationalBlockReasons, "LAST_SESSION_CACHE_REQUIRES_REFRESH"]),
        ],
      }));
      setMasterIndicators(cachedIndicators);
      setSystemStatus((current) =>
        updateSystemStatusForDataMode(
          refreshSystemMarketStatus(current),
          deriveDashboardDataMode([], cachedIndicators),
          null,
        ),
      );
    }

    if (sessionCache?.top8Result?.assets.length && sessionCache.scanState?.coveragePercent === 100) {
      setTop8(sessionCache.top8Result.assets);
    }

    if (sessionCache?.scanState?.scanId && sessionCache.scanState.snapshotToken) {
      setScanState((current) => ({
        ...current,
        ...sessionCache.scanState,
        label:
          sessionCache.scanState.coveragePercent === 100
            ? "GLOBAL TOP 8 FINAL restored from session"
            : `Previous scan available - batch ${sessionCache.scanState.nextBatchIndex ?? "?"}/${sessionCache.scanState.batchesTotal ?? "?"}`,
        scanExecutionMode:
          sessionCache.scanState.coveragePercent === 100 ? "GLOBAL_TOP8_FINAL" : "PARTIAL_BATCH_ONLY",
      }));
    }

    const storedScan = loadStoredScanState();
    if (storedScan) {
      setScanState((current) => ({
        ...current,
        ...storedScan,
        label: `TOP 8 PARTIAL DIAGNOSTIC - coverage ${storedScan.coveragePercent ?? 0}%`,
        scanExecutionMode: "PARTIAL_BATCH_ONLY",
      }));
    }

    fetchMasterIndicators()
      .then((response) => {
        const mergedIndicators = mergeMasterIndicators(unavailableMasterIndicators, response);
        setMasterIndicators(mergedIndicators.indicators);
        saveSessionCache({
          masterIndicators: {
            data: mergedIndicators.indicators,
            timestamp: createTimestampPair(),
            dataMode: deriveIndicatorsDataMode(mergedIndicators.indicators),
          },
        });
        setSystemStatus((current) =>
          updateSystemStatusForDataMode(
            refreshSystemMarketStatus(current),
            deriveDashboardDataMode([], mergedIndicators.indicators, {
              coveragePercent: current.technical.universeStats.coveragePercent ?? 0,
            }),
            mergedIndicators.lastRealDataUpdate ?? current.lastRealDataUpdate,
          ),
        );
      })
      .catch(() => {
        setMasterIndicators(unavailableMasterIndicators);
      });

    const hasTop8InSession = Boolean(sessionCache?.top8Result?.assets.length && sessionCache.scanState?.coveragePercent === 100);
    if (!hasTop8InSession) {
      fetchLastScanSnapshot()
        .then((snapshot) => {
          if (!snapshot) return;
          const lastTop8 = buildDashboardTop8FromScanSnapshot(snapshot);
          if (lastTop8.length === 0) return;
          setTop8(lastTop8);
          setSystemStatus((current) => mergeScanSnapshotUniverseStatus(current, snapshot));
          const lastSessionScope = "GLOBAL_TOP8_FINAL" as const;
          setScanState((current) => ({
            ...current,
            scanId: snapshot.scanId,
            coveragePercent: snapshot.coveragePercent,
            batchesTotal: snapshot.batchesTotal,
            batchesCompleted: snapshot.batchesCompleted,
            resultScope: lastSessionScope,
            scanExecutionMode: lastSessionScope,
            label: `LAST SESSION TOP 8 - ${snapshot.scanCompletedAtUtc ? new Date(snapshot.scanCompletedAtUtc).toLocaleDateString() : "cached"}`,
          }));
        })
        .catch(() => {
          showToast("Sin datos de sesión anterior", "info");
        });
    }
  }, []);

  useEffect(() => {
    function refreshClockAndMarkets() {
      setSystemStatus((current) => refreshSystemMarketStatus(current));
      setTop8((current) => refreshTop8MarketStatus(current));
    }

    refreshClockAndMarkets();
    const timer = window.setInterval(refreshClockAndMarkets, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function latestTimestamp(...timestamps: Array<TimestampPair | null>): TimestampPair | null {
    return timestamps
      .filter((timestamp): timestamp is TimestampPair => Boolean(timestamp))
      .sort((a, b) => a.utc.localeCompare(b.utc))
      .at(-1) ?? null;
  }

  function candidatesAnalysedFromSnapshot(snapshot: Awaited<ReturnType<typeof startScanSnapshot>>) {
    return snapshot.diagnostics?.processedBatches?.reduce(
      (total, batch) => total + (batch.evaluationSummary?.analyzed ?? batch.selectedAssets ?? 0),
      0,
    ) ?? 0;
  }

  function snapshotNeedsContinuation(snapshot: Awaited<ReturnType<typeof startScanSnapshot>>) {
    const notFullyCovered = snapshot.coveragePercent !== 100;
    return Boolean(
      snapshot.snapshotToken &&
        notFullyCovered &&
        snapshot.nextBatchIndex &&
        snapshot.batchesCompleted < snapshot.batchesTotal,
    );
  }

  async function applyAndMaybeContinueSnapshot(
    snapshot: Awaited<ReturnType<typeof startScanSnapshot>>,
    startedAt: TimestampPair,
    suppressToast = true,
  ) {
    await applySnapshotResult(Promise.resolve(snapshot), startedAt, {
      keepScanning: snapshotNeedsContinuation(snapshot),
      suppressToast,
    });
  }

  async function runAutoChainedScan(startedAt: TimestampPair) {
    let snapshot = await startScanSnapshot();
    await applyAndMaybeContinueSnapshot(snapshot, startedAt, true);

    let guard = 0;
    while (snapshotNeedsContinuation(snapshot)) {
      guard += 1;
      if (guard > Math.max(snapshot.batchesTotal + 2, 10)) {
        throw new Error("AUTO_SCAN_GUARD_STOPPED");
      }

      const expectedBatch = snapshot.nextBatchIndex;
      setScanState((current) => ({
        ...current,
        label: `Analizando... batch ${expectedBatch}/${snapshot.batchesTotal} (${snapshot.coveragePercent}%)`,
        isScanning: true,
        scanExecutionMode: "SCAN_SNAPSHOT",
      }));

      let lastError: unknown = null;
      let advanced = false;
      for (let attempt = 0; attempt <= MAX_AUTO_BATCH_RETRIES; attempt += 1) {
        try {
          const previousCompleted = snapshot.batchesCompleted;
          const nextSnapshot = await continueScanSnapshot(snapshot.snapshotToken ?? "");
          if (nextSnapshot.batchesCompleted <= previousCompleted && nextSnapshot.status !== "GLOBAL_TOP8_FINAL") {
            throw new Error("BATCH_DID_NOT_ADVANCE");
          }
          snapshot = nextSnapshot;
          advanced = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!advanced) {
        setScanState((current) => ({
          ...current,
          label: `Auto scan paused - continue manually from batch ${expectedBatch}/${snapshot.batchesTotal}`,
          isScanning: false,
          recommendedNextAction: "CONTINUE_SCAN_MANUALLY_AFTER_BATCH_ERROR",
        }));
        showToast(
          lastError instanceof Error
            ? `Batch ${expectedBatch} failed after retries: ${lastError.message}`
            : `Batch ${expectedBatch} failed after retries`,
          "error",
        );
        return;
      }

      await applyAndMaybeContinueSnapshot(snapshot, startedAt, true);
    }

    if (snapshot.snapshotToken && snapshot.coveragePercent === 100) {
      snapshot = await finalizeScanSnapshot(snapshot.snapshotToken);
      await applySnapshotResult(Promise.resolve(snapshot), startedAt, {
        keepScanning: false,
        suppressToast: false,
      });
      return;
    }

    await applySnapshotResult(Promise.resolve(snapshot), startedAt, {
      keepScanning: false,
      suppressToast: false,
    });
  }

  async function applySnapshotResult(
    snapshotResult: Promise<Awaited<ReturnType<typeof startScanSnapshot>>>,
    startedAt: TimestampPair,
    options: { keepScanning?: boolean; suppressToast?: boolean } = {},
  ) {
    const [snapshotSettled, masterIndicatorsResult] = await Promise.allSettled([
      snapshotResult,
      fetchMasterIndicators(),
    ] as const);

    let nextTop8: Top8Asset[] = [];
    let nextIndicators = masterIndicators;
    let statusBase = refreshSystemMarketStatus(systemStatus);
    let quoteRealUpdate: TimestampPair | null = null;
    let indicatorRealUpdate: TimestampPair | null = null;
    let nextScanExecutionMode: ScanState["scanExecutionMode"] = "NO_REAL_DATA";
    let nextSnapshotToken: string | null = null;
    let nextScanLabel = "TOP 8 DATA UNAVAILABLE";
    let nextSnapshotFields: Partial<ScanState> = {};

    if (snapshotSettled.status === "fulfilled") {
      const snapshot = snapshotSettled.value;
      statusBase = mergeScanSnapshotUniverseStatus(statusBase, snapshot);
      nextTop8 = buildDashboardTop8FromScanSnapshot(snapshot);
      nextSnapshotToken = snapshot.snapshotToken ?? null;
      nextSnapshotFields = {
        scanId: snapshot.scanId,
        snapshotToken: nextSnapshotToken,
        status: snapshot.status,
        resultScope: snapshot.resultScope,
        coveragePercent: snapshot.coveragePercent,
        batchesTotal: snapshot.batchesTotal,
        batchesCompleted: snapshot.batchesCompleted,
        nextBatchIndex: snapshot.nextBatchIndex,
        estimatedProviderCalls: snapshot.estimatedProviderCalls,
        actualProviderCalls: snapshot.actualProviderCalls,
        candidatesAnalysed: candidatesAnalysedFromSnapshot(snapshot),
        recommendedNextAction: snapshot.recommendedNextAction,
      };
      storeScanState(nextSnapshotFields);
      nextScanExecutionMode = snapshot.isGlobalTop8Final
        ? "GLOBAL_TOP8_FINAL"
        : snapshot.batchesCompleted > 0
          ? "PARTIAL_BATCH_ONLY"
          : snapshot.status === "ERROR"
            ? "ERROR"
            : "NO_REAL_DATA";
      nextScanLabel = snapshot.isGlobalTop8Final
        ? "GLOBAL TOP 8 FINAL completed"
        : snapshot.batchesCompleted > 0
          ? `TOP 8 PARTIAL DIAGNOSTIC - coverage ${snapshot.coveragePercent}%`
          : "TOP 8 DATA UNAVAILABLE";
    } else {
      window.localStorage.removeItem(SCAN_STATE_STORAGE_KEY);
      statusBase = {
        ...statusBase,
        operationalDataStatus: "ERROR",
        operationalDecisionAllowed: false,
        operationalBlockReasons: ["SCAN_SNAPSHOT_ENDPOINT_UNAVAILABLE"],
      };
      nextScanExecutionMode = "ERROR";
      nextScanLabel = "Scan snapshot failed";
    }

    if (nextTop8.length > 0) {
      try {
        const visibleQuotes = await fetchVisibleTop8Quotes(nextTop8);
        const mergedTop8 = mergeVisibleTop8Quotes(nextTop8, visibleQuotes);
        nextTop8 = mergedTop8.top8;
        quoteRealUpdate = mergedTop8.lastRealDataUpdate;
      } catch {
        nextTop8 = nextTop8.map((asset) => ({
          ...asset,
          dataMode: "DATA_UNAVAILABLE",
          priceDataMode: "DATA_UNAVAILABLE",
          price: "N/A",
          priceChangePercent: 0,
          cacheStatus: "ERROR",
          operationalDataStatus: "DATA_UNAVAILABLE",
          operationalDecisionAllowed: false,
          operationalBlockReasons: ["VISIBLE_QUOTES_ENDPOINT_UNAVAILABLE", "REAL_SCORE_INPUTS_REQUIRED"],
          scoreInputIntegrity: ERROR_SCORE_INPUT_INTEGRITY,
          execDisabledReason: "Visible quote refresh failed - DATA UNAVAILABLE; EXEC disabled",
          action: asset.marketStatus === "OPEN" && (asset.action === "EXEC" || asset.action === "CLOSED_CONTEXT") ? "BLOCKED" : asset.action,
        }));
      }
    }

    if (masterIndicatorsResult.status === "fulfilled") {
      const mergedIndicators = mergeMasterIndicators(unavailableMasterIndicators, masterIndicatorsResult.value);
      nextIndicators = mergedIndicators.indicators;
      indicatorRealUpdate = mergedIndicators.lastRealDataUpdate;
    } else {
      nextIndicators = unavailableMasterIndicators.map((indicator) => ({
        ...indicator,
        dataMode: "DATA_UNAVAILABLE",
        provider: "none",
        source: "none",
        cacheStatus: "ERROR",
        status: "NOT_AVAILABLE",
      }));
    }

    const lastRealDataUpdate = latestTimestamp(quoteRealUpdate, indicatorRealUpdate, systemStatus.lastRealDataUpdate);
    const dashboardDataMode = deriveDashboardDataMode(nextTop8, nextIndicators, {
      isScanning: options.keepScanning,
      coveragePercent: nextSnapshotFields.coveragePercent,
    });
    const nextSystemStatus = updateSystemStatusForDataMode(
      statusBase,
      dashboardDataMode,
      lastRealDataUpdate,
    );

    setSystemStatus(nextSystemStatus);
    setFearGreed({
      ...unavailableFearGreed,
      timestamp: startedAt,
      operationalBlockReasons: ["NO_APPROVED_REAL_FEAR_GREED_SOURCE"],
    });
    setMasterIndicators(nextIndicators);
    setSectors(unavailableSectors);
    setTop8(nextTop8);
    const nextCachedScanState = {
      ...nextSnapshotFields,
      label: nextScanLabel,
      lastRealDataUpdate,
      lastScanClicked: startedAt,
      scanExecutionMode: nextScanExecutionMode,
    };
    saveSessionCache({
      masterIndicators: {
        data: nextIndicators,
        timestamp: createTimestampPair(),
        dataMode: deriveIndicatorsDataMode(nextIndicators),
      },
      scanState: nextCachedScanState,
      top8Result:
        (nextSnapshotFields.coveragePercent ?? 0) === 100 && nextTop8.length > 0
          ? {
              assets: nextTop8,
              timestamp: createTimestampPair(),
            }
          : undefined,
    });
    setScanState((current) => ({
      ...current,
      ...nextSnapshotFields,
      label: nextScanLabel,
      isScanning: options.keepScanning === true,
      lastRun: nextSystemStatus.lastScan,
      lastRealDataUpdate,
      lastScanClicked: startedAt,
      scanExecutionMode: nextScanExecutionMode,
      refreshedCount: current.refreshedCount + 1,
    }));
    if (!options.suppressToast) {
      showToast(
        nextScanExecutionMode === "ERROR"
          ? "Scan snapshot failed - DATA UNAVAILABLE"
          : nextScanExecutionMode === "GLOBAL_TOP8_FINAL"
            ? "Global TOP 8 final completed"
            : "Partial diagnostic saved - continue scan to reach 100% coverage",
        nextScanExecutionMode === "ERROR" ? "error" : "info",
      );
    }
  }

  async function handleScan() {
    if (scanState.isScanning) return;

    clearSessionCacheForNewScan();
    const startedAt = createTimestampPair();
    setScanState((current) => ({
      ...current,
      label: "SCAN FULL running...",
      isScanning: true,
      lastRun: startedAt,
      lastScanClicked: startedAt,
      scanExecutionMode: "SCAN_SNAPSHOT",
    }));
    setSystemStatus((current) =>
      updateSystemStatusForDataMode(refreshSystemMarketStatus(current), "SCANNING", current.lastRealDataUpdate),
    );

    const scanDelay = new Promise((resolve) => window.setTimeout(resolve, 700));
    try {
      await Promise.all([scanDelay, runAutoChainedScan(startedAt)]);
    } catch (error) {
      setScanState((current) => ({
        ...current,
        label: "Scan snapshot failed - manual retry available",
        isScanning: false,
        scanExecutionMode: "ERROR",
      }));
      setSystemStatus((current) =>
        updateSystemStatusForDataMode(refreshSystemMarketStatus(current), "ERROR", current.lastRealDataUpdate),
      );
      showToast(error instanceof Error ? error.message : "Scan snapshot failed", "error");
    }
  }

  async function handleContinueScan() {
    if (scanState.isScanning || !scanState.snapshotToken) return;

    const startedAt = createTimestampPair();
    setScanState((current) => ({
      ...current,
      label: "CONTINUE SCAN running...",
      isScanning: true,
      lastScanClicked: startedAt,
      scanExecutionMode: "SCAN_SNAPSHOT",
    }));

    const scanDelay = new Promise((resolve) => window.setTimeout(resolve, 700));
    await Promise.all([
      scanDelay,
      applySnapshotResult(continueScanSnapshot(scanState.snapshotToken), startedAt, {
        keepScanning: false,
        suppressToast: false,
      }),
    ]);
  }

  async function handleCopyTop8() {
    const result = await shareTop8(top8, (text) => setExportText(text));
    if (result === "shared") showToast("Compartido correctamente", "success");
    else if (result === "copied") showToast("Copiado al portapapeles", "success");
    else showToast("Listo para copiar manualmente", "info");
  }

  // ─── Rally Leaders Engine handlers ───────────────────────────────────────

  async function handleScanRally() {
    if (rallyState.isScanning || scanState.isScanning) return;
    rallyAbortRef.current = false;

    setRallyState(prev => ({
      ...prev,
      status: "RALLY_SCANNING",
      isScanning: true,
      label: "Rally scan running…",
      coveragePercent: 0,
      batchesCompleted: 0,
      top10: [],
    }));

    try {
      let response = await startRallyScan();

      if (!response.ok && response.error) {
        setRallyState(prev => ({
          ...prev,
          status: "RALLY_DATA_UNAVAILABLE",
          isScanning: false,
          label: response.message ?? "Rally scan unavailable",
        }));
        showToast(response.message ?? "Rally scan failed", "error");
        return;
      }

      setRallyState(prev => ({
        ...prev,
        scanId: response.scanId ?? null,
        rallyToken: response.rallyToken ?? null,
        coveragePercent: response.coveragePercent ?? 0,
        batchesCompleted: response.batchesCompleted ?? 0,
        batchesTotal: response.batchesTotal ?? 0,
        top10: response.top10 ?? [],
        label: response.isRallyFinal
          ? `Rally Leaders — ${(response.top10 ?? []).length} líderes encontrados`
          : `Rally scan batch ${response.batchesCompleted}/${response.batchesTotal}…`,
      }));

      // Continue batches until complete
      while (!response.isRallyFinal && response.rallyToken && !rallyAbortRef.current) {
        response = await continueRallyScan(response.rallyToken);

        setRallyState(prev => ({
          ...prev,
          rallyToken: response.rallyToken ?? null,
          coveragePercent: response.coveragePercent ?? prev.coveragePercent,
          batchesCompleted: response.batchesCompleted ?? prev.batchesCompleted,
          top10: response.top10 ?? prev.top10,
          label: response.isRallyFinal
            ? `Rally Leaders — ${(response.top10 ?? []).length} líderes encontrados`
            : `Rally scan batch ${response.batchesCompleted}/${response.batchesTotal}…`,
        }));
      }

      const finalTop10 = response.top10 ?? [];
      setRallyState(prev => ({
        ...prev,
        status: response.isRallyFinal ? "RALLY_FINAL" : "RALLY_PARTIAL_DIAGNOSTIC",
        isScanning: false,
        rallyToken: null,
        coveragePercent: response.coveragePercent ?? prev.coveragePercent,
        top10: finalTop10,
        label: response.isRallyFinal
          ? `Rally Leaders Final — ${finalTop10.length} líderes`
          : `Rally Partial — ${finalTop10.length} encontrados`,
        lastRun: new Date().toLocaleString(),
      }));

      if (response.isRallyFinal) {
        showToast(`Rally Leaders Final — ${finalTop10.length} líderes identificados`, "success");
      }
    } catch (error) {
      setRallyState(prev => ({
        ...prev,
        status: "RALLY_ERROR",
        isScanning: false,
        label: "Rally scan error",
      }));
      showToast("Rally scan failed", "error");
    }
  }

  // ─── Intraday Flows handler ───────────────────────────────────────────────

  async function handleScanFlows() {
    if (flowsState.status === "SCANNING") return;
    setFlowsState(prev => ({ ...prev, status: "SCANNING" }));
    try {
      const res = await fetch("/api/sector-leaders-data?mode=intraday");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Flows scan failed");
      setFlowsState({
        status: "DONE",
        scannedAt: data.scannedAtUtc ?? new Date().toISOString(),
        marketOpen: data.marketOpen ?? false,
        spy: data.spy ?? null,
        sectors: data.sectors ?? [],
        note: data.note ?? "",
      });
      showToast(`Flujos detectados — ${data.sectors?.length ?? 0} sectores analizados`, "success");
    } catch (error) {
      setFlowsState(prev => ({ ...prev, status: "ERROR" }));
      showToast("Error en scan de flujos", "error");
    }
  }

  // Load last rally scan + market regime on mount
  useEffect(() => {
    fetchLastRallyScan().then(snapshot => {
      if (!snapshot || !snapshot.top10?.length) return;
      setRallyState(prev => ({
        ...prev,
        status: "RALLY_FINAL",
        scanId: snapshot.scanId ?? null,
        top10: snapshot.top10 ?? [],
        coveragePercent: 100,
        label: `Rally Leaders — sesión anterior`,
        lastRun: snapshot.scanCompletedAtUtc
          ? new Date(snapshot.scanCompletedAtUtc).toLocaleString()
          : new Date().toLocaleString(),
      }));
    }).catch(() => {});

    // Market regime — internal SPY vs EMA200 analysis
    fetchMarketRegime().then(setMarketRegime).catch(() => {});
  }, []);

  return (
    <main className="dashboard-shell">
      <StickyMiniHeader
        systemStatus={systemStatus}
        onScan={handleScan}
        isScanning={scanState.isScanning}
        onScanRally={handleScanRally}
        isRallyScanning={rallyState.isScanning}
        onScanFlows={handleScanFlows}
        isFlowsScanning={flowsState.status === "SCANNING"}
        onLogout={onLogout}
      />
      {/* Market Regime semaphore — internal analysis, only label shown */}
      {marketRegime !== "UNKNOWN" && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "8px 16px",
          margin: "0 0 4px",
          borderRadius: 999,
          background: marketRegime === "BULLISH" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
          border: `1px solid ${marketRegime === "BULLISH" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
        }}>
          <span style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: marketRegime === "BULLISH" ? "#10b981" : "#ef4444",
            boxShadow: `0 0 10px ${marketRegime === "BULLISH" ? "#10b981" : "#ef4444"}`,
          }} />
          <span style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: marketRegime === "BULLISH" ? "#10b981" : "#ef4444",
          }}>
            {marketRegime === "BULLISH" ? "Régimen Alcista" : "Régimen Bajista"}
          </span>
        </div>
      )}
      <TechnicalHeader systemStatus={systemStatus} onLogout={onLogout} />
      <ScanStatusPanel scanState={scanState} />
      <FearGreedPanel fearGreed={fearGreed} />
      <IntraDayFlowsPanel flowsState={flowsState} />
      <MasterIndicatorsGrid indicators={masterIndicators} />
      <RallyLeadersPanel rallyState={rallyState} onScanRally={handleScanRally} />
      <Top8Grid assets={top8} />
      <SectorLeaders sectors={sectors} />
      <ActionButtons
        onScan={handleScan}
        onContinueScan={handleContinueScan}
        onCopy={handleCopyTop8}
        isScanning={scanState.isScanning}
        canContinueScan={Boolean(scanState.snapshotToken && scanState.coveragePercent !== 100)}
        continueLabel={
          scanState.nextBatchIndex && scanState.batchesTotal
            ? `Continuar scan (batch ${scanState.nextBatchIndex}/${scanState.batchesTotal})`
            : "Continuar scan"
        }
      />
      <SystemStatusCards systemStatus={systemStatus} />
      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} /> : null}
    </main>
  );
}
