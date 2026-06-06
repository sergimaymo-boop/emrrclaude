import type { SystemStatus } from "../types";

interface StickyMiniHeaderProps {
  systemStatus: SystemStatus;
  onScan: () => void;
  isScanning: boolean;
  onScanRally: () => void;
  isRallyScanning: boolean;
  onScanFlows: () => void;
  isFlowsScanning: boolean;
  onLogout: () => void;
}

function marketStates(marketMode: SystemStatus["marketMode"]) {
  return {
    europe: marketMode === "EU_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
    us: marketMode === "US_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
  };
}

// ─── OLD GOLD — color único para los 3 botones de scan ───────────────────────
const GOLD = {
  bg:     "linear-gradient(160deg, #c9a227 0%, #9a7510 60%, #7a5c0a 100%)",
  border: "1px solid rgba(201,162,39,0.55)",
  bbot:   "3px solid #5a3f05",
  text:   "#fef9e6",
  shadow: "0 5px 20px rgba(180,130,10,0.45), 0 2px 6px rgba(0,0,0,0.4)",
  shadowPress: "0 1px 5px rgba(180,130,10,0.2)",
  pulse:  "#fde68a",
};

const SCAN_BTN: React.CSSProperties = {
  flex: 1,
  minHeight: 52,
  padding: "0 8px",
  background: GOLD.bg,
  border: GOLD.border,
  borderBottom: GOLD.bbot,
  borderRadius: 10,
  color: GOLD.text,
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: "0.10em",
  textTransform: "uppercase" as const,
  boxShadow: GOLD.shadow,
  cursor: "pointer",
  transition: "transform 80ms ease, box-shadow 80ms ease, border-bottom 80ms ease, opacity 150ms",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
};

function pressDown(e: React.PointerEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "translateY(2px)";
  e.currentTarget.style.borderBottom = "1px solid #5a3f05";
  e.currentTarget.style.boxShadow = GOLD.shadowPress;
}
function pressUp(e: React.PointerEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "";
  e.currentTarget.style.borderBottom = GOLD.bbot;
  e.currentTarget.style.boxShadow = GOLD.shadow;
}

// ─── Market indicator ─────────────────────────────────────────────────────────
function MarketPill({ label, status }: { label: string; status: "OPEN" | "CLOSED" }) {
  const open = status === "OPEN";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "4px 10px", borderRadius: 999,
      background: open ? "rgba(16,185,129,0.12)" : "rgba(100,116,139,0.12)",
      border: `1px solid ${open ? "rgba(16,185,129,0.3)" : "rgba(100,116,139,0.25)"}`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: open ? "#10b981" : "#64748b",
        boxShadow: open ? "0 0 6px #10b981" : "none",
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 9, fontWeight: 800, color: open ? "#10b981" : "#64748b", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: 9, fontWeight: 700, color: open ? "#34d399" : "#475569" }}>
        {status}
      </span>
    </div>
  );
}

// ─── Scanning pulse dot ───────────────────────────────────────────────────────
function PulseDot() {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: GOLD.pulse,
      display: "inline-block",
      animation: "pulse 1s infinite",
      flexShrink: 0,
    }} />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function StickyMiniHeader({
  systemStatus, onScan, isScanning, onScanRally, isRallyScanning,
  onScanFlows, isFlowsScanning, onLogout,
}: StickyMiniHeaderProps) {
  const markets = marketStates(systemStatus.marketMode);
  const dateStr = systemStatus.updatedAt.local;
  const anyScanning = isScanning || isRallyScanning || isFlowsScanning;

  return (
    <div
      className="sticky-mini-header"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px 10px",
        paddingTop: "max(8px, env(safe-area-inset-top))",
      }}
    >
      {/* ── ROW 1: Info bar ─────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}>
        {/* Date + time */}
        <span style={{
          fontSize: 11, fontWeight: 700, color: "#64748b",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          flex: "0 0 auto",
        }}>
          {dateStr}
        </span>

        <span style={{ flex: 1 }} />

        {/* Market status pills */}
        <MarketPill label="EU"    status={markets.europe as "OPEN" | "CLOSED"} />
        <MarketPill label="EEUU"  status={markets.us     as "OPEN" | "CLOSED"} />

        {/* Logout — small, unobtrusive */}
        <button
          type="button"
          onClick={onLogout}
          style={{
            padding: "4px 12px",
            fontSize: 9, fontWeight: 700,
            color: "#475569",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 999,
            cursor: "pointer",
            letterSpacing: "0.06em",
            WebkitTapHighlightColor: "transparent",
            transition: "opacity 120ms",
          }}
          onPointerDown={e => { e.currentTarget.style.opacity = "0.6"; }}
          onPointerUp={e   => { e.currentTarget.style.opacity = "1"; }}
          onPointerLeave={e => { e.currentTarget.style.opacity = "1"; }}
        >
          LOGOUT
        </button>
      </div>

      {/* ── ROW 2: 3 large gold SCAN buttons ────────────────────────────── */}
      <div style={{ display: "flex", gap: 8 }}>

        {/* SCAN FLOWS */}
        <button
          type="button"
          onClick={onScanFlows}
          disabled={anyScanning}
          style={{ ...SCAN_BTN, opacity: anyScanning && !isFlowsScanning ? 0.55 : 1, cursor: anyScanning ? "not-allowed" : "pointer" }}
          onPointerDown={e => { if (!anyScanning) pressDown(e); }}
          onPointerUp={pressUp}
          onPointerLeave={pressUp}
        >
          {isFlowsScanning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulseDot />
              <span>Escaneando…</span>
            </span>
          ) : (
            <>
              <span>SCAN FLOWS</span>
              <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(254,249,230,0.55)", letterSpacing: "0.04em" }}>
                FLUJOS
              </span>
            </>
          )}
        </button>

        {/* SCAN RALLY */}
        <button
          type="button"
          onClick={onScanRally}
          disabled={anyScanning}
          style={{ ...SCAN_BTN, opacity: anyScanning && !isRallyScanning ? 0.55 : 1, cursor: anyScanning ? "not-allowed" : "pointer" }}
          onPointerDown={e => { if (!anyScanning) pressDown(e); }}
          onPointerUp={pressUp}
          onPointerLeave={pressUp}
        >
          {isRallyScanning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulseDot />
              <span>Escaneando…</span>
            </span>
          ) : (
            <>
              <span>SCAN RALLY</span>
              <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(254,249,230,0.55)", letterSpacing: "0.04em" }}>
                LÍDERES
              </span>
            </>
          )}
        </button>

        {/* SCAN FULL */}
        <button
          type="button"
          onClick={onScan}
          disabled={anyScanning}
          style={{ ...SCAN_BTN, opacity: anyScanning && !isScanning ? 0.55 : 1, cursor: anyScanning ? "not-allowed" : "pointer" }}
          onPointerDown={e => { if (!anyScanning) pressDown(e); }}
          onPointerUp={pressUp}
          onPointerLeave={pressUp}
        >
          {isScanning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulseDot />
              <span>Escaneando…</span>
            </span>
          ) : (
            <>
              <span>SCAN FULL</span>
              <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(254,249,230,0.55)", letterSpacing: "0.04em" }}>
                TOP 8
              </span>
            </>
          )}
        </button>

      </div>
    </div>
  );
}
