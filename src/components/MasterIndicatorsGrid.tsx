import type { ColorToken, MasterIndicator } from "../types";
import { Badge } from "./Badge";
import { colorClass } from "../utils/colors";

interface MasterIndicatorsGridProps {
  indicators: MasterIndicator[];
}

const indicatorBarHeights = [38, 56, 48, 72, 61, 84, 66, 78];

function dataModeToken(mode: MasterIndicator["dataMode"]): ColorToken {
  if (mode === "REAL") return "GREEN_HARD";
  if (mode === "LAST_CLOSE") return "YELLOW";
  if (mode === "LAST_SESSION" || mode === "PARTIAL_DATA") return "YELLOW";
  if (mode === "ERROR") return "RED";
  return "WHITE_GREY";
}

function operationalStatusToken(status: MasterIndicator["operationalDataStatus"]): ColorToken {
  if (status === "REAL") return "GREEN_SOFT";
  if (status === "LAST_CLOSE") return "YELLOW";
  if (status === "ERROR") return "RED";
  return "WHITE_GREY";
}

function displayCacheStatus(status: MasterIndicator["cacheStatus"]): string {
  if (status === "MISS") return "FETCHED";
  if (status === "HIT") return "CACHE HIT";
  if (status === "BYPASS") return "NO CACHE";
  return status;
}

export function MasterIndicatorsGrid({ indicators }: MasterIndicatorsGridProps) {
  return (
    <section className="section-block">
      <div className="section-title-row">
        <h2>Master Indicators</h2>
        <span>Informational · operational policy labeled</span>
      </div>
      <div className="indicator-grid">
        {indicators.map((indicator) => (
          <article className="indicator-card" key={indicator.symbol}>
            <div className="card-topline">
              <strong>{indicator.symbol}</strong>
              <Badge token={dataModeToken(indicator.dataMode)}>{indicator.dataMode}</Badge>
              <Badge token={operationalStatusToken(indicator.operationalDataStatus)}>
                {indicator.operationalDataStatus}
              </Badge>
            </div>
            <span className="metric-label">{indicator.name}</span>
            <div className="indicator-value">{indicator.value}</div>
            <div className={`change-line ${colorClass(indicator.color)}`}>
              {indicator.changePercent > 0 ? "+" : ""}
              {indicator.changePercent.toFixed(2)}%
            </div>
            <div className="indicator-bars" aria-hidden="true">
              {indicatorBarHeights.map((height, index) => (
                <span key={`${indicator.symbol}-${index}`} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="card-footer">
              <span>{indicator.source}</span>
              <span>{displayCacheStatus(indicator.cacheStatus)}</span>
              <span>{indicator.operationalDecisionAllowed ? "OPERATIONAL" : "INFO ONLY"}</span>
              <span>{indicator.priceTimestamp.local}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
