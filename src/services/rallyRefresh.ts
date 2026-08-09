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

export interface RallyMetrics {
  lastClose: number;
  ema20: number | null;
  ema50: number | null;
  ema20Slope: number | null;
  ema50Slope: number | null;
  rs3m: number | null;
  rs6m: number | null;
  mom1m: number | null;
  mom3m: number | null;
  mom6m: number | null;
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
  metrics: RallyMetrics | null;
  dataMode: string;
  scanId: string | null;
}

/** Calibración v3.0 (validada 9-ago-2026, ver docs/RALLY-MODULE-AUDIT.md) para mostrar en el panel. */
export const RALLY_BACKTEST = {
  period: "2017-08 → 2026-08 (10 años, 603 tickers)",
  formula: "Fuerza relativa 50% + Momento 50% · revisión ~cada 4 meses (84 sesiones) · top 10 a peso igual",
  strategy: { cagr: 0.343, maxDD: 0.415, mar: 0.82, sharpe: 1.14 },
  buyHold: { cagr: 0.156, maxDD: 0.337 },
  reviewDays: 84,
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
