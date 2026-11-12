/**
 * PLAN DE CARTERA IBK ↔ ÚLTIMO SCAN DE RALLY-TEST (13-nov-2026, mandato de Sergi)
 * ================================================================================
 * Junta tres cosas para la tarjeta "Cartera IBK":
 *   1. la cartera de la ÚLTIMA FOTO (unidades, efectivo, fecha) — de este dispositivo
 *      o, si no hay, del espejo del servidor;
 *   2. el top-5 y sus pesos del ÚLTIMO scan de Rally-Test;
 *   3. cierres reales en la fecha de la foto y del scan (/api/rally-test/cartera).
 * y calcula: el resultado de la cartera desde la foto hasta el scan, y las órdenes
 * (acciones a comprar/vender) para dejar la cartera igual que el scan, usando el dinero
 * de lo invertido + lo que se libere al vender + el efectivo que el usuario decida añadir.
 *
 * Es INFORMACIÓN: el protocolo de Rally-Test solo rebalancea en la revisión trimestral o
 * si salta un stop; la tabla lo recuerda. Nada se envía al bróker.
 * Precios del OCR: NO se usan (metían la PyG como precio). Solo unidades, NAV y efectivo.
 */
import type { IBKPortfolio } from "./optimal2026Refresh";
import type { RallyTestAsset } from "./rallyTestRefresh";

const TIMEOUT_MS = 12000;

export interface CierreFechado { fecha: string; precio: number }
export interface PrecioCartera {
  ticker: string; providerSymbol: string; name: string; currency: string;
  cierreFoto?: CierreFechado | null; cierreScan?: CierreFechado | null; ultimo?: CierreFechado | null; error?: string;
}
export interface PreciosCartera {
  ok: boolean; fechaFoto: string | null; fechaScan: string | null;
  eurusd: { foto: CierreFechado | null; scan: CierreFechado | null; ultimo: CierreFechado | null };
  precios: PrecioCartera[]; avisos: string[];
}

/** Cartera de la foto en forma mínima (lo único fiable del OCR). */
export interface CarteraFoto {
  fecha: string;               // AAAA-MM-DD de la carga
  cargadaEn: string;           // ISO
  origen: "DISPOSITIVO" | "SERVIDOR";
  posiciones: { ticker: string; unidades: number; currency: string }[];
  efectivoEur: number | null;
  invertidoEur: number | null; // VAL.MDO. de la cabecera
  navEur: number | null;
}

export function carteraDesdeLocal(p: IBKPortfolio | null): CarteraFoto | null {
  if (!p) return null;
  const pos = (p.positions ?? []).filter((x) => x.symbol && x.quantity > 0).map((x) => ({ ticker: x.symbol.toUpperCase(), unidades: x.quantity, currency: (x.currency || "USD").toUpperCase() }));
  if (!pos.length) return null;
  return { fecha: p.loadedAt.slice(0, 10), cargadaEn: p.loadedAt, origen: "DISPOSITIVO", posiciones: pos, efectivoEur: p.cashBalance ?? null, invertidoEur: p.investedValue ?? null, navEur: p.accountTotal ?? null };
}

interface EspejoServidor { loadedAt: string; navEur?: number | null; valMdoEur?: number | null; cashEur?: number | null; positions?: { symbol: string; quantity: number; currency?: string }[] }

async function getJson<T>(url: string): Promise<T> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`HTTP ${r.status}`);
    return j as T;
  } finally { window.clearTimeout(t); }
}

export async function fetchCarteraServidor(): Promise<CarteraFoto | null> {
  const j = await getJson<{ ok: boolean; portfolio: EspejoServidor | null }>("/api/rally-scan/ibk-portfolio");
  const p = j.portfolio;
  if (!j.ok || !p?.loadedAt) return null;
  const pos = (p.positions ?? []).filter((x) => x.symbol && x.quantity > 0).map((x) => ({ ticker: x.symbol.toUpperCase(), unidades: x.quantity, currency: (x.currency || "USD").toUpperCase() }));
  if (!pos.length) return null;
  return { fecha: p.loadedAt.slice(0, 10), cargadaEn: p.loadedAt, origen: "SERVIDOR", posiciones: pos, efectivoEur: p.cashEur ?? null, invertidoEur: p.valMdoEur ?? null, navEur: p.navEur ?? null };
}

export async function fetchPreciosCartera(tickers: string[], fechaFoto: string, fechaScan: string): Promise<PreciosCartera> {
  const q = `tickers=${encodeURIComponent(tickers.join(","))}&foto=${fechaFoto}&scan=${fechaScan}`;
  return getJson<PreciosCartera>(`/api/rally-test/cartera?${q}`);
}

// ── cálculo (funciones puras) ─────────────────────────────────────────────────

const fxDe = (currency: string, eurusd: number | null): number | null => (currency === "EUR" ? 1 : currency === "USD" ? eurusd : null);
/** IBK admite fracciones en EE. UU.; en Europa, acciones enteras. */
const redondea = (u: number, currency: string): number => (currency === "USD" ? Math.floor(u * 100) / 100 : Math.floor(u));

/**
 * El OCR pierde a veces el separador decimal (foto del 10-oct: MU 242 en vez de 2,42).
 * Si Σ unidades × cierre de la foto no cuadra con el VAL.MDO. de la cabecera, se busca la
 * posición que, dividida por 10/100/1000, lo deja cuadrado (±15%). Devuelve las correcciones.
 */
export function sanearUnidades(c: CarteraFoto, p: PreciosCartera): { cartera: CarteraFoto; correcciones: string[] } {
  const fx0 = p.eurusd.foto?.precio ?? p.eurusd.scan?.precio ?? null;
  const val = (pos: CarteraFoto["posiciones"]) => pos.reduce((s, x) => {
    const q = p.precios.find((y) => y.ticker === x.ticker), px = q?.cierreFoto?.precio, fx = fxDe(x.currency, fx0);
    return px && fx ? s + (x.unidades * px) / fx : s;
  }, 0);
  const ref = c.invertidoEur;
  if (!ref || ref <= 0) return { cartera: c, correcciones: [] };
  let pos = c.posiciones.map((x) => ({ ...x }));
  const correcciones: string[] = [];
  for (let vuelta = 0; vuelta < 3 && Math.abs(val(pos) / ref - 1) > 0.15; vuelta++) {
    let mejor: { i: number; k: number; err: number } | null = null;
    pos.forEach((x, i) => [10, 100, 1000].forEach((k) => {
      const prueba = pos.map((y, j) => (j === i ? { ...y, unidades: y.unidades / k } : y));
      const err = Math.abs(val(prueba) / ref - 1);
      if (!mejor || err < mejor.err) mejor = { i, k, err };
    }));
    const m = mejor as { i: number; k: number; err: number } | null;
    if (!m || m.err > 0.15) break;
    correcciones.push(`${pos[m.i].ticker}: la foto dice ${pos[m.i].unidades} acciones y no cuadra con el valor de la cuenta; se usan ${+(pos[m.i].unidades / m.k).toFixed(4)} (decimal perdido en la lectura)`);
    pos = pos.map((y, j) => (j === m.i ? { ...y, unidades: y.unidades / m.k } : y));
  }
  return { cartera: { ...c, posiciones: pos }, correcciones };
}

export interface FilaResultado { ticker: string; name: string; unidades: number; precioFoto: number | null; precioScan: number | null; currency: string; valorFotoEur: number | null; valorScanEur: number | null; pct: number | null; enTop5: boolean }
export interface FilaOrden {
  ticker: string; name: string; currency: string; precio: number; pesoObjetivo: number;
  actuales: number; objetivo: number; ordenes: number;      // ordenes > 0 compra, < 0 venta
  accion: "COMPRAR" | "VENDER" | "MANTENER"; importeEur: number; valorObjetivoEur: number;
}
export interface PlanCartera {
  resultado: { filas: FilaResultado[]; valorFotoEur: number; valorScanEur: number; pct: number | null; fxFoto: number | null; fxScan: number | null };
  ordenes: FilaOrden[];
  totales: { valorActualEur: number; efectivoUsado: number; capital: number; ventasEur: number; comprasEur: number; efectivoFinal: number | null; restoSinInvertir: number };
  faltan: string[];
}

export function calcularPlan(c: CarteraFoto, top10: RallyTestAsset[], p: PreciosCartera, efectivoUsado: number): PlanCartera {
  const fxFoto = p.eurusd.foto?.precio ?? null, fxScan = p.eurusd.scan?.precio ?? p.eurusd.ultimo?.precio ?? null;
  const top5 = top10.filter((a) => (a.suggestedWeightPct ?? 0) > 0);
  const precioScan = (t: string): number | null => {
    const a = top5.find((x) => x.ticker.toUpperCase() === t);
    if (a?.metrics?.lastClose) return a.metrics.lastClose;
    const q = p.precios.find((y) => y.ticker === t);
    return q?.cierreScan?.precio ?? q?.ultimo?.precio ?? null;
  };
  const faltan: string[] = [];
  // 1) resultado desde la foto hasta el scan
  const filas: FilaResultado[] = c.posiciones.map((x) => {
    const q = p.precios.find((y) => y.ticker === x.ticker);
    const pf = q?.cierreFoto?.precio ?? null, ps = precioScan(x.ticker);
    const ff = fxDe(x.currency, fxFoto), fs = fxDe(x.currency, fxScan);
    if (!pf || !ps || !ff || !fs) faltan.push(x.ticker);
    return {
      ticker: x.ticker, name: q?.name ?? x.ticker, unidades: x.unidades, precioFoto: pf, precioScan: ps, currency: x.currency,
      valorFotoEur: pf && ff ? (x.unidades * pf) / ff : null, valorScanEur: ps && fs ? (x.unidades * ps) / fs : null,
      pct: pf && ps ? ps / pf - 1 : null, enTop5: top5.some((a) => a.ticker.toUpperCase() === x.ticker),
    };
  });
  const ok = filas.filter((f) => f.valorFotoEur != null && f.valorScanEur != null);
  const valorFotoEur = ok.reduce((s, f) => s + (f.valorFotoEur ?? 0), 0), valorScanEur = ok.reduce((s, f) => s + (f.valorScanEur ?? 0), 0);
  // 2) órdenes para igualar el scan
  const valorActualEur = filas.reduce((s, f) => s + (f.valorScanEur ?? 0), 0);
  const capital = valorActualEur + Math.max(0, efectivoUsado);
  const ordenes: FilaOrden[] = [];
  for (const a of top5) {
    const t = a.ticker.toUpperCase(), precio = a.metrics?.lastClose ?? precioScan(t), cur = (a.currency || "USD").toUpperCase(), fx = fxDe(cur, fxScan);
    if (!precio || !fx) { faltan.push(t); continue; }
    const peso = a.suggestedWeightPct ?? 0, valorObjetivoEur = (capital * peso) / 100;
    const objetivo = redondea((valorObjetivoEur * fx) / precio, cur);
    const actuales = c.posiciones.find((x) => x.ticker === t)?.unidades ?? 0;
    const ordenesN = +(objetivo - actuales).toFixed(cur === "USD" ? 2 : 0);
    const accion = Math.abs(ordenesN) < (cur === "USD" ? 0.01 : 1) ? "MANTENER" : ordenesN > 0 ? "COMPRAR" : "VENDER";
    ordenes.push({ ticker: t, name: a.name ?? t, currency: cur, precio, pesoObjetivo: peso, actuales, objetivo, ordenes: accion === "MANTENER" ? 0 : ordenesN, accion, importeEur: (Math.abs(ordenesN) * precio) / fx, valorObjetivoEur });
  }
  for (const f of filas) {
    if (f.enTop5) continue;
    const fx = fxDe(f.currency, fxScan);
    if (!f.precioScan || !fx) continue;
    ordenes.push({ ticker: f.ticker, name: f.name, currency: f.currency, precio: f.precioScan, pesoObjetivo: 0, actuales: f.unidades, objetivo: 0, ordenes: -f.unidades, accion: "VENDER", importeEur: (f.unidades * f.precioScan) / fx, valorObjetivoEur: 0 });
  }
  const orden = { VENDER: 0, COMPRAR: 1, MANTENER: 2 } as const;
  ordenes.sort((x, y) => orden[x.accion] - orden[y.accion] || y.importeEur - x.importeEur);
  const ventasEur = ordenes.filter((o) => o.accion === "VENDER").reduce((s, o) => s + o.importeEur, 0);
  const comprasEur = ordenes.filter((o) => o.accion === "COMPRAR").reduce((s, o) => s + o.importeEur, 0);
  const valorObjetivo = ordenes.reduce((s, o) => s + (o.objetivo * o.precio) / (fxDe(o.currency, fxScan) ?? 1), 0);
  return {
    resultado: { filas, valorFotoEur, valorScanEur, pct: valorFotoEur > 0 ? valorScanEur / valorFotoEur - 1 : null, fxFoto, fxScan },
    ordenes,
    totales: { valorActualEur, efectivoUsado: Math.max(0, efectivoUsado), capital, ventasEur, comprasEur, efectivoFinal: c.efectivoEur != null ? c.efectivoEur + ventasEur - comprasEur : null, restoSinInvertir: capital - valorObjetivo },
    faltan: [...new Set(faltan)],
  };
}
