/**
 * CarteraPlan — "CARTERA IBK ↔ ÚLTIMO SCAN" (13-nov-2026, mandato de Sergi).
 * Dentro de la tarjeta Cartera IBK: (1) resultado de la cartera de la última foto hasta el
 * último scan de Rally-Test y (2) las órdenes (acciones) para dejarla igual que el scan,
 * con el dinero de lo invertido + lo que liberan las ventas + el efectivo que decidas añadir.
 * Cálculo en services/carteraPlan.ts. Es información: nada se envía al bróker.
 * Norma de la casa: las pérdidas se muestran SOLO en %, nunca en euros.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IBKPortfolio } from "../services/optimal2026Refresh";
import {
  type CarteraFoto, type PreciosCartera, calcularPlan, carteraDesdeLocal, fetchCarteraServidor, fetchPreciosCartera, sanearUnidades,
} from "../services/carteraPlan";
import {
  type RallyTestAsset, type RallyTestReview, RALLY_TEST_ACTUALIZADO, continueRallyTestScan, fetchLastRallyTestScan, formatReviewDate, formatSessionDate, scanAgeInfo, startRallyTestScan,
} from "../services/rallyTestRefresh";

const GOLD = "#f59e0b", GREEN = "#22c55e", RED = "#ef4444", SLATE = "#94a3b8", DIM = "#64748b", TXT = "#e2e8f0";
const eur = (v: number) => `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1).replace(".", ",")}%`);
const num = (v: number, d = 2) => v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const px = (v: number | null, cur: string) => (v == null ? "—" : `${num(v)}${cur === "EUR" ? " €" : " $"}`);
/** Ganancia en € y %; pérdida SOLO en % (norma de Sergi). */
const resultado = (euros: number, p: number | null) => (euros >= 0 ? `+${eur(euros)} · ${pct(p)}` : pct(p));
const colorDe = (v: number | null) => (v == null ? SLATE : v >= 0 ? GREEN : RED);

const th: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 11, color: TXT, padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", borderTop: "1px solid rgba(255,255,255,0.05)" };

export function CarteraPlan({ portfolio }: { portfolio: IBKPortfolio | null }) {
  const [servidor, setServidor] = useState<CarteraFoto | null>(null);
  const [top10, setTop10] = useState<RallyTestAsset[]>([]);
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [review, setReview] = useState<RallyTestReview | null>(null);
  const [precios, setPrecios] = useState<PreciosCartera | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [escaneando, setEscaneando] = useState<number | null>(null);
  const [efectivo, setEfectivo] = useState(0);
  const vivo = useRef(true);

  const local = useMemo(() => carteraDesdeLocal(portfolio), [portfolio]);
  const base = local ?? servidor;
  const fechaScan = top10[0]?.metrics?.lastBarDate ?? scanAt?.slice(0, 10) ?? null;

  const cargarScan = useCallback(async () => {
    try {
      const last = await fetchLastRallyTestScan();
      if (!vivo.current) return;
      setTop10((last?.top10 ?? []) as RallyTestAsset[]);
      setScanAt(last?.scanCompletedAtUtc ?? null);
      setReview(last?.review ?? null);
    } catch { if (vivo.current) setError("no se pudo leer el último scan de Rally-Test"); }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void cargarScan();
    if (!local) fetchCarteraServidor().then((c) => { if (vivo.current) setServidor(c); }).catch(() => {});
    const onScan = () => { void cargarScan(); };
    window.addEventListener(RALLY_TEST_ACTUALIZADO, onScan);
    return () => { vivo.current = false; window.removeEventListener(RALLY_TEST_ACTUALIZADO, onScan); };
  }, [cargarScan, local]);

  useEffect(() => {
    if (!base || !fechaScan || !top10.length) return;
    const tickers = [...new Set([...base.posiciones.map((x) => x.ticker), ...top10.filter((a) => (a.suggestedWeightPct ?? 0) > 0).map((a) => a.ticker.toUpperCase())])];
    setCargando(true); setError(null);
    fetchPreciosCartera(tickers, base.fecha, fechaScan)
      .then((p) => { if (vivo.current) setPrecios(p); })
      .catch(() => { if (vivo.current) setError("no se pudieron descargar los precios (servidor o proveedor caído) — la tabla no se calcula sin datos reales"); })
      .finally(() => { if (vivo.current) setCargando(false); });
  }, [base, fechaScan, top10]);

  const escanear = useCallback(async () => {
    if (escaneando != null) return;
    setEscaneando(0); setError(null);
    try {
      let r = await startRallyTestScan(), n = 0;
      while (vivo.current && !r.isRallyFinal && r.rallyToken && n++ < 40) { setEscaneando(r.coveragePercent ?? 0); r = await continueRallyTestScan(r.rallyToken); }
      if (!r.isRallyFinal) throw new Error(r.message ?? "el scan no terminó");
      window.dispatchEvent(new Event(RALLY_TEST_ACTUALIZADO));
    } catch (e) { if (vivo.current) setError(`el scan de Rally-Test falló: ${e instanceof Error ? e.message : "error"}`); }
    finally { if (vivo.current) setEscaneando(null); }
  }, [escaneando]);

  const saneado = useMemo(() => (base && precios ? sanearUnidades(base, precios) : null), [base, precios]);
  const efectivoDisp = Math.max(0, base?.efectivoEur ?? 0);
  const plan = useMemo(() => (saneado && precios && top10.length ? calcularPlan(saneado.cartera, top10, precios, Math.min(efectivo, efectivoDisp)) : null), [saneado, precios, top10, efectivo, efectivoDisp]);
  const age = scanAgeInfo(scanAt);

  const cab = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "6px 12px", borderTop: "1px solid rgba(245,158,11,0.25)", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(245,158,11,0.06)" }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: GOLD }}>⇄ Tu cartera frente al último scan de Rally-Test</span>
      <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 9, color: DIM }}>
        {base && <span>foto <b style={{ color: TXT }}>{formatSessionDate(base.fecha)}</b>{base.origen === "SERVIDOR" ? " (copia del servidor)" : ""}</span>}
        {age && <span>scan <b style={{ color: age.stale ? GOLD : TXT }}>{age.when}</b> ({age.age})</span>}
        <button onClick={() => void escanear()} disabled={escaneando != null} style={{ fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 5, cursor: escaneando != null ? "wait" : "pointer", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.5)", color: GOLD }}>
          {escaneando != null ? `⟳ ${escaneando}%` : "⟳ Escanear Rally-Test"}
        </button>
      </span>
    </div>
  );

  if (!base) return (<div>{cab}<div style={{ padding: "10px 12px", fontSize: 11, color: SLATE }}>Sube las fotos de IBK con la <b>tabla de posiciones</b> para ver el resultado de la cartera y las órdenes que igualan el último scan.</div></div>);

  return (
    <div>
      {cab}
      {error && <div role="alert" style={{ padding: "6px 12px", fontSize: 10.5, color: "#fecaca" }}>⚠ {error}</div>}
      {cargando && !plan && <div style={{ padding: "8px 12px", fontSize: 10.5, color: SLATE }}>Calculando con cierres reales…</div>}
      {plan && (
        <>
          {/* ── 1. RESULTADO DESDE LA FOTO ── */}
          <div style={{ padding: "8px 12px 2px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em" }}>Resultado desde la foto</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: colorDe(plan.resultado.pct), fontVariantNumeric: "tabular-nums" }}>{resultado(plan.resultado.valorScanEur - plan.resultado.valorFotoEur, plan.resultado.pct)}</span>
            <span style={{ fontSize: 10.5, color: SLATE }}>posiciones: {eur(plan.resultado.valorFotoEur)} el {formatSessionDate(precios?.precios[0]?.cierreFoto?.fecha ?? base.fecha)} → <b style={{ color: TXT }}>{eur(plan.resultado.valorScanEur)}</b> al cierre del {formatSessionDate(fechaScan)} · en €, incluye el efecto del dólar</span>
          </div>
          <div style={{ overflowX: "auto", padding: "0 6px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={{ ...th, textAlign: "left" }}>Valor</th><th style={th}>Acciones</th><th style={th}>Cierre foto</th><th style={th}>Cierre scan</th><th style={th}>Variación</th><th style={th}>Valor hoy</th><th style={th}>Scan</th></tr></thead>
              <tbody>
                {plan.resultado.filas.map((f) => (
                  <tr key={f.ticker}>
                    <td style={{ ...td, textAlign: "left" }}><b>{f.ticker}</b> <span style={{ color: DIM, fontSize: 9.5 }}>{f.name}</span></td>
                    <td style={td}>{num(f.unidades, f.unidades % 1 ? 2 : 0)}</td>
                    <td style={td}>{px(f.precioFoto, f.currency)}</td>
                    <td style={td}>{px(f.precioScan, f.currency)}</td>
                    <td style={{ ...td, color: colorDe(f.pct), fontWeight: 800 }}>{pct(f.pct)}</td>
                    <td style={td}>{f.valorScanEur != null ? eur(f.valorScanEur) : "—"}</td>
                    <td style={{ ...td, color: f.enTop5 ? GREEN : RED, fontSize: 9, fontWeight: 800 }}>{f.enTop5 ? "EN TOP-5" : "FUERA"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 2. ÓRDENES PARA IGUALAR EL SCAN ── */}
          <div style={{ padding: "10px 12px 4px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em" }}>Órdenes para igualar el scan</span>
            <span style={{ fontSize: 10.5, color: SLATE }}>Efectivo a añadir:</span>
            {[0, 0.25, 0.5, 1].map((k) => {
              const v = Math.round(efectivoDisp * k), activo = Math.round(Math.min(efectivo, efectivoDisp)) === v;
              return (<button key={k} onClick={() => setEfectivo(v)} style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 5, cursor: "pointer", border: `1px solid ${activo ? GOLD : "rgba(255,255,255,0.15)"}`, background: activo ? "rgba(245,158,11,0.15)" : "transparent", color: activo ? GOLD : SLATE }}>{k === 0 ? "nada" : k === 1 ? `todo (${eur(efectivoDisp)})` : `${k * 100}%`}</button>);
            })}
            <input inputMode="numeric" value={efectivo ? String(Math.round(efectivo)) : ""} placeholder="otra cifra €" onChange={(e) => setEfectivo(Math.max(0, Math.min(efectivoDisp, Number(e.target.value.replace(/\D/g, "")) || 0)))}
              style={{ width: 92, fontSize: 10.5, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "#0b0f17", color: TXT }} />
          </div>
          <div style={{ overflowX: "auto", padding: "0 6px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={{ ...th, textAlign: "left" }}>Orden</th><th style={{ ...th, textAlign: "left" }}>Valor</th><th style={th}>Precio</th><th style={th}>Tienes</th><th style={th}>Objetivo</th><th style={th}>Acciones</th><th style={th}>Importe</th><th style={th}>Peso</th></tr></thead>
              <tbody>
                {plan.ordenes.map((o) => {
                  const c = o.accion === "COMPRAR" ? GREEN : o.accion === "VENDER" ? RED : SLATE;
                  return (
                    <tr key={o.ticker}>
                      <td style={{ ...td, textAlign: "left", color: c, fontWeight: 900 }}>{o.accion}</td>
                      <td style={{ ...td, textAlign: "left" }}><b>{o.ticker}</b> <span style={{ color: DIM, fontSize: 9.5 }}>{o.name}</span></td>
                      <td style={td}>{px(o.precio, o.currency)}</td>
                      <td style={td}>{num(o.actuales, o.actuales % 1 ? 2 : 0)}</td>
                      <td style={td}>{num(o.objetivo, o.objetivo % 1 ? 2 : 0)}</td>
                      <td style={{ ...td, color: c, fontWeight: 900, fontSize: 12 }}>{o.ordenes === 0 ? "—" : `${o.ordenes > 0 ? "+" : "−"}${num(Math.abs(o.ordenes), Math.abs(o.ordenes) % 1 ? 2 : 0)}`}</td>
                      <td style={{ ...td, color: c }}>{o.accion === "MANTENER" ? "—" : eur(o.importeEur)}</td>
                      <td style={td}>{o.pesoObjetivo ? `${num(o.pesoObjetivo, 1)}%` : "0%"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "8px 12px", fontSize: 10.5, color: SLATE, borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 4 }}>
            <span>Capital a repartir <b style={{ color: TXT }}>{eur(plan.totales.capital)}</b> <span style={{ color: DIM }}>(posiciones {eur(plan.totales.valorActualEur)} + efectivo {eur(plan.totales.efectivoUsado)})</span></span>
            <span style={{ color: RED }}>Ventas liberan <b>{eur(plan.totales.ventasEur)}</b></span>
            <span style={{ color: GREEN }}>Compras <b>{eur(plan.totales.comprasEur)}</b></span>
            {plan.totales.efectivoFinal != null && <span>Efectivo tras operar <b style={{ color: TXT }}>{eur(plan.totales.efectivoFinal)}</b></span>}
          </div>
          <div style={{ padding: "0 12px 10px", fontSize: 9.5, color: DIM, lineHeight: 1.55 }}>
            Orden recomendado: primero las <b style={{ color: RED }}>ventas</b> (liberan el dinero) y después las <b style={{ color: GREEN }}>compras</b>; luego una orden <b>TRAIL 45% GTC</b> sobre cada posición completa.
            Precios: cierre del {formatSessionDate(fechaScan)} (los del scan); en el bróker el precio será el del momento. Acciones con 2 decimales en EE. UU. (IBK admite fracciones), enteras en Europa.
            {review?.nextReviewDate && <> <b style={{ color: GOLD }}>Protocolo de Rally-Test:</b> {review.due ? "la revisión trimestral YA toca: esta tabla es el rebalanceo." : `la revisión trimestral es el ${formatReviewDate(review.nextReviewDate)} (faltan ${review.sessionsRemaining} sesiones); antes solo se opera si salta un stop.`}</>}
            {[...(saneado?.correcciones ?? []), ...(precios?.avisos ?? []), ...plan.faltan.map((t) => `${t}: sin precio fiable, no entra en el cálculo`)].map((a) => <div key={a} style={{ color: GOLD }}>⚠ {a}</div>)}
          </div>
        </>
      )}
    </div>
  );
}
