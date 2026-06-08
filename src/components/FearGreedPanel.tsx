import { useEffect, useState } from "react";
import type { MasterIndicator } from "../types";
import { IndicatorRow } from "./MasterIndicatorsGrid";

interface FearGreedData {
  score: number;
  rating: string;
  label: string;
  source?: string;
  sourceLabel?: string;
  cnnAsOfUtc?: string | null;
  components?: Record<string, number | null>;
}

// Same 6 indicators shown in "Master Indicators" (SPY excluded), in the exact
// top-to-bottom order requested: HYG, MOVE, VIX, VVIX, TNX, LQD.
// Reusing the SAME `masterIndicators` data + the SAME `IndicatorRow` renderer
// guarantees byte-identical values, colors and LIVE/CACHE status.
const FG_INDICATOR_ORDER: MasterIndicator["symbol"][] = ["HYG", "MOVE", "VIX", "VVIX", "TNX", "LQD"];

export function FearGreedPanel({ fearGreed, masterIndicators }: { fearGreed: any; masterIndicators?: MasterIndicator[] }) {
  const [fgData, setFgData] = useState<FearGreedData | null>(null);

  useEffect(() => {
    // AUDIT FIX (F&G "frozen" / "esta mal"): este fetch antes solo se ejecutaba
    // UNA VEZ al montar el componente — el score y "Cierre de referencia"
    // quedaban congelados con el valor de cuando se abrió el dashboard, por
    // eso el usuario seguía viendo el mismo score ("el F&G esta ahora en 42
    // todavia") sin que se actualizara con el feed en vivo de CNN. El backend
    // /api/fear-greed SÍ devuelve datos en vivo sin caché (Cache-Control:
    // no-store / x-vercel-cache: MISS verificado) — el problema era puramente
    // de refresco en el frontend. Es un indicador de mercado global (no un
    // ticket de inversión), por lo que debe refrescarse SIEMPRE, sin importar
    // si los mercados de scan están abiertos o cerrados.
    function load() {
      fetch("/api/fear-greed")
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setFgData(d);
        })
        .catch(() => {});
    }
    load();
    const timer = window.setInterval(load, 4 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Gauge color strictly by score range (matches the CNN Fear & Greed scale,
  // which is the live primary source — see sourceLabel/source below):
  //   0-25   Extreme Fear   → red
  //   26-45  Fear           → orange
  //   46-55  Neutral        → strong grey
  //   56-75  Greed          → soft green
  //   76-100 Extreme Greed  → very strong green
  const getColor = (score: number) => {
    if (score <= 25) return "#ef4444"; // 0-25: red
    if (score <= 45) return "#f97316"; // 26-45: orange
    if (score <= 55) return "#64748b"; // 46-55: strong grey
    if (score <= 75) return "#4ade80"; // 56-75: soft green
    return "#15803d";                  // 76-100: very strong green
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
        <span style={{ fontSize: 10, color: "#64748b" }}>
          {fgData.sourceLabel ?? "Calculado internamente"}
        </span>
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
        {/* Label + component SCORES (not raw values) */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color, marginBottom: 2 }}>
            {fgData.label ?? fgData.rating}
          </div>
          {fgData.cnnAsOfUtc && (
            <div style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
              Cierre de referencia: {new Date(fgData.cnnAsOfUtc).toLocaleString("es-ES", {
                day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </div>
          )}
        </div>
      </div>
      {/* Market indicators behind the index — SAME data/calculation as "Master Indicators"
          (SPY removed, ordered HYG → MOVE → VIX → VVIX → TNX → LQD) */}
      {masterIndicators && masterIndicators.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", letterSpacing: "0.05em", marginBottom: 6, textTransform: "uppercase" }}>
            Indicadores de mercado
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {FG_INDICATOR_ORDER
              .map((symbol) => masterIndicators.find((ind) => ind.symbol === symbol))
              .filter((ind): ind is MasterIndicator => Boolean(ind))
              .map((ind) => <IndicatorRow key={ind.symbol} ind={ind} />)}
          </div>
        </div>
      )}
    </section>
  );
}
