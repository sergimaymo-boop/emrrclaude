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
  topMover: StockMover | null;    // single best stock in this sector today
  topMovers: StockMover[];        // backward compat (same as [topMover])
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

// ─── Color scale (heat map, like Fidelity/Bloomberg) ─────────────────────────

function tileColors(pct: number): { bg: string; border: string; textPrimary: string; textSecondary: string } {
  const abs = Math.abs(pct);
  const pos = pct >= 0;

  if (abs >= 3) return {
    bg: pos ? "rgba(16,185,129,0.90)"  : "rgba(239,68,68,0.90)",
    border: pos ? "#10b981" : "#ef4444",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255,255,255,0.80)",
  };
  if (abs >= 1.5) return {
    bg: pos ? "rgba(16,185,129,0.60)"  : "rgba(239,68,68,0.60)",
    border: pos ? "#34d399" : "#f87171",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255,255,255,0.75)",
  };
  if (abs >= 0.5) return {
    bg: pos ? "rgba(16,185,129,0.30)"  : "rgba(239,68,68,0.30)",
    border: pos ? "rgba(52,211,153,0.5)" : "rgba(248,113,113,0.5)",
    textPrimary: pos ? "#34d399" : "#f87171",
    textSecondary: pos ? "rgba(52,211,153,0.8)" : "rgba(248,113,113,0.8)",
  };
  return {
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.10)",
    textPrimary: "#94a3b8",
    textSecondary: "#475569",
  };
}

function fmt(v: number, digits = 2): string {
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}%` : `${s}%`;
}

// ─── Single sector tile ───────────────────────────────────────────────────────

function SectorTile({ sector }: { sector: SectorFlow }) {
  const c = tileColors(sector.intradayChange);
  const m = sector.topMover;

  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      padding: "11px 10px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 3,
      minHeight: 100,
      position: "relative",
    }}>
      {/* Rank badge */}
      <span style={{
        position: "absolute", top: 7, right: 9,
        fontSize: 9, fontWeight: 700, color: c.textSecondary,
      }}>
        #{sector.rank}
      </span>

      {/* Sector name + ETF */}
      <div style={{ fontSize: 10, fontWeight: 800, color: c.textPrimary, lineHeight: 1.2, paddingRight: 18 }}>
        {sector.name}
      </div>
      <div style={{ fontSize: 8, fontWeight: 600, color: c.textSecondary, letterSpacing: "0.05em" }}>
        {sector.etf}
      </div>

      {/* BIG sector % — hero */}
      <div style={{
        fontSize: 19, fontWeight: 900, color: c.textPrimary,
        letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums",
        lineHeight: 1, marginTop: 3,
      }}>
        {fmt(sector.intradayChange)}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: `${c.border}40`, margin: "4px 0 3px" }} />

      {/* TOP STOCK — acción individual S&P500, invertible SL española */}
      {m ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, color: c.textPrimary, letterSpacing: "0.04em" }}>
              {m.ticker}
            </div>
            <div style={{ fontSize: 7, fontWeight: 700, color: c.textSecondary, letterSpacing: "0.03em" }}>
              NYSE · S&P500
            </div>
          </div>
          <div style={{
            fontSize: 13, fontWeight: 900, color: c.textPrimary,
            fontVariantNumeric: "tabular-nums",
          }}>
            {fmt(m.change)}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 9, color: c.textSecondary }}>—</div>
      )}
    </div>
  );
}

// ─── Expanded detail row (shown below grid for top sectors) ──────────────────

function DetailRow({ sector }: { sector: SectorFlow }) {
  const c = tileColors(sector.intradayChange);
  const m = sector.topMover;

  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "9px 12px", borderRadius: 10,
      background: "rgba(255,255,255,0.025)",
      border: `1px solid ${c.border}30`,
      gap: 10,
    }}>
      {/* Colored left accent */}
      <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: c.border, flexShrink: 0 }} />

      {/* Rank */}
      <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", minWidth: 18, flexShrink: 0 }}>
        #{sector.rank}
      </span>

      {/* Sector name + ETF */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#f1f5f9" }}>{sector.name}</div>
        <div style={{ fontSize: 8, color: "#475569", marginTop: 1 }}>
          {sector.etf} · 30m {fmt(sector.change30min)} · Vol {sector.relativeVolume.toFixed(1)}x
        </div>
      </div>

      {/* TOP STOCK — acción S&P500, sin restricción PRIIP para SL española */}
      {m && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "4px 10px", borderRadius: 8,
          background: `${c.border}20`,
          border: `1px solid ${c.border}40`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: c.textPrimary, letterSpacing: "0.04em" }}>
            {m.ticker}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, color: c.textPrimary, fontVariantNumeric: "tabular-nums" }}>
            {fmt(m.change)}
          </span>
          <span style={{ fontSize: 7, color: `${c.textSecondary}`, marginTop: 1, letterSpacing: "0.03em" }}>
            S&P500
          </span>
        </div>
      )}

      {/* Sector % */}
      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 52 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: c.textPrimary, fontVariantNumeric: "tabular-nums" }}>
          {fmt(sector.intradayChange)}
        </div>
        <div style={{ fontSize: 8, color: "#475569" }}>sector</div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface Props {
  flowsState: IntraDayFlowsState;
}

export function IntraDayFlowsPanel({ flowsState }: Props) {
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const { status, sectors, spy, marketOpen, scannedAt } = flowsState;

  const isDone     = status === "DONE";
  const isScanning = status === "SCANNING";
  const isIdle     = status === "IDLE";
  const isError    = status === "ERROR";

  return (
    <section className="section-block" style={{ marginTop: 16, border: "1px solid rgba(255,255,255,0.06)" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>
            Flujos de Capital
          </h2>
          {isDone && (
            <span style={{
              fontSize: 8, fontWeight: 800, padding: "2px 7px", borderRadius: 999,
              color: marketOpen ? "#10b981" : "#eab308",
              background: marketOpen ? "rgba(16,185,129,0.12)" : "rgba(234,179,8,0.12)",
              border: `1px solid ${marketOpen ? "rgba(16,185,129,0.25)" : "rgba(234,179,8,0.25)"}`,
            }}>
              {marketOpen ? "LIVE" : "ÚLTIMA SESIÓN"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {scannedAt && (
            <span style={{ fontSize: 9, color: "#475569" }}>
              {new Date(scannedAt).toLocaleTimeString()}
            </span>
          )}
          {isDone && sectors.length > 0 && (
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
              {(["tiles", "list"] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  style={{
                    padding: "3px 10px", fontSize: 8, fontWeight: 700, cursor: "pointer",
                    border: "none", letterSpacing: "0.05em",
                    background: view === v ? "rgba(255,255,255,0.12)" : "transparent",
                    color: view === v ? "#f1f5f9" : "#475569",
                    transition: "background 120ms",
                  }}
                >
                  {v === "tiles" ? "⊞ MAPA" : "☰ LISTA"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── States ── */}
      {isIdle && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 13, color: "#334155", marginBottom: 4 }}>Pulsa SCAN FLOWS para detectar rotación de capital</div>
          <div style={{ fontSize: 10, color: "#1e293b" }}>Analiza 10 sectores US · Detecta en segundos donde va el dinero</div>
        </div>
      )}

      {isScanning && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#c9a227", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#c9a227", display: "inline-block", animation: "pulse 1s infinite" }} />
            Analizando flujos intraday…
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#475569" }}>10 ETFs · 30 stocks · Yahoo Finance 5-min</div>
        </div>
      )}

      {isError && (
        <div style={{ padding: "16px 0", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#ef4444" }}>Error al obtener datos · Reintenta el scan</div>
        </div>
      )}

      {/* ── Results ── */}
      {isDone && sectors.length > 0 && (
        <>
          {/* SPY Benchmark strip */}
          {spy && (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "7px 12px", marginBottom: 12, borderRadius: 8,
              background: spy.intradayChange >= 0 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${spy.intradayChange >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>SPY · Benchmark S&P500</span>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <span style={{
                  fontSize: 16, fontWeight: 900,
                  color: spy.intradayChange >= 0 ? "#10b981" : "#ef4444",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {fmt(spy.intradayChange)}
                </span>
                <span style={{ fontSize: 9, color: spy.relativeVolume >= 2 ? "#f59e0b" : "#475569" }}>
                  Vol {spy.relativeVolume.toFixed(1)}x
                </span>
                <span style={{ fontSize: 10, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                  ${spy.currentPrice}
                </span>
              </div>
            </div>
          )}

          {/* ── TILE HEAT MAP view ── */}
          {view === "tiles" && (
            <>
              {/* Inflow tiles */}
              {sectors.filter(s => s.intradayChange > 0).length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#10b981", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                    ▲ Dinero Entrando
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    {sectors.filter(s => s.intradayChange > 0).map(s => (
                      <SectorTile key={s.key} sector={s} />
                    ))}
                  </div>
                </>
              )}

              {/* Neutral */}
              {sectors.filter(s => s.intradayChange === 0).length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#6b7280", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                    → Neutro
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    {sectors.filter(s => s.intradayChange === 0).map(s => (
                      <SectorTile key={s.key} sector={s} />
                    ))}
                  </div>
                </>
              )}

              {/* Outflow tiles */}
              {sectors.filter(s => s.intradayChange < 0).length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                    ▼ Dinero Saliendo
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {sectors.filter(s => s.intradayChange < 0).map(s => (
                      <SectorTile key={s.key} sector={s} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── LIST detail view ── */}
          {view === "list" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sectors.map(s => <DetailRow key={s.key} sector={s} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
