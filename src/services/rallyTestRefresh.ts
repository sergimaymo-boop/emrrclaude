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
  RallyNewsItem,
  RallyRunway,
  RallyScanResponse,
  RallyState,
  RallyWarningFlag,
} from "./rallyRefresh";
export { initialRallyState } from "./rallyRefresh";

import type { RallyAsset, RallyNewsItem } from "./rallyRefresh";

/**
 * MÉTRICAS PROPIAS del motor LAB-M189 (declaradas aquí el 7-sep-2026, cuando la
 * forma del dato dejó de coincidir con producción — tal y como anuncia la nota
 * de arriba). Todas opcionales: el panel pinta "—" ante cualquier ausencia.
 * momRaw/mom63/mom126 en %, vol126 anualizada en %, prox52w = % del máximo de
 * 52 semanas, ext50 = % sobre la EMA50. tq/r2 = calidad de tendencia 126d.
 */
export interface RallyTestMetrics {
  lastClose?: number | null;
  dayChangePct?: number | null;
  momRaw?: number | null;
  mom63?: number | null;
  mom126?: number | null;
  vol126?: number | null;
  tq?: number | null;
  r2?: number | null;
  maxDay21?: number | null;
  prox52w?: number | null;
  ext50?: number | null;
  trailingStop?: number | null;
  version?: string;
}

/** Activo del top-10 de Rally-Test: misma forma que producción salvo las métricas. */
export interface RallyTestAsset extends Omit<RallyAsset, "metrics"> {
  metrics: RallyTestMetrics | null;
}

// Cadencia de revisión del motor LAB-M189 v1.1: ~63 sesiones ≈ 91 días naturales
// (producción usa 84 sesiones/121 días — por eso NO se reexporta la suya).
export function estimateNextReview(scanCompletedAtUtc: string | null | undefined): string | null {
  if (!scanCompletedAtUtc) return null;
  const d = new Date(scanCompletedAtUtc);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 91);
  return d.toISOString().slice(0, 10);
}

import type { RallyScanResponse } from "./rallyRefresh";

/**
 * Calibración HEREDADA del módulo de producción en el momento de la copia.
 * ⚠ Estas cifras describen la estrategia CERTIFICADA (C0). En cuanto Rally-Test
 * cambie cualquier parámetro (señal, pesos, stops, filtros), DEJAN DE APLICAR y hay
 * que recalcularlas con su propio backtest antes de enseñarlas como resultado.
 */
/** Amplitud del universo medida durante el scan — OBSERVABLE de salud del
 *  mercado (4-sep-2026). NO entra en score, pesos ni selección: es información
 *  para el lector. `analizados` = tickers con histórico suficiente; `positivos`
 *  = los que tienen tendencia positiva. */
export interface AmplitudUniverso { analizados: number; positivos: number }

export const RALLY_TEST_BASELINE = {
  formula: "LAB-M189 v1.1 — momentum 189 sesiones saltando las últimas 10 · top-10 mostrado, INVERTIDOS los 5 primeros (pesos por score 10-40%) · revisión ~cada 3 meses (63 sesiones) · trailing stop 45% a cierres: si salta, RE-ESCANEA y reinvierte todo según los pesos nuevos",
  origen: "PROPIO del laboratorio (LAB-M189 v1.1, 2-sep-2026) — ya NO es copia de producción",
  // Backtest del motor (scripts/rally-test-engine-study2.mjs, ensemble 10 fases,
  // walk-forward elegido por 2017-21 y confirmado en 2022-26, 20 pb/lado) con las
  // CORRECCIONES de la auditoría adversarial independiente (2-sep-2026):
  backtest: {
    confirmMedia: "64,6%", confirmPeorFase: "56,1%",
    refC0: "53,3% / 43,7%",
    a50pb: "62,3% media · 54,0% peor fase",
    // El riesgo REAL (pico-valle sin ventanear; v1.1 con el trailing 45%):
    ddRealPeorFase: "−38,8%", dd2022: "−11,6%", dd2022C0: "−12,9%",
    // La verdad sobre el edge: a igual tamaño de libro (K=10) este motor PIERDE
    // contra C0 en 64/64 configs — la ventaja es de la CONCENTRACIÓN top-5, no
    // del motor; esperanza honesta tras descuentos: +2 a +4 pp/año.
    edgeHonesto: "+2 a +4 pp/año esperados (no los +10,8 nominales)",
    // ESTUDIO 9 (9-sep-2026): cifras honestas tras la auditoría adversarial
    confirmEx2026: "≈52-54%", costeIntradia: "2-4 pp/año y +50% de saltos", configsProbadas: "431",
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

/**
 * Motivo del movimiento por ticker del ÚLTIMO scan de test (7-sep-2026).
 * Endpoint propio del laboratorio (/api/rally-test/news → action=test-news,
 * caché Redis con prefijo test:): jamás lee ni pisa las noticias de producción.
 * Solo display — si falla, el panel funciona exactamente igual.
 */
export async function fetchRallyTestNews(): Promise<Record<string, RallyNewsItem | null>> {
  try {
    const res = await fetch("/api/rally-test/news", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return {};
    const data = await res.json();
    return data?.ok && data.news && typeof data.news === "object" ? data.news : {};
  } catch {
    return {};
  }
}
