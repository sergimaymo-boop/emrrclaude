import type { MasterIndicator } from "../types";

// NOTE: The standalone "Master Indicators" section was removed from the dashboard
// (redundant with the Fear & Greed panel, which now shows the same raw indicator
// values via IndicatorRow below). This module is kept only as the shared
// renderer/color-logic source so the F&G panel stays byte-identical to what
// Master Indicators used to display.

export function getIndicatorColor(symbol: string, value: string, changePercent: number): string {
  const n = parseFloat(value);
  if (symbol === "VIX")  return n < 15 ? "#10b981" : n < 20 ? "#eab308" : "#ef4444";
  if (symbol === "VVIX") return n < 80 ? "#10b981" : n < 110 ? "#eab308" : "#ef4444";
  if (symbol === "MOVE") return n < 80 ? "#10b981" : n < 100 ? "#eab308" : "#ef4444";
  if (symbol === "TNX")  return n < 3.5 ? "#10b981" : n < 4.5 ? "#eab308" : "#ef4444";
  return changePercent > 0.05 ? "#10b981" : changePercent < -0.05 ? "#ef4444" : "#6366f1";
}

export function IndicatorRow({ ind }: { ind: MasterIndicator }) {
  const avail  = ind.value !== "N/A";
  const color  = avail ? getIndicatorColor(ind.symbol, ind.value, ind.changePercent) : "#334155";
  const change = ind.changePercent;
  const arrow  = change > 0.05 ? "▲" : change < -0.05 ? "▼" : "—";
  const arrowColor = change > 0.05 ? "#10b981" : change < -0.05 ? "#ef4444" : "#475569";
  const isLive = ind.dataMode === "REAL";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 10px",
      borderRadius: 8,
      background: "rgba(255,255,255,0.025)",
      border: `1px solid ${color}22`,
    }}>
      {/* Status dot */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: avail ? color : "#334155",
        boxShadow: avail ? `0 0 5px ${color}80` : "none",
        flexShrink: 0,
      }} />

      {/* Symbol */}
      <span style={{
        fontSize: 10, fontWeight: 900, color: "#94a3b8",
        letterSpacing: "0.05em", minWidth: 36, flexShrink: 0,
      }}>
        {ind.symbol}
      </span>

      {/* Value */}
      <span style={{
        fontSize: 12, fontWeight: 800,
        color: avail ? color : "#334155",
        fontVariantNumeric: "tabular-nums",
        flex: 1,
      }}>
        {avail ? ind.value : "—"}
      </span>

      {/* Change */}
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: arrowColor,
        fontVariantNumeric: "tabular-nums",
        minWidth: 48, textAlign: "right", flexShrink: 0,
      }}>
        {avail && change !== 0 ? `${arrow} ${Math.abs(change).toFixed(2)}%` : arrow}
      </span>

      {/* LIVE/CACHE badge */}
      <span style={{
        fontSize: 7, fontWeight: 700,
        color: isLive ? "#10b981" : "#475569",
        minWidth: 28, textAlign: "right", flexShrink: 0,
      }}>
        {isLive ? "LIVE" : "CACHE"}
      </span>
    </div>
  );
}
