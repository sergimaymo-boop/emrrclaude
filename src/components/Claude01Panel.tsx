/**
 * Claude01Panel — Momentum Catalítico Adaptativo
 * Bloomberg-quality card layout: sin grids que se rompan en móvil,
 * tarjetas expandibles por ticker, jerarquía visual clara.
 */
import { useEffect, useState } from "react";
import type { Claude01Item, Claude01Result } from "../services/claude01Refresh";
import { fetchClaude01, initialClaude01 } from "../services/claude01Refresh";

const ACCENT = "#22d3ee";
const REFRESH_MS = 20 * 60_000;

const MARKETS: Record<string, string> = {
  US: "NASDAQ/NYSE", XETRA: "Xetra", PA: "Euronext París", AS: "Euronext Ámst.",
  MI: "Borsa Italiana", SW: "SIX Suiza", LSE: "Londres", BR: "Euronext Brus.", LS: "Euronext Lisboa",
};
const tickerOf = (s: string) => s.replace(/\.[A-Z]+$/, "");
const marketOf = (s: string) => { const suf = s.split(".")[1] ?? ""; return MARKETS[suf] ?? suf ?? "NASDAQ/NYSE"; };
const fmt = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";
const fmtPrice = (v: number | null | undefined) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(2) : v.toFixed(2);
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", {
      timeZone: "Atlantic/Canary", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ label, value, valueColor, bg }: { label: string; value: string; valueColor?: string; bg?: string }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: bg ?? "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 6, padding: "3px 8px",
    }}>
      <span style={{ fontSize: 8, fontWeight: 600, color: "#64748b", letterSpacing: "0.05em", textTransform: "uppercase" as const }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 800, color: valueColor ?? "#94a3b8", fontVariantNumeric: "tabular-nums" as const }}>{value}</span>
    </div>
  );
}

// ─── Regime section ───────────────────────────────────────────────────────────

function RegimeSection({ regime, label, color, actionBias, note, vix, hygHealth, spyVsEma200 }: {
  regime: string; label: string; color: string;
  actionBias: string; note: string;
  vix: number | null; hygHealth: string | null; spyVsEma200: string | null;
}) {
  const vixColor = vix === null ? "#64748b" : vix > 35 ? "#a78bfa" : vix > 28 ? "#ef4444" : vix > 20 ? "#f59e0b" : "#10b981";

  return (
    <div style={{ padding: "10px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" as const }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          background: `${color}15`, border: `1.5px solid ${color}45`,
          borderRadius: 8, padding: "5px 12px",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", background: color,
            display: "inline-block", flexShrink: 0,
            boxShadow: `0 0 6px ${color}80`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 900, color, letterSpacing: "0.06em" }}>
            RÉGIMEN {regime} — {label}
          </span>
        </div>
      </div>

      {/* Métricas */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
        {vix !== null && (
          <Chip label="VIX" value={fmt(vix, 1)} valueColor={vixColor} bg={`${vixColor}12`} />
        )}
        {hygHealth && (
          <Chip
            label="HYG"
            value={hygHealth}
            valueColor={hygHealth === "SANO" ? "#10b981" : hygHealth === "DÉBIL" ? "#ef4444" : "#94a3b8"}
          />
        )}
        {spyVsEma200 && (
          <Chip
            label="SPY/EMA200"
            value={spyVsEma200}
            valueColor={spyVsEma200 === "SOBRE" ? "#10b981" : spyVsEma200 === "BAJO" ? "#ef4444" : "#64748b"}
          />
        )}
      </div>

      {/* Action bias */}
      <div style={{ fontSize: 9.5, fontWeight: 800, color, letterSpacing: "0.04em", marginBottom: 3 }}>
        → {actionBias}
      </div>
      <div style={{ fontSize: 8.5, color: "#475569", lineHeight: 1.5 }}>{note}</div>
    </div>
  );
}

// ─── Detail row (for expanded card) ──────────────────────────────────────────

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, padding: "2px 0" }}>
      <span style={{ fontSize: 8.5, color: "#475569" }}>{label}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: color ?? "#94a3b8", fontVariantNumeric: "tabular-nums" as const }}>
        {value}
      </span>
    </div>
  );
}

// ─── Item card (ticker) ───────────────────────────────────────────────────────

function ItemCard({ item, isOpportunity }: { item: Claude01Item; isOpportunity: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const signalColor = item.entrySignal === "BREAKOUT" ? "#10b981"
    : item.entrySignal === "ESPERANDO" ? "#f59e0b" : "#64748b";
  const signalLabel = item.entrySignal === "BREAKOUT" ? "✓ BREAKOUT"
    : item.entrySignal === "ESPERANDO" ? "⏳ ESPERA"
    : item.entrySignal === "EXTENDIDO" ? "↑ EXTENDIDO" : "—";

  const rsiColor = item.rsiSane ? "#34d399"
    : item.rsi14 != null && item.rsi14 > 70 ? "#f87171"
    : item.rsi14 != null && item.rsi14 > 62 ? "#fb923c"
    : "#64748b";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(e => !e)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(v => !v); } }}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        borderLeft: isOpportunity ? `3px solid ${ACCENT}` : "3px solid transparent",
        padding: "10px 14px 10px 11px",
        opacity: isOpportunity ? 1 : 0.72,
        cursor: "pointer",
        userSelect: "none" as const,
        WebkitUserSelect: "none" as const,
        transition: "background 120ms",
      }}
    >
      {/* ── Fila principal ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>

        {/* Rank */}
        <div style={{
          minWidth: 18, fontSize: 9, fontWeight: 800,
          color: isOpportunity ? ACCENT : "#374151",
          marginTop: 3, flexShrink: 0, textAlign: "center" as const,
        }}>
          {item.fable01Rank}
        </div>

        {/* Ticker + market + name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#f1f5f9", letterSpacing: "0.02em" }}>
              {tickerOf(item.symbol)}
            </span>
            {/* Signal badge (solo para oportunidades) */}
            {isOpportunity && (
              <span style={{
                fontSize: 7.5, fontWeight: 800, color: signalColor,
                background: `${signalColor}18`, border: `1px solid ${signalColor}45`,
                borderRadius: 4, padding: "1px 6px", flexShrink: 0,
              }}>
                {signalLabel}
              </span>
            )}
            {/* Earnings badge */}
            {item.hasCatalyst && item.earningsDaysAway != null && (
              <span style={{
                fontSize: 7.5, fontWeight: 800, color: "#f59e0b",
                background: "#f59e0b18", border: "1px solid #f59e0b45",
                borderRadius: 4, padding: "1px 6px", flexShrink: 0,
              }}>
                ★ EARN {item.earningsDaysAway}d{item.earningsHour === "bmo" ? " 🌅" : item.earningsHour === "amc" ? " 🌙" : ""}
              </span>
            )}
          </div>
          {/* Market + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{
              fontSize: 7.5, fontWeight: 700, color: ACCENT,
              background: `${ACCENT}12`, borderRadius: 3, padding: "0px 5px",
              flexShrink: 0,
            }}>
              {marketOf(item.symbol)}
            </span>
            <span style={{
              fontSize: 8, color: "#374151",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
            }}>
              {item.name}
            </span>
          </div>
        </div>

        {/* Columna derecha: precio + métricas inline */}
        <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          {/* Precio */}
          <span style={{
            fontSize: 14, fontWeight: 800, color: "#e2e8f0",
            fontVariantNumeric: "tabular-nums" as const, letterSpacing: "-0.01em",
          }}>
            {fmtPrice(item.currentPrice)}
          </span>
          {/* Métricas secundarias */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Pullback */}
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: item.inPullback ? "#fbbf24" : "#374151",
              fontVariantNumeric: "tabular-nums" as const,
              background: item.inPullback ? "#fbbf2412" : "transparent",
              borderRadius: 3, padding: "0 3px",
            }}>
              {item.pullbackPct != null ? `-${fmt(item.pullbackPct, 1)}%` : "—"}
            </span>
            {/* RSI */}
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: rsiColor,
              fontVariantNumeric: "tabular-nums" as const,
              background: item.rsiSane ? "#34d39912" : "transparent",
              borderRadius: 3, padding: "0 3px",
            }}>
              {item.rsi14 != null ? `RSI ${fmt(item.rsi14, 1)}` : "—"}
            </span>
          </div>
          {/* Kelly (solo si aplica) */}
          {item.kellySize > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 900,
              color: ACCENT, background: `${ACCENT}18`,
              borderRadius: 4, padding: "1px 6px",
              letterSpacing: "0.04em",
            }}>
              KELLY {item.kellySize}%
            </span>
          )}
        </div>

        {/* Expand chevron */}
        <div style={{
          fontSize: 9, color: "#374151", marginTop: 4, flexShrink: 0,
          transform: expanded ? "rotate(180deg)" : "none",
          transition: "transform 150ms",
        }}>
          ▾
        </div>
      </div>

      {/* ── Panel expandido ── */}
      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10, paddingLeft: 26,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 20px",
          }}>
            <DetailRow label="Pullback desde máx. 60d" value={item.pullbackPct != null ? `-${fmt(item.pullbackPct, 1)}%` : "—"} color={item.inPullback ? "#fbbf24" : undefined} />
            <DetailRow label="RSI-14" value={item.rsi14 != null ? fmt(item.rsi14, 1) : "—"} color={rsiColor} />
            <DetailRow label="EMA 50" value={item.ema50 != null ? fmtPrice(item.ema50) : "—"} />
            <DetailRow label="EMA 200" value={item.ema200 != null ? fmtPrice(item.ema200) : "—"} />
            <DetailRow
              label="Uptrend (EMA50 › EMA200)"
              value={item.inUptrend ? "✓ SÍ" : "✗ NO"}
              color={item.inUptrend ? "#10b981" : "#ef4444"}
            />
            <DetailRow
              label="Señal de entrada"
              value={item.entrySignal === "SIN_DATOS" ? "—" : signalLabel}
              color={signalColor}
            />
            {item.hasCatalyst && item.earningsDate && (
              <DetailRow
                label={`Earnings (${item.earningsHour === "bmo" ? "pre-mkt" : item.earningsHour === "amc" ? "post-mkt" : "horario ?"})`}
                value={`${item.earningsDate} · ${item.earningsDaysAway}d`}
                color="#f59e0b"
              />
            )}
            {item.kellySize > 0 && (
              <DetailRow label="Kelly fraccional" value={`${item.kellySize}%`} color={ACCENT} />
            )}
            <DetailRow label="Score FABLE01" value={item.fable01Score != null ? fmt(item.fable01Score, 2) : "—"} />
            <DetailRow label="Rank FABLE01" value={`#${item.fable01Rank}`} />
          </div>
          <div style={{ fontSize: 7.5, color: "#374151", marginTop: 8, lineHeight: 1.5 }}>
            Toca de nuevo para cerrar. Pullback óptimo 4–22% · RSI 32–62 · EMA50 › EMA200.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label, count, accent }: { label: string; count: number; accent: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      padding: "7px 14px 5px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      background: `${accent}06`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, flexShrink: 0, boxShadow: `0 0 5px ${accent}` }} />
      <span style={{ fontSize: 8, fontWeight: 800, color: accent, letterSpacing: "0.1em", flex: 1 }}>
        {label}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 800, color: accent,
        background: `${accent}18`, border: `1px solid ${accent}40`,
        borderRadius: 10, padding: "0 7px",
      }}>
        {count}
      </span>
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export function Claude01Panel() {
  const [data, setData] = useState<Claude01Result>(initialClaude01());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) setRefreshing(true);
    try {
      const result = await fetchClaude01(force);
      setData(result);
    } catch { /* mantiene estado anterior */ }
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
  const hasWatching = data.watching.length > 0;

  return (
    <section style={{
      marginBottom: 12, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${ACCENT}40`,
      background: "linear-gradient(180deg, rgba(2,14,30,0.95) 0%, rgba(1,8,20,0.98) 100%)",
      boxShadow: `0 0 32px ${ACCENT}12, 0 4px 16px rgba(0,0,0,0.5)`,
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 14px",
        background: `linear-gradient(90deg, ${ACCENT}14 0%, transparent 70%)`,
        borderBottom: `1px solid ${ACCENT}30`,
        gap: 8, flexWrap: "wrap" as const,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: ACCENT, flexShrink: 0 }}>
            ◆ CLAUDE01
          </span>
          <span style={{ fontSize: 8, color: "#374151", fontWeight: 600, letterSpacing: "0.08em", flexShrink: 0 }}>
            MOMENTUM CATALÍTICO
          </span>
          {data.ok && (
            <span style={{
              fontSize: 10, fontWeight: 900, color: data.color,
              background: `${data.color}18`, border: `1px solid ${data.color}44`,
              borderRadius: 5, padding: "2px 8px", flexShrink: 0,
            }}>
              {data.regime}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 8, color: "#374151", fontVariantNumeric: "tabular-nums" as const }}>
            🕐 {fmtTime(data.timestampUtc)}{data.fromCache ? " · caché" : ""}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); load(true); }}
            disabled={refreshing || loading}
            style={{
              fontSize: 9, fontWeight: 700, padding: "3px 10px",
              borderRadius: 5, border: `1px solid ${ACCENT}40`,
              background: refreshing ? `${ACCENT}18` : "transparent",
              color: refreshing ? "#374151" : ACCENT,
              cursor: refreshing ? "default" : "pointer",
              transition: "background 120ms",
            }}
          >
            {refreshing ? "…" : "↻ Actualizar"}
          </button>
        </div>
      </div>

      {/* ── Cargando ── */}
      {loading && (
        <div style={{ padding: "28px 14px", textAlign: "center" as const, color: "#475569" }}>
          <div style={{ fontSize: 20, color: ACCENT, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 10 }}>Analizando régimen · pullbacks · catalizadores…</div>
        </div>
      )}

      {/* ── Sin datos de FABLE01 ── */}
      {!loading && !data.ok && (
        <div style={{
          padding: "20px 14px", textAlign: "center" as const,
          color: "#475569", fontSize: 11,
        }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>📊</div>
          {data.message ?? "Ejecuta un SCAN completo para activar Claude01."}
        </div>
      )}

      {/* ── Contenido principal ── */}
      {!loading && data.ok && (
        <>
          {/* Régimen */}
          <RegimeSection
            regime={data.regime}
            label={data.label}
            color={data.color}
            actionBias={data.actionBias}
            note={data.note}
            vix={data.vix}
            hygHealth={data.hygHealth}
            spyVsEma200={data.spyVsEma200}
          />

          {/* Stats resumen */}
          <div style={{
            display: "flex", gap: 6, padding: "7px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            flexWrap: "wrap" as const,
          }}>
            <Chip label="Analizados" value={String(data.totalAnalyzed)} />
            <Chip
              label="Oportunidades"
              value={String(data.opportunities.length)}
              valueColor={data.opportunities.length > 0 ? ACCENT : "#64748b"}
              bg={data.opportunities.length > 0 ? `${ACCENT}12` : undefined}
            />
            <Chip label="Vigilando" value={String(data.watching.length)} valueColor="#94a3b8" />
          </div>

          {/* OPORTUNIDADES ACTIVAS */}
          {hasOpportunities && (
            <div>
              <SectionHeader
                label="OPORTUNIDADES ACTIVAS — pullback sano en tendencia alcista"
                count={data.opportunities.length}
                accent={ACCENT}
              />
              {data.opportunities.map(item => (
                <ItemCard key={item.symbol} item={item} isOpportunity />
              ))}
            </div>
          )}

          {/* EN SEGUIMIENTO */}
          {hasWatching && (
            <div>
              <SectionHeader
                label="EN SEGUIMIENTO — tendencia sana, aún sin pullback de entrada"
                count={data.watching.length}
                accent="#475569"
              />
              {data.watching.map(item => (
                <ItemCard key={item.symbol} item={item} isOpportunity={false} />
              ))}
            </div>
          )}

          {/* Estado vacío */}
          {!hasOpportunities && !hasWatching && (
            <div style={{ padding: "16px 14px", fontSize: 10, color: "#64748b", textAlign: "center" as const }}>
              Sin datos — ejecuta un SCAN para calcular FABLE01 y activar Claude01.
            </div>
          )}

          {/* Disclaimer */}
          <div style={{
            fontSize: 7.5, color: "#2a3a4a", padding: "6px 14px 9px",
            borderTop: "1px solid rgba(255,255,255,0.04)", lineHeight: 1.55,
          }}>
            Kelly sizing: posicionamiento según régimen + catalizador + calidad del pullback.
            Pullback óptimo: 4–22% desde máx. 60 sesiones · RSI 32–62 · EMA50 › EMA200 · Breakout = cierre › máx. últimas 3 velas.
            Toca cualquier fila para ver el desglose completo.{" "}
            <span style={{ color: "#374151", fontWeight: 700 }}>
              Ideas de análisis, NO señal de compra. No es asesoramiento financiero.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
