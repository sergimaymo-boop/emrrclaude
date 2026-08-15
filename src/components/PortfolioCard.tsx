/**
 * PortfolioCard — 📋 CARTERA IBK (carga CSV/foto → P&L + acción por posición).
 *
 * Extraído de Optimal2026Panel.tsx en la reordenación de módulos (ago-2026): el
 * usuario pidió que la carga de cartera quede como su propia tarjeta, situada
 * justo ENCIMA de OPTIMAL SUPREME (es la cartera que Supreme evalúa). Todo el
 * código de aquí es una copia LITERAL de lo que vivía dentro de Optimal2026Panel
 * — ningún cálculo cambia. La única pieza nueva es `deriveOptimal2026Display`
 * (en services/optimal2026IntradayEngine.ts), que ambos componentes comparten
 * para no poder divergir en isPricesStale/deployPct/items.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Optimal2026Result,
  IBKPosition,
  IBKPortfolio,
  IBKAccountSummary,
  PortfolioTotals,
} from "../services/optimal2026Refresh";
import {
  parseIBKPortfolio,
  parseImagePortfolio,
  parseOCRPortfolio,
  parseIBKAccountSummary,
  derivePortfolioTotals,
  savePortfolioToStorage,
  loadPortfolioFromStorage,
  clearPortfolioFromStorage,
  clearPortfolioHistory,
  loadPortfolioHistory,
} from "../services/optimal2026Refresh";
import { deriveOptimal2026Display, type Optimal2026ItemWithSignal } from "../services/optimal2026IntradayEngine";
import { ACCENT, ACCENT_GLOW, ACCENT_BORDER, GREEN, RED, ORANGE, YELLOW, GRAY, TEXT, pctColor, ActionBadge } from "./Optimal2026Panel";
import { RallyAlignmentSection } from "./RallyAlignmentCard";

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
  weightPct,
}: {
  pos: IBKPosition;
  matchedItem: Optimal2026ItemWithSignal | undefined;
  isPricesStale?: boolean;
  /** % de la cuenta YA normalizado a EUR (fxK) por el padre — cuadra con %netliq de IBK. */
  weightPct?: number | null;
}) {
  const inStrategy = !!matchedItem;
  const cur = pos.currency === "USD" ? "$" : "€";
  const name = pos.name ?? matchedItem?.name ?? null;

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

function PortfolioTotalRow({ totals, approx }: { totals: PortfolioTotals; approx?: boolean }) {
  const fmtM = (v: number) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const { invested, cash, total, fxNormalized, fxRate } = totals;
  const investedPct = total != null && total > 0 && invested != null
    ? Math.min(100, (invested / total) * 100) : null;
  return (
    <div
      title={fxNormalized
        ? `Totales en EUR (posiciones USD→EUR al FX implícito ${fxRate != null ? fxRate.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"} leído de la foto IBK)`
        : "Importes ≈ mezcla EUR/USD sin conversión FX — sube la captura de cabecera IBK (VAL. MDO. / EXCESO LIQ.) para normalizar"}
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
      <span style={{ ...cellNum, color: TEXT }}>
        {approx ? "≈" : ""}{invested != null ? fmtM(invested) : "—"}{fxNormalized ? " €" : ""}
      </span>
      <span />
      <span style={{ textAlign: "right", fontSize: 8.5, color: "#94a3b8", fontWeight: 600 }}>
        {cash != null && <>Efectivo <span style={{ color: GREEN, fontWeight: 800 }}>{fmtM(cash)}{fxNormalized ? " €" : ""}</span></>}
        {total != null && <> · Cuenta <span style={{ color: TEXT, fontWeight: 800 }}>{fmtM(total)}{fxNormalized ? " €" : ""}</span></>}
        {investedPct != null && <> · <span style={{ color: ACCENT, fontWeight: 800 }}>{investedPct.toFixed(1)}% inv.</span></>}
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

  // FUENTE ÚNICA de totales (fix 15-ago): invertido = VAL.MDO. (EUR), efectivo =
  // EXCESO LIQ., FX implícito por posición — idéntico en TODAS las secciones.
  const totals = derivePortfolioTotals(portfolio);
  const posValue = totals.posValueRaw;
  const { cash, fxK } = totals;
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
  const total = totals.total ?? (posValue + cash);
  const investedPct = total > 0 ? ((totals.invested ?? posValue) / total) * 100 : 0;
  const sysPicks = items.filter(it => it.allocationPct > 0);
  const heldSyms = new Set(portfolio.positions.map(p => p.symbol.toUpperCase()));
  const overlap = sysPicks.filter(it => heldSyms.has(it.symbol.split(".")[0].toUpperCase()));

  return (
    <div style={{ padding: "7px 12px", borderBottom: "1px solid rgba(245,158,11,0.1)", background: "rgba(245,158,11,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>⚖ Alineación con SUPREME</span>
        <span style={{ fontSize: 9, color: GRAY }}>
          Cuenta {totals.total != null ? "📷" : "≈"} <span style={{ color: TEXT, fontWeight: 700 }}>{fmtMoney(total)}{totals.fxNormalized ? " €" : ""}</span>
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
            // FX: el objetivo sale del total EUR — la tenencia cruda (USD) se convierte igual
            const heldVal = (held?.marketValue ?? 0) * fxK;
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
      <SystemActionPlan portfolio={portfolio} items={items} total={total} fxK={fxK} isPricesStale={isPricesStale} />

      <div style={{ fontSize: 7, color: "#334155", marginTop: 3 }}>
        {totals.fxNormalized
          ? "Importes en EUR (posiciones USD→EUR al FX implícito de la foto IBK)."
          : "Importes ≈ sin conversión EUR/USD."}
        {" "}Objetivo = cuenta × asignación del sistema (régimen + vol-target del último scan). Ideas, no asesoramiento.
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
  fxK = 1,
  isPricesStale,
}: {
  portfolio: IBKPortfolio;
  items: Optimal2026ItemWithSignal[];
  total: number;
  /** Factor crudo→EUR de la foto (derivePortfolioTotals) — importes comparables al total. */
  fxK?: number;
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
    const gap = total * it.allocationPct / 100 - (held?.marketValue ?? 0) * fxK;
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
  // AUDIT FIX (26-jul): total ÚNICO sin gate — si falta algún valor, el símbolo "≈" ya
  // comunica que es aproximado. Desde 15-ago los totales salen de derivePortfolioTotals
  // (fuente única, con FX implícito de la foto) — ver el bloque de la tabla más abajo.
  const someMissingValue = portfolio.positions.some(p => p.marketValue == null);

  return (
    <div style={{ margin: "0" }}>
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
        {/* Botón CLARO de borrado (mandato ago-2026): elimina fotos/datos de localStorage
            para poder subir capturas nuevas — la subida acepta cualquier archivo del iPhone. */}
        <button
          onClick={onClear}
          title="Borra la cartera cargada (fotos/CSV) de este dispositivo para subir otra nueva"
          style={{
            fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.35)", borderRadius: 4, padding: "3px 8px",
            cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          🗑 Limpiar cartera
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
        // FUENTE ÚNICA de totales/FX (fix 15-ago): mismos números que Alineación y banda Rally
        const totals = derivePortfolioTotals(portfolio);
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
                    weightPct={totals.total != null && totals.total > 0 && pos.marketValue != null
                      ? ((pos.marketValue * totals.fxK) / totals.total) * 100
                      : null}
                  />
                );
              })}
              <PortfolioTotalRow totals={totals} approx={someMissingValue} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function PortfolioUpload({
  onLoad,
  onScanAfterLoad,
  existing = null,
  compact = false,
}: {
  onLoad: (p: IBKPortfolio) => void;
  onScanAfterLoad?: () => void;
  /** Cartera ya cargada: los archivos nuevos se FUSIONAN (reintento de una foto fallida
   *  o añadir la captura de cabecera con totales) — la lectura NUEVA corrige la anterior. */
  existing?: IBKPortfolio | null;
  /** Modo banda fina bajo la tabla (cuando ya hay cartera cargada). */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocrPct, setOcrPct] = useState<number | null>(null); // null = sin OCR en curso

  const finishLoad = useCallback((
    positions: IBKPosition[],
    source: IBKPortfolio["source"],
    summary?: IBKAccountSummary,
  ) => {
    // Fusión con la cartera existente (reintento/añadir): el símbolo repetido lo CORRIGE
    // la lectura nueva; el resumen nuevo (NAV/VAL.MDO./efectivo) pisa campo a campo.
    let mergedPositions = positions;
    if (existing) {
      const m = new Map(existing.positions.map(p => [p.symbol.toUpperCase(), p]));
      for (const p of positions) m.set(p.symbol.toUpperCase(), p);
      mergedPositions = [...m.values()];
    }
    if (mergedPositions.length === 0) {
      const soloTotales = summary && (summary.accountTotal != null || summary.totalCash != null || summary.marketValue != null);
      alert(soloTotales
        ? "Se leyeron los TOTALES de la cuenta (NAV/efectivo) pero ninguna posición.\n\nSube también la(s) captura(s) con la tabla de posiciones — se fusionan solas con esta."
        : "No se encontraron posiciones.\n\n• Foto: usa una captura de pantalla nítida de la lista de posiciones de IBK.\n• CSV: exporta desde IBK → Informes → Estado de cuenta.");
      return;
    }
    // BUG FIX (26-jul): objeto SIEMPRE nuevo — nunca heredar el efectivo de una carga
    // anterior (tras "Limpiar" quedaba el importe viejo). El efectivo se lee AUTO de la
    // propia foto ("EXCESO LIQ."/"Total efectivo") o se deriva de cuenta − invertido.
    // Desde 15-ago la plausibilidad fina (NAV vs Σ posiciones con FX) vive centralizada
    // en derivePortfolioTotals — aquí solo sanidad básica (>0) antes de persistir.
    const sane = (v: number | null | undefined) =>
      v != null && Number.isFinite(v) && v >= 0 && v < 100_000_000 ? v : null;
    const accountTotal = sane(summary?.accountTotal) ?? sane(existing?.accountTotal);
    const investedValue = sane(summary?.marketValue) ?? sane(existing?.investedValue);
    const cashBalance =
      sane(summary?.totalCash)
      ?? sane(existing?.cashBalance)
      ?? (accountTotal != null && investedValue != null
        ? Math.max(0, Math.round((accountTotal - investedValue) * 100) / 100)
        : null);
    const portfolio: IBKPortfolio = {
      positions: mergedPositions,
      loadedAt: new Date().toISOString(),
      source: source === "IBK_PHOTO" || existing?.source === "IBK_PHOTO" ? "IBK_PHOTO" : source,
      cashBalance,
      accountTotal,
      investedValue,
    };
    savePortfolioToStorage(portfolio);
    onLoad(portfolio);
    // SCAN PREVIO AUTOMÁTICO (petición 26-jul): al cargar la cartera se lanza un scan
    // fresco para que los % objetivo del plan salgan de datos actuales, no de un ranking viejo.
    onScanAfterLoad?.();
  }, [onLoad, onScanAfterLoad, existing]);

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
    // FIX 15-ago (fallo real IMG_9360): cada fallo lleva su MOTIVO, y una foto que solo
    // trae la CABECERA DE TOTALES (NAV/VAL.MDO./EXCESO LIQ., 0 posiciones) es un ÉXITO
    // — es la fuente del FX; antes se marcaba "no se pudo leer" por no tener filas.
    const failed: { name: string; reason: string }[] = [];
    const photoTexts: string[] = [];
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
            const s = res.summary;
            const hasTotals = s.accountTotal != null || s.totalCash != null || s.marketValue != null;
            // AUDIT FIX: una foto borrosa NO lanza — el OCR devuelve texto basura y el parser
            // 0 posiciones. Sin esto, se cargaba MEDIA cartera en silencio como si fuera completa.
            if (res.positions.length === 0 && !hasTotals) {
              failed.push({ name: f.name, reason: "el OCR no reconoció ni posiciones ni totales (¿borrosa o recortada?) — repite la captura" });
            }
            photoTexts.push(res.text);
          } catch (err) {
            failed.push({ name: f.name, reason: err instanceof Error ? err.message : "error de OCR desconocido — reintenta" });
          }
          imagesDone++;
        } else {
          const positions = await readCsvFile(f);
          if (positions.length === 0) failed.push({ name: f.name, reason: "CSV sin posiciones reconocibles (usa el export de IBK → Informes → Estado de cuenta)" });
          all.push(...positions);
        }
      }
    } finally { setOcrPct(null); }

    // AUDIT FIX (multi-foto): las FOTOS se parsean COMBINADAS en un único texto — así el
    // mapa de columnas de la cabecera (que suele estar solo en la 1ª captura) se aplica
    // también a las fotos de continuación, y el resumen de cuenta se busca en todas.
    let summary: IBKAccountSummary = { accountTotal: null, totalCash: null, marketValue: null };
    if (photoTexts.length > 0) {
      const combined = photoTexts.join("\n");
      all.push(...parseOCRPortfolio(combined));
      summary = parseIBKAccountSummary(combined);
    }

    // Fusionar por símbolo (si el mismo ticker sale en dos capturas, gana la primera lectura)
    const merged = new Map<string, IBKPosition>();
    for (const p of all) if (!merged.has(p.symbol.toUpperCase())) merged.set(p.symbol.toUpperCase(), p);

    const gotTotals = summary.accountTotal != null || summary.totalCash != null || summary.marketValue != null;
    const failList = failed.map((f) => `• ${f.name}: ${f.reason}`).join("\n");
    if (failed.length > 0 && merged.size === 0 && !gotTotals && !existing) {
      alert(`No se pudo leer ningún archivo:\n\n${failList}\n\nCorrige y vuelve a intentarlo con el mismo botón.`);
      return;
    }
    if (failed.length > 0) {
      alert(
        `Aviso — ${failed.length} archivo(s) con problema:\n\n${failList}\n\n` +
        `Se cargó el resto (${merged.size} posiciones${gotTotals ? " + totales de cuenta" : ""}). ` +
        `Puedes volver a subir SOLO ese archivo con "＋ Añadir fotos" — la lectura nueva corrige la anterior.`,
      );
    }
    finishLoad([...merged.values()], anyPhoto ? "IBK_PHOTO" : "IBK_CSV", summary);
  }, [finishLoad, existing]);

  const busy = ocrPct !== null;

  return (
    <div style={{
      padding: compact ? "5px 12px" : "8px 12px",
      background: "rgba(245,158,11,0.03)",
      borderTop: compact ? "1px solid rgba(245,158,11,0.10)" : undefined,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: compact ? 8 : 9, color: "#94a3b8", flex: 1, minWidth: 160 }}>
          {compact
            ? "¿Falló una foto o falta la captura de totales (NAV · VAL. MDO. · EXCESO LIQ.)? Añádela aquí — la lectura nueva corrige la anterior"
            : "Carga tu cartera IBK (CSV o foto/captura) para ver P&L y acciones por posición"}
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
            whiteSpace: "nowrap",
          }}
        >
          {busy ? `🔍 Leyendo fotos… ${ocrPct}%` : compact ? "＋ Añadir fotos" : "📂 Cargar CSV / 📷 Fotos"}
        </button>
      </div>
      {!compact && (
        <div style={{ fontSize: 7, color: "#334155", marginTop: 4 }}>
          📷 Fotos: capturas de pantalla de tus posiciones en la app IBK (carrete, Archivos o cámara) —
          puedes seleccionar VARIAS a la vez si la cartera no cabe en una; se fusionan solas.
          Incluye la captura de CABECERA con los totales (NAV · VAL. MDO. · EXCESO LIQ.): es la que
          permite convertir USD→EUR y cuadrar los % con la app.
          CSV: IBK → Informes → Estado de cuenta → Exportar. Todo se procesa y guarda SOLO en tu
          dispositivo (localStorage + OCR local), nunca se envía al servidor.
        </div>
      )}
    </div>
  );
}

// ── Tarjeta pública — cabecera propia estilo terminal (consistente con Rally/SP500) ──

export function PortfolioCard({ data, onScanAfterLoad }: { data: Optimal2026Result; onScanAfterLoad?: () => void }) {
  const [portfolio, setPortfolio] = useState<IBKPortfolio | null>(() => loadPortfolioFromStorage());

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

  // Misma derivación (items/deployPct/isPricesStale) que usa Optimal2026Panel — comparten
  // la función para que ambas tarjetas jamás muestren números distintos entre sí.
  const { items, isPricesStale, deployPct } = deriveOptimal2026Display(data);
  const hasPortfolio = !!portfolio && portfolio.positions.length > 0;

  return (
    <section style={{
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${ACCENT_BORDER}`,
      borderRadius: 10,
      marginBottom: 14,
      overflow: "hidden",
      boxShadow: "0 0 20px rgba(245,158,11,0.06), 0 2px 8px rgba(0,0,0,0.35)",
    }}>
      {/* ── Header — mismo patrón que Rally/SP500: icono + título + subtítulo ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 14px",
        background: ACCENT_GLOW,
        borderBottom: `1px solid ${ACCENT_BORDER}`,
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: ACCENT }}>
          📥 Carga de cartera IBK
        </span>
        <span style={{ fontSize: 8, fontWeight: 600, color: "#94a3b8" }}>
          {hasPortfolio ? "posiciones reales vs. objetivo de OPTIMAL SUPREME" : "sube CSV o foto para comparar contra el objetivo del sistema"}
        </span>
      </div>

      {hasPortfolio ? (
        <>
          <PortfolioSection
            portfolio={portfolio}
            items={items}
            onClear={handlePortfolioClear}
            isPricesStale={isPricesStale}
            deployPct={deployPct}
            onUpdate={handlePortfolioUpdate}
          />
          {/* Banda de REINTENTO/AÑADIR (fix 15-ago, fallo IMG_9360): permite volver a subir
              SOLO la foto que falló (p.ej. la de totales) sin Limpiar toda la cartera —
              la lectura nueva se fusiona y corrige a la anterior. */}
          <PortfolioUpload
            compact
            existing={portfolio}
            onLoad={handlePortfolioLoad}
            onScanAfterLoad={onScanAfterLoad}
          />
        </>
      ) : (
        <PortfolioUpload onLoad={handlePortfolioLoad} onScanAfterLoad={onScanAfterLoad} />
      )}

      {/* ── ⚖ Alineación cartera real ↔ Rally Leaders (banda inferior de ESTA tarjeta,
          mandato ago-2026): informativa, solo lee el último scan persistido de Rally.
          Al vivir dentro de la misma tarjeta comparte el estado de cartera sin lecturas
          duplicadas de localStorage, y queda pegada al módulo Rally que referencia. ── */}
      <RallyAlignmentSection portfolio={portfolio} />
    </section>
  );
}
