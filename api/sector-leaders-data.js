/**
 * GET /api/sector-leaders-data
 * Returns 5-day sector performance for US sector ETFs via Yahoo Finance.
 */

const SECTORS = [
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
const TIMEOUT_MS = 8000;

function classifyState(perf) {
  if (perf > 2)  return "LEADING";
  if (perf > 0)  return "ACCELERATING";
  if (perf > -2) return "WEAKENING";
  return "FALLING";
}

async function fetchSectorPerf(symbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d&includePrePost=false`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_UA },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const quotes = result.indicators?.quote?.[0];
    const closes = quotes?.close ?? [];
    // Filter out nulls
    const validCloses = closes.filter(c => c !== null && c !== undefined && Number.isFinite(c));
    if (validCloses.length < 2) return null;

    const first = validCloses[0];
    const last  = validCloses[validCloses.length - 1];
    const performance5d = ((last - first) / first) * 100;
    return +performance5d.toFixed(4);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  try {
    const results = await Promise.all(
      SECTORS.map(async (sector) => {
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

    res.status(200).json({
      ok: true,
      sectors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err), sectors: [] });
  }
}
