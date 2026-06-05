import type { SystemStatus } from "../types";

interface StickyMiniHeaderProps {
  systemStatus: SystemStatus;
  onScan: () => void;
  isScanning: boolean;
  onScanRally: () => void;
  isRallyScanning: boolean;
  onLogout: () => void;
}

function marketStates(marketMode: SystemStatus["marketMode"]) {
  return {
    europe: marketMode === "EU_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
    us: marketMode === "US_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
  };
}

const PILL_STYLE: React.CSSProperties = {
  minWidth: 80, minHeight: 30, fontSize: 9, padding: "4px 8px",
};

const SCAN_BTN_BASE: React.CSSProperties = {
  background: "linear-gradient(135deg, #8b1a1a 0%, #6b1212 100%)",
  border: "1px solid rgba(180,50,50,0.5)",
  borderBottom: "3px solid #4a0d0d",
  minWidth: 80, minHeight: 30, padding: "4px 10px",
  fontSize: 9, fontWeight: 900, letterSpacing: "0.06em",
  color: "#ffd5d5", boxShadow: "0 4px 12px rgba(139,26,26,0.4)",
  borderRadius: 999, transition: "transform 80ms, box-shadow 80ms, border-bottom 80ms",
  WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
};

function pushDown(e: React.PointerEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "translateY(2px)";
  e.currentTarget.style.borderBottom = "1px solid #4a0d0d";
  e.currentTarget.style.boxShadow = "0 1px 4px rgba(139,26,26,0.2)";
}
function pushUp(e: React.PointerEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "none";
  e.currentTarget.style.borderBottom = "3px solid #4a0d0d";
  e.currentTarget.style.boxShadow = "0 4px 12px rgba(139,26,26,0.4)";
}

export function StickyMiniHeader({
  systemStatus, onScan, isScanning, onScanRally, isRallyScanning, onLogout,
}: StickyMiniHeaderProps) {
  const markets = marketStates(systemStatus.marketMode);
  const dateStr = systemStatus.updatedAt.local;

  return (
    <div className="sticky-mini-header" style={{
      display: "flex", flexDirection: "column", gap: 6,
      padding: "8px 14px", paddingTop: "max(8px, env(safe-area-inset-top))",
    }}>
      {/* ROW 1: fecha/hora | pills mercado | logout | scans */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>

        {/* Fecha y hora — visible y compacto */}
        <span style={{
          fontSize: 11, fontWeight: 700, color: "#94a3b8",
          fontVariantNumeric: "tabular-nums", flex: "0 0 auto",
          letterSpacing: "0.02em",
        }}>
          {dateStr}
        </span>

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* EU pill */}
        <span className={`market-pill market-pill-${markets.europe.toLowerCase()}`} style={PILL_STYLE}>
          <b style={{ fontSize: 9 }}>EU</b>
          <strong style={{ fontSize: 9 }}>{markets.europe}</strong>
        </span>

        {/* EEUU pill */}
        <span className={`market-pill market-pill-${markets.us.toLowerCase()}`} style={PILL_STYLE}>
          <b style={{ fontSize: 9 }}>EEUU</b>
          <strong style={{ fontSize: 9 }}>{markets.us}</strong>
        </span>

        {/* LOGOUT — mismo tamaño que pills */}
        <button
          type="button"
          onClick={onLogout}
          style={{
            minWidth: 80, minHeight: 30, padding: "4px 10px",
            fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
            color: "#94a3b8", background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999,
            cursor: "pointer", transition: "opacity 120ms",
            WebkitTapHighlightColor: "transparent",
          }}
          onPointerDown={e => { e.currentTarget.style.opacity = "0.7"; }}
          onPointerUp={e => { e.currentTarget.style.opacity = "1"; }}
          onPointerLeave={e => { e.currentTarget.style.opacity = "1"; }}
        >
          LOGOUT
        </button>

        {/* SCAN RALLY */}
        <button
          className="mini-scan-button mini-scan-rally"
          type="button"
          onClick={onScanRally}
          disabled={isRallyScanning || isScanning}
          style={{ ...SCAN_BTN_BASE, cursor: isRallyScanning || isScanning ? "not-allowed" : "pointer", opacity: isRallyScanning || isScanning ? 0.7 : 1 }}
          onPointerDown={e => { if (!isRallyScanning && !isScanning) pushDown(e); }}
          onPointerUp={pushUp}
          onPointerLeave={pushUp}
        >
          {isRallyScanning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.8)", display: "inline-block", animation: "pulse 1s infinite" }} />
              Rally…
            </span>
          ) : "SCAN RALLY"}
        </button>

        {/* SCAN FULL */}
        <button
          className="mini-scan-button"
          type="button"
          onClick={onScan}
          disabled={isScanning || isRallyScanning}
          style={{ ...SCAN_BTN_BASE, cursor: isScanning || isRallyScanning ? "not-allowed" : "pointer", opacity: isScanning || isRallyScanning ? 0.7 : 1 }}
          onPointerDown={e => { if (!isScanning && !isRallyScanning) pushDown(e); }}
          onPointerUp={pushUp}
          onPointerLeave={pushUp}
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
