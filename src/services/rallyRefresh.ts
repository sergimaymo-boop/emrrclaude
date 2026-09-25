/**
 * Rally Leaders Engine — frontend API service
 * Completely independent from realDataRefresh.ts / TOP 8
 */

import { isMarketOpen } from "../utils/marketHours";

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

/** Sesión a la que pertenece el último precio del ticker (contrato backend 25-sep-2026). */
export interface RallySessionFields {
  /** 'YYYY-MM-DD' de la sesión del último precio. */
  lastBarDate?: string | null;
  /** true = esa sesión seguía abierta: el precio es intradía EN CURSO, no un cierre. */
  lastBarForming?: boolean;
  /** Sesiones posteriores a lastBarDate que la fuente reconoce pero no pudo rellenar. */
  missingSessions?: string[];
}

export interface RallyMetrics extends RallySessionFields {
  lastClose: number;
  /** Rentabilidad de la sesión en el momento del scan (último cierre vs anterior), %. null = hueco del proveedor. */
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

const GET_TIMEOUT_MS = 8000;

/** GET con AbortController (8 s). Lanza en fallo de red/timeout; devuelve la Response tal cual. */
export async function getWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchMarketRegime(): Promise<MarketRegime> {
  try {
    const res = await getWithTimeout("/api/market-regime");
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
// ⚠ 25-sep-2026 (auditoría aprobada por Sergi, scripts/rally-drift-cost-audit.mjs): el simulador
// canon mantenía los pesos FIJOS entre revisiones (= rebalanceo diario gratis). Cifras de abajo
// medidas como CARTERA REAL: pesos a la deriva con el precio y costes sobre cada cambio de peso.
// Antes: 47,7% / 37,7% / 1,27 (full) y 44,9% / 36,1% / 1,24 (confirmación).
export const RALLY_BACKTEST = {
  period: "2017-08 → 2026-08 (9 años, 603 tickers)",
  formula: "Momento a 9 meses · revisión ~cada 4 meses (84 sesiones) · top 10 ponderado por momentum 9m crudo (4-20%)",
  /** Esquema completo en producción (M9_RAW + stops H4 + salto 70/30), periodo full. */
  strategy: { cagr: 0.466, maxDD: 0.377, mar: 1.24, winRate: 0.65 },
  /** Mismo esquema, solo mitad de confirmación 2022-2026 (fuera del train). */
  strategyConfirm: { cagr: 0.447, maxDD: 0.374, mar: 1.19 },
  /** Confirmación sin los 7 meses excepcionales de 2026 (2022-25). */
  confirm2225: { cagr: 0.329 },
  /** Expectativa realista con los stops como orden intradía en el bróker (−2-3 pp/año), antes de impuestos. */
  realista: { confirm: "≈42%", y2225: "≈30%" },
  /** Misma selección y stops con reparto 1/10 por posición (esquema EQUAL), periodo full. */
  equalWeight: { cagr: 0.381, maxDD: 0.366, mar: 1.04 },
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
    fijo30Confirm: 0.444,
    c0Confirm: 0.447,
    fijo30WorstTrain: 0.336,
    c0WorstTrain: 0.359,
  },
} as const;

/**
 * Revisión SI SE REBALANCEA CON ESTE SCAN: 84 sesiones de NYSE después (25-sep-2026;
 * antes +121 días naturales, presentado como fecha fija aunque se movía con cada scan).
 * Rally Leaders no tiene rebalanceo real registrado, así que la fecha es condicional.
 */
export function estimateNextReview(scanCompletedAtUtc: string | null | undefined): string | null {
  if (!scanCompletedAtUtc) return null;
  const d = new Date(scanCompletedAtUtc);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(15, 0, 0, 0);
  let sessions = 0;
  for (let guard = 0; guard < 400 && sessions < 84; guard++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isMarketOpen("United States", d) === "OPEN") sessions++;
  }
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
  /** Tickers cuya descarga de precios falló durante el scan (>0 → top-10 posiblemente incompleto). */
  tickersFallidos?: number;
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

/**
 * Último scan persistido. Devuelve null SOLO si el servidor confirma que no hay
 * ninguno (404 NO_STORED_RALLY_SNAPSHOT); cualquier otro fallo (red, timeout,
 * 5xx, JSON inválido) LANZA, para que la UI diga "no se pudo cargar" en vez de
 * "sin escaneo".
 */
export async function fetchLastScanFrom(url: string): Promise<RallyScanResponse | null> {
  const res = await getWithTimeout(url);
  let data: { ok?: boolean; error?: string } | null = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 404 && data?.error === "NO_STORED_RALLY_SNAPSHOT") return null;
  if (!res.ok || !data) throw new Error(`${url}_HTTP_${res.status}`);
  if (!data.ok) throw new Error(`${url}_${data.error ?? "NOT_OK"}`);
  return data as RallyScanResponse;
}

export async function fetchLastRallyScan(): Promise<RallyScanResponse | null> {
  return fetchLastScanFrom("/api/rally-scan/last");
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
  /** Titular en ESPAÑOL (norma 20-ago-2026). Si la traducción falla, llega el original. */
  headline: string;
  /** Titular tal cual lo publicó el medio, para poder contrastar. */
  headlineOriginal?: string;
  /** "es" si está traducido, "en" si se sirvió el original por fallo del traductor. */
  idioma?: "es" | "en";
  publisher: string;
  url: string;
  publishedAtUtc: string;
}

/** failed=true → la fuente de noticias falló: NO equivale a "sin motivo". */
export interface RallyNewsResult {
  failed: boolean;
  news: Record<string, RallyNewsItem | null>;
}

export async function fetchNewsFrom(url: string): Promise<RallyNewsResult> {
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

export async function fetchRallyNews(): Promise<RallyNewsResult> {
  return fetchNewsFrom("/api/rally-scan/news");
}

// ── Honestidad del dato (25-sep-2026): antigüedad del scan y sesión de los precios ──

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TZ = "Atlantic/Canary";

/** 'YYYY-MM-DD' → '25-sep'. */
export function formatSessionDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return `${iso.slice(8, 10)}-${MESES[Number(iso.slice(5, 7)) - 1] ?? "?"}`;
}

/** Fecha 'YYYY-MM-DD' de un instante en hora de Canarias. */
function canaryDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export interface ScanAge {
  /** "25/09 14:32" en hora de Canarias. */
  when: string;
  /** "hace 3 h" */
  age: string;
  /** Más de 1 día hábil (L-V) transcurrido desde el día del scan. */
  stale: boolean;
}

export function scanAgeInfo(scanCompletedAtUtc: string | null | undefined, now: Date = new Date()): ScanAge | null {
  if (!scanCompletedAtUtc) return null;
  const t = new Date(scanCompletedAtUtc);
  if (Number.isNaN(t.getTime())) return null;
  const when = t.toLocaleString("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const mins = Math.max(0, Math.round((now.getTime() - t.getTime()) / 60000));
  const age = mins < 60 ? `hace ${mins} min` : mins < 48 * 60 ? `hace ${Math.round(mins / 60)} h` : `hace ${Math.round(mins / 1440)} d`;
  // Días hábiles transcurridos: L-V estrictamente posteriores al día del scan hasta hoy (inclusive).
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

export interface SessionSummary {
  /** Sesión mayoritaria de los precios del top-10 (null si el backend no la informa). */
  date: string | null;
  /** La sesión mayoritaria seguía abierta en el momento del scan. */
  forming: boolean;
  /** Filas sin dato de la última sesión en la fuente. */
  missingCount: number;
}

type WithSession = { metrics: RallySessionFields | null };

export function summarizeSessions(assets: WithSession[]): SessionSummary {
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

export interface RowSessionNote {
  /** El % del día no es fiable para esta fila (hueco de la fuente) → pintar "—". */
  missing: boolean;
  /** Etiqueta corta si la fila difiere de la sesión mayoritaria (o le falta el dato). */
  tag: string | null;
  /** Explicación completa. */
  detail: string | null;
}

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
