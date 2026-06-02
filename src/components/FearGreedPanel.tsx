import type { FearGreed } from "../types";
import { colorClass } from "../utils/colors";
import { Badge } from "./Badge";

interface FearGreedPanelProps {
  fearGreed: FearGreed;
}

export function FearGreedPanel({ fearGreed }: FearGreedPanelProps) {
  return (
    <section className="section-block priority-block">
      <div className="section-title-row">
        <h2>Fear & Greed unavailable</h2>
        <Badge token="WHITE_GREY">{fearGreed.operationalDataStatus}</Badge>
      </div>
      <div className="fear-greed-layout">
        <div className={`fear-score ${colorClass(fearGreed.color)}`}>N/A</div>
        <div>
          <p className="metric-label">Sentiment</p>
          <strong>DATA UNAVAILABLE</strong>
          <span className="muted-line">No approved real source · not used for Score, Ranking or EXEC</span>
          <span className="muted-line">Last checked {fearGreed.timestamp.local}</span>
          <span className="muted-line">{fearGreed.operationalBlockReasons[0]}</span>
        </div>
      </div>
    </section>
  );
}
