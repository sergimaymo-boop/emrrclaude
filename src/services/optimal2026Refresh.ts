/**
 * Optimal2026 — frontend service
 * Fetches the last computed snapshot from /api/optimal2026 (KV cache).
 * Live price enrichment: updates price / pctDay from real-time providers.
 * Portfolio IBK: parse/save/load cartera Interactive Brokers (localStorage).
 * Aislado: un fallo aquí NUNCA afecta a otros módulos (devuelve estado/seguro).
 */

import { fetchLiveQuoteMap, liveTickerOf } from "./liveQuotes";

export interface Optimal2026Item {
  rank: number;
  symbol: string;
  name: string;
  score: number | null;
  allocationPct: number;
  price: number | null;
  pctDay: number | null;
  priceRefreshedAt?: string | null; // ISO timestamp cuando se enriqueció el precio en vivo
  riskAdjMom: number | null;  // señal primaria: (retLong − retSkip) / vol63
  retLong: number | null;     // retorno momentum largo 9m %
  rsLong: number | null;      // fuerza relativa vs SPY (ventana larga) %
  vol63: number | null;       // volatilidad anualizada 3m %
  r2: number | null;          // calidad de tendencia (R²)
  align: number | null;       // alineación EMA 0-3
  stopPct: number | null;
  stopPrice: number | null;
  stopBand: "TR" | "TN" | "TA" | null;
}

export interface Optimal2026Result {
  ok: boolean;
  items: Optimal2026Item[];
  regime?: "RISK_ON" | "RISK_OFF";
  deployPct?: number;
  regimeReason?: string;
  badge?: number;
  oos?: {
    cagr: number;
    maxDD: number;
    mar: number;
    sharpe: number;
    winPos: number;
    beatsSpy: string;
    tradesYr?: number;
    testPeriod?: string;
  };
  universeCount?: number;
  activeMarkets?: string[];
  scanStartedAtUtc?: string;
  cachedAtUtc?: string;
  error?: string;
  message?: string;
}

// ── IBK Portfolio ─────────────────────────────────────────────────────────────

export interface IBKPosition {
  symbol: string;       // ticker sin sufijo (e.g., "NVDA", "ASML")
  name?: string | null; // nombre de la empresa (capturado de la línea bajo el ticker en la app IBK)
  quantity: number;     // número de acciones
  avgCost: number | null;      // precio medio de compra
  currentPrice: number | null; // precio al exportar (puede actualizarse con vivo)
  marketValue: number | null;  // valor de mercado = importe invertido en la posición
  unrealizedPnL: number | null;
  currency: string;     // "USD" | "EUR" | etc.
}

export interface IBKPortfolio {
  positions: IBKPosition[];
  loadedAt: string;     // ISO timestamp de la carga
  source: "IBK_CSV" | "IBK_PHOTO" | "MANUAL"; // IBK_PHOTO = OCR (números aproximados, verificar)
  cashBalance?: number | null;  // efectivo pendiente de invertir — AUTO desde la foto ("EXCESO LIQ."/"Total efectivo") o manual
  accountTotal?: number | null; // valor TOTAL de la cuenta — AUTO desde la cabecera de la foto de IBK
  /** "VAL. MDO." de la cabecera IBK: Σ posiciones YA convertido a divisa base (EUR).
   *  Es la fuente MÁS fiable del invertido (regla dictada 15-ago) — más que NAV−efectivo. */
  investedValue?: number | null;
  /** Auditoría de la carga (mandato 15-ago "primero auditoría, luego análisis"):
   *  una línea por archivo — qué se leyó (posiciones/totales) o el motivo exacto del fallo. */
  loadAudit?: string[];
}

const IBK_STORAGE_KEY = "optimal2026_ibk_portfolio_v1";
const IBK_HISTORY_KEY = "optimal2026_ibk_history_v1";
const IBK_HISTORY_MAX = 40;

// ── Histórico de snapshots de cartera (base del aprendizaje) ──────────────────
// Cada carga de cartera se registra; comparar snapshots consecutivos permite
// medir la evolución del P&L y aprender de las decisiones (mandato 25-jul-2026).

export interface IBKSnapshot {
  at: string;                       // ISO timestamp
  totalPnL: number | null;          // suma de unrealized P&L conocidos
  totalValue: number | null;        // valor de posiciones conocido
  symbols: string[];                // tickers en cartera (para detectar entradas/salidas)
}

export function loadPortfolioHistory(): IBKSnapshot[] {
  try {
    const raw = localStorage.getItem(IBK_HISTORY_KEY);
    const h = raw ? (JSON.parse(raw) as IBKSnapshot[]) : [];
    return Array.isArray(h) ? h : [];
  } catch { return []; }
}

function appendPortfolioHistory(portfolio: IBKPortfolio): void {
  try {
    const pnls = portfolio.positions.map(p => p.unrealizedPnL).filter((v): v is number => v != null);
    const vals = portfolio.positions.map(p => p.marketValue).filter((v): v is number => v != null);
    const snap: IBKSnapshot = {
      at: portfolio.loadedAt,
      totalPnL: pnls.length ? Math.round(pnls.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      totalValue: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      symbols: portfolio.positions.map(p => p.symbol.toUpperCase()).sort(),
    };
    const h = loadPortfolioHistory();
    // No duplicar si la última carga es de hace <10 min con los mismos símbolos (re-guardados de efectivo)
    const last = h[h.length - 1];
    const sameSyms = last && last.symbols.join(",") === snap.symbols.join(",");
    if (last && sameSyms && Date.now() - new Date(last.at).getTime() < 10 * 60 * 1000) {
      h[h.length - 1] = snap;
    } else {
      h.push(snap);
    }
    localStorage.setItem(IBK_HISTORY_KEY, JSON.stringify(h.slice(-IBK_HISTORY_MAX)));
  } catch { /* ignore quota */ }
}

// ── Espejo servidor del snapshot IBK (canal LATERAL de solo persistencia) ─────
// POST fire-and-forget a /api/rally-scan/ibk-portfolio para que un proceso
// externo (script del Mac) pueda leer la última cartera sin acceso al
// localStorage del navegador. JAMÁS bloquea ni afecta al flujo existente:
// cualquier fallo se ignora en silencio. No toca ningún cálculo de módulos.

const IBK_EU_SUFFIX_RE = /\.(PA|MC|MI|DE|AS|BR|LS|VI|HE|F|SW|ST|OL|CO)$/i;

function ibkPositionCurrency(pos: IBKPosition): string {
  const c = typeof pos.currency === "string" ? pos.currency.trim().toUpperCase() : "";
  if (c) return c;
  return IBK_EU_SUFFIX_RE.test(pos.symbol ?? "") ? "EUR" : "USD";
}

function mirrorPortfolioToServer(portfolio: IBKPortfolio): void {
  try {
    const t = derivePortfolioTotals(portfolio);
    const payload = {
      loadedAt: portfolio.loadedAt ?? new Date().toISOString(),
      navEur: t.total ?? null,       // NAV total de la cuenta (EUR)
      valMdoEur: t.invested ?? null, // "VAL. MDO." — invertido en EUR
      cashEur: t.cash ?? null,       // "EXCESO LIQ." — efectivo (EUR)
      // FX implícito EUR por 1 USD (fxK = invertido EUR / Σ crudo USD); null si no derivable.
      fxEurPerUsd: t.fxNormalized ? Math.round(t.fxK * 1e5) / 1e5 : null,
      positions: (portfolio.positions ?? []).slice(0, 50).map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        lastPrice: p.currentPrice ?? null,
        currency: ibkPositionCurrency(p),
      })),
    };
    void fetch("/api/rally-scan/ibk-portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* silencioso: el espejo nunca interfiere */ });
  } catch { /* silencioso: el espejo nunca interfiere */ }
}

export function savePortfolioToStorage(portfolio: IBKPortfolio): void {
  try {
    localStorage.setItem(IBK_STORAGE_KEY, JSON.stringify(portfolio));
    appendPortfolioHistory(portfolio);
  } catch { /* ignore quota errors */ }
  // Fuera del try de localStorage a propósito: fire-and-forget con manejo propio.
  mirrorPortfolioToServer(portfolio);
}

export function loadPortfolioFromStorage(): IBKPortfolio | null {
  try {
    const raw = localStorage.getItem(IBK_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as IBKPortfolio;
    if (!Array.isArray(p.positions)) return null;
    // Válida con posiciones O con los totales de la cabecera (diseño simplificado 15-ago:
    // la foto de cabecera por sí sola ya da INVERTIDO/EFECTIVO/TOTAL).
    const hasTotals = p.investedValue != null || p.cashBalance != null || p.accountTotal != null;
    if (p.positions.length === 0 && !hasTotals) return null;
    return p;
  } catch { return null; }
}

export function clearPortfolioFromStorage(): void {
  try { localStorage.removeItem(IBK_STORAGE_KEY); } catch { /* ignore */ }
}

// "Limpiar" = borrado COMPLETO (31-jul): también el histórico de aprendizaje —
// las lecturas OCR malas acumuladas contaminaban el "P&L desde la foto anterior".
export function clearPortfolioHistory(): void {
  try { localStorage.removeItem(IBK_HISTORY_KEY); } catch { /* ignore */ }
}

/**
 * Parsea un CSV exportado de Interactive Brokers.
 * Soporta 2 formatos:
 *   1. Activity Statement IBK: líneas "Positions,Data,...,Stocks,USD,NVDA,100,..."
 *   2. CSV simple: columnas Symbol/Ticker, Quantity/Qty, etc.
 */
export function parseIBKPortfolio(csvText: string): IBKPosition[] {
  const text = csvText.trim();
  if (!text) return [];

  // Formato 1: Activity Statement IBK
  if (text.includes("Open Positions") || /^Positions,(?:Data|Header)/m.test(text)) {
    return parseActivityStatement(text);
  }

  // Formato 2: CSV simple (Portfolio report o copy-paste desde IB TWS/Portal)
  return parseSimpleCSV(text);
}

function parseActivityStatement(csv: string): IBKPosition[] {
  const positions: IBKPosition[] = [];
  for (const rawLine of csv.split("\n")) {
    const line = rawLine.trim();
    // Acepta "Positions,Data,..." y "Open Positions,Data,..."
    if (!/(?:Open )?Positions,Data,/i.test(line)) continue;
    // Limpia comillas y split
    const cols = line.split(",").map(c => c.replace(/^"|"$/g, "").trim());
    // IBK Activity Statement columns (0-indexed after stripping section header):
    // Section, RecordType, DataDiscriminator, AssetCategory, Currency, Symbol, Quantity,
    // Mult, CostPrice, CostBasis, ClosePrice, Value, UnrealizedPnL, %
    // Variable offset depending on whether section is "Open Positions" (2 tokens) or "Positions" (1 token)
    const offset = cols[0].toLowerCase() === "open positions" ? 1 : 0; // not actually offset by prefix
    // Find Symbol col heuristically (after currency col which is 3-letter ISO)
    const assetCatIdx = cols.findIndex(c => /stocks|etf|equity/i.test(c));
    if (assetCatIdx < 0) continue;
    const curIdx = assetCatIdx + 1;
    const symIdx = curIdx + 1;
    const qtyIdx = symIdx + 1;
    const costIdx = qtyIdx + 2;   // skip Mult
    const closeIdx = costIdx + 2;  // skip CostBasis
    const valIdx = closeIdx + 1;
    const pnlIdx = valIdx + 1;
    if (cols.length <= pnlIdx) continue;

    const symbol = cols[symIdx];
    const quantity = parseFloat(cols[qtyIdx]);
    const avgCost = parseFloat(cols[costIdx]);
    const currentPrice = parseFloat(cols[closeIdx]);
    const marketValue = parseFloat(cols[valIdx]);
    const unrealizedPnL = parseFloat(cols[pnlIdx]);
    const currency = cols[curIdx] ?? "USD";

    if (!symbol || !isFinite(quantity) || quantity === 0) continue;
    positions.push({
      symbol,
      quantity,
      avgCost: isFinite(avgCost) ? avgCost : null,
      currentPrice: isFinite(currentPrice) ? currentPrice : null,
      marketValue: isFinite(marketValue) ? marketValue : null,
      unrealizedPnL: isFinite(unrealizedPnL) ? unrealizedPnL : null,
      currency,
    });
  }
  return positions;
}

function parseSimpleCSV(csv: string): IBKPosition[] {
  const lines = csv.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const cleanHeader = lines[0].replace(/^"|"$/g, "").split(",").map(h =>
    h.replace(/^"|"$/g, "").trim().toLowerCase()
  );

  const idx = (candidates: string[]) =>
    cleanHeader.findIndex(h => candidates.some(c => h.includes(c)));

  const symIdx = idx(["symbol", "ticker", "instrumento"]);
  const qtyIdx = idx(["qty", "quantity", "shares", "acciones", "cantidad"]);
  const costIdx = idx(["avg cost", "average cost", "cost price", "coste", "precio medio"]);
  const priceIdx = idx(["last price", "close price", "price", "precio"]);
  const valIdx = idx(["market value", "valor"]);
  const pnlIdx = idx(["unrealized", "p/l", "pnl", "beneficio"]);
  const curIdx = idx(["currency", "ccy", "moneda"]);

  if (symIdx < 0) return [];

  const positions: IBKPosition[] = [];
  for (const rawLine of lines.slice(1)) {
    const cols = rawLine.split(",").map(c => c.replace(/^"|"$/g, "").replace(/[$,]/g, "").trim());
    const symbol = cols[symIdx];
    if (!symbol || /total|subtotal/i.test(symbol)) continue;
    const quantity = qtyIdx >= 0 ? parseFloat(cols[qtyIdx]) : 0;
    if (!isFinite(quantity) || quantity === 0) continue;
    const avgCost = costIdx >= 0 ? parseFloat(cols[costIdx]) : null;
    const currentPrice = priceIdx >= 0 ? parseFloat(cols[priceIdx]) : null;
    const marketValue = valIdx >= 0 ? parseFloat(cols[valIdx]) : null;
    const unrealizedPnL = pnlIdx >= 0 ? parseFloat(cols[pnlIdx]) : null;
    const currency = curIdx >= 0 ? cols[curIdx] : "USD";
    positions.push({
      symbol,
      quantity,
      avgCost: avgCost != null && isFinite(avgCost) ? avgCost : null,
      currentPrice: currentPrice != null && isFinite(currentPrice) ? currentPrice : null,
      marketValue: marketValue != null && isFinite(marketValue) ? marketValue : null,
      unrealizedPnL: unrealizedPnL != null && isFinite(unrealizedPnL) ? unrealizedPnL : null,
      currency,
    });
  }
  return positions;
}

// ── OCR: cartera desde FOTO (captura de pantalla de la app IBK) ───────────────

function parseOcrNumber(token: string): number {
  // AUDIT FIX (31-jul): tesseract lee el "−" rojo de los PyG negativos como guion unicode
  // (— – −); sin normalizarlo, el número se perdía y TODAS las columnas se desplazaban.
  let t = token.replace(/[—–−]/g, "-").replace(/[$€£+%]/g, "").trim();
  const negative = t.startsWith("-");
  if (negative) t = t.slice(1);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    // Formato europeo: 1.234,56 (también con signo: −1.136,00)
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(t) || /^\d+,\d{4,}$/.test(t)) {
    // FIX 15-ago (app IBK en español): coma DECIMAL — "3,2" acciones, "5,0101" acciones
    // fraccionadas, "972,98" precio. Antes se trataba la coma como separador de miles US
    // y "3,2" se convertía en 32 acciones. Los miles US van SIEMPRE en grupos de 3
    // ("1,949"), así que coma+1-2 dígitos o coma+4+ dígitos solo puede ser decimal.
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    // Formato US: 1,234.56
    t = t.replace(/,/g, "");
  }
  const v = parseFloat(t);
  return negative ? -v : v;
}

// Palabras que identifican una LÍNEA de la zona de ÓRDENES pendientes — la línea entera
// se descarta (AUDIT FIX 31-jul: blacklistear solo el token dejaba que symIdx saltara al
// siguiente, creando posiciones fantasma desde filas de órdenes: "VENTA TRAIL WDC 6 …").
const OCR_ORDER_LINE_WORDS = /\b(TRAIL|VENTA|COMPRA|BUY|SELL|LMT|STP|GTC|M[OÓ]VIL)\b/;

const OCR_NOT_TICKERS = new Set([
  "USD", "EUR", "GBP", "CHF", "PNL", "MKT", "VALUE", "QTY", "POS", "TOTAL",
  "CASH", "NET", "IBKR", "ACCT", "AVG", "COST", "LAST", "PRICE", "DIA", "HOY",
  "STK", "OPT", "FUT", "ETF", "ALL", "LONG", "SHORT", "SYMBOL",
  // Sufijos/palabras de RAZÓN SOCIAL — la app de IBK muestra el nombre de la empresa
  // debajo del ticker y el OCR los confundía con un segundo ticker (bug 25-jul: "S.p.A."
  // de Mediobanca → posición fantasma "SPA"; "PALO" de Palo Alto; "POSTE"; "HUMANA").
  "SPA", "INC", "CORP", "LTD", "PLC", "GROUP", "GRP", "HOLDING", "HOLDINGS",
  "CLASS", "SHS", "ADR", "NV", "SE", "AG", "SA", "AB", "ASA", "OYJ", "CO",
  "TECH", "TECHNOLOGIES", "TECHNOLOGY", "NETWORKS", "SYSTEMS", "THE", "AND",
  // Palabras de ÓRDENES (bug 31-jul: la captura incluía la zona de órdenes pendientes
  // y "TRAIL" se parseó como ticker fantasma con importes de la orden)
  "TRAIL", "VENTA", "COMPRA", "BUY", "SELL", "LMT", "MKT", "STP", "GTC",
  "ORDEN", "ORDENES", "VLR", "MRCD",
  // Palabras de la CABECERA DE TOTALES de la app IBK (fix 15-ago: "MARGEN 0,00 PODER
  // ADQUISITIVO 15.102,24" creaba una posición fantasma "MARGEN" con 15.102 acciones)
  "MARGEN", "MARGIN", "PODER", "POWER", "EXCESO", "EXCESS", "VAL", "MDO",
  "LIQ", "SALDOS", "SALDO", "NAV", "PYG", "CST",
]);

/**
 * Parser heurístico para texto OCR de capturas de la app/web de IBK.
 *
 * Formatos que reconoce (verificado 25-jul-2026 con la cartera real de Sergi):
 *   • App IBK móvil, pestaña Posiciones: "PST BVME 26.31 30 -27.60 -3.06%"
 *     → columnas: Último (precio, DECIMAL) · Posición (acciones, ENTERO) · PyG · %
 *   • Listado simple: "AAPL 100 150.25" → cantidad (ENTERO) · precio (DECIMAL)
 *
 * La ambigüedad cantidad/precio se resuelve por FORMATO TEXTUAL (auditoría 25-jul):
 * un número escrito con decimales ("26.31", "150.00") es PRECIO; sin decimales ("30")
 * es CANTIDAD. Esto es robusto incluso con precios de valor entero ("150.00") y con
 * cantidades fraccionarias ("1.5"), donde comparar Number.isInteger fallaba.
 *
 * Las líneas de NOMBRE DE EMPRESA que la app pinta bajo cada ticker se descartan por
 * DOS reglas: (1) frase — el candidato a ticker va seguido de otra palabra en mayúsculas
 * que no es un código de bolsa ("PALO ALTO…", "POSTE ITALIANE…"); (2) rango — sus números
 * son el rango del día (dos decimales casi iguales, "26.30-26.31").
 */
const OCR_EXCHANGES = new Set([
  "BVME", "NYSE", "NASDAQ", "NMS", "ARCA", "AMEX", "BATS", "IEX", "ISLAND",
  "LSE", "IBIS", "IBIS2", "SBF", "AEB", "EBS", "SEHK", "TSE", "TSEJ", "SGX",
  "VENTURE", "PINK", "MEXI", "BM", "SMART",
]);

// ── Mapa de columnas por CABECERA (fix definitivo 31-jul) ─────────────────────
// La app de IBK permite reordenar columnas (y cambió de "Último·Posición·PyG" a
// "PyG·Posición·Último"), lo que rompía cualquier heurística por formato: el PyG
// de HUM (14.70) se leía como precio, y el PyG negativo de MU (−101.98) en primera
// posición hacía descartar la posición entera. Solución: leer la FILA DE CABECERA
// de la propia foto ("Instrumento PyG Posición Último Vlr mrcd") y asignar cada
// número de las filas a su columna real. Funciona con CUALQUIER orden.
const OCR_COL_MATCHERS: Array<[string, RegExp]> = [
  ["pnl", /^(pyg|p&l|pnl)/i],
  ["qty", /^(posici|position|pos$|cantidad|qty)/i],
  ["price", /^([uú]lt[i1]mo|last|precio|price)/i],
  // FUZZY (e2e OCR 15-ago): tesseract lee "Vlr"→"Vir", "mrcd"→"mred" en la tabla apretada
  ["value", /^(v[l1i]r|valor|mr[ce]d|market|value)/i],
  // "Bs d cst" (base de coste) — fix 15-ago: sin mapearla, su número desplazaba el
  // mapeo posicional y el PyG leía la base de coste. Se captura → avgCost = coste/cantidad.
  // El OCR también la FUSIONA en un token ("Bsdcst").
  ["cost", /^(b[s5]\.?$|b[s5]\.?d\.?c[s5]t\.?$|cst\.?$|coste|cost$|basis)/i],
];
// Columnas PORCENTUALES de la cabecera ("%netliq", "% vrcón"): sus VALORES de fila
// terminan en "%" y ya se excluyen de rawNums — por eso tampoco entran en el colMap
// (así cabecera y fila excluyen las MISMAS columnas y la alineación posicional cuadra).

// AUDIT FIX (31-jul, adversarial): (a) ya no exige el literal "instrument" — tesseract
// confunde la I mayúscula con l/1 ("lnstrumento") y sin ancla secundaria se volvía en
// silencio a la heurística vieja; (b) escanea TODAS las líneas y elige la de MÁS columnas
// reconocidas (no la primera que pase), evitando engancharse a una línea de órdenes o a
// un disclaimer; "instrument" cuenta solo como bonus de desempate.
function detectColumnMap(lines: string[]): string[] | null {
  let best: { cols: string[]; score: number } | null = null;
  for (const line of lines) {
    const cols: string[] = [];
    for (const tok of line.split(/\s+/)) {
      for (const [key, re] of OCR_COL_MATCHERS) {
        if (!cols.includes(key) && re.test(tok)) { cols.push(key); break; }
      }
    }
    // Un mapa útil necesita al menos cantidad + (precio o valor)
    if (!(cols.includes("qty") && (cols.includes("price") || cols.includes("value")))) continue;
    const score = cols.length + (/instrument/i.test(line) ? 0.5 : 0);
    if (!best || score > best.score) best = { cols, score };
  }
  return best?.cols ?? null;
}

export function parseOCRPortfolio(text: string): IBKPosition[] {
  const positions: IBKPosition[] = [];
  const seen = new Set<string>();
  const allLines = text.split("\n").map((l) => l.trim());
  const colMap = detectColumnMap(allLines);
  for (const line of allLines) {
    if (!line) continue;
    // AUDIT FIX: líneas de ÓRDENES pendientes se descartan ENTERAS — blacklistear solo el
    // token dejaba que el ticker de la orden ("VENTA TRAIL WDC 6 …") creara una posición
    // fantasma o duplicara una real con los importes de la orden.
    if (OCR_ORDER_LINE_WORDS.test(line)) continue;
    const tokens = line.split(/\s+/);
    const symIdx = tokens.findIndex(
      (t) => /^[A-Z]{2,6}$/.test(t) && !OCR_NOT_TICKERS.has(t),
    );
    if (symIdx < 0) continue;
    const symbol = tokens[symIdx];
    if (seen.has(symbol)) continue;

    // Regla de FRASE: si tras el candidato viene OTRA palabra en mayúsculas que no es
    // un código de bolsa, esto es un nombre de empresa ("PALO ALTO…"), no una posición.
    // BONUS (26-jul): esa línea de nombre se CAPTURA y se asigna a la posición anterior
    // — así la tabla muestra "PST · Poste Italiane SPA" leído de la propia foto.
    const next = tokens[symIdx + 1];
    if (next && /^[A-Z]{2,12}$/.test(next) && !OCR_EXCHANGES.has(next)) {
      const prevPos = positions[positions.length - 1];
      if (prevPos && !prevPos.name) {
        const nameWords = tokens.slice(symIdx).filter((t) => /^[A-ZÀ-Ü&.]{2,}$/.test(t));
        if (nameWords.length > 0) prevPos.name = nameWords.join(" ");
      }
      continue;
    }

    // Números con su formato textual: decimal explícito = precio; entero = cantidad.
    // "26.30-26.31" (rango del día) se separa en dos números para la regla del rango.
    // AUDIT FIX: los tokens de PORCENTAJE ("-3.06%") se EXCLUYEN — la columna % nunca se
    // mapea y un porcentaje colado desplazaba todas las asignaciones posicionales.
    const rawNums = tokens
      .slice(symIdx + 1)
      .filter((t) => !/%$/.test(t))
      .flatMap((t) => {
        const range = t.match(/^([\d.,]+)-([\d.,]+)$/);
        return range ? [range[1], range[2]] : [t];
      })
      .map((t) => ({
        v: parseOcrNumber(t),
        dec: /[.,]\d{1,4}$/.test(t.replace(/[$€£+%—–−]/g, "")),
        raw: t.replace(/[$€£+%—–−]/g, ""),
      }))
      .filter((n) => isFinite(n.v));
    if (rawNums.length === 0) continue;

    // ── Candidatos por token con SEPARADORES PERDIDOS (fix 15-ago, fotos reales) ──
    // El OCR de la tabla apretada pierde puntos/comas: "5.0101"→"50101",
    // "1,948.93"→"194893", "972.98"→"97298". Cada token genera interpretaciones
    // (directa, dígitos/10, /100, /10⁴) y la REDUNDANCIA mv ≈ precio×cantidad
    // elige la combinación que CUADRA — verificado end-to-end con OCR real.
    const candidatesOf = (n: { v: number; raw: string }): number[] => {
      const out = [n.v];
      const digits = n.raw.replace(/[^\d]/g, "");
      if (digits.length >= 1) {
        const d = parseInt(digits, 10);
        for (const c of [d, d / 10, d / 100, d / 10_000]) {
          if (Number.isFinite(c) && c > 0 && !out.includes(c)) out.push(c);
        }
      }
      return out;
    };

    let quantity: number, currentPrice: number | null = null, unrealizedPnL: number | null = null;
    let mappedValue: number | null = null;
    let mappedCostBasis: number | null = null;
    const [a, b] = [rawNums[0], rawNums[1]];
    const pnlCandidate = rawNums.length > 2 ? rawNums[2].v : null;

    if (colMap && rawNums.length >= 2) {
      // ── Modo CABECERA con VERIFICACIÓN DE CONSISTENCIA (audit adversarial 31-jul) ──
      // El OCR puede perder o colar un número y desplazar el mapeo posicional en silencio.
      // Defensa: se prueban offsets 0/−1/+1 y se explota la REDUNDANCIA de IBK
      // (Vlr mrcd ≈ precio × cantidad) para elegir la asignación que CUADRA; si ninguna
      // cuadra, se prueban las combinaciones de candidatos con separadores perdidos.
      const numAt = (key: string, offset: number) => {
        const idx = colMap.indexOf(key);
        const j = idx >= 0 ? idx + offset : -1;
        return j >= 0 && j < rawNums.length ? rawNums[j] : null;
      };
      const tryAt = (offset: number) => ({
        q: numAt("qty", offset)?.v ?? null,
        p: numAt("price", offset)?.v ?? null,
        pnl: numAt("pnl", offset)?.v ?? null,
        mv: numAt("value", offset)?.v ?? null,
        cb: numAt("cost", offset)?.v ?? null,
      });
      type Cand = ReturnType<typeof tryAt>;
      const verifiable = (c: Cand) => c.mv != null && c.p != null && c.p > 0 && c.q != null && c.q > 0;
      const relErr = (c: Cand) =>
        Math.abs((c.mv as number) - (c.p as number) * (c.q as number)) / (c.mv as number);
      const consistent = (c: Cand) => (verifiable(c) ? relErr(c) < 0.02 : true);
      // Candidatos MONETARIOS puntuados (precio y valor SIEMPRE llevan céntimos en IBK):
      // con decimal explícito, la lectura directa manda; sin él, lo más probable es que
      // el OCR haya perdido el separador → dígitos/100 es la interpretación preferida.
      const moneyCands = (n: { v: number; raw: string }): { v: number; pen: number }[] => {
        const expl = /[.,]\d{1,2}$/.test(n.raw);
        const digits = n.raw.replace(/\D/g, "");
        const d = digits ? parseInt(digits, 10) : NaN;
        const out: { v: number; pen: number }[] = [];
        const push = (v: number, pen: number) => {
          if (Number.isFinite(v) && v > 0 && !out.some((x) => x.v === v)) out.push({ v, pen });
        };
        if (expl) { push(n.v, 0); push(d / 100, 0.75); }
        else { push(d / 100, 0); push(n.v, 0.5); push(d / 10, 1); }
        return out;
      };
      let pick: Cand | null = null;
      // ── Fila VERIFICABLE (hay columna de valor): resolución por candidatos ──
      // La cantidad se DERIVA de valor/precio (identidad IBK) y se "ancla" al
      // candidato leído si cuadra <2% — inmune a separadores perdidos por el OCR.
      const qTok = numAt("qty", 0), pTok = numAt("price", 0), mvTok = numAt("value", 0);
      if (qTok && pTok && mvTok) {
        const qtyCands = candidatesOf(qTok);
        let best: { q: number; p: number; mv: number; pen: number } | null = null;
        for (const pc of moneyCands(pTok)) {
          for (const mc of moneyCands(mvTok)) {
            const qDer = mc.v / pc.v;
            if (!(qDer > 0 && qDer <= 1_000_000)) continue;
            const snap = qtyCands.find((c) => Math.abs(c - qDer) / qDer < 0.02);
            const q = snap ?? Math.round(qDer * 10_000) / 10_000;
            const pen = pc.pen + mc.pen + (snap != null ? 0 : 0.75);
            if (!best || pen < best.pen) best = { q, p: pc.v, mv: mc.v, pen };
          }
        }
        if (best && best.pen <= 2) pick = { ...tryAt(0), q: best.q, p: best.p, mv: best.mv };
      }
      // ── Fila NO verificable o incompleta: offsets directos 0/−1/+1 (comportamiento 31-jul) ──
      if (!pick) {
        for (const off of [0, -1, 1]) {
          const c = tryAt(off);
          if (c.q == null || c.q <= 0 || c.q > 1_000_000) continue;
          if (consistent(c)) { pick = c; break; }
        }
      }
      if (!pick) {
        // Reparación por redundancia: cantidad = valor / precio (si plausible)
        const c0 = tryAt(0);
        if (c0.mv != null && c0.p != null && c0.p > 0) {
          const qFix = Math.round(((c0.mv as number) / (c0.p as number)) * 100) / 100;
          if (qFix > 0 && qFix <= 1_000_000) pick = { ...c0, q: qFix };
        }
      }
      if (!pick || pick.q == null) continue;
      // Fila NO verificable (sin columna de valor): una cantidad enorme suele ser un
      // decimal con separador perdido que no podemos comprobar → mejor descartar la
      // fila que inventar (norma "nunca dato incorrecto"). Las fotos-tabla con
      // "Vlr d mrcd" sí se verifican y no entran aquí.
      if (!verifiable(pick) && pick.q > 10_000) continue;
      quantity = pick.q;
      currentPrice = pick.p != null && pick.p > 0 ? pick.p : null;
      mappedValue = pick.mv != null && pick.mv > 0 ? pick.mv : null;
      // PyG plausible: acotado por el tamaño real de la posición (no por 10M fijos)
      const posScale = mappedValue ?? (currentPrice != null ? currentPrice * quantity : null);
      unrealizedPnL = pick.pnl != null && (posScale == null ? Math.abs(pick.pnl) < 10_000_000 : Math.abs(pick.pnl) < posScale * 2)
        ? pick.pnl : null;
      // Base de coste plausible: coste/acción dentro de ×5 del precio actual
      const avgFromCost = pick.cb != null && pick.cb > 0 ? pick.cb / quantity : null;
      mappedCostBasis = avgFromCost != null && (currentPrice == null || (avgFromCost > currentPrice / 5 && avgFromCost < currentPrice * 5))
        ? (pick.cb as number) : null;
    } else if (b == null) {
      // Un solo número: si es decimal ("180.50" suelto en una línea de nombre) es un
      // precio huérfano, no una posición → descartar. Entero = cantidad sin precio.
      if (a.dec || a.v <= 0) continue;
      quantity = a.v;
    } else if (a.dec && b.dec && a.v > 0 && b.v > 0
               && Math.abs(a.v - b.v) / Math.max(a.v, b.v) < 0.02) {
      // Rango del día (dos decimales casi iguales) → línea de nombre → descartar
      continue;
    } else if (a.dec && !b.dec && a.v > 0 && b.v > 0) {
      // Layout app IBK: precio (decimal) · posición (entera) · PyG · %
      currentPrice = a.v;
      quantity = b.v;
      if (pnlCandidate != null && Math.abs(pnlCandidate) < a.v * b.v * 2) unrealizedPnL = pnlCandidate;
    } else if (a.dec && b.dec && a.v > 0 && b.v > 0) {
      // App IBK con posición FRACCIONARIA ("913.43 1.2"): precio primero también
      currentPrice = a.v;
      quantity = b.v;
      if (pnlCandidate != null && Math.abs(pnlCandidate) < a.v * b.v * 2) unrealizedPnL = pnlCandidate;
    } else {
      // Layout simple/CSV: cantidad (entera) · precio
      quantity = a.v;
      if (b.v > 0) currentPrice = b.v;
    }

    if (!isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) continue;
    seen.add(symbol);
    positions.push({
      symbol,
      quantity,
      // Coste medio SOLO si la foto trae columna "Bs d cst" (base de coste ÷ acciones);
      // en las vistas sin esa columna no se inventa (regla 25-jul).
      avgCost: mappedCostBasis != null && quantity > 0
        ? Math.round((mappedCostBasis / quantity) * 100) / 100 : null,
      currentPrice,
      // Con cabecera, la columna "Vlr mrcd" de IBK manda (exacta); si no, precio × cantidad
      marketValue: mappedValue
        ?? (currentPrice != null ? Math.round(currentPrice * quantity * 100) / 100 : null),
      unrealizedPnL,
      currency: "USD",
    });
  }
  return positions;
}

/**
 * Resumen de CUENTA leído de la cabecera de la foto de la app IBK:
 *   • accountTotal — el número grande arriba (NAV, ej. "22,110" / "22.110")
 *   • marketValue  — "VAL. MDO." (Σ posiciones YA en divisa base EUR)
 *   • totalCash    — "EXCESO LIQ." > "PODER ADQUISITIVO" > "Total efectivo 15.1K" >
 *                    suma de "EUR/USD Efectivo" (último recurso: mezcla divisas)
 * SEMÁNTICA (regla dictada 15-ago): INVERTIDO = VAL. MDO. · EFECTIVO = EXCESO LIQ. ·
 * TOTAL = NAV = invertido + efectivo. Esta foto de cabecera es la fuente del FX
 * implícito, POR SÍ SOLA VALE aunque no contenga tabla de posiciones completa.
 * `missing` enumera las etiquetas NO encontradas (para avisos exactos en la UI).
 */
export interface IBKAccountSummary {
  accountTotal: number | null;
  totalCash: number | null;
  marketValue: number | null;
  missing?: string[];
}

// ── Parser v2 de la cabecera de totales (fix 15-ago, fotos REALES) ────────────
// La causa raíz del fallo en producción: en la app IBK las tiles muestran la
// ETIQUETA ARRIBA y el VALOR DEBAJO — el OCR emite "VAL. MDO. EXCESO LIQ." en una
// línea y "7,010.12 15,102.24" en la SIGUIENTE; el parser v1 exigía etiqueta y
// número en el mismo renglón y devolvía null. v2: asociación etiqueta→valor en
// mismo renglón O renglón(es) siguientes por ORDEN, formatos EN (7,010.12) y ES
// (7.010,12), sufijos K/M, confusiones O↔0/l↔1, y reparación por la identidad
// NAV = VAL.MDO. + EXCESO LIQ. (±3%).

/** Sanea confusiones típicas de OCR dentro de un token NUMÉRICO (O→0, l/I→1, S→5). */
function sanitizeOcrDigits(raw: string): string {
  if (!/\d/.test(raw)) return raw; // sin ningún dígito no es un número — no tocar
  return raw.replace(/[OoQ]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5");
}

/**
 * Parsea un importe monetario con locale ambiguo (EN "7,010.12" / ES "7.010,12"),
 * sufijo K/M y ruido OCR. Regla de separadores: grupos de EXACTAMENTE 3 dígitos =
 * miles (en ambos locales); último separador con 1-2 dígitos detrás = decimal.
 */
function parseMoneyToken(raw: string): number | null {
  let t = sanitizeOcrDigits(raw.trim()).replace(/[€$£\s]/g, "");
  const suffix = t.match(/([KM])$/i)?.[1]?.toUpperCase() ?? null;
  if (suffix) t = t.slice(0, -1);
  t = t.replace(/[^\d.,-]/g, "");
  const neg = t.startsWith("-");
  if (neg) t = t.slice(1);
  if (!/^\d/.test(t)) return null;
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)) {
    // Miles agrupados (EN o ES), con decimal opcional al final: 22,110 · 15.102,24 · 7,010.12
    const m = t.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/);
    if (!m) return null;
    t = m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "");
  } else if (/^\d+[.,]\d{1,2}$/.test(t)) {
    // Decimal simple en cualquiera de los dos locales: 0.00 · 15,1 · 9.59
    t = t.replace(",", ".");
  } else if (/^\d+[.,]\d{4,}$/.test(t)) {
    t = t.replace(",", "."); // decimal largo (5,0101)
  } else if (/^\d+$/.test(t)) {
    // entero puro
  } else {
    return null; // patrón raro (varios separadores incoherentes) — mejor null que inventar
  }
  let v = parseFloat(t);
  if (!Number.isFinite(v)) return null;
  // REGLA MONETARIA (hallazgo e2e OCR 15-ago): un importe con >2 decimales es
  // imposible en dinero — significa que el OCR PERDIÓ un separador ("7.010,12"
  // leído "7.01012"). Reinterpretar como dígitos/100 (céntimos): 701012→7010.12.
  const frac = t.split(".")[1];
  if (frac && frac.length > 2) {
    v = parseInt(t.replace(".", ""), 10) / 100;
  }
  if (suffix === "K") v *= 1_000;
  if (suffix === "M") v *= 1_000_000;
  return neg ? -v : v;
}

/** Todos los importes de una línea, en orden, con su posición (para asociar a etiquetas). */
function moneyTokensOf(line: string): { v: number; idx: number }[] {
  const out: { v: number; idx: number }[] = [];
  const re = /[0-9OoQIl|][0-9OoQIl|.,]*\s?[KM]?(?=[\s%€$)]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const v = parseMoneyToken(m[0]);
    if (v != null && v >= 0 && v < 100_000_000) out.push({ v, idx: m.index });
  }
  return out;
}

// Detectores FUZZY de las etiquetas de la cabecera IBK (tolerantes a ruido OCR)
const HEADER_LABELS: Array<{ key: "mdo" | "liq" | "margen" | "poder"; re: RegExp; name: string }> = [
  { key: "mdo", re: /VA[LI1]\.?,?\s*M[DO0]{1,3}\.?/i, name: "VAL. MDO." },
  { key: "liq", re: /E[XK]CE[S5][O0Q]?\s*L[I1][QO0]?\.?/i, name: "EXCESO LIQ." },
  { key: "margen", re: /MARGEN/i, name: "MARGEN" },
  { key: "poder", re: /P[O0Q]DER\s*ADQ|BUYING\s*POWER/i, name: "PODER ADQUISITIVO" },
];

export function parseIBKAccountSummary(text: string): IBKAccountSummary {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const plausible = (v: number | null): v is number =>
    v != null && Number.isFinite(v) && v >= 0 && v < 100_000_000;

  // ── 1) Etiquetas de la rejilla de totales: mismo renglón o renglones siguientes ──
  const found: Partial<Record<"mdo" | "liq" | "margen" | "poder", number>> = {};
  let pending: Array<"mdo" | "liq" | "margen" | "poder"> = [];
  let pendingAge = 0;
  for (const line of lines) {
    const labels: Array<{ key: (typeof HEADER_LABELS)[number]["key"]; at: number; end: number }> = [];
    for (const { key, re } of HEADER_LABELS) {
      const m = line.match(re);
      if (m && m.index != null && found[key] == null) labels.push({ key, at: m.index, end: m.index + m[0].length });
    }
    labels.sort((a, b) => a.at - b.at);
    const nums = moneyTokensOf(line);

    if (labels.length > 0) {
      // Asociación en el MISMO renglón: primer número tras la etiqueta y antes de la siguiente
      const unresolved: typeof pending = [];
      for (let i = 0; i < labels.length; i++) {
        const next = labels[i + 1]?.at ?? Infinity;
        const n = nums.find((x) => x.idx >= labels[i].end && x.idx < next);
        if (n) found[labels[i].key] = n.v;
        else unresolved.push(labels[i].key);
      }
      pending = unresolved; // etiqueta(s) sin valor → el valor viene en el/los renglones de DEBAJO
      pendingAge = 0;
      continue;
    }
    // Renglón sin etiquetas: si hay etiquetas pendientes y este renglón trae números, asociar en orden
    if (pending.length > 0 && nums.length > 0) {
      for (let i = 0; i < pending.length && i < nums.length; i++) {
        if (found[pending[i]] == null) found[pending[i]] = nums[i].v;
      }
      pending = pending.slice(nums.length);
      pendingAge = 0;
      continue;
    }
    if (pending.length > 0 && ++pendingAge > 2) pending = []; // caducidad: 2 renglones
  }

  let marketValue = plausible(found.mdo ?? null) ? (found.mdo as number) : null;
  let totalCash = plausible(found.liq ?? null) ? (found.liq as number) : null;

  // ── 2) Fallbacks de efectivo: PODER ADQUISITIVO → "Total efectivo 15.1K" → por divisa ──
  const perCurrencyCash: number[] = [];
  let totalEfectivo: number | null = null;
  for (const l of lines) {
    const mTotal = l.match(/total\s+(?:efectivo|cash)\s+([\dOoQIl|.,]+\s*[KM]?)/i);
    if (mTotal && totalEfectivo == null) totalEfectivo = parseMoneyToken(mTotal[1]);
    const mCur = l.match(/^(?:EUR|USD|GBP|CHF)\s+(?:efectivo|cash)\s+([\dOoQIl|.,]+\s*[KM]?)/i);
    if (mCur) { const v = parseMoneyToken(mCur[1]); if (v != null) perCurrencyCash.push(v); }
  }
  if (totalEfectivo == null) {
    const cashAnchor = lines.findIndex((l) => /saldos?\s+en\s+efectivo|cash\s+balances/i.test(l));
    if (cashAnchor >= 0) {
      for (let i = cashAnchor + 1; i < Math.min(lines.length, cashAnchor + 7); i++) {
        const m = lines[i].match(/^total\s+([\dOoQIl|.,]+\s*[KM]?)$/i);
        if (m) { totalEfectivo = parseMoneyToken(m[1]); break; }
      }
    }
  }
  if (totalCash == null && plausible(found.poder ?? null)) totalCash = found.poder as number;
  if (totalCash == null && plausible(totalEfectivo)) totalCash = totalEfectivo;
  if (totalCash == null && perCurrencyCash.length > 0) {
    totalCash = perCurrencyCash.reduce((a, b) => a + b, 0); // mezcla divisas — último recurso
  }

  // ── 3) NAV: número grande AGRUPADO en miles, solo (o casi) en su renglón, zona alta ──
  let accountTotal: number | null = null;
  const navCandidates: number[] = [];
  const anchor = lines.findIndex((l) => /^(cartera|portfolio)\b/i.test(l));
  const from = anchor >= 0 ? anchor : 0;
  for (let i = from; i < Math.min(lines.length, from + 12); i++) {
    for (const m of lines[i].matchAll(/(?:^|\s)([\dOoQIl|]{1,3}(?:[.,][\dOoQIl|]{3})+)(?=\s|$)/g)) {
      const v = parseMoneyToken(m[1]);
      if (v != null && v >= 1000 && v < 100_000_000) navCandidates.push(v);
    }
  }
  // Preferir el candidato que cumpla la identidad NAV = VAL.MDO. + EXCESO LIQ. (±3%)
  if (marketValue != null && totalCash != null) {
    const derived = marketValue + totalCash;
    accountTotal = navCandidates.find((v) => Math.abs(v - derived) / derived <= 0.03) ?? Math.round(derived);
  } else {
    accountTotal = navCandidates[0] ?? null;
  }

  // ── 4) Reparación por identidad: si falta UNA pieza, se deriva de las otras dos ──
  if (marketValue == null && accountTotal != null && totalCash != null && accountTotal >= totalCash) {
    marketValue = Math.round((accountTotal - totalCash) * 100) / 100;
  }
  if (totalCash == null && accountTotal != null && marketValue != null && accountTotal >= marketValue) {
    totalCash = Math.round((accountTotal - marketValue) * 100) / 100;
  }

  // ── 5) Diagnóstico exacto para la UI: qué etiqueta NO se pudo leer ──
  const missing: string[] = [];
  if (marketValue == null) missing.push("VAL. MDO.");
  if (totalCash == null) missing.push("EXCESO LIQ. / Total efectivo");
  if (accountTotal == null) missing.push("NAV (número grande)");
  return { accountTotal, totalCash, marketValue, missing: missing.length ? missing : undefined };
}

// ── Robustez de imagen ANTES del OCR (fix 15-ago, fallo real IMG_9360.jpeg) ──
// Las fotos de iPhone (4032×3024, 3-8 MB) agotaban memoria/tiempo del worker de
// tesseract y los HEIC renombrados .jpeg fallaban en silencio. Ahora: decodificar
// respetando la orientación EXIF, reducir a máx 2200px y re-codificar a PNG.

const OCR_MAX_DIM = 2200;      // px: de sobra para leer texto de una captura
const OCR_TIMEOUT_MS = 120_000;

/** ¿Es un contenedor HEIC/HEIF aunque venga renombrado a .jpeg? (firma 'ftyp' + marca). */
async function sniffHeic(file: File): Promise<boolean> {
  try {
    const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    let ascii = "";
    for (const b of buf) ascii += String.fromCharCode(b);
    return ascii.includes("ftyp") && /heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1/i.test(ascii);
  } catch { return false; }
}

/** Decodifica + orienta (EXIF) + reduce + re-codifica a PNG. null = navegador no puede decodificarla. */
async function preprocessImageForOCR(file: File): Promise<Blob | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Fallback vía <img> (Safaris viejos sin opciones de createImageBitmap)
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode"));
        el.src = url;
      });
      bmp = await createImageBitmap(img);
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    const scale = Math.min(1, OCR_MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob;
  } finally {
    bmp.close?.();
  }
}

/**
 * Lee una FOTO (captura de pantalla del carrete del iPhone, Archivos, etc.)
 * con OCR (tesseract.js, lazy-loaded — no infla el bundle principal) y
 * extrae posiciones + resumen de cuenta. Todo en el dispositivo, nada se sube.
 * Lanza Error con MOTIVO legible (HEIC no soportado, imagen indecodificable,
 * timeout) para que la UI pueda explicar el fallo y ofrecer reintento.
 */
export async function ocrImageToText(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const pre = await preprocessImageForOCR(file);
  if (!pre) {
    if (await sniffHeic(file)) {
      throw new Error(
        "es un HEIC (aunque se llame .jpeg) y este navegador no lo decodifica — haz captura de pantalla (PNG) o exporta como JPEG real y reintenta",
      );
    }
    throw new Error("imagen no decodificable (¿archivo dañado o formato raro?) — vuelve a hacer la captura y reintenta");
  }
  const Tesseract = await import("tesseract.js");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`el OCR superó ${OCR_TIMEOUT_MS / 1000}s — recorta la captura a la zona de la tabla y reintenta`)),
      OCR_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([
      Tesseract.recognize(pre, "eng", {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text" && onProgress) {
            onProgress(Math.round(m.progress * 100));
          }
        },
      }),
      timeout,
    ]);
    return result.data.text;
  } catch (err) {
    if (err instanceof Error && /superó/.test(err.message)) throw err;
    throw new Error("el motor OCR falló al procesarla — reintenta (si se repite, recorta la captura o usa PNG)");
  } finally {
    clearTimeout(timer);
  }
}

export async function parseImagePortfolio(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ positions: IBKPosition[]; summary: IBKAccountSummary; text: string }> {
  const text = await ocrImageToText(file, onProgress);
  return {
    positions: parseOCRPortfolio(text),
    summary: parseIBKAccountSummary(text),
    text,
  };
}

// ── Totales de cartera — FUENTE ÚNICA (regla dictada 15-ago) ──────────────────
// INVERTIDO = "VAL. MDO." de la cabecera IBK (Σ pos×último ya en EUR base; más
// fiable que NAV−efectivo, y se comprueba que ambos métodos coinciden).
// EFECTIVO = "EXCESO LIQ." · TOTAL = NAV = invertido + efectivo.
// FX implícito por posición: k = invertido(EUR) / Σ marketValue crudos (USD…) —
// hace que los % por posición cuadren EXACTOS con los %netliq de la app IBK.
// La usan TODAS las secciones de la tarjeta (tabla, SUPREME, banda Rally) para
// que jamás muestren números distintos entre sí.

export interface PortfolioTotals {
  posValueRaw: number;          // Σ marketValue crudos (divisa de cotización, p.ej. USD)
  invested: number | null;      // invertido en divisa base (EUR)
  cash: number | null;          // efectivo por invertir (EUR)
  total: number | null;         // total cartera (EUR)
  fxK: number;                  // factor crudo→EUR aplicado a cada posición (1 = sin conversión)
  fxNormalized: boolean;        // true = los % son EUR reales (cuadran con %netliq de IBK)
  fxRate: number | null;        // FX implícito, p.ej. EURUSD ≈ 1,157 (crudo por 1 EUR)
  investedFromHeader: boolean;  // true = invertido leído de "VAL. MDO." (no derivado)
  methodsAgree: boolean | null; // VAL.MDO. vs NAV−efectivo dentro del 2% (null = no comparable)
}

export function derivePortfolioTotals(p: IBKPortfolio): PortfolioTotals {
  const posValueRaw = p.positions.reduce((s, x) => s + (x.marketValue ?? 0), 0);
  const headerInvested = p.investedValue != null && p.investedValue > 0 ? p.investedValue : null;
  // NAV plausible: con VAL.MDO. debe cubrirlo; sin él, margen amplio (0.5×) porque el
  // Σ crudo puede ser USD y el NAV EUR (el viejo guard 0.98× descartaba NAV válidos).
  const acct = p.accountTotal != null && p.accountTotal > 0 && p.accountTotal < 100_000_000
    && (headerInvested != null ? p.accountTotal >= headerInvested * 0.98 : p.accountTotal >= posValueRaw * 0.5)
    ? p.accountTotal : null;
  const cash = p.cashBalance != null && p.cashBalance >= 0
    ? p.cashBalance
    : acct != null && headerInvested != null
      ? Math.max(0, Math.round((acct - headerInvested) * 100) / 100)
      : acct != null && posValueRaw > 0
        ? Math.max(0, Math.round(acct - posValueRaw))
        : null;
  const investedNav = acct != null && cash != null ? Math.max(0, acct - cash) : null;
  const invested = headerInvested ?? investedNav ?? (posValueRaw > 0 ? posValueRaw : null);
  const methodsAgree = headerInvested != null && investedNav != null && headerInvested > 0
    ? Math.abs(headerInvested - investedNav) / headerInvested < 0.02
    : null;
  const total = acct ?? (invested != null && cash != null ? invested + cash : invested);

  let fxK = 1;
  let fxNormalized = false;
  let fxRate: number | null = null;
  if (invested != null && posValueRaw > 0 && (headerInvested != null || investedNav != null)) {
    const ratio = invested / posValueRaw;
    // Rango sano de un factor FX implícito (EUR/USD y similares); fuera de él, crudo.
    if (ratio > 0.5 && ratio < 1.6) {
      fxK = ratio;
      fxNormalized = true;
      fxRate = posValueRaw / invested;
    }
  }
  return {
    posValueRaw,
    invested,
    cash,
    total,
    fxK,
    fxNormalized,
    fxRate,
    investedFromHeader: headerInvested != null,
    methodsAgree,
  };
}

export function initialOptimal2026(): Optimal2026Result {
  return { ok: true, items: [] };
}

export async function fetchOptimal2026(): Promise<Optimal2026Result> {
  const res = await fetch("/api/optimal2026");
  if (res.status === 404) {
    // No data yet — return empty state gracefully
    return { ok: true, items: [], message: "Sin datos aún. Ejecuta un scan completo." };
  }
  if (!res.ok) throw new Error(`Optimal2026 fetch failed: ${res.status}`);
  const data = await res.json();
  return data as Optimal2026Result;
}

/**
 * Enriquece los items de Optimal2026 con PRECIO EN TIEMPO REAL (price + pctDay) vía el helper
 * compartido (cascade Finnhub→Yahoo→Stooq, US y EU) — el MISMO que usa FABLE01, probado y estable.
 * El precio del scan es el último CIERRE (correcto para la señal); esto solo actualiza lo que se
 * MUESTRA. Conserva el cierre si la cotización no está disponible. Aislado: nunca afecta a otros módulos.
 */
export async function enrichOptimal2026WithLiveQuotes(
  items: Optimal2026Item[],
): Promise<Optimal2026Item[]> {
  if (!Array.isArray(items) || items.length === 0) return items;
  const map = await fetchLiveQuoteMap(items.map((it) => it.symbol));
  if (map.size === 0) return items;
  const now = new Date().toISOString();
  return items.map((it) => {
    const q = map.get(liveTickerOf(it.symbol));
    return q
      ? { ...it, price: q.price, pctDay: q.changePercent ?? it.pctDay, priceRefreshedAt: now }
      : it;
  });
}
