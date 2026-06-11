/**
 * GET /api/monetary-cycle
 *
 * Clasifica el ciclo monetario actual (EASING / NEUTRAL / TIGHTENING) a partir
 * de señales de mercado ya disponibles: yield 10Y (TNX), crédito (HYG),
 * volatilidad (VIX) y volatilidad de bonos (MOVE).
 *
 * Caché Redis: 1 hora (el ciclo monetario no cambia en minutos).
 */

import { cascadeQuote } from './providerCascade.js';
import { classifyMonetaryCycle } from './monetaryCycleEngine.js';
import { kvGet, kvSet } from './kvStorage.js';

const CACHE_KEY       = 'monetary_cycle_v2';
const CACHE_TTL_SEC   = 3600; // 1 hora
const CALL_TIMEOUT_MS = 5000;

function withTimeout(promise, maxMs, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), maxMs)),
  ]);
}

function getEnv() { return globalThis.process?.env ?? {}; }

function isConfiguredSecret(v) {
  if (!v || !v.trim()) return false;
  const n = v.trim().toLowerCase();
  return !['your_', '_here', 'placeholder'].some(p => n.includes(p));
}

export async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const env = getEnv();

  // Modo demo / REAL_API_CALLS desactivado → devolver neutral sin errores
  if (env.ENABLE_REAL_API_CALLS !== 'true') {
    return response.status(200).json({
      ok: true, phase: 'NEUTRAL', score: 50,
      label: 'Ciclo Neutral', color: '#64748b',
      signals: [], rallyScoreAdjustment: 0, hasData: false,
      reason: 'REAL_API_CALLS_DISABLED',
    });
  }

  // ── Cache ────────────────────────────────────────────────────────────────
  const cached = await kvGet(CACHE_KEY);
  if (cached && cached.cachedAtUtc) {
    const ageMs = Date.now() - new Date(cached.cachedAtUtc).getTime();
    if (ageMs < CACHE_TTL_SEC * 1000) {
      return response.status(200).json({ ...cached, fromCache: true });
    }
  }

  // ── Fetch signals ────────────────────────────────────────────────────────
  const cascadeEnv = {
    FINNHUB_API_KEY:     isConfiguredSecret(env.FINNHUB_API_KEY)     ? env.FINNHUB_API_KEY     : null,
    TWELVE_DATA_API_KEY: isConfiguredSecret(env.TWELVE_DATA_API_KEY) ? env.TWELVE_DATA_API_KEY : null,
    FMP_API_KEY:         isConfiguredSecret(env.FMP_API_KEY)         ? env.FMP_API_KEY         : null,
  };

  const FALLBACK = { ok: false };
  const [tnxQ, hygQ, vixQ, moveQ] = await Promise.all([
    withTimeout(cascadeQuote('US10Y.GBOND', cascadeEnv), CALL_TIMEOUT_MS, FALLBACK),
    withTimeout(cascadeQuote('HYG.US',      cascadeEnv), CALL_TIMEOUT_MS, FALLBACK),
    withTimeout(cascadeQuote('VIX.INDX',    cascadeEnv), CALL_TIMEOUT_MS, FALLBACK),
    withTimeout(cascadeQuote('MOVE.INDX',   cascadeEnv), CALL_TIMEOUT_MS, FALLBACK),
  ]);

  const rawSignals = {
    tnxChangePercent: tnxQ.ok  ? (tnxQ.changePercent  ?? null) : null,
    hygChangePercent: hygQ.ok  ? (hygQ.changePercent   ?? null) : null,
    vixLevel:         vixQ.ok  ? (vixQ.price           ?? null) : null,
    moveLevel:        moveQ.ok ? (moveQ.price          ?? null) : null,
  };

  const cycle = classifyMonetaryCycle(rawSignals);

  const result = {
    ok: true,
    ...cycle,
    rawSignals,
    cachedAtUtc: new Date().toISOString(),
  };

  await kvSet(CACHE_KEY, result, CACHE_TTL_SEC);

  return response.status(200).json(result);
}
