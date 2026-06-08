import { useState } from "react";
import type { RallyAsset, RallyState } from "../services/rallyRefresh";
import { DensityToggle, type Density } from "./DensityToggle";

interface RallyLeadersPanelProps {
  rallyState: RallyState;
  onScanRally: () => void;
}

// ─── Trailing stops — Ajustado / Medio / Amplio ───────────────────────────────
//
// The engine (rallyScoreEngine.js → calculateTrailingStop) already picks ONE
// "optimal" multiplier per asset based on its current ATR% volatility regime
// (2.0× when ATR%<1.5, 2.5× when 1.5-3%, 3.0× when >3%, clamped to [5,18]%).
// Per user request we now show all THREE risk-profile variants side by side
// (Ajustado = tight/protect-gains, Medio = standard, Amplio = noise-tolerant)
// so the trader can pick the stop that matches their own risk tolerance —
// derived client-side from the same ATR% input using the same institutional
// (Wilder/Chandelier) multiplier logic, just at fixed tight/medium/wide presets
// instead of letting the volatility regime choose a single one automatically.
function calcTrailingStops(atrPercent: number | null | undefined): { tight: number; medium: number; wide: number } | null {
  if (atrPercent === null || atrPercent === undefined || !Number.isFinite(atrPercent) || atrPercent <= 0) return null;
  const atp = Math.abs(atrPercent);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    tight:  Math.round(clamp(atp * 2.0, 4, 10) * 10) / 10,
    medium: Math.round(clamp(atp * 2.5, 6, 14) * 10) / 10,
    wide:   Math.round(clamp(atp * 3.0, 8, 18) * 10) / 10,
  };
}

function StopsTriplet({ stops }: { stops: { tight: number; medium: number; wide: number } | null }) {
  if (!stops) return <span style={{ fontSize: 10, color: "#475569" }}>—</span>;
  // Cada par etiqueta+valor es una unidad que no se parte; el contenedor permite
  // wrap limpio en anchos estrechos sin solapar nunca (cada chip salta entero).
  const Chip = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, whiteSpace: "nowrap" }}>
      <span style={{ color: "#64748b", fontWeight: 700, fontSize: 9 }}>{label}</span>
      <strong style={{ color, fontSize: 11 }}>{value.toFixed(1)}%</strong>
    </span>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontVariantNumeric: "tabular-nums" }}>
      <Chip label="AJ" value={stops.tight} color="#34d399" />
      <Chip label="MED" value={stops.medium} color="#fbbf24" />
      <Chip label="AMP" value={stops.wide} color="#f87171" />
    </div>
  );
}

// ─── Compact inline score bar (replaces the old space-hungry circle) ─────────

function ScoreBar({ score, label, color }: { score: number; label: string; color: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {score}
        </span>
        <span style={{
          fontSize: 7, fontWeight: 800, color: `${color}cc`, letterSpacing: "0.04em",
          textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {label.replace(" RALLY", "").replace("ELITE", "ÉLITE")}
        </span>
      </div>
      <div style={{ width: 64, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 400ms" }} />
      </div>
    </div>
  );
}

// ─── Single dense Bloomberg-style row ─────────────────────────────────────────

function hoverOn(e: React.MouseEvent<HTMLElement>) { e.currentTarget.style.background = "rgba(99,102,241,0.06)"; }
function hoverOff(e: React.MouseEvent<HTMLElement>) { e.currentTarget.style.background = "transparent"; }

function fmtExchange(ex: string | undefined): string {
  return (ex ?? "").replace("XETRA", "DE").replace("EURONEXT", "EU");
}
function fmtChange(priceChange: number | null): { text: string; color: string } {
  if (priceChange === null) return { text: "—", color: "#64748b" };
  return {
    text: `${priceChange >= 0 ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(2)}%`,
    color: priceChange >= 0 ? "#34d399" : "#f87171",
  };
}

// ── COMPACTO: una sola línea tabular, columnas alineadas con la cabecera ──────
// Grid: rank · ticker+nombre(trunca) · %día · score. Columnas fijas estrechas a
// la derecha → nunca se solapan, igual que el módulo TOP 8.
function AssetRowCompact({ asset }: { asset: RallyAsset }) {
  const change = fmtChange(asset.metrics?.mom1m ?? null);
  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "22px minmax(0,1fr) 64px 46px",
        gap: 8,
        alignItems: "center",
        padding: "9px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        transition: "background 150ms",
      }}
      onMouseEnter={hoverOn}
      onMouseLeave={hoverOff}
    >
      <span style={{ fontSize: 12, fontWeight: 800, color: "#475569", textAlign: "center" }}>{asset.rank}</span>
      <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
        <strong style={{ fontSize: 13, fontWeight: 900, color: "#f1f5f9", letterSpacing: "0.02em", flexShrink: 0 }}>
          {asset.ticker}
        </strong>
        <span style={{ fontSize: 9, color: "#475569", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
          {fmtExchange(asset.exchange)}
        </span>
        <span title={asset.name} style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {asset.name}
        </span>
      </div>
      <span style={{ fontSize: 11, fontWeight: 800, color: change.color, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {change.text}
      </span>
      <span style={{ fontSize: 14, fontWeight: 900, color: asset.rallyColor, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {asset.rallyScore}
      </span>
    </article>
  );
}

// ── DETALLE: tarjeta apilada — la información se ordena en filas verticales que
// nunca se solapan, sea cual sea el ancho (móvil incluido). ─────────────────────
function AssetRowDetail({ asset }: { asset: RallyAsset }) {
  const m = asset.metrics;
  const change = fmtChange(m?.mom1m ?? null);
  const stops = calcTrailingStops(m?.atrPercent ?? null);
  const price = m?.lastClose ? m.lastClose.toFixed(2) : "—";
  const ccy = asset.currency === "EUR" ? "€" : asset.currency === "GBX" ? "GBX" : "$";

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "11px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        transition: "background 150ms",
      }}
      onMouseEnter={hoverOn}
      onMouseLeave={hoverOff}
    >
      {/* Fila 1 — identidad (izq) + score con barra (der) */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, display: "flex", gap: 9, alignItems: "baseline" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#475569", flexShrink: 0, width: 16, textAlign: "right" }}>{asset.rank}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14, fontWeight: 900, color: "#f1f5f9", letterSpacing: "0.02em" }}>{asset.ticker}</strong>
              <span style={{ fontSize: 9, color: "#475569", fontWeight: 700, textTransform: "uppercase" }}>{fmtExchange(asset.exchange)}</span>
            </div>
            <div title={asset.name} style={{ fontSize: 10, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
              {asset.name}
            </div>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <ScoreBar score={asset.rallyScore} label={asset.rallyLabel} color={asset.rallyColor} />
        </div>
      </div>

      {/* Fila 2 — datos: precio/cambio + trailing stops (flex-wrap, sin solape) */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 18px",
        paddingLeft: 25, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 7, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Precio</span>
          <strong style={{ fontSize: 13, fontWeight: 800, color: "#f1f5f9", fontVariantNumeric: "tabular-nums" }}>{price} {ccy}</strong>
          <span style={{ fontSize: 11, fontWeight: 800, color: change.color, fontVariantNumeric: "tabular-nums" }}>{change.text}</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>Trailing stop</span>
          <StopsTriplet stops={stops} />
        </div>
      </div>
    </article>
  );
}

function AssetRow({ asset, detailed }: { asset: RallyAsset; detailed: boolean }) {
  return detailed ? <AssetRowDetail asset={asset} /> : <AssetRowCompact asset={asset} />;
}

// ─── Coverage / progress bar — pinned to the TOP of the module ───────────────

function TopProgressBar({
  percent, isScanning, batchesCompleted, batchesTotal, lastRun, isFinal,
}: {
  percent: number; isScanning: boolean; batchesCompleted: number; batchesTotal: number; lastRun: string; isFinal: boolean;
}) {
  const color = percent >= 100 ? "#10b981" : "#6366f1";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: "#64748b" }}>
          {isScanning
            ? `Escaneando · lote ${batchesCompleted}/${batchesTotal}`
            : isFinal
              ? `Cobertura completa · último scan ${lastRun}`
              : "Cobertura del último scan"}
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{percent}%</span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%",
          background: isScanning ? "linear-gradient(90deg, #6366f1, #818cf8, #6366f1)" : color,
          backgroundSize: isScanning ? "200% 100%" : undefined,
          animation: isScanning ? "flows-scan-progress 3s ease-in-out infinite" : undefined,
          borderRadius: 3, transition: "width 500ms ease",
        }} />
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function RallyLeadersPanel({ rallyState, onScanRally }: RallyLeadersPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const [density, setDensity] = useState<Density>("compact");
  const { status, isScanning, top10, coveragePercent, batchesCompleted, batchesTotal, lastRun } = rallyState;
  const isIdle = status === "RALLY_IDLE";
  const isFinal = status === "RALLY_FINAL";
  const isPartial = status === "RALLY_PARTIAL_DIAGNOSTIC";
  const isUnavailable = status === "RALLY_DATA_UNAVAILABLE";
  // Detect if data is from previous session (loaded from Redis on mount, not from a fresh scan)
  const isFromCache = isFinal && top10.length > 0 && !isScanning;

  // Mantiene siempre visible el último scan completado: top10 solo se sustituye
  // cuando llegan datos nuevos (ver handleScanRally en DashboardPage — ya no
  // se vacía la lista al lanzar un scan nuevo), así el módulo nunca queda en
  // blanco mientras se recalculan los datos.
  const visibleAssets = showAll ? top10 : top10.slice(0, 5);
  const canExpand = top10.length > 5;

  return (
    <section className="section-block" style={{ marginTop: 16, border: "1px solid rgba(99,102,241,0.2)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>
              Rally Leaders Engine
            </h2>
            {isFinal && !isFromCache && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                LIVE FINAL
              </span>
            )}
            {isFromCache && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#6366f1", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                SESIÓN ANTERIOR · {lastRun}
              </span>
            )}
            {isPartial && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#eab308", background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                PARTIAL DIAGNOSTIC
              </span>
            )}
            {isScanning && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#6366f1", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 999, padding: "1px 6px" }}>
                SCANNING…
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "#475569" }}>
            Top 10 Institutional Rally Leaders · Independent engine
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {top10.length > 0 && <DensityToggle value={density} onChange={setDensity} />}
          <span style={{ fontSize: 10, color: "#475569" }}>
            {isFinal || isPartial ? `${top10.length} leaders found` : ""}
          </span>
        </div>
      </div>

      {/* Coverage bar — siempre arriba del módulo (0-100), refleja el último scan
          mientras no haya uno nuevo en curso, y el progreso en vivo durante el scan */}
      {!isIdle && !isUnavailable && (
        <TopProgressBar
          percent={coveragePercent}
          isScanning={isScanning}
          batchesCompleted={batchesCompleted}
          batchesTotal={batchesTotal}
          lastRun={lastRun}
          isFinal={isFinal && !isScanning}
        />
      )}

      {/* Idle / unavailable state */}
      {(isIdle || isUnavailable) && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}>
            {isUnavailable ? "Mercados cerrados — sin datos disponibles" : "Pulsa SCAN RALLY para detectar líderes"}
          </div>
          <div style={{ fontSize: 10, color: "#1e293b" }}>
            Solo datos reales · Sin listas fijas · Sin sesgos
          </div>
        </div>
      )}

      {/* Table header + rows — siempre muestra el último scan completado
          (incluso mientras se ejecuta uno nuevo, ver nota arriba) */}
      {top10.length > 0 && (
        <>
          {/* Cabecera de columnas — SOLO en compacto y alineada exactamente con
              el grid de AssetRowCompact. En detalle se usan tarjetas auto-etiquetadas. */}
          {density === "compact" && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "22px minmax(0,1fr) 64px 46px",
              gap: 8,
              padding: "0 12px 6px",
            }}>
              {[
                { h: "#", align: "center" as const },
                { h: "ACTIVO", align: "left" as const },
                { h: "%DÍA", align: "right" as const },
                { h: "SCORE", align: "right" as const },
              ].map(({ h, align }) => (
                <span key={h} style={{ fontSize: 8, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: align }}>
                  {h}
                </span>
              ))}
            </div>
          )}

          {visibleAssets.map(asset => <AssetRow key={asset.providerSymbol} asset={asset} detailed={density === "detail"} />)}

          {/* Expandir/colapsar — mismo patrón visual que el toggle de Flujos de Capital */}
          {canExpand && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setShowAll(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 14px", fontSize: 8, fontWeight: 800, letterSpacing: "0.08em",
                  textTransform: "uppercase", cursor: "pointer",
                  borderRadius: 999, border: "1px solid rgba(99,102,241,0.25)",
                  background: "rgba(99,102,241,0.08)", color: "#a5b4fc",
                  transition: "background 120ms",
                }}
              >
                {showAll ? "▲ Ver Top 5" : `▼ Ver los ${top10.length}`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Footer status — cobertura completa */}
      {isFinal && !isScanning && (
        <div style={{ marginTop: 12, padding: "8px 14px", background: "rgba(16,185,129,0.05)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ Cobertura completa — Rally Leaders Final</span>
            <span style={{ fontSize: 10, color: "#475569" }}>{rallyState.lastRun}</span>
          </div>
        </div>
      )}
    </section>
  );
}
