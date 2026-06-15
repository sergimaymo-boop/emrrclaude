/**
 * Claude01Panel — Momentum Catalítico Adaptativo
 * ================================================
 * Módulo completamente independiente. No comparte estado ni efectos con ningún otro módulo.
 * Muestra: régimen de mercado (A/B/C/D) + tickers de FABLE01 en pullback sano + catalizadores
 * próximos (earnings) + Kelly sizing óptimo + señal de entrada.
 */
import { useEffect, useState } from "react";
import type { Claude01Item, Claude01Result } from "../services/claude01Refresh";
import { fetchClaude01, initialClaude01 } from "../services/claude01Refresh";

const ACCENT = "#22d3ee"; // cyan-400 — color distintivo de Claude01
const REFRESH_MS = 20 * 60_000; // 20 min

const MARKETS: Record<string, string> = {
  US: "NASDAQ/NYSE", XETRA: "Xetra", PA: "Euronext París", AS: "Euronext Ámst.",
  MI: "Borsa Italiana", SW: "SIX Suiza", LSE: "Londres", BR: "Euronext Brus.", LS: "Euronext Lisboa",
};
const tickerOf = (s: string) => s.replace(/\.[A-Z]+$/, "");
const marketOf = (s: string) => { const suf = s.split(".")[1] ?? ""; return MARKETS[suf] ?? suf ?? "NASDAQ/NYSE"; };
const fmt = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("es-ES", { timeZone: "Atlantic/Canary", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

// ─── Regime badge ──────────────────────────────────────────────────────────────

function RegimeBadge({ regime, label, color, description, actionBias, note, vix, hygHealth, spyVsEma200 }: {
  regime: string; label: string; color: string;
  description: string; actionBias: string; note: string;
  vix: number | null; hygHealth: string | null; spyVsEma200: string | null;
}) {
  return (
    <div style={{
      padding: "8px 14px", borderBottom: `1px solid ${color}33`,
      background: `${color}0a`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: `${color}20`, border: `1px solid ${color}55`,
          borderRadius: 6, padding: "2px 9px", fontSize: 10, fontWeight: 800, color,
        }}>
          <span style={{ fontSize: 11 }}>■</span>
          RÉGIMEN {regime} — {label}
        </span>
        {vix !== null && (
          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>VIX {fmt(vix, 1)}</span>
        )}
        {hygHealth && (
          <span style={{ fontSize: 9, fontWeight: 700, color: hygHealth === "SANO" ? "#10b981" : hygHealth === "DÉBIL" ? "#ef4444" : "#94a3b8" }}>
            HYG {hygHealth}
          </span>
        )}
        {spyVsEma200 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: spyVsEma200 === "SOBRE" ? "#10b981" : "#ef4444" }}>
            SPY {spyVsEma200} EMA200
          </span>
        )}
      </div>
      <div style={{ fontSize: 8.5, color, fontWeight: 700, marginTop: 4 }}>→ {actionBias}</div>
      <div style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>{note}</div>
    </div>
  );
}

// ─── Row de un ticker ──────────────────────────────────────────────────────────

function ItemRow({ item, isOpportunity }: { item: Claude01Item; isOpportunity: boolean }) {
  const signalColor = item.entrySignal === "BREAKOUT" ? "#10b981"
    : item.entrySignal === "ESPERANDO" ? "#f59e0b" : "#64748b";
  const signalLabel = item.entrySignal === "BREAKOUT" ? "✓ BREAKOUT"
    : item.entrySignal === "ESPERANDO" ? "⏳ ESPERA"
    : item.entrySignal === "EXTENDIDO" ? "↑ EXTENDIDO" : "—";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "22px 1fr 62px 46px 46px 78px 50px 76px",
      alignItems: "center", gap: 6,
      padding: "7px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      opacity: isOpportunity ? 1 : 0.6,
    }}>
      {/* Rank */}
      <span style={{ fontSize: 9, fontWeight: 700, color: isOpportunity ? ACCENT : "#475569", textAlign: "center" }}>
        {item.fable01Rank}
      </span>
      {/* Ticker + mercado + nombre */}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontWeight: 800, fontSize: 11.5, color: "#e2e8f0", flexShrink: 0 }}>{tickerOf(item.symbol)}</span>
          {isOpportunity && item.hasCatalyst && (
            <span style={{ fontSize: 7.5, color: "#f59e0b", fontWeight: 800, flexShrink: 0 }}>★ EARNINGS</span>
          )}
        </span>
        <span style={{ display: "block", fontSize: 7.5, color: ACCENT, fontWeight: 700, whiteSpace: "nowrap" }}>
          {marketOf(item.symbol)}
        </span>
        <span style={{ display: "block", fontSize: 7.5, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </span>
      </span>
      {/* Precio */}
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#cbd5e1", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {fmt(item.currentPrice)}
      </span>
      {/* Pullback */}
      <span style={{
        fontSize: 10, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums",
        color: item.inPullback ? "#fbbf24" : "#475569",
      }}>
        {item.pullbackPct != null ? `-${fmt(item.pullbackPct, 1)}%` : "—"}
      </span>
      {/* RSI */}
      <span style={{
        fontSize: 10, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums",
        color: item.rsiSane ? "#34d399" : item.rsi14 != null && item.rsi14 > 62 ? "#f87171" : "#64748b",
      }}>
        {item.rsi14 != null ? fmt(item.rsi14, 1) : "—"}
      </span>
      {/* Earnings */}
      <span style={{
        fontSize: 9, fontWeight: 700, textAlign: "center",
        color: item.hasCatalyst ? "#f59e0b" : "#3f4f64",
      }}>
        {item.hasCatalyst && item.earningsDaysAway != null
          ? `${item.earningsDaysAway}d ${item.earningsHour === "bmo" ? "🌅" : item.earningsHour === "amc" ? "🌙" : ""}`
          : "—"}
      </span>
      {/* Kelly */}
      <span style={{
        fontSize: 11, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums",
        color: item.kellySize > 0 ? ACCENT : "#3f4f64",
      }}>
        {item.kellySize > 0 ? `${item.kellySize}%` : "—"}
      </span>
      {/* Señal */}
      <span style={{
        fontSize: 8.5, fontWeight: 800, textAlign: "right",
        color: signalColor, whiteSpace: "nowrap",
      }}>
        {isOpportunity ? signalLabel : "—"}
      </span>
    </div>
  );
}

// ─── Panel principal ────────────────────────────────────────────────────────────

export function Claude01Panel() {
  const [data, setData] = useState<Claude01Result>(initialClaude01());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) setRefreshing(true);
    try {
      const result = await fetchClaude01(force);
      setData(result);
    } catch { /* mantiene estado actual */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const hasOpportunities = data.opportunities.length > 0;

  return (
    <section style={{
      marginBottom: 12, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${ACCENT}55`, background: `${ACCENT}08`,
      boxShadow: `0 0 22px ${ACCENT}1a, 0 2px 8px rgba(0,0,0,0.3)`,
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 14px", background: `${ACCENT}10`,
        borderBottom: `1px solid ${ACCENT}40`, gap: 8, flexWrap: "wrap",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT }}>
            ◆ CLAUDE01 · Momentum Catalítico Adaptativo
          </span>
          {data.ok && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              fontSize: 9, fontWeight: 700, color: data.color,
              background: `${data.color}18`, border: `1px solid ${data.color}44`,
              borderRadius: 5, padding: "1px 6px",
            }}>
              {data.regime}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8, color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
            🕐 {fmtTime(data.timestampUtc)} {data.fromCache ? "· cache" : ""}
          </span>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            style={{
              fontSize: 9, fontWeight: 700, padding: "3px 8px",
              borderRadius: 5, border: `1px solid ${ACCENT}44`,
              background: refreshing ? `${ACCENT}20` : "transparent",
              color: refreshing ? "#64748b" : ACCENT,
              cursor: refreshing ? "default" : "pointer",
              transition: "background 120ms",
            }}
          >
            {refreshing ? "…" : "↻ Actualizar"}
          </button>
        </span>
      </div>

      {/* ── Cargando ── */}
      {loading && (
        <div style={{ padding: "20px 14px", textAlign: "center", color: "#64748b", fontSize: 11 }}>
          <span style={{ color: ACCENT }}>⟳</span> Analizando régimen + pullbacks + catalizadores…
        </div>
      )}

      {/* ── Sin datos de FABLE01 ── */}
      {!loading && !data.ok && (
        <div style={{ padding: "14px", fontSize: 11, color: "#64748b" }}>
          {data.message ?? "Ejecuta un SCAN completo para activar Claude01."}
        </div>
      )}

      {/* ── Contenido principal ── */}
      {!loading && data.ok && (
        <>
          {/* Régimen */}
          <RegimeBadge
            regime={data.regime}
            label={data.label}
            color={data.color}
            description={data.description}
            actionBias={data.actionBias}
            note={data.note}
            vix={data.vix}
            hygHealth={data.hygHealth}
            spyVsEma200={data.spyVsEma200}
          />

          {/* Leyenda columnas */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "22px 1fr 62px 46px 46px 78px 50px 76px",
            gap: 6, padding: "5px 14px 3px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}>
            {["#", "TICKER", "PRECIO", "PULL%", "RSI14", "EARNINGS", "KELLY", "SEÑAL"].map(h => (
              <span key={h} style={{ fontSize: 7.5, fontWeight: 700, color: "#475569", letterSpacing: "0.06em", textAlign: h === "#" ? "center" : h === "TICKER" ? "left" : "right", whiteSpace: "nowrap" }}>
                {h}
              </span>
            ))}
          </div>

          {/* Oportunidades activas */}
          {hasOpportunities && (
            <div style={{ padding: "0 14px" }}>
              <div style={{ fontSize: 8, fontWeight: 800, color: ACCENT, letterSpacing: "0.1em", padding: "5px 0 2px", textTransform: "uppercase" }}>
                ▸ OPORTUNIDADES ACTIVAS — pullback sano en tendencia alcista
              </div>
              {data.opportunities.map(item => (
                <ItemRow key={item.symbol} item={item} isOpportunity />
              ))}
            </div>
          )}

          {/* Vigilando */}
          {data.watching.length > 0 && (
            <div style={{ padding: "0 14px" }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: "#475569", letterSpacing: "0.1em", padding: "5px 0 2px", textTransform: "uppercase" }}>
                ▸ EN SEGUIMIENTO — tendencia sana, aún no en pullback de entrada
              </div>
              {data.watching.map(item => (
                <ItemRow key={item.symbol} item={item} isOpportunity={false} />
              ))}
            </div>
          )}

          {/* Sin oportunidades */}
          {!hasOpportunities && data.watching.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 10, color: "#64748b" }}>
              Sin datos — ejecuta un SCAN para calcular FABLE01 y activar Claude01.
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ fontSize: 7.5, color: "#374151", padding: "4px 14px 8px", lineHeight: 1.45 }}>
            Kelly sizing = posicionamiento óptimo según régimen + catalizador + calidad del pullback.
            Pullback óptimo: 4-22% desde máximo 60 sesiones, RSI 32-62, EMA50 &gt; EMA200.
            Breakout = cierre sobre máximo de las últimas 3 velas.{" "}
            <b style={{ color: "#475569" }}>Ideas de análisis, NO señal de compra. No es asesoramiento financiero.</b>
          </div>
        </>
      )}
    </section>
  );
}
