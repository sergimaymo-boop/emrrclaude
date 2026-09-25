/**
 * PROVIDER CASCADE SYSTEM
 *
 * QUOTE PRIORITY:
 *   TNX: FRED → Finnhub + Yahoo (parallel) → TwelveData → Stooq
 *   All: Finnhub → TwelveData → FMP → Yahoo → Stooq
 *
 * HISTORICAL PRIORITY (critical for scan batches):
 *   1. EODHD       (active key, best EU+US coverage — used until cancelled)
 *   2. TwelveData + Yahoo (parallel race, free)
 *   3. Stooq       (last resort, free)
 */

const TIMEOUT_MS = 7000;

// ─── Symbol mappings ──────────────────────────────────────────────────────────

// EODHD suffix → Finnhub prefix (indices use ^ prefix)
const EODHD_TO_FINNHUB = {
  "SPY.US":     "SPY",
  "LQD.US":     "LQD",
  "HYG.US":     "HYG",
  "VIX.INDX":   "^VIX",
  "VVIX.INDX":  "^VVIX",
  "US10Y.GBOND":"^TNX",
  // NOTE: Finnhub's "MOVE" symbol resolves to "Corvex, Inc." (an unrelated equity, ~$18-19),
  // NOT the ICE BofA MOVE Index (bond market volatility, ~75-90). Omit this mapping so the
  // cascade skips Finnhub and falls through to Yahoo's "^MOVE" (the correct index, see YAHOO_DIRECT).
};

// EODHD exchange suffix → Yahoo Finance suffix
const EODHD_TO_YAHOO_SUFFIX = {
  US:    "",
  XETRA: ".DE",
  PA:    ".PA",
  AS:    ".AS",
  BR:    ".BR",
  LS:    ".LS",
  MI:    ".MI",
  SW:    ".SW",
  LSE:   ".L",
  L:     ".L",
};

// Direct Yahoo overrides for special symbols
const YAHOO_DIRECT = {
  "VIX.INDX":    "^VIX",
  "VVIX.INDX":   "^VVIX",
  "US10Y.GBOND": "^TNX",
  "MOVE.INDX":   "^MOVE",
};

// FMP uses plain tickers for US stocks, exchange suffix for EU
const EODHD_TO_FMP = {
  US:    "",        // AAPL.US → AAPL
  XETRA: ".XETRA", // SIE.XETRA → SIE.XETRA
  PA:    ".PA",     // MC.PA → MC.PA
  AS:    ".AS",     // ASML.AS → ASML.AS
  BR:    ".BR",
  LS:    ".LS",
  MI:    ".MI",
  SW:    ".SW",
  LSE:   ".L",      // SHEL.LSE → SHEL.L
};

const FMP_DIRECT = {
  "VIX.INDX":    null, // FMP doesn't cover VIX index
  "VVIX.INDX":   null,
  "US10Y.GBOND": null, // Use FRED for TNX
  "MOVE.INDX":   null,
};

export function toFMPSymbol(eodhdSymbol) {
  if (FMP_DIRECT[eodhdSymbol] !== undefined) return FMP_DIRECT[eodhdSymbol];
  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return null;
  const ticker = parts[0];
  const suffix = parts.slice(1).join(".");
  const fmpSuffix = EODHD_TO_FMP[suffix];
  if (fmpSuffix === undefined) return null;
  return ticker + fmpSuffix;
}

// EODHD suffix → Twelve Data exchange suffix
const EODHD_TO_TWELVEDATA_EXCHANGE = {
  US:    "",       // AAPL.US → AAPL
  XETRA: ":XETRA",// SIE.XETRA → SIE:XETRA
  PA:    ":EURONEXT", // MC.PA → MC:EURONEXT
  AS:    ":EURONEXT", // ASML.AS → ASML:EURONEXT
  BR:    ":EURONEXT", // KBC.BR → KBC:EURONEXT
  LS:    ":EURONEXT", // EDP.LS → EDP:EURONEXT
  MI:    ":MIL",   // ENI.MI → ENI:MIL
  SW:    ":SWX",   // NESN.SW → NESN:SWX
  LSE:   ":LSE",   // SHEL.LSE → SHEL:LSE
};

const TWELVEDATA_DIRECT = {
  "VIX.INDX":    "VIX",
  "US10Y.GBOND": "TNX",
};

// EODHD suffix → Stooq suffix
const EODHD_TO_STOOQ_SUFFIX = {
  US:    ".US",
  XETRA: ".DE",
  PA:    ".FR",
  AS:    ".NL",
  BR:    ".BE",
  LS:    ".PT",
  MI:    ".IT",
  SW:    ".CH",
  LSE:   ".UK",
};

const STOOQ_DIRECT = {
  "VIX.INDX":    "^VIX",
  "US10Y.GBOND": "^TNX",
};

// ─── Symbol converters ────────────────────────────────────────────────────────

export function toTwelveDataSymbol(eodhdSymbol) {
  if (TWELVEDATA_DIRECT[eodhdSymbol]) return TWELVEDATA_DIRECT[eodhdSymbol];
  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return null;
  const ticker = parts[0];
  const suffix = parts.slice(1).join(".");
  const exchange = EODHD_TO_TWELVEDATA_EXCHANGE[suffix];
  if (exchange === undefined) return null;
  return ticker + exchange;
}

export function toFinnhubSymbol(eodhdSymbol) {
  if (EODHD_TO_FINNHUB[eodhdSymbol]) return EODHD_TO_FINNHUB[eodhdSymbol];
  // Generic US stocks: strip .US suffix (e.g. AAPL.US → AAPL)
  if (eodhdSymbol.endsWith('.US')) return eodhdSymbol.slice(0, -3);
  return null;
}

export function toYahooSymbol(eodhdSymbol) {
  if (YAHOO_DIRECT[eodhdSymbol]) return YAHOO_DIRECT[eodhdSymbol];
  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return null;
  const ticker = parts[0];
  const suffix = parts.slice(1).join(".");
  const yahoSuffix = EODHD_TO_YAHOO_SUFFIX[suffix];
  if (yahoSuffix === undefined) return null;
  return ticker + yahoSuffix;
}

export function toStooqSymbol(eodhdSymbol) {
  if (STOOQ_DIRECT[eodhdSymbol]) return STOOQ_DIRECT[eodhdSymbol];
  const parts = eodhdSymbol.split(".");
  if (parts.length < 2) return null;
  const ticker = parts[0].toLowerCase();
  const suffix = parts.slice(1).join(".");
  const stooqSuffix = EODHD_TO_STOOQ_SUFFIX[suffix];
  if (stooqSuffix === undefined) return null;
  return ticker + stooqSuffix;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url, extraHeaders = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; EMRR/2.0)",
        ...extraHeaders,
      },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, reason: "Request failed or timed out" };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, reason: "Request failed or timed out" };
  } finally {
    clearTimeout(t);
  }
}

function finiteOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GUARDIA DE HUECOS DE SESIÓN (23-sep-2026): Yahoo a veces devuelve una fecha
// reciente CON timestamp pero SIN OHLC (close nulo) — a diferencia de un fin de
// semana o festivo, que directamente no trae timestamp. Eso es Yahoo reconociendo
// la sesión pero fallando en rellenarla (visto en vivo el 22-sep-2026: hueco de
// MERCADO ENTERO, mismo día nulo en MRNA/MU/DELL/WDC/INTC/SPY/AAPL a la vez).
// Si esa fecha se descarta en silencio, "penúltima barra" pasa a ser la sesión de
// HACE DOS días y cualquier "cambio de sesión" (dayChangePct) sale multiplicado
// sin avisar. Aquí solo detectamos y devolvemos las fechas con hueco reciente;
// quien calcule dayChangePct decide qué hacer (norma: dato no fiable → null, nunca
// una cifra calculada sobre una base equivocada).
function recentGapDates(dated, days = 7) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return dated.filter(d => d.date >= cutoffStr && !(d.close > 0)).map(d => d.date);
}

// ─── Individual provider fetchers ─────────────────────────────────────────────

async function fetchFinnhubQuote(eodhdSymbol, apiKey) {
  const symbol = toFinnhubSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Finnhub", reason: `No Finnhub mapping for ${eodhdSymbol}` };

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "Finnhub", reason: r.reason };

  const d = r.data;
  const price = finiteOrNull(d.c);
  const previousClose = finiteOrNull(d.pc);
  const changePercent = finiteOrNull(d.dp)
    ?? (price && previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null);

  if (!price || price === 0) return { ok: false, provider: "Finnhub", reason: "No valid price (c=0 or missing)" };
  const priceDate = Number.isFinite(d.t) && d.t > 0 ? new Date(d.t * 1000).toISOString().slice(0, 10) : null;
  return { ok: true, provider: "Finnhub", price, previousClose, changePercent, priceDate };
}

async function fetchYahooQuote(eodhdSymbol) {
  const symbol = toYahooSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Yahoo", reason: `No Yahoo mapping for ${eodhdSymbol}` };

  // Cierre anterior DERIVADO de la serie fechada (25-sep-2026): meta.chartPreviousClose
  // depende del rango pedido y regularMarketChangePercent llegó a venir incoherente con
  // el precio (VIX −0,26% contra el cierre de hace dos sesiones). Si la sesión previa
  // viene vacía (hueco del proveedor) no se calcula variación: null, nunca multi-día.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "Yahoo", reason: r.reason };

  const result = r.data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return { ok: false, provider: "Yahoo", reason: "No chart result" };

  const price = finiteOrNull(meta.regularMarketPrice);
  if (!price) return { ok: false, provider: "Yahoo", reason: "No valid price" };

  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const priceDate = Number.isFinite(meta.regularMarketTime)
    ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10) : null;
  let previousClose = null;
  if (priceDate) {
    for (let i = ts.length - 1; i >= 0; i--) {
      if (new Date(ts[i] * 1000).toISOString().slice(0, 10) < priceDate) {
        previousClose = finiteOrNull(closes[i]);
        break;
      }
    }
  }
  const changePercent = previousClose && previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null;
  return { ok: true, provider: "Yahoo", price, previousClose, changePercent, priceDate };
}

async function fetchStooqQuote(eodhdSymbol) {
  const symbol = toStooqSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Stooq", reason: `No Stooq mapping for ${eodhdSymbol}` };

  // Stooq returns CSV: Date,Open,High,Low,Close,Volume
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=d;o;h;l;c;v&h&e=csv`;
  const r = await fetchText(url);
  if (!r.ok) return { ok: false, provider: "Stooq", reason: r.reason };

  const lines = r.text.trim().split("\n").filter(l => l && !l.startsWith("Date"));
  if (lines.length === 0) return { ok: false, provider: "Stooq", reason: "No data rows" };

  const parts = lines[lines.length - 1].split(",");
  const price = finiteOrNull(parts[4]); // Close
  if (!price || price <= 0) return { ok: false, provider: "Stooq", reason: "Invalid price in CSV" };

  return { ok: true, provider: "Stooq", price, previousClose: null, changePercent: null };
}

// ─── Financial Modeling Prep (FMP) ───────────────────────────────────────────

async function fetchFMPQuote(eodhdSymbol, apiKey) {
  const symbol = toFMPSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "FMP", reason: `No FMP mapping for ${eodhdSymbol}` };

  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "FMP", reason: r.reason };

  const data = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!data) return { ok: false, provider: "FMP", reason: "Empty response" };
  if (data.error) return { ok: false, provider: "FMP", reason: data.error };

  const price = finiteOrNull(data.price);
  if (!price || price <= 0) return { ok: false, provider: "FMP", reason: "No valid price" };

  const previousClose = finiteOrNull(data.previousClose);
  const changePercent = finiteOrNull(data.changePercentage ?? data.changesPercentage)
    ?? (previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null);

  return { ok: true, provider: "FMP", price, previousClose, changePercent };
}

// ─── Twelve Data ─────────────────────────────────────────────────────────────

async function fetchTwelveDataQuote(eodhdSymbol, apiKey) {
  const symbol = toTwelveDataSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "TwelveData", reason: `No TwelveData mapping for ${eodhdSymbol}` };

  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "TwelveData", reason: r.reason };

  if (r.data?.code === 400 || r.data?.status === "error") {
    return { ok: false, provider: "TwelveData", reason: r.data?.message ?? "API error" };
  }

  const price = finiteOrNull(r.data?.close ?? r.data?.price);
  if (!price) return { ok: false, provider: "TwelveData", reason: "No valid price" };

  const previousClose = finiteOrNull(r.data?.previous_close);
  const changePercent = finiteOrNull(r.data?.percent_change)
    ?? (previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null);

  return { ok: true, provider: "TwelveData", price, previousClose, changePercent };
}

async function fetchTwelveDataHistory(eodhdSymbol, lookbackDays, apiKey) {
  const symbol = toTwelveDataSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "TwelveData", reason: `No TwelveData mapping for ${eodhdSymbol}` };

  const outputsize = Math.min(lookbackDays, 260);
  // adjust=all → cierre ajustado por SPLITS Y DIVIDENDOS (verificado en vivo 18-ago-2026:
  // AAPL 2025-08-19 close 230.56 crudo → 229.6965 con adjust=all). El default de la API
  // es "splits" (solo splits, SIN dividendos), que NO cuadra con la metodología certificada
  // de producción (serie ajustada total, como adjusted_close de EODHD y adjclose de Yahoo).
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&adjust=all&apikey=${encodeURIComponent(apiKey)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "TwelveData", reason: r.reason };

  if (r.data?.status === "error") return { ok: false, provider: "TwelveData", reason: r.data?.message ?? "API error" };

  const values = r.data?.values;
  if (!Array.isArray(values) || values.length === 0) return { ok: false, provider: "TwelveData", reason: "No values" };

  const bars = values
    .map(v => ({
      date: v.datetime?.slice(0, 10) ?? "",
      open:   finiteOrNull(v.open),
      high:   finiteOrNull(v.high),
      low:    finiteOrNull(v.low),
      close:  finiteOrNull(v.close),
      volume: finiteOrNull(v.volume) ?? 0,
    }))
    .filter(b => b.date && b.close && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) return { ok: false, provider: "TwelveData", reason: "No valid bars" };
  return { ok: true, provider: "TwelveData", bars };
}

// ─── Historical bar fetchers ──────────────────────────────────────────────────

// FMP daily EOD history — 2ª red REAL de histórico (US + EU). Requiere FMP_API_KEY.
// Inactivo mientras la clave esté vacía (cascadeHistory solo lo invoca si hay clave).
async function fetchFMPHistory(eodhdSymbol, lookbackDays, apiKey) {
  const symbol = toFMPSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "FMP", reason: `No FMP mapping for ${eodhdSymbol}` };

  const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "FMP", reason: r.reason };

  // /stable devuelve un array de barras; toleramos también la forma legacy {historical:[...]}.
  const rows = Array.isArray(r.data) ? r.data
    : Array.isArray(r.data?.historical) ? r.data.historical : null;
  if (!rows) return { ok: false, provider: "FMP", reason: r.data?.["Error Message"] ?? "No historical array" };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const bars = rows
    .map(row => ({
      date: row.date?.slice(0, 10) ?? "",
      open:   finiteOrNull(row.open),
      high:   finiteOrNull(row.high),
      low:    finiteOrNull(row.low),
      close:  finiteOrNull(row.adjClose ?? row.close),
      volume: finiteOrNull(row.volume) ?? 0,
    }))
    .filter(b => b.date && b.date >= cutoffStr && b.close && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) return { ok: false, provider: "FMP", reason: "No valid bars" };
  return { ok: true, provider: "FMP", bars };
}

// Convierte los datos crudos de Yahoo en un array de barras limpias.
//
// CORRECCIÓN 18-ago-2026: close = indicators.adjclose (ajustado por dividendos y
// splits), NO el close crudo de quote. Producción certifica toda la metodología
// (mom9m, pesos, stops) sobre serie AJUSTADA — EODHD sirve adjusted_close y esta
// rama servía close crudo, sesgando a la baja el momentum de tickers con dividendo
// (KO.US: mom9m 21,6% crudo vs 24,1% ajustado, verificado en vivo).
// FALLBACK documentado: si Yahoo no envía adjclose para un ticker (índices y
// algunos símbolos no lo traen), se usa el close crudo de esa barra — mejor barra
// cruda que perder la barra. open/high/low siguen crudos (mismo criterio que
// EODHD, que solo ajusta el close; ATR los consume así desde siempre).
function _parseYahooBars(chartResult) {
  if (!chartResult) return { bars: [], gapDates: [], lastBarForming: false };
  const ts = chartResult.timestamp ?? [];
  const q = chartResult.indicators?.quote?.[0] ?? {};
  const adj = chartResult.indicators?.adjclose?.[0]?.adjclose ?? null;
  const dated = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open:   finiteOrNull(q.open?.[i]),
    high:   finiteOrNull(q.high?.[i]),
    low:    finiteOrNull(q.low?.[i]),
    close:  (adj ? finiteOrNull(adj[i]) : null) ?? finiteOrNull(q.close?.[i]),
    volume: finiteOrNull(q.volume?.[i]) ?? 0,
  }));
  // Vela EN CURSO (25-sep-2026): con la bolsa abierta Yahoo incluye la vela diaria
  // aún sin cerrar; su "close" es un precio intradía. Se marca con el horario de
  // sesión que trae el propio Yahoo, para no presentarlo nunca como un cierre.
  let lastValid = -1;
  for (let i = dated.length - 1; i >= 0; i--) if (dated[i].close > 0) { lastValid = i; break; }
  const reg = chartResult.meta?.currentTradingPeriod?.regular;
  const lastBarForming = lastValid >= 0 && Number.isFinite(reg?.start) && Number.isFinite(reg?.end)
    && ts[lastValid] >= reg.start && Date.now() / 1000 < reg.end;
  return {
    bars: dated.filter(b => b.close && b.close > 0),
    gapDates: recentGapDates(dated),
    lastBarForming,
  };
}

// Intenta un único par (range, host). Devuelve { bars, gapDates, lastBarForming } o null.
async function _fetchYahooOnce(symbol, range, host) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false`;
  const extraHeaders = { "accept-language": "en-US,en;q=0.9" };
  const r = await fetchJson(`https://${host}${path}`, extraHeaders);
  if (!r.ok) return null;
  const parsed = _parseYahooBars(r.data?.chart?.result?.[0]);
  return parsed.bars.length > 0 ? parsed : null;
}

/**
 * YAHOO HISTORY — doble ruta: 1y (251 barras) y 2y (500 barras).
 *
 * Ruta "1y" (conservada): lookbackDays ≤ 300 — suficiente para RS60, momentum, ATR.
 * Ruta "2y" (nueva):     lookbackDays > 300 — EMA200 necesita 220 barras de calentamiento;
 *   "1y" solo dejaba 31 de margen, "2y" da ~280. Si "2y" falla en ambos hosts, cae a "1y".
 *
 * Cada ruta prueba query1 → query2 antes de rendir.
 * Verificado en vivo: US ~500/251 barras, EU (DE/FR/NL) ~505/253 barras.
 */
async function fetchYahooHistory(eodhdSymbol, lookbackDays) {
  const symbol = toYahooSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Yahoo", reason: `No Yahoo mapping for ${eodhdSymbol}` };

  const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

  // Decide si necesitamos profundidad 2y (400-day lookback del scan = FABLE01/EMA200)
  const needDeep = lookbackDays > 300;
  const primaryRange = needDeep ? "2y"
    : lookbackDays > 180 ? "1y"
    : lookbackDays > 90  ? "6mo"
    : "3mo";

  // Intentar con la ruta primaria (query1 → query2)
  for (const host of HOSTS) {
    const r = await _fetchYahooOnce(symbol, primaryRange, host);
    if (r) return { ok: true, provider: "Yahoo", ...r, range: primaryRange, host };
  }

  // Fallback "1y": si "2y" falló (ticker raro / throttle puntual), intentar con 1y
  if (needDeep) {
    for (const host of HOSTS) {
      const r = await _fetchYahooOnce(symbol, "1y", host);
      if (r) return { ok: true, provider: "Yahoo", ...r, range: "1y", host };
    }
  }

  return { ok: false, provider: "Yahoo", reason: `No valid bars (${primaryRange}+fallback, query1+query2)` };
}

async function fetchStooqHistory(eodhdSymbol, lookbackDays) {
  const symbol = toStooqSymbol(eodhdSymbol);
  if (!symbol) return { ok: false, provider: "Stooq", reason: `No Stooq mapping for ${eodhdSymbol}` };

  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetchText(url);
  if (!r.ok) return { ok: false, provider: "Stooq", reason: r.reason };

  // Stooq sirve un reto anti-bot (HTML/JS) en server-side en vez del CSV → detectarlo honestamente
  // para que triedProviders refleje el fallo real (no "0 barras" silencioso).
  if (/^\s*</.test(r.text) || /<!doctype|<script|<html/i.test(r.text)) {
    return { ok: false, provider: "Stooq", reason: "Stooq anti-bot challenge (HTML, not CSV)" };
  }

  const lines = r.text.trim().split("\n").filter(l => l && !l.startsWith("Date"));
  if (lines.length === 0) return { ok: false, provider: "Stooq", reason: "No data rows" };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const bars = lines
    .map(line => {
      const [date, open, high, low, close, volume] = line.split(",");
      return {
        date: date?.trim() ?? "",
        open: finiteOrNull(open),
        high: finiteOrNull(high),
        low: finiteOrNull(low),
        close: finiteOrNull(close),
        volume: finiteOrNull(volume) ?? 0,
      };
    })
    .filter(b => b.date >= cutoffStr && b.close && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) return { ok: false, provider: "Stooq", reason: "No valid bars after filter" };
  return { ok: true, provider: "Stooq", bars };
}

// ─── FRED (Federal Reserve) — TNX only ───────────────────────────────────────

async function fetchFredTNX(apiKey) {
  // DGS10 = 10-Year Treasury Constant Maturity Rate (most authoritative source)
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${encodeURIComponent(apiKey)}&sort_order=desc&limit=2&file_type=json`;
  const r = await fetchJson(url);
  if (!r.ok) return { ok: false, provider: "FRED", reason: r.reason };

  const obs = r.data?.observations;
  if (!Array.isArray(obs) || obs.length === 0) return { ok: false, provider: "FRED", reason: "No observations" };

  // Latest valid value (FRED uses "." for missing data on weekends/holidays)
  const latest = obs.find(o => o.value && o.value !== ".");
  if (!latest) return { ok: false, provider: "FRED", reason: "No valid observation (weekend/holiday)" };

  const price = finiteOrNull(latest.value);
  if (!price) return { ok: false, provider: "FRED", reason: "Invalid value from FRED" };

  // Calculate change vs previous observation
  const prev = obs.find(o => o !== latest && o.value && o.value !== ".");
  const previousClose = prev ? finiteOrNull(prev.value) : null;
  const changePercent = previousClose && previousClose !== 0
    ? ((price - previousClose) / previousClose) * 100
    : null;

  return { ok: true, provider: "FRED", price, previousClose, changePercent, date: latest.date };
}

// ─── Public cascade functions ─────────────────────────────────────────────────

const TNX_SYMBOLS = new Set(["US10Y.GBOND", "TNX", "^TNX"]);

/**
 * Race two async functions — returns whichever resolves successfully first.
 * If both fail, returns the second failure.
 */
async function raceProviders(fnA, fnB) {
  // Safe default — never resolves with null
  const FAIL = { ok: false, provider: "none", reason: "Both providers failed", bars: [] };
  return new Promise((resolve) => {
    let failed = 0;
    let lastFail = FAIL;
    const onSuccess = (r) => {
      const result = r ?? FAIL;
      if (result.ok) resolve(result);
      else { lastFail = result; if (++failed === 2) resolve(lastFail); }
    };
    fnA().then(onSuccess).catch(() => { if (++failed === 2) resolve(lastFail); });
    fnB().then(onSuccess).catch(() => { if (++failed === 2) resolve(lastFail); });
  });
}

/**
 * QUOTE CASCADE — optimised for max speed and real-time accuracy:
 *
 * TNX (10Y yield):
 *   1. Finnhub + Yahoo in PARALLEL (real-time, intraday)
 *   2. FRED fallback (official EOD, Federal Reserve)
 *   3. TwelveData → Stooq
 *
 * All other symbols:
 *   1. Finnhub (real-time, API key)
 *   2. TwelveData (real-time, API key)
 *   3. Yahoo Finance (real-time, no key)
 *   4. Stooq (delayed, no key)
 */
export async function cascadeQuote(eodhdSymbol, env = {}) {
  const tried = [];
  const isTNX = TNX_SYMBOLS.has(eodhdSymbol);

  if (isTNX) {
    // TNX: race Finnhub + Yahoo in parallel for fastest real-time result
    if (env.FINNHUB_API_KEY) {
      const r = await raceProviders(
        () => fetchFinnhubQuote(eodhdSymbol, env.FINNHUB_API_KEY),
        () => fetchYahooQuote(eodhdSymbol),
      );
      tried.push({ provider: r.provider, ok: r.ok });
      if (r.ok) return { ...r, triedProviders: tried };
    }
    // FRED fallback: official Federal Reserve daily rate
    if (env.FRED_API_KEY) {
      const r = await fetchFredTNX(env.FRED_API_KEY);
      tried.push({ provider: "FRED", ok: r.ok, reason: r.reason });
      if (r.ok) return { ...r, triedProviders: tried };
    }
    // Last resort
    const td = env.TWELVE_DATA_API_KEY ? await fetchTwelveDataQuote(eodhdSymbol, env.TWELVE_DATA_API_KEY) : { ok: false, provider: "TwelveData", reason: "No key" };
    tried.push({ provider: td.provider, ok: td.ok });
    if (td.ok) return { ...td, triedProviders: tried };
    const stooq = await fetchStooqQuote(eodhdSymbol);
    tried.push({ provider: "Stooq", ok: stooq.ok });
    if (stooq.ok) return { ...stooq, triedProviders: tried };
    return { ok: false, provider: "none", reason: "All TNX providers failed", triedProviders: tried };
  }

  // Standard symbols: Finnhub → TwelveData → FMP → Yahoo → Stooq
  if (env.FINNHUB_API_KEY) {
    const r = await fetchFinnhubQuote(eodhdSymbol, env.FINNHUB_API_KEY);
    tried.push({ provider: "Finnhub", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  } else {
    tried.push({ provider: "Finnhub", ok: false, reason: "Key not configured" });
  }

  if (env.TWELVE_DATA_API_KEY) {
    const r = await fetchTwelveDataQuote(eodhdSymbol, env.TWELVE_DATA_API_KEY);
    tried.push({ provider: "TwelveData", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  } else {
    tried.push({ provider: "TwelveData", ok: false, reason: "Key not configured" });
  }

  if (env.FMP_API_KEY) {
    const r = await fetchFMPQuote(eodhdSymbol, env.FMP_API_KEY);
    tried.push({ provider: "FMP", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  } else {
    tried.push({ provider: "FMP", ok: false, reason: "Key not configured" });
  }

  const yahoo = await fetchYahooQuote(eodhdSymbol);
  tried.push({ provider: "Yahoo", ok: yahoo.ok, reason: yahoo.reason });
  if (yahoo.ok) return { ...yahoo, triedProviders: tried };

  const stooq = await fetchStooqQuote(eodhdSymbol);
  tried.push({ provider: "Stooq", ok: stooq.ok, reason: stooq.reason });
  if (stooq.ok) return { ...stooq, triedProviders: tried };

  return { ok: false, provider: "none", reason: "All providers failed", triedProviders: tried };
}

// ─── EODHD historical (still active — best EU+US coverage) ──────────────────

async function fetchEodhdHistory(eodhdSymbol, apiKey, lookbackDays) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - lookbackDays);
  const fromDateStr = fromDate.toISOString().slice(0, 10);
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(eodhdSymbol)}?api_token=${encodeURIComponent(apiKey)}&fmt=json&period=d&from=${encodeURIComponent(fromDateStr)}`;
  const r = await fetchJson(url);
  if (!r.ok || !Array.isArray(r.data)) return { ok: false, provider: "EODHD", reason: r.reason ?? "Not an array" };
  const bars = r.data
    .map(row => ({
      date: row.date?.slice(0, 10) ?? "",
      open:   finiteOrNull(row.open),
      high:   finiteOrNull(row.high),
      low:    finiteOrNull(row.low),
      close:  finiteOrNull(row.adjusted_close ?? row.close),
      volume: finiteOrNull(row.volume) ?? 0,
    }))
    .filter(b => b.date && b.close && b.close > 0);
  if (bars.length === 0) return { ok: false, provider: "EODHD", reason: "No valid bars" };
  return { ok: true, provider: "EODHD", bars };
}

/**
 * BENCHMARK RACE — fetches SPY.US from ALL providers simultaneously.
 * First valid result wins. No sequential fallback = no timeout risk.
 * SPY is the most liquid US ETF — available on every provider.
 * Used to guarantee RS (Relative Strength) is always calculable.
 */
export async function raceBenchmarkHistory(lookbackDays = 260, env = {}) {
  const symbol = "SPY.US";
  const promises = [];

  if (env.EODHD_API_KEY) {
    promises.push(fetchEodhdHistory(symbol, env.EODHD_API_KEY, lookbackDays));
  }
  if (env.TWELVE_DATA_API_KEY) {
    promises.push(fetchTwelveDataHistory(symbol, lookbackDays, env.TWELVE_DATA_API_KEY));
  }
  if (env.FMP_API_KEY) {
    promises.push(fetchFMPHistory(symbol, lookbackDays, env.FMP_API_KEY));
  }
  promises.push(fetchYahooHistory(symbol, lookbackDays));
  promises.push(fetchStooqHistory(symbol, lookbackDays));

  // Race all providers: first valid result wins, never waits for slow ones
  return new Promise((resolve) => {
    let pending = promises.length;
    let resolved = false;
    for (const p of promises) {
      p.then((r) => {
        if (!resolved && r.ok && Array.isArray(r.bars) && r.bars.length >= 61) {
          resolved = true;
          resolve({ ...r, source: "RACE" });
        } else {
          pending -= 1;
          if (pending === 0 && !resolved) resolve({ ok: false, bars: [], provider: "none", reason: "All benchmark providers failed" });
        }
      }).catch(() => {
        pending -= 1;
        if (pending === 0 && !resolved) resolve({ ok: false, bars: [], provider: "none", reason: "All benchmark providers threw" });
      });
    }
  });
}

/**
 * HISTORICAL CASCADE — EODHD → TwelveData+Yahoo (parallel) → Stooq
 * EODHD is primary because it has the best EU+US stock coverage.
 */
export async function cascadeHistory(eodhdSymbol, lookbackDays = 260, env = {}) {
  const tried = [];

  // 1. EODHD — primary, best coverage especially for EU stocks
  if (env.EODHD_API_KEY) {
    const r = await fetchEodhdHistory(eodhdSymbol, env.EODHD_API_KEY, lookbackDays);
    tried.push({ provider: "EODHD", ok: r.ok, reason: r.reason });
    if (r.ok) return { ...r, triedProviders: tried };
  }

  // 2. TwelveData + Yahoo in parallel
  if (env.TWELVE_DATA_API_KEY) {
    const r = await raceProviders(
      () => fetchTwelveDataHistory(eodhdSymbol, lookbackDays, env.TWELVE_DATA_API_KEY),
      () => fetchYahooHistory(eodhdSymbol, lookbackDays),
    );
    tried.push({ provider: r.provider, ok: r.ok });
    if (r.ok) return { ...r, triedProviders: tried };
  } else {
    const yahoo = await fetchYahooHistory(eodhdSymbol, lookbackDays);
    tried.push({ provider: "Yahoo", ok: yahoo.ok, reason: yahoo.reason });
    if (yahoo.ok) return { ...yahoo, triedProviders: tried };
  }

  // 3. FMP (clave) — 2ª red REAL de histórico US+EU. Inactivo si FMP_API_KEY está vacía.
  if (env.FMP_API_KEY) {
    const fmp = await fetchFMPHistory(eodhdSymbol, lookbackDays, env.FMP_API_KEY);
    tried.push({ provider: "FMP", ok: fmp.ok, reason: fmp.reason });
    if (fmp.ok) return { ...fmp, triedProviders: tried };
  }

  // 4. Stooq last resort
  const stooq = await fetchStooqHistory(eodhdSymbol, lookbackDays);
  tried.push({ provider: "Stooq", ok: stooq.ok, reason: stooq.reason });
  if (stooq.ok) return { ...stooq, triedProviders: tried };

  return { ok: false, provider: "none", reason: "All providers failed", triedProviders: tried, bars: [] };
}
