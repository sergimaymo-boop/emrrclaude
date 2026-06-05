import type { SystemStatus } from "../types";

interface TechnicalHeaderProps {
  systemStatus: SystemStatus;
  onLogout: () => void; // kept for interface compat — logout moved to sticky header
}

export function TechnicalHeader({ systemStatus }: TechnicalHeaderProps) {
  const u = systemStatus.technical.universeStats;

  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 0 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      marginBottom: 12,
    }}>
      {/* Left: brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: "-0.5px", color: "#ffffff", lineHeight: 1 }}>
          EMRR
        </h1>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
          color: "#f59e0b", textTransform: "uppercase",
          padding: "3px 8px", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 4,
        }}>
          INSTITUTIONAL
        </span>
      </div>

      {/* Right: Universe count */}
      <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
        Universe <strong style={{ color: "#94a3b8", fontWeight: 800 }}>{u.universeDiscovered > 0 ? u.universeDiscovered.toLocaleString() : "—"}</strong>
      </span>
    </header>
  );
}
