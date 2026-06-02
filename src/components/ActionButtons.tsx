interface ActionButtonsProps {
  onScan: () => void;
  onContinueScan?: () => void;
  onCopy: () => void;
  onBackup: () => void;
  isScanning: boolean;
  canContinueScan?: boolean;
  continueLabel?: string;
}

export function ActionButtons({
  onContinueScan,
  onCopy,
  onBackup,
  isScanning,
  canContinueScan = false,
  continueLabel = "CONTINUE SCAN",
}: ActionButtonsProps) {
  return (
    <section style={{ display: "grid", gap: 8, marginTop: 16 }}>
      {canContinueScan && onContinueScan ? (
        <button
          className="secondary-button"
          type="button"
          onClick={onContinueScan}
          disabled={isScanning}
          style={{ width: "100%" }}
        >
          {continueLabel}
        </button>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {/* Export Results — opens iOS share sheet */}
        <button
          type="button"
          onClick={onCopy}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            minHeight: 72,
            padding: "12px 10px",
            background: "linear-gradient(135deg, #1c1c32 0%, #16162a 100%)",
            border: "1px solid rgba(245,158,11,0.25)",
            borderRadius: 10,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
            touchAction: "manipulation",
            transition: "opacity 140ms",
          }}
          onTouchStart={(e) => (e.currentTarget.style.opacity = "0.7")}
          onTouchEnd={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "#f59e0b", textTransform: "uppercase" }}>
            Compartir
          </span>
          <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 600 }}>
            TOP 8 Report
          </span>
        </button>

        {/* Export Code */}
        <button
          type="button"
          onClick={onBackup}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            minHeight: 72,
            padding: "12px 10px",
            background: "linear-gradient(135deg, #1c1c32 0%, #16162a 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
            touchAction: "manipulation",
            transition: "opacity 140ms",
          }}
          onTouchStart={(e) => (e.currentTarget.style.opacity = "0.7")}
          onTouchEnd={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6"/>
            <polyline points="8 6 2 12 8 18"/>
          </svg>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "#9ca3af", textTransform: "uppercase" }}>
            Código
          </span>
          <span style={{ fontSize: 9, color: "#4b5563", fontWeight: 600 }}>
            Export técnico
          </span>
        </button>
      </div>
    </section>
  );
}
