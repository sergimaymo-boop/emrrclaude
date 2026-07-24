import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FearGreedPanel } from "../components/FearGreedPanel";
import { StickyMiniHeader } from "../components/StickyMiniHeader";
import { SystemStatusCards } from "../components/SystemStatusCards";
import { TechnicalHeader } from "../components/TechnicalHeader";
import { Toast } from "../components/Toast";
import {
  initialSystemStatus,
  unavailableFearGreed,
  unavailableMasterIndicators,
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
import type { FearGreed, MasterIndicator, ScanState, SystemStatus, TimestampPair, Top8Asset } from "../types";
import { ERROR_SCORE_INPUT_INTEGRITY } from "../utils/operationalDataPolicy";
import { refreshSystemMarketStatus, refreshTop8MarketStatus } from "../utils/systemStatus";
import { getRegionalMarketStates } from "../utils/marketHours";
import { shareFullExport } from "../utils/export";
import { createTimestampPair } from "../utils/time";
import {
  type MarketBreadthResult,
  fetchMarketBreadth,
  initialMarketBreadth,
  runBreadthScan,
  enrichBreadthWithLiveQuotes,
} from "../services/marketBreadthRefresh";
import { MarketBreadthPanel } from "../components/MarketBreadthPanel";
import { type MarketRisk, fetchMarketRisk, initialMarketRisk } from "../services/marketRiskRefresh";
import { MarketRiskGauge } from "../components/MarketRiskGauge";
import { IntraDayFlowsPanel, type IntraDayFlowsState, initialFlowsState } from "../components/IntraDayFlowsPanel";
import { type ScanPhase } from "../components/StickyMiniHeader";
import { pushNotifications } from "../services/pushNotifications";
import { ScanSummaryBar } from "../components/ScanSummaryBar";
import { Optimal2026Panel } from "../components/Optimal2026Panel";
import {
  type Optimal2026Result,
  fetchOptimal2026,
  initialOptimal2026,
  enrichOptimal2026WithLiveQuotes,
} from "../services/optimal2026Refresh";

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
  // Consolidación 24-jul-2026: estados de rally/marketRegime/monetaryCycle/fable01 eliminados —
  // solo alimentaban a los módulos desactivados (Señal Óptima, FABLE01, CLAUDE01, TOP8 UI).
  const [flowsState, setFlowsState] = useState<IntraDayFlowsState>(initialFlowsState());
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [marketBreadth, setMarketBreadth] = useState<MarketBreadthResult>(initialMarketBreadth());
  const [marketRisk, setMarketRisk] = useState<MarketRisk>(initialMarketRisk());
  const [optimal2026, setOptimal2026] = useState<Optimal2026Result>(initialOptimal2026());
  const optimal2026Ref = useRef<Optimal2026Result>(optimal2026);
  useEffect(() => { optimal2026Ref.current = optimal2026; }, [optimal2026]);
  const [o26ScanProgress, setO26ScanProgress] = useState<number | null>(null);
  const marketBreadthRef = useRef<MarketBreadthResult>(marketBreadth);
  useEffect(() => { marketBreadthRef.current = marketBreadth; }, [marketBreadth]);
  // Ref espejo de flowsState para que el intervalo de auto-refresco (deps []) lea SIEMPRE
  // el estado actual, no el capturado al montar (evita relanzar runFlows durante un scan).
  const flowsStateRef = useRef<IntraDayFlowsState>(flowsState);
  useEffect(() => { flowsStateRef.current = flowsState; }, [flowsState]);
  const loadOptimal2026 = useCallback(async () => {
    try {
      const res = await fetchOptimal2026();
      if (res.items && res.items.length) {
        const enriched = await enrichOptimal2026WithLiveQuotes(res.items);
        setOptimal2026(prev => {
          const prevMap = new Map((prev.items ?? []).map(it => [it.symbol, it]));
          const items = enriched.map(item => {
            const prevItem = prevMap.get(item.symbol);
            // Si este item NO fue enriquecido con precio en vivo (sin priceRefreshedAt) pero
            // el estado previo sí lo tenía, conservar ese precio para evitar regresión
            // al cierre del scan cuando el enriquecimiento falla temporalmente.
            if (!item.priceRefreshedAt && prevItem?.priceRefreshedAt && prevItem.price != null) {
              return { ...item, price: prevItem.price, pctDay: prevItem.pctDay, priceRefreshedAt: prevItem.priceRefreshedAt };
            }
            return item;
          });
          return { ...res, items };
        });
      } else {
        setOptimal2026(res);
      }
    } catch { /* conserva el estado actual */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Amplitud — veredicto cacheado + precios en VIVO de la watchlist (el veredicto/ranking no cambia).
  async function loadMarketBreadth() {
    try {
      const res = await fetchMarketBreadth();
      setMarketBreadth(res);
      const enriched = await enrichBreadthWithLiveQuotes(res);
      setMarketBreadth(enriched);
    } catch { /* conserva el estado actual */ }
  }

  function showToast(message: string, tone: ToastState["tone"]) {
    setToast({ id: Date.now(), message, tone });
  }

  // Ref con el Top 8 visible actual — lo usa el refresco periódico de
  // cotizaciones sin depender de un closure obsoleto.
  const top8Ref = useRef<Top8Asset[]>(top8);
  useEffect(() => { top8Ref.current = top8; }, [top8]);

  // Refs for masterIndicators and systemStatus — prevent stale closures in
  // applySnapshotResult during multi-batch auto-chained scans (audit fix).
  const masterIndicatorsRef = useRef<MasterIndicator[]>(masterIndicators);
  useEffect(() => { masterIndicatorsRef.current = masterIndicators; }, [masterIndicators]);
  const systemStatusRef = useRef<SystemStatus>(systemStatus);
  useEffect(() => { systemStatusRef.current = systemStatus; }, [systemStatus]);
  // Ref de "scan en curso" para que los intervals (closures) sepan si hay un scan activo
  // sin depender de estado obsoleto (audit fix: no refrescar cotizaciones durante un scan).
  const scanActiveRef = useRef(false);
  useEffect(() => { scanActiveRef.current = scanState.isScanning || (scanPhase !== "idle" && scanPhase !== "done"); }, [scanState.isScanning, scanPhase]);


  // AUDIT FIX (DATA_UNAVAILABLE en el Top 8): el scan rankea por score con
  // datos históricos pero NO guarda el precio en vivo — el precio y el % desde
  // cierre anterior vienen SOLO de /api/visible-top8-quotes, que antes solo se
  // pedía al pulsar SCAN. Al restaurar el Top 8 desde caché/última-sesión al
  // cargar la página NO se pedían cotizaciones, así que el precio quedaba en
  // "N/A" y la tarjeta mostraba DATA_UNAVAILABLE. Aquí refrescamos las
  // cotizaciones del Top 8 visible (al montar y periódicamente) para que el
  // precio real aparezca siempre, sin tener que relanzar un scan.
  async function refreshVisibleQuotes(assets: Top8Asset[]) {
    if (!assets || assets.length === 0) return;
    try {
      const visibleQuotes = await fetchVisibleTop8Quotes(assets);
      const merged = mergeVisibleTop8Quotes(assets, visibleQuotes);
      setTop8(merged.top8);
      if (merged.lastRealDataUpdate) {
        setSystemStatus((current) =>
          updateSystemStatusForDataMode(
            refreshSystemMarketStatus(current),
            deriveDashboardDataMode(merged.top8, masterIndicators, {
              coveragePercent: current.technical.universeStats.coveragePercent ?? 0,
            }),
            merged.lastRealDataUpdate,
          ),
        );
      }
    } catch {
      /* mantener el Top 8 actual si el refresco de cotizaciones falla */
    }
  }

  // AUDIT FIX (F&G / Master Indicators "frozen"): este fetch antes solo se
  // ejecutaba UNA VEZ al montar el dashboard (y, de paso, cada vez que el
  // usuario lanzaba un SCAN FULL manual). Eso significa que el score de
  // Fear & Greed y los 7 indicadores de mercado (VIX/SPY/HYG/MOVE/VVIX/LQD/TNX)
  // quedaban congelados en el valor que tenían en el momento de cargar la
  // página — exactamente lo reportado ("los master indicadores...estan mal",
  // "el F&G esta ahora en 42 todavia"). Estos son indicadores de mercado EN
  // VIVO (no sujetos a la regla de "solo mercados abiertos" del scan de
  // tickers) y deben refrescarse periódicamente mientras el dashboard esté
  // abierto. Extraído a función reutilizable + interval de refresco abajo.
  function loadMasterIndicators() {
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
            deriveDashboardDataMode(top8Ref.current, mergedIndicators.indicators, {
              coveragePercent: current.technical.universeStats.coveragePercent ?? 0,
            }),
            mergedIndicators.lastRealDataUpdate ?? current.lastRealDataUpdate,
          ),
        );
      })
      .catch(() => {
        setMasterIndicators((current) => (current.length ? current : unavailableMasterIndicators));
      });
  }

  // Initialize push notifications on mount
  useEffect(() => {
    pushNotifications.initialize().catch(err => console.error("Push notifications init failed:", err));
  }, []);

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
      // Refresca precios reales del Top 8 restaurado (caché) — evita DATA_UNAVAILABLE al cargar.
      refreshVisibleQuotes(sessionCache.top8Result.assets);
    }

    const cachedScanState = sessionCache?.scanState;
    if (cachedScanState?.scanId && cachedScanState.snapshotToken) {
      setScanState((current) => ({
        ...current,
        ...cachedScanState,
        label:
          cachedScanState.coveragePercent === 100
            ? "GLOBAL TOP 8 FINAL restored from session"
            : `Previous scan available - batch ${cachedScanState.nextBatchIndex ?? "?"}/${cachedScanState.batchesTotal ?? "?"}`,
        scanExecutionMode:
          cachedScanState.coveragePercent === 100 ? "GLOBAL_TOP8_FINAL" : "PARTIAL_BATCH_ONLY",
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

    loadMasterIndicators();

    const hasTop8InSession = Boolean(sessionCache?.top8Result?.assets.length && sessionCache.scanState?.coveragePercent === 100);

    // El TOP 8 SIEMPRE muestra el último scan 100% completado guardado en servidor
    // cuando no hay uno en la sesión actual (petición del usuario: "que cargue bien
    // todos los tickets" — antes el panel quedaba VACÍO durante el horario de mercado
    // hasta pulsar SCAN FULL). Los precios se refrescan en vivo (refreshVisibleQuotes)
    // y el label marca "LAST SESSION TOP 8 - fecha", así no se confunde con datos
    // en vivo. Pulsar SCAN FULL recalcula el ranking con los mercados abiertos ahora.
    if (!hasTop8InSession) {
      fetchLastScanSnapshot()
        .then((snapshot) => {
          if (!snapshot) return;
          const lastTop8 = buildDashboardTop8FromScanSnapshot(snapshot);
          if (lastTop8.length === 0) return;
          setTop8(lastTop8);
          // Refresca precios reales del Top 8 de la última sesión — evita DATA_UNAVAILABLE.
          refreshVisibleQuotes(lastTop8);
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

  // AUDIT FIX (F&G / Master Indicators "frozen"): refresco periódico de los
  // indicadores de mercado en vivo (VIX/SPY/HYG/MOVE/VVIX/LQD/TNX), que
  // alimentan tanto "Master Indicators" como el panel "Fear & Greed". Antes
  // SOLO se cargaban una vez al montar — quedaban congelados con el valor de
  // cuando se abrió el dashboard. Estos son indicadores de mercado globales
  // (no tickets de inversión) y deben estar siempre actualizados, sin importar
  // si el mercado de scan está abierto o cerrado — por eso el refresco es
  // incondicional (no depende de bothMarketsClosed / regionalMarkets).
  useEffect(() => {
    const timer = window.setInterval(() => {
      loadMasterIndicators();
    }, 4 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Refresco periódico de las cotizaciones del Top 8 visible (precio + % desde
  // cierre anterior) para que el dashboard muestre datos en vivo sin relanzar
  // un scan. Solo refresca si hay un Top 8 mostrado y no se está escaneando
  // (durante un scan, handleScanAll ya gestiona las cotizaciones).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = top8Ref.current;
      // No refrescar durante un scan: handleScanAll ya gestiona las cotizaciones (evita carrera).
      if (current.length > 0 && !scanActiveRef.current) refreshVisibleQuotes(current);
    }, 90_000);
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
    // Use refs to avoid stale closure during multi-batch auto-chained scans
    let nextIndicators = masterIndicatorsRef.current;
    let statusBase = refreshSystemMarketStatus(systemStatusRef.current);
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
      // When a complete global scan produces 0 candidates (likely provider failures),
      // fall back to the last valid Redis snapshot so the panel stays populated.
      if (snapshot.isGlobalTop8Final && nextTop8.length === 0) {
        try {
          const fallback = await fetchLastScanSnapshot();
          if (fallback) {
            const fallbackTop8 = buildDashboardTop8FromScanSnapshot(fallback);
            if (fallbackTop8.length > 0) nextTop8 = fallbackTop8;
          }
        } catch { /* keep nextTop8 = [] if fallback also fails */ }
      }
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

    const lastRealDataUpdate = latestTimestamp(quoteRealUpdate, indicatorRealUpdate, systemStatusRef.current.lastRealDataUpdate);
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
    // Guarda cruzada: no arrancar si ya corre el SCAN ALL (scanPhase) ni otro scan (audit fix concurrencia).
    if (scanState.isScanning || (scanPhase !== "idle" && scanPhase !== "done")) return;
    const savedScroll = window.scrollY; // keep user's position

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

    // Restore scroll after state update (prevents sticky-header click triggering scroll-to-top on iOS)
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: "instant" }));

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
    if (scanState.isScanning || !scanState.snapshotToken || (scanPhase !== "idle" && scanPhase !== "done")) return;

    const startedAt = createTimestampPair();
    setScanState((current) => ({
      ...current,
      label: "CONTINUE SCAN running...",
      isScanning: true,
      lastScanClicked: startedAt,
      scanExecutionMode: "SCAN_SNAPSHOT",
    }));

    const scanDelay = new Promise((resolve) => window.setTimeout(resolve, 700));
    // try/catch/finally: si applySnapshotResult lanza, no dejar isScanning colgado para siempre
    // (coherente con handleScan). Permite reintentar el CONTINUE.
    try {
      await Promise.all([
        scanDelay,
        applySnapshotResult(continueScanSnapshot(scanState.snapshotToken), startedAt, {
          keepScanning: false,
          suppressToast: false,
        }),
      ]);
    } catch {
      setScanState((current) => ({ ...current, isScanning: false, label: "Continue scan failed — reintenta" }));
      showToast("Continue scan falló — puedes reintentar", "error");
    }
  }

  // ─── SCAN ALL — FLOWS en paralelo con FULL, luego AMPLITUD (consolidado) ──

  async function runFlows() {
    setFlowsState(prev => ({ ...prev, status: "SCANNING" }));
    try {
      const res  = await fetch("/api/sector-leaders-data?mode=intraday");
      const data = await res.json();
      if (data.ok) {
        setFlowsState({
          status: "DONE", scannedAt: data.scannedAtUtc ?? new Date().toISOString(),
          marketOpen: data.marketOpen ?? false, spy: data.spy ?? null,
          sectors: data.sectors ?? [], note: data.note ?? "",
        });
      } else {
        setFlowsState(prev => ({ ...prev, status: "ERROR" }));
      }
    } catch { setFlowsState(prev => ({ ...prev, status: "ERROR" })); }
  }

  // AUDIT FIX (HIGH): runFull SIN try/catch dejaba isScanning=true para siempre si
  // startScanSnapshot rechazaba (red/API caída) — Promise.allSettled en handleScanAll
  // tragaba el rechazo. Consecuencias: SCAN EMRR bloqueado hasta recargar, scanActiveRef
  // congelaba los refrescos de precios de 90s y el toast anunciaba éxito falso.
  // Devuelve true/false para condicionar el toast final.
  async function runFull(): Promise<boolean> {
    clearSessionCacheForNewScan();
    const startedAt = createTimestampPair();
    setScanState(c => ({ ...c, label: "SCAN FULL running...", isScanning: true,
      lastRun: startedAt, lastScanClicked: startedAt, scanExecutionMode: "SCAN_SNAPSHOT" }));
    setSystemStatus(c => updateSystemStatusForDataMode(refreshSystemMarketStatus(c), "SCANNING", c.lastRealDataUpdate));
    try {
      await runAutoChainedScan(startedAt);
      return true;
    } catch (error) {
      setScanState(c => ({ ...c, label: "Scan snapshot failed - manual retry available",
        isScanning: false, scanExecutionMode: "ERROR" }));
      setSystemStatus(c => updateSystemStatusForDataMode(refreshSystemMarketStatus(c), "ERROR", c.lastRealDataUpdate));
      showToast(error instanceof Error ? error.message : "Scan FULL falló", "error");
      return false;
    }
  }

  // Ref espejo de scanState para leer el estado REAL tras los awaits de handleScanAll
  // (la closure captura el estado del render en que se creó el handler).
  const scanStateRef = useRef(scanState);
  useEffect(() => { scanStateRef.current = scanState; }, [scanState]);
  // Mutex del scan de SUPREME/Amplitud — compartido entre el botón manual del panel
  // y la fase breadth de SCAN EMRR para que nunca corran dos runBreadthScan a la vez.
  const o26ScanActiveRef = useRef(false);

  async function handleScanAll() {
    // Guarda cruzada: no arrancar si ya hay un SCAN/CONTINUE individual en curso (audit fix concurrencia).
    if ((scanPhase !== "idle" && scanPhase !== "done") || scanState.isScanning) return;
    const savedScroll = window.scrollY;
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: "instant" }));

    setScanPhase("flows");

    // FLOWS arranca primero; FULL tras 1s de margen (integridad universo + master indicators).
    // La fase RALLY se eliminó en la consolidación: solo alimentaba a Señal Óptima (desactivada).
    const flowsPromise = runFlows();
    await new Promise(r => setTimeout(r, 1000)); // brief stagger

    setScanPhase("full");
    const fullPromise = runFull();

    const settled = await Promise.allSettled([flowsPromise, fullPromise]);
    let fullOk = settled[1].status === "fulfilled" && settled[1].value === true;

    // AUDIT FIX: si el auto-scan quedó PAUSADO a mitad (3 reintentos de batch fallidos, snapshot
    // parcial), el botón "Continuar scan" ya no existe en la UI consolidada — reintentar aquí la
    // continuación una vez, automáticamente. Estado real vía ref (no closure).
    const st = scanStateRef.current;
    if (st.snapshotToken && st.coveragePercent !== 100 && !st.isScanning) {
      const startedAt = createTimestampPair();
      setScanState(c => ({ ...c, label: "CONTINUE SCAN running...", isScanning: true,
        lastScanClicked: startedAt, scanExecutionMode: "SCAN_SNAPSHOT" }));
      try {
        await applySnapshotResult(continueScanSnapshot(st.snapshotToken), startedAt, {
          keepScanning: false, suppressToast: true,
        });
        fullOk = true;
      } catch {
        setScanState(c => ({ ...c, isScanning: false, label: "Scan parcial — pulsa SCAN EMRR para reintentar" }));
      }
    }

    // Fase final — Amplitud de mercado (secuencial para no saturar proveedores). El mismo loop
    // computa y persiste OPTIMAL SUPREME en el servidor. La barra de progreso se muestra en el
    // propio panel SUPREME (o26ScanProgress). Run de cierre: si hay mercado abierto se marca
    // intradía y NO contamina la serie histórica nocturna.
    setScanPhase("breadth");
    let breadthOk = false;
    if (o26ScanActiveRef.current) {
      // AUDIT FIX (concurrencia): un scan manual de SUPREME ya está corriendo — NO lanzar otro
      // runBreadthScan en paralelo (doble carga a proveedores + doble persistencia + barra de
      // progreso entrelazada). Esperar a que acabe y refrescar de su resultado persistido.
      while (o26ScanActiveRef.current) await new Promise(r => setTimeout(r, 1000));
      loadMarketBreadth();
      loadOptimal2026();
      breadthOk = true;
    } else {
      o26ScanActiveRef.current = true;
      try {
        setO26ScanProgress(0);
        const breadth = await runBreadthScan((coverage) => { setO26ScanProgress(coverage); });
        setMarketBreadth(breadth);
        enrichBreadthWithLiveQuotes(breadth).then(setMarketBreadth).catch(() => {});
        loadOptimal2026();
        breadthOk = true;
      } catch { /* los paneles conservan su último estado cacheado */ }
      finally { setO26ScanProgress(null); o26ScanActiveRef.current = false; }
    }

    setScanPhase("done");
    if (fullOk && breadthOk) {
      showToast("✓ Análisis completo — Amplitud + OPTIMAL SUPREME actualizados", "success");
    } else if (breadthOk) {
      showToast("Análisis parcial — Amplitud/SUPREME OK, scan de universo con errores", "info");
    } else {
      showToast("Scan con errores — revisa conexión y reintenta", "error");
    }
    setTimeout(() => setScanPhase("idle"), 4000);
  }

  // ─── OPTIMAL SUPREME scan dedicado (botón manual en el panel) ─────────────
  // Reutiliza runBreadthScan (que ya computa y persiste SUPREME como side-effect)
  // con barra de progreso propia en el panel.
  const handleOptimal2026Scan = useCallback(async () => {
    // Guardas cruzadas (audit fix concurrencia): ni doble scan manual (o26ScanActiveRef)
    // ni solapamiento con SCAN EMRR en curso (scanActiveRef cubre isScanning + scanPhase).
    if (o26ScanActiveRef.current || scanActiveRef.current) return;
    o26ScanActiveRef.current = true;
    setO26ScanProgress(0);
    try {
      const breadth = await runBreadthScan((coverage) => setO26ScanProgress(coverage));
      setMarketBreadth(breadth); // el scan manual también actualiza el panel de Amplitud
      await loadOptimal2026();
    } catch { /* panel conserva último estado */ }
    finally { setO26ScanProgress(null); o26ScanActiveRef.current = false; }
  }, [loadOptimal2026]);

  // ─── Intraday Flows handler ───────────────────────────────────────────────

  async function handleScanFlows() {
    if (flowsState.status === "SCANNING") return;
    const savedScroll = window.scrollY;
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: "instant" }));
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

  // ── Flujos de Capital — carga al montar y refresca cada 5 min ───────────────
  // Todos los demás módulos auto-cargan al montar; Flujos de Capital también debe
  // hacerlo para que el panel nunca se quede en IDLE esperando una acción manual.
  // El refresco de 5 min es adecuado: la API es rápida (<3s) y los datos cambian
  // a esa cadencia durante la sesión. Silencioso (sin toast) para no interrumpir.
  useEffect(() => {
    runFlows();
    const interval = setInterval(() => {
      if (flowsStateRef.current.status !== "SCANNING") runFlows();
    }, 5 * 60 * 1000); // 5 min
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Market Breadth — veredicto agregado de mercado (cacheado en servidor) ──
  // Solo GET al endpoint cacheado; el loop pesado lo recalcula el cron 1×/día.
  useEffect(() => {
    loadMarketBreadth();
    const interval = setInterval(() => {
      loadMarketBreadth();
    }, 10 * 60 * 1000); // 10 min
    return () => clearInterval(interval);
  }, []);

  // ── Market Risk — semáforo de riesgo en tiempo real (¿entrar HOY?). Refresco frecuente. ──
  useEffect(() => {
    fetchMarketRisk().then(setMarketRisk).catch(() => {});
    const interval = setInterval(() => {
      fetchMarketRisk().then(setMarketRisk).catch(() => {});
    }, 3 * 60 * 1000); // 3 min
    return () => clearInterval(interval);
  }, []);

  // ── OPTIMAL SUPREME — carga al montar; refresca cada 10 min ──
  useEffect(() => {
    loadOptimal2026();
    const interval = setInterval(() => {
      loadOptimal2026();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Precios EN VIVO cada 90s para OPTIMAL SUPREME + watchlist Amplitud ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (scanActiveRef.current) return;
      const o26 = optimal2026Ref.current;
      if (o26.items && o26.items.length) {
        enrichOptimal2026WithLiveQuotes(o26.items)
          .then((enriched) => setOptimal2026((prev) => {
            // Merging inteligente: si el enriquecimiento no devolvió priceRefreshedAt
            // (proveedor falló) conservar el precio en vivo anterior para no regresar
            // al cierre del scan y no perder el badge "EN VIVO".
            const prevMap = new Map((prev.items ?? []).map(it => [it.symbol, it]));
            const items = enriched.map(item => {
              const prevItem = prevMap.get(item.symbol);
              if (!item.priceRefreshedAt && prevItem?.priceRefreshedAt && prevItem.price != null) {
                return { ...item, price: prevItem.price, pctDay: prevItem.pctDay, priceRefreshedAt: prevItem.priceRefreshedAt };
              }
              return item;
            });
            return { ...prev, items };
          })).catch(() => {});
      }
      const br = marketBreadthRef.current;
      if (br.topTickers && br.topTickers.length) {
        enrichBreadthWithLiveQuotes(br).then(setMarketBreadth).catch(() => {});
      }
    }, 90_000);
    return () => clearInterval(interval);
  }, []);


  return (
    <main className="dashboard-shell">
      <ErrorBoundary inline label="Cabecera">
        <StickyMiniHeader
          systemStatus={systemStatus}
          onScanAll={handleScanAll}
          scanPhase={scanPhase}
          onLogout={onLogout}
        />
      </ErrorBoundary>
      {/* ── SUMMARY BAR — universo + integridad + cobertura (siempre visible) ── */}
      <ScanSummaryBar systemStatus={systemStatus} />
      {/* ══ OPTIMAL SUPREME — el ÚNICO módulo de estrategia (consolidación 24-jul-2026) ══
          Ganador de 73 variantes de backtest (10 años, 603 tickers). Los módulos CLAUDE01,
          FABLE01, Señal Óptima y TOP8 quedan DESACTIVADOS (no borrados): la concentración
          top-2 + trailing con rotación + VT30 los superó a todos en MAR. */}
      <ErrorBoundary inline label="Optimal Supreme">
        <Optimal2026Panel
          data={optimal2026}
          onAutoScan={loadOptimal2026}
          onScan={handleOptimal2026Scan}
          scanProgress={o26ScanProgress}
        />
      </ErrorBoundary>
      {/* ── FEAR & GREED + indicadores maestros (VIX/SPY/HYG/MOVE/…) ── */}
      <ErrorBoundary inline label="Fear & Greed">
        <FearGreedPanel fearGreed={fearGreed} masterIndicators={masterIndicators} />
      </ErrorBoundary>
      {/* ── RIESGO DE MERCADO HOY — semáforo en tiempo real (¿entrar hoy?) ── */}
      <ErrorBoundary inline label="Market Risk">
        <MarketRiskGauge risk={marketRisk} />
      </ErrorBoundary>
      {/* ── AMPLITUD DE MERCADO — veredicto agregado (timing 1-2 meses) ── */}
      <ErrorBoundary inline label="Market Breadth">
        <MarketBreadthPanel breadth={marketBreadth} />
      </ErrorBoundary>
      <ErrorBoundary inline label="Cabecera técnica">
        <TechnicalHeader systemStatus={systemStatus} onLogout={onLogout} />
      </ErrorBoundary>
      <ErrorBoundary inline label="Flujos de Capital">
        <IntraDayFlowsPanel flowsState={flowsState} onRefresh={handleScanFlows} />
      </ErrorBoundary>
      <ErrorBoundary inline label="Estado del sistema">
        <SystemStatusCards systemStatus={systemStatus} />
      </ErrorBoundary>
      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} /> : null}
    </main>
  );
}
