/**
 * RallyPanel — "los 10 tickers con el rally alcista más sano" del universo completo.
 *
 * Reactivado y REVALIDADO 9-ago-2026 (ver docs/RALLY-MODULE-AUDIT.md): la fórmula v2.0
 * original perdía contra comprar y mantener el S&P 500. La v3.0 (fuerza relativa 50% +
 * momento 50%, sin penalizar en el ranking) sí bate al índice con backtest de 10 años,
 * validada contra sobreajuste (fuera de muestra) y contra sesgo de supervivencia (control
 * frente a selección aleatoria). Módulo independiente: usa su propio endpoint de scan.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
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

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      let res = await startRallyScan();
      while (mounted.current && !res.isRallyFinal && res.rallyToken) {
        setState((s) => ({ ...s, coveragePercent: res.coveragePercent ?? s.coveragePercent, batchesCompleted: res.batchesCompleted ?? s.batchesCompleted, batchesTotal: res.batchesTotal ?? s.batchesTotal }));
        res = await continueRallyScan(res.rallyToken);
      }
      if (mounted.current) {
        if (res.top10?.length) {
          setState((s) => ({ ...s, status: "RALLY_FINAL", top10: res.top10 ?? [], coveragePercent: 100 } as RallyState));
          setLastScanCompletedAt(res.scanCompletedAtUtc ?? new Date().toISOString());
        } else {
          setState((s) => ({ ...s, status: res.status ?? "RALLY_ERROR" } as RallyState));
        }
      }
    } catch {
      if (mounted.current) setState((s) => ({ ...s, status: "RALLY_ERROR" } as RallyState));
    } finally {
      if (mounted.current) setScanning(false);
    }
  }, []);

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
          <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b" }}>v3.0 validada · módulo independiente</span>
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
          obtener los 10 con la tendencia alcista más sana (fuerza relativa + momento, validado con 10 años de backtest).
        </div>
      )}
      {scanning && !hasData && (
        <div style={{ padding: "16px", fontSize: 11.5, color: AMBER }}>Escaneando universo… {state.coveragePercent ?? 0}%</div>
      )}

      {hasData && (
        <>
          <div style={{ padding: "10px 16px 4px", fontSize: 10, color: "#94a3b8", display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>Metodología: <b style={{ color: "#cbd5e1" }}>{RALLY_BACKTEST.formula}</b></span>
            {nextReview && <span>Próxima revisión recomendada: <b style={{ color: AMBER }}>{nextReview}</b></span>}
          </div>

          <div style={{ padding: "8px 16px 4px" }}>
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
            ⚠ Caída máxima superior al índice: diez valores de máximo momento pueden caer a la vez. Rentabilidad pasada; no garantiza la futura.
            <br />
            <b style={{ color: SLATE }}>Zona de entrada</b> (badge junto a cada ticker): validada por separado con 260 episodios históricos de
            entrada en el top-10, comprobada en dos mitades independientes del periodo. Solo la proximidad al máximo de 52 semanas mostró señal
            consistente — cerca del máximo sin tocarlo dio mejor rentabilidad Y menor caída en ambas mitades. Muestra más pequeña que el
            backtest principal: tómala como apoyo, no como semáforo definitivo.
          </div>
        </>
      )}
    </section>
  );
}

const ENTRY_ZONE_STYLE: Record<string, { color: string; label: string }> = {
  IDEAL: { color: GREEN, label: "ENTRADA IDEAL" },
  LEJOS: { color: SLATE, label: "LEJOS DEL MÁXIMO" },
  EN_MAXIMOS: { color: "#eab308", label: "EN MÁXIMOS — CAUTELA" },
  SIN_DATOS: { color: SLATE, label: "—" },
};

function RallyRow({ asset, rank, isNarrow, expanded, onToggle }: { asset: RallyAsset; rank: number; isNarrow: boolean; expanded: boolean; onToggle: () => void }) {
  const m = asset.metrics;
  const flags = asset.warningFlags ?? [];
  const entry = asset.entryTiming;
  const entryStyle = ENTRY_ZONE_STYLE[entry?.zone ?? "SIN_DATOS"];
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", cursor: "pointer",
          background: "transparent", border: "none", textAlign: "left", color: "inherit",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 900, color: rank <= 3 ? AMBER : SLATE, width: 20, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{rank}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#e2e8f0", width: isNarrow ? 70 : 90 }}>{asset.ticker}</span>
        {!isNarrow && <span style={{ fontSize: 10.5, color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span>}
        {!isNarrow && entry && (
          <span title={entry.label} style={{ fontSize: 8.5, fontWeight: 800, padding: "2px 7px", borderRadius: 4, color: entryStyle.color, background: `${entryStyle.color}18`, border: `1px solid ${entryStyle.color}55`, whiteSpace: "nowrap" }}>
            {entryStyle.label}
          </span>
        )}
        {flags.length > 0 && <span title={flags.map((f) => f.label).join(" · ")} style={{ fontSize: 11 }}>⚠</span>}
        <span style={{ fontSize: 13, fontWeight: 900, color: asset.rallyColor || AMBER, fontVariantNumeric: "tabular-nums", width: 34, textAlign: "right" }}>{asset.rallyScore}</span>
        <span style={{ fontSize: 9, color: "#64748b", width: 60, textAlign: "right" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "4px 4px 12px 34px", display: "flex", flexDirection: "column", gap: 8 }}>
          {isNarrow && <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{asset.name}</div>}
          {entry && (
            <div style={{ fontSize: 10.5, padding: "6px 10px", borderRadius: 6, color: entryStyle.color, background: `${entryStyle.color}14`, border: `1px solid ${entryStyle.color}44` }}>
              <b>{entryStyle.label}</b> — {entry.label}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8 }}>
            <Stat label="Precio" value={m?.lastClose != null ? m.lastClose.toFixed(2) : "—"} />
            <Stat label="Momento 3m" value={pct(m?.mom3m)} tone={(m?.mom3m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Momento 6m" value={pct(m?.mom6m)} tone={(m?.mom6m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Fuerza rel. 3m vs S&P" value={pct(m?.rs3m)} tone={(m?.rs3m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Fuerza rel. 6m vs S&P" value={pct(m?.rs6m)} tone={(m?.rs6m ?? 0) > 0 ? GREEN : RED} />
            <Stat label="Trailing stop sugerido" value={m?.trailingStop != null ? `${m.trailingStop}%` : "—"} />
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
