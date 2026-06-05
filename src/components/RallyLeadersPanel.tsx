import type { RallyAsset, RallyState } from "../services/rallyRefresh";

interface RallyLeadersPanelProps {
  rallyState: RallyState;
  onScanRally: () => void;
}

function RallyScoreBadge({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      width: 72, minHeight: 72,
      borderRadius: "50%",
      background: `${color}15`,
      border: `2px solid ${color}50`,
      padding: 4,
      textAlign: "center",
    }}>
      <span style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1 }}>{score}</span>
      <span style={{ fontSize: 7, fontWeight: 800, color: `${color}cc`, letterSpacing: "0.04em", marginTop: 2, lineHeight: 1.2 }}>
        {label.replace(" RALLY", "").replace("ELITE", "ÉLITE")}
      </span>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number | null; max: number; color: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 400ms" }} />
      </div>
      <span style={{ fontSize: 10, color: "#94a3b8", fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right" }}>
        {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}
      </span>
    </div>
  );
}

function AssetRow({ asset }: { asset: RallyAsset }) {
  const m = asset.metrics;
  const priceChange = m?.mom1m ?? null;
  const changeColor = priceChange === null ? "#64748b" : priceChange >= 0 ? "#10b981" : "#ef4444";
  const trailing = asset.trailingStop ?? m?.trailingStop ?? null;

  return (
    <article style={{
      display: "grid",
      gridTemplateColumns: "24px minmax(0,1.6fr) 60px 52px 76px",
      gap: 8,
      alignItems: "center",
      padding: "8px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      transition: "background 150ms",
    }}
    onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.06)")}
    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {/* Rank */}
      <span style={{ fontSize: 11, fontWeight: 800, color: "#475569", textAlign: "center" }}>
        {asset.rank}
      </span>

      {/* Ticker + Name */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontSize: 12, fontWeight: 900, color: "#f1f5f9", letterSpacing: "0.04em" }}>
            {asset.ticker}
          </strong>
          <span style={{ fontSize: 9, color: "#475569", fontWeight: 600, textTransform: "uppercase" }}>
            {asset.exchange?.replace("XETRA", "DE").replace("EURONEXT", "EU")}
          </span>
        </div>
        <div style={{ fontSize: 9, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {asset.name}
        </div>
      </div>

      {/* Price + Change */}
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", fontVariantNumeric: "tabular-nums" }}>
          {m?.lastClose ? m.lastClose.toFixed(2) : "—"}
        </div>
        <div style={{ fontSize: 10, color: changeColor, fontWeight: 700 }}>
          {priceChange === null ? "—" : `${priceChange >= 0 ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(2)}%`}
        </div>
      </div>

      {/* RS 3M + Trailing stop stacked */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div>
          <div style={{ fontSize: 7, color: "#475569", fontWeight: 700, textTransform: "uppercase" }}>RS 3M</div>
          <div style={{ fontSize: 10, color: "#818cf8", fontWeight: 700 }}>
            {m?.rs3m !== null && m?.rs3m !== undefined ? `${m.rs3m > 0 ? "+" : ""}${m.rs3m.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 7, color: "#475569", fontWeight: 700, textTransform: "uppercase" }}>STOP</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24" }}>
            {trailing !== null ? `${trailing.toFixed(1)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Rally Score circle — centered */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <RallyScoreBadge score={asset.rallyScore} label={asset.rallyLabel} color={asset.rallyColor} />
      </div>
    </article>
  );
}

function CoverageBar({ percent }: { percent: number }) {
  const color = percent === 100 ? "#10b981" : "#6366f1";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: color, borderRadius: 2, transition: "width 500ms ease" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 36, textAlign: "right" }}>{percent}%</span>
    </div>
  );
}

export function RallyLeadersPanel({ rallyState, onScanRally }: RallyLeadersPanelProps) {
  const { status, isScanning, top10, coveragePercent, batchesCompleted, batchesTotal, lastRun } = rallyState;
  const isIdle = status === "RALLY_IDLE";
  const isFinal = status === "RALLY_FINAL";
  const isPartial = status === "RALLY_PARTIAL_DIAGNOSTIC";
  const isUnavailable = status === "RALLY_DATA_UNAVAILABLE";
  // Detect if data is from previous session (loaded from Redis on mount, not from a fresh scan)
  const isFromCache = isFinal && top10.length > 0 && !isScanning;

  return (
    <section className="section-block" style={{ marginTop: 16, border: "1px solid rgba(99,102,241,0.2)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>
              Rally Leaders Engine
            </h2>
            {isFinal && !isFromCache && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                LIVE FINAL
              </span>
            )}
            {isFromCache && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#6366f1", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                SESIÓN ANTERIOR · {lastRun}
              </span>
            )}
            {isPartial && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#eab308", background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                PARTIAL DIAGNOSTIC
              </span>
            )}
            {isScanning && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#6366f1", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                SCANNING…
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "#475569" }}>
            Top 10 Institutional Rally Leaders · Independent engine
          </p>
        </div>
        <div style={{ fontSize: 10, color: "#475569", textAlign: "right" }}>
          {isFinal || isPartial ? `${top10.length} leaders found` : ""}
        </div>
      </div>

      {/* Scanning progress */}
      {isScanning && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#64748b" }}>
              Batch {batchesCompleted}/{batchesTotal}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>{coveragePercent}%</span>
          </div>
          <CoverageBar percent={coveragePercent} />
        </div>
      )}

      {/* Idle / unavailable state */}
      {(isIdle || isUnavailable) && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}>
            {isUnavailable ? "Mercados cerrados — sin datos disponibles" : "Pulsa SCAN RALLY para detectar líderes"}
          </div>
          <div style={{ fontSize: 10, color: "#1e293b" }}>
            Solo datos reales · Sin listas fijas · Sin sesgos
          </div>
        </div>
      )}

      {/* Table header */}
      {top10.length > 0 && (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "24px minmax(0,1.6fr) 60px 52px 76px",
            gap: 8,
            padding: "6px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            marginBottom: 2,
          }}>
            {["#", "ACTIVO", "PRECIO/DÍA", "RS·STOP", "SCORE"].map(h => (
              <span key={h} style={{ fontSize: 8, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: h === "SCORE" ? "center" : "left" }}>
                {h}
              </span>
            ))}
          </div>
          {top10.map(asset => <AssetRow key={asset.providerSymbol} asset={asset} />)}
        </>
      )}

      {/* Coverage bar when complete */}
      {isFinal && (
        <div style={{ marginTop: 12, padding: "8px 14px", background: "rgba(16,185,129,0.05)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ Cobertura completa — Rally Leaders Final</span>
            <span style={{ fontSize: 10, color: "#475569" }}>{rallyState.lastRun}</span>
          </div>
        </div>
      )}
    </section>
  );
}
