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
        <span className={`market-pill market-pill-${markets.europe.toLowerCase()}`}>
          <b>Europe</b>
          <strong>{markets.europe}</strong>
        </span>
        <span className={`market-pill market-pill-${markets.us.toLowerCase()}`}>
          <b>United States</b>
          <strong>{markets.us}</strong>
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
