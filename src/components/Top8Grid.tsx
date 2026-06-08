import { useState } from "react";
import type { ColorToken, Top8Asset } from "../types";
import { Badge } from "./Badge";

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

function operationalStatusToken(status: Top8Asset["operationalDataStatus"]): ColorToken {
  if (status === "REAL") return "GREEN_HARD";
  if (status === "LAST_CLOSE") return "YELLOW";
  if (status === "ERROR") return "RED";
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

export function Top8Grid({ assets }: Top8GridProps) {
  const visibleAssets = assets.slice(0, 8);
  const hiddenCount = Math.max(assets.length - visibleAssets.length, 0);
  const top8Source = visibleAssets[0]?.top8Source ?? "UNAVAILABLE";
  const resultScope = visibleAssets[0]?.resultScope ?? "UNAVAILABLE";

  // Densidad: "compact" (datos básicos: ticker · nombre · acción · score) o
  // "detail" (todo: precio, conviction, risk, momentum, trailing stop, footer).
  // Mismo toggle de dos botones pequeños que Rally Leaders / Flujos de Capital.
  const [density, setDensity] = useState<"compact" | "detail">("compact");
  const detailed = density === "detail";

  return (
    <section className="section-block top8-section">
      <div className="section-title-row">
        <h2>TOP 8</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {visibleAssets.length > 0 && (
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
          <span>
            Source {top8Source} · Scope {resultScope}{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
          </span>
        </div>
      </div>
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
        ) : visibleAssets.map((asset) => (
            <article className="asset-row" key={asset.ticker}>
              <div className="asset-rank-cell">
                <div className="rank">{asset.rank}</div>
              </div>

              <div className="asset-title-cell">
                <div className="asset-symbol-row">
                  <strong>{asset.ticker}</strong>
                  <span className="asset-name" title={asset.name}>{asset.name}</span>
                  {/* En modo COMPACTO el score se muestra inline aquí (dato básico),
                      ya que la celda de scores completa queda oculta */}
                  {!detailed && (
                    <span style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "baseline", gap: 4, fontVariantNumeric: "tabular-nums" }}>
                      <strong style={{ fontSize: 16, fontWeight: 900, color: "#f1f5f9", lineHeight: 1 }}>{asset.score}</strong>
                      <span style={{ fontSize: 8, fontWeight: 800, color: "#475569", letterSpacing: "0.05em" }}>SCORE</span>
                    </span>
                  )}
                </div>
                <div className="asset-badges-row">
                  <Badge token={actionToken(asset.action)}>{displayAction(asset.action)}</Badge>
                  {asset.dataMode !== "REAL" && (
                    <Badge token={dataModeToken(asset.dataMode)}>{asset.dataMode}</Badge>
                  )}
                </div>
              </div>

              {detailed && (<>
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
              </>)}
            </article>
        ))}
      </div>
    </section>
  );
}
