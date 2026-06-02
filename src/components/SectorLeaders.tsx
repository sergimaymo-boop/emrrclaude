import type { SectorLeader } from "../types";

interface SectorLeadersProps {
  sectors: SectorLeader[];
}

function sectorStateClass(state: SectorLeader["state"]): string {
  return `sector-pill-${state.toLowerCase()}`;
}

function sectorThermometerClass(state: SectorLeader["state"]): string {
  return `sector-thermometer sector-thermometer-${state.toLowerCase()}`;
}

function sectorPerformanceClass(performance: number): string {
  if (performance > 0) return "sector-performance-positive";
  if (performance < 0) return "sector-performance-negative";
  return "sector-performance-neutral";
}

const sectorStateOrder: Record<SectorLeader["state"], number> = {
  LEADING: 0,
  ACCELERATING: 1,
  WEAKENING: 2,
  FALLING: 3,
};

export function SectorLeaders({ sectors }: SectorLeadersProps) {
  const sortedSectors = [...sectors].sort((first, second) => {
    const stateDifference = sectorStateOrder[first.state] - sectorStateOrder[second.state];
    if (stateDifference !== 0) return stateDifference;
    return second.performance - first.performance;
  });
  const hasRealSectorData = sortedSectors.some((sector) => sector.operationalDataStatus === "REAL");

  return (
    <section className="section-block">
      <div className="section-title-row">
        <h2>Leading Sectors</h2>
        <span>{hasRealSectorData ? "5-session leadership" : "DATA UNAVAILABLE"}</span>
      </div>
      <div className="sector-list">
        {!hasRealSectorData ? (
          <article className="sector-row">
            <div className="sector-main">
              <strong>Sector leadership unavailable</strong>
              <span className="sector-performance sector-performance-neutral">No real source</span>
            </div>
            <span className="sector-pill sector-pill-falling">INFO ONLY</span>
          </article>
        ) : sortedSectors.map((sector) => (
          <article className="sector-row" key={sector.sector}>
            <div className="sector-main">
              <strong>{sector.sector}</strong>
              <span className={`sector-performance ${sectorPerformanceClass(sector.performance)}`}>
                {sector.performance > 0 ? "+" : ""}
                {sector.performance.toFixed(1)}%
              </span>
            </div>
            <div className={sectorThermometerClass(sector.state)} aria-label={`${sector.state} sector strength`}>
              <span className="sector-thermometer-track">
                <span className="sector-thermometer-fill" />
              </span>
            </div>
            <span className={`sector-pill ${sectorStateClass(sector.state)}`}>{sector.state}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
