/**
 * RallyAlignmentCard — ⚖ ALINEACIÓN CARTERA ↔ RALLY LEADERS (mini-módulo informativo).
 *
 * Compara la cartera IBK real (fotos/CSV ya cargadas) contra los pesos sugeridos
 * del ÚLTIMO scan de Rally Leaders (suggestedWeightPct del top-10). SOLO lee el
 * resultado persistido del scan (/api/rally-scan/last vía fetchLastRallyScan) —
 * cero cambios en rallyScoreEngine/rallyRefresh, cero efecto sobre el análisis.
 *
 * Se renderiza como banda inferior de PortfolioCard (misma tarjeta visual) para
 * que "carga de cartera + alineación" se lean como UN módulo compacto, colocado
 * justo antes del módulo Rally Leaders en el dashboard.
 *
 * NORMALIZACIÓN FX (clave para que los % cuadren con los de la app IBK): los
 * marketValue parseados de las fotos vienen en su divisa cruda (USD…), pero los
 * totales de la cabecera de IBK vienen YA convertidos a la divisa base (EUR).
 * SEMÁNTICA dictada 15-ago (derivePortfolioTotals, fuente única): INVERTIDO =
 * "VAL. MDO." · EFECTIVO = "EXCESO LIQ." · TOTAL = NAV = invertido + efectivo.
 * Factor implícito k = VAL.MDO. / Σ marketValue crudos (con verificación cruzada
 * contra NAV − efectivo) — reparte la conversión proporcionalmente y hace que
 * posiciones + efectivo sumen exactamente el NAV de la foto (verificado con
 * cartera real: MU 12,17%, WDC 11,91%, HUM 7,62%, efectivo 68,3%, invertido
 * 31,7% — idénticos a los %netliq que muestra la propia app IBK).
 */
import { useEffect, useState } from "react";
import type { IBKPortfolio } from "../services/optimal2026Refresh";
import { derivePortfolioTotals } from "../services/optimal2026Refresh";
import { type RallyAsset, fetchLastRallyScan } from "../services/rallyRefresh";

const AMBER = "#f59e0b";
const GREEN = "#10b981";
const RED = "#f87171";
const SLATE = "#94a3b8";
const GRAY = "#64748b";
const TEXT = "#e2e8f0";

/** Evento que RallyPanel dispara al terminar un scan nuevo — esta tarjeta lo escucha para refrescarse. */
export const RALLY_SCAN_UPDATED_EVENT = "emrr:rally-last-scan-updated";

/** Normalización robusta de símbolo: "MU", "MU.US", "STMPA.PA" → "MU"/"STMPA". */
const baseSym = (sym: string) => sym.split(".")[0].trim().toUpperCase();

const fmt1 = (v: number) => v.toFixed(1);

interface AlignRow {
  key: string;
  label: string;
  realPct: number;
  targetPct: number | null; // null = sin objetivo (fuera del top-10)
  kind: "top10" | "outside" | "cash";
}

function DeltaChip({ delta }: { delta: number }) {
  // verde = alineado (±1pp), ámbar = infraponderado, rojo = sobreponderado
  const color = Math.abs(delta) <= 1 ? GREEN : delta < 0 ? "#fbbf24" : RED;
  const label = Math.abs(delta) <= 1 ? `✓ ${delta >= 0 ? "+" : ""}${fmt1(delta)}pp` : `${delta > 0 ? "+" : ""}${fmt1(delta)}pp`;
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 800, color, fontVariantNumeric: "tabular-nums",
      background: `${color}16`, border: `1px solid ${color}44`,
      borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0,
      minWidth: 56, textAlign: "center",
    }}>
      {label}
    </span>
  );
}

function HeaderStat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span style={{ fontSize: 7, color: GRAY, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ fontSize: 8.5, fontWeight: 800, color: GRAY, fontVariantNumeric: "tabular-nums" }}>{sub}</span>}
    </span>
  );
}

/** Fila con patrón de DOS líneas (aguanta 375px sin cortes): línea 1 = ticker + cifras
 *  + delta; línea 2 = barras emparejadas real (gris) vs objetivo (ámbar). */
function AlignBarRow({ row, maxPct }: { row: AlignRow; maxPct: number }) {
  const realW = Math.min(100, (row.realPct / maxPct) * 100);
  const targetW = row.targetPct != null ? Math.min(100, (row.targetPct / maxPct) * 100) : 0;
  const isCash = row.kind === "cash";
  const isOutside = row.kind === "outside";
  return (
    <div style={{ padding: "5px 12px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      {/* Línea 1 — identidad + cifras + delta */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: isCash ? GREEN : isOutside ? SLATE : TEXT, flexShrink: 0 }}>
          {row.label}
        </span>
        {isOutside && (
          <span style={{ fontSize: 7, fontWeight: 800, color: SLATE, background: "rgba(148,163,184,0.10)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>
            FUERA DEL TOP-10
          </span>
        )}
        <span style={{ flex: 1, minWidth: 4 }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: TEXT, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {fmt1(row.realPct)}%
        </span>
        <span style={{ fontSize: 8.5, color: GRAY, flexShrink: 0 }}>vs</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: row.targetPct != null ? AMBER : GRAY, fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 34, textAlign: "right" }}>
          {row.targetPct != null ? `${fmt1(row.targetPct)}%` : "—"}
        </span>
        {row.targetPct != null ? <DeltaChip delta={row.realPct - row.targetPct} /> : (
          <span style={{ minWidth: 56, flexShrink: 0 }} />
        )}
      </div>
      {/* Línea 2 — barras emparejadas (arriba real, abajo objetivo) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${realW}%`, background: isCash ? GREEN : "#94a3b8", borderRadius: 2 }} />
        </div>
        <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${targetW}%`, background: AMBER, borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

export function RallyAlignmentSection({ portfolio }: { portfolio: IBKPortfolio | null }) {
  const [top10, setTop10] = useState<RallyAsset[]>([]);
  const [scanAt, setScanAt] = useState<string | null>(null);

  // Carga del ÚLTIMO scan persistido de Rally: al montar, cuando RallyPanel
  // complete un scan nuevo (evento) y como red de seguridad cada 10 min.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchLastRallyScan()
        .then((last) => {
          if (!alive || !last?.top10?.length) return;
          setTop10(last.top10);
          setScanAt(last.scanCompletedAtUtc ?? null);
        })
        .catch(() => { /* informativo: conserva el estado anterior */ });
    };
    load();
    const onUpdated = () => load();
    window.addEventListener(RALLY_SCAN_UPDATED_EVENT, onUpdated);
    const timer = window.setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      window.removeEventListener(RALLY_SCAN_UPDATED_EVENT, onUpdated);
      window.clearInterval(timer);
    };
  }, []);

  if (!portfolio || portfolio.positions.length === 0) return null;

  // ── Totales + normalización FX — FUENTE ÚNICA derivePortfolioTotals (regla 15-ago):
  // INVERTIDO = "VAL. MDO." de la foto (EUR) · EFECTIVO = "EXCESO LIQ." · TOTAL = NAV.
  // Se comprueba además que VAL.MDO. y NAV−efectivo coinciden (methodsAgree).
  const totals = derivePortfolioTotals(portfolio);
  const { posValueRaw, fxK, fxNormalized, fxRate, methodsAgree } = totals;
  const cash = totals.cash;
  const total = totals.total ?? posValueRaw;
  const invested = totals.invested ?? posValueRaw;

  const realPctOf = (marketValue: number | null | undefined) =>
    total > 0 ? ((marketValue ?? 0) * fxK / total) * 100 : 0;

  const hasScan = top10.length > 0;

  // ── Filas: top-10 en orden de ranking → tenencias fuera del top-10 → efectivo ──
  const rows: AlignRow[] = [];
  const matchedPositions = new Set<string>();
  for (const asset of top10) {
    const b = baseSym(asset.ticker || asset.providerSymbol);
    const held = portfolio.positions.find((p) => baseSym(p.symbol) === b);
    if (held) matchedPositions.add(baseSym(held.symbol));
    rows.push({
      key: `t10-${b}`,
      label: b,
      realPct: held ? realPctOf(held.marketValue) : 0,
      targetPct: asset.suggestedWeightPct ?? 0,
      kind: "top10",
    });
  }
  for (const p of portfolio.positions) {
    if (matchedPositions.has(baseSym(p.symbol))) continue;
    rows.push({ key: `out-${baseSym(p.symbol)}`, label: baseSym(p.symbol), realPct: realPctOf(p.marketValue), targetPct: null, kind: "outside" });
  }
  if (cash != null && total > 0) {
    rows.push({ key: "cash", label: "EFECTIVO", realPct: (cash / total) * 100, targetPct: 0, kind: "cash" });
  }

  const investedPctReal = total > 0 ? (invested / total) * 100 : 0;
  const cashPctReal = total > 0 && cash != null ? (cash / total) * 100 : null;
  const fmtEur = (v: number) => `${Math.round(v).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fxNormalized ? " €" : ""}`;
  // % de cabecera en formato es-ES ("31,7%") — literal dictado 15-ago
  const fmtPctEs = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  // Alineación global = Σ mín(real, objetivo) por ticker del top-10 (0-100, simple y explicable).
  const alignmentPct = rows
    .filter((r) => r.kind === "top10")
    .reduce((s, r) => s + Math.min(r.realPct, r.targetPct ?? 0), 0);
  const maxPct = Math.max(10, ...rows.map((r) => Math.max(r.realPct, r.targetPct ?? 0)));

  const scanLabel = scanAt
    ? new Date(scanAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div style={{ borderTop: "1px solid rgba(245,158,11,0.2)" }}>
      {/* ── Mini-cabecera de la banda ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "6px 12px",
        background: "rgba(245,158,11,0.05)",
        borderBottom: "1px solid rgba(245,158,11,0.12)",
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: AMBER, letterSpacing: "0.06em" }}>
          ⚖ ALINEACIÓN CARTERA ↔ RALLY LEADERS
        </span>
        <span style={{ fontSize: 8, fontWeight: 600, color: GRAY }}>informativo · no afecta al análisis</span>
        {hasScan && (
          <span style={{
            fontSize: 8, fontWeight: 800, borderRadius: 3, padding: "1px 6px",
            color: alignmentPct >= 66 ? GREEN : alignmentPct >= 33 ? "#fbbf24" : RED,
            background: "rgba(255,255,255,0.04)", fontVariantNumeric: "tabular-nums",
          }}>
            Alineación {fmt1(alignmentPct)}%
          </span>
        )}
        <span style={{ flex: 1 }} />
        {scanLabel && <span style={{ fontSize: 7.5, color: "#475569" }}>scan Rally {scanLabel}</span>}
      </div>

      {!hasScan ? (
        <div style={{ padding: "10px 12px", fontSize: 9.5, color: SLATE }}>
          Sin scan de Rally reciente — pulsa <b style={{ color: AMBER }}>⟳ Escanear universo</b> en el módulo
          Rally Leaders (justo debajo) para calcular los pesos objetivo del top-10.
        </div>
      ) : (
        <>
          {/* ── Cabecera del módulo (regla dictada 15-ago): INVERTIDO · EFECTIVO · TOTAL en EUR ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-around", gap: 10, flexWrap: "wrap",
            padding: "8px 12px 5px",
          }}>
            <HeaderStat label="Invertido" value={fmtEur(invested)} sub={fmtPctEs(investedPctReal)} color={TEXT} />
            <HeaderStat label="Efectivo" value={cash != null ? fmtEur(cash) : "—"} sub={cashPctReal != null ? fmtPctEs(cashPctReal) : undefined} color={GREEN} />
            <HeaderStat label="Total cartera" value={fmtEur(total)} color={AMBER} />
          </div>
          {/* Línea de transparencia del FX implícito */}
          <div style={{ fontSize: 7.5, color: GRAY, textAlign: "center", padding: "0 12px 6px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            {fxNormalized && fxRate != null ? (
              <>
                posiciones USD→EUR al FX implícito {fxRate.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                {methodsAgree === true && <span style={{ color: GREEN }}> · VAL. MDO. ↔ NAV−efectivo ✓</span>}
                {methodsAgree === false && <span style={{ color: RED }}> · ⚠ VAL. MDO. y NAV−efectivo difieren &gt;2% — revisa la foto de cabecera</span>}
              </>
            ) : (
              <>importes ≈ sin conversión FX — sube la captura de cabecera IBK (NAV · VAL. MDO. · EXCESO LIQ.) para normalizar</>
            )}
          </div>

          {/* ── Leyenda de barras ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px 2px", fontSize: 7.5, color: GRAY }}>
            <span><span style={{ display: "inline-block", width: 14, height: 4, background: "#94a3b8", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />% REAL de la cartera</span>
            <span><span style={{ display: "inline-block", width: 14, height: 4, background: AMBER, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />% OBJETIVO del último scan Rally</span>
          </div>

          {/* ── Barras emparejadas por ticker ── */}
          <div>
            {rows.map((r) => <AlignBarRow key={r.key} row={r} maxPct={maxPct} />)}
          </div>

          <div style={{ fontSize: 7, color: "#334155", lineHeight: 1.5, padding: "5px 12px 8px" }}>
            Alineación = Σ mín(real, objetivo) por ticker del top-10 (100% = cartera clavada al módulo). Delta en
            puntos porcentuales: <span style={{ color: GREEN }}>✓ verde</span> alineado (±1pp) ·{" "}
            <span style={{ color: "#fbbf24" }}>ámbar</span> infraponderado · <span style={{ color: RED }}>rojo</span> sobreponderado.
            {fxNormalized
              ? " Los % reales se normalizan con el VAL. MDO. y el efectivo (EXCESO LIQ.) de la propia foto IBK — absorbe la conversión USD→EUR y cuadra con los %netliq de la app; posiciones + efectivo suman exactamente el NAV."
              : " Importes ≈ sin conversión de divisa (falta la captura de cabecera con NAV/VAL. MDO./EXCESO LIQ.)."}
            {" "}Solo compara contra Rally Leaders. Ideas, no asesoramiento.
          </div>
        </>
      )}
    </div>
  );
}
