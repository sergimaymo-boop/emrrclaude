/**
 * LosEscogidosPanel — "LOS ESCOGIDOS" (módulo independiente, PRIMERO del dashboard).
 * Top-10 con mayor probabilidad alcista a 5 sesiones (~7 días), de TODO el universo US+EU,
 * calibrado por loop de optimización (reversal corto + suelo 52s + volatilidad, OOS).
 * Línea por ticker de mejor a peor: Nombre · Ticker · Mercado · Precio · %7d · Score.
 * Desplegable: 3 trailing stops (corto / neutro / ampliado). Estilo Bloomberg.
 */
import { useState } from "react";
import type { EscogidosResult, Escogido } from "../services/escogidosRefresh";
import { useIsNarrow } from "../hooks/useIsNarrow";

const ACCENT = "#a78bfa"; // lila — distintivo del módulo

const MARKETS: Record<string, string> = {
  US: "NASDAQ/NYSE", XETRA: "Xetra", PA: "Euronext París", AS: "Euronext Ámst.",
  MI: "Borsa Italiana", SW: "SIX Suiza", LSE: "Londres", BR: "Euronext Brus.", LS: "Euronext Lisboa",
};
const tickerOf = (s: string) => s.replace(/\.[A-Z]+$/, "");
const marketOf = (s: string) => { const suf = s.split(".")[1] ?? ""; return MARKETS[suf] ?? suf ?? "—"; };
const fmt = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const fmtPc = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
const pcColor = (v: number | null | undefined) => (typeof v !== "number" ? "#94a3b8" : v > 0 ? "#34d399" : v < 0 ? "#f87171" : "#94a3b8");

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", { timeZone: "Atlantic/Canary", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function LosEscogidosPanel({ data }: { data: EscogidosResult }) {
  const isNarrow = useIsNarrow(560);
  const [open, setOpen] = useState<string | null>(null);
  const items = data.items ?? [];

  return (
    <section style={{
      marginBottom: 12, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${ACCENT}55`, background: `${ACCENT}0d`,
      boxShadow: `0 0 22px ${ACCENT}1f, 0 2px 8px rgba(0,0,0,0.3)`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 14px", background: `${ACCENT}14`, borderBottom: `1px solid ${ACCENT}40`, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT }}>
          ✦ Los Escogidos · próx. ~7 días
        </span>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: "#94a3b8", whiteSpace: "nowrap" }}>
          {data.universeCount ? `${data.universeCount} analizados` : "—"} · 🕐 {fmtTime(data.cachedAtUtc)}
        </span>
      </div>

      <div style={{ fontSize: 8, color: "#64748b", padding: "6px 14px 2px", lineHeight: 1.45 }}>
        Top-10 con mayor prob. de subir a 5 sesiones (~7 días) sobre todo el universo US+EU. Señal de rebote
        (sobreventa de muy corto plazo), validada por loop: win ~55% vs base 53% — edge pequeño, el horizonte más
        difícil. <b style={{ color: "#94a3b8" }}>Entrar SIEMPRE con trailing stop (desplegable).</b>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "14px", fontSize: 11, color: "#94a3b8" }}>
          Sin datos aún — ejecuta un SCAN para calcular Los Escogidos.
        </div>
      ) : (
        <div style={{ padding: "4px 14px 8px" }}>
          {/* Cabecera de columnas */}
          <div style={{
            display: "grid", gridTemplateColumns: "18px 1fr 56px 62px 40px",
            gap: 6, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.10)",
            fontSize: 7.5, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em",
          }}>
            <span>#</span><span>Ticker · Mercado</span>
            <span style={{ textAlign: "right" }}>% 7 días</span>
            <span style={{ textAlign: "right" }}>Precio</span>
            <span style={{ textAlign: "right" }}>Score</span>
          </div>

          {items.map((t: Escogido) => {
            const isOpen = open === t.symbol;
            return (
              <div key={t.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div
                  onClick={() => setOpen((o) => (o === t.symbol ? null : t.symbol))}
                  style={{
                    display: "grid", gridTemplateColumns: "18px 1fr 56px 62px 40px",
                    alignItems: "center", gap: 6, padding: "5px 0", cursor: "pointer",
                  }}
                >
                  <span style={{ color: "#64748b", fontWeight: 700, fontSize: 9 }}>{t.rank}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 800, color: "#e2e8f0", fontSize: 12 }}>{tickerOf(t.symbol)}</span>
                    <span style={{ display: "block", color: "#94a3b8", fontSize: 8.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name} · {marketOf(t.symbol)}
                    </span>
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 800, fontSize: 11, color: pcColor(t.ret7d), fontVariantNumeric: "tabular-nums" }}>
                    {fmtPc(t.ret7d)}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 700, fontSize: 11, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                    {fmt(t.price)}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 800, fontSize: 11, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(t.score)}<span style={{ color: "#475569", fontSize: 8, marginLeft: 2 }}>{isOpen ? "▲" : "▼"}</span>
                  </span>
                </div>

                {isOpen && (
                  <div style={{ padding: "2px 0 8px" }}>
                    <div style={{ fontSize: 7.5, fontWeight: 800, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.05em", margin: "2px 0 4px" }}>
                      Trailing stops (ATR) — entrar siempre con stop
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "rgba(255,255,255,0.04)", borderRadius: 6, overflow: "hidden", marginBottom: 6 }}>
                      {([["Corto", t.trailing?.corto], ["Neutro", t.trailing?.neutro], ["Ampliado", t.trailing?.ampliado]] as const).map(([k, lvl]) => (
                        <div key={k} style={{ background: "rgba(15,23,42,0.6)", padding: "5px 8px" }}>
                          <div style={{ fontSize: 7.5, color: "#64748b", textTransform: "uppercase" }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24", fontVariantNumeric: "tabular-nums" }}>−{fmt(lvl?.pct)}%</div>
                          <div style={{ fontSize: 8.5, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>stop {fmt(lvl?.price)}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 1, background: "rgba(255,255,255,0.04)", borderRadius: 6, overflow: "hidden" }}>
                      {([
                        ["Prob. subida ~7d", `${t.probUp}% (base ${data.baseUp ?? 53}%)`],
                        ["RSI 3 días", fmt(t.rsi3, 0)],
                        ["Racha de caídas", `${t.downStreak} sesiones`],
                        ["Señal", "Rebote sobreventa"],
                      ] as [string, string][]).map(([k, val]) => (
                        <div key={k} style={{ background: "rgba(15,23,42,0.55)", padding: "5px 8px" }}>
                          <div style={{ fontSize: 7, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>{k}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
