import type { SystemStatus } from "../types";

interface SystemStatusCardsProps {
  systemStatus: SystemStatus;
}

function statusColor(value: string): string {
  if (value === "REAL" || value === "REAL_READY" || value === "HEALTHY" || value === "ALLOWED") return "#10b981";
  if (value === "ERROR" || value === "OFFLINE") return "#ef4444";
  if (value.includes("PARTIAL") || value.includes("SCANNING") || value.includes("LAST")) return "#eab308";
  return "#9ca3af";
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = color ?? statusColor(value);
  return (
    <article className="status-card">
      <span style={{ fontSize: 9, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <strong style={{ fontSize: 12, fontWeight: 800, color: c, wordBreak: "break-all" }}>{value}</strong>
    </article>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 9, color: "#374151", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", margin: "12px 0 6px" }}>
      {children}
    </div>
  );
}

export function SystemStatusCards({ systemStatus }: SystemStatusCardsProps) {
  const u = systemStatus.technical.universeStats;
  const t = systemStatus.technical;

  return (
    <section className="section-block" style={{ marginTop: 12 }}>
      <div className="section-title-row" style={{ marginBottom: 8 }}>
        <h2>System Status</h2>
        <span style={{ fontSize: 10, color: statusColor(systemStatus.dashboardDataMode), fontWeight: 700 }}>
          {systemStatus.dashboardDataMode}
        </span>
      </div>

      {/* ── ESTADO OPERACIONAL ── */}
      <SectionLabel>Estado Operacional</SectionLabel>
      <div className="status-grid">
        <Card label="Data Mode" value={systemStatus.dashboardDataMode} />
        <Card label="API Status" value={systemStatus.apiStatus} />
        <Card label="Datos Operativos" value={systemStatus.operationalDataStatus} />
        <Card label="Decisión" value={systemStatus.operationalDecisionAllowed ? "ALLOWED" : "BLOCKED"} />
        <Card label="Readiness" value={systemStatus.readiness ?? "—"} color="#9ca3af" />
        <Card label="Cache" value={systemStatus.cache ?? "—"} />
      </div>

      {/* ── UNIVERSO ── */}
      <SectionLabel>Universo</SectionLabel>
      <div className="status-grid">
        <Card label="Descubierto" value={u.universeDiscovered.toLocaleString()} color="#9ca3af" />
        <Card label="Operable" value={u.universeOperable.toLocaleString()} color="#9ca3af" />
        <Card label="Elegible Score" value={u.universeEligibleForScore.toLocaleString()} color="#9ca3af" />
        <Card label="Ranked" value={u.universeRanked.toLocaleString()} color="#9ca3af" />
        <Card label="Final TOP 8" value={u.finalTop8Count.toLocaleString()} color={u.finalTop8Count > 0 ? "#f59e0b" : "#9ca3af"} />
        <Card label="Fuente TOP 8" value={u.top8Source ?? "—"} />
      </div>

      {/* ── SCAN ── */}
      <SectionLabel>Scan</SectionLabel>
      <div className="status-grid">
        <Card label="Cobertura" value={`${u.coveragePercent ?? 0}%`} color={(u.coveragePercent ?? 0) === 100 ? "#10b981" : "#eab308"} />
        <Card label="Batches" value={`${u.batchesCompleted ?? 0} / ${u.batchesTotal ?? 0}`} color="#9ca3af" />
        <Card label="API Calls" value={(u.actualProviderCalls ?? t.apiCalls ?? 0).toLocaleString()} color="#9ca3af" />
        <Card label="Calls Bloqueadas" value={(t.blockedCalls ?? 0).toLocaleString()} color="#9ca3af" />
        <Card label="Scope" value={u.resultScope ?? "—"} />
        <Card label="Scan ID" value={u.scanId ? u.scanId.slice(0, 14) + "…" : "—"} color="#6b7280" />
      </div>

      {/* ── MERCADOS ACTIVOS ── */}
      <SectionLabel>Mercados & Horario</SectionLabel>
      <div className="status-grid">
        <Card label="Mercado Mode" value={systemStatus.marketMode ?? "—"} />
        <Card label="EU Market" value={systemStatus.marketMode === "EU_OPEN" || systemStatus.marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED"} />
        <Card label="US Market" value={systemStatus.marketMode === "US_OPEN" || systemStatus.marketMode === "BOTH_OPEN" ? "OPEN" : "CLOSED"} />
        <Card label="Última Actualiz." value={systemStatus.updatedAt.local} color="#6b7280" />
        <Card label="Último Scan Real" value={systemStatus.lastRealDataUpdate?.local ?? "Sin datos reales"} color="#6b7280" />
        <Card label="Último Scan" value={systemStatus.lastScan.local} color="#6b7280" />
      </div>

      {/* ── PROVIDERS & INFRA ── */}
      <SectionLabel>Providers & Infraestructura</SectionLabel>
      <div className="status-grid">
        <Card label="Finnhub" value={t.finnhubStatus ?? "—"} />
        <Card label="EODHD" value={t.eodhdStatus ?? "—"} />
        <Card label="Cache Entries" value={(t.cacheEntries ?? 0).toString()} color="#6b7280" />
        <Card label="Uptime" value={`${t.uptimeMinutes ?? 0} min`} color="#6b7280" />
        <Card label="Timezone" value="UTC+0 Canarias" color="#6b7280" />
        <Card label="Universe Hash" value={u.universeHash ? u.universeHash.slice(0, 10) + "…" : "—"} color="#6b7280" />
      </div>

      {/* ── ERRORES DE DEBUG (solo si hay) ── */}
      {systemStatus.operationalBlockReasons?.length > 0 && (
        <>
          <SectionLabel>Debug — Razones de Bloqueo</SectionLabel>
          <div style={{ padding: "8px 10px", background: "rgba(239,68,68,0.05)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.1)" }}>
            {systemStatus.operationalBlockReasons.slice(0, 8).map(r => (
              <div key={r} style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.8 }}>· {r}</div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
