/**
 * GET /api/sector-leaders-data           → EOD sector leaders (existing, unchanged)
 * GET /api/sector-leaders-data?mode=intraday → Smart Money Flow scan (NEW)
 *
 * Intraday mode: detects WHERE institutional money is moving RIGHT NOW
 * - Fetches 5-min candles for 10 sector ETFs + SPY via Yahoo Finance (free, no key)
 * - Calculates flowScore = intradayChange × relativeVolume
 * - For top sectors: fetches individual stock quotes via Finnhub
 * - Single-shot scan, no batching needed (~20 parallel calls, ~2-3s)
 */

// ─── INTRADAY: Sectors with ETFs and top holdings ────────────────────────────
//
// ARQUITECTURA DE INVERTIBILIDAD — SL española / PRIIPs:
//
//   ETF (etf field):   SOLO para calcular el flujo del sector (precio intraday, volumen relativo)
//                      NUNCA se recomienda como inversión directa.
//                      Motivo: ETFs USA sin KID europeo = bloqueados por PRIIPs para inversores EU.
//
//   holdings[]:        SOLO acciones individuales Common Stock NYSE/NASDAQ del S&P500.
//                      Las acciones individuales NO son PRIIPs → invertibles sin restricción
//                      para cualquier SL española, independientemente de su clasificación MiFID II.
//                      Regla: NUNCA añadir ETFs, CEFs, warrants o productos estructurados aquí.
//
// El sistema detecta flujos usando ETFs (análisis) y recomienda stocks (acción).
// ────────────────────────────────────────────────────────────────────────────────

// 6 candidates per sector → pick the ONE with highest intraday % change
const FLOW_SECTORS = [
  { key: "defense",    name: "Defensa",         etf: "ITA",  holdings: ["LMT","RTX","NOC","GD","LHX","HII"] },
  { key: "utilities",  name: "Utilities",        etf: "XLU",  holdings: ["NEE","SO","DUK","AEP","SRE","EXC"] },
  { key: "staples",    name: "Consumo Básico",   etf: "XLP",  holdings: ["PG","KO","PEP","COST","WMT","CL"] },
  { key: "gold",       name: "Oro / Metales",    etf: "GLD",  holdings: ["NEM","GOLD","FCX","AEM","WPM","FNV"] },
  { key: "healthcare", name: "Salud",             etf: "XLV",  holdings: ["UNH","LLY","JNJ","ABBV","MRK","TMO"] },
  { key: "semis",      name: "Semiconductores",  etf: "SOXX", holdings: ["NVDA","AMD","INTC","QCOM","AVGO","TXN"] },
  { key: "software",   name: "Software / IA",    etf: "IGV",  holdings: ["MSFT","ORCL","CRM","NOW","INTU","ADBE"] },
  { key: "banks",      name: "Bancos",           etf: "KBE",  holdings: ["JPM","BAC","WFC","C","GS","MS"] },
  { key: "energy",     name: "Energía",          etf: "XLE",  holdings: ["XOM","CVX","COP","EOG","SLB","MPC"] },
  { key: "tech",       name: "Tecnología",       etf: "XLK",  holdings: ["AAPL","MSFT","NVDA","AVGO","ORCL","ACN"] },
];

// ─── EOD: Original sector leaders (unchanged) ─────────────────────────────────

const EOD_SECTORS = [
  { symbol: "XLK",  name: "Technology",      market: "NYSE" },
  { symbol: "XLF",  name: "Financials",       market: "NYSE" },
  { symbol: "XLV",  name: "Health Care",      market: "NYSE" },
  { symbol: "XLE",  name: "Energy",           market: "NYSE" },
  { symbol: "XLI",  name: "Industrials",      market: "NYSE" },
  { symbol: "XLY",  name: "Cons. Disc.",       market: "NYSE" },
  { symbol: "XLP",  name: "Cons. Staples",     market: "NYSE" },
  { symbol: "XLC",  name: "Comm. Services",    market: "NYSE" },
  { symbol: "XLRE", name: "Real Estate",       market: "NYSE" },
];

const YAHOO_UA = "Mozilla/5.0 (compatible; EMRR/2.0)";
const TIMEOUT_MS = 7000;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── EOD mode helpers ─────────────────────────────────────────────────────────

function classifyState(perf) {
  if (perf > 2)  return "LEADING";
  if (perf > 0)  return "ACCELERATING";
  if (perf > -2) return "WEAKENING";
  return "FALLING";
}

async function fetchSectorPerf(symbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d&includePrePost=false`;
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(c => Number.isFinite(c));
  if (closes.length < 2) return null;
  return +( ((closes.at(-1) - closes[0]) / closes[0]) * 100 ).toFixed(4);
}

// ─── INTRADAY mode helpers ────────────────────────────────────────────────────

function finiteOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function flowDirection(score) {
  if (score >= 60)  return "STRONG_IN";
  if (score >= 25)  return "IN";
  if (score >= -25) return "NEUTRAL";
  if (score >= -60) return "OUT";
  return "STRONG_OUT";
}

/**
 * Fetch 5-min intraday bars for a US symbol via Yahoo Finance.
 * Returns: { open, current, intradayChange, change30min, changeMomentum, relativeVolume }
 */
async function fetchIntraday5min(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d&includePrePost=false`;
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta ?? {};
  const q = result.indicators?.quote?.[0] ?? {};
  const closes = (q.close ?? []).map(finiteOrNull);
  const volumes = (q.volume ?? []).map(v => finiteOrNull(v) ?? 0);

  const validCloses = closes.filter(Number.isFinite);
  if (validCloses.length < 4) return null;

  // Remove trailing nulls to get last valid close
  let lastClose = null;
  let lastIdx = closes.length - 1;
  while (lastIdx >= 0 && !Number.isFinite(closes[lastIdx])) lastIdx--;
  if (lastIdx < 0) return null;
  lastClose = closes[lastIdx];

  const openPrice = finiteOrNull(meta.regularMarketOpen) ?? validCloses[0];
  const intradayChange = openPrice > 0 ? ((lastClose - openPrice) / openPrice) * 100 : 0;

  // Change in last ~30 min (6 bars of 5min)
  const idx30 = Math.max(0, lastIdx - 6);
  const price30 = closes[idx30];
  const change30min = Number.isFinite(price30) && price30 > 0
    ? ((lastClose - price30) / price30) * 100 : 0;

  // Momentum: last 5 min (1 bar)
  const prevClose = closes[lastIdx - 1];
  const changeMomentum = Number.isFinite(prevClose) && prevClose > 0
    ? ((lastClose - prevClose) / prevClose) * 100 : 0;

  // Relative volume: last 3 bars vs earlier bars (rough rvol)
  const recentVols = volumes.slice(Math.max(0, lastIdx - 2), lastIdx + 1).filter(v => v > 0);
  const earlyVols  = volumes.slice(0, Math.max(1, lastIdx - 2)).filter(v => v > 0);
  const recentAvg  = recentVols.length ? recentVols.reduce((a,b) => a+b, 0) / recentVols.length : 0;
  const earlyAvg   = earlyVols.length  ? earlyVols.reduce((a,b) => a+b, 0)  / earlyVols.length  : recentAvg;
  const relativeVolume = earlyAvg > 0 ? Math.min(recentAvg / earlyAvg, 5) : 1;

  // Flow score: price move × volume amplification (-100 to +100)
  const rawScore = intradayChange * Math.sqrt(relativeVolume);
  const flowScore = Math.max(-100, Math.min(100, rawScore * 10));

  return {
    symbol,
    currentPrice: +lastClose.toFixed(2),
    openPrice:    +openPrice.toFixed(2),
    intradayChange: +intradayChange.toFixed(2),
    change30min:    +change30min.toFixed(2),
    changeMomentum: +changeMomentum.toFixed(2),
    relativeVolume: +relativeVolume.toFixed(2),
    flowScore:      +flowScore.toFixed(1),
  };
}

/**
 * Fetch individual stock quote (intraday % change) via Yahoo.
 */
async function fetchStockQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d&includePrePost=false`;
  const json = await fetchJson(url);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = finiteOrNull(meta.regularMarketPrice);
  const prevClose = finiteOrNull(meta.previousClose ?? meta.chartPreviousClose);
  if (!price) return null;
  const change = prevClose && prevClose > 0
    ? +( ((price - prevClose) / prevClose) * 100 ).toFixed(2)
    : finiteOrNull(meta.regularMarketChangePercent) ?? 0;
  return { ticker, price: +price.toFixed(2), change };
}

// ─── Intraday handler ─────────────────────────────────────────────────────────

async function handleIntraday(res) {
  // 1. Fetch all ETFs + SPY in parallel
  const symbols = FLOW_SECTORS.map(s => s.etf);
  const [etfResults, spyData] = await Promise.all([
    Promise.all(symbols.map(fetchIntraday5min)),
    fetchIntraday5min("SPY"),
  ]);

  // 2. Build sector list
  const sectors = FLOW_SECTORS
    .map((sector, i) => {
      const data = etfResults[i];
      if (!data) return null;
      return {
        key: sector.key,
        name: sector.name,
        etf: sector.etf,
        holdings: sector.holdings,
        ...data,
        direction: flowDirection(data.flowScore),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.flowScore - a.flowScore)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  // 3. Fetch top stock for ALL sectors in parallel
  // Each sector: fetch all holdings, pick the ONE with highest intraday % (green) or lowest (red)
  // All are S&P500 stocks — in our 606-stock universe
  const moverResults = await Promise.all(
    sectors.map(sector =>
      Promise.all(sector.holdings.map(fetchStockQuote))
        .then(quotes => {
          const valid = quotes.filter(Boolean);
          const sectorPositive = sector.intradayChange >= 0;
          // For green sectors: pick highest gainer; for red sectors: pick highest gainer too
          // (shows the stock holding up best or leading the move)
          const sorted = valid.sort((a, b) => b.change - a.change);
          return {
            key: sector.key,
            // topMover: the single best stock to watch in this sector today
            topMover: sorted[0] ?? null,
          };
        })
    )
  );

  // Inject single best mover into each sector
  const moverMap = Object.fromEntries(moverResults.map(r => [r.key, r.topMover]));
  const enrichedSectors = sectors.map(s => ({
    ...s,
    topMover: moverMap[s.key] ?? null,   // ONE stock: best candidate in this sector today
    topMovers: moverMap[s.key] ? [moverMap[s.key]] : [], // keep array for backward compat
  }));

  // 4. Determine if market is actually open (US Eastern time)
  //
  // AUDIT FIX: faltaba el ajuste de horario de verano (DST) de EEUU. El NYSE/
  // NASDAQ abre 9:30-16:00 hora del Este, que en UTC es:
  //   - Horario de verano (EDT, UTC-4, ~2º domingo marzo a 1er domingo nov.) → 13:30-20:00 UTC
  //   - Horario de invierno (EST, UTC-5)                                      → 14:30-21:00 UTC
  // El código anterior usaba SIEMPRE las horas de invierno (14:30-21:00 UTC),
  // lo que en verano (como ahora, junio) marcaba "mercado cerrado" durante la
  // primera hora real de sesión (13:30-14:30 UTC) y "abierto" una hora después
  // del cierre real (20:00-21:00 UTC) — datos de Flujos de Capital aparecían
  // congelados/desfasados exactamente en esa ventana.
  const now = new Date();
  const utcDay = now.getUTCDay();
  const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();

  function nthWeekdayOfMonthUtc(year, monthIndex, weekday, nth) {
    const first = new Date(Date.UTC(year, monthIndex, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, monthIndex, 1 + offset + (nth - 1) * 7));
  }
  function isUsDaylightSavingTimeUtc(date) {
    const year = date.getUTCFullYear();
    const dstStart = nthWeekdayOfMonthUtc(year, 2, 0, 2);  // 2nd Sunday of March
    const dstEnd = nthWeekdayOfMonthUtc(year, 10, 0, 1);   // 1st Sunday of November
    return date >= dstStart && date < dstEnd;
  }

  const usDst = isUsDaylightSavingTimeUtc(now);
  const usOpenMinuteUtc = usDst ? 13 * 60 + 30 : 14 * 60 + 30;
  const usCloseMinuteUtc = usDst ? 20 * 60 : 21 * 60;
  const marketOpen = utcDay >= 1 && utcDay <= 5
    && minutesSinceMidnight >= usOpenMinuteUtc
    && minutesSinceMidnight < usCloseMinuteUtc;

  res.status(200).json({
    ok: true,
    mode: "intraday",
    marketOpen,
    scannedAtUtc: now.toISOString(),
    spy: spyData ? {
      intradayChange: spyData.intradayChange,
      currentPrice:   spyData.currentPrice,
      relativeVolume: spyData.relativeVolume,
    } : null,
    sectors: enrichedSectors,
    sectorCount: enrichedSectors.length,
    providers: ["Yahoo Finance (5-min ETF)", "Yahoo Finance (stock quotes)"],
    note: marketOpen
      ? "Datos intraday en tiempo real (Yahoo Finance, ~2-5 min delay)"
      : "Mercado cerrado — datos de última sesión disponibles",
  });
}

// ─── EOD handler (original, unchanged) ───────────────────────────────────────

async function handleEod(res) {
  try {
    const results = await Promise.all(
      EOD_SECTORS.map(async (sector) => {
        const perf = await fetchSectorPerf(sector.symbol);
        if (perf === null) return null;
        return {
          symbol: sector.symbol,
          name:   sector.name,
          market: sector.market,
          performance5d: perf,
          state: classifyState(perf),
        };
      })
    );

    const sectors = results
      .filter(Boolean)
      .sort((a, b) => {
        const stateOrder = { LEADING: 0, ACCELERATING: 1, WEAKENING: 2, FALLING: 3 };
        const stateDiff = stateOrder[a.state] - stateOrder[b.state];
        if (stateDiff !== 0) return stateDiff;
        return b.performance5d - a.performance5d;
      });

    res.status(200).json({ ok: true, sectors, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err), sectors: [] });
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const mode = req.query?.mode;
  if (mode === "intraday") return handleIntraday(res);
  return handleEod(res);
}
