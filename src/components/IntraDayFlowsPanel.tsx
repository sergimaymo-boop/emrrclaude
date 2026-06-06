import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockMover {
  ticker: string;
  price: number;
  change: number;
}

interface SectorFlow {
  rank: number;
  key: string;
  name: string;
  etf: string;
  currentPrice: number;
  intradayChange: number;
  change30min: number;
  changeMomentum: number;
  relativeVolume: number;
  flowScore: number;
  direction: "STRONG_IN" | "IN" | "NEUTRAL" | "OUT" | "STRONG_OUT";
  topMovers: StockMover[];
}

export interface IntraDayFlowsState {
  status: "IDLE" | "SCANNING" | "DONE" | "ERROR";
  scannedAt: string | null;
  marketOpen: boolean;
  spy: { intradayChange: number; currentPrice: number; relativeVolume: number } | null;
  sectors: SectorFlow[];
  note: string;
}

export function initialFlowsState(): IntraDayFlowsState {
  return { status: "IDLE", scannedAt: null, marketOpen: false, spy: null, sectors: [], note: "" };
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function flowColor(direction: SectorFlow["direction"]): string {
  switch (direction) {
    case "STRONG_IN":  return "#10b981";
    case "IN":         return "#34d399";
    case "NEUTRAL":    return "#6b7280";
    case "OUT":        return "#fb923c";
    case "STRONG_OUT": return "#ef4444";
    default:           return "#6b7280";
  }
}

function flowBg(direction: SectorFlow["direction"]): string {
  switch (direction) {
    case "STRONG_IN":  return "rgba(16,185,129,0.12)";
    case "IN":         return "rgba(52,211,153,0.08)";
    case "NEUTRAL":    return "transparent";
    case "OUT":        return "rgba(251,146,60,0.08)";
    case "STRONG_OUT": return "rgba(239,68,68,0.10)";
    default:           return "transparent";
  }
}

function flowArrows(direction: SectorFlow["direction"]): string {
  switch (direction) {
    case "STRONG_IN":  return "↑↑↑";
    case "IN":         return "↑↑";
    case "NEUTRAL":    return "→";
    case "OUT":        return "↓↓";
    case "STRONG_OUT": return "↓↓↓";
    default:           return "–";
  }
}

function rvolColor(rvol: number): string {
  if (rvol >= 2.5) return "#f59e0b";
  if (rvol >= 1.5) return "#94a3b8";
  return "#475569";
}

function changeSign(v: number): string {
  return v > 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`;
}

// ─── FlowBar ──────────────────────────────────────────────────────────────────

function FlowBar({ score, direction }: { score: number; direction: SectorFlow["direction"] }) {
  const isPositive = score >= 0;
  const pct = Math.min(Math.abs(score), 100);
  const color = flowColor(direction);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 80 }}>
      <div style={{
        flex: 1, height: 6, background: "rgba(255,255,255,0.06)",
        borderRadius: 3, overflow: "hidden", position: "relative",
      }}>
        <div style={{
          position: "absolute",
          [isPositive ? "left" : "right"]: "50%",
          width: `${pct / 2}%`,
          height: "100%",
          background: color,
          borderRadius: 3,
          transition: "width 600ms ease",
        }} />
        {/* center line */}
        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.15)" }} />
      </div>
      <span style={{ fontSize: 9, fontWeight: 800, color, minWidth: 22, textAlign: "right" }}>
        {score > 0 ? "+" : ""}{score.toFixed(0)}
      </span>
    </div>
  );
}

// ─── SectorRow ────────────────────────────────────────────────────────────────

function SectorRow({ sector, expanded }: { sector: SectorFlow; expanded: boolean }) {
  const color = flowColor(sector.direction);
  const bg = flowBg(sector.direction);

  return (
    <div style={{
      background: bg,
      borderRadius: 8,
      padding: "8px 10px",
      marginBottom: 4,
      border: `1px solid ${color}22`,
      transition: "background 200ms",
    }}>
      {/* Main row */}
      <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 58px 42px 38px 90px", gap: 6, alignItems: "center" }}>
        {/* Rank */}
        <span style={{ fontSize: 10, fontWeight: 800, color: "#475569", textAlign: "center" }}>
          {sector.rank}
        </span>

        {/* Name + ETF + arrows */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#f1f5f9" }}>{sector.name}</span>
            <span style={{ fontSize: 8, color: "#475569", fontWeight: 600 }}>{sector.etf}</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 900, color, letterSpacing: "0.05em" }}>
            {flowArrows(sector.direction)}
          </span>
        </div>

        {/* Intraday change */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
            {changeSign(sector.intradayChange)}
          </div>
          <div style={{ fontSize: 9, color: "#475569" }}>hoy</div>
        </div>

        {/* 30min change */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: sector.change30min >= 0 ? "#34d399" : "#fb923c", fontVariantNumeric: "tabular-nums" }}>
            {changeSign(sector.change30min)}
          </div>
          <div style={{ fontSize: 8, color: "#475569" }}>30m</div>
        </div>

        {/* RVol */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: rvolColor(sector.relativeVolume) }}>
            {sector.relativeVolume.toFixed(1)}x
          </div>
          <div style={{ fontSize: 8, color: "#475569" }}>vol</div>
        </div>

        {/* Flow bar */}
        <FlowBar score={sector.flowScore} direction={sector.direction} />
      </div>

      {/* Top movers (only for expanded sectors with movers) */}
      {expanded && sector.topMovers.length > 0 && (
        <div style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${color}22`,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}>
          {sector.topMovers.map(m => (
            <div key={m.ticker} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8" }}>{m.ticker}</span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: m.change >= 0 ? "#10b981" : "#ef4444",
                fontVariantNumeric: "tabular-nums",
              }}>
                {changeSign(m.change)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface Props {
  flowsState: IntraDayFlowsState;
}

export function IntraDayFlowsPanel({ flowsState }: Props) {
  const [showAll, setShowAll] = useState(false);
  const { status, sectors, spy, marketOpen, scannedAt, note } = flowsState;

  const isIdle    = status === "IDLE";
  const isScanning = status === "SCANNING";
  const isDone    = status === "DONE";
  const isError   = status === "ERROR";

  // Expanded rows: top 2 inflow + bottom 1 outflow
  const expandedKeys = new Set([
    ...(sectors.slice(0, 2).map(s => s.key)),
    ...(sectors.slice(-1).map(s => s.key)),
  ]);

  const displaySectors = showAll ? sectors : sectors.slice(0, 6);

  return (
    <section className="section-block" style={{ marginTop: 16, border: "1px solid rgba(16,185,129,0.15)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>
              Flujos de Capital
            </h2>
            {isDone && (
              <span style={{ fontSize: 8, fontWeight: 800, color: marketOpen ? "#10b981" : "#eab308", background: marketOpen ? "rgba(16,185,129,0.1)" : "rgba(234,179,8,0.1)", border: `1px solid ${marketOpen ? "rgba(16,185,129,0.2)" : "rgba(234,179,8,0.2)"}`, borderRadius: 999, padding: "1px 6px" }}>
                {marketOpen ? "LIVE" : "ÚLTIMA SESIÓN"}
              </span>
            )}
            {isScanning && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#06b6d4", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                ESCANEANDO…
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "#475569" }}>
            Rotación institucional · 10 sectores US · Yahoo Finance 5-min
          </p>
        </div>
        {scannedAt && (
          <span style={{ fontSize: 9, color: "#475569", textAlign: "right" }}>
            {new Date(scannedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Scanning state */}
      {isScanning && (
        <div style={{ padding: "20px 0", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#06b6d4", display: "inline-block", animation: "pulse 1s infinite" }} />
            <span style={{ fontSize: 12, color: "#06b6d4", fontWeight: 700 }}>Analizando flujos intraday…</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#475569" }}>
            Fetching 10 ETFs + stocks en paralelo
          </div>
        </div>
      )}

      {/* Idle state */}
      {isIdle && (
        <div style={{ padding: "20px 0", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}>
            Pulsa SCAN FLOWS para detectar rotación de capital
          </div>
          <div style={{ fontSize: 10, color: "#1e293b" }}>
            Detecta en segundos donde va el dinero institucional
          </div>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div style={{ padding: "16px 0", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#ef4444" }}>Error al obtener datos intraday</div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Reintenta el scan</div>
        </div>
      )}

      {/* Results */}
      {isDone && sectors.length > 0 && (
        <>
          {/* SPY Benchmark */}
          {spy && (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "6px 10px", marginBottom: 10,
              background: "rgba(255,255,255,0.03)", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#6b7280" }}>SPY — Benchmark</span>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: spy.intradayChange >= 0 ? "#10b981" : "#ef4444" }}>
                  {changeSign(spy.intradayChange)}
                </span>
                <span style={{ fontSize: 9, color: rvolColor(spy.relativeVolume) }}>
                  Vol {spy.relativeVolume.toFixed(1)}x
                </span>
                <span style={{ fontSize: 10, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                  ${spy.currentPrice}
                </span>
              </div>
            </div>
          )}

          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "20px 1fr 58px 42px 38px 90px",
            gap: 6, padding: "0 10px", marginBottom: 6,
          }}>
            {["#", "SECTOR", "HOY", "30M", "VOL", "FLUJO"].map(h => (
              <span key={h} style={{ fontSize: 8, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: h === "HOY" || h === "30M" || h === "VOL" ? "right" : "left" }}>
                {h}
              </span>
            ))}
          </div>

          {/* Sector rows */}
          {displaySectors.map(sector => (
            <SectorRow
              key={sector.key}
              sector={sector}
              expanded={expandedKeys.has(sector.key)}
            />
          ))}

          {/* Show more toggle */}
          {sectors.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              style={{
                width: "100%", marginTop: 6, padding: "6px 0",
                background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, fontSize: 10, color: "#475569", cursor: "pointer",
              }}
            >
              {showAll ? "Ver menos" : `Ver todos (${sectors.length})`}
            </button>
          )}

          {/* Note */}
          {note && (
            <div style={{ marginTop: 8, fontSize: 9, color: "#374151", textAlign: "center" }}>
              {note}
            </div>
          )}
        </>
      )}
    </section>
  );
}
