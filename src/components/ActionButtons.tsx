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

      <button
        type="button"
        onClick={onCopy}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          minHeight: 56,
          padding: "0 20px",
          background: "linear-gradient(135deg, #1c1c32 0%, #16162a 100%)",
          border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 10,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          transition: "opacity 140ms",
        }}
        onTouchStart={(e) => (e.currentTarget.style.opacity = "0.7")}
        onTouchEnd={(e) => (e.currentTarget.style.opacity = "1")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#f59e0b", textTransform: "uppercase" }}>
            Compartir TOP 8
          </span>
          <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 600 }}>
            Email · WhatsApp · AirDrop · Notas
          </span>
        </div>
      </button>
    </section>
  );
}
