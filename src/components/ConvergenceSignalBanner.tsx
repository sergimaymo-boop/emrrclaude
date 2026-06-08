/**
 * ConvergenceSignalBanner
 *
 * Módulo de señal de convergencia de los 3 motores — Bloomberg-style.
 * Se muestra en la parte superior del dashboard (NO sticky) cuando un mismo
 * ticker aparece en el Top 8 (Motor 1) Y en Rally Leaders (Motor 2)
 * con el mercado en VERDE (Motor 3 — régimen alcista).
 *
 * Layout:
 *   ┌─ CONVERGENCIA 3 MOTORES ────────────────── ● VERDE ─┐
 *   │  TICKER   Nombre Empresa          $214.50   +1.24%  │
 *   │  Rally 87 · Score 82.3 · Riesgo LOW · Stop 3.2%    │
 *   └─────────────────────────────────────────────────────┘
 */

import { useEffect, useRef, useState } from "react";
import type { Top8Asset } from "../types";
import type { MarketRegime, RallyState } from "../services/rallyRefresh";
import type { IntraDayFlowsState } from "./IntraDayFlowsPanel";
import type { MonetaryCycleResult, EpsResult } from "../services/monetaryCycleRefresh";
import { fetchEpsForTickers } from "../services/monetaryCycleRefresh";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { evaluateOptimalSignal } from "./OptimalSignalPanel";

interface Props {
  marketRegime: MarketRegime;
  flowsState: IntraDayFlowsState;
  rallyState: RallyState;
  top8: Top8Asset[];
  monetaryCycle?: MonetaryCycleResult;
}

function formatPrice(price: string): string {
  if (!price || price === "N/A" || price === "—") return "—";
  const n = parseFloat(price);
  if (!isFinite(n)) return price;
  return n >= 1000
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(2);
}

function formatPct(pct: number): string {
  if (!isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function ConvergenceSignalBanner({
  marketRegime,
  flowsState,
  rallyState,
  top8,
  monetaryCycle,
}: Props) {
  const isNarrow = useIsNarrow(560);
  const s = evaluateOptimalSignal(marketRegime, flowsState, rallyState, top8, monetaryCycle);

  // ── EPS lazy fetch — solo cuando hay un ticker de convergencia ────────────
  // Using a ref to track which ticker was last fetched avoids the fragile
  // guard pattern with epsTicker state (which caused a near-infinite render
  // loop risk and carried redundant state). The ref does not trigger re-renders.
  const [epsData, setEpsData] = useState<EpsResult | null>(null);
  const lastFetchedTickerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!s.ticker || lastFetchedTickerRef.current === s.ticker) return;
    lastFetchedTickerRef.current = s.ticker;
    setEpsData(null);
    fetchEpsForTickers([s.ticker]).then(res => {
      const result = res[s.ticker!];
      if (result) setEpsData(result);
    }).catch(() => {});
  }, [s.ticker]);

  // ── No convergence state ─────────────────────────────────────────────────
  if (!s.bestCandidateExists || !s.ticker) {
    const rallyDone = rallyState.status === "RALLY_FINAL" || rallyState.status === "RALLY_PARTIAL_DIAGNOSTIC";
    const fullDone  = top8.length > 0;
    const scansRun  = rallyDone && fullDone;

    // scansRun === true means both scans ran but found no convergence this session.
    // scansRun === false means at least one scan still needs to run.
    const noConvLabel = scansRun
      ? "Sin confluencia en esta sesión"
      : s.needsScans.length > 0
        ? `Pendiente: ${s.needsScans.join(" · ")}`
        : "Ejecuta SCAN FULL + SCAN RALLY para activar";

    return (
      <section
        style={{
          marginBottom: 14,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid rgba(71,85,105,0.35)",
          background: "rgba(15,23,42,0.50)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "7px 14px",
            background: "rgba(71,85,105,0.10)",
            borderBottom: "1px solid rgba(71,85,105,0.20)",
            gap: 8,
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: "0.11em",
            textTransform: "uppercase", color: "#94a3b8",
          }}>
            CONVERGENCIA 3 MOTORES
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "#94a3b8",
              background: "rgba(71,85,105,0.20)",
              border: "1px solid rgba(71,85,105,0.35)",
              borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap",
            }}>
              ✗ TICKET SIN CONVERGENCIA
            </span>
            {/* Monetary cycle badge — visible even without convergence so user
                knows the macro context while waiting for scan results */}
            {monetaryCycle && monetaryCycle.hasData && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: monetaryCycle.phase === "TIGHTENING" ? "#f59e0b"
                  : monetaryCycle.phase === "EASING" ? "#10b981"
                  : "#94a3b8",
                background: monetaryCycle.phase === "TIGHTENING" ? "rgba(245,158,11,0.12)"
                  : monetaryCycle.phase === "EASING" ? "rgba(16,185,129,0.12)"
                  : "rgba(148,163,184,0.12)",
                border: `1px solid ${monetaryCycle.phase === "TIGHTENING" ? "rgba(245,158,11,0.4)" : monetaryCycle.phase === "EASING" ? "rgba(16,185,129,0.4)" : "rgba(148,163,184,0.3)"}`,
                borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap",
              }}>
                {monetaryCycle.phase === "EASING" ? "↗ EXPANSIVO" :
                 monetaryCycle.phase === "TIGHTENING" ? "⚠ RESTRICTIVO" :
                 "● NEUTRAL"}
              </span>
            )}
          </div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", gap: 12,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "#cbd5e1",
            letterSpacing: "0.02em",
          }}>
            TICKET SIN CONVERGENCIA
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "right" }}>
            {noConvLabel}
          </div>
        </div>
      </section>
    );
  }

  const top8Asset = top8.find((a) => a.ticker === s.ticker);
  const price         = top8Asset ? formatPrice(top8Asset.price) : "—";
  const changePct     = top8Asset?.priceChangePercent ?? 0;
  const changePctFmt  = top8Asset ? formatPct(changePct) : "—";
  const companyName   = top8Asset?.name ?? s.ticker;
  const currency      = top8Asset?.currency === "EUR" ? "€" : "$";
  const riskLabel     = top8Asset?.risk ?? "—";
  const positive      = changePct >= 0;

  // ── Colours based on state ──────────────────────────────────────────────
  const isFullGreen = s.allPass;                        // all 4 filters pass
  const isAlarm     = s.alarma;                         // bearish regime
  // Partial: ticker in Top8 + Rally but missing flows scan or flows negative
  const isPartial   = !isFullGreen && !isAlarm;

  const accentColor = isAlarm
    ? "#ef4444"
    : isFullGreen
      ? "#10b981"
      : "#f59e0b";

  const bgColor = isAlarm
    ? "rgba(239,68,68,0.06)"
    : isFullGreen
      ? "rgba(16,185,129,0.06)"
      : "rgba(245,158,11,0.05)";

  const borderColor = isAlarm
    ? "rgba(239,68,68,0.40)"
    : isFullGreen
      ? "rgba(16,185,129,0.40)"
      : "rgba(245,158,11,0.30)";

  const headerBg = isAlarm
    ? "rgba(239,68,68,0.10)"
    : isFullGreen
      ? "rgba(16,185,129,0.10)"
      : "rgba(245,158,11,0.08)";

  const statusLabel = isAlarm
    ? "⚠ MERCADO BAJISTA"
    : isFullGreen
      ? "● VERDE — ENTRAR"
      : "◎ CONVERGENCIA PARCIAL";

  const statusDotStyle: React.CSSProperties = isFullGreen ? {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: accentColor,
    boxShadow: `0 0 8px ${accentColor}`,
    animation: "pulse 2s infinite",
    marginRight: 6,
    flexShrink: 0,
  } : {};

  return (
    <section
      style={{
        marginBottom: 14,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${borderColor}`,
        background: bgColor,
        boxShadow: isFullGreen
          ? `0 0 24px rgba(16,185,129,0.12), 0 2px 8px rgba(0,0,0,0.3)`
          : isAlarm
            ? `0 0 20px rgba(239,68,68,0.12), 0 2px 8px rgba(0,0,0,0.3)`
            : `0 2px 8px rgba(0,0,0,0.3)`,
      }}
    >
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 14px",
          background: headerBg,
          borderBottom: `1px solid ${borderColor}`,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.11em",
            textTransform: "uppercase",
            color: accentColor,
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {isFullGreen && <span style={statusDotStyle} />}
          CONVERGENCIA 3 MOTORES
        </span>

        {/* Status label (entrada / alarma / parcial) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: accentColor,
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}55`,
              borderRadius: 999,
              padding: "2px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {statusLabel}
          </span>

          {/* Ciclo monetario badge — se muestra cuando hay datos.
              Colors are phase-mapped to guaranteed WCAG AA contrast ratios
              instead of relying on monetaryCycle.color which can be low-contrast
              (#475569 NEUTRAL over dark background = ~2.5:1, below 4.5:1 min). */}
          {monetaryCycle && monetaryCycle.hasData && monetaryCycle.phase !== "NEUTRAL" && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: monetaryCycle.phase === "EASING" ? "#10b981" : "#f59e0b",
                background: monetaryCycle.phase === "EASING" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                border: `1px solid ${monetaryCycle.phase === "EASING" ? "rgba(16,185,129,0.4)" : "rgba(245,158,11,0.4)"}`,
                borderRadius: 999,
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}
            >
              {monetaryCycle.phase === "EASING" ? "↗ EXPANSIVO" : "⚠ RESTRICTIVO"}
            </span>
          )}
        </div>
      </div>

      {/* ── Main data row ─────────────────────────────────────────────────
          Responsive: en pantallas anchas es una fila tabular (ticker | nombre |
          precio | %); en móvil se apila (identidad arriba, precio+% abajo) para
          que el ticker grande y los valores nunca se solapen. */}
      <div
        style={{
          display: "flex",
          flexDirection: isNarrow ? "column" : "row",
          alignItems: isNarrow ? "stretch" : "center",
          gap: isNarrow ? 10 : 0,
          padding: "12px 16px",
        }}
      >
        {/* Identidad: TICKER + market + nombre + motores */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            minWidth: 0,
            flex: isNarrow ? "none" : 1,
            paddingRight: isNarrow ? 0 : 18,
            borderRight: isNarrow ? "none" : "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <div
              style={{
                fontSize: isNarrow ? 24 : 30,
                fontWeight: 900,
                letterSpacing: "-0.5px",
                color: "#ffffff",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.ticker}
            </div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginTop: 3,
              }}
            >
              {top8Asset?.market ?? "EQUITY"}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#cbd5e1",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {companyName}
            </div>
            <div
              style={{
                fontSize: 9,
                color: "#64748b",
                marginTop: 3,
                fontWeight: 600,
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Motor 1 {s.top8Score?.toFixed(1) ?? "—"}
              {"  ·  "}
              Rally {s.rallyScore ?? "—"}
              {"  ·  "}
              Riesgo {riskLabel}
            </div>
          </div>
        </div>

        {/* Precio + % cambio — fila de valores (a la derecha en desktop, abajo en móvil) */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "stretch",
          }}
        >
          {/* Price */}
          <div
            style={{
              textAlign: isNarrow ? "left" : "right",
              paddingRight: 18,
              borderRight: "1px solid rgba(255,255,255,0.07)",
              flex: isNarrow ? 1 : "none",
              minWidth: isNarrow ? 0 : 90,
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              Precio
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc", fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
              {currency}{price}
            </div>
          </div>

          {/* % change */}
          <div
            style={{
              textAlign: isNarrow ? "left" : "right",
              paddingLeft: 18,
              flex: isNarrow ? 1 : "none",
              minWidth: isNarrow ? 0 : 86,
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              % cierre ant.
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: positive ? "#10b981" : "#ef4444", fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
              {changePctFmt}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer stats row ──────────────────────────────────────────────
          Separadores por column-gap (no borderRight por item) para que al
          envolver en móvil no queden divisores huérfanos. Labels con contraste
          legible (#94a3b8) en vez del antiguo #334155 casi invisible. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          columnGap: 18,
          rowGap: 4,
          padding: "7px 16px 9px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          flexWrap: "wrap",
        }}
      >
        {[
          { label: "Stop ajustado", value: s.trailingTight ?? "—" },
          { label: "Stop medio",    value: s.trailingMedium ?? "—" },
          { label: "Sector",        value: s.sectorName ?? "—" },
        ].map((item) => (
          <div
            key={item.label}
            style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: accentColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {item.value}
            </span>
          </div>
        ))}

        {/* EPS Growth badge — lazy fetched when ticker is known */}
        {epsData && (
          <div
            style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}
          >
            <span style={{
              fontSize: 9, fontWeight: 700, color: "#94a3b8",
              textTransform: "uppercase", letterSpacing: "0.07em",
            }}>
              EPS
            </span>
            <span style={{
              fontSize: 11, fontWeight: 800,
              color: epsData.color,
              fontVariantNumeric: "tabular-nums",
            }}>
              {epsData.label}
            </span>
          </div>
        )}

        {/* Partial scan advisory */}
        {isPartial && !epsData && (
          <span
            style={{
              fontSize: 9,
              color: "#475569",
              marginLeft: "auto",
            }}
          >
            {s.needsScans.length > 0
              ? `Pendiente: ${s.needsScans.join(" · ")}`
              : "Flujo sectorial no confirmado"}
          </span>
        )}
      </div>
    </section>
  );
}
