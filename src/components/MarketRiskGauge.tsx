/**
 * MarketRiskGauge — SEMÁFORO DE RIESGO DE MERCADO EN TIEMPO REAL.
 * Responde "¿cuánto riesgo de caída brusca hay HOY?" (VIX + crédito/bonos), NO "¿es buen momento
 * para entrar?": no predice dirección ni da señales de entrada o espera. Textos y cifras salen del
 * backtest 1990-2026 (backtests/vix-risk-2026-09-25.json) vía marketRiskRefresh.ts.
 */
import { type MarketRisk, VIX_RISK_EVIDENCE } from "../services/marketRiskRefresh";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { isMarketOpen } from "../utils/marketHours";
import { formatShortTime } from "../services/realDataRefresh";

const EMOJI: Record<string, string> = { BAJO: "🟢", MEDIO: "🟡", ALTO: "🔴", UNKNOWN: "⚪" };
const pctEs = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const EV = VIX_RISK_EVIDENCE;
const SCALE_NOTE =
  `Escala propia de este semáforo (VIX <16 / 16-21 / ≥21 → caída >3% en 5 sesiones el ~${EV.zones.BAJO.sharpDropProb}% / ` +
  `~${EV.zones.MEDIO.sharpDropProb}% / ~${EV.zones.ALTO.sharpDropProb}% de los días, ${EV.index} ${EV.period}), ` +
  "distinta de la fila VIX de Indicadores (<15 / 15-20 / >20). Datos históricos, no una promesa.";

export function MarketRiskGauge({ risk }: { risk: MarketRisk }) {
  const isNarrow = useIsNarrow(560);
  const accent = risk.color ?? "#64748b";
  const fmt = (v: number | null | undefined, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");
  const fmtPc = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
  const usOpen = isMarketOpen("United States") === "OPEN";
  const hasData = risk.loadState === "OK";
  const freshness = !hasData
    ? risk.loadState === "LOADING" ? "cargando…" : "sin dato"
    : risk.refreshFailed
      ? `SIN ACTUALIZAR · dato de ${formatShortTime(risk.fetchedAtUtc)}`
      : usOpen ? "en vivo" : "mercado cerrado · último cierre";

  return (
    <section style={{
      marginBottom: 14, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${accent}66`, background: `${accent}12`,
      boxShadow: `0 0 20px ${accent}22, 0 2px 8px rgba(0,0,0,0.3)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", background: `${accent}1a`, borderBottom: `1px solid ${accent}44` }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: accent }}>
          ⚡ Riesgo de mercado · {usOpen ? "HOY" : "ÚLTIMO CIERRE"}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: risk.refreshFailed ? "#eab308" : "#94a3b8", textAlign: "right" }}>{freshness} · no predice dirección</span>
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
              <>{EV.index} {EV.period}: a este nivel de VIX, en el <b style={{ color: accent }}>~{risk.sharpDropProb}%</b> de los días hubo una <b>caída de más del 3%</b> en algún momento de las 5 sesiones siguientes.</>
            ) : risk.loadState === "LOADING" ? "Esperando datos de volatilidad…" : "Sin dato de volatilidad: la fuente no respondió."}
          </div>
          {risk.dip20Typical != null && risk.dip20OneInTen != null && (
            <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45, marginTop: 3 }}>
              Tras entrar, la caída máxima en las 20 sesiones siguientes fue típicamente del <b>{pctEs(risk.dip20Typical)}</b> y 1 de cada 10 veces superó el <b>{pctEs(risk.dip20OneInTen)}</b>.
            </div>
          )}
          {risk.advice && (
            <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45, marginTop: 3 }}>{risk.advice}</div>
          )}
          <div style={{ fontSize: 8.5, color: "#64748b", marginTop: 4, lineHeight: 1.4 }}>{SCALE_NOTE}</div>
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
