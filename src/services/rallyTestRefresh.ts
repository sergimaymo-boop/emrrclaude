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
export { initialRallyState } from "./rallyRefresh";

// Cadencia de revisión del motor LAB-M189: ~42 sesiones ≈ 61 días naturales
// (producción usa 84 sesiones/121 días — por eso NO se reexporta la suya).
export function estimateNextReview(scanCompletedAtUtc: string | null | undefined): string | null {
  if (!scanCompletedAtUtc) return null;
  const d = new Date(scanCompletedAtUtc);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 61);
  return d.toISOString().slice(0, 10);
}

import type { RallyScanResponse } from "./rallyRefresh";

/**
 * Calibración HEREDADA del módulo de producción en el momento de la copia.
 * ⚠ Estas cifras describen la estrategia CERTIFICADA (C0). En cuanto Rally-Test
 * cambie cualquier parámetro (señal, pesos, stops, filtros), DEJAN DE APLICAR y hay
 * que recalcularlas con su propio backtest antes de enseñarlas como resultado.
 */
export const RALLY_TEST_BASELINE = {
  formula: "LAB-M189 v1.0 — momentum 189 sesiones saltando las últimas 10 · top-10 mostrado, INVERTIDOS los 5 primeros (pesos por score 10-40%) · revisión ~cada 2 meses (42 sesiones) · sin stops (salida por rebalanceo)",
  origen: "motor PROPIO del laboratorio (2-sep-2026) — ya NO es copia de producción",
  // Backtest del motor (scripts/rally-test-engine-study2.mjs, ensemble 10 fases,
  // walk-forward elegido por 2017-21 y confirmado en 2022-26, 20 pb/lado) con las
  // CORRECCIONES de la auditoría adversarial independiente (2-sep-2026):
  backtest: {
    confirmMedia: "64,1%", confirmPeorFase: "53,6%",
    refC0: "53,3% / 43,7%",
    a50pb: "61,4% media · 51,1% peor fase",
    // El riesgo REAL (pico-valle sin ventanear, hallazgo del auditor):
    ddRealPeorFase: "−42,9%", dd2022: "−34,5%", dd2022C0: "−18,7%",
    // La verdad sobre el edge: a igual tamaño de libro (K=10) este motor PIERDE
    // contra C0 en 64/64 configs — la ventaja es de la CONCENTRACIÓN top-5, no
    // del motor; esperanza honesta tras descuentos: +2 a +4 pp/año.
    edgeHonesto: "+2 a +4 pp/año esperados (no los +10,8 nominales)",
  },
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
