import type { ColorToken, SystemStatus } from "../types";
import { Badge } from "./Badge";

interface SystemStatusCardsProps {
  systemStatus: SystemStatus;
}

export function SystemStatusCards({ systemStatus }: SystemStatusCardsProps) {
  const universeStats = systemStatus.technical.universeStats;
  const dataModeToken: ColorToken =
    systemStatus.dashboardDataMode === "REAL"
      ? "GREEN_HARD"
      : systemStatus.dashboardDataMode === "LAST_CLOSE"
        ? "YELLOW"
        : systemStatus.dashboardDataMode === "SCANNING" || systemStatus.dashboardDataMode === "PARTIAL_DATA"
          ? "YELLOW"
          : systemStatus.dashboardDataMode === "ERROR"
            ? "RED"
            : "WHITE_GREY";
  const cards = [
    ["Data Mode", systemStatus.dashboardDataMode],
    ["Operational Data", systemStatus.operationalDataStatus],
    ["Operational Decision", systemStatus.operationalDecisionAllowed ? "ALLOWED" : "BLOCKED"],
    ["API Status", systemStatus.apiStatus],
    ["Cache Status", systemStatus.cache],
    ["Source / Scope", `${universeStats.top8Source} / ${universeStats.resultScope}`],
    ["Universe Discovered", universeStats.universeDiscovered.toLocaleString()],
    ["Universe Operable", universeStats.universeOperable.toLocaleString()],
    ["Eligible / Ranked", `${universeStats.universeEligibleForScore.toLocaleString()} / ${universeStats.universeRanked.toLocaleString()}`],
    ["Final TOP 8", universeStats.finalTop8Count.toLocaleString()],
    ["Last Real Data", systemStatus.lastRealDataUpdate?.local ?? "No real data yet"],
    ["Last Scan", systemStatus.lastScan.local],
    ["Readiness", `${systemStatus.readiness} / ${systemStatus.operationalBlockReasons[0] ?? "NO_BLOCK"}`],
  ];

  return (
    <section className="section-block">
      <div className="section-title-row">
        <h2>System Status</h2>
        <Badge token={dataModeToken}>{systemStatus.dashboardDataMode}</Badge>
      </div>
      <div className="status-grid">
        {cards.map(([label, value]) => (
          <article className="status-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}
