/**
 * RALLY-TEST — servicio de laboratorio (nació como copia de rallyRefresh.ts el 18-ago-2026;
 * desde el 2-sep-2026 sirve al motor PROPIO LAB-M189 v1.1).
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
  RallyNewsResult,
  RallyRunway,
  RallyScanResponse,
  RallyState,
  RallySessionFields,
  RallyWarningFlag,
} from "./rallyRefresh";
export { initialRallyState } from "./rallyRefresh";

import type { RallyAsset, RallyNewsResult, RallyScanResponse as RallyScanResponseT, RallySessionFields } from "./rallyRefresh";

// ── Utilidades PROPIAS del laboratorio (25-sep-2026): copias, no importadas de
// producción — Rally-Test y Rally Leaders son módulos independientes. ──

const GET_TIMEOUT_MS = 8000;

async function getWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

/** null solo si el servidor confirma que no hay scan; cualquier otro fallo LANZA. */
async function fetchLastScanFrom(url: string): Promise<RallyScanResponseT | null> {
  const res = await getWithTimeout(url);
  let data: { ok?: boolean; error?: string } | null = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 404 && data?.error === "NO_STORED_RALLY_SNAPSHOT") return null;
  if (!res.ok || !data) throw new Error(`${url}_HTTP_${res.status}`);
  if (!data.ok) throw new Error(`${url}_${data.error ?? "NOT_OK"}`);
  return data as RallyScanResponseT;
}

async function fetchNewsFrom(url: string): Promise<RallyNewsResult> {
  try {
    const res = await getWithTimeout(url);
    if (!res.ok) return { failed: true, news: {} };
    const data = await res.json();
    if (!data?.ok || !data.news || typeof data.news !== "object") return { failed: true, news: {} };
    return { failed: false, news: data.news };
  } catch {
    return { failed: true, news: {} };
  }
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TZ = "Atlantic/Canary";

export function formatSessionDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return `${iso.slice(8, 10)}-${MESES[Number(iso.slice(5, 7)) - 1] ?? "?"}`;
}

function canaryDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export interface ScanAge { when: string; age: string; stale: boolean }

export function scanAgeInfo(scanCompletedAtUtc: string | null | undefined, now: Date = new Date()): ScanAge | null {
  if (!scanCompletedAtUtc) return null;
  const t = new Date(scanCompletedAtUtc);
  if (Number.isNaN(t.getTime())) return null;
  const when = t.toLocaleString("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const mins = Math.max(0, Math.round((now.getTime() - t.getTime()) / 60000));
  const age = mins < 60 ? `hace ${mins} min` : mins < 48 * 60 ? `hace ${Math.round(mins / 60)} h` : `hace ${Math.round(mins / 1440)} d`;
  const start = new Date(`${canaryDay(t)}T12:00:00Z`);
  const end = new Date(`${canaryDay(now)}T12:00:00Z`);
  let weekdays = 0;
  for (let d = new Date(start); d < end && weekdays < 10;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) weekdays++;
  }
  return { when, age, stale: weekdays > 1 };
}

export interface SessionSummary { date: string | null; forming: boolean; missingCount: number }

export function summarizeSessions(assets: { metrics: RallySessionFields | null }[]): SessionSummary {
  const counts = new Map<string, { n: number; forming: number }>();
  let missingCount = 0;
  for (const a of assets) {
    const m = a.metrics;
    if (m?.missingSessions?.length) missingCount++;
    if (!m?.lastBarDate) continue;
    const c = counts.get(m.lastBarDate) ?? { n: 0, forming: 0 };
    c.n++;
    if (m.lastBarForming) c.forming++;
    counts.set(m.lastBarDate, c);
  }
  let date: string | null = null;
  let best = { n: 0, forming: 0 };
  for (const [k, v] of counts) if (v.n > best.n || (v.n === best.n && date != null && k > date)) { date = k; best = v; }
  return { date, forming: best.n > 0 && best.forming * 2 >= best.n, missingCount };
}

export interface RowSessionNote { missing: boolean; tag: string | null; detail: string | null }

export function rowSessionNote(m: RallySessionFields | null | undefined, summary: SessionSummary): RowSessionNote {
  if (m?.missingSessions?.length) {
    return {
      missing: true,
      tag: "SIN DATO HOY",
      detail: `Sin dato de la sesión de hoy en la fuente (falta la del ${m.missingSessions.map(formatSessionDate).join(", ")}): el % del día no se puede calcular. Último precio disponible: sesión del ${formatSessionDate(m.lastBarDate)}.`,
    };
  }
  if (!m?.lastBarDate || !summary.date) return { missing: false, tag: null, detail: null };
  const forming = !!m.lastBarForming;
  if (m.lastBarDate === summary.date && forming === summary.forming) return { missing: false, tag: null, detail: null };
  const estado = forming ? "en curso" : "al cierre";
  return {
    missing: false,
    tag: `SES. ${formatSessionDate(m.lastBarDate).toUpperCase()}${forming ? " EN CURSO" : ""}`,
    detail: `Precio y % de la sesión del ${formatSessionDate(m.lastBarDate)} (${estado}), distinta de la del resto del top-10.`,
  };
}

/**
 * MÉTRICAS PROPIAS del motor LAB-M189 (declaradas aquí el 7-sep-2026, cuando la
 * forma del dato dejó de coincidir con producción — tal y como anuncia la nota
 * de arriba). Todas opcionales: el panel pinta "—" ante cualquier ausencia.
 * momRaw/mom63/mom126 en %, vol126 anualizada en %, prox52w = % del máximo de
 * 52 semanas, ext50 = % sobre la EMA50. tq/r2 = calidad de tendencia 126d.
 */
export interface RallyTestMetrics extends RallySessionFields {
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
    // 2022 de v1.0 (−16,5%) → v1.1 (−11,6%): la mejora viene del cambio de CADENCIA
    // (R42→R63), no del stop (auditoría de backtest 25-sep-2026). El stop 45% es ~gratis:
    // −0,4 pp de confirm (t≈0) y DD real 38,8% vs 39,6% sin stop.
    dd2022v10: "−16,5%", ddSinStop: "−39,6%",
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

/** null SOLO si el servidor confirma que no hay scan de test; cualquier fallo LANZA. */
export async function fetchLastRallyTestScan(): Promise<RallyScanResponse | null> {
  return fetchLastScanFrom("/api/rally-test/last");
}

/**
 * Motivo del movimiento por ticker del ÚLTIMO scan de test (7-sep-2026).
 * Endpoint propio del laboratorio (/api/rally-test/news → action=test-news,
 * caché Redis con prefijo test:): jamás lee ni pisa las noticias de producción.
 * Solo display — si falla, el panel lo dice ("noticias no disponibles") y sigue igual.
 */
export async function fetchRallyTestNews(): Promise<RallyNewsResult> {
  return fetchNewsFrom("/api/rally-test/news");
}
