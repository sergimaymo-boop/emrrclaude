/**
 * RALLY-TEST — CONTEXTO DE MERCADO (solo display · estudio 12, 12-nov-2026)
 * =========================================================================
 * Alimenta la tabla "Momento de mercado" del panel de Rally-Test: tendencia del S&P 500,
 * distancia a máximos, RSI, VIX y cómo de estirados están los 5 primeros del scan.
 * NADA de esto entra en score, selección, pesos ni trailing: el estudio 12 probó 150
 * variantes de trailing según el régimen y 24 de exposición y NINGUNA superó sus gates.
 * Es contexto para el lector, igual que la amplitud del universo. Si una fuente falla,
 * el campo va a null y se dice en `avisos` — nunca se inventa un valor.
 *
 * Módulo PROPIO del laboratorio: no importa nada de los motores de otros módulos.
 * Solo sesiones CERRADAS (la vela en curso se descarta: un precio intradía no es un cierre).
 */
import { cascadeHistory } from "./providerCascade.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v, d = 1) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function cerradas(r) {
  if (!r?.ok || !Array.isArray(r.bars)) return [];
  const bars = r.bars.filter((b) => isNum(b?.close) && b.close > 0);
  return r.lastBarForming ? bars.slice(0, -1) : bars;
}
function ema(v, n) { const k = 2 / (n + 1); let e = v[0]; for (let i = 1; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; }
/** RSI de Wilder a 14 sesiones (misma siembra que el estudio 12). */
export function rsiWilder14(v) {
  if (!Array.isArray(v) || v.length < 16) return null;
  let ag = 0, al = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export async function buildRallyTestContext(env = {}) {
  const avisos = [];
  let spyR = null, vixR = null;
  try {
    [spyR, vixR] = await Promise.all([cascadeHistory("SPY.US", 400, env), cascadeHistory("VIX.INDX", 400, env)]);
  } catch { /* se informa abajo, campo a campo */ }
  const spyBars = cerradas(spyR), vixBars = cerradas(vixR);
  let spy = null, vix = null;
  if (spyBars.length >= 400) {       // con menos historia la media de 200 no es fiable
    const c = spyBars.map((b) => b.close), last = c.at(-1);
    const sma = (n) => media(c.slice(-n));
    spy = {
      sesion: spyBars.at(-1).date,
      vsEma200Pct: round((last / ema(c, 200) - 1) * 100),
      vsEma50Pct: round((last / ema(c, 50) - 1) * 100),
      cruce: sma(50) >= sma(200) ? "DORADO" : "MUERTE",
      bajoMaximoPct: round((1 - last / Math.max(...c.slice(-252))) * 100),
      rsi14: round(rsiWilder14(c), 0),
    };
  } else avisos.push("S&P 500: histórico no disponible o insuficiente — sin lectura de tendencia");
  if (vixBars.length >= 252) {
    const c = vixBars.map((b) => b.close), last = c.at(-1), win = c.slice(-252);
    vix = { sesion: vixBars.at(-1).date, nivel: round(last), percentil: Math.round((win.filter((x) => x <= last).length / win.length) * 100) };
  } else avisos.push("VIX: histórico no disponible — sin lectura de volatilidad");
  return { ok: Boolean(spy || vix), calculadoUtc: new Date().toISOString(), spy, vix, avisos };
}

/** Añade al contexto la lectura de los INVERTIDOS del scan (peso > 0): RSI y estiramiento medios. */
export function withTop5Context(contexto, top10) {
  const inv = (top10 ?? []).filter((a) => (a?.suggestedWeightPct ?? 0) > 0);
  const rs = inv.map((a) => a.metrics?.rsi14).filter(isNum), ex = inv.map((a) => a.metrics?.ext50).filter(isNum);
  const top5 = inv.length
    ? { n: inv.length, rsiMedio: rs.length >= 4 ? round(media(rs), 0) : null, estiramientoMedioPct: ex.length >= 4 ? round(media(ex)) : null }
    : null;
  const base = contexto ?? { ok: false, calculadoUtc: new Date().toISOString(), spy: null, vix: null, avisos: ["contexto de mercado no calculado en este scan"] };
  return { ...base, top5 };
}
