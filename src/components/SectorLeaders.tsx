import { useEffect, useState } from "react";
import type { SectorLeader } from "../types";

interface SectorData {
  symbol: string;
  name: string;
  market: string;
  performance5d: number;
  state: "LEADING" | "ACCELERATING" | "WEAKENING" | "FALLING";
}

interface SectorLeadersProps {
  sectors: SectorLeader[];
}

// Sort order: LEADING: 0, ACCELERATING: 1, WEAKENING: 2, FALLING: 3
const sectorStateOrder: Record<SectorData["state"], number> = {
  LEADING: 0,
  ACCELERATING: 1,
  WEAKENING: 2,
  FALLING: 3,
};

const stateColor: Record<SectorData["state"], string> = {
  LEADING:      "#10b981",
  ACCELERATING: "#34d399",
  WEAKENING:    "#f97316",
  FALLING:      "#ef4444",
};

const stateLabel: Record<SectorData["state"], string> = {
  LEADING:      "LÍDER",
  ACCELERATING: "ACELERANDO",
  WEAKENING:    "DEBILITANDO",
  FALLING:      "CAYENDO",
};

export function SectorLeaders({ sectors }: SectorLeadersProps) {
  const [data, setData] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sector-leaders-data")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.sectors) {
          const sorted = [...d.sectors].sort((first: SectorData & { performance: number }, second: SectorData & { performance: number }) => {
            // Normalize: use performance5d as performance for sort compatibility
            first.performance = first.performance ?? first.performance5d;
            second.performance = second.performance ?? second.performance5d;
            const stateDifference = sectorStateOrder[first.state] - sectorStateOrder[second.state];
            if (stateDifference !== 0) return stateDifference;
            return second.performance - first.performance;
          });
          setData(sorted);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <section className="section-block">
      <div className="section-title-row" style={{ marginBottom: 8 }}>
        <h2>Sectores Líderes</h2>
        <span style={{ fontSize: 10, color: "#64748b" }}>5 sesiones</span>
      </div>

      {loading && (
        <div style={{ fontSize: 11, color: "#475569", padding: "8px 0" }}>
          Cargando sectores…
        </div>
      )}

      {!loading && data.length === 0 && (
        <div style={{ fontSize: 11, color: "#475569", padding: "8px 0" }}>
          {/* Sector leadership unavailable — DATA UNAVAILABLE */}
          Sector leadership unavailable · DATA UNAVAILABLE
        </div>
      )}

      {data.slice(0, 6).map((s) => (
        <div
          key={s.symbol}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 8,
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#f1f5f9" }}>{s.symbol}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>{s.name}</span>
            <span style={{
              fontSize: 9, color: "#475569", marginLeft: 4,
              background: "rgba(255,255,255,0.05)",
              padding: "1px 4px", borderRadius: 3,
            }}>{s.market}</span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: s.performance5d >= 0 ? "#10b981" : "#ef4444",
          }}>
            {s.performance5d >= 0 ? "+" : ""}{s.performance5d.toFixed(2)}%
          </span>
          <span style={{
            fontSize: 8, fontWeight: 800, letterSpacing: "0.06em",
            color: stateColor[s.state],
            background: `${stateColor[s.state]}18`,
            border: `1px solid ${stateColor[s.state]}40`,
            borderRadius: 999,
            padding: "2px 6px",
          }}>
            {stateLabel[s.state]}
          </span>
        </div>
      ))}
    </section>
  );
}
