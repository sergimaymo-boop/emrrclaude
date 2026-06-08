/**
 * EPS Growth Engine
 *
 * Obtiene datos de crecimiento de beneficios (EPS) desde Finnhub Basic Financials.
 * Funciona para tickers US. Tickers europeos devuelven neutral (sin penalización).
 *
 * Protege contra el riesgo de GAP bajista en earnings: el trailing stop se ejecuta
 * a precio de apertura (-20% o más), no al nivel configurado (-3%). Este filtro
 * evita entrar en empresas con beneficios deteriorados que son candidatos a ese gap.
 */

const FINNHUB_METRICS_URL = 'https://finnhub.io/api/v1/stock/metric';
const CALL_TIMEOUT_MS = 4000;

async function fetchFinnhubMetrics(ticker, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const url = `${FINNHUB_METRICS_URL}?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, reason: 'timeout_or_network' };
  } finally {
    clearTimeout(timeout);
  }
}

function extractEpsMetrics(data) {
  const m = data?.metric;
  if (!m) return { ok: false, reason: 'no_metrics' };

  // Finnhub campos relevantes:
  // epsGrowth3Y — crecimiento EPS anualizado 3 años
  // epsGrowth5Y — crecimiento EPS anualizado 5 años
  // epsNormalizedAnnual — EPS normalizado TTM
  const epsGrowth3Y = typeof m.epsGrowth3Y === 'number' && isFinite(m.epsGrowth3Y) ? m.epsGrowth3Y : null;
  const epsGrowth5Y = typeof m.epsGrowth5Y === 'number' && isFinite(m.epsGrowth5Y) ? m.epsGrowth5Y : null;
  const epsTTM      = typeof m.epsNormalizedAnnual === 'number' && isFinite(m.epsNormalizedAnnual) ? m.epsNormalizedAnnual : null;

  const primaryGrowth = epsGrowth3Y ?? epsGrowth5Y;
  if (primaryGrowth === null) return { ok: false, reason: 'no_eps_growth_data' };

  // Finnhub returns epsGrowth3Y/5Y ALREADY in percentage units (verified against
  // production: KO=11.48 → +11%, PG=3.88 → +3.88%, VZ=-7.06 → -7%). Do NOT rescale.
  // A previous "ratio→percent ×100 when <5" heuristic was a bug: it inflated any
  // low-single-digit grower (e.g. PG +3.88% → +388% "EXCELENTE") into a false signal.
  return { ok: true, epsGrowthYoY: primaryGrowth, epsGrowth3Y, epsGrowth5Y, epsTTM };
}

/**
 * Clasifica la calidad del EPS y devuelve ajuste de puntuación.
 * El ajuste es ADITIVO sobre el score existente (no reemplaza pesos).
 *
 * @param {number|null} epsGrowthYoY
 * @returns {{ adjustment, label, risk, color }}
 */
export function classifyEpsQuality(epsGrowthYoY) {
  if (epsGrowthYoY === null || epsGrowthYoY === undefined) {
    return { adjustment: 0, label: 'Sin datos EPS', risk: 'UNKNOWN', color: '#475569' };
  }
  if (epsGrowthYoY >= 25) {
    return { adjustment: +4, label: `EPS +${epsGrowthYoY.toFixed(0)}% — EXCELENTE`, risk: 'LOW', color: '#10b981' };
  }
  if (epsGrowthYoY >= 12) {
    return { adjustment: +2, label: `EPS +${epsGrowthYoY.toFixed(0)}% — BUENO`, risk: 'LOW', color: '#34d399' };
  }
  if (epsGrowthYoY >= 0) {
    return { adjustment: 0, label: `EPS +${epsGrowthYoY.toFixed(0)}% — NEUTRO`, risk: 'MEDIUM', color: '#94a3b8' };
  }
  if (epsGrowthYoY >= -15) {
    return { adjustment: -3, label: `EPS ${epsGrowthYoY.toFixed(0)}% — DÉBIL`, risk: 'HIGH', color: '#f59e0b' };
  }
  // EPS < -15%: deterioro grave — riesgo gap de earnings
  return { adjustment: -6, label: `EPS ${epsGrowthYoY.toFixed(0)}% — RIESGO GAP`, risk: 'HIGH', color: '#ef4444' };
}

/**
 * Obtiene datos EPS para un lote de tickers.
 * Diseñado para 8-20 tickers (top 8 + rally leaders) — no para el universo completo.
 *
 * @param {string[]} tickers
 * @param {{ FINNHUB_API_KEY: string }} env
 * @returns {Promise<Record<string, object>>}
 */
export async function fetchEpsBatch(tickers, env) {
  const apiKey = env?.FINNHUB_API_KEY;
  if (!apiKey || !Array.isArray(tickers) || tickers.length === 0) return {};

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      const raw = await fetchFinnhubMetrics(ticker, apiKey);
      if (!raw.ok) {
        return [ticker, { ok: false, reason: raw.reason, ...classifyEpsQuality(null) }];
      }
      const eps = extractEpsMetrics(raw.data);
      if (!eps.ok) {
        return [ticker, { ok: false, reason: eps.reason, ...classifyEpsQuality(null) }];
      }
      const quality = classifyEpsQuality(eps.epsGrowthYoY);
      return [ticker, {
        ok: true,
        epsGrowthYoY: eps.epsGrowthYoY,
        epsGrowth3Y:  eps.epsGrowth3Y,
        epsGrowth5Y:  eps.epsGrowth5Y,
        epsTTM:       eps.epsTTM,
        ...quality,
        fetchedAtUtc: new Date().toISOString(),
      }];
    })
  );

  return Object.fromEntries(results);
}
