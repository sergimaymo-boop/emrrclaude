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

export function SystemStatusCards({ systemStatus }: SystemStatusCardsProps) {
  const u = systemStatus.technical.universeStats;
  const cards: [string, string][] = [
    ["Data Mode", systemStatus.dashboardDataMode],
    ["API Status", systemStatus.apiStatus],
    ["Universe", `${u.universeDiscovered.toLocaleString()} assets`],
    ["Operable", u.universeOperable.toLocaleString()],
    ["Final TOP 8", u.finalTop8Count.toLocaleString()],
    ["Last Scan", systemStatus.lastScan.local],
  ];

  return (
    <section className="section-block">
      <div className="section-title-row" style={{marginBottom:12}}>
        <h2>System Status</h2>
        <span style={{fontSize:10,color:statusColor(systemStatus.dashboardDataMode),fontWeight:700}}>{systemStatus.dashboardDataMode}</span>
      </div>
      <div className="status-grid">
        {cards.map(([label, value]) => (
          <article className="status-card" key={label}>
            <span>{label}</span>
            <strong style={{color:statusColor(value)}}>{value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}
