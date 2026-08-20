/**
 * Rally Leaders Engine — frontend API service
 * Completely independent from realDataRefresh.ts / TOP 8
 */

export interface RallyWarningFlag {
  code: string;
  label: string;
}

export type RallyEntryZone = "IDEAL" | "LEJOS" | "EN_MAXIMOS" | "SIN_DATOS";

export interface RallyEntryTiming {
  score: number | null;
  zone: RallyEntryZone;
  label: string;
}

/** "¿Cuánto recorrido le queda al rally?" — informativo, no reordena el top-10. */
export interface RallyRunway {
  score: number;
  level: "ALTO" | "MEDIO" | "BAJO";
  trendAge: number | null;
  reasons: string[];
}

export interface RallyMetrics {
  lastClose: number;
  /** Rentabilidad de la sesión en el momento del scan (último cierre vs anterior), %. Solo informativo. */
  dayChangePct?: number | null;
  ema20: number | null;
  ema50: number | null;
  ema20Slope: number | null;
  ema50Slope: number | null;
  rs3m: number | null;
  rs6m: number | null;
  mom1m: number | null;
  mom3m: number | null;
  mom6m: number | null;
  /** v4.0: momento a 9 meses (189 sesiones) — LA señal del ranking. */
  mom9m?: number | null;
  rvol: number | null;
  atrPercent: number | null;
  trailingStop: number | null;
  avgValue20: number;
  version?: string;
}

export type MarketRegime = "BULLISH" | "BEARISH" | "UNKNOWN";

export async function fetchMarketRegime(): Promise<MarketRegime> {
  try {
    const res = await fetch("/api/market-regime", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return "UNKNOWN";
    const data = await res.json();
    return (data.regime as MarketRegime) ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export interface RallyAsset {
  rank: number;
  ticker: string;
  name: string;
  market: string;
  exchange: string;
  currency: "USD" | "EUR" | "GBX";
  providerSymbol: string;
  rallyScore: number;
  rallyLabel: string;
  rallyColor: string;
  trailingStop: number | null;
  warningFlags?: RallyWarningFlag[];
  entryTiming?: RallyEntryTiming;
  runway?: RallyRunway | null;
  /**
   * % del capital del módulo sugerido para esta posición — ponderado por el
   * momentum 9 meses CRUDO del ticker (esquema M9_RAW, estudio 17-ago-2026:
   * más momentum → más peso, acotado entre 4% y 20%, Σ=100).
   */
  suggestedWeightPct?: number;
  metrics: RallyMetrics | null;
  dataMode: string;
  scanId: string | null;
}

/**
 * Calibración vigente — esquema M9_RAW certificado (C0 de producción, 17-ago-2026).
 *
 * TODAS las cifras salen de los JSON de estudio, no de memoria:
 * - backtests/rally-weighting-study.json → esquema M9_RAW (selección v4 + pesos por
 *   momentum 9m CRUDO caps 4-20% + stops adaptativos H4 + salto 70/30):
 *   full CAGR 47,7% · MaxDD 37,7% · MAR 1,27 · winRate 0,65;
 *   confirmación 2022-26: 44,9% · 36,1% · 1,24.
 *   Equal-weight equivalente (esquema EQUAL, misma selección y stops, 1/10 por
 *   posición): full 39,0% · 36,4% · MAR 1,07 (confirmación 34,3%).
 *   Benchmark buy&hold S&P 500 del mismo periodo: 15,6% · 33,7%.
 * - backtests/rally-joint-study.json → stops RE-CERTIFICADOS bajo M9_RAW
 *   (interacciones.stopsBajoM9RAW + variantes): ST_FIJO30 confirmación 45,0% vs
 *   C0 44,9% = EMPATE en retorno (la familia fija 30-35% queda a −0,5..+1,3 pp de
 *   C0 sin pasar materialidad); peor-celda train 33,9% (fijo 30) vs 37,0% (C0) =
 *   C0 mejor suelo. Veredicto final del estudio: CERTIFICAR_ACTUAL (H4).
 *   La venta honesta de los stops adaptativos: empatan en retorno con un fijo
 *   30-35% y ganan en peor escenario y en llevar stop propio por ticker.
 */
export const RALLY_BACKTEST = {
  period: "2017-08 → 2026-08 (10 años, 603 tickers)",
  formula: "Momento a 9 meses · revisión ~cada 4 meses (84 sesiones) · top 10 ponderado por momentum 9m crudo (4-20%)",
  /** Esquema completo en producción (M9_RAW + stops H4 + salto 70/30), periodo full. */
  strategy: { cagr: 0.477, maxDD: 0.377, mar: 1.27, winRate: 0.65 },
  /** Mismo esquema, solo mitad de confirmación 2022-2026 (fuera del train). */
  strategyConfirm: { cagr: 0.449, maxDD: 0.361, mar: 1.24 },
  /** Misma selección y stops con reparto 1/10 por posición (esquema EQUAL), periodo full. */
  equalWeight: { cagr: 0.39, maxDD: 0.364, mar: 1.07 },
  buyHold: { cagr: 0.156, maxDD: 0.337 },
  reviewDays: 84,
  /**
   * Stops adaptativos por ticker (H4): stop% = clamp(12 + 0,35·recorrido, 15, 45),
   * evaluado sobre cierres diarios, fijado a la entrada y re-fijado en cada revisión;
   * al saltar, reinversión el mismo día en el mejor por mezcla 0,7·score+0,3·recorrido.
   * Re-certificados bajo M9_RAW (rally-joint-study.json): cifras de comparación abajo.
   */
  stops: {
    stopRule: "12 + 0,35·recorrido, acotado 15-45%",
    jumpRule: "0,7·score + 0,3·recorrido",
    fijo30Confirm: 0.45,
    c0Confirm: 0.449,
    fijo30WorstTrain: 0.339,
    c0WorstTrain: 0.37,
  },
} as const;

/** Próxima fecha de revisión recomendada: el propio scan + ~4 meses de mercado (84 sesiones ≈ 121 días naturales). */
export function estimateNextReview(scanCompletedAtUtc: string | null | undefined): string | null {
  if (!scanCompletedAtUtc) return null;
  const d = new Date(scanCompletedAtUtc);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 121);
  return d.toISOString().slice(0, 10);
}

export interface RallyScanResponse {
  ok: boolean;
  status: "RALLY_IDLE" | "RALLY_SCANNING" | "RALLY_PARTIAL_DIAGNOSTIC" | "RALLY_FINAL" | "RALLY_DATA_UNAVAILABLE" | "RALLY_ERROR";
  scanId?: string;
  scanStartedAtUtc?: string;
  scanCompletedAtUtc?: string | null;
  batchesTotal?: number;
  batchesCompleted?: number;
  coveragePercent?: number;
  isRallyFinal?: boolean;
  rallyToken?: string | null;
  top10?: RallyAsset[];
  activeMarkets?: string[];
  error?: string;
  message?: string;
}

export interface RallyState {
  status: RallyScanResponse["status"];
  isScanning: boolean;
  scanId: string | null;
  rallyToken: string | null;
  coveragePercent: number;
  batchesCompleted: number;
  batchesTotal: number;
  top10: RallyAsset[];
  label: string;
  lastRun: string;
}

const TIMEOUT_MS = 25000;

async function fetchWithTimeout<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${url}_HTTP_${res.status}`);
    return res.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function startRallyScan(): Promise<RallyScanResponse> {
  return fetchWithTimeout<RallyScanResponse>("/api/rally-scan/start", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function continueRallyScan(rallyToken: string): Promise<RallyScanResponse> {
  return fetchWithTimeout<RallyScanResponse>("/api/rally-scan/continue", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ rallyToken }),
  });
}

export async function fetchLastRallyScan(): Promise<RallyScanResponse | null> {
  try {
    const res = await fetch("/api/rally-scan/last", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;
    return data as RallyScanResponse;
  } catch {
    return null;
  }
}

export function initialRallyState(): RallyState {
  return {
    status: "RALLY_IDLE",
    isScanning: false,
    scanId: null,
    rallyToken: null,
    coveragePercent: 0,
    batchesCompleted: 0,
    batchesTotal: 0,
    top10: [],
    label: "RALLY_SCAN_REQUIRED",
    lastRun: new Date().toLocaleString(),
  };
}

/**
 * MOTIVO DEL MOVIMIENTO (solo display, solo Rally Leaders).
 * Un único titular por ticker: el catalizador más probable del movimiento del día,
 * o null si no hay ninguno identificable. NO participa en el análisis.
 */
export interface RallyNewsItem {
  headline: string;
  publisher: string;
  url: string;
  publishedAtUtc: string;
}

export async function fetchRallyNews(): Promise<Record<string, RallyNewsItem | null>> {
  try {
    const res = await fetch("/api/rally-scan/news", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return {};
    const data = await res.json();
    return data?.ok && data.news && typeof data.news === "object" ? data.news : {};
  } catch {
    return {};
  }
}
