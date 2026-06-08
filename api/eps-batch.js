/**
 * GET /api/eps-batch?tickers=AAPL,MSFT,NVDA
 *
 * Devuelve métricas de crecimiento de EPS para un lote de tickers (máx 20).
 * Diseñado para enriquecer los 8-10 resultados del Top 8 + Rally Leaders.
 *
 * Fuente: Finnhub Basic Financials (/stock/metric?metric=all).
 * Caché Redis: 24h por ticker (EPS es datos trimestrales, no cambia a diario).
 */

import { fetchEpsBatch } from './_lib/epsEngine.js';
import { kvGet, kvSet } from './_lib/kvStorage.js';

function getEnv() { return globalThis.process?.env ?? {}; }

const CACHE_TTL_SEC = 86400; // 24h

function isConfiguredSecret(v) {
  if (!v || !v.trim()) return false;
  const n = v.trim().toLowerCase();
  return !['your_', '_here', 'placeholder'].some(p => n.includes(p));
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const env = getEnv();

  if (env.ENABLE_REAL_API_CALLS !== 'true') {
    return response.status(200).json({ ok: true, data: {}, reason: 'REAL_API_CALLS_DISABLED' });
  }

  if (!isConfiguredSecret(env.FINNHUB_API_KEY)) {
    return response.status(200).json({ ok: false, data: {}, reason: 'FINNHUB_NOT_CONFIGURED' });
  }

  // ── Parse tickers ─────────────────────────────────────────────────────────
  const rawTickers = request.query?.tickers ?? '';
  const tickers = String(rawTickers)
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(t => /^[A-Z0-9.-]{1,12}$/.test(t))
    .slice(0, 20);

  if (tickers.length === 0) {
    return response.status(400).json({ ok: false, error: 'NO_VALID_TICKERS' });
  }

  // ── Cache lookup ──────────────────────────────────────────────────────────
  const fromCache = {};
  const needFetch  = [];

  await Promise.all(tickers.map(async (ticker) => {
    const key = `eps_v2_${ticker}`;
    const val = await kvGet(key);
    if (val && val.fetchedAtUtc) {
      const ageMs = Date.now() - new Date(val.fetchedAtUtc).getTime();
      if (ageMs < CACHE_TTL_SEC * 1000) {
        fromCache[ticker] = val;
        return;
      }
    }
    needFetch.push(ticker);
  }));

  // ── Fetch uncached ────────────────────────────────────────────────────────
  let fresh = {};
  if (needFetch.length > 0) {
    fresh = await fetchEpsBatch(needFetch, {
      FINNHUB_API_KEY: env.FINNHUB_API_KEY,
    });

    // Store fresh results in cache
    await Promise.all(
      Object.entries(fresh).map(([ticker, data]) =>
        kvSet(`eps_v2_${ticker}`, data, CACHE_TTL_SEC)
      )
    );
  }

  const data = { ...fromCache, ...fresh };

  return response.status(200).json({
    ok: true,
    data,
    fromCache: Object.keys(fromCache).length,
    fetched:   needFetch.length,
    total:     tickers.length,
  });
}
