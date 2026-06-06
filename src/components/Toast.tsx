import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  tone: "success" | "error" | "info";
}

const COLORS = {
  success: { bg: "rgba(16,185,129,0.15)", border: "#10b981", text: "#34d399", glow: "rgba(16,185,129,0.3)", icon: "✓" },
  error:   { bg: "rgba(239,68,68,0.15)",  border: "#ef4444", text: "#f87171", glow: "rgba(239,68,68,0.3)",  icon: "✗" },
  info:    { bg: "rgba(148,163,184,0.12)", border: "#94a3b8", text: "#cbd5e1", glow: "rgba(148,163,184,0.2)", icon: "ℹ" },
};

export function Toast({ message, tone }: ToastProps) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const c = COLORS[tone];

  useEffect(() => {
    // Start fade-out at 4.2s, fully gone at 5s
    const fadeTimer = setTimeout(() => setFading(true), 4200);
    const hideTimer = setTimeout(() => setVisible(false), 5000);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed",
      left: 12, right: 12, bottom: 20,
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 18px",
      borderRadius: 14,
      background: `rgba(5,7,11,0.96)`,
      border: `1.5px solid ${c.border}`,
      boxShadow: `0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px ${c.glow}`,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      opacity: fading ? 0 : 1,
      transform: fading ? "translateY(8px)" : "translateY(0)",
      transition: "opacity 700ms ease, transform 700ms ease",
    }}>
      {/* Icon */}
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: c.bg,
        border: `1px solid ${c.border}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 900, color: c.text,
        flexShrink: 0,
      }}>
        {c.icon}
      </div>

      {/* Message */}
      <span style={{
        flex: 1,
        fontSize: 13, fontWeight: 800,
        color: c.text,
        lineHeight: 1.3,
      }}>
        {message}
      </span>

      {/* Progress bar (5s countdown) */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0, right: 0,
        height: 2,
        borderRadius: "0 0 14px 14px",
        overflow: "hidden",
        background: "rgba(255,255,255,0.05)",
      }}>
        <div style={{
          height: "100%",
          background: c.border,
          borderRadius: "0 0 14px 14px",
          animation: "toast-progress 5s linear forwards",
        }} />
      </div>
    </div>
  );
}
