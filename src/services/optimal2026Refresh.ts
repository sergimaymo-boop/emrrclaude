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
  cashBalance?: number | null; // efectivo disponible (lo introduce el usuario) → permite calcular pesos reales y alineación con SUPREME
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

export function parseOCRPortfolio(text: string): IBKPosition[] {
  const positions: IBKPosition[] = [];
  const seen = new Set<string>();
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

    // Regla de FRASE: si tras el candidato viene OTRA palabra en mayúsculas que no es
    // un código de bolsa, esto es un nombre de empresa ("PALO ALTO…"), no una posición.
    const next = tokens[symIdx + 1];
    if (next && /^[A-Z]{2,12}$/.test(next) && !OCR_EXCHANGES.has(next)) continue;

    // Números con su formato textual: decimal explícito = precio; entero = cantidad.
    // "26.30-26.31" (rango del día) se separa en dos números para la regla del rango.
    const rawNums = tokens
      .slice(symIdx + 1)
      .flatMap((t) => {
        const range = t.match(/^([\d.,]+)-([\d.,]+)%?$/);
        return range ? [range[1], range[2]] : [t];
      })
      .map((t) => ({ v: parseOcrNumber(t), dec: /[.,]\d{1,4}$/.test(t.replace(/[$€£+%]/g, "")) }))
      .filter((n) => isFinite(n.v));
    if (rawNums.length === 0) continue;

    let quantity: number, currentPrice: number | null = null, unrealizedPnL: number | null = null;
    const [a, b] = [rawNums[0], rawNums[1]];
    const pnlCandidate = rawNums.length > 2 ? rawNums[2].v : null;

    if (b == null) {
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
      avgCost: null, // la app IBK no muestra coste medio en esta vista — no inventarlo
      currentPrice,
      marketValue: currentPrice != null ? Math.round(currentPrice * quantity * 100) / 100 : null,
      unrealizedPnL,
      currency: "USD",
    });
  }
  return positions;
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
