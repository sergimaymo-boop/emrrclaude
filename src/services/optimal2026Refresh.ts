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
  quantity: number;     // número de acciones
  avgCost: number | null;      // precio medio de compra
  currentPrice: number | null; // precio al exportar (puede actualizarse con vivo)
  marketValue: number | null;  // valor de mercado
  unrealizedPnL: number | null;
  currency: string;     // "USD" | "EUR" | etc.
}

export interface IBKPortfolio {
  positions: IBKPosition[];
  loadedAt: string;     // ISO timestamp de la carga
  source: "IBK_CSV" | "IBK_PHOTO" | "MANUAL"; // IBK_PHOTO = OCR (números aproximados, verificar)
}

const IBK_STORAGE_KEY = "optimal2026_ibk_portfolio_v1";

export function savePortfolioToStorage(portfolio: IBKPortfolio): void {
  try { localStorage.setItem(IBK_STORAGE_KEY, JSON.stringify(portfolio)); } catch { /* ignore quota errors */ }
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
  let t = token.replace(/[$€£+%]/g, "").trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    // Formato europeo: 1.234,56
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    // Formato US: 1,234.56
    t = t.replace(/,/g, "");
  }
  return parseFloat(t);
}

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
]);

/**
 * Parser heurístico para texto OCR de capturas de la app/web de IBK.
 *
 * Formatos que reconoce (verificado 25-jul-2026 con la cartera real de Sergi):
 *   • App IBK móvil, pestaña Posiciones: "PST BVME 26.31 30 -27.60 -3.06%"
 *     → columnas: Último (precio, DECIMAL) · Posición (acciones, ENTERO) · PyG · %
 *   • Listado simple: "AAPL 100 150.25" → cantidad (ENTERO) · precio (DECIMAL)
 *
 * La ambigüedad cantidad/precio se resuelve por tipo: entre los dos primeros números,
 * el ENTERO es la cantidad y el DECIMAL el precio (la app IBK pinta precio primero).
 *
 * Se descartan las líneas de NOMBRE DE EMPRESA que la app pinta bajo cada ticker
 * ("POSTE ITALIANE SPA 26.30-26.31"): su pareja de números es el rango del día
 * (dos decimales casi iguales) → regla del rango.
 */
export function parseOCRPortfolio(text: string): IBKPosition[] {
  const positions: IBKPosition[] = [];
  const seen = new Set<string>();
  const isInt = (n: number) => Number.isInteger(n);
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const symIdx = tokens.findIndex(
      (t) => /^[A-Z]{2,6}$/.test(t) && !OCR_NOT_TICKERS.has(t),
    );
    if (symIdx < 0) continue;
    const symbol = tokens[symIdx];
    if (seen.has(symbol)) continue;
    const nums = tokens
      .slice(symIdx + 1)
      // "26.30-26.31" (rango del día) llega como UN token con guión → separarlo en dos
      // números para que la regla del rango pueda reconocer la línea del nombre.
      .flatMap((t) => {
        const range = t.match(/^([\d.,]+)-([\d.,]+)%?$/);
        return range ? [range[1], range[2]] : [t];
      })
      .map(parseOcrNumber)
      .filter((n) => isFinite(n));
    if (nums.length === 0) continue;

    let quantity: number, currentPrice: number | null = null, unrealizedPnL: number | null = null;
    const [a, b] = [nums[0], nums[1]];

    if (b != null && !isInt(a) && isInt(b) && a > 0 && b > 0) {
      // Layout app IBK: precio (decimal) · posición (entero) · PyG · %
      currentPrice = a;
      quantity = b;
      if (nums.length > 2 && Math.abs(nums[2]) < a * b * 2) unrealizedPnL = nums[2];
    } else if (b != null && !isInt(a) && !isInt(b) && a > 0 && b > 0
               && Math.abs(a - b) / Math.max(a, b) < 0.02) {
      // Dos decimales casi iguales = rango del día en la línea del NOMBRE de empresa → descartar
      continue;
    } else {
      // Layout simple: cantidad · coste/precio
      quantity = a;
      if (b != null && b > 0) currentPrice = b;
    }

    if (!isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) continue;
    seen.add(symbol);
    positions.push({
      symbol,
      quantity,
      avgCost: null, // la app IBK no muestra coste medio en esta vista — no inventarlo
      currentPrice,
      marketValue: currentPrice != null ? Math.round(currentPrice * quantity * 100) / 100 : null,
      unrealizedPnL,
      currency: "USD",
    });
  }
  // Seguridad extra: si dos filas consecutivas comparten cantidad exacta (ticker + nombre
  // con la misma cifra al lado), la segunda es la línea del nombre → fusionar en la primera.
  const deduped: IBKPosition[] = [];
  for (const p of positions) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.quantity === p.quantity) {
      if (prev.currentPrice == null && p.currentPrice != null) prev.currentPrice = p.currentPrice;
      if (prev.unrealizedPnL == null && p.unrealizedPnL != null) prev.unrealizedPnL = p.unrealizedPnL;
      continue;
    }
    deduped.push(p);
  }
  return deduped;
}

/**
 * Lee una FOTO (captura de pantalla del carrete del iPhone, Archivos, etc.)
 * con OCR (tesseract.js, lazy-loaded — no infla el bundle principal) y
 * extrae las posiciones. Todo en el dispositivo, nada se sube al servidor.
 */
export async function parseImagePortfolio(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<IBKPosition[]> {
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.recognize(file, "eng", {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  return parseOCRPortfolio(result.data.text);
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
