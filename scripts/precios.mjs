/**
 * PRECIOS — FUENTE ÚNICA Y VALIDADA para todo análisis con dinero real (9-sep-2026)
 * ==================================================================================
 * ⛔ PROHIBIDO llamar a Yahoo/Stooq directamente en un script de análisis de cartera.
 * Todo pasa por aquí. Nació de DOS errores reales del 9-sep-2026 que estuvieron a
 * punto de llegar a Sergi:
 *
 *   BUG 1 — `meta.chartPreviousClose` es un CAMPO VENENO: su valor DEPENDE DEL RANGO
 *   pedido (DELL el 9-sep: 533,88 con range=1d · 425,00 con 5d · 453,77 con 1mo).
 *   Con range=5d devolvió el cierre de hace 6 sesiones y salió un +9,7% falso de
 *   variación diaria. → Aquí el cierre anterior SIEMPRE sale de la SERIE, con su
 *   FECHA explícita, y se comprueba que esa fecha es la sesión anterior de verdad.
 *
 *   BUG 2 — CONFUNDIR PRECIO EN CURSO CON CIERRE: el 8-sep se tomó "el último dato
 *   de la serie" con el mercado ABIERTO y se grabó como cierre de la sesión. No lo
 *   era: DELL siguió hasta 533,88 (se grabó 527,59). La línea base de la cartera
 *   nació con un 0,77% de error. → Aquí cada dato viene etiquetado `esCierre`
 *   true/false, y `cotizarCierres()` RECHAZA devolver la barra del día en curso.
 *
 * GARANTÍAS DEL MÓDULO (cada una aborta o marca aviso, nunca calla):
 *   G1 el cierre anterior lleva fecha y es sesión bursátil anterior (≤5 días naturales)
 *   G2 nunca se usa chartPreviousClose (el test lo verifica por grep)
 *   G3a el cierre anterior se re-pide con OTRO RANGO y debe coincidir → si no, ABORTA
 *   G3b el precio vivo se contrasta con la vela de 1 minuto: >2% → AVISO
 *   G4 variación diaria >15% sin confirmar por el contraste → ERROR, no se devuelve
 *   G5 precios finitos y >0; sin datos → error explícito, jamás un silencioso null
 *   G6 `variacionCartera()` calcula SIEMPRE media ponderada y devuelve la suma
 *      ingenua marcada como INVÁLIDA (el error que cometió Sergi el 9-sep al sumar
 *      los % del panel: sumar porcentajes de valores distintos no es una rentabilidad)
 */
const UA = { "User-Agent": "Mozilla/5.0" };
const DIF_FUENTES_AVISO = 0.02;      // 2% entre Yahoo y Stooq
const VAR_DIARIA_SOSPECHOSA = 0.15;  // 15% en un día exige confirmación
const MAX_DIAS_HUECO = 5;            // sesión anterior: fin de semana + festivo

const num = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;
const dia = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

async function serieYahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${sym}: Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(`${sym}: Yahoo sin datos (${j?.chart?.error?.description ?? "?"})`);
  const meta = res.meta ?? {};
  const ts = res.timestamp ?? [], q = res.indicators?.quote?.[0] ?? {};
  const barras = [];
  for (let i = 0; i < ts.length; i++) {
    if (!num(q.close?.[i])) continue;
    barras.push({ d: dia(ts[i]), c: q.close[i], h: q.high?.[i] ?? null, l: q.low?.[i] ?? null });
  }
  if (!barras.length) throw new Error(`${sym}: serie diaria vacía`);
  // ⚠ NO se lee meta.chartPreviousClose — ver BUG 1 en la cabecera.
  return { barras, precioVivo: meta.regularMarketPrice ?? null, estado: meta.marketState ?? null,
           horaMercado: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null };
}

/** Contraste 1: la MISMA serie pedida con OTRO RANGO. El cierre de una fecha dada
 *  es un hecho: no puede depender del rango. Esta comprobación caza el BUG 1 de
 *  forma determinista (Stooq se descartó como 2ª fuente: bloquea bots desde 2026). */
async function contrasteRango(sym, fecha, valor) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;
    const r = await fetch(url, { headers: UA });
    if (!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0];
    const ts = res?.timestamp ?? [], c = res?.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < ts.length; i++) if (dia(ts[i]) === fecha && num(c[i])) {
      return { valor: c[i], coincide: Math.abs(c[i] / valor - 1) < 1e-6 };
    }
    return null;
  } catch { return null; }
}

/** Contraste 2: el precio vivo, contra la última vela de 1 MINUTO (otro endpoint,
 *  otra granularidad). Detecta un `regularMarketPrice` rancio o de otro símbolo. */
async function contrasteMinuto(sym) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m`;
    const r = await fetch(url, { headers: UA });
    if (!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0];
    const c = (res?.indicators?.quote?.[0]?.close ?? []).filter(num);
    return c.length ? c[c.length - 1] : null;
  } catch { return null; }
}

/**
 * Cotiza símbolos con TODAS las guardas. Devuelve por símbolo:
 *   { sym, precio, esCierre, fecha, cierreAnterior, fechaAnterior, varPct,
 *     contraste (Stooq), avisos[] }
 * Lanza si alguna guarda dura falla (G4, G5).
 */
export async function cotizar(simbolos, { contrastar = true } = {}) {
  const out = {};
  const hoy = new Date().toISOString().slice(0, 10);
  for (const sym of simbolos) {
    const { barras, precioVivo, estado, horaMercado } = await serieYahoo(sym);
    const ultima = barras[barras.length - 1];
    const abierto = estado === "REGULAR" || (ultima.d === hoy && estado !== "CLOSED" && estado !== "POST");
    // precio actual: el vivo si existe; si no, el último cierre de la serie
    const precio = num(precioVivo) ? precioVivo : ultima.c;
    // ¿el último dato es un CIERRE definitivo o la barra del día en curso? (BUG 2)
    const esCierre = !abierto && !(ultima.d === hoy && estado === "REGULAR");
    // referencia anterior: última barra ESTRICTAMENTE anterior a la del día en curso
    const idxAnt = ultima.d === hoy ? barras.length - 2 : barras.length - 1;
    const ant = barras[idxAnt];
    if (!ant) throw new Error(`${sym}: no hay sesión anterior en la serie`);
    if (!num(precio)) throw new Error(`${sym}: precio no válido (${precio})`);   // G5
    const avisos = [];
    // G1 — la referencia anterior debe ser una sesión reciente de verdad
    const hueco = Math.round((Date.parse(ultima.d === hoy ? hoy : ultima.d) - Date.parse(ant.d)) / 86400000);
    if (hueco > MAX_DIAS_HUECO) avisos.push(`referencia anterior a ${hueco} días (${ant.d}) — ¿festivo largo o serie con huecos?`);
    const varPct = (precio / ant.c - 1) * 100;
    // G3 — doble contraste independiente
    let contraste = null;
    if (contrastar) {
      // 3a) el cierre anterior NO puede depender del rango pedido (caza el BUG 1)
      const cr = await contrasteRango(sym, ant.d, ant.c);
      if (cr == null) avisos.push(`no se pudo contrastar el cierre del ${ant.d} con otro rango`);
      else if (!cr.coincide) throw new Error(`${sym}: el cierre del ${ant.d} difiere según el rango (${ant.c} vs ${cr.valor}) — dato NO fiable, se aborta (G3a)`);
      // 3b) el precio vivo contra la última vela de 1 minuto
      contraste = await contrasteMinuto(sym);
      if (contraste != null) {
        const dif = Math.abs(contraste / precio - 1);
        if (dif > DIF_FUENTES_AVISO) avisos.push(`precio ${precio.toFixed(2)} vs vela de 1 min ${contraste.toFixed(2)} (${(dif * 100).toFixed(1)}%)`);
      } else avisos.push("sin contraste de 1 minuto (mercado cerrado o sin datos)");
    }
    if (Math.abs(varPct) > VAR_DIARIA_SOSPECHOSA * 100) {
      const confirmado = contraste != null && Math.abs(contraste / precio - 1) <= DIF_FUENTES_AVISO;
      if (!confirmado) throw new Error(`${sym}: variación diaria de ${varPct.toFixed(1)}% SIN confirmar por el contraste de 1 minuto — se aborta (G4)`);
      avisos.push(`movimiento extremo ${varPct.toFixed(1)}% confirmado por la vela de 1 minuto`);
    }
    out[sym] = { sym, precio, esCierre, fecha: ultima.d, cierreAnterior: ant.c, fechaAnterior: ant.d,
                 varPct, contraste, estadoMercado: estado, horaMercado, avisos };
    await new Promise((r) => setTimeout(r, 220));
  }
  return out;
}

/** Como cotizar(), pero EXIGE cierres definitivos: aborta si el mercado está abierto. */
export async function cotizarCierres(simbolos, opts = {}) {
  const c = await cotizar(simbolos, opts);
  const enCurso = Object.values(c).filter((x) => !x.esCierre).map((x) => x.sym);
  if (enCurso.length) throw new Error(`Se pidieron CIERRES pero el mercado está abierto para: ${enCurso.join(", ")} — usa cotizar() y etiqueta el dato como intradía (BUG 2 del 9-sep-2026)`);
  return c;
}

/**
 * Variación de una CARTERA. posiciones = [{ticker, uds, precio, precioRef}].
 * G6: devuelve la media ponderada (la correcta) y la suma de porcentajes marcada
 * como INVÁLIDA, para que nunca vuelvan a confundirse.
 */
export function variacionCartera(posiciones, fx = 1, fxRef = null) {
  const f0 = fxRef ?? fx;
  let valor = 0, valorRef = 0;
  const filas = posiciones.map((p) => {
    const v = p.uds * p.precio / fx, vr = p.uds * p.precioRef / f0;
    valor += v; valorRef += vr;
    return { ...p, valor: v, valorRef: vr, pct: (p.precio / p.precioRef - 1) * 100 };
  });
  for (const f of filas) f.aportaPp = (f.valor - f.valorRef) / valorRef * 100;
  return {
    valor, valorRef,
    variacionPct: (valor / valorRef - 1) * 100,          // ✅ la buena
    sumaPorcentajesINVALIDA: filas.reduce((s, f) => s + f.pct, 0),  // ❌ nunca reportar como rentabilidad
    filas,
  };
}

export const REGLAS = {
  nuncaChartPreviousClose: true,
  difFuentesAviso: DIF_FUENTES_AVISO,
  varDiariaSospechosa: VAR_DIARIA_SOSPECHOSA,
};
