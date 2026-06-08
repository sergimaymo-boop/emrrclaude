import type { SystemStatus } from "../types";

interface SystemStatusCardsProps {
  systemStatus: SystemStatus;
}

function color(value: string): string {
  if (["REAL", "REAL_READY", "HEALTHY", "ALLOWED", "OPEN"].includes(value)) return "#10b981";
  if (["ERROR", "OFFLINE", "BLOCKED"].includes(value)) return "#ef4444";
  if (value.includes("PARTIAL") || value.includes("SCANNING") || value === "CLOSED") return "#eab308";
  return "#9ca3af";
}

function Row({ label, value, c }: { label: string; value: string; c?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <strong style={{ fontSize: 11, fontWeight: 800, color: c ?? color(value), textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{value}</strong>
    </div>
  );
}

export function SystemStatusCards({ systemStatus }: SystemStatusCardsProps) {
  const u = systemStatus.technical.universeStats;
  const t = systemStatus.technical;
  const eu = systemStatus.marketMode === "EU_OPEN" || systemStatus.marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED";
  const us = systemStatus.marketMode === "US_OPEN" || systemStatus.marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED";

  return (
    <section className="section-block" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>System Status</h2>
        <span style={{ fontSize: 10, color: color(systemStatus.dashboardDataMode), fontWeight: 700 }}>
          {systemStatus.dashboardDataMode}
        </span>
      </div>

      <div style={{ padding: "0 2px" }}>
        {/* ── Estado ── */}
        <Row label="API Status"      value={systemStatus.apiStatus} />
        <Row label="Datos operativos" value={systemStatus.operationalDataStatus} />
        <Row label="Cache"           value={systemStatus.cache ?? "—"} />

        {/* ── Universo ── */}
        <Row label="Universo total"  value={u.universeDiscovered.toLocaleString()} c="#9ca3af" />
        <Row label="Operable"        value={u.universeOperable.toLocaleString()} c="#9ca3af" />
        <Row label="Final TOP 8"     value={u.finalTop8Count.toLocaleString()} c={u.finalTop8Count > 0 ? "#f59e0b" : "#9ca3af"} />

        {/* ── Scan ── */}
        <Row label="Cobertura"       value={`${u.coveragePercent ?? 0}%`} c={(u.coveragePercent ?? 0) === 100 ? "#10b981" : "#eab308"} />
        <Row label="Batches"         value={`${u.batchesCompleted ?? 0} / ${u.batchesTotal ?? 0}`} c="#9ca3af" />
        <Row label="Scope"           value={u.resultScope ?? "—"} />
        <Row label="Scan ID"         value={u.scanId ? u.scanId.slice(0, 16) + "…" : "—"} c="#6b7280" />

        {/* ── Mercados ── */}
        <Row label="EU"              value={eu} />
        <Row label="EEUU"            value={us} />
        <Row label="Actualizado"     value={systemStatus.updatedAt.local} c="#6b7280" />
        <Row label="Último scan"     value={systemStatus.lastScan.local} c="#6b7280" />

        {/* ── Debug (solo si hay bloqueos) ── */}
        {systemStatus.operationalBlockReasons?.length > 0 && (
          <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(239,68,68,0.06)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.12)" }}>
            <div style={{ fontSize: 8, color: "#ef4444", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
              Razones de bloqueo
            </div>
            {systemStatus.operationalBlockReasons.slice(0, 4).map(r => (
              <div key={r} style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.8 }}>· {r}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
