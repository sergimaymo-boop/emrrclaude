import type { SystemStatus } from "../types";

interface StickyMiniHeaderProps {
  systemStatus: SystemStatus;
  onScan: () => void;
  isScanning: boolean;
  onScanRally: () => void;
  isRallyScanning: boolean;
}

function marketSummary(marketMode: SystemStatus["marketMode"]): string {
  if (marketMode === "BOTH_OPEN") return "Europe OPEN · US OPEN";
  if (marketMode === "EU_OPEN") return "Europe OPEN · US CLOSED";
  if (marketMode === "US_OPEN") return "Europe CLOSED · US OPEN";
  if (marketMode === "STALE") return "Europe STALE · US STALE";
  return "Europe CLOSED · US CLOSED";
}

function marketStates(marketMode: SystemStatus["marketMode"]) {
  return {
    europe: marketMode === "EU_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
    us: marketMode === "US_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
  };
}

function healthClass(health: SystemStatus["health"]): string {
  if (health === "HEALTHY") return "health-badge-healthy";
  if (health === "PARTIAL_DATA") return "health-badge-partial";
  if (health === "DEGRADED" || health === "MARKET_CLOSED") return "health-badge-warning";
  return "health-badge-error";
}

export function StickyMiniHeader({ systemStatus, onScan, isScanning, onScanRally, isRallyScanning }: StickyMiniHeaderProps) {
  const markets = marketStates(systemStatus.marketMode);

  return (
    <div className="sticky-mini-header">
      {/* Row 1: time + market pills + health */}
      <div className="mini-time-block">
        <span>{systemStatus.updatedAt.local}</span>
        <strong>{marketSummary(systemStatus.marketMode)}</strong>
      </div>
      <div className="mini-market-strip" aria-label="Market status">
        {/* Small market pills — scan buttons are the priority */}
        <span className={`market-pill market-pill-${markets.europe.toLowerCase()}`}
          style={{ minWidth: 80, minHeight: 30, fontSize: 9, padding: "4px 8px" }}>
          <b style={{ fontSize: 9 }}>EU</b>
          <strong style={{ fontSize: 9 }}>{markets.europe}</strong>
        </span>
        <span className={`market-pill market-pill-${markets.us.toLowerCase()}`}
          style={{ minWidth: 80, minHeight: 30, fontSize: 9, padding: "4px 8px" }}>
          <b style={{ fontSize: 9 }}>EEUU</b>
          <strong style={{ fontSize: 9 }}>{markets.us}</strong>
        </span>
      </div>
      <span className={`badge health-badge ${healthClass(systemStatus.health)}`}>
        {systemStatus.health}
      </span>
      {/* Scan buttons — both always visible */}
      <div className="mini-scan-buttons">
        <button
          className="mini-scan-button mini-scan-rally"
          type="button"
          onClick={onScanRally}
          disabled={isRallyScanning || isScanning}
          style={{
            background: "linear-gradient(135deg, #8b1a1a 0%, #6b1212 100%)",
            border: "1px solid rgba(180,50,50,0.5)",
            borderBottom: "3px solid #4a0d0d",
            minWidth: 80,
            minHeight: 30,
            padding: "4px 10px",
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: "0.06em",
            color: "#ffd5d5",
            boxShadow: "0 4px 12px rgba(139,26,26,0.4)",
            borderRadius: 999,
            cursor: isRallyScanning || isScanning ? "not-allowed" : "pointer",
            transition: "transform 80ms, box-shadow 80ms, border-bottom 80ms",
          }}
          onPointerDown={(e) => {
            if (isRallyScanning || isScanning) return;
            e.currentTarget.style.transform = "translateY(2px)";
            e.currentTarget.style.borderBottom = "1px solid #4a0d0d";
            e.currentTarget.style.boxShadow = "0 1px 4px rgba(139,26,26,0.2)";
          }}
          onPointerUp={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.borderBottom = "3px solid #4a0d0d";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(139,26,26,0.4)";
          }}
          onPointerLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.borderBottom = "3px solid #4a0d0d";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(139,26,26,0.4)";
          }}
        >
          {isRallyScanning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.8)", display: "inline-block", animation: "pulse 1s infinite" }} />
              Rally…
            </span>
          ) : "SCAN RALLY"}
        </button>
        <button
          className="mini-scan-button"
          type="button"
          onClick={onScan}
          disabled={isScanning || isRallyScanning}
          style={{
            background: "linear-gradient(135deg, #8b1a1a 0%, #6b1212 100%)",
            border: "1px solid rgba(180,50,50,0.5)",
            borderBottom: "3px solid #4a0d0d",
            minWidth: 80,
            minHeight: 30,
            padding: "4px 10px",
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: "0.06em",
            color: "#ffd5d5",
            boxShadow: "0 4px 12px rgba(139,26,26,0.4)",
            borderRadius: 999,
            cursor: isScanning || isRallyScanning ? "not-allowed" : "pointer",
            transition: "transform 80ms, box-shadow 80ms, border-bottom 80ms",
          }}
          onPointerDown={(e) => {
            if (isScanning || isRallyScanning) return;
            e.currentTarget.style.transform = "translateY(2px)";
            e.currentTarget.style.borderBottom = "1px solid #4a0d0d";
            e.currentTarget.style.boxShadow = "0 1px 4px rgba(139,26,26,0.2)";
          }}
          onPointerUp={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.borderBottom = "3px solid #4a0d0d";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(139,26,26,0.4)";
          }}
          onPointerLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.borderBottom = "3px solid #4a0d0d";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(139,26,26,0.4)";
          }}
        >
          {isScanning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.8)", display: "inline-block", animation: "pulse 1s infinite" }} />
              Scanning
            </span>
          ) : "SCAN FULL"}
        </button>
      </div>
    </div>
  );
}
