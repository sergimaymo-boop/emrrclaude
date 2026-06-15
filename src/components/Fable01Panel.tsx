/**
 * Fable01Panel — "FABLE01" (módulo independiente, SEGUNDO del dashboard, tras FABLE 5).
 * Top-10 de SALUD DE TENDENCIA con ASIGNACIÓN DE CAPITAL concentrada (allocation %, suma 100)
 * + trailing por ticker (banda activa TR/TN/TA). Overlay blindado §8: cap blando, damping de
 * sobreextensión, colchón de caja en risk-off.
 * Badge de fiabilidad HONESTO cross-régimen (no inflado). Estilo Bloomberg, mejor → peor.
 * DOS líneas por ticker:
 *   a) rank · ticker · nombre · mercado · allocation % · % día · precio  (+ barra de peso)
 *   b) banda de trailing activa (stop % y precio) · niveles TR/TN/TA · RS60/pendiente
 */
import type { Fable01Result, Fable01Item } from "../services/fable01Refresh";
import { useIsNarrow } from "../hooks/useIsNarrow";

const ACCENT = "#a78bfa"; // violeta — distintivo FABLE01

const MARKETS: Record<string, string> = {
  US: "NASDAQ/NYSE", XETRA: "Xetra", PA: "Euronext París", AS: "Euronext Ámst.",
  MI: "Borsa Italiana", SW: "SIX Suiza", LSE: "Londres", BR: "Euronext Brus.", LS: "Euronext Lisboa",
};
const BANDS: Record<string, string> = { TR: "Reducido", TN: "Normal", TA: "Ampliado" };
const tickerOf = (s: string) => s.replace(/\.[A-Z]+$/, "");
const marketOf = (s: string) => { const suf = s.split(".")[1] ?? ""; return MARKETS[suf] ?? suf ?? "—"; };
const fmt = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const fmtPc = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const pcColor = (v: number | null | undefined) => (typeof v !== "number" ? "#94a3b8" : v > 0 ? "#34d399" : v < 0 ? "#f87171" : "#94a3b8");

// Color del badge por intervalos de fiabilidad del proyecto.
function badgeColor(b: number): string {
  if (b >= 66) return "#34d399";   // alta
  if (b >= 45) return "#fbbf24";   // media
  if (b >= 25) return "#fb923c";   // baja
  return "#f87171";                // muy baja
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", { timeZone: "Atlantic/Canary", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function Fable01Panel({ data, scanProgress }: { data: Fable01Result; scanProgress: number | null }) {
  const isNarrow = useIsNarrow(560);
  const items = data.items ?? [];
  const scanning = scanProgress !== null && scanProgress < 100;
  const badge = typeof data.badge === "number" ? data.badge : null;
  const oos = data.oos;
  const riskOn = data.regimeRiskOn !== false;
  const deploy = typeof data.deploymentPct === "number" ? data.deploymentPct : (riskOn ? 100 : 35);

  return (
    <section style={{
      marginBottom: 12, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${ACCENT}55`, background: `${ACCENT}0a`,
      boxShadow: `0 0 22px ${ACCENT}1f, 0 2px 8px rgba(0,0,0,0.3)`,
    }}>
      {/* Header con badge de fiabilidad */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 14px", background: `${ACCENT}12`, borderBottom: `1px solid ${ACCENT}40`, gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT }}>
            ◆ FABLE01 · salud de tendencia + capital
          </span>
          {badge !== null && (
            <span title="Fiabilidad honesta cross-régimen (backtest 5 años con costes, incl. bear 2022)" style={{
              display: "inline-flex", alignItems: "baseline", gap: 3, fontSize: 9, fontWeight: 800,
              color: badgeColor(badge), background: `${badgeColor(badge)}1f`, border: `1px solid ${badgeColor(badge)}66`,
              borderRadius: 5, padding: "1px 6px",
            }}>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{badge}</span>
              <span style={{ fontSize: 7, fontWeight: 700, opacity: 0.8 }}>/100 fiab.</span>
            </span>
          )}
        </span>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: "#94a3b8", whiteSpace: "nowrap" }}>
          {data.universeCount ? `${data.universeCount} analizados` : "—"} · 🕐 {fmtTime(data.cachedAtUtc)}
        </span>
      </div>

      {/* Banner de régimen / despliegue de capital (overlay blindado) */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
        padding: "5px 14px", fontSize: 9, fontWeight: 700,
        background: riskOn ? "#34d39912" : "#fb923c14", borderBottom: `1px solid ${riskOn ? "#34d39933" : "#fb923c33"}`,
      }}>
        <span style={{ color: riskOn ? "#34d399" : "#fb923c" }}>
          {riskOn ? "🟢 Régimen RISK-ON (SPY > EMA200)" : "🟠 Régimen RISK-OFF (SPY < EMA200) — colchón de caja"}
        </span>
        <span style={{ color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
          Desplegar <b style={{ color: riskOn ? "#34d399" : "#fb923c" }}>{deploy}%</b>{deploy < 100 ? ` · ${100 - deploy}% en caja` : ""}
        </span>
      </div>

      {/* Progresión de carga del scan */}
      {scanning && (
        <div style={{ padding: "8px 14px 4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT }}>⟳ Escaneando universo…</span>
            <span style={{ fontSize: 9, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{Math.round(scanProgress ?? 0)}%</span>
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, scanProgress ?? 0)}%`, height: "100%", background: ACCENT, borderRadius: 3, transition: "width 600ms ease" }} />
          </div>
        </div>
      )}

      {/* Disclaimer honesto — mecánica de ROTACIÓN (como se usa el módulo) */}
      <div style={{ fontSize: 8, color: "#64748b", padding: "6px 14px 2px", lineHeight: 1.45 }}>
        Top-10 con la tendencia más SANA del universo (RS vs SPY + pendiente + consistencia), con % de capital.
        Úsalo en <b style={{ color: "#94a3b8" }}>ROTACIÓN</b>: al saltar el trailing, rota al siguiente sano del scan.
        Validado así (rotación + costes, incl. bear 2022): <b style={{ color: "#94a3b8" }}>CAGR ~{oos?.cagr ?? "—"}%,
        drawdown ~{oos?.maxDD ?? "—"}%, gana al SPY {oos?.beatsSpy ?? "—"}, ~{oos?.tradesYr ?? "—"} trades/año</b>.
        Banda óptima <b style={{ color: "#a78bfa" }}>TN 3.5×</b> (más ajustado RESTA por costes). Win ~{oos?.winPos ?? "—"}%:
        el edge es la <b style={{ color: "#fb923c" }}>asimetría</b>, no acertar. Neto de impuestos/survivorship espera menos.
        <b style={{ color: "#94a3b8" }}> Fiabilidad honesta {badge ?? "—"}/100 (media). Ideas, NO señal de compra. No es asesoramiento financiero.</b>
      </div>

      {/* Leyenda trailing */}
      <div style={{ fontSize: 7.5, color: "#64748b", padding: "0 14px 4px", fontWeight: 700, letterSpacing: "0.03em" }}>
        Trailing: TR=Reducido (3.0×ATR) · <b style={{ color: "#a78bfa" }}>TN=Normal (3.5×ATR) ★ óptima</b> · TA=Ampliado (4.5×ATR) — cada ticker muestra su banda activa.
      </div>

      {items.length === 0 && !scanning ? (
        <div style={{ padding: "14px", fontSize: 11, color: "#94a3b8" }}>
          Sin datos aún — ejecuta un SCAN para calcular FABLE01.
        </div>
      ) : (
        <div style={{ padding: "4px 14px 8px" }}>
          {items.map((t: Fable01Item) => (
            <div key={t.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "6px 0" }}>
              {/* Línea a) rank · ticker · nombre · allocation% · % día · precio */}
              <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 56px 58px 66px", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#64748b", fontWeight: 700, fontSize: 9 }}>{t.rank}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 800, color: "#e2e8f0", fontSize: 12 }}>{tickerOf(t.symbol)}</span>
                  <span style={{ color: "#94a3b8", fontSize: 9, marginLeft: 6 }}>
                    {isNarrow ? "" : `score ${t.score}`}
                  </span>
                  <span style={{ display: "block", color: "#94a3b8", fontSize: 8.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.name} · {marketOf(t.symbol)}
                  </span>
                </span>
                <span style={{ textAlign: "right", fontWeight: 800, fontSize: 12.5, color: t.allocationPct > 0 ? ACCENT : "#475569", fontVariantNumeric: "tabular-nums" }}>
                  {t.allocationPct}%
                </span>
                <span style={{ textAlign: "right", fontWeight: 800, fontSize: 11, color: pcColor(t.pctDay), fontVariantNumeric: "tabular-nums" }}>
                  {fmtPc(t.pctDay)}
                </span>
                <span style={{ textAlign: "right", fontWeight: 700, fontSize: 11, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(t.price)}
                </span>
              </div>
              {/* Barra de peso de asignación */}
              <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", margin: "4px 0 4px 24px" }}>
                <div style={{ width: `${Math.min(100, t.allocationPct)}%`, height: "100%", background: ACCENT, opacity: t.allocationPct > 0 ? 0.85 : 0 }} />
              </div>
              {/* Línea b) banda activa + niveles + contexto */}
              <div style={{ display: "flex", gap: 6, marginLeft: 24, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{
                  display: "inline-flex", alignItems: "baseline", gap: 4, fontSize: 9,
                  background: `${ACCENT}1a`, border: `1px solid ${ACCENT}55`, borderRadius: 5, padding: "2px 7px",
                }}>
                  <span style={{ color: ACCENT, fontWeight: 800, textTransform: "uppercase", fontSize: 8 }}>{t.trailingBand} {BANDS[t.trailingBand] ?? ""}</span>
                  <span style={{ color: "#fbbf24", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>−{fmt(t.trailingStopPct)}%</span>
                  <span style={{ color: "#64748b", fontSize: 8, fontVariantNumeric: "tabular-nums" }}>({fmt(t.trailingStopPrice)})</span>
                </span>
                {!isNarrow && t.trailingLevelsPct && (
                  <span style={{ color: "#475569", fontSize: 7.5, fontVariantNumeric: "tabular-nums" }}>
                    TR −{fmt(t.trailingLevelsPct.TR)}% · TN −{fmt(t.trailingLevelsPct.TN)}% · TA −{fmt(t.trailingLevelsPct.TA)}%
                  </span>
                )}
                <span style={{ color: "#64748b", fontSize: 8, marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                  RS60 {fmtPc(t.rs60)} · pend {fmt(t.slope20)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
