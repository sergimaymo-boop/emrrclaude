/**
 * Fable5Panel — "FABLE 5" (módulo independiente, PRIMERO del dashboard).
 * Top-10 de TENDENCIA ALCISTA LIMPIA sin pullback inminente, sobre todo el universo US+EU.
 * Calibrado por loop doble (señal + trailing stops) en 5 años OOS.
 * Estilo Bloomberg, ordenado de mejor a peor, DOS líneas por ticker:
 *   a) Nombre · ticker · mercado · % desde el último cierre · precio
 *   b) 3 trailing stops óptimos (ajustado 3×ATR / normal 4×ATR / ampliado 5×ATR)
 * Muestra progresión de carga durante el scan.
 */
import type { Fable5Result, Fable5Item } from "../services/fable5Refresh";
import { useIsNarrow } from "../hooks/useIsNarrow";

const ACCENT = "#22d3ee"; // cian — distintivo FABLE 5

const MARKETS: Record<string, string> = {
  US: "NASDAQ/NYSE", XETRA: "Xetra", PA: "Euronext París", AS: "Euronext Ámst.",
  MI: "Borsa Italiana", SW: "SIX Suiza", LSE: "Londres", BR: "Euronext Brus.", LS: "Euronext Lisboa",
};
const tickerOf = (s: string) => s.replace(/\.[A-Z]+$/, "");
const marketOf = (s: string) => { const suf = s.split(".")[1] ?? ""; return MARKETS[suf] ?? suf ?? "—"; };
const fmt = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const fmtPc = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const pcColor = (v: number | null | undefined) => (typeof v !== "number" ? "#94a3b8" : v > 0 ? "#34d399" : v < 0 ? "#f87171" : "#94a3b8");

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", { timeZone: "Atlantic/Canary", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function Fable5Panel({ data, scanProgress }: { data: Fable5Result; scanProgress: number | null }) {
  const isNarrow = useIsNarrow(560);
  const items = data.items ?? [];
  const scanning = scanProgress !== null && scanProgress < 100;

  return (
    <section style={{
      marginBottom: 12, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${ACCENT}55`, background: `${ACCENT}0a`,
      boxShadow: `0 0 22px ${ACCENT}1f, 0 2px 8px rgba(0,0,0,0.3)`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 14px", background: `${ACCENT}12`, borderBottom: `1px solid ${ACCENT}40`, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT }}>
          ◆ FABLE 5 · tendencia limpia
        </span>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: "#94a3b8", whiteSpace: "nowrap" }}>
          {data.universeCount ? `${data.universeCount} analizados` : "—"} · 🕐 {fmtTime(data.cachedAtUtc)}
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

      <div style={{ fontSize: 8, color: "#64748b", padding: "6px 14px 2px", lineHeight: 1.45 }}>
        Top-10 con la tendencia alcista más limpia (alineación de medias + pendiente + R² + consistencia),
        excluyendo blowoffs (pullback inminente). Validado en 5 años OOS: win ~{data.oosWin ?? 57}% a {data.horizon ?? 20} sesiones.
        <b style={{ color: "#94a3b8" }}> Entrar siempre con uno de los 3 trailing stops calibrados.</b>
      </div>

      {items.length === 0 && !scanning ? (
        <div style={{ padding: "14px", fontSize: 11, color: "#94a3b8" }}>
          Sin datos aún — ejecuta un SCAN para calcular FABLE 5.
        </div>
      ) : (
        <div style={{ padding: "4px 14px 8px" }}>
          {items.map((t: Fable5Item) => (
            <div key={t.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "6px 0" }}>
              {/* Línea a) Nombre · ticker · mercado · % día · precio */}
              <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 62px 70px", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#64748b", fontWeight: 700, fontSize: 9 }}>{t.rank}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 800, color: "#e2e8f0", fontSize: 12 }}>{tickerOf(t.symbol)}</span>
                  <span style={{ color: "#94a3b8", fontSize: 9, marginLeft: 6 }}>
                    {isNarrow ? "" : `score ${fmt(t.score, 2)}`}
                  </span>
                  <span style={{ display: "block", color: "#94a3b8", fontSize: 8.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.name} · {marketOf(t.symbol)}
                  </span>
                </span>
                <span style={{ textAlign: "right", fontWeight: 800, fontSize: 11.5, color: pcColor(t.pctDay), fontVariantNumeric: "tabular-nums" }}>
                  {fmtPc(t.pctDay)}
                </span>
                <span style={{ textAlign: "right", fontWeight: 700, fontSize: 11.5, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(t.price)}
                </span>
              </div>
              {/* Línea b) 3 trailing stops */}
              <div style={{ display: "flex", gap: 6, marginTop: 4, marginLeft: 24, flexWrap: "wrap" }}>
                {([["TR=", t.trailing?.ajustado], ["TN=", t.trailing?.normal], ["TA=", t.trailing?.ampliado]] as const).map(([k, lvl]) => (
                  <span key={k} style={{
                    display: "inline-flex", alignItems: "baseline", gap: 4, fontSize: 9,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 5, padding: "2px 7px",
                  }}>
                    <span style={{ color: "#64748b", fontWeight: 700, textTransform: "uppercase", fontSize: 7.5 }}>{k}</span>
                    <span style={{ color: "#fbbf24", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>−{fmt(lvl?.pct)}%</span>
                    <span style={{ color: "#64748b", fontSize: 8, fontVariantNumeric: "tabular-nums" }}>({fmt(lvl?.price)})</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
