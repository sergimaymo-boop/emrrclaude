/**
 * RallyPanel — "los 10 tickers con el rally alcista más sano" del universo completo.
 *
 * Reactivado y REVALIDADO 9-ago-2026 (ver docs/RALLY-MODULE-AUDIT.md): la fórmula v2.0
 * original perdía contra comprar y mantener el S&P 500. La v4.0 (momento puro a 9 meses,
 * ganador de la super-auditoría de familias de indicadores: dominó en las 9 celdas de la
 * malla fase×cadencia) bate al índice con backtest de 10 años, validada contra sobreajuste
 * y contra sesgo de supervivencia. Módulo independiente: usa su propio endpoint de scan.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { registerModuleScan } from "../services/scanBus";
import {
  RALLY_BACKTEST,
  type RallyAsset,
  type RallyState,
  continueRallyScan,
  estimateNextReview,
  fetchLastRallyScan,
  initialRallyState,
  startRallyScan,
} from "../services/rallyRefresh";

const AMBER = "#f59e0b";
const GREEN = "#22c55e";
const RED = "#ef4444";
const SLATE = "#94a3b8";

const pct = (v: number | null | undefined, d = 1) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");

export function RallyPanel() {
  const isNarrow = useIsNarrow(680);
  const [state, setState] = useState<RallyState>(() => initialRallyState());
  const [scanning, setScanning] = useState(false);
  const [lastScanCompletedAt, setLastScanCompletedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const last = await fetchLastRallyScan();
      if (!mounted.current) return;
      if (last?.top10?.length) {
        setState((s) => ({ ...s, status: "RALLY_FINAL", top10: last.top10 ?? [], isRallyFinal: true } as RallyState));
        setLastScanCompletedAt(last.scanCompletedAtUtc ?? null);
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  const scanningRef = useRef(false);
  // Devuelve true si el scan terminó con datos, false si falló, null si se saltó por
  // reentrada. El botón pequeño ignora el retorno; el bus global lo usa para informar.
  const runScan = useCallback(async (): Promise<boolean | null> => {
    if (scanningRef.current) return null;     // reentrada: ya hay un scan de Rally en curso
    scanningRef.current = true;
    setScanning(true);
    let ok = false;
    try {
      let res = await startRallyScan();
      // Guarda de progreso: si el backend responde 200 con token pero sin avanzar
      // batches, sin esto el bucle emitiría POSTs para siempre (y con el bus global,
      // dejaría la fase "modules" del SCAN EMRR clavada indefinidamente).
      let lastBatches = res.batchesCompleted ?? 0, stalls = 0, iterations = 0;
      while (mounted.current && !res.isRallyFinal && res.rallyToken) {
        if (++iterations > 40) throw new Error("Rally: demasiadas iteraciones de continuación");
        setState((s) => ({ ...s, coveragePercent: res.coveragePercent ?? s.coveragePercent, batchesCompleted: res.batchesCompleted ?? s.batchesCompleted, batchesTotal: res.batchesTotal ?? s.batchesTotal }));
        res = await continueRallyScan(res.rallyToken);
        const nb = res.batchesCompleted ?? lastBatches;
        stalls = nb > lastBatches ? 0 : stalls + 1;
        lastBatches = nb;
        if (stalls >= 3) throw new Error("Rally: el backend no avanza batches");
      }
      if (mounted.current) {
        if (res.top10?.length) {
          setState((s) => ({ ...s, status: "RALLY_FINAL", top10: res.top10 ?? [], coveragePercent: 100 } as RallyState));
          setLastScanCompletedAt(res.scanCompletedAtUtc ?? new Date().toISOString());
          ok = true;
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
  }, []);

  // Registro en el bus global: el botón grande SCAN EMRR también escanea este módulo.
  // El wrapper RELANZA el fallo para que el toast global no anuncie un éxito falso
  // (el bus aísla con allSettled, así que relanzar aquí es seguro para los demás).
  useEffect(() => registerModuleScan("Rally", async () => {
    const ok = await runScan();
    if (ok === false) throw new Error("El scan de Rally terminó sin datos");
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
          🔥 Rally Leaders · los 10 con la tendencia más sana
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b" }}>v4.0 validada · módulo independiente</span>
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
          Sin escaneo reciente. Pulsa <b style={{ color: AMBER }}>Escanear universo</b> para puntuar los ~600 tickers y
          obtener los 10 con la tendencia alcista más sana (momento a 9 meses, validado con 10 años de backtest).
        </div>
      )}
      {scanning && !hasData && (
        <div style={{ padding: "16px", fontSize: 11.5, color: AMBER }}>Escaneando universo… {state.coveragePercent ?? 0}%</div>
      )}

      {hasData && (
        <>
          <div style={{ padding: "10px 16px 4px", fontSize: 10, color: "#94a3b8", display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>Metodología: <b style={{ color: "#cbd5e1" }}>{RALLY_BACKTEST.formula}</b></span>
            {lastScanCompletedAt && (
              <span>Último scan: <b style={{ color: "#cbd5e1" }}>{new Date(lastScanCompletedAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b> (cierres diarios, no intradía)</span>
            )}
            {nextReview && <span>Próxima revisión recomendada: <b style={{ color: AMBER }}>{nextReview}</b></span>}
            <span>La columna <b style={{ color: AMBER }}>%</b> es el peso sugerido de cada posición sobre el capital del módulo.</span>
          </div>

          <div style={{ padding: isNarrow ? "8px 8px 4px" : "8px 16px 4px" }}>
            {top10.map((a, i) => (
              <RallyRow key={a.providerSymbol} asset={a} rank={i + 1} isNarrow={isNarrow}
                expanded={expanded === a.providerSymbol}
                onToggle={() => setExpanded((e) => (e === a.providerSymbol ? null : a.providerSymbol))} />
            ))}
          </div>

          <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 9.5, color: "#64748b", lineHeight: 1.6 }}>
            Validado en <b style={{ color: SLATE }}>{RALLY_BACKTEST.period}</b>: esta selección dio{" "}
            <b style={{ color: AMBER }}>{(RALLY_BACKTEST.strategy.cagr * 100).toFixed(1)}%</b> anual con una caída máxima del{" "}
            <b style={{ color: AMBER }}>{(RALLY_BACKTEST.strategy.maxDD * 100).toFixed(0)}%</b> (MAR {RALLY_BACKTEST.strategy.mar.toFixed(2)}),
            frente a {(RALLY_BACKTEST.buyHold.cagr * 100).toFixed(1)}% / {(RALLY_BACKTEST.buyHold.maxDD * 100).toFixed(0)}% de comprar y mantener el S&amp;P 500.
            Con reparto a partes iguales, en lugar de por convicción, la misma selección daba {(RALLY_BACKTEST.equalWeight.cagr * 100).toFixed(1)}%
            (MAR {RALLY_BACKTEST.equalWeight.mar.toFixed(2)}): respetar los pesos sugeridos es parte de la estrategia.
            La señal del ranking es el <b style={{ color: SLATE }}>momento a 9 meses</b> (189 sesiones): en la super-auditoría de familias de
            indicadores (momento a 4 plazos, RSI, fuerza relativa, momento/volatilidad y combos) fue la única que dominó en las 9 celdas de la
            malla fase×cadencia — y coincide con la ventana que OPTIMAL SUPREME encontró por separado con sus 118 variantes.
            ⚠ Caída máxima superior al índice: diez valores de máximo momento pueden caer a la vez. Rentabilidad pasada; no garantiza la futura.
            <br />
            <b style={{ color: SLATE }}>Zona de entrada</b> (badge junto a cada ticker): validada por separado con 260 episodios históricos de
            entrada en el top-10, comprobada en dos mitades independientes del periodo. Solo la proximidad al máximo de 52 semanas mostró señal
            consistente — cerca del máximo sin tocarlo dio mejor rentabilidad Y menor caída en ambas mitades. Muestra más pequeña que el
            backtest principal: tómala como apoyo, no como semáforo definitivo.
            <br />
            <b style={{ color: SLATE }}>Recorrido restante</b>: validado con 1.060 episodios midiendo lo que un trailing stop captura de verdad
            desde la entrada. Tendencia joven y poco extendida sobre su media de 50 = más recorrido por delante; en máximos de 52 semanas = menos.
            Es informativo: se probó usarlo para filtrar o reordenar el top-10 y <b>ninguna variante mejoró</b> a la cartera base.
            <br />
            <b style={{ color: "#eab308" }}>⚠ Sobre el stop</b>: un trailing ceñido uniforme <b>destruye rentabilidad aquí</b> (probado también
            con salto inmediato al mejor candidato: 15,5% frente a 39,4%). El <b>STOP de cada fila es ADAPTATIVO POR TICKER</b> (estudio
            15-ago-2026): anchura = <b>{RALLY_BACKTEST.withStops.stopRule}</b> — recorrido alto (tendencia joven, poco estirada, sin agotar)
            → stop <b style={{ color: GREEN }}>AMPLIO</b> para dejar correr; recorrido bajo → <b style={{ color: "#eab308" }}>CEÑIDO</b> para
            ceder poco en el pullback y rotar. Se evalúa sobre <b>cierres diarios</b> (salta si el CIERRE cae ese % desde su máximo de cierre);
            no es una orden trailing intradía en el broker — una orden intradía saltaría más a menudo que lo backtesteado.
            <b style={{ color: SLATE }}> Si un stop te salta</b>: re-escanea y entra en el mejor por <b>mezcla 70/30 de score y recorrido</b>{" "}
            ({RALLY_BACKTEST.withStops.jumpRule}). La mecánica completa midió{" "}
            <b style={{ color: AMBER }}>{(RALLY_BACKTEST.withStops.cagr * 100).toFixed(1)}%</b> anual con caída máxima del{" "}
            <b style={{ color: AMBER }}>{(RALLY_BACKTEST.withStops.maxDD * 100).toFixed(1)}%</b> (MAR {RALLY_BACKTEST.withStops.mar.toFixed(2)},
            aciertos {(RALLY_BACKTEST.withStops.winRate * 100).toFixed(0)}%), elegida solo con la 1ª mitad del histórico y confirmada en la 2ª;
            gana 7/9 celdas de la malla al campeón sin stops (no domina 9/9) y 6/9 al fijo 30%. Probados y <b>descartados con números</b>:
            stop por k·ATR (satura y pierde robustez), modulación por "salud" compuesta, parámetros por ticker incluso con shrinkage (los
            óptimos individuales no son estables), ratchets de beneficio, y exigir "entrada IDEAL" al saltar (pierde en todas las celdas).
            ⚠ Todas estas cifras son de backtest con el universo superviviente actual y ejecución ideal al cierre (20 pb de costes):{" "}
            <b>sirven para comparar variantes entre sí, no como rentabilidad esperada</b>.
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

function RallyRow({ asset, rank, isNarrow, expanded, onToggle }: { asset: RallyAsset; rank: number; isNarrow: boolean; expanded: boolean; onToggle: () => void }) {
  const m = asset.metrics;
  const flags = asset.warningFlags ?? [];
  const entry = asset.entryTiming;
  const entryStyle = ENTRY_ZONE_STYLE[entry?.zone ?? "SIN_DATOS"] ?? ENTRY_ZONE_STYLE.SIN_DATOS;
  const runway = asset.runway;
  const runwayStyle = RUNWAY_STYLE[runway?.level ?? "MEDIO"] ?? RUNWAY_STYLE.MEDIO;
  // Stop sugerido ADAPTATIVO por ticker (12 + 0,35·recorrido, acotado 15-45%).
  const stop = asset.trailingStop ?? m?.trailingStop ?? null;
  const stopStyle = stop == null
    ? { color: SLATE, band: "—" }
    : stop >= 36 ? { color: GREEN, band: "AMPLIO" }
    : stop >= 25 ? { color: SLATE, band: "MEDIO" }
    : { color: "#eab308", band: "CEÑIDO" };
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: isNarrow ? 4 : 10, padding: "7px 2px", cursor: "pointer",
          background: "transparent", border: "none", textAlign: "left", color: "inherit",
        }}
      >
        {/* COLUMNAS DE ANCHO FIJO (mandato 11-ago-2026): todos los datos deben quedar
            alineados verticalmente con la fila inmediatamente inferior. Los badges se
            renderizan SIEMPRE (aunque falte el dato) y el ⚠ tiene su hueco reservado,
            para que ninguna columna se desplace según qué campos tenga cada ticker. */}
        <span style={{ fontSize: 12, fontWeight: 900, color: rank <= 3 ? AMBER : SLATE, width: 20, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#e2e8f0", width: isNarrow ? 52 : 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{asset.ticker}</span>
        {!isNarrow && <span style={{ fontSize: 10.5, color: "#94a3b8", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span>}
        {isNarrow && <span style={{ flex: 1, minWidth: 0 }} />}
        <span title={runway ? `Recorrido restante ${runway.score}/100 — ${runway.reasons.join(" · ")}` : undefined}
          style={{ width: isNarrow ? 52 : 128, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
            color: runway ? runwayStyle.color : "transparent",
            background: runway ? `${runwayStyle.color}18` : "transparent",
            border: `1px solid ${runway ? `${runwayStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
          {runway ? (isNarrow ? runwayStyle.short : runwayStyle.label) : "—"}
        </span>
        <span title={entry?.label}
          style={{ width: isNarrow ? 48 : 118, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
            color: entry ? entryStyle.color : "transparent",
            background: entry ? `${entryStyle.color}18` : "transparent",
            border: `1px solid ${entry ? `${entryStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
          {entry ? (isNarrow ? entryStyle.short : entryStyle.label) : "—"}
        </span>
        <span title={stop != null ? `Stop sugerido para ESTE ticker según su fase (${stopStyle.band.toLowerCase()}): amplio si la tendencia es sana con recorrido, ceñido si el recorrido se agota. Evaluado sobre cierres diarios.` : undefined}
          style={{ width: isNarrow ? 40 : 62, flexShrink: 0, textAlign: "center", fontSize: 8.5, fontWeight: 800, padding: "2px 0", borderRadius: 4,
            color: stop != null ? stopStyle.color : "transparent",
            background: stop != null ? `${stopStyle.color}18` : "transparent",
            border: `1px solid ${stop != null ? `${stopStyle.color}55` : "transparent"}`, whiteSpace: "nowrap" }}>
          {stop != null ? (isNarrow ? `${stop}%` : `STOP ${stop}%`) : "—"}
        </span>
        <span title={flags.length ? flags.map((f) => f.label).join(" · ") : undefined}
          style={{ width: 14, flexShrink: 0, textAlign: "center", fontSize: 11 }}>
          {flags.length > 0 ? "⚠" : ""}
        </span>
        <span title="Porcentaje del capital del módulo sugerido para esta posición"
          style={{ fontSize: 10.5, fontWeight: 800, color: AMBER, fontVariantNumeric: "tabular-nums", width: 44, flexShrink: 0, textAlign: "right" }}>
          {asset.suggestedWeightPct != null ? `${asset.suggestedWeightPct.toFixed(1)}%` : "—"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 900, color: asset.rallyColor || AMBER, fontVariantNumeric: "tabular-nums", width: 30, flexShrink: 0, textAlign: "right" }}>{asset.rallyScore}</span>
        <span style={{ fontSize: 9, color: "#64748b", width: 14, flexShrink: 0, textAlign: "right" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "4px 4px 12px 34px", display: "flex", flexDirection: "column", gap: 8 }}>
          {isNarrow && <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{asset.name}</div>}
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
          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8 }}>
            <Stat label="Precio" value={m?.lastClose != null ? m.lastClose.toFixed(2) : "—"} />
            <Stat label="Momento 9m (señal)" value={pct(m?.mom9m)} tone={AMBER} />
            <Stat label="Momento 3m" value={pct(m?.mom3m)} tone={(m?.mom3m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Momento 6m" value={pct(m?.mom6m)} tone={(m?.mom6m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Fuerza rel. 3m vs S&P" value={pct(m?.rs3m)} tone={(m?.rs3m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Fuerza rel. 6m vs S&P" value={pct(m?.rs6m)} tone={(m?.rs6m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Stop sugerido (fase)" value={stop != null ? `${stop}% · ${stopStyle.band}` : "—"} tone={stopStyle.color} />
            <Stat label="ATR" value={m?.atrPercent != null ? `${m.atrPercent.toFixed(1)}%` : "—"} />
            <Stat label="Volumen relativo" value={m?.rvol != null ? `${m.rvol.toFixed(2)}x` : "—"} />
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

function Stat({ label, value, tone = "#e2e8f0" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", marginTop: 1 }}>{value}</div>
    </div>
  );
}
