import type { SystemStatus } from "../types";

interface ScanSummaryBarProps {
  systemStatus: SystemStatus;
}

function fmt(v: number | null | undefined, suffix = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v}${suffix}`;
}

function integrityColor(v: number | null | undefined): string {
  if (v == null) return "#64748b";
  if (v >= 85) return "#10b981";
  if (v >= 70) return "#eab308";
  return "#ef4444";
}

function scopeColor(scope: string | null | undefined): string {
  if (!scope) return "#64748b";
  if (scope === "GLOBAL_TOP8_FINAL") return "#10b981";
  if (scope.includes("PARTIAL")) return "#eab308";
  return "#64748b";
}

function scopeLabel(scope: string | null | undefined): string {
  if (!scope || scope === "UNAVAILABLE") return "Sin scan";
  if (scope === "GLOBAL_TOP8_FINAL") return "COMPLETO";
  if (scope.includes("PARTIAL")) return "PARCIAL";
  return scope;
}

function marketPill(label: string, isOpen: boolean) {
  return (
    <span key={label} style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 7px", borderRadius: 5, fontSize: 9, fontWeight: 800,
      background: isOpen ? "rgba(16,185,129,0.12)" : "rgba(100,116,139,0.12)",
      border: `1px solid ${isOpen ? "rgba(16,185,129,0.3)" : "rgba(100,116,139,0.2)"}`,
      color: isOpen ? "#10b981" : "#64748b",
    }}>
      <span style={{ fontSize: 7 }}>{isOpen ? "●" : "○"}</span>
      {label}
    </span>
  );
}

export function ScanSummaryBar({ systemStatus }: ScanSummaryBarProps) {
  const u = systemStatus.technical.universeStats;
  const integrity = u.dataIntegrityScore;
  const coverage = u.coveragePercent ?? 0;
  const euOpen = systemStatus.marketMode === "EU_OPEN" || systemStatus.marketMode === "BOTH_OPEN";
  const usOpen = systemStatus.marketMode === "US_OPEN" || systemStatus.marketMode === "BOTH_OPEN";
  const lastScan = systemStatus.lastScan?.local ?? "—";
  const scope = u.resultScope;

  const universeSubLabel =
    systemStatus.marketMode === "CLOSED" ? "último cierre" : "tiempo real";

  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap",
      gap: 6, padding: "8px 14px",
      background: "rgba(255,255,255,0.025)",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      marginBottom: 8,
    }}>
      {/* Universo */}
      <Metric
        label="Universo"
        value={u.universeDiscovered > 0 ? u.universeDiscovered.toLocaleString() : "—"}
        sub={universeSubLabel}
        color="#94a3b8"
        subColor={systemStatus.marketMode === "CLOSED" ? "#64748b" : "#10b981"}
      />
      <Divider />
      {/* Cobertura */}
      <Metric
        label="Cobertura"
        value={u.universeDiscovered > 0 || coverage > 0 ? `${coverage}%` : "—"}
        sub={scopeLabel(scope)}
        color={coverage === 100 ? "#10b981" : coverage > 0 ? "#eab308" : "#64748b"}
        subColor={scopeColor(scope)}
      />
      <Divider />
      {/* Integridad */}
      <Metric
        label="Integridad"
        value={integrity != null ? `${integrity}%` : "—"}
        sub={integrity != null ? (integrity >= 85 ? "óptima" : integrity >= 70 ? "aceptable" : "baja") : "sin datos"}
        color={integrityColor(integrity)}
        subColor={integrityColor(integrity)}
        highlight={integrity != null && integrity < 70}
      />
      <Divider />
      {/* Top 8 */}
      <Metric
        label="Top 8"
        value={fmt(u.finalTop8Count)}
        sub="seleccionados"
        color={u.finalTop8Count > 0 ? "#f59e0b" : "#64748b"}
      />
      <Divider />
      {/* Último scan */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 8, color: "#64748b", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Último scan</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{lastScan}</span>
      </div>
      {/* Spacer */}
      <div style={{ flex: 1 }} />
      {/* Mercados */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {marketPill("EU", euOpen)}
        {marketPill("EEUU", usOpen)}
      </div>
    </div>
  );
}

function Metric({
  label, value, sub, color, subColor, highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  subColor?: string;
  highlight?: boolean;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 1,
      padding: highlight ? "3px 6px" : undefined,
      borderRadius: highlight ? 5 : undefined,
      background: highlight ? "rgba(239,68,68,0.08)" : undefined,
      border: highlight ? "1px solid rgba(239,68,68,0.2)" : undefined,
    }}>
      <span style={{ fontSize: 8, color: "#64748b", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 800, color: color ?? "#e2e8f0", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 7.5, fontWeight: 600, color: subColor ?? "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return (
    <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
  );
}
