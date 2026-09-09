/**
 * RallyTestPanel — 🧪 RALLY-TEST: copia de laboratorio de RallyPanel (18-ago-2026).
 *
 * Mandato de Sergi: "haz una copia del módulo Rally Leaders que se llame Rally-Test
 * para hacer pruebas sobre este último sin tocar nada del módulo de Rally Leaders".
 *
 * AISLAMIENTO (lo que garantiza que producción no se entera de nada de aquí):
 *   · endpoints propios  /api/rally-test/{start,continue,last}
 *   · motor propio       api/_lib/rallyScoreEngineTest.js  (copia del de producción)
 *   · snapshot propio    clave Redis last_rally_test_snapshot
 *   · SÍ se registra en el bus del botón SCAN EMRR (mandato 2-sep-2026: el botón
 *     grande también escanea este módulo; el botón pequeño propio sigue existiendo)
 *   · NO avisa a la banda de alineación de cartera, así que ni esa tarjeta ni el
 *     export CarteraIBK del Mac ven jamás un scan de test.
 *
 * DESDE EL 2-sep-2026 el motor ya NO es copia: por mandato de Sergi lleva el motor
 * propio LAB-M189 (momentum 189s10 · top-5 invertido por score · reserva 6-10),
 * v1.1 desde el 3-sep con trailing 45% y revisión ~63 sesiones. Ver
 * api/_lib/rallyScoreEngineTest.js y scripts/rally-test-engine-study{2,3}.mjs.
 * El top-10 ya NO coincide con producción.
 *
 * AMPLITUD DEL UNIVERSO (4-sep-2026): el panel muestra qué % del universo tiene
 * tendencia positiva. Es un OBSERVABLE de contexto, no una regla — el
 * cortacircuitos de cartera que la usaba para salir a caja se estudió y se
 * REFUTÓ (§10e: coste real −8,3 pp/año con contabilidad coherente, n efectivo 1
 * por colapso de fases). Se pinta para informar, nunca para operar.
 *
 * PARIDAD VISUAL (7-sep-2026, mandato Sergi): mismas capas de información por
 * ticker que Rally Leaders — zona de entrada, recorrido restante, motivo del
 * movimiento (punto ● + desplegable) — con calculadoras y endpoint PROPIOS
 * (computeEntryTimingTest/computeRunwayTest en el motor de test; /api/rally-test/news
 * con caché test:). SOLO display: el motor LAB-M189 no cambió ni un byte de su
 * score, selección, pesos ni stop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { registerModuleScan } from "../services/scanBus";
import {
  RALLY_TEST_BASELINE,
  type RallyNewsItem,
  type RallyState,
  type RallyTestAsset,
  continueRallyTestScan,
  estimateNextReview,
  fetchLastRallyTestScan,
  fetchRallyTestNews,
  initialRallyState,
  startRallyTestScan,
} from "../services/rallyTestRefresh";

const AMBER = "#a855f7";   // violeta "laboratorio": el de producción es ámbar
const GREEN = "#22c55e";
const RED = "#ef4444";
const SLATE = "#94a3b8";

const pct = (v: number | null | undefined, d = 1) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");

export function RallyTestPanel() {
  // Umbral 780 (antes 748, y antes 680): el punto de motivo (9px + gap 10) añadido el
  // 7-sep-2026 subió el mínimo de la fila de una línea de ~746 a ~765px de viewport
  // (581px de columnas fijas + 11 gaps de 10 + 74px de chrome; auditoría del mismo día:
  // a 748px la fila desbordaba 15px con el nombre colapsado a 0 y el chevron al borde
  // del recorte, desbordamiento 0 desde 763px). 780 = 765 + margen para la scrollbar
  // clásica (~15-17px) que resta viewport CSS en escritorios con barra permanente.
  const isNarrow = useIsNarrow(780);
  const [state, setState] = useState<RallyState>(() => initialRallyState());
  const [scanning, setScanning] = useState(false);
  const [lastScanCompletedAt, setLastScanCompletedAt] = useState<string | null>(null);
  // Amplitud del universo: observable de salud del mercado (4-sep-2026). Solo se
  // MUESTRA — ninguna regla automática la usa (ver §10e: el cortacircuitos de
  // cartera se estudió y se REFUTÓ; esto es el observable que sí quedó en pie).
  const [amplitud, setAmplitud] = useState<{ analizados: number; positivos: number } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Motivo del movimiento por ticker (7-sep-2026, solo display; endpoint y caché
  // PROPIOS del laboratorio — ver fetchRallyTestNews). Se carga aparte del scan:
  // si la fuente de noticias falla o tarda, el módulo enseña sus datos igual.
  const [news, setNews] = useState<Record<string, RallyNewsItem | null>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const last = await fetchLastRallyTestScan();
      if (!mounted.current) return;
      if (last?.top10?.length) {
        setState((s) => ({ ...s, status: "RALLY_FINAL", top10: last.top10 ?? [], isRallyFinal: true } as RallyState));
        setLastScanCompletedAt(last.scanCompletedAtUtc ?? null);
        setAmplitud((last as { amplitud?: { analizados: number; positivos: number } }).amplitud ?? null);
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  // Carga de los motivos: al montar y cada vez que termina un scan de test nuevo.
  const cargarNoticias = useCallback(async () => {
    const n = await fetchRallyTestNews();
    if (mounted.current) setNews(n);
  }, []);
  useEffect(() => { void cargarNoticias(); }, [cargarNoticias]);

  const scanningRef = useRef(false);
  // Devuelve true si el scan terminó con datos, false si falló, null si se saltó por
  // reentrada. El botón pequeño ignora el retorno; el bus global lo usa para informar.
  const runScan = useCallback(async (): Promise<boolean | null> => {
    if (scanningRef.current) return null;     // reentrada: ya hay un scan de Rally en curso
    scanningRef.current = true;
    setScanning(true);
    let ok = false;
    try {
      let res = await startRallyTestScan();
      // Guarda de progreso: si el backend responde 200 con token pero sin avanzar
      // batches, sin esto el bucle emitiría POSTs para siempre (y con el bus global,
      // dejaría la fase "modules" del SCAN EMRR clavada indefinidamente).
      let lastBatches = res.batchesCompleted ?? 0, stalls = 0, iterations = 0;
      while (mounted.current && !res.isRallyFinal && res.rallyToken) {
        if (++iterations > 40) throw new Error("Rally: demasiadas iteraciones de continuación");
        setState((s) => ({ ...s, coveragePercent: res.coveragePercent ?? s.coveragePercent, batchesCompleted: res.batchesCompleted ?? s.batchesCompleted, batchesTotal: res.batchesTotal ?? s.batchesTotal }));
        res = await continueRallyTestScan(res.rallyToken);
        const nb = res.batchesCompleted ?? lastBatches;
        stalls = nb > lastBatches ? 0 : stalls + 1;
        lastBatches = nb;
        if (stalls >= 3) throw new Error("Rally: el backend no avanza batches");
      }
      if (mounted.current) {
        if (res.top10?.length) {
          setState((s) => ({ ...s, status: "RALLY_FINAL", top10: res.top10 ?? [], coveragePercent: 100 } as RallyState));
          setLastScanCompletedAt(res.scanCompletedAtUtc ?? new Date().toISOString());
          setAmplitud((res as { amplitud?: { analizados: number; positivos: number } }).amplitud ?? null);
          ok = true;
          void cargarNoticias();   // el scan nuevo trae otros tickers: refrescar motivos
          // A propósito NO se avisa a la banda de alineación de cartera (evento de
          // producción): un scan de laboratorio no debe refrescar nada de producción.
        } else {
          setState((s) => ({ ...s, status: res.status ?? "RALLY_ERROR" } as RallyState));
        }
      }
    } catch {
      if (mounted.current) setState((s) => ({ ...s, status: "RALLY_ERROR" } as RallyState));
    } finally {
      scanningRef.current = false;
      if (mounted.current) setScanning(false);
    }
    return ok;
  }, [cargarNoticias]);

  // Registro en el bus global (mandato 2-sep-2026): el botón grande SCAN EMRR
  // también escanea el laboratorio. El wrapper relanza el fallo para que el toast
  // global no anuncie un éxito falso (el bus aísla con allSettled).
  useEffect(() => registerModuleScan("Rally-Test", async () => {
    const ok = await runScan();
    if (ok === false) throw new Error("El scan de Rally-Test terminó sin datos");
  }), [runScan]);

  const top10 = state.top10 ?? [];
  const hasData = top10.length > 0;
  const nextReview = estimateNextReview(lastScanCompletedAt);

  return (
    <section
      style={{
        marginBottom: 14, borderRadius: 12, overflow: "hidden",
        border: `1px solid ${AMBER}55`, background: "#07090d",
        boxShadow: `0 0 20px ${AMBER}18, 0 2px 8px rgba(0,0,0,0.35)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 14px", background: `${AMBER}14`, borderBottom: `1px solid ${AMBER}44`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: AMBER }}>
          🧪 Rally-Test · laboratorio de pruebas (no operar)
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b" }}>copia de Rally Leaders · motor y datos propios</span>
          <button
            onClick={() => void runScan()}
            disabled={scanning}
            style={{ fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 5, cursor: scanning ? "wait" : "pointer", background: `${AMBER}22`, border: `1px solid ${AMBER}66`, color: AMBER }}
          >
            {scanning ? `⟳ ${state.coveragePercent ?? 0}%` : "⟳ Escanear universo"}
          </button>
        </span>
      </div>

      {!hasData && !scanning && (
        <div style={{ padding: "16px", fontSize: 11.5, color: "#cbd5e1" }}>
          Laboratorio vacío. Pulsa <b style={{ color: AMBER }}>Escanear universo</b> para puntuar los ~600 tickers con el
          motor de <b>test</b>. Recién creado es una copia exacta del de producción, así que el primer scan debe dar el
          mismo top-10 que Rally Leaders; a partir de ahí, aquí es donde se prueban los cambios.
        </div>
      )}
      {scanning && !hasData && (
        <div style={{ padding: "16px", fontSize: 11.5, color: AMBER }}>Escaneando universo… {state.coveragePercent ?? 0}%</div>
      )}

      {hasData && (
        <>
          <div style={{ padding: "10px 16px 4px", fontSize: 10, color: "#94a3b8", display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>Metodología actual del laboratorio: <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.formula}</b></span>
            {lastScanCompletedAt && (
              <span>Último scan: <b style={{ color: "#cbd5e1" }}>{new Date(lastScanCompletedAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b> (cierres diarios, no intradía)</span>
            )}
            {nextReview && <span>Próxima revisión recomendada: <b style={{ color: AMBER }}>{nextReview}</b></span>}
            {amplitud && amplitud.analizados > 0 && (() => {
              // AMPLITUD DEL UNIVERSO — observable de salud del mercado (4-sep-2026).
              // Es INFORMACIÓN, no una regla: el cortacircuitos automático que la usaba
              // se estudió y se REFUTÓ (coste real −8,3 pp/año, n efectivo 1). Se pinta
              // para que el lector juzgue el contexto, nunca para operar por él.
              const p = amplitud.positivos / amplitud.analizados;
              const col = p >= 0.55 ? GREEN : p >= 0.35 ? AMBER : RED;
              const etq = p >= 0.55 ? "mercado ancho" : p >= 0.35 ? "mercado mixto" : "mercado estrecho";
              return (
                <span title={`${amplitud.positivos} de ${amplitud.analizados} valores del universo tienen tendencia positiva. Observable de contexto: NO dispara ninguna regla automática.`}>
                  Amplitud del universo:{" "}
                  <b style={{ color: col }}>{(p * 100).toFixed(0)}%</b>{" "}
                  <span style={{ color: col }}>({etq})</span>{" "}
                  <span style={{ color: "#64748b" }}>— {amplitud.positivos}/{amplitud.analizados} con tendencia · solo informativo</span>
                </span>
              );
            })()}
            <span>La columna <b style={{ color: AMBER }}>%</b>: SOLO los <b style={{ color: "#cbd5e1" }}>5 primeros invierten</b> (peso por score, 10-40%, Σ=100); los puestos 6-10 son <b style={{ color: "#cbd5e1" }}>reserva a 0%</b> — sustitutos naturales del próximo rebalanceo.</span>
            {/* Leyenda del aviso de motivo (7-sep-2026, misma convención que Rally
                Leaders): en móvil no hay tooltip, así que el símbolo se explica aquí.
                Solo aparece si ALGÚN ticker del top-10 tiene motivo. */}
            {Object.values(news).some(Boolean) && (
              <span><b style={{ color: AMBER }}>●</b> junto al ▼ = ese ticker tiene <b style={{ color: "#cbd5e1" }}>motivo del movimiento</b>: despliégalo para leerlo.</span>
            )}
          </div>

          <div style={{ padding: isNarrow ? "8px 8px 4px" : "8px 16px 4px" }}>
            {top10.map((a, i) => (
              <RallyTestRow key={a.providerSymbol} asset={a} rank={i + 1} isNarrow={isNarrow} news={news[a.providerSymbol] ?? null}
                expanded={expanded === a.providerSymbol}
                onToggle={() => setExpanded((e) => (e === a.providerSymbol ? null : a.providerSymbol))} />
            ))}
          </div>

          <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 9.5, color: "#64748b", lineHeight: 1.6 }}>
            <b style={{ color: AMBER }}>⚠ Módulo de laboratorio — no es una recomendación para operar.</b> Rally-Test lleva un
            motor {RALLY_TEST_BASELINE.origen}, con endpoints, motor y almacenamiento propios: nada de lo que se haga aquí
            afecta a Rally Leaders, a la banda de alineación de cartera ni al informe CarteraIBK.
            <br />
            <b style={{ color: SLATE }}>Backtest del motor LAB-M189</b> (2016-2026, 603 tickers, walk-forward: elegido con
            2017-21, confirmado en 2022-26 sin re-elegir; ensemble de 10 fases; 20 pb/lado; verificado por auditoría
            adversarial independiente — sin lookahead, costes correctos, bit-reproducible): confirmación media{" "}
            <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.confirmMedia}</b> CAGR · peor fase{" "}
            <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.confirmPeorFase}</b> — Rally Leaders (C0) en los
            mismos datos: {RALLY_TEST_BASELINE.backtest.refC0}. A costes dobles (50 pb): {RALLY_TEST_BASELINE.backtest.a50pb}.
            <br />
            <b style={{ color: RED }}>El acta del auditor (léela antes de ilusionarte):</b> la ventaja NO es del motor — es de
            la <b style={{ color: "#cbd5e1" }}>concentración top-5</b> (a igual tamaño de libro, K=10, este motor pierde contra
            Rally Leaders en 64/64 configuraciones). Esperanza honesta tras descuentos por universo superviviente y sesgo de
            diseño: <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.edgeHonesto}</b>. El trailing 45% de la v1.1
            (estudio 3, pedido por Sergi) mitigó el año malo: 2022{" "}
            <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.dd2022}</b> vs {RALLY_TEST_BASELINE.backtest.dd2022C0} de
            Rally Leaders (en tablas), con DD real pico-valle{" "}
            <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.ddRealPeorFase}</b>. Lo que el stop NO arregla: un
            crash en V tipo COVID (−53%) — un trailing a cierres no esquiva un desplome de 3 semanas. Stops ceñidos (15-25%)
            probados y descartados: whipsaw destructivo.
            <br />
            <b style={{ color: RED }}>Estudio 9 (9-sep-2026, pre-registro sellado antes de ejecutar):</b> 22 configuraciones
            nuevas (ratchet de ganancia, tope de clúster, momentum residual, vol-target, topes de peso) × 10 fases × 20/50 pb ×
            cierres e intradía — ninguna supera a v1.1 de forma material; en{" "}
            {RALLY_TEST_BASELINE.backtest.configsProbadas} configuraciones acumuladas nada la bate. Cifras honestas: confirmación
            2022-25 <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.confirmEx2026}</b> (el 64,6% incluye 8 meses
            de 2026 con el evento MRNA); la ejecución con TRAIL intradía cuesta{" "}
            <b style={{ color: "#cbd5e1" }}>{RALLY_TEST_BASELINE.backtest.costeIntradia}</b>. El ratchet que lucía +8,7 pp era UN
            día (MU −30,03% el 17-jul-2026 → re-scan → MRNA antes de su +177%): sin ese salto, +0,25 pp.
            <br />
            <b style={{ color: SLATE }}>Además:</b> universo superviviente → niveles inflados, solo valen comparaciones
            relativas. Sin stops: una caída fuerte se soporta hasta el siguiente rebalanceo. ~7-8 de 10 tickers suelen
            coincidir con Rally Leaders (ambos leen momentum largo); difieren el salto de 10 sesiones (descuenta eventos
            binarios tipo MRNA), la concentración y el ritmo. <b style={{ color: SLATE }}>Este motor NO puede proponerse para
            producción</b> sin un estudio con gates pre-registrados y commiteados (§10c). Rentabilidad pasada; no garantiza la
            futura.
          </div>
        </>
      )}
    </section>
  );
}

/** Recorrido restante del rally. Informativo: NO reordena el top-10 (probado, no mejora). */
const RUNWAY_STYLE: Record<string, { color: string; label: string; short: string }> = {
  ALTO: { color: GREEN, label: "RECORRIDO ALTO", short: "REC.↑" },
  MEDIO: { color: SLATE, label: "RECORRIDO MEDIO", short: "REC.=" },
  BAJO: { color: "#eab308", label: "RECORRIDO BAJO", short: "REC.↓" },
};

/** `short` se usa en móvil: la zona de entrada NUNCA debe ocultarse, es el dato clave. */
const ENTRY_ZONE_STYLE: Record<string, { color: string; label: string; short: string }> = {
  IDEAL: { color: GREEN, label: "ENTRADA IDEAL", short: "IDEAL" },
  LEJOS: { color: SLATE, label: "LEJOS DEL MÁXIMO", short: "LEJOS" },
  EN_MAXIMOS: { color: "#eab308", label: "EN MÁXIMOS — CAUTELA", short: "MÁX." },
  SIN_DATOS: { color: SLATE, label: "—", short: "—" },
};

function RallyTestRow({ asset, rank, isNarrow, expanded, onToggle, news }: { asset: RallyTestAsset; rank: number; isNarrow: boolean; expanded: boolean; onToggle: () => void; news: RallyNewsItem | null }) {
  const m = asset.metrics;
  const flags = asset.warningFlags ?? [];
  const entry = asset.entryTiming;
  const entryStyle = ENTRY_ZONE_STYLE[entry?.zone ?? "SIN_DATOS"] ?? ENTRY_ZONE_STYLE.SIN_DATOS;
  const runway = asset.runway;
  const runwayStyle = RUNWAY_STYLE[runway?.level ?? "MEDIO"] ?? RUNWAY_STYLE.MEDIO;
  // Stop del motor LAB-M189 v1.1: FIJO 45% para TODAS las posiciones (a diferencia
  // de Rally Leaders, que lo adapta por fase). Las anchuras adaptativas se probaron
  // en el estudio 3 y en la auditoría del stop, y PERDIERON contra el 45% fijo.
  const stop = asset.trailingStop ?? m?.trailingStop ?? null;
  const stopStyle = stop == null
    ? { color: SLATE, band: "—" }
    : stop >= 36 ? { color: GREEN, band: "AMPLIO" }
    : stop >= 25 ? { color: SLATE, band: "MEDIO" }
    : { color: "#eab308", band: "CEÑIDO" };
  // Tooltip del stop — izado para que móvil, escritorio y desplegable digan lo mismo.
  const stopTitle = "STOP FIJO del laboratorio (v1.1): trailing del 45% igual para todas las posiciones, evaluado sobre CIERRES diarios desde el máximo alcanzado. Si salta: re-escanear y reinvertir todo según los pesos del scan nuevo. No es el stop adaptativo por fase de Rally Leaders — las anchuras adaptativas se probaron aquí y perdieron.";
  // Badge de pullback eliminado 18-ago tras veredicto NO PUBLICAR del estudio — si un estudio futuro pasa el gate, añadir campo+badge+umbrales en el MISMO commit que el motor lo emita.
  // BUG FIX (móvil 375-430px, ago-2026): la fila colapsada vivía en una única línea
  // flex con 9-10 elementos de ancho fijo (~350px de mínimo) dentro de una sección con
  // overflow:hidden. En 375px el chevron ▼ quedaba COMPLETAMENTE fuera del recorte
  // (invisible, no solo "apretado") y en 390px sobrevivía por 1px. En isNarrow ahora la
  // fila se reparte en DOS líneas — 1) identidad + peso + score + chevron, SIEMPRE
  // visibles; 2) badges de recorrido/entrada/stop/aviso, con margen de sobra — en vez de
  // forzarlo todo en una sola línea que no cabía en ningún iPhone actual. Desktop/tablet
  // (isNarrow=false, ≥748px desde el 18-ago — antes 680, la banda 680-747 desbordaba con
  // la columna de sesión) no cambia: ahí la fila de una línea cabe completa.
  const badgeRow = (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span title={runway ? `Recorrido restante ${runway.score}/100 — ${runway.reasons.join(" · ")}` : undefined}
        style={{ width: 60, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
          color: runway ? runwayStyle.color : "transparent",
          background: runway ? `${runwayStyle.color}18` : "transparent",
          border: `1px solid ${runway ? `${runwayStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
        {runway ? runwayStyle.short : "—"}
      </span>
      <span title={entry?.label}
        style={{ width: 54, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
          color: entry ? entryStyle.color : "transparent",
          background: entry ? `${entryStyle.color}18` : "transparent",
          border: `1px solid ${entry ? `${entryStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
        {entry ? entryStyle.short : "—"}
      </span>
      <span title={stop != null ? stopTitle : undefined}
        style={{ width: 54, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
          color: stop != null ? stopStyle.color : "transparent",
          background: stop != null ? `${stopStyle.color}18` : "transparent",
          border: `1px solid ${stop != null ? `${stopStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
        {stop != null ? `STOP ${stop}%` : "—"}
      </span>
      <span title={flags.length ? flags.map((f) => f.label).join(" · ") : undefined}
        style={{ width: 14, flexShrink: 0, textAlign: "center", fontSize: 11 }}>
        {flags.length > 0 ? "⚠" : ""}
      </span>
    </span>
  );

  // Rentabilidad de la SESIÓN en el momento del scan (mercado cerrado → última sesión).
  // Verde/rojo con signo, junto al ticker (izquierda) para que no se confunda con el
  // peso de inversión (ámbar, derecha). Solo informativo: no toca el análisis.
  const dchg = asset.metrics?.dayChangePct;
  const dchgColor = dchg == null ? "transparent" : dchg > 0 ? "#22c55e" : dchg < 0 ? "#ef4444" : "#94a3b8";
  const dchgText = dchg == null ? "" : `${dchg > 0 ? "+" : ""}${dchg.toFixed(2)}%`;
  const dchgTitle = "Rentabilidad de la sesión en el momento del scan (último precio vs cierre anterior). Con el mercado ABIERTO es el dato en curso a esa hora — puede diferir del tiempo real actual; con mercado cerrado, la de la última sesión. No es el peso de inversión.";
  // Convención única con flag spacer: en escritorio (reserveWhenNull=true) el hueco de
  // ancho fijo se renderiza SIEMPRE aunque falte el dato, para que las columnas fijas
  // (mandato 11-ago-2026) sigan alineadas fila contra fila; en móvil (false) no se
  // reserva hueco y la línea 1 recupera ese espacio.
  const dayChangeEl = (width: number, reserveWhenNull: boolean) =>
    dchg == null && !reserveWhenNull ? null : (
      <span title={dchg != null ? dchgTitle : undefined}
        style={{ fontSize: 10, fontWeight: 800, color: dchgColor, fontVariantNumeric: "tabular-nums",
          width, flexShrink: 0, textAlign: "left", whiteSpace: "nowrap" }}>
        {dchgText}
      </span>
    );
  // Tooltip del PESO de inversión — izado (patrón dchgTitle) para que ambas ramas
  // (móvil y escritorio) muestren SIEMPRE el mismo texto.
  const weightTitle = "PESO de inversión LAB-M189: % del capital del módulo sugerido para esta posición — SOLO los 5 primeros invierten (por score, 10-40%, Σ=100); los puestos 6-10 son reserva a 0%. No es el trailing stop — el stop tiene su propio badge STOP.";
  // AVISO DE MOTIVO en la fila colapsada (7-sep-2026, misma convención que Rally
  // Leaders 27-ago): punto junto al chevron cuando ese ticker TIENE motivo del
  // movimiento; sin motivo → NINGÚN símbolo, pero el HUECO (width 9) se reserva
  // SIEMPRE — la regla de columnas fijas exige que ninguna fila se desplace.
  // Color: el acento del módulo (violeta laboratorio, constante AMBER local).
  const motivoEl = (
    <span title={news ? `Motivo del movimiento: ${news.headline}` : undefined}
      aria-label={news ? "Tiene motivo del movimiento" : undefined}
      style={{ width: 9, flexShrink: 0, textAlign: "center", fontSize: 7.5,
        color: AMBER, lineHeight: 1, whiteSpace: "nowrap" }}>
      {news ? "●" : ""}
    </span>
  );

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex",
          flexDirection: isNarrow ? "column" : "row",
          alignItems: isNarrow ? "stretch" : "center",
          gap: isNarrow ? 6 : 10, padding: "7px 2px", cursor: "pointer",
          background: "transparent", border: "none", textAlign: "left", color: "inherit",
        }}
      >
        {isNarrow ? (
          <>
            {/* Línea 1 — identidad + peso + score + chevron: nunca se cortan, van SIEMPRE
                por encima del recorte del panel, sea cual sea el ancho del móvil. */}
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: rank <= 3 ? AMBER : SLATE, width: 18, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#e2e8f0", flex: "0 1 auto", minWidth: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.ticker}</span>
              {dayChangeEl(48, false)}
              <span style={{ flex: 1, minWidth: 6 }} />
              <span title={weightTitle}
                style={{ fontSize: 10, fontWeight: 800, color: AMBER, fontVariantNumeric: "tabular-nums", flexShrink: 0, textAlign: "right" }}>
                {asset.suggestedWeightPct != null ? `${asset.suggestedWeightPct.toFixed(1)}%` : "—"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: asset.rallyColor || AMBER, fontVariantNumeric: "tabular-nums", flexShrink: 0, textAlign: "right", minWidth: 24 }}>{asset.rallyScore}</span>
              {motivoEl}
              <span style={{ fontSize: 10, color: "#64748b", flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
            </span>
            {/* Línea 2 — badges de recorrido/entrada/stop/aviso, con hueco de sobra en
                cualquier iPhone (375-430px); ya no comparten línea con rank/ticker/score. */}
            {badgeRow}
          </>
        ) : (
          <>
            {/* COLUMNAS DE ANCHO FIJO (mandato 11-ago-2026): todos los datos deben quedar
                alineados verticalmente con la fila inmediatamente inferior. Los badges se
                renderizan SIEMPRE (aunque falte el dato) y el ⚠ tiene su hueco reservado,
                para que ninguna columna se desplace según qué campos tenga cada ticker. */}
            <span style={{ fontSize: 12, fontWeight: 900, color: rank <= 3 ? AMBER : SLATE, width: 20, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#e2e8f0", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{asset.ticker}</span>
            {dayChangeEl(52, true)}
            <span style={{ fontSize: 10.5, color: "#94a3b8", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span>
            <span title={runway ? `Recorrido restante ${runway.score}/100 — ${runway.reasons.join(" · ")}` : undefined}
              style={{ width: 128, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
                color: runway ? runwayStyle.color : "transparent",
                background: runway ? `${runwayStyle.color}18` : "transparent",
                border: `1px solid ${runway ? `${runwayStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
              {runway ? runwayStyle.label : "—"}
            </span>
            <span title={entry?.label}
              style={{ width: 118, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
                color: entry ? entryStyle.color : "transparent",
                background: entry ? `${entryStyle.color}18` : "transparent",
                border: `1px solid ${entry ? `${entryStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
              {entry ? entryStyle.label : "—"}
            </span>
            <span title={stop != null ? stopTitle : undefined}
              style={{ width: 62, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
                color: stop != null ? stopStyle.color : "transparent",
                background: stop != null ? `${stopStyle.color}18` : "transparent",
                border: `1px solid ${stop != null ? `${stopStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
              {stop != null ? `STOP ${stop}%` : "—"}
            </span>
            <span title={flags.length ? flags.map((f) => f.label).join(" · ") : undefined}
              style={{ width: 14, flexShrink: 0, textAlign: "center", fontSize: 11 }}>
              {flags.length > 0 ? "⚠" : ""}
            </span>
            <span title={weightTitle}
              style={{ fontSize: 10.5, fontWeight: 800, color: AMBER, fontVariantNumeric: "tabular-nums", width: 44, flexShrink: 0, textAlign: "right" }}>
              {asset.suggestedWeightPct != null ? `${asset.suggestedWeightPct.toFixed(1)}%` : "—"}
            </span>
            <span style={{ fontSize: 13, fontWeight: 900, color: asset.rallyColor || AMBER, fontVariantNumeric: "tabular-nums", width: 30, flexShrink: 0, textAlign: "right" }}>{asset.rallyScore}</span>
            {motivoEl}
            <span style={{ fontSize: 9, color: "#64748b", width: 14, flexShrink: 0, textAlign: "right" }}>{expanded ? "▲" : "▼"}</span>
          </>
        )}
      </button>

      {expanded && (
        <div style={{ padding: "4px 4px 12px 34px", display: "flex", flexDirection: "column", gap: 8 }}>
          {isNarrow && <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{asset.name}</div>}
          <MotivoDelMovimiento news={news} dayChangePct={m?.dayChangePct ?? null} />
          {entry && (
            <div style={{ fontSize: 10.5, padding: "6px 10px", borderRadius: 6, color: entryStyle.color, background: `${entryStyle.color}14`, border: `1px solid ${entryStyle.color}44` }}>
              <b>{entryStyle.label}</b> — {entry.label}
            </div>
          )}
          {runway && (
            <div style={{ fontSize: 10.5, padding: "6px 10px", borderRadius: 6, color: runwayStyle.color, background: `${runwayStyle.color}14`, border: `1px solid ${runwayStyle.color}44` }}>
              <b>{runwayStyle.label} ({runway.score}/100)</b>
              {runway.reasons.length > 0 && <> — {runway.reasons.join(". ")}</>}
            </div>
          )}
          {/* Parrilla con las métricas PROPIAS del motor LAB-M189 (7-sep-2026): la
              heredada de la copia pedía campos de producción (mom9m, rs3m, ATR, RVOL)
              que este motor no emite y pintaba "—" en todo. */}
          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8 }}>
            <Stat label="Precio" value={m?.lastClose != null ? m.lastClose.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} />
            <Stat label="Señal 189s10 (9m)" value={pct(m?.momRaw)} tone={AMBER} />
            <Stat label="Momento 3m" value={pct(m?.mom63)} tone={(m?.mom63 ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Momento 6m" value={pct(m?.mom126)} tone={(m?.mom126 ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Dist. a máx. 52 sem." value={m?.prox52w != null ? pct(m.prox52w - 100) : "—"} tone={m?.prox52w != null && m.prox52w >= 96 ? GREEN : SLATE} />
            <Stat label="Sobre su media de 50" value={pct(m?.ext50)} tone={(m?.ext50 ?? 0) >= 0 ? SLATE : "#eab308"} />
            <Stat label="Stop fijo (v1.1)" value={stop != null ? `${stop}% · ${stopStyle.band}` : "—"} tone={stopStyle.color} />
            <Stat label="Volatilidad anual" value={m?.vol126 != null ? `${m.vol126.toFixed(0)}%` : "—"} tone={(m?.vol126 ?? 0) > 60 ? "#eab308" : SLATE} />
            <Stat label="Calidad de tendencia" value={m?.tq != null ? `${m.tq.toFixed(2)}${m?.r2 != null ? ` · R² ${m.r2.toFixed(2)}` : ""}` : "—"} />
            <Stat label="Mayor mov. 1 día (mes)" value={m?.maxDay21 != null ? `${m.maxDay21.toFixed(1)}%` : "—"} tone={(m?.maxDay21 ?? 0) > 20 ? RED : SLATE} />
          </div>
          {flags.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {flags.map((f) => (
                <div key={f.code} style={{ fontSize: 10, color: "#fecaca", background: `${RED}12`, border: `1px solid ${RED}44`, borderRadius: 5, padding: "4px 8px" }}>
                  ⚠ {f.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * MOTIVO DEL MOVIMIENTO — copia PROPIA del laboratorio (7-sep-2026) del componente
 * de Rally Leaders: una sola línea con el catalizador más probable del día. Verde
 * si el ticker sube en la sesión del scan, rojo si baja, gris si no hay motivo
 * identificable — el color lo marca el PRECIO, no el tono de la noticia. Si no hay
 * noticia se dice explícitamente; nunca se inventa una explicación.
 */
function MotivoDelMovimiento({ news, dayChangePct }: { news: RallyNewsItem | null; dayChangePct: number | null | undefined }) {
  const sube = typeof dayChangePct === "number" && dayChangePct > 0;
  const baja = typeof dayChangePct === "number" && dayChangePct < 0;
  const color = !news ? "#64748b" : sube ? GREEN : baja ? RED : SLATE;
  const etiqueta = !news ? "SIN MOTIVO IDENTIFICADO" : sube ? "MOTIVO ▲" : baja ? "MOTIVO ▼" : "MOTIVO";
  const cuerpo = news
    ? news.headline
    : "Ninguna noticia relevante de la empresa en las últimas sesiones: el movimiento no tiene un catalizador identificable.";
  const fecha = news?.publishedAtUtc
    ? new Date(news.publishedAtUtc).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 10px", borderRadius: 6,
      background: `${color}12`, border: `1px solid ${color}44` }}>
      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", color, flexShrink: 0, paddingTop: 1, whiteSpace: "nowrap" }}>
        {etiqueta}
      </span>
      <span title={news?.headlineOriginal && news.headlineOriginal !== news.headline ? `Titular original: ${news.headlineOriginal}` : undefined}
        style={{ fontSize: 10.5, color: news ? "#e2e8f0" : "#94a3b8", lineHeight: 1.45 }}>
        {news?.url ? (
          <a href={news.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", borderBottom: `1px dotted ${color}88` }}>
            {cuerpo}
          </a>
        ) : cuerpo}
        {news && (
          <span style={{ color: "#64748b", fontSize: 9 }}>
            {" · "}{news.publisher}{fecha ? ` · ${fecha}` : ""}
          </span>
        )}
      </span>
    </div>
  );
}

function Stat({ label, value, tone = "#e2e8f0" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", marginTop: 1 }}>{value}</div>
    </div>
  );
}
