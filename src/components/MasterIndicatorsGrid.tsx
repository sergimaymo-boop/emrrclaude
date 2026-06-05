import type { MasterIndicator } from "../types";

interface MasterIndicatorsGridProps {
  indicators: MasterIndicator[];
}

function getColor(symbol: string, value: string, changePercent: number): string {
  const n = parseFloat(value);
  if (symbol === "VIX") return n < 15 ? "#10b981" : n < 20 ? "#eab308" : "#ef4444";
  if (symbol === "VVIX") return n < 80 ? "#10b981" : n < 110 ? "#eab308" : "#ef4444";
  if (symbol === "MOVE") return n < 80 ? "#10b981" : n < 100 ? "#eab308" : "#ef4444";
  if (symbol === "TNX") return n < 3.5 ? "#10b981" : n < 4.5 ? "#eab308" : "#ef4444";
  return changePercent > 0.05 ? "#10b981" : changePercent < -0.05 ? "#ef4444" : "#6366f1";
}

function getPercent(symbol: string, value: string): number {
  const n = parseFloat(value);
  if (isNaN(n)) return 50;
  if (symbol === "VIX") return Math.max(5, Math.min(95, 100 - (n / 40) * 100));
  if (symbol === "VVIX") return Math.max(5, Math.min(95, 100 - ((n - 60) / 100) * 100));
  if (symbol === "MOVE") return Math.max(5, Math.min(95, 100 - (n / 150) * 100));
  if (symbol === "TNX") return Math.max(5, Math.min(95, 100 - ((n - 2) / 5) * 100));
  return Math.max(5, Math.min(95, 50 + n * 5));
}

function CircleGauge({ color, pct, value, symbol, change, isLive, name }: {
  color: string; pct: number; value: string; symbol: string;
  change: number; isLive: boolean; name: string;
}) {
  const r = 30; const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  const isAvail = value !== "N/A";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 4px 8px" }}>
      {/* Circle */}
      <div style={{ position: "relative", width: 72, height: 72 }}>
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
          {isAvail && (
            <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
              transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 1s ease" }}/>
          )}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: isAvail ? "#fff" : "#334155", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {isAvail ? (value.length > 6 ? value.slice(0, 6) : value) : "—"}
          </span>
          <span style={{ fontSize: 7, color: isAvail ? color : "#334155", fontWeight: 700, marginTop: 1 }}>
            {isAvail && change !== 0 ? (change > 0 ? "▲" : "▼") + Math.abs(change).toFixed(1) + "%" : ""}
          </span>
        </div>
      </div>
      {/* Symbol + status */}
      <div style={{ marginTop: 4, textAlign: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em" }}>{symbol}</div>
        <div style={{ fontSize: 7, color: isLive ? "#10b981" : "#eab308", fontWeight: 700, marginTop: 1 }}>
          {isLive ? "LIVE" : "CACHE"}
        </div>
        <div style={{ fontSize: 7, color: "#475569", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 68 }}>{name}</div>
      </div>
    </div>
  );
}

export function MasterIndicatorsGrid({ indicators }: MasterIndicatorsGridProps) {
  return (
    <section className="section-block">
      <div className="section-title-row" style={{ marginBottom: 8 }}>
        <h2>Master Indicators</h2>
        <span style={{ fontSize: 10, color: "#64748b" }}>Informational only</span>
      </div>
      {/* Flex wrap — all 7 fill rows evenly, no gaps */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {indicators.map((ind) => {
          const color = ind.value !== "N/A" ? getColor(ind.symbol, ind.value, ind.changePercent) : "#334155";
          const pct = ind.value !== "N/A" ? getPercent(ind.symbol, ind.value) : 0;
          return (
            <div key={ind.symbol} style={{ flex: "1 1 calc(25% - 6px)", minWidth: 72 }}>
              <CircleGauge
                color={color} pct={pct} value={ind.value}
                symbol={ind.symbol} change={ind.changePercent}
                isLive={ind.dataMode === "REAL"} name={ind.name}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
