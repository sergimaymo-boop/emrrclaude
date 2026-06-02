interface ActionButtonsProps {
  onScan: () => void;
  onContinueScan?: () => void;
  onCopy: () => void;
  isScanning: boolean;
  canContinueScan?: boolean;
  continueLabel?: string;
}

export function ActionButtons({
  onContinueScan,
  onCopy,
  isScanning,
  canContinueScan = false,
  continueLabel = "Continuar scan",
}: ActionButtonsProps) {
  return (
    <section style={{ display: "grid", gap: 8, marginTop: 16 }}>

      {/* Continue scan — only when partial scan token exists */}
      {canContinueScan && onContinueScan ? (
        <button
          type="button"
          onClick={onContinueScan}
          disabled={isScanning}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 44,
            padding: "0 20px",
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: 999,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
            touchAction: "manipulation",
            opacity: isScanning ? 0.5 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: "#818cf8", textTransform: "uppercase" }}>
            {continueLabel}
          </span>
        </button>
      ) : null}

      {/* Share TOP 8 — opens iOS native share sheet */}
      <button
        type="button"
        onClick={onCopy}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          minHeight: 52,
          padding: "0 24px",
          background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
          border: "none",
          borderRadius: 999,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          boxShadow: "0 0 24px rgba(99,102,241,0.3)",
          transition: "opacity 140ms, transform 140ms",
        }}
        onTouchStart={(e) => (e.currentTarget.style.opacity = "0.8")}
        onTouchEnd={(e) => (e.currentTarget.style.opacity = "1")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#ffffff", textTransform: "uppercase" }}>
            Compartir TOP 8
          </span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
            Email · WhatsApp · AirDrop · Notas
          </span>
        </div>
      </button>

    </section>
  );
}
