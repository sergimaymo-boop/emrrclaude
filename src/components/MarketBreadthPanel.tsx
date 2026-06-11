/**
 * MarketBreadthPanel — VEREDICTO AGREGADO DE MERCADO (módulo independiente).
 *
 * Panel hero situado en lo MÁS ALTO del dashboard. Muestra el semáforo de amplitud
 * (🟢 alcista / 🟡 deterioro / 🔴 pullback inminente) calculado por el Market Breadth
 * Engine sobre TODO el universo escaneado. Aislado: su propio estado/fetch; no toca
 * ningún otro panel. Estilo Bloomberg, responsive.
 */
import type { MarketBreadthResult } from "../services/marketBreadthRefresh";
import { useIsNarrow } from "../hooks/useIsNarrow";

interface Props {
  breadth: MarketBreadthResult;
}

const VERDICT_EMOJI: Record<string, string> = {
  BULLISH: "🟢",
  DETERIORATING: "🟡",
  PULLBACK_IMMINENT: "🔴",
  UNKNOWN: "⚪",
};
const VERDICT_TITLE: Record<string, string> = {
  BULLISH: "ALCISTA",
  DETERIORATING: "DETERIORO",
  PULLBACK_IMMINENT: "PULLBACK INMINENTE",
  UNKNOWN: "CALCULANDO",
};

function metricTone(value: number, good: number, bad: number): string {
  // good >= → verde; bad <= → rojo; intermedio → ámbar
  if (value >= good) return "#34d399";
  if (value <= bad) return "#f87171";
  return "#eab308";
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", {
      timeZone: "Atlantic/Canary", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

export function MarketBreadthPanel({ breadth }: Props) {
  const isNarrow = useIsNarrow(560);
  const v = breadth.verdict ?? "UNKNOWN";
  const accent = breadth.color ?? "#64748b";
  const score = breadth.score;
  const ind = breadth.indicators;

  const metrics = ind ? [
    { label: "Sobre MA50", value: ind.pctAboveMA50, unit: "%", tone: metricTone(ind.pctAboveMA50, 60, 40) },
    { label: "Sobre MA200", value: ind.pctAboveMA200, unit: "%", tone: metricTone(ind.pctAboveMA200, 55, 40) },
    { label: "Avances", value: ind.advancePct, unit: "%", tone: metricTone(ind.advancePct, 55, 45) },
    { label: "Nuevos máx", value: ind.newHighPct, unit: "%", tone: metricTone(ind.newHighPct, 5, 0) },
    { label: "Nuevos mín", value: ind.newLowPct, unit: "%", tone: metricTone(10 - ind.newLowPct, 8, 4) },
    { label: "Distribución", value: ind.distributionPct, unit: "%", tone: metricTone(20 - ind.distributionPct, 12, 5) },
    { label: "Pendiente↑", value: ind.slopeUpPct, unit: "%", tone: metricTone(ind.slopeUpPct, 55, 40) },
    { label: "McClellan", value: ind.mcclellan, unit: "", tone: metricTone(ind.mcclellan, 0.1, -0.1) },
  ] : [];

  return (
    <section
      style={{
        marginBottom: 14,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${accent}55`,
        background: `${accent}0d`,
        boxShadow: `0 0 22px ${accent}1f, 0 2px 8px rgba(0,0,0,0.3)`,
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 14px", background: `${accent}14`, borderBottom: `1px solid ${accent}40`,
        gap: 8, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>
          ▦ Amplitud de Mercado
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", whiteSpace: "nowrap" }}>
          {breadth.sample?.analyzed != null ? `${breadth.sample.analyzed} tickers` : "—"}
          {breadth.activeMarkets?.length ? ` · ${breadth.activeMarkets.join("/")}` : ""}
        </span>
      </div>

      {/* Hero: semáforo + score */}
      <div style={{
        display: "flex", flexDirection: isNarrow ? "column" : "row",
        alignItems: isNarrow ? "stretch" : "center", gap: isNarrow ? 12 : 18, padding: "14px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 34, lineHeight: 1 }}>{VERDICT_EMOJI[v]}</span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, color: accent, lineHeight: 1.05, letterSpacing: "0.01em" }}>
              {VERDICT_TITLE[v]}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{breadth.label}</div>
          </div>
        </div>

        {/* Score + barra */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Score de amplitud
            </span>
            <span style={{ fontSize: 22, fontWeight: 900, color: accent, fontVariantNumeric: "tabular-nums" }}>
              {score != null ? `${score}/100` : "—"}
            </span>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%`, height: "100%", background: accent, borderRadius: 4, transition: "width 500ms ease" }} />
          </div>
          {/* Marcadores de umbral 50 / 70 */}
          <div style={{ position: "relative", height: 10, marginTop: 1, fontSize: 7, color: "#475569" }}>
            <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>50</span>
            <span style={{ position: "absolute", left: "70%", transform: "translateX(-50%)" }}>70</span>
          </div>
        </div>
      </div>

      {/* Grid de indicadores de amplitud */}
      {metrics.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
          gap: 1, background: "rgba(255,255,255,0.05)",
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}>
          {metrics.map((m) => (
            <div key={m.label} style={{ background: "rgba(15,23,42,0.55)", padding: "8px 10px" }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {m.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: m.tone, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                {Number.isFinite(m.value) ? m.value : "—"}{m.unit}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alertas tempranas */}
      {breadth.alerts && breadth.alerts.length > 0 && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(239,68,68,0.18)", background: "rgba(239,68,68,0.06)" }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            ⚠ Alertas tempranas
          </div>
          {breadth.alerts.map((a, i) => (
            <div key={i} style={{ fontSize: 10, color: "#fca5a5", lineHeight: 1.5 }}>• {a}</div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "5px 14px 7px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 9, color: "#475569" }}>
          {breadth.spyBullish === false ? "Régimen SPY bajista (techo aplicado)" : breadth.spyBullish === true ? "Régimen SPY alcista" : ""}
        </span>
        <span style={{ fontSize: 9, color: "#475569" }}>🕐 {fmtTime(breadth.cachedAtUtc)} (Canarias)</span>
      </div>
    </section>
  );
}
