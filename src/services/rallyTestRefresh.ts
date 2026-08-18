/**
 * RALLY-TEST — servicio de laboratorio (copia funcional de rallyRefresh.ts, 18-ago-2026).
 *
 * ⚠ NO toca Rally Leaders: endpoints propios (/api/rally-test/*), snapshot propio en
 * Redis y motor propio en el backend (rallyScoreEngineTest.js). Un scan aquí no
 * sobrescribe nada de producción ni dispara el evento que refresca la banda de
 * alineación de cartera ni el export CarteraIBK del Mac.
 *
 * Los TIPOS se reexportan de rallyRefresh.ts a propósito: al crearse, el dato tiene
 * exactamente la misma forma. Cuando un experimento cambie esa forma (campo nuevo,
 * señal distinta), se declara el tipo aquí y se deja de reexportar el de producción.
 */
export type {
  RallyAsset,
  RallyEntryTiming,
  RallyEntryZone,
  RallyMetrics,
  RallyRunway,
  RallyScanResponse,
  RallyState,
  RallyWarningFlag,
} from "./rallyRefresh";
export { estimateNextReview, initialRallyState } from "./rallyRefresh";

import type { RallyScanResponse } from "./rallyRefresh";

/**
 * Calibración HEREDADA del módulo de producción en el momento de la copia.
 * ⚠ Estas cifras describen la estrategia CERTIFICADA (C0). En cuanto Rally-Test
 * cambie cualquier parámetro (señal, pesos, stops, filtros), DEJAN DE APLICAR y hay
 * que recalcularlas con su propio backtest antes de enseñarlas como resultado.
 */
export const RALLY_TEST_BASELINE = {
  formula: "Momento a 9 meses · revisión ~cada 4 meses (84 sesiones) · top 10 ponderado por momentum 9m crudo (4-20%)",
  origen: "copia byte-idéntica del motor de producción el 18-ago-2026",
} as const;

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

export async function startRallyTestScan(): Promise<RallyScanResponse> {
  return fetchWithTimeout<RallyScanResponse>("/api/rally-test/start", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function continueRallyTestScan(rallyToken: string): Promise<RallyScanResponse> {
  return fetchWithTimeout<RallyScanResponse>("/api/rally-test/continue", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ rallyToken }),
  });
}

export async function fetchLastRallyTestScan(): Promise<RallyScanResponse | null> {
  try {
    const res = await fetch("/api/rally-test/last", {
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
