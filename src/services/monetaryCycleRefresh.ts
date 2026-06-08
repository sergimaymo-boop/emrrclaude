/**
 * Monetary Cycle service — frontend
 *
 * Obtiene la clasificación del ciclo monetario desde /api/monetary-cycle.
 * Se refresca cada hora (el ciclo no cambia en minutos).
 */

export type MonetaryCyclePhase = 'EASING' | 'NEUTRAL' | 'TIGHTENING';

export interface MonetaryCycleSignal {
  key: string;
  label: string;
  dir: string;
}

export interface MonetaryCycleResult {
  ok: boolean;
  phase: MonetaryCyclePhase;
  score: number;           // 0–100 (0 = muy restrictivo, 50 = neutral, 100 = muy expansivo)
  label: string;           // "Ciclo Expansivo" | "Ciclo Neutral" | "Ciclo Restrictivo"
  color: string;           // hex color para UI
  signals: MonetaryCycleSignal[];
  rallyScoreAdjustment: number;  // -8 en TIGHTENING, +3 en EASING, 0 en NEUTRAL
  hasData: boolean;
  fromCache?: boolean;
  reason?: string;
  /** Raw market inputs used to classify the cycle (returned by monetary-cycle.js) */
  rawSignals?: {
    tnxChangePercent: number | null;
    hygChangePercent: number | null;
    vixLevel: number | null;
    moveLevel: number | null;
  };
  /** ISO timestamp when the result was written to cache */
  cachedAtUtc?: string;
}

export interface EpsResult {
  ok: boolean;
  epsGrowthYoY?: number | null;
  epsGrowth3Y?:  number | null;
  epsGrowth5Y?:  number | null;  // also returned by epsEngine.js / eps-batch.js
  epsTTM?:       number | null;
  adjustment:    number;
  label:         string;
  risk:          'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  color:         string;
  reason?:       string;
}

export function initialMonetaryCycle(): MonetaryCycleResult {
  return {
    ok: false,
    phase: 'NEUTRAL',
    score: 50,
    label: 'Verificando…',
    color: '#475569',
    signals: [],
    rallyScoreAdjustment: 0,
    hasData: false,
  };
}

export async function fetchMonetaryCycle(): Promise<MonetaryCycleResult> {
  try {
    const res = await fetch('/api/monetary-cycle', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return initialMonetaryCycle();
    const data = await res.json();
    if (!data.ok && data.phase) {
      // REAL_API_CALLS_DISABLED o similar — devolver neutral silencioso
      return { ...initialMonetaryCycle(), phase: data.phase ?? 'NEUTRAL', ok: true, hasData: false };
    }
    return data as MonetaryCycleResult;
  } catch {
    return initialMonetaryCycle();
  }
}

export async function fetchEpsForTickers(tickers: string[]): Promise<Record<string, EpsResult>> {
  if (!tickers || tickers.length === 0) return {};
  try {
    const q = tickers.join(',');
    const res = await fetch(`/api/eps-batch?tickers=${encodeURIComponent(q)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return {};
    const body = await res.json();
    return (body.data ?? {}) as Record<string, EpsResult>;
  } catch {
    return {};
  }
}

