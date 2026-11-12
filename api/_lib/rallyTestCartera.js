/**
 * RALLY-TEST — PRECIOS PARA EL PLAN DE CARTERA (13-nov-2026, mandato de Sergi)
 * ===========================================================================
 * Para la tabla de la tarjeta "Cartera IBK": por cada ticker de la foto y del top-5
 * del último scan de Rally-Test, el CIERRE en la fecha de la foto, el cierre en la
 * fecha del scan y el último cierre disponible, más el EUR/USD de esas fechas.
 * Solo sesiones CERRADAS (la vela en curso se descarta). Si un ticker no tiene dato,
 * va con `error` y la tabla lo dice: nunca se inventa un precio.
 * Módulo propio de Rally-Test: no importa motores de otros módulos.
 */
import { cascadeHistory } from "./providerCascade.js";
import { STATIC_ASSETS_BY_EXCHANGE } from "./staticUniverse.js";

const TIMEOUT_MS = 8000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "MU" → { providerSymbol: "MU.US", name, currency } buscando en el universo estático (prioridad EE. UU.). */
export function resolverTicker(raw) {
  const t = String(raw ?? "").trim().toUpperCase();
  if (!t) return null;
  if (t.includes(".")) {
    const [code, ex] = t.split(".");
    const a = (STATIC_ASSETS_BY_EXCHANGE[ex] ?? []).find((x) => x.Code.toUpperCase() === code);
    return { ticker: code, providerSymbol: t, name: a?.Name ?? code, currency: a?.Currency ?? (ex === "US" ? "USD" : "EUR") };
  }
  const orden = ["US", ...Object.keys(STATIC_ASSETS_BY_EXCHANGE).filter((e) => e !== "US")];
  for (const ex of orden) {
    const a = (STATIC_ASSETS_BY_EXCHANGE[ex] ?? []).find((x) => x.Code.toUpperCase() === t);
    if (a) return { ticker: t, providerSymbol: `${a.Code}.${ex}`, name: a.Name, currency: a.Currency ?? "USD" };
  }
  return { ticker: t, providerSymbol: `${t}.US`, name: t, currency: "USD" };   // fuera del universo: se intenta como EE. UU.
}

function cierreEn(bars, fecha) {
  if (!fecha) return null;
  let r = null;
  for (const b of bars) { if (b.date <= fecha) r = b; else break; }
  return r ? { fecha: r.date, precio: r.close } : null;
}

async function eurusdBars() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX?range=1y&interval=1d", { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctl.signal });
    if (!r.ok) return [];
    const res = (await r.json())?.chart?.result?.[0];
    const ts = res?.timestamp ?? [], c = res?.indicators?.quote?.[0]?.close ?? [];
    const out = [];
    for (let i = 0; i < ts.length; i++) if (isNum(c[i])) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c[i] });
    return out;
  } catch { return []; } finally { clearTimeout(t); }
}

export async function buildCarteraQuotes({ tickers, fechaFoto, fechaScan }, env = {}) {
  const lista = [...new Set((tickers ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, 25);
  const foto = ISO.test(fechaFoto ?? "") ? fechaFoto : null;
  const scan = ISO.test(fechaScan ?? "") ? fechaScan : null;
  const [fx, ...hist] = await Promise.all([
    eurusdBars(),
    ...lista.map(async (raw) => {
      const r = resolverTicker(raw);
      try {
        const h = await cascadeHistory(r.providerSymbol, 400, env);
        let bars = (h?.ok ? h.bars : []).filter((b) => isNum(b?.close));
        if (h?.lastBarForming) bars = bars.slice(0, -1);
        if (!bars.length) return { ...r, error: "sin datos del proveedor" };
        const ult = bars.at(-1);
        return { ...r, cierreFoto: cierreEn(bars, foto), cierreScan: cierreEn(bars, scan), ultimo: { fecha: ult.date, precio: ult.close }, fuente: h.provider };
      } catch { return { ...r, error: "fallo de descarga" }; }
    }),
  ]);
  const avisos = [];
  if (!fx.length) avisos.push("EUR/USD no disponible: los importes en € de valores en dólares no se pueden calcular");
  for (const q of hist) if (q.error) avisos.push(`${q.ticker}: ${q.error}`);
  return {
    ok: hist.some((q) => !q.error),
    fechaFoto: foto, fechaScan: scan,
    eurusd: { foto: cierreEn(fx, foto), scan: cierreEn(fx, scan), ultimo: fx.length ? { fecha: fx.at(-1).date, precio: fx.at(-1).close } : null },
    precios: hist, avisos,
  };
}
