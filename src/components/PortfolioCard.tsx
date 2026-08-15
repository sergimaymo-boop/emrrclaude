/**
 * PortfolioCard — 📥 CARGA DE CARTERA IBK (diseño SIMPLIFICADO, mandato 15-ago).
 *
 * El usuario dictó: en este módulo NO se muestra ninguna relación de tickers
 * (ni tabla de posiciones ni barras por ticker). SOLO: carga de fotos/CSV,
 * las 3 cifras en EUR (INVERTIDO · EFECTIVO · TOTAL) y UNA barra apilada
 * invertido-vs-efectivo. Antes de todo, la AUDITORÍA de la carga: una línea
 * por foto con lo que se leyó o el motivo exacto del fallo.
 *
 * SEMÁNTICA (derivePortfolioTotals, fuente única): INVERTIDO = "VAL. MDO." de
 * la cabecera IBK (EUR) · EFECTIVO = "EXCESO LIQ." · TOTAL = NAV. La foto de
 * CABECERA por sí sola basta (aunque no traiga tabla). Las fotos de tabla se
 * siguen parseando (uso interno: FX implícito por Σ pos×último, histórico de
 * aprendizaje) pero no se pintan. La banda de alineación con Rally
 * (RallyAlignmentCard.tsx) deja de renderizarse aquí — el código se conserva.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Optimal2026Result,
  IBKPosition,
  IBKPortfolio,
  IBKAccountSummary,
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
} from "../services/optimal2026Refresh";
import { ACCENT, ACCENT_GLOW, ACCENT_BORDER, GREEN, RED, YELLOW, GRAY, TEXT } from "./Optimal2026Panel";

const fmtEurInt = (v: number) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtPctEs = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// ── Vista SIMPLE: 3 cifras + UNA barra apilada + FX + auditoría ───────────────

function BigStat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 90 }}>
      <span style={{ fontSize: 8, color: GRAY, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 19, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ fontSize: 10.5, fontWeight: 800, color: GRAY, fontVariantNumeric: "tabular-nums" }}>{sub}</span>}
    </span>
  );
}

function SimplePortfolioView({
  portfolio,
  onClear,
  onUpdate,
}: {
  portfolio: IBKPortfolio;
  onClear: () => void;
  onUpdate: (p: IBKPortfolio) => void;
}) {
  const totals = derivePortfolioTotals(portfolio);
  const { invested, cash, total, fxNormalized, fxRate, methodsAgree, investedFromHeader } = totals;
  // Los importes están en EUR cuando salen de la cabecera IBK (VAL.MDO./NAV);
  // sin ella son mezcla de divisas y se marcan con ≈.
  const eur = investedFromHeader || portfolio.accountTotal != null;
  const investedPct = invested != null && total != null && total > 0 ? (invested / total) * 100 : null;
  const cashPct = cash != null && total != null && total > 0 ? (cash / total) * 100 : null;

  const [cashInput, setCashInput] = useState("");
  useEffect(() => { setCashInput(""); }, [portfolio.loadedAt]);
  const saveCash = () => {
    const v = parseFloat(cashInput.replace(",", "."));
    if (isFinite(v) && v >= 0) onUpdate({ ...portfolio, cashBalance: v });
  };

  const fmtVal = (v: number | null) =>
    v == null ? "—" : `${eur ? "" : "≈"}${fmtEurInt(v)}${eur ? " €" : ""}`;

  return (
    <div>
      {/* Fila de control: fuente + fecha + limpiar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
        background: "rgba(245,158,11,0.05)", borderBottom: "1px solid rgba(245,158,11,0.12)",
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: ACCENT }}>📋 CARTERA IBK</span>
        {portfolio.source === "IBK_PHOTO" && (
          <span style={{ fontSize: 8, fontWeight: 700, color: YELLOW, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 3, padding: "1px 5px" }}>
            📷 OCR
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 7.5, color: "#475569" }}>
          {new Date(portfolio.loadedAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
        <button
          onClick={onClear}
          title="Borra la cartera cargada (fotos/CSV) de este dispositivo para subir otra nueva"
          style={{
            fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.35)", borderRadius: 4, padding: "3px 8px",
            cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          🗑 Limpiar
        </button>
      </div>

      {/* ── Las 3 cifras (regla dictada): INVERTIDO · EFECTIVO · TOTAL en EUR ── */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-around", gap: 10,
        flexWrap: "wrap", padding: "12px 12px 6px",
      }}>
        <BigStat label="Invertido" value={fmtVal(invested)} sub={investedPct != null ? fmtPctEs(investedPct) : undefined} color={ACCENT} />
        <BigStat label="Efectivo" value={fmtVal(cash)} sub={cashPct != null ? fmtPctEs(cashPct) : undefined} color={GREEN} />
        <BigStat label="Total cartera" value={fmtVal(total)} color={TEXT} />
      </div>

      {/* ── UNA barra apilada: invertido vs efectivo ── */}
      {investedPct != null && cashPct != null ? (
        <div style={{ padding: "4px 14px 6px" }}>
          <div style={{
            display: "flex", height: 30, borderRadius: 6, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
          }}>
            <div style={{
              width: `${Math.max(0, Math.min(100, investedPct))}%`,
              background: "linear-gradient(180deg, rgba(245,158,11,0.35), rgba(245,158,11,0.22))",
              borderRight: "1px solid rgba(0,0,0,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
            }}>
              {investedPct >= 16 && (
                <span style={{ fontSize: 10, fontWeight: 900, color: ACCENT, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  INVERTIDO {fmtPctEs(investedPct)}
                </span>
              )}
            </div>
            <div style={{
              width: `${Math.max(0, Math.min(100, cashPct))}%`,
              background: "linear-gradient(180deg, rgba(16,185,129,0.30), rgba(16,185,129,0.18))",
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
            }}>
              {cashPct >= 16 && (
                <span style={{ fontSize: 10, fontWeight: 900, color: GREEN, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  EFECTIVO {fmtPctEs(cashPct)}
                </span>
              )}
            </div>
          </div>
          {/* Leyenda para segmentos estrechos (<16% no llevan rótulo dentro) */}
          {(investedPct < 16 || cashPct < 16) && (
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 8.5, color: GRAY }}>
              <span><span style={{ color: ACCENT, fontWeight: 800 }}>■</span> Invertido {fmtPctEs(investedPct)}</span>
              <span><span style={{ color: GREEN, fontWeight: 800 }}>■</span> Efectivo {fmtPctEs(cashPct)}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 14px 8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "#94a3b8", flex: 1, minWidth: 170 }}>
            Falta el <strong style={{ color: TEXT }}>efectivo</strong> — sube la captura de CABECERA de IBK
            (NAV · VAL. MDO. · EXCESO LIQ.) o introdúcelo a mano:
          </span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="ej. 15102"
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
      )}

      {/* ── Transparencia FX ── */}
      <div style={{ fontSize: 7.5, color: GRAY, textAlign: "center", padding: "0 12px 7px" }}>
        {fxNormalized && fxRate != null ? (
          <>
            posiciones USD→EUR al FX implícito {fxRate.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
            {methodsAgree === true && <span style={{ color: GREEN }}> · VAL. MDO. ↔ NAV−efectivo ✓</span>}
            {methodsAgree === false && <span style={{ color: RED }}> · ⚠ VAL. MDO. y NAV−efectivo difieren &gt;2% — revisa la foto de cabecera</span>}
          </>
        ) : eur ? (
          <>importes de la cabecera IBK (divisa base EUR)</>
        ) : (
          <>importes ≈ sin conversión FX — sube la captura de cabecera IBK (NAV · VAL. MDO. · EXCESO LIQ.)</>
        )}
      </div>

      {/* ── Auditoría de la carga (primero auditoría, luego análisis) ── */}
      {portfolio.loadAudit && portfolio.loadAudit.length > 0 && (
        <div style={{ padding: "5px 12px 8px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: GRAY, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
            📷 Auditoría de carga
          </div>
          {portfolio.loadAudit.map((line, i) => (
            <div key={i} style={{ fontSize: 8.5, color: line.includes("✗") ? "#fca5a5" : "#94a3b8", lineHeight: 1.6, fontVariantNumeric: "tabular-nums" }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Carga de archivos (fotos/CSV) con auditoría por archivo ──────────────────

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
  /** Modo banda fina bajo la vista simple (cuando ya hay cartera cargada). */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocrPct, setOcrPct] = useState<number | null>(null); // null = sin OCR en curso

  const finishLoad = useCallback((
    positions: IBKPosition[],
    source: IBKPortfolio["source"],
    summary: IBKAccountSummary | undefined,
    audit: string[],
  ) => {
    // Fusión con la cartera existente (reintento/añadir): el símbolo repetido lo CORRIGE
    // la lectura nueva; el resumen nuevo (NAV/VAL.MDO./efectivo) pisa campo a campo.
    let mergedPositions = positions;
    if (existing) {
      const m = new Map(existing.positions.map(p => [p.symbol.toUpperCase(), p]));
      for (const p of positions) m.set(p.symbol.toUpperCase(), p);
      mergedPositions = [...m.values()];
    }
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
    const hasTotals = accountTotal != null || investedValue != null || cashBalance != null;
    // Diseño simplificado 15-ago: la foto de CABECERA sola (0 posiciones) YA es una
    // carga válida — trae las 3 cifras. Solo se rechaza si no hay NADA utilizable.
    if (mergedPositions.length === 0 && !hasTotals) {
      alert("No se pudo leer nada útil.\n\n• Sube la captura de CABECERA de IBK (NAV · VAL. MDO. · EXCESO LIQ.) — con ella bastan las 3 cifras.\n• Las capturas de la tabla de posiciones se usan para la verificación FX.\n• CSV: IBK → Informes → Estado de cuenta.");
      return;
    }
    // Auditoría fusionada: si se re-sube un archivo, su línea nueva sustituye a la vieja
    const nameOf = (line: string) => line.split(":")[0];
    const newNames = new Set(audit.map(nameOf));
    const keptOld = (existing?.loadAudit ?? []).filter((l) => !newNames.has(nameOf(l)));
    const loadAudit = [...keptOld, ...audit].slice(-8);
    const portfolio: IBKPortfolio = {
      positions: mergedPositions,
      loadedAt: new Date().toISOString(),
      source: source === "IBK_PHOTO" || existing?.source === "IBK_PHOTO" ? "IBK_PHOTO" : source,
      cashBalance,
      accountTotal,
      investedValue,
      loadAudit,
    };
    savePortfolioToStorage(portfolio);
    onLoad(portfolio);
    // SCAN PREVIO AUTOMÁTICO (petición 26-jul): al cargar la cartera se lanza un scan
    // fresco para que los sistemas trabajen con datos actuales.
    onScanAfterLoad?.();
  }, [onLoad, onScanAfterLoad, existing]);

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
    const audit: string[] = [];
    let anyFail = false;
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
            const parts: string[] = [];
            if (res.positions.length > 0) parts.push(`${res.positions.length} posiciones`);
            const tots: string[] = [];
            if (s.accountTotal != null) tots.push("NAV");
            if (s.marketValue != null) tots.push("VAL.MDO.");
            if (s.totalCash != null) tots.push("EXCESO LIQ.");
            if (tots.length > 0) parts.push(`totales ${tots.join("·")}`);
            if (parts.length > 0) {
              audit.push(`${f.name}: ${parts.join(" + ")} ✓`);
            } else {
              // Motivo EXACTO: qué etiquetas faltaron (mandato 15-ago)
              anyFail = true;
              audit.push(`${f.name}: ✗ sin posiciones ni totales — no se leyó ${s.missing?.join(" ni ") ?? "nada reconocible"} (¿captura borrosa o recortada?)`);
            }
            photoTexts.push(res.text);
          } catch (err) {
            anyFail = true;
            audit.push(`${f.name}: ✗ ${err instanceof Error ? err.message : "error de OCR desconocido — reintenta"}`);
          }
          imagesDone++;
        } else {
          const positions = await readCsvFile(f);
          if (positions.length === 0) { anyFail = true; audit.push(`${f.name}: ✗ CSV sin posiciones reconocibles`); }
          else audit.push(`${f.name}: ${positions.length} posiciones ✓`);
          all.push(...positions);
        }
      }
    } finally { setOcrPct(null); }

    // Las FOTOS se parsean COMBINADAS en un único texto — así el mapa de columnas de la
    // cabecera (que suele estar solo en la 1ª captura) se aplica también a las fotos de
    // continuación, y el resumen de cuenta se busca en todas.
    let summary: IBKAccountSummary = { accountTotal: null, totalCash: null, marketValue: null };
    if (photoTexts.length > 0) {
      const combined = photoTexts.join("\n");
      all.push(...parseOCRPortfolio(combined));
      summary = parseIBKAccountSummary(combined);
    }

    // Fusionar por símbolo (si el mismo ticker sale en dos capturas, gana la primera lectura)
    const merged = new Map<string, IBKPosition>();
    for (const p of all) if (!merged.has(p.symbol.toUpperCase())) merged.set(p.symbol.toUpperCase(), p);

    if (anyFail) {
      alert(
        `Aviso — problemas de lectura:\n\n${audit.filter((l) => l.includes("✗")).join("\n")}\n\n` +
        `Puedes volver a subir SOLO ese archivo con "＋ Añadir fotos" — la lectura nueva corrige la anterior.`,
      );
    }
    finishLoad([...merged.values()], anyPhoto ? "IBK_PHOTO" : "IBK_CSV", summary, audit);
  }, [finishLoad]);

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
            ? "¿Falló una foto o falta la de totales (NAV · VAL. MDO. · EXCESO LIQ.)? Añádela aquí — la lectura nueva corrige la anterior"
            : "Sube tus capturas de IBK (o CSV) para ver el % invertido vs % en efectivo"}
        </span>
        {/* SIN atributo accept (fix 26-jul): con accept, iOS deja en gris fotos de
            Archivos cuyo MIME no casa (HEIC exportados, capturas de otras apps). */}
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
          📷 La foto CLAVE es la de CABECERA de IBK (arriba del todo: NAV grande, VAL. MDO.,
          EXCESO LIQ.) — con ella salen las 3 cifras. Puedes añadir también las capturas de la
          tabla de posiciones (verificación FX) y seleccionar varias a la vez; se fusionan solas.
          Todo se procesa y guarda SOLO en tu dispositivo (OCR local), nunca se envía al servidor.
        </div>
      )}
    </div>
  );
}

// ── Tarjeta pública — cabecera propia estilo terminal (consistente con Rally/SP500) ──

export function PortfolioCard({ data, onScanAfterLoad }: { data: Optimal2026Result; onScanAfterLoad?: () => void }) {
  void data; // la firma se conserva (App la pasa); el diseño simplificado ya no pinta señales por posición
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

  const hasPortfolio = !!portfolio && (
    portfolio.positions.length > 0
    || portfolio.investedValue != null
    || portfolio.cashBalance != null
    || portfolio.accountTotal != null
  );

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
          {hasPortfolio ? "% invertido vs % en efectivo" : "sube tus capturas IBK → % invertido vs % efectivo"}
        </span>
      </div>

      {hasPortfolio && portfolio ? (
        <>
          <SimplePortfolioView
            portfolio={portfolio}
            onClear={handlePortfolioClear}
            onUpdate={handlePortfolioUpdate}
          />
          {/* Banda de REINTENTO/AÑADIR: re-subir SOLO la foto que falló (p.ej. la de
              totales) sin Limpiar toda la cartera — la lectura nueva corrige a la anterior. */}
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
    </section>
  );
}
