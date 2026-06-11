/**
 * MarketBreadthPanel — VEREDICTO AGREGADO DE MERCADO (módulo independiente).
 *
 * Panel hero situado en lo MÁS ALTO del dashboard. Muestra el semáforo de amplitud
 * (🟢 alcista / 🟡 deterioro / 🔴 pullback inminente) calculado por el Market Breadth
 * Engine sobre TODO el universo escaneado. Aislado: su propio estado/fetch; no toca
 * ningún otro panel. Estilo Bloomberg, responsive.
 */
import { useState } from "react";
import type { MarketBreadthResult, RankTicker } from "../services/marketBreadthRefresh";
import { useIsNarrow } from "../hooks/useIsNarrow";

interface Props {
  breadth: MarketBreadthResult;
}

const fmtPc = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—");

// Watchlist de candidatos de rebote (sobreventa) — top 10 del factor model per-ticker.
// Edge MODESTO (~60%, IC ~0.01): screener, NO recomendación. Toggle lista simple / detalle
// desplegable por ticker.
function RankWatchlist({ tickers, horizon, baseUp, isNarrow }: {
  tickers: RankTicker[]; horizon?: number; baseUp?: number; isNarrow: boolean;
}) {
  const [simplified, setSimplified] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!tickers || tickers.length === 0) return null;

  const btn = {
    fontSize: 8.5, fontWeight: 700, color: "#94a3b8", background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "2px 8px", cursor: "pointer",
  } as const;

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "9px 14px 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: "#34d399", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          ★ Candidatos de rebote · top {tickers.length}
        </span>
        <button onClick={() => setSimplified((s) => !s)} style={btn}>
          {simplified ? "▤ Ver detalle" : "≡ Lista simple"}
        </button>
      </div>
      <div style={{ fontSize: 8, color: "#64748b", marginBottom: 7, lineHeight: 1.45 }}>
        Sesgo de sobreventa (mean-reversion) a ~{horizon ?? 60}d · prob. histórica ~{tickers[0]?.probUp ?? 60}% vs base {baseUp ?? 58}%.
        Edge modesto (screener, no recomendación de compra).
      </div>

      {tickers.map((t, i) => {
        const isOpen = open === t.symbol;
        return (
          <div key={t.symbol} style={{ marginBottom: simplified ? 0 : 2 }}>
            <div
              onClick={() => !simplified && setOpen((o) => (o === t.symbol ? null : t.symbol))}
              style={{
                display: "grid",
                gridTemplateColumns: simplified ? "20px 1fr 48px" : "20px 64px 1fr 52px 16px",
                alignItems: "center", gap: 7, padding: simplified ? "2px 0" : "5px 0",
                cursor: simplified ? "default" : "pointer",
                borderBottom: simplified ? "none" : "1px solid rgba(255,255,255,0.04)",
                fontSize: 11,
              }}
            >
              <span style={{ color: "#64748b", fontWeight: 700, fontSize: 9 }}>#{i + 1}</span>
              <span style={{ fontWeight: 800, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{t.symbol.replace(/\.[A-Z]+$/, "")}</span>
              {!simplified && (
                <span style={{ color: "#94a3b8", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {isNarrow ? "" : t.name}
                </span>
              )}
              <span style={{ fontWeight: 800, color: "#34d399", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>↑{t.probUp}%</span>
              {!simplified && <span style={{ color: "#64748b", fontSize: 9, textAlign: "center" }}>{isOpen ? "▲" : "▼"}</span>}
            </div>

            {!simplified && isOpen && (
              <div style={{
                display: "grid", gridTemplateColumns: isNarrow ? "repeat(2,1fr)" : "repeat(4,1fr)",
                gap: 1, background: "rgba(255,255,255,0.04)", margin: "2px 0 6px",
                borderRadius: 6, overflow: "hidden",
              }}>
                {([
                  ["Empresa", t.name], ["Último", t.features.lastClose ?? "—"],
                  ["Ret. 20d", fmtPc(t.features.ret20)], ["Ret. 60d", fmtPc(t.features.ret60)],
                  ["RSI 14", t.features.rsi14?.toFixed(0) ?? "—"], ["vs MA50", fmtPc(t.features.distMA50)],
                  ["vs MA200", fmtPc(t.features.distMA200)], ["Desde máx 52s", fmtPc(t.features.dist52H)],
                  ["Desde mín 52s", fmtPc(t.features.dist52L)], ["ATR diario", fmtPc(t.features.atrPct)],
                  ["Vol. relativo", t.features.rvol?.toFixed(2) ?? "—"], ["Tendencia fondo", t.features.aboveMA200 ? "Alcista ✓" : "Bajista"],
                ] as [string, string | number][]).map(([k, val]) => (
                  <div key={k} style={{ background: "rgba(15,23,42,0.55)", padding: "5px 8px" }}>
                    <div style={{ fontSize: 7.5, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const VERDICT_EMOJI: Record<string, string> = {
  BULLISH: "🟢",
  DETERIORATING: "🟡",
  PULLBACK_IMMINENT: "🔴",
  UNKNOWN: "⚪",
};
const VERDICT_TITLE: Record<string, string> = {
  BULLISH: "FAVORABLE",
  DETERIORATING: "NEUTRAL",
  PULLBACK_IMMINENT: "RIESGO CORRECCIÓN",
  UNKNOWN: "CALCULANDO",
};

// Modelo CONTRARIO (validado): las métricas son lecturas descriptivas, no señales de bueno/malo
// por sí mismas (amplitud muy alta = sobrecompra = riesgo). El veredicto sintetiza la dirección.
const METRIC_MUTED = "#cbd5e1";

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
    { label: "Sobre MA50", value: ind.pctAboveMA50, unit: "%", tone: METRIC_MUTED },
    { label: "Sobre MA200", value: ind.pctAboveMA200, unit: "%", tone: METRIC_MUTED },
    { label: "Avances", value: ind.advancePct, unit: "%", tone: METRIC_MUTED },
    { label: "Nuevos máx", value: ind.newHighPct, unit: "%", tone: METRIC_MUTED },
    { label: "Nuevos mín", value: ind.newLowPct, unit: "%", tone: METRIC_MUTED },
    { label: "Distribución", value: ind.distributionPct, unit: "%", tone: METRIC_MUTED },
    { label: "Pendiente↑", value: ind.slopeUpPct, unit: "%", tone: METRIC_MUTED },
    { label: "McClellan", value: ind.mcclellan, unit: "", tone: METRIC_MUTED },
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
          ▦ Amplitud de Mercado · señal contraria
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", whiteSpace: "nowrap" }}>
          {breadth.sample?.analyzed != null ? `${breadth.sample.analyzed} tickers` : "—"}
          {breadth.horizonDays ? ` · proyección ~${breadth.horizonDays}d` : ""}
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

      {/* Watchlist — top-10 candidatos de rebote (factor model per-ticker) */}
      {breadth.topTickers && breadth.topTickers.length > 0 && (
        <RankWatchlist
          tickers={breadth.topTickers}
          horizon={breadth.rankHorizonDays}
          baseUp={breadth.rankBaseUp}
          isNarrow={isNarrow}
        />
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
