/**
 * SP500Panel — módulo INDEPENDIENTE dedicado en exclusiva al S&P 500.
 *
 * No comparte estado, claves de almacenamiento ni endpoints con OPTIMAL SUPREME.
 * Responde a una sola pregunta: ¿cuánto capital tengo hoy en el S&P 500, y qué
 * tiene que pasar para que entre o salga?
 *
 * Estética terminal ámbar, cifras tabulares, pensado para leerse de un vistazo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import {
  type Sp500Profile,
  type Sp500Settings,
  type Sp500Signal,
  buildSp500Order,
  clearSp500Settings,
  defaultSp500Settings,
  fetchSp500Signal,
  loadSp500Settings,
  saveSp500Settings,
} from "../services/sp500Refresh";

const AMBER = "#f59e0b";
const GREEN = "#22c55e";
const RED = "#ef4444";
const SLATE = "#94a3b8";

const PROFILE_ORDER: Sp500Profile[] = ["PRUDENTE", "EQUILIBRADO", "AMBICIOSO", "AGRESIVO"];

const eur = (v: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const pct = (v: number | null | undefined, d = 1) => (typeof v === "number" ? `${v.toFixed(d)}%` : "—");
const signed = (v: number | null | undefined, d = 1) =>
  typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—";

export function SP500Panel() {
  const isNarrow = useIsNarrow(680);
  const [settings, setSettings] = useState<Sp500Settings>(() => loadSp500Settings());
  const [signal, setSignal] = useState<Sp500Signal>({ ok: false });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (profile: Sp500Profile, force = false) => {
    setLoading(true);
    try {
      setSignal(await fetchSp500Signal(profile, force));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(settings.profile);
  }, [load, settings.profile]);

  const update = useCallback((patch: Partial<Sp500Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSp500Settings(next);
      return next;
    });
  }, []);

  const order = useMemo(
    () => buildSp500Order(signal, settings.capital, settings.invested),
    [signal, settings.capital, settings.invested],
  );

  const inMarket = signal.regime === "DENTRO";
  const accent = !signal.ok ? SLATE : inMarket ? GREEN : RED;

  // Los datos son de cierre diario: avisamos si el último cierre tiene más de 4 días.
  const staleDays = signal.asOf ? Math.floor((Date.now() - Date.parse(`${signal.asOf}T21:00:00Z`)) / 86400000) : null;
  const isStale = staleDays != null && staleDays > 4;

  return (
    <section
      style={{
        marginBottom: 14,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${AMBER}55`,
        background: "#07090d",
        boxShadow: `0 0 20px ${AMBER}18, 0 2px 8px rgba(0,0,0,0.35)`,
      }}
    >
      {/* Cabecera */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "7px 14px", background: `${AMBER}14`, borderBottom: `1px solid ${AMBER}44`, flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: AMBER }}>
          📈 S&amp;P 500 · entradas y salidas
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b" }}>módulo independiente · no cruza datos con SUPREME</span>
          <button
            onClick={() => void load(settings.profile, true)}
            disabled={loading}
            style={{
              fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 5, cursor: loading ? "wait" : "pointer",
              background: `${AMBER}22`, border: `1px solid ${AMBER}66`, color: AMBER,
            }}
          >
            {loading ? "…" : "⟳ Recalcular"}
          </button>
        </span>
      </div>

      {/* Estado de error */}
      {!signal.ok && (
        <div style={{ padding: "16px 16px", fontSize: 11.5, color: "#cbd5e1" }}>
          {loading ? "Calculando la señal del S&P 500…" : (
            <>
              <div style={{ color: RED, fontWeight: 800, marginBottom: 4 }}>Sin señal disponible</div>
              <div>{signal.message ?? "El módulo aún no ha podido calcular la señal."}</div>
            </>
          )}
        </div>
      )}

      {signal.ok && (
        <>
          {isStale && (
            <div style={{ padding: "6px 14px", background: `${RED}1a`, borderBottom: `1px solid ${RED}44`, fontSize: 10, fontWeight: 800, color: RED }}>
              ⚠ Último cierre disponible: {signal.asOf} ({staleDays} días). Los datos no están al día — no operes con esta señal hasta recalcular.
            </div>
          )}

          {/* Bloque principal: semáforo + cuánto invertir */}
          <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", gap: isNarrow ? 12 : 20, padding: "14px 16px", alignItems: isNarrow ? "stretch" : "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <span style={{ fontSize: 30, lineHeight: 1 }}>{inMarket ? "🟢" : "🔴"}</span>
              <div>
                <div style={{ fontSize: 19, fontWeight: 900, color: accent, lineHeight: 1.05 }}>{signal.regime}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                  {signal.regimeConfirmed ? "señal confirmada" : "cambio sin confirmar — se mantiene la posición"}
                </div>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 34, fontWeight: 900, color: AMBER, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {pct(signal.exposurePct, 0)}
                </span>
                <span style={{ fontSize: 11.5, color: "#e2e8f0" }}>del capital del módulo, invertido en el S&amp;P 500</span>
              </div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, signal.exposurePct ?? 0)}%`, height: "100%", background: `linear-gradient(90deg, ${AMBER}, ${AMBER}aa)` }} />
              </div>
              <div style={{ fontSize: 10.5, color: "#cbd5e1", marginTop: 7 }}>{signal.regimeReason}</div>
            </div>
          </div>

          {/* Oportunidad de retroceso */}
          {signal.pullbackOpen && (
            <div style={{ margin: "0 16px 12px", padding: "8px 12px", borderRadius: 8, background: `${GREEN}14`, border: `1px solid ${GREEN}55`, fontSize: 11, color: "#dcfce7" }}>
              ⚡ <b>Retroceso aprovechable</b> — {signal.pullbackReason}
            </div>
          )}

          {/* La orden concreta */}
          <div style={{ margin: "0 16px 12px", padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: SLATE }}>Qué hacer hoy</span>
              <button
                onClick={() => setEditing((v) => !v)}
                style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 5, cursor: "pointer", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: SLATE }}
              >
                ✎ capital
              </button>
            </div>

            {editing && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <NumField label="Capital del módulo (€)" value={settings.capital} onChange={(v) => update({ capital: v })} />
                <NumField label="Ya invertido (€)" value={settings.invested} onChange={(v) => update({ invested: v })} />
                <button
                  onClick={() => { clearSp500Settings(); setSettings(defaultSp500Settings); setEditing(false); }}
                  style={{ alignSelf: "flex-end", fontSize: 9, fontWeight: 800, padding: "5px 9px", borderRadius: 5, cursor: "pointer", background: `${RED}18`, border: `1px solid ${RED}55`, color: RED }}
                >
                  Limpiar
                </button>
              </div>
            )}

            {!order && (
              <div style={{ fontSize: 11, color: SLATE }}>
                Indica el capital que destinas a este módulo (botón ✎) y te doy el importe exacto a comprar o vender.
              </div>
            )}
            {order && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 13, fontWeight: 900, padding: "5px 12px", borderRadius: 6,
                  color: order.action === "COMPRAR" ? GREEN : order.action === "VENDER" ? RED : SLATE,
                  background: order.action === "COMPRAR" ? `${GREEN}18` : order.action === "VENDER" ? `${RED}18` : "rgba(255,255,255,0.05)",
                  border: `1px solid ${order.action === "COMPRAR" ? GREEN : order.action === "VENDER" ? RED : SLATE}55`,
                }}>
                  {order.action}
                  {order.delta !== 0 && ` ${eur(Math.abs(order.delta))}`}
                </span>
                <span style={{ fontSize: 11, color: "#cbd5e1" }}>{order.reason}</span>
                <span style={{ fontSize: 10, color: SLATE, fontVariantNumeric: "tabular-nums" }}>
                  objetivo {eur(order.targetAmount)} · ahora {eur(order.currentAmount)}
                </span>
              </div>
            )}
          </div>

          {/* Rejilla de datos */}
          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 1, background: "rgba(255,255,255,0.07)", margin: "0 16px 12px", borderRadius: 8, overflow: "hidden" }}>
            <Cell label="Índice" value={signal.price != null ? signal.price.toFixed(2) : "—"} />
            <Cell label="Momento 12 meses" value={signed(signal.momentum12mPct)} tone={(signal.momentum12mPct ?? 0) > 0 ? GREEN : RED} />
            <Cell label="Volatilidad actual" value={pct(signal.realizedVolPct)} hint={`objetivo ${pct(signal.volTargetPct, 0)}`} />
            <Cell label="Distancia a la salida" value={signed(signal.distanceToExitPct)} tone={(signal.distanceToExitPct ?? 0) > 10 ? GREEN : AMBER}
                  hint={signal.exitLevel != null ? `salida en ${signal.exitLevel.toFixed(0)}` : undefined} />
            <Cell label="Sobre media 200" value={signed(signal.distanceToTrendPct)} tone={(signal.distanceToTrendPct ?? 0) > 0 ? GREEN : RED} />
            <Cell label="RSI(2)" value={signal.rsi2 != null ? signal.rsi2.toFixed(0) : "—"} hint="< 5 = retroceso" />
            <Cell label="Próxima revisión" value={signal.nextReview ?? "—"} hint="lunes" />
            <Cell label="Datos al cierre" value={signal.asOf ?? "—"} hint={signal.dataProvider ?? undefined} />
          </div>

          {/* Perfil de riesgo */}
          <div style={{ margin: "0 16px 12px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: SLATE, marginBottom: 6 }}>
              Perfil de riesgo
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PROFILE_ORDER.map((p) => {
                const meta = signal.profiles?.[p];
                const active = settings.profile === p;
                return (
                  <button
                    key={p}
                    onClick={() => update({ profile: p })}
                    style={{
                      textAlign: "left", padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                      background: active ? `${AMBER}1e` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${active ? `${AMBER}88` : "rgba(255,255,255,0.10)"}`,
                      color: active ? AMBER : "#cbd5e1", minWidth: 104,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 800 }}>{meta?.label ?? p}</div>
                    <div style={{ fontSize: 9, color: active ? AMBER : SLATE, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                      {meta ? `${(meta.cagr * 100).toFixed(1)}%/año · caída ${(meta.maxDD * 100).toFixed(0)}%` : "—"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vehículos comprables */}
          {signal.vehicles && signal.vehicles.length > 0 && (
            <div style={{ margin: "0 16px 12px" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: SLATE, marginBottom: 6 }}>
                Con qué comprarlo desde IBK España
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {signal.vehicles.map((v) => (
                  <span key={v.ticker} title={`${v.note} · ISIN ${v.isin}`}
                    style={{ fontSize: 9.5, padding: "4px 9px", borderRadius: 5, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.11)", color: "#cbd5e1" }}>
                    <b style={{ color: AMBER }}>{v.ticker}</b> · {v.exchange} {v.currency} · {v.type} · TER {(v.ter * 100).toFixed(2)}%
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 5 }}>
                La normativa PRIIPs impide a un minorista europeo comprar SPY, VOO o UPRO: por eso el módulo solo propone equivalentes UCITS.
              </div>
            </div>
          )}

          {/* Referencia del backtest */}
          {signal.backtest && (
            <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 9.5, color: "#64748b", lineHeight: 1.6 }}>
              Validado en <b style={{ color: SLATE }}>{signal.backtest.period}</b>: esta regla dio{" "}
              <b style={{ color: AMBER }}>{(signal.backtest.core.cagr * 100).toFixed(1)}%</b> anual con una caída máxima del{" "}
              <b style={{ color: AMBER }}>{(signal.backtest.core.maxDD * 100).toFixed(0)}%</b>, frente a{" "}
              {(signal.backtest.buyHold.cagr * 100).toFixed(1)}% y caída del {(signal.backtest.buyHold.maxDD * 100).toFixed(0)}% de comprar y mantener.
              Rentabilidad pasada; no garantiza la futura.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Cell({ label, value, hint, tone = "#e2e8f0" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div style={{ background: "#07090d", padding: "8px 10px" }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 8.5, color: "#475569", marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(e.target.value === "" || !Number.isFinite(n) ? null : n);
        }}
        style={{
          width: 130, fontSize: 12, fontWeight: 700, padding: "5px 8px", borderRadius: 5,
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", color: "#e2e8f0",
          fontVariantNumeric: "tabular-nums",
        }}
      />
    </label>
  );
}
