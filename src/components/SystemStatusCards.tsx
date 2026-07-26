import type { SystemStatus } from "../types";

interface SystemStatusCardsProps {
  systemStatus: SystemStatus;
}

function color(value: string): string {
  if (["REAL", "REAL_READY", "HEALTHY", "ALLOWED", "OPEN"].includes(value)) return "#10b981";
  if (["ERROR", "OFFLINE", "BLOCKED"].includes(value)) return "#ef4444";
  if (value.includes("PARTIAL") || value.includes("SCANNING") || value === "CLOSED" || value === "CIERRE") return "#eab308";
  return "#9ca3af";
}

// Valores que con mercado cerrado NO son errores reales: la política marca los datos
// operativos como no-real-time (correcto para bloquear EXEC), pero el scan de cierre
// completó bien — mostrar "ERROR" en rojo sería un falso negativo alarmante.
const CLOSED_MASKABLE = new Set(["ERROR", "OFFLINE", "DATA_UNAVAILABLE", "EMPTY", "BLOCKED"]);

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

  // Mercados cerrados + scan completo = modo CIERRE: los cálculos usan el último cierre
  // (correcto y esperado). Solo remapea la PRESENTACIÓN de estados alarmantes; la política
  // operativa (EXEC bloqueado sin mercado abierto) queda intacta.
  const closedOk = eu === "CLOSED" && us === "CLOSED" && (u.coveragePercent ?? 0) === 100 && u.universeDiscovered > 0;
  const disp = (v: string) => (closedOk && CLOSED_MASKABLE.has(v) ? "CIERRE" : v);

  return (
    <section className="section-block" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>System Status</h2>
        <span style={{ fontSize: 10, color: color(disp(systemStatus.dashboardDataMode)), fontWeight: 700 }}>
          {disp(systemStatus.dashboardDataMode)}
        </span>
      </div>

      <div style={{ padding: "0 2px" }}>
        {/* ── Estado ── */}
        {closedOk && (
          <div style={{ margin: "0 0 6px", padding: "5px 8px", background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 6, fontSize: 9, color: "#eab308", fontWeight: 600, lineHeight: 1.5 }}>
            ◉ Mercados cerrados — scan completado con datos del ÚLTIMO CIERRE (correcto).
            Los estados en ámbar indican modo cierre, no fallos.
          </div>
        )}
        <Row label="API Status"      value={disp(systemStatus.apiStatus)} />
        <Row label="Datos operativos" value={disp(systemStatus.operationalDataStatus)} />
        <Row label="Cache"           value={disp(systemStatus.cache ?? "—")} />

        {/* ── Universo ── */}
        <Row label="Universo total"  value={u.universeDiscovered.toLocaleString()} c="#9ca3af" />
        <Row label="Operable"        value={u.universeOperable.toLocaleString()} c="#9ca3af" />
        <Row label="Final TOP 8"     value={u.finalTop8Count.toLocaleString()} c={u.finalTop8Count > 0 ? "#f59e0b" : "#9ca3af"} />

        {/* ── Scan ── */}
        <Row label="Cobertura"       value={`${u.coveragePercent ?? 0}%`} c={(u.coveragePercent ?? 0) === 100 ? "#10b981" : "#eab308"} />
        <Row label="Batches"         value={`${u.batchesCompleted ?? 0} / ${u.batchesTotal ?? 0}`} c="#9ca3af" />
        {u.dataIntegrityScore != null && (
          <Row
            label="Integridad datos"
            value={`${u.dataIntegrityScore}%`}
            c={u.dataIntegrityScore >= 85 ? "#10b981" : u.dataIntegrityScore >= 70 ? "#eab308" : "#ef4444"}
          />
        )}
        <Row label="Scope"           value={u.resultScope ?? "—"} />
        <Row label="Scan ID"         value={u.scanId ? u.scanId.slice(0, 16) + "…" : "—"} c="#6b7280" />

        {/* ── Mercados ── */}
        <Row label="EU"              value={eu} />
        <Row label="EEUU"            value={us} />
        <Row label="Actualizado"     value={systemStatus.updatedAt.local} c="#6b7280" />
        <Row label="Último scan"     value={systemStatus.lastScan.local} c="#6b7280" />

        {/* ── Debug (solo si hay bloqueos) — en modo CIERRE es informativo (ámbar), no alarma ── */}
        {systemStatus.operationalBlockReasons?.length > 0 && (
          <div style={{
            marginTop: 8, padding: "6px 8px", borderRadius: 6,
            background: closedOk ? "rgba(234,179,8,0.05)" : "rgba(239,68,68,0.06)",
            border: `1px solid ${closedOk ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.12)"}`,
          }}>
            <div style={{ fontSize: 8, color: closedOk ? "#eab308" : "#ef4444", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
              {closedOk ? "EXEC bloqueado — mercado cerrado (normal)" : "Razones de bloqueo"}
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
