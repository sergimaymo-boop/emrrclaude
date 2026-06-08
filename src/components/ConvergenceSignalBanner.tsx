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

import type { Top8Asset } from "../types";
import type { MarketRegime, RallyState } from "../services/rallyRefresh";
import type { IntraDayFlowsState } from "./IntraDayFlowsPanel";
import { evaluateOptimalSignal } from "./OptimalSignalPanel";

interface Props {
  marketRegime: MarketRegime;
  flowsState: IntraDayFlowsState;
  rallyState: RallyState;
  top8: Top8Asset[];
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
}: Props) {
  const s = evaluateOptimalSignal(marketRegime, flowsState, rallyState, top8);

  // ── Only render when there is an actual ticker convergence ──────────────
  if (!s.bestCandidateExists || !s.ticker) {
    // Scans not yet run — minimal hint row (no visual noise)
    const rallyDone = rallyState.status === "RALLY_FINAL" || rallyState.status === "RALLY_PARTIAL_DIAGNOSTIC";
    const fullDone  = top8.length > 0;
    if (!rallyDone || !fullDone) return null;

    // Scans done but no intersection — silent (panel below shows full detail)
    return null;
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
          }}
        >
          {isFullGreen && <span style={statusDotStyle} />}
          CONVERGENCIA 3 MOTORES
        </span>

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
      </div>

      {/* ── Main data row ───────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          alignItems: "center",
          gap: 0,
          padding: "12px 16px",
        }}
      >
        {/* TICKER — Bloomberg large mono */}
        <div
          style={{
            paddingRight: 18,
            borderRight: `1px solid rgba(255,255,255,0.07)`,
            marginRight: 18,
          }}
        >
          <div
            style={{
              fontSize: 30,
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
              fontSize: 8.5,
              fontWeight: 700,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginTop: 3,
            }}
          >
            {top8Asset?.market ?? "EQUITY"}
          </div>
        </div>

        {/* Company name */}
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
              color: "#475569",
              marginTop: 3,
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            Motor 1 score {s.top8Score?.toFixed(1) ?? "—"}
            {"  ·  "}
            Motor 2 rally {s.rallyScore ?? "—"}
            {"  ·  "}
            Riesgo {riskLabel}
          </div>
        </div>

        {/* Price */}
        <div
          style={{
            textAlign: "right",
            paddingLeft: 20,
            paddingRight: 16,
            borderLeft: "1px solid rgba(255,255,255,0.07)",
            borderRight: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 2,
            }}
          >
            Precio
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#f8fafc",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {currency}{price}
          </div>
        </div>

        {/* % change */}
        <div
          style={{
            textAlign: "right",
            paddingLeft: 16,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 2,
            }}
          >
            % cierre ant.
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: positive ? "#10b981" : "#ef4444",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {changePctFmt}
          </div>
        </div>
      </div>

      {/* ── Footer stats row ────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          padding: "6px 16px 8px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          flexWrap: "wrap",
          rowGap: 4,
        }}
      >
        {[
          { label: "Stop ajustado", value: s.trailingTight ?? "—" },
          { label: "Stop medio",    value: s.trailingMedium ?? "—" },
          { label: "Sector",        value: s.sectorName ?? "—" },
        ].map((item, i) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingRight: 16,
              marginRight: 16,
              borderRight: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#334155",
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

        {/* Partial scan advisory */}
        {isPartial && (
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
