import { useState } from "react";
import type { ColorToken, Top8Asset } from "../types";
import { Badge } from "./Badge";
import { DensityToggle, type Density } from "./DensityToggle";

interface Top8GridProps {
  assets: Top8Asset[];
}

function actionToken(action: Top8Asset["action"]): ColorToken {
  if (action === "EXEC") return "GREEN_HARD";
  if (action === "WATCH" || action === "HOLD") return "GREEN_SOFT";
  if (action === "EXTENDED") return "ORANGE";
  if (action === "BLOCKED") return "RED";
  return "WHITE_GREY";
}

function dataModeToken(mode: Top8Asset["dataMode"]): ColorToken {
  if (mode === "REAL") return "GREEN_HARD";
  if (mode === "LAST_CLOSE") return "YELLOW";
  if (mode === "ERROR") return "RED";
  return "WHITE_GREY";
}

function displayAction(action: Top8Asset["action"]): string {
  if (action === "CLOSED_CONTEXT") return "CLOSED";
  return action;
}

function valueWidth(value: number): string {
  return `${Math.max(0, Math.min(value, 100))}%`;
}

function formatPriceChange(percent: number): string {
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function formatDisplayPrice(price: string): string {
  const trimmedPrice = price.trim();

  if (trimmedPrice.startsWith("$")) return `${trimmedPrice.slice(1)} $`;
  if (trimmedPrice.startsWith("EUR ")) return `${trimmedPrice.replace("EUR ", "")} €`;
  if (trimmedPrice.startsWith("GBX ")) return `${trimmedPrice.replace("GBX ", "")} GBX`;

  return trimmedPrice;
}

function hasRealPrice(asset: Top8Asset): boolean {
  return Boolean(asset.price) && asset.price !== "N/A";
}

function scoreColor(score: number): string {
  if (score >= 85) return "#34d399"; // verde fuerte
  if (score >= 70) return "#a3e635"; // verde-lima
  if (score >= 55) return "#fbbf24"; // ámbar
  return "#94a3b8";                  // gris
}

// ─── Fila COMPACTA — una sola línea: # · ticker+nombre · precio · %día · score ──
//
// Columnas alineadas entre filas (mismo grid-template en todas) para que el
// listado quede ordenado. El nombre trunca con ellipsis; precio, % y score
// tienen su propio espacio fijo a la derecha, así nunca se solapan.
function CompactRow({ asset }: { asset: Top8Asset }) {
  const real = hasRealPrice(asset);
  const changeColor = !real ? "#475569" : asset.priceChangePercent >= 0 ? "#34d399" : "#f87171";

  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "22px minmax(0,1fr) 62px 56px 42px",
        gap: 8,
        alignItems: "center",
        padding: "9px 12px",
        borderRadius: 10,
        border: "1px solid var(--line)",
        borderLeft: "3px solid var(--accent)",
        background: "var(--panel-soft)",
      }}
    >
      {/* Posición */}
      <span style={{ fontSize: 12, fontWeight: 800, color: "#eab308", textAlign: "center" }}>
        {asset.rank}
      </span>

      {/* Ticker + Nombre (el nombre trunca) */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
        <strong style={{ fontSize: 14, fontWeight: 900, color: "#f1f5f9", flexShrink: 0, letterSpacing: "0.01em" }}>
          {asset.ticker}
        </strong>
        <span
          title={asset.name}
          style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
        >
          {asset.name}
        </span>
      </div>

      {/* Precio (momento del scan) */}
      <span style={{ fontSize: 12, fontWeight: 800, color: real ? "#f1f5f9" : "#475569", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {real ? formatDisplayPrice(asset.price) : "—"}
      </span>

      {/* % desde cierre anterior */}
      <span style={{ fontSize: 11, fontWeight: 800, color: changeColor, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {real ? formatPriceChange(asset.priceChangePercent) : "—"}
      </span>

      {/* Score */}
      <span style={{ fontSize: 13, fontWeight: 900, color: scoreColor(asset.score), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(asset.score)}
      </span>
    </article>
  );
}

export function Top8Grid({ assets }: Top8GridProps) {
  const visibleAssets = assets.slice(0, 8);
  const hiddenCount = Math.max(assets.length - visibleAssets.length, 0);
  const top8Source = visibleAssets[0]?.top8Source ?? "UNAVAILABLE";
  const resultScope = visibleAssets[0]?.resultScope ?? "UNAVAILABLE";
  const [density, setDensity] = useState<Density>("compact");
  const detailed = density === "detail";

  return (
    <section className="section-block top8-section">
      <div className="section-title-row">
        <h2>TOP 8</h2>
        <span>
          Source {top8Source} · Scope {resultScope}{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
        </span>
      </div>

      {/* Toggle en su propia fila → nunca se recorta */}
      {visibleAssets.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <DensityToggle value={density} onChange={setDensity} />
        </div>
      )}

      {/* Cabecera de columnas (solo en compacto) */}
      {visibleAssets.length > 0 && !detailed && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "22px minmax(0,1fr) 62px 56px 42px",
            gap: 8,
            padding: "0 12px 6px",
          }}
        >
          {["#", "ACTIVO", "PRECIO", "%DÍA", "SCORE"].map((h, i) => (
            <span
              key={h}
              style={{
                fontSize: 8, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em",
                textAlign: i === 0 ? "center" : i === 1 ? "left" : "right",
              }}
            >
              {h}
            </span>
          ))}
        </div>
      )}

      <div className="top8-list">
        {visibleAssets.length === 0 ? (
          <article className="top8-empty-state">
            <div>
              <div className="asset-symbol-row">
                <strong>TOP 8 DATA UNAVAILABLE</strong>
                <Badge token="RED">NO OPERATION</Badge>
              </div>
              <p>Global operational TOP 8 is not available until a real scan reaches 100% coverage.</p>
            </div>
            <div className="top8-empty-points">
              <span>No fixed list</span>
              <span>No substitute data</span>
              <span>No synthetic prices</span>
              <span>Continue the same scan snapshot to complete coverage</span>
            </div>
          </article>
        ) : !detailed ? (
          visibleAssets.map((asset) => <CompactRow key={asset.ticker} asset={asset} />)
        ) : (
          visibleAssets.map((asset) => (
            <article className="asset-row" key={asset.ticker}>
              <div className="asset-rank-cell">
                <div className="rank">{asset.rank}</div>
              </div>

              <div className="asset-title-cell">
                <div className="asset-symbol-row">
                  <strong>{asset.ticker}</strong>
                  <span className="asset-name" title={asset.name}>{asset.name}</span>
                </div>
                <div className="asset-badges-row">
                  <Badge token={actionToken(asset.action)}>{displayAction(asset.action)}</Badge>
                  {asset.dataMode !== "REAL" && (
                    <Badge token={dataModeToken(asset.dataMode)}>{asset.dataMode}</Badge>
                  )}
                </div>
              </div>

              <div className="asset-market-cell">
                <span className="asset-market-tag">{asset.market}</span>
                <strong className="asset-price">{formatDisplayPrice(asset.price)}</strong>
                <div className="market-state-line">
                  <Badge token={asset.marketStatus === "OPEN" ? "GREEN_SOFT" : "WHITE_GREY"}>
                    {asset.marketStatus}
                  </Badge>
                  <span className={asset.priceChangePercent >= 0 ? "price-change-positive" : "price-change-negative"}>
                    {formatPriceChange(asset.priceChangePercent)}
                  </span>
                </div>
              </div>

              <div className="asset-scores-cell">
                <div className="bar-metric">
                  <div>
                    <span>Score</span>
                    <strong>{asset.score}</strong>
                  </div>
                  <div className="metric-track" aria-hidden="true">
                    <span className="metric-fill score-fill" style={{ width: valueWidth(asset.score) }} />
                  </div>
                </div>

                <div className="bar-metric conviction-line">
                  <div>
                    <span>Conviction</span>
                    <strong>{asset.conviction}</strong>
                  </div>
                  <div className="metric-track" aria-hidden="true">
                    <span className="metric-fill conviction-fill" style={{ width: valueWidth(asset.conviction) }} />
                  </div>
                </div>
              </div>

              <div className="asset-meta-cell">
                <div className="compact-metric risk-line">
                  <span>Risk</span>
                  <strong>{asset.risk}</strong>
                </div>
                <div className="compact-metric momentum-line">
                  <span>Momentum</span>
                  <strong>{asset.momentum}</strong>
                </div>
              </div>

              <div className="trailing-line">
                <span>Trailing stop</span>
                <div className="trailing-values">
                  <strong>Tight <b>{asset.trailingAdjusted}</b></strong>
                  <strong>Medium <b>{asset.trailingMedium}</b></strong>
                  <strong>Wide <b>{asset.trailingWide}</b></strong>
                </div>
              </div>

              <div className="card-footer">
                <span>{asset.dataQuality}</span>
                <span>{asset.provider === "none" ? "no provider" : asset.provider}</span>
                <span>{asset.priceTimestamp.local}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
