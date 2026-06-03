/**
 * Rally Leaders Engine — frontend API service
 * Completely independent from realDataRefresh.ts / TOP 8
 */

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
  avgValue20: number;
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
  metrics: RallyMetrics | null;
  dataMode: string;
  scanId: string | null;
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
