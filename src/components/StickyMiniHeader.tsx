import type { SystemStatus } from "../types";

// Scan phase shown inside the button
export type ScanPhase =
  | "idle"
  | "flows"    // step 1/4
  | "rally"    // step 2/4
  | "full"     // step 3/4
  | "breadth"  // step 4/4 — market breadth verdict
  | "done";

interface StickyMiniHeaderProps {
  systemStatus: SystemStatus;
  onScanAll: () => void;
  scanPhase: ScanPhase;
  onLogout: () => void;
}

function marketStates(marketMode: SystemStatus["marketMode"]) {
  return {
    europe: marketMode === "EU_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
    us:     marketMode === "US_OPEN" || marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED",
  };
}

function MarketPill({ label, status }: { label: string; status: "OPEN" | "CLOSED" }) {
  const open = status === "OPEN";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999,
      background: open ? "rgba(16,185,129,0.10)" : "rgba(100,116,139,0.10)",
      border: `1px solid ${open ? "rgba(16,185,129,0.25)" : "rgba(100,116,139,0.20)"}`,
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
        background: open ? "#10b981" : "#475569",
        boxShadow: open ? "0 0 5px #10b981" : "none",
      }} />
      <span style={{ fontSize: 9, fontWeight: 800, color: open ? "#10b981" : "#475569", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontSize: 9, fontWeight: 700, color: open ? "#34d399" : "#374151" }}>
        {status}
      </span>
    </div>
  );
}

// Button phase config
const PHASE_CONFIG: Record<ScanPhase, { label: string; sub: string; progress: number }> = {
  idle:    { label: "SCAN  EMRR",  sub: "Amplitud  ·  Flujos  ·  Líderes  ·  TOP 8", progress: 0 },
  flows:   { label: "Flujos…",     sub: "Paso 1 / 4  —  Rotación sectorial",  progress: 12 },
  rally:   { label: "Líderes…",    sub: "Paso 2 / 4  —  Rally Leaders",        progress: 34 },
  full:    { label: "TOP 8…",      sub: "Paso 3 / 4  —  Análisis completo",    progress: 56 },
  breadth: { label: "Amplitud…",   sub: "Paso 4 / 4  —  Veredicto de mercado", progress: 82 },
  done:    { label: "✓  Listo",    sub: "Señal Óptima + Amplitud actualizadas", progress: 100 },
};

export function StickyMiniHeader({
  systemStatus, onScanAll, scanPhase, onLogout,
}: StickyMiniHeaderProps) {
  const markets = marketStates(systemStatus.marketMode);
  const dateStr = systemStatus.updatedAt.local;
  const scanning = scanPhase !== "idle" && scanPhase !== "done";
  const done = scanPhase === "done";
  const cfg = PHASE_CONFIG[scanPhase];

  // Gold → green when done
  const btnGradient = done
    ? "linear-gradient(160deg, #10b981 0%, #059669 100%)"
    : "linear-gradient(160deg, #c9a227 0%, #9a7510 60%, #7a5c0a 100%)";
  const btnBorder  = done ? "1px solid rgba(16,185,129,0.5)" : "1px solid rgba(201,162,39,0.5)";
  const btnBBot    = done ? "3px solid #047857" : "3px solid #5a3f05";
  const btnShadow  = done
    ? "0 5px 20px rgba(16,185,129,0.30), 0 2px 6px rgba(0,0,0,0.4)"
    : "0 5px 22px rgba(180,130,10,0.40), 0 2px 6px rgba(0,0,0,0.4)";
  const btnText    = done ? "#a7f3d0" : "#fef9e6";
  const btnSub     = done ? "rgba(167,243,208,0.65)" : "rgba(254,249,230,0.55)";

  function pressDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.style.transform = "translateY(2px)";
    e.currentTarget.style.borderBottom = done ? "1px solid #047857" : "1px solid #5a3f05";
    e.currentTarget.style.boxShadow = "0 1px 5px rgba(0,0,0,0.3)";
  }
  function pressUp(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.borderBottom = btnBBot;
    e.currentTarget.style.boxShadow = btnShadow;
  }

  return (
    <div className="sticky-mini-header" style={{
      display: "flex", flexDirection: "column", gap: 8,
      padding: "8px 12px 10px",
      paddingTop: "max(8px, env(safe-area-inset-top))",
    }}>

      {/* ── INFO ROW ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: "#64748b",
          fontVariantNumeric: "tabular-nums", flex: "0 0 auto",
          letterSpacing: "0.02em",
        }}>
          {dateStr}
        </span>
        <span style={{ flex: 1 }} />
        <MarketPill label="EU"   status={markets.europe as "OPEN" | "CLOSED"} />
        <MarketPill label="EEUU" status={markets.us     as "OPEN" | "CLOSED"} />
        <button
          type="button"
          onClick={onLogout}
          style={{
            padding: "3px 11px", fontSize: 9, fontWeight: 700,
            color: "#475569", background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)", borderRadius: 999,
            cursor: "pointer", WebkitTapHighlightColor: "transparent",
          }}
          onPointerDown={e => { e.currentTarget.style.opacity = "0.6"; }}
          onPointerUp={e   => { e.currentTarget.style.opacity = "1"; }}
          onPointerLeave={e => { e.currentTarget.style.opacity = "1"; }}
        >
          LOGOUT
        </button>
      </div>

      {/* ── SINGLE SCAN BUTTON ── */}
      <button
        type="button"
        onClick={onScanAll}
        disabled={scanning}
        tabIndex={-1}
        style={{
          width: "100%", minHeight: 58,
          background: btnGradient,
          border: btnBorder,
          borderBottom: btnBBot,
          borderRadius: 12,
          boxShadow: btnShadow,
          color: btnText,
          cursor: scanning ? "not-allowed" : "pointer",
          transition: "transform 80ms ease, box-shadow 80ms ease, border-bottom 80ms ease, background 400ms ease",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          position: "relative",
          overflow: "hidden",
          opacity: scanning ? 0.92 : 1,
        }}
        onPointerDown={e => { e.preventDefault(); if (!scanning) pressDown(e); }}
        onPointerUp={pressUp}
        onPointerLeave={pressUp}
      >
        {/* Progress fill (behind text) */}
        {scanning && (
          <div style={{
            position: "absolute", inset: 0, left: 0,
            width: `${cfg.progress}%`,
            background: "rgba(0,0,0,0.18)",
            transition: "width 600ms ease",
            pointerEvents: "none",
          }} />
        )}

        {/* Scanning shimmer overlay */}
        {scanning && (
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 50%, transparent 100%)",
            animation: "shimmer 1.8s infinite linear",
            backgroundSize: "200% 100%",
            pointerEvents: "none",
          }} />
        )}

        {/* Label */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", zIndex: 1 }}>
          {scanning && (
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: btnText, display: "inline-block",
              animation: "pulse 1s infinite", flexShrink: 0,
            }} />
          )}
          <span style={{
            fontSize: 15, fontWeight: 900,
            letterSpacing: scanning ? "0.06em" : "0.12em",
            textTransform: "uppercase" as const,
          }}>
            {cfg.label}
          </span>
        </div>

        {/* Subtitle */}
        <span style={{
          fontSize: 9, fontWeight: 600,
          color: btnSub,
          letterSpacing: "0.05em",
          position: "relative", zIndex: 1,
        }}>
          {cfg.sub}
        </span>
      </button>
    </div>
  );
}
