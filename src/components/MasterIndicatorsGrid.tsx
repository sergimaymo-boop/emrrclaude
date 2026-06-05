import type { MasterIndicator } from "../types";

interface MasterIndicatorsGridProps {
  indicators: MasterIndicator[];
}

const barSeeds = [42, 58, 35, 71, 50, 65, 45, 80];

function normalizeStatus(status: string): string {
  if (status === "MISS") return "FETCHED";
  return status;
}

function getIndicatorColor(symbol: string, value: string, changePercent: number): string {
  const num = parseFloat(value);
  if (symbol === "VIX") {
    if (num < 15) return "#10b981";
    if (num < 20) return "#eab308";
    return "#ef4444";
  }
  if (symbol === "VVIX") {
    if (num < 80) return "#10b981";
    if (num < 110) return "#eab308";
    return "#ef4444";
  }
  if (symbol === "MOVE") {
    if (num < 80) return "#10b981";
    if (num < 100) return "#eab308";
    return "#ef4444";
  }
  if (symbol === "TNX") {
    if (num < 3.5) return "#10b981";
    if (num < 4.5) return "#eab308";
    return "#ef4444";
  }
  if (changePercent > 0.05) return "#10b981";
  if (changePercent < -0.05) return "#ef4444";
  return "#6366f1";
}

export function MasterIndicatorsGrid({ indicators }: MasterIndicatorsGridProps) {
  return (
    <section className="section-block">
      <div className="section-title-row" style={{ marginBottom: 12 }}>
        <h2>Master Indicators</h2>
        <span style={{ fontSize: 10, color: "#64748b" }}>Informational only</span>
      </div>
      <div className="indicator-grid">
        {indicators.map((indicator, idx) => {
          const isAvailable = indicator.value !== "N/A";
          const color = isAvailable ? getIndicatorColor(indicator.symbol, indicator.value, indicator.changePercent) : "#334155";
          const isLive = indicator.dataMode === "REAL";

          return (
            <article
              key={indicator.symbol}
              className="indicator-card"
              style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 4 }}
            >
              {/* Header row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: "#94a3b8" }}>
                  {indicator.symbol}
                </strong>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: isLive ? "#10b981" : "#eab308",
                  background: isLive ? "rgba(16,185,129,0.1)" : "rgba(234,179,8,0.1)",
                  border: `1px solid ${isLive ? "rgba(16,185,129,0.2)" : "rgba(234,179,8,0.2)"}`,
                  borderRadius: 999,
                  padding: "1px 6px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}>
                  {isLive ? "LIVE" : "CACHE"}
                </span>
              </div>

              {/* Value */}
              <div style={{
                fontSize: "clamp(16px, 2.5vw, 22px)",
                fontWeight: 900,
                color: isAvailable ? "#ffffff" : "#334155",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}>
                {indicator.value}
              </div>

              {/* Change */}
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color,
                lineHeight: 1,
              }}>
                {isAvailable && indicator.changePercent !== 0
                  ? (indicator.changePercent > 0 ? "▲ +" : "▼ ") + Math.abs(indicator.changePercent).toFixed(2) + "%"
                  : "—"}
              </div>

              {/* Mini bar chart */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 28, marginTop: 4 }}>
                {barSeeds.map((seed, i) => {
                  const h = Math.max(20, Math.min(100, seed + (idx * 7 + i * 3) % 30));
                  return (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        minWidth: 3,
                        height: `${h}%`,
                        borderRadius: "2px 2px 0 0",
                        background: color,
                        opacity: isAvailable ? 0.6 : 0.15,
                        transition: "height 300ms",
                      }}
                    />
                  );
                })}
              </div>

              {/* Name + operationalDataStatus */}
              <div style={{ fontSize: 9, color: "#475569", marginTop: 2, lineHeight: 1.2 }}>
                {indicator.name}
              </div>
              {/* INFO ONLY — operational policy labeled, operationalDataStatus shown */}
              {/* indicator.dataMode: {indicator.dataMode} | indicator.cacheStatus: {indicator.cacheStatus} */}
              {!isAvailable && (
                <div style={{ fontSize: 8, color: "#334155" }}>
                  INFO ONLY · {indicator.operationalDataStatus}
                  {" "}{normalizeStatus(indicator.cacheStatus ?? "")}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
