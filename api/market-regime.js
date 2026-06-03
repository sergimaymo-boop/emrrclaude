/**
 * GET /api/market-regime
 * Market Regime Filter — internal analysis, exposes only BULLISH / BEARISH.
 *
 * Logic (institutional standard):
 *   SPY close > EMA200  → BULLISH (rallies have tailwind)
 *   SPY close < EMA200  → BEARISH (even best rallies fail)
 *
 * The internal numbers (SPY price, EMA200 value) are NOT exposed to the
 * dashboard — only the regime label, per spec.
 */
import { cascadeHistory } from "./_lib/providerCascade.js";
import { calculateEma } from "./_lib/technicalEngine.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "MARKET_REGIME";
const BENCHMARK = "SPY.US";

function getEnv() { return globalThis.process?.env ?? {}; }
function isConfiguredSecret(v) {
  if (!v || !v.trim()) return false;
  const n = v.trim().toLowerCase();
  return !["your_", "_here", "placeholder"].some(p => n.includes(p));
}

function sendJson(res, status, payload) {
  res.status(status).json({ ...payload, app: APP_NAME, endpoint: ENDPOINT, timestampUtc: new Date().toISOString() });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (getEnv().ENABLE_REAL_API_CALLS !== "true") {
    return sendJson(res, 200, { ok: false, regime: "UNKNOWN", error: "REAL_API_CALLS_DISABLED" });
  }

  const env = getEnv();
  const result = await cascadeHistory(BENCHMARK, 260, {
    TWELVE_DATA_API_KEY: isConfiguredSecret(env.TWELVE_DATA_API_KEY) ? env.TWELVE_DATA_API_KEY : null,
  });

  if (!result.ok || result.bars.length < 200) {
    return sendJson(res, 200, { ok: false, regime: "UNKNOWN", error: "INSUFFICIENT_SPY_HISTORY" });
  }

  const closes = result.bars.map(b => b.close).filter(Number.isFinite);
  const ema200 = calculateEma(closes, 200);
  const lastClose = closes[closes.length - 1];

  if (!ema200 || !lastClose) {
    return sendJson(res, 200, { ok: false, regime: "UNKNOWN", error: "EMA200_CALCULATION_FAILED" });
  }

  // Internal analysis — only the label is exposed
  const isBullish = lastClose > ema200;

  return sendJson(res, 200, {
    ok: true,
    regime: isBullish ? "BULLISH" : "BEARISH",
    // Internal values intentionally NOT exposed in dashboard per spec.
    // Kept here only for API debugging, not rendered:
    _internal: { provider: result.provider },
  });
}
