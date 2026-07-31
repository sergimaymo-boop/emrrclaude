/**
 * Optimal2026Panel — ⚡ OPTIMAL SUPREME · módulo ÚNICO consolidado (24-jul-2026)
 *
 * Funcionalidades (independientes del resto del dashboard):
 *   1. Señales intraday (pullbackRisk 0-100 + acción HOLD/TIGHTEN/ROTATE/EXIT)
 *   2. Cartera IBK — CSV o FOTO (OCR local) → P&L + acción por posición
 *   3. Auto-scan 15:00 Canarias + botón de scan manual con barra de progreso
 *   4. Precios EN VIVO vs ÚLTIMO CIERRE + alarma roja si mercado abierto y precios obsoletos
 *   5. Comparativa de backtest REAL (sweep propio de 118 variantes)
 *
 * Backtest real (2016-2026, 603 tickers, walk-forward, costes 20bps/lado) — CANÓNICAS:
 *   SUPREME (trailing bandas + VT30/10d + histéresis 1.10): CAGR 52.2%, MaxDD 26.9%, MAR 1.94, Sharpe 1.50
 *   Solo mensual (mismo universo):                          CAGR 61.6%, MaxDD 40.0%, MAR 1.54
 * Las cifras legadas (CAGR 40.1/DD 18.5/MAR 2.17) eran del universo curado de 110 tickers.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Optimal2026Result, Optimal2026Item, IBKPosition, IBKPortfolio } from "../services/optimal2026Refresh";
import { parseIBKPortfolio, parseImagePortfolio, savePortfolioToStorage, loadPortfolioFromStorage, clearPortfolioFromStorage, clearPortfolioHistory, loadPortfolioHistory } from "../services/optimal2026Refresh";
import { enrichWithIntradaySignals, SEMIACTIVE_COMPARISON, type Optimal2026ItemWithSignal, type ActionRec, type RiskLevel } from "../services/optimal2026IntradayEngine";
import { getRegionalMarketStates } from "../utils/marketHours";

// ── Palette ────────────────────────────────────────────────────────────────────
const ACCENT = "#f59e0b";
const ACCENT_GLOW = "rgba(245,158,11,0.15)";
const ACCENT_BORDER = "rgba(245,158,11,0.25)";
const GREEN = "#10b981";
const RED = "#f87171";
const ORANGE = "#fb923c";
const YELLOW = "#fbbf24";
const GRAY = "#64748b";
const TEXT = "#e2e8f0";

// ── Helper: Canary Islands time ───────────────────────────────────────────────
function getCanaryHourMin(): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("es", {
    timeZone: "Atlantic/Canary",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
  return { h, m };
}

function minutesToNext15(): number {
  const { h, m } = getCanaryHourMin();
  if (h < 15) return (15 - h - 1) * 60 + (60 - m);
  if (h === 15 && m <= 4) return 0; // dentro de la ventana
  return (24 - h + 14) * 60 + (60 - m); // próximo día ~14h
}

// ── Action colors ─────────────────────────────────────────────────────────────
function actionColor(action: ActionRec): string {
  switch (action) {
    case "HOLD": return GREEN;
    case "TIGHTEN": return YELLOW;
    case "ROTATE": return ORANGE;
    case "EXIT": return RED;
  }
}

function riskColor(level: RiskLevel): string {
  switch (level) {
    case "LOW": return GREEN;
    case "MODERATE": return YELLOW;
    case "HIGH": return ORANGE;
    case "CRITICAL": return RED;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PullbackGauge({ risk, level }: { risk: number; level: RiskLevel }) {
  const color = riskColor(level);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 38 }}>
      <div style={{ position: "relative", width: 34, height: 17, overflow: "hidden" }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0,
          width: 34, height: 34,
          borderRadius: "50%",
          background: `conic-gradient(${color} ${risk * 1.8}deg, rgba(255,255,255,0.06) 0deg)`,
        }} />
        <div style={{
          position: "absolute", bottom: 0, left: 4, width: 26, height: 26,
          borderRadius: "50%",
          background: "#0f172a",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          paddingBottom: 3,
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, color, lineHeight: 1 }}>{risk}</span>
        </div>
      </div>
      <span style={{ fontSize: 7, color, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {level === "CRITICAL" ? "CRIT" : level === "HIGH" ? "ALTO" : level === "MODERATE" ? "MOD" : "BAJO"}
      </span>
    </div>
  );
}

function ActionBadge({ action }: { action: ActionRec }) {
  const color = actionColor(action);
  const label = action === "HOLD" ? "MANTENER" : action === "TIGHTEN" ? "APRETAR" : action === "ROTATE" ? "ROTAR" : "SALIR";
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, color,
      background: `${color}18`,
      border: `1px solid ${color}40`,
      borderRadius: 4, padding: "2px 6px",
      letterSpacing: "0.06em",
    }}>
      {label}
    </span>
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

function AllocationBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`,
        background: `linear-gradient(90deg, ${ACCENT}, #fbbf24)`,
        borderRadius: 2, transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function fmt(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}
function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}
function pctColor(v: number | null): string {
  if (v == null) return GRAY;
  return v >= 0 ? GREEN : RED;
}

function ItemRow({
  item,
  deployPct,
  isLive,
  isPricesStale,
}: {
  item: Optimal2026ItemWithSignal;
  deployPct: number | undefined;
  isLive: boolean;
  isPricesStale?: boolean;
}) {
  const market = item.symbol.includes(".US") ? "US" : item.symbol.includes(".") ? "EU" : "US";
  const ticker = item.symbol.split(".")[0];
  const isTop = item.rank === 1;
  const isInvested = item.allocationPct > 0;
  const isOnBench = !isInvested;

  // Stop to show: adjusted if action !== HOLD, otherwise base
  const showStopPct = item.action !== "HOLD" ? item.adjustedStopPct : item.stopPct;
  const showStopPrice = item.action !== "HOLD" ? item.adjustedStopPrice : item.stopPrice;
  const stopChanged = item.action !== "HOLD" && item.adjustedStopPct !== item.stopPct;

  return (
    <div style={{
      padding: "9px 12px",
      background: isTop ? "rgba(245,158,11,0.04)" : "transparent",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      borderLeft: isTop ? `2px solid ${ACCENT}` : isOnBench ? "2px solid rgba(100,116,139,0.3)" : "2px solid transparent",
      opacity: isOnBench ? 0.7 : 1,
    }}>
      {/* ── Line 1: rank | ticker | market | name | alloc | intraday signals | %day | price ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: isOnBench ? GRAY : ACCENT,
          background: isOnBench ? "rgba(100,116,139,0.1)" : ACCENT_GLOW,
          border: `1px solid ${isOnBench ? "rgba(100,116,139,0.2)" : ACCENT_BORDER}`,
          borderRadius: 4, padding: "1px 5px", minWidth: 18, textAlign: "center",
        }}>
          #{item.rank}
        </span>
        <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, letterSpacing: "0.02em" }}>{ticker}</span>
        <span style={{
          fontSize: 8, fontWeight: 700,
          color: market === "US" ? "#60a5fa" : "#a78bfa",
          background: market === "US" ? "rgba(96,165,250,0.1)" : "rgba(167,139,250,0.1)",
          border: `1px solid ${market === "US" ? "rgba(96,165,250,0.2)" : "rgba(167,139,250,0.2)"}`,
          borderRadius: 3, padding: "1px 4px",
        }}>
          {market}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </span>

        {/* Allocation */}
        <span style={{
          fontSize: 12, fontWeight: 800, color: isOnBench ? GRAY : ACCENT,
          background: isOnBench ? "rgba(100,116,139,0.08)" : ACCENT_GLOW,
          border: `1px solid ${isOnBench ? "rgba(100,116,139,0.2)" : ACCENT_BORDER}`,
          borderRadius: 4, padding: "2px 6px",
        }}>
          {isOnBench ? "BANCA" : `${fmt(item.allocationPct, 0)}%`}
        </span>

        {/* Intraday signals — solo si está invertido */}
        {isInvested && (
          <span style={{ opacity: isPricesStale ? 0.35 : 1, position: "relative" }} title={isPricesStale ? "⚠ Precios no actualizados — señal no fiable" : undefined}>
            <PullbackGauge risk={item.pullbackRisk} level={item.riskLevel} />
            <ActionBadge action={isPricesStale ? "HOLD" : item.action} />
            {isPricesStale && (
              <span style={{ position: "absolute", top: -4, right: -4, fontSize: 9, color: RED }}>⚠</span>
            )}
          </span>
        )}

        {/* % day */}
        {item.pctDay != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: pctColor(item.pctDay), minWidth: 48, textAlign: "right" }}>
            {fmtPct(item.pctDay)}
          </span>
        )}
      </div>

      {/* ── Precio SIEMPRE en su propia línea, encima de la barra (fix 25-jul: en móvil
          el wrap lo colocaba inconsistente — WDC encima de la barra, MU arriba a la derecha) ── */}
      {item.price != null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, fontVariantNumeric: "tabular-nums" }}>
            {item.price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {isLive && item.priceRefreshedAt && (
            <span style={{ fontSize: 7, color: GREEN, fontWeight: 700 }}>● EN VIVO</span>
          )}
        </div>
      )}

      <AllocationBar pct={item.allocationPct} />

      {/* ── Line 2: action detail + metrics ── */}
      {isInvested && item.action !== "HOLD" && !isPricesStale && (
        <div style={{
          marginTop: 4, padding: "3px 8px",
          background: `${actionColor(item.action)}10`,
          border: `1px solid ${actionColor(item.action)}25`,
          borderRadius: 4, fontSize: 9, color: actionColor(item.action), fontWeight: 600,
        }}>
          ▶ {item.actionDetail}
          {item.rotationTarget && (
            <span style={{ marginLeft: 8, color: ORANGE, fontWeight: 800 }}>→ {item.rotationTarget}</span>
          )}
        </div>
      )}

      {/* ── Line 3: metrics strip ── */}
      <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
        <MetricChip label="RAdjMom" value={fmt(item.riskAdjMom, 2)} color={item.riskAdjMom != null && item.riskAdjMom > 0 ? ACCENT : GRAY} />
        <MetricChip label="Ret9m" value={item.retLong != null ? fmtPct(item.retLong) : "—"} color={item.retLong != null && item.retLong > 0 ? GREEN : RED} />
        <MetricChip label="RS/SPY" value={item.rsLong != null ? fmtPct(item.rsLong) : "—"} color={item.rsLong != null && item.rsLong > 0 ? GREEN : GRAY} />
        <MetricChip label="Vol3m" value={item.vol63 != null ? `${fmt(item.vol63, 0)}%` : "—"} color={GRAY} />
        <MetricChip label="R²" value={fmt(item.r2, 2)} color={item.r2 != null && item.r2 > 0.7 ? GREEN : GRAY} />
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 8, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>EMA</span>
          <AlignDots align={item.align} />
        </span>
        {/* Stop — ajustado si action !== HOLD */}
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#94a3b8" }}>
          <span style={{ color: GRAY }}>Stop </span>
          <span style={{ color: stopChanged ? actionColor(item.action) : RED, fontWeight: 700 }}>
            {showStopPct != null ? `-${fmt(showStopPct)}%` : "—"}
            {stopChanged && <span style={{ marginLeft: 2, fontSize: 7 }}>↕</span>}
          </span>
          {showStopPrice != null && (
            <span style={{ color: GRAY }}> @ {showStopPrice.toFixed(2)}</span>
          )}
          {item.stopBand && (
            <span style={{
              marginLeft: 4, fontSize: 8, fontWeight: 700,
              color: item.stopBand === "TR" ? GREEN : item.stopBand === "TA" ? RED : YELLOW,
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

// ── Portfolio section ─────────────────────────────────────────────────────────

// ── Tabla de cartera estilo terminal (rediseño 26-jul) ────────────────────────
// Columnas fijas alineadas: TICKER+NOMBRE · ACCIONES · PRECIO · INVERTIDO · P&L · SEÑAL
const PORT_GRID = "minmax(86px,1.3fr) 52px 64px 72px 60px minmax(96px,1fr)";
const cellNum = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function PortfolioHeaderRow() {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: PORT_GRID, gap: 6, alignItems: "center",
      padding: "4px 12px", borderBottom: "1px solid rgba(245,158,11,0.15)",
      fontSize: 7.5, fontWeight: 800, color: GRAY, textTransform: "uppercase", letterSpacing: "0.06em",
    }}>
      <span>Ticker · Nombre</span>
      <span style={cellNum}>Acciones</span>
      <span style={cellNum}>Precio</span>
      <span style={cellNum}>Invertido</span>
      <span style={cellNum}>P&L</span>
      <span style={{ textAlign: "right" }}>Señal · Stop</span>
    </div>
  );
}

function PortfolioRow({
  pos,
  matchedItem,
  isPricesStale,
  accountTotal,
}: {
  pos: IBKPosition;
  matchedItem: Optimal2026ItemWithSignal | undefined;
  isPricesStale?: boolean;
  accountTotal?: number | null;
}) {
  const inStrategy = !!matchedItem;
  const cur = pos.currency === "USD" ? "$" : "€";
  const name = pos.name ?? matchedItem?.name ?? null;
  const weightPct = accountTotal && pos.marketValue != null ? (pos.marketValue / accountTotal) * 100 : null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: PORT_GRID, gap: 6, alignItems: "center",
      padding: "6px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      background: inStrategy ? "rgba(245,158,11,0.03)" : "transparent",
    }}>
      {/* Ticker + nombre + % de la cuenta */}
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: inStrategy ? ACCENT : TEXT }}>{pos.symbol}</span>
        {weightPct != null && (
          <span style={{ fontSize: 8, color: GRAY, marginLeft: 5 }}>{weightPct.toFixed(1)}%</span>
        )}
        {name && (
          <div style={{ fontSize: 8, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </div>
        )}
      </span>
      {/* Acciones */}
      <span style={{ ...cellNum, fontSize: 10, color: TEXT }}>
        {pos.quantity % 1 === 0 ? pos.quantity.toFixed(0) : pos.quantity.toFixed(2)}
      </span>
      {/* Precio */}
      <span style={{ ...cellNum, fontSize: 10, color: "#94a3b8" }}>
        {pos.currentPrice != null ? `${cur}${pos.currentPrice.toFixed(2)}` : "—"}
      </span>
      {/* Invertido (valor de mercado) */}
      <span style={{ ...cellNum, fontSize: 10.5, fontWeight: 700, color: TEXT }}>
        {pos.marketValue != null ? `${cur}${pos.marketValue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : "—"}
      </span>
      {/* P&L */}
      <span style={{ ...cellNum, fontSize: 10, fontWeight: 700, color: pos.unrealizedPnL != null ? pctColor(pos.unrealizedPnL) : GRAY }}>
        {pos.unrealizedPnL != null ? `${pos.unrealizedPnL >= 0 ? "+" : ""}${pos.unrealizedPnL.toFixed(0)}` : "—"}
      </span>
      {/* Señal + stop */}
      <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, opacity: inStrategy && isPricesStale ? 0.4 : 1 }}>
        {inStrategy ? (
          <>
            <ActionBadge action={isPricesStale ? "HOLD" : matchedItem.action} />
            <span style={{ fontSize: 8.5, color: isPricesStale ? GRAY : RED, fontWeight: 700 }}>
              {(() => {
                const v = !isPricesStale && matchedItem.action !== "HOLD" ? matchedItem.adjustedStopPct : matchedItem.stopPct;
                return v != null ? `-${v}%` : "—";
              })()}
            </span>
            {isPricesStale && <span style={{ color: RED, fontSize: 9 }}>⚠</span>}
          </>
        ) : (
          <span style={{ fontSize: 8, color: "#475569", background: "rgba(255,255,255,0.04)", borderRadius: 3, padding: "2px 6px", whiteSpace: "nowrap" }}>
            Fuera del ranking
          </span>
        )}
      </span>
    </div>
  );
}

function PortfolioTotalRow({ posValue, cash, accountTotal, approx }: { posValue: number; cash: number | null; accountTotal: number | null; approx?: boolean }) {
  const fmtM = (v: number) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const total = accountTotal ?? (cash != null ? posValue + cash : null);
  const investedPct = total && total > 0 ? Math.min(100, (posValue / total) * 100) : null;
  return (
    <div
      title="Importes ≈ mezcla EUR/USD sin conversión FX"
      style={{
        display: "grid", gridTemplateColumns: PORT_GRID, gap: 6, alignItems: "center",
        padding: "7px 12px",
        borderTop: "1px solid rgba(245,158,11,0.2)",
        background: "rgba(245,158,11,0.05)",
        fontSize: 10, fontWeight: 800,
      }}
    >
      <span style={{ color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 9 }}>Total invertido</span>
      <span />
      <span />
      <span style={{ ...cellNum, color: TEXT }}>{approx ? "≈" : ""}{fmtM(posValue)}</span>
      <span />
      <span style={{ textAlign: "right", fontSize: 8.5, color: "#94a3b8", fontWeight: 600 }}>
        {cash != null && <>Efectivo <span style={{ color: GREEN, fontWeight: 800 }}>{fmtM(cash)}</span></>}
        {total != null && <> · Cuenta <span style={{ color: TEXT, fontWeight: 800 }}>{fmtM(total)}</span></>}
        {investedPct != null && <> · <span style={{ color: ACCENT, fontWeight: 800 }}>{investedPct.toFixed(0)}% inv.</span></>}
      </span>
    </div>
  );
}

// ── Alineación con SUPREME ────────────────────────────────────────────────────
// Compara la cartera cargada con el objetivo del sistema (deployPct ya escalado
// por vol-target + reparto del top-2). Necesita el efectivo (input del usuario,
// persistido en localStorage) para calcular pesos reales sobre la cuenta total.

function AlignmentSummary({
  portfolio,
  items,
  deployPct,
  onUpdate,
  isPricesStale,
}: {
  portfolio: IBKPortfolio;
  items: Optimal2026ItemWithSignal[];
  deployPct: number;
  onUpdate: (p: IBKPortfolio) => void;
  isPricesStale?: boolean;
}) {
  const [cashInput, setCashInput] = useState<string>(portfolio.cashBalance != null ? String(portfolio.cashBalance) : "");
  // BUG FIX (26-jul): el input guardaba el efectivo de la carga ANTERIOR aunque se hiciera
  // Limpiar + nueva carga (useState solo inicializa al montar). Sincronizar con cada carga.
  useEffect(() => {
    setCashInput(portfolio.cashBalance != null ? String(portfolio.cashBalance) : "");
  }, [portfolio.loadedAt, portfolio.cashBalance]);

  const posValue = portfolio.positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  // Guard defensivo (además del de finishLoad, por si hay datos viejos en localStorage):
  // accountTotal < posiciones es incoherente → ignorarlo.
  const acctTotal = portfolio.accountTotal != null && portfolio.accountTotal >= posValue * 0.98
    ? portfolio.accountTotal : null;
  // Efectivo: el de la foto (auto) → o derivado de cuenta total − invertido → o manual
  const cash = portfolio.cashBalance
    ?? (acctTotal != null && posValue > 0 ? Math.max(0, Math.round(acctTotal - posValue)) : null);
  const fmtMoney = (v: number) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  // AUDIT FIX: el ✎ ponía cashBalance=null, pero con accountTotal el cash se re-derivaba
  // y el formulario nunca aparecía — el botón quedaba muerto. Estado de edición explícito.
  const [editing, setEditing] = useState(false);

  const saveCash = () => {
    const v = parseFloat(cashInput.replace(",", "."));
    onUpdate({ ...portfolio, cashBalance: isFinite(v) && v >= 0 ? v : null });
    setEditing(false);
  };

  if (editing || cash == null || posValue <= 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(245,158,11,0.1)", background: "rgba(245,158,11,0.02)" }}>
        <span style={{ fontSize: 9, color: "#94a3b8", flex: 1 }}>
          💡 Introduce tu <strong style={{ color: TEXT }}>efectivo disponible</strong> para ver la alineación de tu cartera con SUPREME (pesos reales vs objetivo)
        </span>
        <input
          type="number"
          inputMode="decimal"
          placeholder="ej. 16900"
          value={cashInput}
          onChange={(e) => setCashInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveCash(); }}
          style={{
            width: 90, fontSize: 10, padding: "3px 6px",
            background: "rgba(255,255,255,0.05)", color: TEXT,
            border: `1px solid ${ACCENT_BORDER}`, borderRadius: 4,
          }}
        />
        <button onClick={saveCash} style={{ fontSize: 9, fontWeight: 700, color: ACCENT, background: ACCENT_GLOW, border: `1px solid ${ACCENT_BORDER}`, borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>
          OK
        </button>
      </div>
    );
  }

  // Total de cuenta: el leído de la foto manda (es el oficial de IBK); si no, invertido + efectivo
  const total = acctTotal ?? (posValue + cash);
  const investedPct = (posValue / total) * 100;
  const sysPicks = items.filter(it => it.allocationPct > 0);
  const heldSyms = new Set(portfolio.positions.map(p => p.symbol.toUpperCase()));
  const overlap = sysPicks.filter(it => heldSyms.has(it.symbol.split(".")[0].toUpperCase()));

  return (
    <div style={{ padding: "7px 12px", borderBottom: "1px solid rgba(245,158,11,0.1)", background: "rgba(245,158,11,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>⚖ Alineación con SUPREME</span>
        <span style={{ fontSize: 9, color: GRAY }}>
          Cuenta {acctTotal != null ? "📷" : "≈"} <span style={{ color: TEXT, fontWeight: 700 }}>{fmtMoney(total)}</span>
        </span>
        <span style={{ fontSize: 9, color: GRAY }}>
          Pendiente de invertir: <span style={{ color: GREEN, fontWeight: 700 }}>{fmtMoney(cash)}</span>
        </span>
        <span style={{
          fontSize: 8, fontWeight: 700, borderRadius: 3, padding: "1px 5px",
          color: overlap.length === sysPicks.length && sysPicks.length > 0 ? GREEN : overlap.length > 0 ? YELLOW : RED,
          background: "rgba(255,255,255,0.04)",
        }}>
          Coincidencia top-{sysPicks.length || 2}: {overlap.length}/{sysPicks.length || 2}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setEditing(true)}
          title="Corregir el efectivo manualmente"
          style={{ fontSize: 8, color: GRAY, background: "transparent", border: "1px solid rgba(100,116,139,0.25)", borderRadius: 3, padding: "1px 5px", cursor: "pointer" }}
        >
          ✎ {fmtMoney(cash)}
        </button>
      </div>

      {/* Barras: invertido actual vs objetivo del sistema */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 8, color: GRAY, width: 52, flexShrink: 0 }}>Invertido</span>
          <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, investedPct)}%`, background: "#94a3b8", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: TEXT, width: 40, textAlign: "right" }}>{investedPct.toFixed(1)}%</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 8, color: GRAY, width: 52, flexShrink: 0 }}>Sistema</span>
          <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, deployPct)}%`, background: ACCENT, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT, width: 40, textAlign: "right" }}>{deployPct}%</span>
        </div>
      </div>

      {/* Objetivo por valor del sistema vs lo que tienes */}
      {sysPicks.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 5 }}>
          {sysPicks.map(it => {
            const base = it.symbol.split(".")[0].toUpperCase();
            const held = portfolio.positions.find(p => p.symbol.toUpperCase() === base);
            const heldVal = held?.marketValue ?? 0;
            const targetVal = total * it.allocationPct / 100;
            const gap = targetVal - heldVal;
            return (
              <span key={it.symbol} style={{ fontSize: 8.5, color: "#94a3b8" }}>
                <strong style={{ color: held ? GREEN : YELLOW }}>{base}</strong>
                {" "}objetivo {fmtMoney(targetVal)} ({it.allocationPct}%) · tienes {fmtMoney(heldVal)}
                {Math.abs(gap) > total * 0.01 && (
                  <span style={{ color: gap > 0 ? YELLOW : ORANGE, fontWeight: 700 }}>
                    {" "}({gap > 0 ? "faltan" : "sobran"} {fmtMoney(Math.abs(gap))})
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {/* ── Plan de acción sistemático (mandato 25-jul: entradas/salidas/balanceo en cada foto) ── */}
      <SystemActionPlan portfolio={portfolio} items={items} total={total} isPricesStale={isPricesStale} />

      <div style={{ fontSize: 7, color: "#334155", marginTop: 3 }}>
        Importes ≈ sin conversión EUR/USD. Objetivo = cuenta × asignación del sistema (régimen + vol-target del último scan). Ideas, no asesoramiento.
      </div>
    </div>
  );
}

// ── Plan de acción sistemático ────────────────────────────────────────────────
// Traducción de la alineación a MOVIMIENTOS concretos con importes, priorizando
// el efectivo antes que ventas forzadas. Con precios obsoletos se oculta (norma).

function SystemActionPlan({
  portfolio,
  items,
  total,
  isPricesStale,
}: {
  portfolio: IBKPortfolio;
  items: Optimal2026ItemWithSignal[];
  total: number;
  isPricesStale?: boolean;
}) {
  const fmtMoney = (v: number) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (isPricesStale) {
    return (
      <div style={{ fontSize: 8, color: RED, marginTop: 5 }}>
        ⚠ Plan de acción oculto — precios no en tiempo real (no fiable).
      </div>
    );
  }
  const sysPicks = items.filter(it => it.allocationPct > 0);
  const rankedSyms = new Set(items.map(it => it.symbol.split(".")[0].toUpperCase()));
  const plan: { icon: string; color: string; text: string }[] = [];

  // 1) Entradas / ampliaciones hacia el objetivo del sistema (desde efectivo)
  for (const it of sysPicks) {
    const base = it.symbol.split(".")[0].toUpperCase();
    const held = portfolio.positions.find(p => p.symbol.toUpperCase() === base);
    const gap = total * it.allocationPct / 100 - (held?.marketValue ?? 0);
    if (gap > total * 0.01) {
      plan.push({
        icon: held ? "▲" : "＋", color: GREEN,
        text: `${held ? "Ampliar" : "Entrar en"} ${base} ~${fmtMoney(gap)} (hasta el ${it.allocationPct}% objetivo) · stop ${it.action !== "HOLD" && it.adjustedStopPct != null ? it.adjustedStopPct : it.stopPct ?? "—"}%`,
      });
    } else if (gap < -total * 0.01) {
      plan.push({ icon: "▼", color: ORANGE, text: `Reducir ${base} ~${fmtMoney(Math.abs(gap))} (sobre el objetivo del sistema)` });
    }
  }

  // 2) Posiciones fuera del sistema: mantener SOLO con trailing puesto
  const outside = portfolio.positions.filter(p => !rankedSyms.has(p.symbol.toUpperCase()));
  if (outside.length > 0) {
    plan.push({
      icon: "🛡", color: YELLOW,
      text: `${outside.map(p => p.symbol).join(", ")}: fuera del sistema — mantener solo con trailing stop activo; el sistema no ampliaría aquí`,
    });
  }

  // 3) Aprendizaje: evolución del P&L entre fotos consecutivas
  const hist = loadPortfolioHistory();
  if (hist.length >= 2) {
    const prev = hist[hist.length - 2], curr = hist[hist.length - 1];
    if (prev.totalPnL != null && curr.totalPnL != null) {
      const d = curr.totalPnL - prev.totalPnL;
      plan.push({
        icon: "📈", color: d >= 0 ? GREEN : RED,
        text: `Desde la foto anterior (${new Date(prev.at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })}): P&L ${d >= 0 ? "+" : ""}${d.toFixed(0)} · ${hist.length} fotos registradas (histórico de aprendizaje)`,
      });
    }
  }

  if (plan.length === 0) return null;
  return (
    <div style={{ marginTop: 6, padding: "5px 8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(245,158,11,0.12)", borderRadius: 5 }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>
        📋 Plan sistemático
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {plan.map((p, i) => (
          <div key={i} style={{ fontSize: 8.5, color: "#94a3b8", lineHeight: 1.5 }}>
            <span style={{ color: p.color, fontWeight: 800 }}>{p.icon}</span> {p.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function PortfolioSection({
  portfolio,
  items,
  onClear,
  isPricesStale,
  deployPct,
  onUpdate,
}: {
  portfolio: IBKPortfolio;
  items: Optimal2026ItemWithSignal[];
  onClear: () => void;
  isPricesStale?: boolean;
  deployPct: number;
  onUpdate: (p: IBKPortfolio) => void;
}) {
  const isPhoto = portfolio.source === "IBK_PHOTO";
  // AUDIT FIX (26-jul): total ÚNICO sin gate — el antiguo allHaveValue ponía el TOTAL a 0
  // si una posición perdía el precio en OCR, contradiciendo a la Alineación (que sumaba sin
  // gate) dos secciones más arriba. Ahora TODAS las secciones usan la MISMA suma; si falta
  // algún valor, el símbolo "≈" ya comunica que es aproximado.
  const totalValue = portfolio.positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const someMissingValue = portfolio.positions.some(p => p.marketValue == null);
  const totalPnL = portfolio.positions.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0);
  void totalPnL;

  return (
    <div style={{
      margin: "0",
      borderTop: `1px solid ${ACCENT_BORDER}`,
    }}>
      {/* Portfolio header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 12px",
        background: "rgba(245,158,11,0.06)",
        borderBottom: "1px solid rgba(245,158,11,0.12)",
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: ACCENT }}>📋 CARTERA IBK</span>
        <span style={{ fontSize: 9, color: GRAY }}>{portfolio.positions.length} posiciones</span>
        {isPhoto && (
          <span
            title="Cargada por FOTO con OCR: tickers y cantidades suelen leerse bien, pero precios y P&L pueden venir mal de la imagen. Para datos exactos usa el CSV de IBK."
            style={{
              fontSize: 8, fontWeight: 700, color: YELLOW,
              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 3, padding: "1px 5px",
            }}
          >
            📷 OCR — verifica los datos
          </span>
        )}
        {/* AUDIT FIX: los chips "Valor:"/"P&L:" duplicaban (y podían contradecir) la fila
            TOTAL de la tabla — eliminados; la fila TOTAL es la única fuente. */}
        <span style={{ flex: 1 }} />
        <button
          onClick={onClear}
          style={{
            fontSize: 8, color: GRAY, background: "transparent",
            border: "1px solid rgba(100,116,139,0.3)", borderRadius: 3, padding: "2px 6px",
            cursor: "pointer",
          }}
        >
          Limpiar
        </button>
        <span style={{ fontSize: 7, color: "#475569" }}>
          {new Date(portfolio.loadedAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Alineación con el sistema */}
      <AlignmentSummary portfolio={portfolio} items={items} deployPct={deployPct} onUpdate={onUpdate} isPricesStale={isPricesStale} />

      {/* Tabla de posiciones: cabecera + filas + TOTAL.
          AUDIT FIX (HIGH): en móvil (375px) la rejilla desbordaba y amputaba la columna
          Señal·Stop — contenedor con scroll horizontal propio (patrón terminal) y ancho
          mínimo para que las columnas nunca se aplasten. */}
      {(() => {
        const acct = portfolio.accountTotal != null && portfolio.accountTotal >= totalValue * 0.98
          ? portfolio.accountTotal : null;
        const cash = portfolio.cashBalance ?? (acct != null ? Math.max(0, Math.round(acct - totalValue)) : null);
        return (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 470 }}>
              <PortfolioHeaderRow />
              {portfolio.positions.map((pos) => {
                const matched = items.find(it => it.symbol.split(".")[0].toUpperCase() === pos.symbol.toUpperCase());
                return (
                  <PortfolioRow
                    key={pos.symbol}
                    pos={pos}
                    matchedItem={matched}
                    isPricesStale={isPricesStale}
                    accountTotal={acct ?? (cash != null ? totalValue + cash : null)}
                  />
                );
              })}
              <PortfolioTotalRow posValue={totalValue} cash={cash} accountTotal={acct} approx={someMissingValue} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Countdown 15:00 Canarias ──────────────────────────────────────────────────

function AutoScanCountdown({ onAutoScan }: { onAutoScan: () => void }) {
  const [minsLeft, setMinsLeft] = useState(minutesToNext15);
  const [inWindow, setInWindow] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const mins = minutesToNext15();
      setMinsLeft(mins);
      const win = mins === 0;
      setInWindow(win);
      if (win && !firedRef.current) {
        firedRef.current = true;
        // Check both markets open before firing
        const mkt = getRegionalMarketStates();
        if (mkt.europe === "OPEN" && mkt.unitedStates === "OPEN") {
          const todayKey = new Date().toISOString().slice(0, 10);
          try {
            const lastKey = localStorage.getItem("o26_auto_scan_15h_date");
            if (lastKey !== todayKey) {
              localStorage.setItem("o26_auto_scan_15h_date", todayKey);
              onAutoScan();
            }
          } catch { onAutoScan(); } // fail-open: fire even if localStorage unavailable
        }
      }
      // Reset firedRef when window exits (>4 min after 15h)
      if (!win) firedRef.current = false;
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [onAutoScan]);

  const h = Math.floor(minsLeft / 60);
  const m = minsLeft % 60;
  const label = inWindow ? "AUTO-SCAN ACTIVO" : h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <span style={{
      fontSize: 9, fontWeight: 800,
      color: inWindow ? GREEN : GRAY,
      background: inWindow ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
      border: `1px solid ${inWindow ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
      borderRadius: 4, padding: "2px 7px",
    }}>
      {inWindow ? "●" : "⏱"} 15:00 Canarias: {label}
    </span>
  );
}

// ── Market mode badge ─────────────────────────────────────────────────────────

function MarketModeBadge({ isPricesStale }: { isPricesStale?: boolean }) {
  const mkt = getRegionalMarketStates();
  const isLive = mkt.marketHours === "OPEN";
  const color = isPricesStale ? RED : isLive ? GREEN : GRAY;
  const bg = isPricesStale ? "rgba(248,113,113,0.12)" : isLive ? "rgba(16,185,129,0.1)" : "rgba(100,116,139,0.1)";
  const border = isPricesStale ? "rgba(248,113,113,0.4)" : isLive ? "rgba(16,185,129,0.25)" : "rgba(100,116,139,0.2)";
  const label = isPricesStale ? "⚠ PRECIO OBSOLETO" : isLive ? "● EN VIVO" : "◉ ÚLTIMO CIERRE";
  return (
    <span style={{ fontSize: 8, fontWeight: 700, color, background: bg, border: `1px solid ${border}`, borderRadius: 3, padding: "1px 5px" }}>
      {label}
    </span>
  );
}

// ── OOS Stat ──────────────────────────────────────────────────────────────────

function OosStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
      <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color }}>{value}</span>
    </span>
  );
}

// ── Semi-active comparison ────────────────────────────────────────────────────

function SemiActiveComparison() {
  const m = SEMIACTIVE_COMPARISON.monthly;
  const s = SEMIACTIVE_COMPARISON.semiActive;
  const spy = SEMIACTIVE_COMPARISON.spy;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 8, color: ACCENT, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Backtest real 10 años · 603 tickers · 118 variantes probadas
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1 }}>
        {[
          { lbl: "Solo mensual", data: m, accent: GRAY },
          { lbl: "⚡ SUPREME (real)", data: s, accent: GREEN },
          { lbl: "SPY (ref)", data: spy, accent: GRAY },
        ].map(({ lbl, data, accent }) => (
          <div key={lbl} style={{
            padding: "5px 7px",
            background: `${accent}08`,
            border: `1px solid ${accent}20`,
            borderRadius: 5,
          }}>
            <div style={{ fontSize: 7, color: accent, fontWeight: 700, marginBottom: 3 }}>{lbl}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <OosStat label="CAGR" value={`+${data.cagr}%`} color={accent} />
              <OosStat label="MaxDD" value={`-${data.maxDD}%`} color={RED} />
              <OosStat label="MAR" value={data.mar.toFixed(2)} color={accent} />
              <OosStat label="Sharpe" value={data.sharpe.toFixed(2)} color={accent} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 7, color: "#334155", marginTop: 4, lineHeight: 1.5 }}>
        {SEMIACTIVE_COMPARISON.note} Mejora real depende de slippage, IRPF y ejecución.
        No es asesoramiento financiero.
      </div>
    </div>
  );
}

// ── Portfolio upload ──────────────────────────────────────────────────────────

function PortfolioUpload({ onLoad, onScanAfterLoad }: { onLoad: (p: IBKPortfolio) => void; onScanAfterLoad?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocrPct, setOcrPct] = useState<number | null>(null); // null = sin OCR en curso

  const finishLoad = useCallback((
    positions: IBKPosition[],
    source: IBKPortfolio["source"],
    summary?: { accountTotal: number | null; totalCash: number | null },
  ) => {
    if (positions.length === 0) {
      alert("No se encontraron posiciones.\n\n• Foto: usa una captura de pantalla nítida de la lista de posiciones de IBK.\n• CSV: exporta desde IBK → Informes → Estado de cuenta.");
      return;
    }
    // BUG FIX (26-jul): objeto SIEMPRE nuevo — nunca heredar el efectivo de una carga
    // anterior (tras "Limpiar" quedaba el importe viejo). El efectivo se lee AUTO de la
    // propia foto ("Total efectivo") o, si no aparece, se deriva de cuenta − invertido.
    const posValue = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
    // AUDIT FIX: un accountTotal MENOR que la suma de posiciones es imposible (OCR malo:
    // dígito perdido u otro número colado) — descartarlo ANTES de que genere "Pendiente 0",
    // porcentajes >100% u órdenes "Reducir" falsas. Margen 2% por redondeos/FX.
    const accountTotal =
      summary?.accountTotal != null && summary.accountTotal >= posValue * 0.98
        ? summary.accountTotal
        : null;
    const cashBalance =
      summary?.totalCash
      ?? (accountTotal != null && posValue > 0 ? Math.max(0, Math.round(accountTotal - posValue)) : null);
    const portfolio: IBKPortfolio = {
      positions,
      loadedAt: new Date().toISOString(),
      source,
      cashBalance,
      accountTotal,
    };
    savePortfolioToStorage(portfolio);
    onLoad(portfolio);
    // SCAN PREVIO AUTOMÁTICO (petición 26-jul): al cargar la cartera se lanza un scan
    // fresco para que los % objetivo del plan salgan de datos actuales, no de un ranking viejo.
    onScanAfterLoad?.();
  }, [onLoad, onScanAfterLoad]);

  // MULTI-ARCHIVO (25-jul, petición de Sergi): la cartera de IBK a veces no cabe en una
  // captura — se pueden seleccionar VARIAS fotos (y/o CSV) a la vez desde carrete/Archivos.
  // Se procesan en secuencia, se fusionan las posiciones (primer símbolo gana) y se carga todo.
  const readCsvFile = (file: File): Promise<IBKPosition[]> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        resolve(typeof text === "string" && text ? parseIBKPortfolio(text) : []);
      };
      reader.onerror = () => resolve([]);
      reader.readAsText(file, "utf-8");
    });

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const isImage = (f: File) => f.type.startsWith("image/") || /\.(png|jpe?g|heic|heif|webp)$/i.test(f.name);
    const nImages = files.filter(isImage).length;
    let imagesDone = 0;
    let anyPhoto = false;
    const all: IBKPosition[] = [];
    const failed: string[] = [];
    let summary: { accountTotal: number | null; totalCash: number | null } = { accountTotal: null, totalCash: null };
    if (nImages > 0) setOcrPct(0);
    try {
      for (const f of files) {
        if (isImage(f)) {
          anyPhoto = true;
          try {
            // Progreso agregado entre todas las fotos: (hechas + progreso actual) / total
            const res = await parseImagePortfolio(f, (pct) =>
              setOcrPct(Math.round(((imagesDone + pct / 100) / nImages) * 100)),
            );
            // AUDIT FIX: una foto borrosa NO lanza — el OCR devuelve texto basura y el parser
            // 0 posiciones. Sin esto, se cargaba MEDIA cartera en silencio como si fuera completa.
            if (res.positions.length === 0) failed.push(f.name);
            all.push(...res.positions);
            // El resumen de cuenta (total + efectivo) suele estar en la PRIMERA captura
            if (summary.accountTotal == null && res.summary.accountTotal != null) summary.accountTotal = res.summary.accountTotal;
            if (summary.totalCash == null && res.summary.totalCash != null) summary.totalCash = res.summary.totalCash;
          } catch { failed.push(f.name); }
          imagesDone++;
        } else {
          const positions = await readCsvFile(f);
          if (positions.length === 0) failed.push(f.name);
          all.push(...positions);
        }
      }
    } finally { setOcrPct(null); }

    // Fusionar por símbolo (si el mismo ticker sale en dos capturas, gana la primera lectura)
    const merged = new Map<string, IBKPosition>();
    for (const p of all) if (!merged.has(p.symbol.toUpperCase())) merged.set(p.symbol.toUpperCase(), p);

    if (failed.length > 0 && merged.size === 0) {
      alert(`No se pudo leer: ${failed.join(", ")}. Si es HEIC, haz mejor capturas de pantalla (PNG) e inténtalo de nuevo.`);
      return;
    }
    if (failed.length > 0) {
      alert(`Aviso: no se pudo leer ${failed.join(", ")} — se cargó el resto (${merged.size} posiciones).`);
    }
    finishLoad([...merged.values()], anyPhoto ? "IBK_PHOTO" : "IBK_CSV", summary);
  }, [finishLoad]);

  const busy = ocrPct !== null;

  return (
    <div style={{
      padding: "8px 12px",
      borderTop: `1px solid ${ACCENT_BORDER}`,
      background: "rgba(245,158,11,0.03)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 9, color: "#94a3b8", flex: 1 }}>
          Carga tu cartera IBK (CSV o foto/captura) para ver P&L y acciones por posición
        </span>
        {/* SIN atributo accept (fix 26-jul, mismo bug que el CSV del 25-jul): con accept,
            iOS deja en gris ("desconectadas") las fotos de Archivos cuyo MIME no casa
            exactamente (HEIC exportados, capturas de otras apps). El filtrado real lo hace
            handleFiles por extensión/contenido, y un archivo no reconocido solo produce
            un aviso — nunca datos malos. */}
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) handleFiles(fs); e.target.value = ""; }}
        />
        <button
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          disabled={busy}
          style={{
            fontSize: 9, fontWeight: 700, color: busy ? GRAY : ACCENT,
            background: busy ? "rgba(100,116,139,0.08)" : ACCENT_GLOW,
            border: `1px solid ${busy ? "rgba(100,116,139,0.2)" : ACCENT_BORDER}`,
            borderRadius: 5, padding: "4px 10px", cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? `🔍 Leyendo fotos… ${ocrPct}%` : "📂 Cargar CSV / 📷 Fotos"}
        </button>
      </div>
      <div style={{ fontSize: 7, color: "#334155", marginTop: 4 }}>
        📷 Fotos: capturas de pantalla de tus posiciones en la app IBK (carrete, Archivos o cámara) —
        puedes seleccionar VARIAS a la vez si la cartera no cabe en una; se fusionan solas.
        CSV: IBK → Informes → Estado de cuenta → Exportar. Todo se procesa y guarda SOLO en tu
        dispositivo (localStorage + OCR local), nunca se envía al servidor.
      </div>
    </div>
  );
}

// ── Stale data alarm ─────────────────────────────────────────────────────────
// Se muestra cuando el mercado está ABIERTO pero los precios no se han actualizado
// en los últimos 5 min (>3 ciclos de enriquecimiento fallidos). En ese caso los
// análisis intraday (HOLD/TIGHTEN/ROTATE/EXIT) no son fiables y se bloquean.

function StaleDataAlarm() {
  return (
    <div style={{
      padding: "10px 14px",
      background: "rgba(248,113,113,0.12)",
      borderTop: "none",
      borderBottom: "3px solid #f87171",
      borderLeft: "4px solid #f87171",
      borderRight: "none",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>🚨</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#f87171", letterSpacing: "0.03em" }}>
            ALERTA — MERCADO ABIERTO: PRECIOS NO EN TIEMPO REAL
          </div>
          <div style={{ fontSize: 9, color: "#fca5a5", marginTop: 3, lineHeight: 1.6 }}>
            Los precios llevan <strong style={{ color: "#f87171" }}>más de 5 minutos sin actualizarse</strong>.
            Las señales intraday (HOLD / TIGHTEN / ROTATE / EXIT), trailing stops ajustados y
            recomendaciones de cartera IBK están basadas en precios obsoletos y{" "}
            <strong style={{ color: "#f87171" }}>NO SON FIABLES</strong>.
            Comprueba la conexión o pulsa "⟳ Scan O26" para recargar.
          </div>
        </div>
        <span style={{
          marginLeft: "auto", flexShrink: 0,
          fontSize: 8, fontWeight: 800, color: "#f87171",
          background: "rgba(248,113,113,0.15)",
          border: "1px solid rgba(248,113,113,0.4)",
          borderRadius: 4, padding: "3px 7px",
          animation: "pulse 1.5s infinite",
        }}>
          ⛔ NO FIABLE
        </span>
      </div>
    </div>
  );
}

// ── Scan button + progress bar ────────────────────────────────────────────────

function ScanProgressBar({ progress }: { progress: number }) {
  return (
    <div style={{ padding: "6px 14px", borderBottom: `1px solid ${ACCENT_BORDER}`, background: "rgba(245,158,11,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: ACCENT, fontWeight: 700 }}>
          ⟳ Escaneando universo Optimal2026…
        </span>
        <span style={{ fontSize: 9, color: ACCENT, fontWeight: 800, marginLeft: "auto" }}>{progress}%</span>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${ACCENT}, #fbbf24)`,
          borderRadius: 2,
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

interface Optimal2026PanelProps {
  data: Optimal2026Result;
  onAutoScan?: () => void;
  onScan?: () => Promise<void>;
  scanProgress?: number | null;
}

export function Optimal2026Panel({ data, onAutoScan, onScan, scanProgress }: Optimal2026PanelProps) {
  const [portfolio, setPortfolio] = useState<IBKPortfolio | null>(() => loadPortfolioFromStorage());
  // Fuerza re-render cada 60s para re-evaluar staleness aunque no lleguen nuevos datos
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const isScanning = scanProgress !== null && scanProgress !== undefined;

  const handlePortfolioLoad = useCallback((p: IBKPortfolio) => setPortfolio(p), []);
  const handlePortfolioUpdate = useCallback((p: IBKPortfolio) => {
    savePortfolioToStorage(p);
    setPortfolio(p);
  }, []);
  const handlePortfolioClear = useCallback(() => {
    clearPortfolioFromStorage();
    clearPortfolioHistory(); // limpieza TOTAL: sin restos de sesiones anteriores (fix 31-jul)
    setPortfolio(null);
  }, []);

  const handleAutoScan = useCallback(() => {
    onAutoScan?.();
  }, [onAutoScan]);

  const rawItems = data.items ?? [];
  const items = enrichWithIntradaySignals(rawItems);
  const mkt = getRegionalMarketStates();
  const isLive = mkt.marketHours === "OPEN";

  // ── Staleness: mercado abierto pero precio sin actualizar >5min ───────────────
  // Si el proveedor de precios falla >3 ciclos (3×90s=270s) los análisis intraday
  // no son fiables → alarma roja + bloquear señales de acción.
  const latestRefreshMs = rawItems.reduce((max, it) => {
    if (!it.priceRefreshedAt) return max;
    const t = new Date(it.priceRefreshedAt).getTime();
    return t > max ? t : max;
  }, 0);
  const STALE_MS = 5 * 60 * 1000; // 5 min = ~3 ciclos de enriquecimiento
  // AUDIT FIX: exigir rawItems.length > 0 — sin datos aún no hay nada "obsoleto" que alertar
  // (antes: primera carga en horario de mercado pintaba la alarma roja junto a "Sin datos aún")
  const isPricesStale = isLive && rawItems.length > 0
    && (latestRefreshMs === 0 || Date.now() - latestRefreshMs > STALE_MS);

  const badge = data.badge;
  const oos = data.oos;
  const regime = data.regime ?? "RISK_OFF";
  const deployPct = data.deployPct ?? 30;

  const rc = regime === "RISK_ON"
    ? { label: "RÉGIMEN: RISK-ON (SPY > EMA200)", color: GREEN, bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)", icon: "▲" }
    : { label: "RÉGIMEN: RISK-OFF (SPY < EMA200) — DEFENSIVO", color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.2)", icon: "▼" };

  const timestamp = data.cachedAtUtc
    ? new Date(data.cachedAtUtc).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  const badgeColor = badge == null ? GRAY : badge >= 66 ? GREEN : badge >= 45 ? YELLOW : badge >= 25 ? ORANGE : RED;

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
        flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: ACCENT, letterSpacing: "0.05em" }}>
              ⚡ OPTIMAL SUPREME
            </span>
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>
              Dual Momentum · Top 2 · Régimen + VT30 · Trailing bandas · Rotación
            </span>
            <MarketModeBadge isPricesStale={isPricesStale} />
          </div>
          {timestamp && (
            <div style={{ fontSize: 8, color: GRAY, marginTop: 2 }}>
              Actualizado {timestamp}
              {data.universeCount != null && (
                <span style={{ marginLeft: 6, color: "#475569" }}>· {data.universeCount.toLocaleString()} tickers</span>
              )}
            </div>
          )}
        </div>

        {/* Botón scan manual */}
        <button
          onClick={() => { if (!isScanning) onScan?.(); }}
          disabled={isScanning}
          title="Escanear universo Optimal2026 ahora (con barra de progreso)"
          style={{
            fontSize: 10, fontWeight: 800,
            color: isScanning ? GRAY : ACCENT,
            background: isScanning ? "rgba(100,116,139,0.08)" : ACCENT_GLOW,
            border: `1px solid ${isScanning ? "rgba(100,116,139,0.2)" : ACCENT_BORDER}`,
            borderRadius: 5, padding: "4px 10px",
            cursor: isScanning ? "not-allowed" : "pointer",
            opacity: isScanning ? 0.7 : 1,
          }}
        >
          {isScanning ? `⟳ ${scanProgress ?? 0}%` : "⟳ Scan O26"}
        </button>

        {/* 15:00 countdown */}
        <AutoScanCountdown onAutoScan={handleAutoScan} />

        {/* Badge reliability */}
        {badge != null && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Fiabilidad</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: badgeColor, lineHeight: 1 }}>
              {badge}<span style={{ fontSize: 9 }}>/100</span>
            </span>
          </div>
        )}

        {oos && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
            padding: "4px 8px",
            background: "rgba(245,158,11,0.08)",
            border: `1px solid ${ACCENT_BORDER}`,
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 7, color: GRAY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>CAGR OOS</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: ACCENT, lineHeight: 1 }}>+{oos.cagr}%</span>
          </div>
        )}
      </div>

      {/* ── Barra de progreso del scan manual ── */}
      {isScanning && <ScanProgressBar progress={scanProgress ?? 0} />}

      {/* ── Alarma roja: mercado abierto + precios obsoletos ── */}
      {isPricesStale && <StaleDataAlarm />}

      {/* ── Regime banner ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between",
        padding: "6px 14px",
        background: rc.bg, borderBottom: `1px solid ${rc.border}`,
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: rc.color }}>
          {rc.icon} {rc.label}
        </span>
        {data.regimeReason && (
          <span style={{ fontSize: 9, color: "#94a3b8" }}>{data.regimeReason}</span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: deployPct === 100 ? GREEN : deployPct === 0 ? RED : YELLOW,
          background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: "2px 6px",
        }}>
          Capital desplegado: {deployPct}%
        </span>
      </div>

      {/* ── Items with signals ── */}
      {items.length === 0 && (
        <div style={{ padding: "24px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: GRAY }}>Sin datos aún.</div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
            Ejecuta un scan completo (botón "Scan Todo") para calcular Optimal2026.
          </div>
        </div>
      )}

      {items.map((item) => (
        <ItemRow key={item.symbol} item={item} deployPct={deployPct} isLive={isLive} isPricesStale={isPricesStale} />
      ))}

      {/* ── Portfolio IBK ── */}
      {portfolio && portfolio.positions.length > 0 ? (
        <PortfolioSection portfolio={portfolio} items={items} onClear={handlePortfolioClear} isPricesStale={isPricesStale} deployPct={deployPct} onUpdate={handlePortfolioUpdate} />
      ) : (
        <PortfolioUpload onLoad={handlePortfolioLoad} onScanAfterLoad={onScan} />
      )}

      {/* ── Footer: OOS + semi-active comparison + disclaimer ── */}
      {items.length > 0 && (
        <div style={{
          padding: "8px 14px 10px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.15)",
        }}>
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

          <SemiActiveComparison />

          <div style={{ fontSize: 8, color: "#475569", lineHeight: 1.5, marginTop: 8 }}>
            <strong style={{ color: ACCENT }}>⚡ OPTIMAL SUPREME</strong> — módulo único consolidado: selecciona los{" "}
            <strong>2</strong> activos con mayor momentum risk-adjusted [(ret9m − ret2m) / vol3m], filtro momentum 9m
            positivo + EMA align ≥ 2. Régimen binario SPY/EMA200 (100%/30%) + <strong>vol-target 30%</strong> (ventana
            10d) que recorta exposición si la volatilidad del top-2 se dispara. <strong>Trailing ATR por bandas</strong>{" "}
            (TR 2.5× / TN 3.0× / TA 4.0×) con rotación inmediata al mejor candidato al saltar el stop, más{" "}
            <strong>revisión mensual con histéresis 1.10</strong>: rotar una posición SOLO si otro candidato la supera
            en &gt;10% de score — rotar más rápido que mensual DESTRUYE rentabilidad (probado: a diario, CAGR 10% y
            DD 54%). Señales intraday a las <strong>15:00 Canarias</strong>. Validado con 118 variantes de backtest
            (10 años, 603 tickers). Ideas, NO asesoramiento financiero. Rentabilidades pasadas no garantizan futuras.
          </div>
        </div>
      )}
    </section>
  );
}
