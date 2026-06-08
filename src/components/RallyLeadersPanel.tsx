import { useState } from "react";
import type { RallyAsset, RallyState } from "../services/rallyRefresh";

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
  if (!stops) return <span style={{ fontSize: 9, color: "#475569" }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, fontVariantNumeric: "tabular-nums" }}>
      <span style={{ fontSize: 9 }}>
        <span style={{ color: "#475569", fontWeight: 700 }}>AJ </span>
        <strong style={{ color: "#34d399" }}>{stops.tight.toFixed(1)}%</strong>
        <span style={{ color: "#334155" }}> · </span>
        <span style={{ color: "#475569", fontWeight: 700 }}>MED </span>
        <strong style={{ color: "#fbbf24" }}>{stops.medium.toFixed(1)}%</strong>
        <span style={{ color: "#334155" }}> · </span>
        <span style={{ color: "#475569", fontWeight: 700 }}>AMP </span>
        <strong style={{ color: "#f87171" }}>{stops.wide.toFixed(1)}%</strong>
      </span>
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

function AssetRow({ asset, detailed }: { asset: RallyAsset; detailed: boolean }) {
  const m = asset.metrics;
  const priceChange = m?.mom1m ?? null;
  const changeColor = priceChange === null ? "#64748b" : priceChange >= 0 ? "#10b981" : "#ef4444";
  const stops = calcTrailingStops(m?.atrPercent ?? null);

  // Layout 100% flexbox (no grid rígido) → la columna ticker/nombre es flexible
  // y trunca con ellipsis, mientras que precio y score tienen su propio espacio
  // (flexShrink:0). En modo DETALLE el trailing stop va en una SEGUNDA línea a
  // ancho completo, así nunca se solapan ticker · nombre · precio.
  return (
    <article style={{
      display: "flex",
      flexDirection: "column",
      gap: detailed ? 6 : 0,
      padding: "8px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      transition: "background 150ms",
    }}
    onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.06)")}
    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {/* Línea principal: rank · ticker/nombre · [precio] · score */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {/* Rank */}
        <span style={{ fontSize: 11, fontWeight: 800, color: "#475569", width: 16, flexShrink: 0, textAlign: "center" }}>
          {asset.rank}
        </span>

        {/* Ticker + Nombre — flexible, trunca con ellipsis */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong style={{ fontSize: 12, fontWeight: 900, color: "#f1f5f9", letterSpacing: "0.04em" }}>
              {asset.ticker}
            </strong>
            <span style={{ fontSize: 9, color: "#475569", fontWeight: 600, textTransform: "uppercase" }}>
              {asset.exchange?.replace("XETRA", "DE").replace("EURONEXT", "EU")}
            </span>
          </div>
          <div style={{ fontSize: 9, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {asset.name}
          </div>
        </div>

        {/* Precio + cambio — solo en modo DETALLE */}
        {detailed && (
          <div style={{ textAlign: "right", flexShrink: 0, minWidth: 56 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", fontVariantNumeric: "tabular-nums" }}>
              {m?.lastClose ? m.lastClose.toFixed(2) : "—"}
            </div>
            <div style={{ fontSize: 10, color: changeColor, fontWeight: 700 }}>
              {priceChange === null ? "—" : `${priceChange >= 0 ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(2)}%`}
            </div>
          </div>
        )}

        {/* Score — siempre visible (dato básico), inline bar */}
        <div style={{ flexShrink: 0 }}>
          <ScoreBar score={asset.rallyScore} label={asset.rallyLabel} color={asset.rallyColor} />
        </div>
      </div>

      {/* Segunda línea (solo DETALLE): trailing stops a ancho completo — sin solapamiento */}
      {detailed && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 26 }}>
          <span style={{ fontSize: 7, color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
            Trailing stop óptimo
          </span>
          <StopsTriplet stops={stops} />
        </div>
      )}
    </article>
  );
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
  // Densidad de la tabla: "compact" (solo datos básicos: rank · ticker · score)
  // o "detail" (todo: precio/día + trailing stops). Por defecto compacto para
  // una vista limpia sin solapamientos; el toggle de arriba (estilo Flujos de
  // Capital) permite desplegar todos los datos.
  const [density, setDensity] = useState<"compact" | "detail">("compact");
  const detailed = density === "detail";
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
          {/* Toggle de densidad — dos botones pequeños, mismo patrón visual que
              el toggle ⊞/☰ de Flujos de Capital */}
          {top10.length > 0 && (
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
              {(["compact", "detail"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setDensity(v)}
                  style={{
                    padding: "3px 10px", fontSize: 8, fontWeight: 700, cursor: "pointer",
                    border: "none", letterSpacing: "0.05em",
                    background: density === v ? "rgba(255,255,255,0.12)" : "transparent",
                    color: density === v ? "#f1f5f9" : "#475569",
                    transition: "background 120ms",
                  }}
                >
                  {v === "compact" ? "▤ COMPACTO" : "☰ DETALLE"}
                </button>
              ))}
            </div>
          )}
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
          {/* Cabecera ligera — solo etiqueta el modo activo (el layout flexible
              de cada fila es auto-descriptivo, así no hay columnas que desalinear) */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0 12px 6px",
          }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              # · Activo{detailed ? " · Precio/día" : ""} · Score
            </span>
            {detailed && (
              <span style={{ fontSize: 8, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Trailing stop (AJ · MED · AMP)
              </span>
            )}
          </div>

          {visibleAssets.map(asset => <AssetRow key={asset.providerSymbol} asset={asset} detailed={detailed} />)}

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
