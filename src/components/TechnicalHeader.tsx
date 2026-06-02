import type { SystemStatus } from "../types";

interface TechnicalHeaderProps {
  systemStatus: SystemStatus;
  onLogout: () => void;
}

export function TechnicalHeader({ systemStatus, onLogout }: TechnicalHeaderProps) {
  const technical = systemStatus.technical;
  const universeStats = technical.universeStats;

  return (
    <header className="technical-header">
      <div className="header-identity">
        <p className="eyebrow">DEV · Institutional Trend Dashboard</p>
        <h1>EMRR 2.0</h1>
        <p className="header-subtitle">Trends · {systemStatus.readiness} / {systemStatus.dashboardDataMode}</p>
        <div className="technical-console" aria-label="Technical status">
          <span><i className="console-dot" />EODHD {technical.eodhdStatus}</span>
          <span><i className="console-dot" />Finnhub {technical.finnhubStatus}</span>
          <span className="console-separator" aria-hidden="true" />
          <span>Cache {technical.cacheEntries}</span>
          <span>Uptime {technical.uptimeMinutes}m</span>
          <span>API calls {technical.apiCalls}</span>
          <span>Blocked {technical.blockedCalls}</span>
          <span className="console-separator" aria-hidden="true" />
          <span>Data mode {systemStatus.dashboardDataMode}</span>
          <span>Operational {systemStatus.operationalDataStatus}</span>
          <span>Source {universeStats.top8Source}</span>
          <span>Scope {universeStats.resultScope}</span>
          <span>{technical.sampleLabel}</span>
        </div>
      </div>
      <div className="header-session-actions">
        <button className="session-logout-button" type="button" onClick={onLogout}>
          Logout
        </button>
      </div>
      <div className="header-metrics">
        <div className="time-status-card">
          <span>Local time</span>
          <strong>{systemStatus.updatedAt.local}</strong>
        </div>
        <div className="universe-status-card">
          <div className="universe-copy">
            <span>Analysed Universe</span>
            <small>
              US {universeStats.us.toLocaleString()} · Europe {universeStats.europe.toLocaleString()}
            </small>
            <small>
              Operable {universeStats.universeOperable.toLocaleString()} · Ranked{" "}
              {universeStats.universeRanked.toLocaleString()}
            </small>
          </div>
          <strong>{universeStats.total.toLocaleString()}</strong>
        </div>
      </div>
    </header>
  );
}
