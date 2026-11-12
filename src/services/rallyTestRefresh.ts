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
  rsi14?: number | null;        // RSI de Wilder 14 sesiones (display, estudio 12)
  trailingStop?: number | null;
  version?: string;
}

/** Activo del top-10 de Rally-Test: misma forma que producción salvo las métricas. */
export interface RallyTestAsset extends Omit<RallyAsset, "metrics"> {
  metrics: RallyTestMetrics | null;
}

/**
 * Calendario de revisión de la CARTERA REAL (25-sep-2026). Lo calcula el servidor
 * (/api/rally-test/last → review) desde el ÚLTIMO REBALANCEO real, 63 sesiones de NYSE:
 * antes era "fecha del scan + 91 días" y cada scan empujaba la revisión 3 meses.
 */
export interface RallyTestReview {
  lastRebalance: string;
  sessionsTotal: number;
  sessionsElapsed: number;
  sessionsRemaining: number;
  nextReviewDate: string | null;
  due: boolean;
}

/** 'YYYY-MM-DD' → 'lun, 7 dic 2026'. */
export function formatReviewDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

import type { RallyScanResponse } from "./rallyRefresh";

/** Amplitud del universo medida durante el scan — OBSERVABLE de salud del
 *  mercado (4-sep-2026). NO entra en score, pesos ni selección: es información
 *  para el lector. `analizados` = tickers con histórico suficiente; `positivos`
 *  = los que tienen tendencia positiva. */
export interface AmplitudUniverso { analizados: number; positivos: number }

/**
 * MOMENTO DE MERCADO — contexto del scan (estudio 12, 12-nov-2026). Lo calcula el servidor
 * al completar el scan de test (api/_lib/rallyTestContext.js). SOLO display: no entra en
 * score, selección, pesos ni trailing. Cualquier campo puede venir a null (fuente caída):
 * el panel lo dice, nunca lo rellena.
 */
export interface RallyTestContexto {
  ok: boolean;
  calculadoUtc: string;
  spy: { sesion: string; vsEma200Pct: number | null; vsEma50Pct: number | null; cruce: "DORADO" | "MUERTE"; bajoMaximoPct: number | null; rsi14: number | null } | null;
  vix: { sesion: string; nivel: number | null; percentil: number | null } | null;
  top5: { n: number; rsiMedio: number | null; estiramientoMedioPct: number | null } | null;
  avisos: string[];
}

export interface MomentoFila { clave: string; titulo: string; valor: string; estado: string; tono: "INFO" | "AVISO"; lectura: string }

/**
 * Textos del ESTUDIO 12 (scripts/estudio12-*.mjs, backtests/estudio12-regimen*.json), ya
 * corregidos por la auditoría adversarial del 12-nov-2026 (docs/auditoria-semanal/2026-11-12-estudio12.md):
 *  · trailing y exposición según el ciclo: 0 de 150 y 0 de 24 superan (criterios fijados antes);
 *  · esperar una señal con el dinero parado pierde siempre;
 *  · el único "momento favorable" que aguanta es "los líderes están en su media de 50 o por
 *    debajo", que es sobre todo "la estrategia acaba de caer": se enseña con rango y avisos,
 *    en tono neutro. NO hay etiqueta de compra/venta ni cifras de RSI en verde.
 */
export const RALLY_TEST_MOMENTO = {
  estudio: "estudio 12 · 10 años de backtest",
  trailing: "Ninguna de las 150 variantes de trailing según el ciclo (15-35% con codicia, tendencia bajista, VIX alto, sobrecompra…) superó las pruebas, con criterios fijados antes de ejecutar: 89 pierden en los dos periodos y las 16 que más ganan en 2022-26 pierden todas en 2017-21.",
  exposicion: "Bajar exposición con tendencia bajista, crédito débil o VIX alto recortó la caída máxima 9-15 puntos pero costó de 5 a 38 puntos de rentabilidad al año; con codicia o sobrecompra ni la recortó (0 de 24).",
  esperar: "Esperar una señal con el dinero parado perdió siempre frente a invertir al recibirlo (0,92-0,99 de la riqueza final). Nada de esta tabla es una orden de compra o de venta.",
  lideresBajoMedia: "Tras momentos así —casi siempre la estrategia acaba de caer— rindió más que un día cualquiera a 3 meses en 8 de 11 episodios (2022-26: +10,5 pp, con rango honesto de −3 a +26; +5,2 sin marzo de 2026). Falló en 2022. Universo de supervivientes: probablemente inflado. Orientativo, no una regla.",
  rsiAlto: "RSI medio alto: tras días así la estrategia rindió algo menos que la media a 3 meses pero siguió subiendo; dejar de aportar mientras tanto no mejoró nada.",
  spySobreventa: "Sobreventa del índice: solo 40 días en 10 años; sin base para una regla.",
  tendenciaBajista: "Con el S&P bajo su media de 200, ni ceñir el trailing ni bajar exposición mejoró el resultado en 10 años.",
  vixAlto: "VIX alto = más vaivenes, pero salir o ceñir stops con VIX ≥ 25 restó rentabilidad en el backtest.",
} as const;

const sig = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d).replace(".", ",")}%`;

/** Convierte el contexto del servidor en las filas de la tabla. Función pura. */
export function filasMomento(c: RallyTestContexto | null | undefined): { filas: MomentoFila[] } {
  if (!c) return { filas: [] };
  const filas: MomentoFila[] = [];
  const M = RALLY_TEST_MOMENTO;
  if (c.spy) {
    const t = c.spy.vsEma200Pct;
    const alcista = t != null && t >= 0;
    filas.push({
      clave: "tendencia", titulo: "Tendencia S&P 500",
      valor: t != null ? `${sig(t)} sobre su media de 200 · cruce ${c.spy.cruce === "DORADO" ? "dorado" : "de la muerte"}` : "sin dato",
      estado: t == null ? "SIN DATO" : alcista ? "ALCISTA" : "BAJISTA", tono: t != null && !alcista ? "AVISO" : "INFO",
      lectura: alcista ? "Tendencia de fondo positiva. No cambia nada en la cartera." : M.tendenciaBajista,
    });
    const r = c.spy.rsi14, dd = c.spy.bajoMaximoPct;
    const sobreventa = r != null && r <= 30, sobrecompra = r != null && r >= 70;
    filas.push({
      clave: "maximos", titulo: "S&P frente a máximos",
      valor: `${dd != null ? `a ${sig(-dd)} de su máximo de 52 semanas` : "sin dato"}${r != null ? ` · RSI ${r}` : ""}`,
      estado: sobreventa ? "SOBREVENTA" : sobrecompra ? "SOBRECOMPRA" : "NORMAL", tono: "INFO",
      lectura: sobreventa ? M.spySobreventa : sobrecompra ? "Sobrecompra del índice: sin efecto consistente sobre la estrategia; no es señal de venta." : "Sin lectura especial.",
    });
  }
  if (c.vix) {
    const v = c.vix.nivel;
    filas.push({
      clave: "vix", titulo: "VIX (volatilidad)",
      valor: v != null ? `${v.toFixed(1).replace(".", ",")}${c.vix.percentil != null ? ` · percentil ${c.vix.percentil}% de un año` : ""}` : "sin dato",
      estado: v == null ? "SIN DATO" : v >= 25 ? "TENSIÓN" : v < 15 ? "CALMA" : "NORMAL", tono: v != null && v >= 25 ? "AVISO" : "INFO",
      lectura: v != null && v >= 25 ? M.vixAlto : "Sin lectura especial.",
    });
  }
  if (c.top5) {
    const r = c.top5.rsiMedio, e = c.top5.estiramientoMedioPct;
    const bajoMedia = e != null && e <= 0, rsiAlto = r != null && r >= 70;
    filas.push({
      clave: "top5", titulo: `Los ${c.top5.n} invertidos del scan`,
      valor: `${e != null ? `${sig(e)} de media respecto a su media de 50` : "estiramiento sin dato"}${r != null ? ` · RSI medio ${r}` : ""}`,
      estado: e == null && r == null ? "SIN DATO" : bajoMedia ? "BAJO SU MEDIA DE 50" : rsiAlto ? "RSI ALTO" : "NORMAL", tono: "INFO",
      lectura: bajoMedia ? M.lideresBajoMedia : rsiAlto ? M.rsiAlto : "Sin lectura especial.",
    });
  }
  return { filas };
}

export const RALLY_TEST_BASELINE = {
  formula: "LAB-M189 v1.1 — momentum 189 sesiones saltando las últimas 10 · top-10 mostrado, INVERTIDOS los 5 primeros (pesos por score 10-40%) · revisión ~cada 3 meses (63 sesiones) · trailing stop 45% a cierres: si salta, RE-ESCANEA y reinvierte todo según los pesos nuevos",
  origen: "PROPIO del laboratorio (LAB-M189 v1.1, 2-sep-2026) — ya NO es copia de producción",
  // Backtest del motor (scripts/rally-test-engine-study2.mjs, ensemble 10 fases,
  // walk-forward elegido por 2017-21 y confirmado en 2022-26, 20 pb/lado) con las
  // CORRECCIONES de la auditoría adversarial independiente (2-sep-2026):
  backtest: {
    confirmMedia: "64,6%", confirmPeorFase: "56,1%",
    refC0: "52,9% / 42,9%",   // C0 como cartera real (pesos a la deriva), como LAB-M189; dataset reparado 25-sep
    a50pb: "62,3% media · 54,0% peor fase",
    // El riesgo REAL (pico-valle sin ventanear; v1.1 con el trailing 45%):
    ddRealPeorFase: "−38,8%", dd2022: "−11,6%", dd2022C0: "−13,6%",
    // 2022 de v1.0 (−16,5%) → v1.1 (−11,6%): la mejora viene del cambio de CADENCIA
    // (R42→R63), no del stop (auditoría de backtest 25-sep-2026). El stop 45% es ~gratis:
    // −0,4 pp de confirm (t≈0) y DD real 38,8% vs 39,6% sin stop.
    dd2022v10: "−16,5%", ddSinStop: "−39,6%",
    // La verdad sobre el edge: a igual tamaño de libro (K=10) este motor PIERDE
    // contra C0 en 64/64 configs — la ventaja es de la CONCENTRACIÓN top-5, no
    // del motor; esperanza honesta tras descuentos: +2 a +4 pp/año.
    edgeHonesto: "+2 a +4 pp/año esperados (no los +11,7 nominales)",
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
export async function fetchLastRallyTestScan(): Promise<(RallyScanResponse & { review?: RallyTestReview; contexto?: RallyTestContexto | null }) | null> {
  return fetchLastScanFrom("/api/rally-test/last") as Promise<(RallyScanResponse & { review?: RallyTestReview; contexto?: RallyTestContexto | null }) | null>;
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
