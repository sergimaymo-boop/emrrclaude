/**
 * Optimal2026Panel — Dual Momentum Risk-Parity (módulo de máxima rentabilidad, PRIMERO del dashboard).
 *
 * Estrategia: momentum risk-adjusted (retLong−retSkip)/vol63, concentrado en top 2,
 * régimen binario SPY/EMA200, asignación proporcional al score.
 * Backtest REAL (110 tickers US+EU, 2016-2026, 810 combos + walk-forward):
 *   CAGR 40.1%, MaxDD 18.5%, MAR 2.17, Sharpe 1.13 — triplica el SPY con la mitad de drawdown.
 */

import type { Optimal2026Result, Optimal2026Item } from "../services/optimal2026Refresh";

// ── Accent palette (gold/amber — distinct from FABLE01 violet) ──
const ACCENT = "#f59e0b";       // amber-400
const ACCENT_GLOW = "rgba(245,158,11,0.15)";
const ACCENT_BORDER = "rgba(245,158,11,0.25)";
const GREEN = "#10b981";
const RED = "#f87171";
const GRAY = "#64748b";
const TEXT = "#e2e8f0";

interface Optimal2026PanelProps {
  data: Optimal2026Result;
}

function badgeColor(badge: number | undefined): string {
  if (badge == null) return GRAY;
  if (badge >= 66) return GREEN;
  if (badge >= 45) return "#fbbf24";
  if (badge >= 25) return "#fb923c";
  return RED;
}

function regimeConfig(regime: string | undefined) {
  if (regime === "RISK_ON") return { label: "RÉGIMEN: RISK-ON (SPY > EMA200)", color: GREEN, bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)", icon: "▲" };
  return { label: "RÉGIMEN: RISK-OFF (SPY < EMA200) — DEFENSIVO", color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.2)", icon: "▼" };
}

function pctColor(v: number | null): string {
  if (v == null) return GRAY;
  return v >= 0 ? GREEN : RED;
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function AlignDots({ align }: { align: number | null }) {
  const n = align ?? 0;
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: i < n ? ACCENT : "rgba(255,255,255,0.12)",
          display: "inline-block",
        }} />
      ))}
    </span>
  );
}

function AllocationBar({ pct, deployPct }: { pct: number; deployPct: number | undefined }) {
  const barWidth = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: `${barWidth}%`,
        background: `linear-gradient(90deg, ${ACCENT}, #fbbf24)`,
        borderRadius: 2,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function ItemRow({ item, deployPct }: { item: Optimal2026Item; deployPct: number | undefined }) {
  const market = item.symbol.includes(".US") ? "US" : item.symbol.includes(".") ? "EU" : "US";
  const ticker = item.symbol.split(".")[0];
  const isTop = item.rank === 1;
  const stops = item.stopPct != null ? `-${fmt(item.stopPct)}%` : "—";

  return (
    <div style={{
      padding: "9px 12px",
      background: isTop ? "rgba(245,158,11,0.04)" : "transparent",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      borderLeft: isTop ? `2px solid ${ACCENT}` : "2px solid transparent",
    }}>
      {/* ── Line 1: rank | ticker | market | name | alloc | %day | price ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {/* Rank */}
        <span style={{
          fontSize: 9, fontWeight: 800, color: ACCENT,
          background: ACCENT_GLOW, border: `1px solid ${ACCENT_BORDER}`,
          borderRadius: 4, padding: "1px 5px", minWidth: 18, textAlign: "center",
        }}>
          #{item.rank}
        </span>

        {/* Ticker */}
        <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, letterSpacing: "0.02em" }}>
          {ticker}
        </span>

        {/* Market badge */}
        <span style={{
          fontSize: 8, fontWeight: 700,
          color: market === "US" ? "#60a5fa" : "#a78bfa",
          background: market === "US" ? "rgba(96,165,250,0.1)" : "rgba(167,139,250,0.1)",
          border: `1px solid ${market === "US" ? "rgba(96,165,250,0.2)" : "rgba(167,139,250,0.2)"}`,
          borderRadius: 3, padding: "1px 4px",
        }}>
          {market}
        </span>

        {/* Name */}
        <span style={{ fontSize: 10, color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </span>

        {/* Allocation */}
        <span style={{
          fontSize: 12, fontWeight: 800, color: ACCENT,
          background: ACCENT_GLOW, border: `1px solid ${ACCENT_BORDER}`,
          borderRadius: 4, padding: "2px 6px",
        }}>
          {fmt(item.allocationPct, 0)}%
        </span>

        {/* % day */}
        {item.pctDay != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: pctColor(item.pctDay), minWidth: 48, textAlign: "right" }}>
            {fmtPct(item.pctDay)}
          </span>
        )}

        {/* Price */}
        {item.price != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, fontVariantNumeric: "tabular-nums", minWidth: 56, textAlign: "right" }}>
            {item.price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {/* Allocation bar */}
      <AllocationBar pct={item.allocationPct} deployPct={deployPct} />

      {/* ── Line 2: metrics strip ── */}
      <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
        {/* Momentum risk-adjusted (señal primaria) */}
        <MetricChip label="RAdjMom" value={fmt(item.riskAdjMom, 2)} color={item.riskAdjMom != null && item.riskAdjMom > 0 ? ACCENT : GRAY} />
        {/* Retorno momentum largo (9m) */}
        <MetricChip label="Ret9m" value={item.retLong != null ? fmtPct(item.retLong) : "—"} color={item.retLong != null && item.retLong > 0 ? GREEN : RED} />
        {/* RS vs SPY */}
        <MetricChip label="RS/SPY" value={item.rsLong != null ? fmtPct(item.rsLong) : "—"} color={item.rsLong != null && item.rsLong > 0 ? GREEN : GRAY} />
        {/* Vol */}
        <MetricChip label="Vol3m" value={item.vol63 != null ? `${fmt(item.vol63, 0)}%` : "—"} color={GRAY} />
        {/* R² */}
        <MetricChip label="R²" value={fmt(item.r2, 2)} color={item.r2 != null && item.r2 > 0.7 ? GREEN : GRAY} />
        {/* EMA align */}
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 8, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>EMA</span>
          <AlignDots align={item.align} />
        </span>
        {/* Stop */}
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#94a3b8" }}>
          <span style={{ color: GRAY }}>Stop </span>
          <span style={{ color: RED, fontWeight: 700 }}>{stops}</span>
          {item.stopPrice != null && (
            <span style={{ color: GRAY }}> @ {item.stopPrice.toFixed(2)}</span>
          )}
          {item.stopBand && (
            <span style={{
              marginLeft: 4, fontSize: 8, fontWeight: 700,
              color: item.stopBand === "TR" ? GREEN : item.stopBand === "TA" ? RED : "#fbbf24",
              background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 3px",
            }}>
              {item.stopBand}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function MetricChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
      <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

export function Optimal2026Panel({ data }: Optimal2026PanelProps) {
  const items = data.items ?? [];
  const badge = data.badge;
  const oos = data.oos;
  const regime = data.regime ?? "RISK_OFF";
  const deployPct = data.deployPct ?? 30;
  const rc = regimeConfig(regime);
  const hasData = items.length > 0;
  const timestamp = data.cachedAtUtc
    ? new Date(data.cachedAtUtc).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section style={{
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${ACCENT_BORDER}`,
      borderRadius: 10,
      margin: "0 0 8px 0",
      overflow: "hidden",
      boxShadow: `0 0 24px rgba(245,158,11,0.06)`,
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px 8px",
        borderBottom: `1px solid ${ACCENT_BORDER}`,
        background: ACCENT_GLOW,
      }}>
        {/* Title */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: ACCENT, letterSpacing: "0.05em" }}>
              OPTIMAL 2026
            </span>
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>
              Dual Momentum Risk-Parity · Top 2 · Régimen binario SPY/EMA200
            </span>
          </div>
          {timestamp && (
            <div style={{ fontSize: 8, color: GRAY, marginTop: 2 }}>
              Actualizado {timestamp}
              {data.universeCount != null && (
                <span style={{ marginLeft: 6, color: "#475569" }}>· {data.universeCount.toLocaleString()} tickers analizados</span>
              )}
            </div>
          )}
        </div>

        {/* Badge reliability */}
        {badge != null && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Fiabilidad</span>
            <span style={{
              fontSize: 16, fontWeight: 900, color: badgeColor(badge),
              lineHeight: 1,
            }}>
              {badge}<span style={{ fontSize: 9 }}>/100</span>
            </span>
          </div>
        )}

        {/* OOS CAGR */}
        {oos && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
            padding: "4px 8px",
            background: "rgba(245,158,11,0.08)",
            border: `1px solid ${ACCENT_BORDER}`,
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>CAGR OOS</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: ACCENT, lineHeight: 1 }}>
              +{oos.cagr}%
            </span>
          </div>
        )}
      </div>

      {/* ── Regime banner ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between",
        padding: "6px 14px",
        background: rc.bg, borderBottom: `1px solid ${rc.border}`,
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: rc.color }}>
          {rc.icon} {rc.label}
        </span>
        {data.regimeReason && (
          <span style={{ fontSize: 9, color: "#94a3b8" }}>{data.regimeReason}</span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: deployPct === 100 ? GREEN : deployPct === 0 ? RED : "#fbbf24",
          background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: "2px 6px",
        }}>
          Capital desplegado: {deployPct}%
        </span>
      </div>

      {/* ── Items ── */}
      {!hasData && (
        <div style={{ padding: "24px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: GRAY }}>
            Sin datos aún.
          </div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
            Ejecuta un scan completo (botón "Scan Todo") para calcular Optimal2026.
          </div>
        </div>
      )}

      {hasData && items.map((item) => (
        <ItemRow key={item.symbol} item={item} deployPct={deployPct} />
      ))}

      {/* ── Disclaimers + OOS metrics ── */}
      {hasData && (
        <div style={{
          padding: "8px 14px 10px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.15)",
        }}>
          {/* OOS metrics strip */}
          {oos && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
              <OosStat label="CAGR" value={`+${oos.cagr}%`} color={ACCENT} />
              <OosStat label="MaxDD" value={`-${oos.maxDD}%`} color={RED} />
              <OosStat label="MAR" value={oos.mar.toFixed(2)} color={ACCENT} />
              <OosStat label="Sharpe" value={oos.sharpe.toFixed(2)} color={GREEN} />
              <OosStat label="Win%" value={`${oos.winPos}%`} color={TEXT} />
              <OosStat label="BeatSPY" value={oos.beatsSpy} color={GREEN} />
              {oos.tradesYr && <OosStat label="Ops/año" value={`~${oos.tradesYr}`} color={GRAY} />}
              {oos.testPeriod && <OosStat label="Período" value={oos.testPeriod} color={GRAY} />}
            </div>
          )}

          <div style={{ fontSize: 8, color: "#475569", lineHeight: 1.5 }}>
            <strong style={{ color: ACCENT }}>OPTIMAL2026</strong>: cada mes selecciona los <strong>2</strong> activos con
            mayor momentum risk-adjusted [(ret9m − ret2m) / vol3m] del universo de ~580 tickers US+EU. Filtro absoluto:
            solo activos con momentum 9m positivo. Régimen <strong>binario</strong> SPY/EMA200 (100% alcista / 30% defensivo).
            Métricas del <strong>backtest real</strong> 2016-2026 (810 combinaciones + validación walk-forward; config óptima
            por MAR, robusta cross-régimen). Brutas pre-impuestos y sobre universo superviviente — el neto real será menor.
            Ideas, NO señal de compra. No es asesoramiento financiero. Rentabilidades pasadas no garantizan las futuras.
          </div>
        </div>
      )}
    </section>
  );
}

function OosStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
      <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color }}>{value}</span>
    </span>
  );
}
