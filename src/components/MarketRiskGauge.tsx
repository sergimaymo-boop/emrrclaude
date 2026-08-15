/**
 * MarketRiskGauge — SEMÁFORO DE RIESGO EN TIEMPO REAL.
 * Banner en lo MÁS ALTO del dashboard: "¿es un momento seguro para entrar HOY?".
 * Mide el estrés ACTUAL (VIX + crédito/bonos), no predice dirección. Validado por backtest.
 */
import type { MarketRisk } from "../services/marketRiskRefresh";
import { useIsNarrow } from "../hooks/useIsNarrow";

const EMOJI: Record<string, string> = { BAJO: "🟢", MEDIO: "🟡", ALTO: "🔴", UNKNOWN: "⚪" };

export function MarketRiskGauge({ risk }: { risk: MarketRisk }) {
  const isNarrow = useIsNarrow(560);
  const accent = risk.color ?? "#64748b";
  const fmt = (v: number | null | undefined, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");
  const fmtPc = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—");

  return (
    <section style={{
      marginBottom: 14, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${accent}66`, background: `${accent}12`,
      boxShadow: `0 0 20px ${accent}22, 0 2px 8px rgba(0,0,0,0.3)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", background: `${accent}1a`, borderBottom: `1px solid ${accent}44` }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: accent }}>
          ⚡ Riesgo de mercado · HOY
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8" }}>tiempo real · no predice dirección</span>
      </div>

      <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", alignItems: isNarrow ? "stretch" : "center", gap: isNarrow ? 10 : 18, padding: "12px 16px" }}>
        {/* Semáforo + nivel */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 32, lineHeight: 1 }}>{EMOJI[risk.level] ?? "⚪"}</span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: accent, lineHeight: 1.05 }}>
              RIESGO {risk.level === "UNKNOWN" ? "—" : risk.level}
            </div>
            <div style={{ fontSize: 10.5, color: "#cbd5e1", marginTop: 3 }}>{risk.label}</div>
          </div>
        </div>

        {/* Dato validado + VIX */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#e2e8f0", lineHeight: 1.5 }}>
            {risk.sharpDropProb != null ? (
              <>A este nivel, históricamente <b style={{ color: accent }}>~{risk.sharpDropProb}%</b> de los días sufren una <b>caída brusca (&gt;3%) en 5 días</b>.</>
            ) : "Esperando datos de volatilidad…"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
            <Chip label="VIX" value={`${fmt(risk.vix)} (${fmtPc(risk.vixChange)})`} tone={accent} />
            <Chip label="MOVE (bonos)" value={fmt(risk.context.move, 1)} />
            <Chip label="Crédito HY" value={fmtPc(risk.context.hygChange)} tone={typeof risk.context.hygChange === "number" ? (risk.context.hygChange < -0.5 ? "#f87171" : "#94a3b8") : "#94a3b8"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Chip({ label, value, tone = "#94a3b8" }: { label: string; value: string; tone?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 5, padding: "2px 8px" }}>
      <span style={{ color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</span>
      <span style={{ color: tone, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}
