import { useEffect, useState } from "react";

interface FearGreedData {
  score: number;
  rating: string;
  label: string;
  components?: Record<string, number | null>;
}

export function FearGreedPanel({ fearGreed }: { fearGreed: any }) {
  const [fgData, setFgData] = useState<FearGreedData | null>(null);

  useEffect(() => {
    fetch("/api/fear-greed")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setFgData(d);
      })
      .catch(() => {});
  }, []);

  const getColor = (score: number) => {
    if (score >= 76) return "#ef4444"; // extreme greed — red warning
    if (score >= 56) return "#f59e0b"; // greed — amber
    if (score >= 46) return "#94a3b8"; // neutral — grey
    if (score >= 26) return "#6366f1"; // fear — indigo
    return "#3b82f6";                  // extreme fear — blue
  };

  if (!fgData) {
    // Fear & Greed unavailable — waiting for /api/fear-greed response
    // DATA UNAVAILABLE: not used for Score, Ranking or EXEC
    return (
      <section className="section-block priority-block">
        <div className="section-title-row">
          <h2>Fear &amp; Greed unavailable</h2>
        </div>
        <div className="fear-greed-layout">
          <div className="fear-score">N/A</div>
          <div>
            <p className="metric-label">Sentiment</p>
            <strong>DATA UNAVAILABLE</strong>
            <span className="muted-line">not used for Score, Ranking or EXEC · calculando…</span>
            <span className="muted-line">{fearGreed.operationalDataStatus}</span>
          </div>
        </div>
      </section>
    );
  }

  const color = getColor(fgData.score);
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference * (1 - fgData.score / 100);

  return (
    <section className="section-block">
      <div className="section-title-row" style={{ marginBottom: 12 }}>
        <h2>Fear &amp; Greed</h2>
        <span style={{ fontSize: 10, color: "#64748b" }}>Calculado internamente</span>
      </div>
      {/* DATA UNAVAILABLE fallback — Fear & Greed unavailable — not used for Score, Ranking or EXEC */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Gauge */}
        <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="10"
            />
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 1s ease" }}
            />
          </svg>
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{fgData.score}</span>
            <span style={{ fontSize: 8, color: "#64748b", fontWeight: 700 }}>/ 100</span>
          </div>
        </div>
        {/* Label + components */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color, marginBottom: 4 }}>
            {fgData.label ?? fgData.rating}
          </div>
          <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.6 }}>
            {fgData.components &&
              Object.entries(fgData.components).map(([k, v]) => (
                <div key={k}>
                  {k}:{" "}
                  <span style={{ color: "#94a3b8" }}>
                    {v === null ? "N/A" : typeof v === "number" ? v.toFixed(0) : String(v)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </section>
  );
}
