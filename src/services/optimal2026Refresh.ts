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

export function savePortfolioToStorage(portfolio: IBKPortfolio): void {
  try {
    localStorage.setItem(IBK_STORAGE_KEY, JSON.stringify(portfolio));
    appendPortfolioHistory(portfolio);
  } catch { /* ignore quota errors */ }
}

export function loadPortfolioFromStorage(): IBKPortfolio | null {
  try {
    const raw = localStorage.getItem(IBK_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as IBKPortfolio;
    if (!Array.isArray(p.positions) || p.positions.length === 0) return null;
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
  ["price", /^(ultimo|último|last|precio|price)/i],
  ["value", /^(vlr|valor|mrcd|market|value)/i],
  // "Bs d cst" (base de coste) — fix 15-ago: sin mapearla, su número desplazaba el
  // mapeo posicional y el PyG leía la base de coste. Se captura → avgCost = coste/cantidad.
  ["cost", /^(b[s5]\.?$|cst\.?$|coste|cost$|basis)/i],
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
      .map((t) => ({ v: parseOcrNumber(t), dec: /[.,]\d{1,4}$/.test(t.replace(/[$€£+%—–−]/g, "")) }))
      .filter((n) => isFinite(n.v));
    if (rawNums.length === 0) continue;

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
      // cuadra, se repara la cantidad desde valor/precio antes de rendirse.
      const tryAt = (offset: number) => {
        const at = (key: string): number | null => {
          const idx = colMap.indexOf(key);
          const j = idx >= 0 ? idx + offset : -1;
          return j >= 0 && j < rawNums.length ? rawNums[j].v : null;
        };
        return { q: at("qty"), p: at("price"), pnl: at("pnl"), mv: at("value"), cb: at("cost") };
      };
      type Cand = ReturnType<typeof tryAt>;
      const verifiable = (c: Cand) => c.mv != null && c.p != null && c.p > 0 && c.q != null && c.q > 0;
      const consistent = (c: Cand) =>
        verifiable(c) ? Math.abs((c.mv as number) - (c.p as number) * (c.q as number)) / (c.mv as number) < 0.2 : true;
      let pick: Cand | null = null;
      for (const off of [0, -1, 1]) {
        const c = tryAt(off);
        if (c.q == null || c.q <= 0 || c.q > 1_000_000) continue;
        if (consistent(c)) { pick = c; break; }
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
      quantity = pick.q;
      currentPrice = pick.p != null && pick.p > 0 ? pick.p : null;
      unrealizedPnL = pick.pnl != null && Math.abs(pick.pnl) < 10_000_000 ? pick.pnl : null;
      mappedValue = pick.mv != null && pick.mv > 0 ? pick.mv : null;
      mappedCostBasis = pick.cb != null && pick.cb > 0 ? pick.cb : null;
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
 *   • accountTotal — el número grande arriba (NAV, ej. "22.110")
 *   • marketValue  — "VAL. MDO." (Σ posiciones YA en divisa base EUR, ej. "7.010,12")
 *   • totalCash    — "EXCESO LIQ." (ej. "15.102,24") > "Total efectivo 15,1K" >
 *                    suma de "EUR/USD Efectivo" (último recurso: mezcla divisas)
 * SEMÁNTICA (regla dictada 15-ago): INVERTIDO = VAL. MDO. · EFECTIVO = EXCESO LIQ. ·
 * TOTAL = NAV = invertido + efectivo. Esta foto de cabecera es la fuente del FX
 * implícito, POR SÍ SOLA VALE aunque no contenga tabla de posiciones completa.
 */
export interface IBKAccountSummary {
  accountTotal: number | null;
  totalCash: number | null;
  marketValue: number | null;
}

// AUDIT FIX (26-jul): locale-aware — "16,9K" español y "16.9K" US son ambos 16.900;
// "16.857" (miles europeos) es 16.857, no 17. Regla: el ÚLTIMO separador seguido de
// 1-2 dígitos es decimal; separadores seguidos de 3 dígitos son de miles.
function parseKNumber(raw: string): number | null {
  const m = raw.trim().match(/^([\d.,]+)\s*([KM])?$/i);
  if (!m) return null;
  let num = m[1];
  const lastSep = Math.max(num.lastIndexOf("."), num.lastIndexOf(","));
  if (lastSep >= 0) {
    const tail = num.slice(lastSep + 1);
    if (tail.length >= 1 && tail.length <= 2 && !tail.includes(".") && !tail.includes(",")) {
      num = `${num.slice(0, lastSep).replace(/[.,]/g, "")}.${tail}`;
    } else {
      num = num.replace(/[.,]/g, "");
    }
  }
  let v = parseFloat(num);
  if (/^k$/i.test(m[2] ?? "")) v *= 1_000;
  if (/^m$/i.test(m[2] ?? "")) v *= 1_000_000;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

export function parseIBKAccountSummary(text: string): IBKAccountSummary {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let accountTotal: number | null = null;
  let totalCash: number | null = null;
  let marketValue: number | null = null;
  const perCurrencyCash: number[] = [];
  const plausibleMoney = (v: number | null): v is number =>
    v != null && Number.isFinite(v) && v >= 0 && v < 100_000_000;

  for (const l of lines) {
    // "VAL. MDO. 7.010,12" — Σ posiciones en divisa BASE (tolerante a OCR: VAL MDO, VAL.MD0.)
    if (marketValue == null) {
      const mVm = l.match(/VAL\.?\s*M[DO0][DO0]?\.?\s*:?\s+([\d.,]+)/i);
      if (mVm) { const v = parseOcrNumber(mVm[1]); if (plausibleMoney(v) && v > 0) marketValue = v; }
    }
    // "EXCESO LIQ. 15.102,24" — EFECTIVO POR INVERTIR (regla 15-ago; decimales exactos,
    // preferido sobre el "Total 15,1K" redondeado). Tolerante a OCR: L1Q, LIO.
    if (totalCash == null) {
      const mEx = l.match(/EXCESO\s+L[I1][QO0]?\.?\s*:?\s+([\d.,]+)/i);
      if (mEx) { const v = parseOcrNumber(mEx[1]); if (plausibleMoney(v)) totalCash = v; }
    }
    const mTotal = l.match(/total\s+(?:efectivo|cash)\s+([\d.,]+\s*[KM]?)/i);
    if (mTotal && totalCash == null) totalCash = parseKNumber(mTotal[1]);
    const mCur = l.match(/^(?:EUR|USD|GBP|CHF)\s+(?:efectivo|cash)\s+([\d.,]+\s*[KM]?)/i);
    if (mCur) { const v = parseKNumber(mCur[1]); if (v != null) perCurrencyCash.push(v); }
  }

  // Bloque "Saldos en efectivo": el "Total 15,1K" (ya en divisa base) va sin la palabra
  // "efectivo" — se busca SOLO dentro del bloque para no confundirlo con otros totales.
  if (totalCash == null) {
    const cashAnchor = lines.findIndex((l) => /saldos?\s+en\s+efectivo|cash\s+balances/i.test(l));
    if (cashAnchor >= 0) {
      for (let i = cashAnchor + 1; i < Math.min(lines.length, cashAnchor + 7); i++) {
        const m = lines[i].match(/^total\s+([\d.,]+\s*[KM]?)$/i);
        if (m) { totalCash = parseKNumber(m[1]); break; }
      }
    }
  }
  // Último recurso: suma de saldos POR DIVISA (mezcla divisas sin FX — solo mejor que nada)
  if (totalCash == null && perCurrencyCash.length > 0) {
    totalCash = perCurrencyCash.reduce((a, b) => a + b, 0);
  }

  // Total de cuenta (NAV): número grande con separador de miles ("22.110") en las primeras
  // líneas tras "Cartera"/"Portfolio" (cabecera de la app IBK) o al inicio del texto.
  const anchor = lines.findIndex((l) => /^(cartera|portfolio)$/i.test(l));
  const from = anchor >= 0 ? anchor : 0;
  for (let i = from; i < Math.min(lines.length, from + 8); i++) {
    const m = lines[i].match(/^([\d]{1,3}(?:[.,]\d{3})+)$/);
    if (m) {
      const v = parseFloat(m[1].replace(/[.,]/g, ""));
      if (Number.isFinite(v) && v >= 1000 && v < 100_000_000) { accountTotal = v; break; }
    }
  }

  // VERIFICACIÓN CRUZADA (regla 15-ago): NAV debe ≈ VAL.MDO. + EXCESO LIQ. Si el NAV
  // leído se desvía >3% (dígito perdido por OCR) — o falta — se reconstruye de la suma.
  if (marketValue != null && totalCash != null) {
    const derived = Math.round(marketValue + totalCash);
    if (accountTotal == null || Math.abs(accountTotal - derived) / derived > 0.03) {
      accountTotal = derived;
    }
  }
  return { accountTotal, totalCash, marketValue };
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
