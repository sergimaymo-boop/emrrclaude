/**
 * GET /api/cron/market-pulse
 *
 * Daily Telegram "Market Pulse" push — triggered by Vercel Cron at 14:00 UTC
 * on weekdays (≈15:00 Canary Islands time in summer / DST), ~30 min after the
 * US market opens (per institutional recommendation: avoid the noisy opening
 * range, use confirmed intraday data for the entry decision).
 *
 * Message structure (optimized to be readable from the notification preview,
 * almost without opening the app):
 *   Line 1 → 🟢/🔴 binary entry semaphore (ENTRAR / NO ENTRAR)
 *   Then  → compact rationale (regime · indicators · pullback risk)
 *   Then  → top US-market news headlines (super-condensed)
 *
 * The semaphore combines THREE signals (see api/_lib/marketPulse.js):
 *   1) Market Regime (SPY vs EMA200)            — 40% (hard override if BEARISH)
 *   2) Weighted Master Indicators                — 35%
 *      (VIX 30% · MOVE 20% · HYG 20% · VVIX 15% · TNX 10% · LQD 5% — NOT equal weight)
 *   3) Broad-market (SPY) pullback risk          — 25%
 */

import { cascadeQuote, cascadeHistory } from "../_lib/providerCascade.js";
import { calculateEma, calculateTechnicals } from "../_lib/technicalEngine.js";
import {
  computeIndicatorsComposite, indicatorsLabel,
  computeBroadMarketPullbackRisk, pullbackLabel,
  computeEntrySemaphore,
} from "../_lib/marketPulse.js";
import { classifyMonetaryCycle } from "../_lib/monetaryCycleEngine.js";
import { fetchUsMarketNewsDigest } from "../_lib/newsDigest.js";
import { sendTelegramMessage } from "../_lib/telegram.js";
import { kvGet, kvSet } from "../_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
// Clave diaria de deduplicación: dos triggers (cron Vercel + GitHub Actions) cubren
// el envío con redundancia, pero solo se manda UN mensaje por día. ?force=true lo ignora.
const SENT_KEY_PREFIX = "market_pulse_sent_";
const ENDPOINT = "MARKET_PULSE_TELEGRAM";
const BENCHMARK = "SPY.US";

function getEnv() { return globalThis.process?.env ?? {}; }

function isConfiguredSecret(value) {
  if (!value || !value.trim()) return false;
  const normalized = value.trim().toLowerCase();
  return !["your_", "_here", "placeholder"].some((part) => normalized.includes(part));
}

function sendJson(response, status, payload) {
  return response.status(status).json({ ...payload, app: APP_NAME, endpoint: ENDPOINT, timestampUtc: new Date().toISOString() });
}

// Vercel automatically calls Cron-triggered routes with `Authorization: Bearer ${CRON_SECRET}`
// IF CRON_SECRET is configured. We verify it when present; otherwise allow (manual testing).
function isAuthorizedCronCall(request, env) {
  const secret = env.CRON_SECRET;
  if (!isConfiguredSecret(secret)) return true; // not configured → no gate (manual testing allowed)
  const auth = request.headers?.authorization ?? request.headers?.Authorization ?? "";
  return auth === `Bearer ${secret}`;
}

async function resolveMarketRegime(env) {
  const result = await cascadeHistory(BENCHMARK, 260, {
    TWELVE_DATA_API_KEY: isConfiguredSecret(env.TWELVE_DATA_API_KEY) ? env.TWELVE_DATA_API_KEY : null,
  });

  if (!result.ok || result.bars.length < 200) {
    return { regime: "UNKNOWN", technicals: null, bars: [] };
  }

  const closes = result.bars.map((bar) => bar.close).filter(Number.isFinite);
  const ema200 = calculateEma(closes, 200);
  const lastClose = closes.at(-1);

  if (!ema200 || !lastClose) {
    return { regime: "UNKNOWN", technicals: null, bars: result.bars };
  }

  const regime = lastClose > ema200 ? "BULLISH" : "BEARISH";
  const tech = calculateTechnicals(result.bars, result.bars);

  return { regime, technicals: tech.ok ? tech.technicals : null, bars: result.bars };
}

function pct(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatCanaryTime(isoUtc) {
  try {
    return new Date(isoUtc).toLocaleString("es-ES", {
      timeZone: "Atlantic/Canary",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return isoUtc;
  }
}

function buildMessage({ semaphore, regime, indicators, pullback, news, monetaryCycle, generatedAtUtc }) {
  const isGreen = semaphore.signal === "GREEN";
  const headline = isGreen
    ? "🟢 VERDE — ENTRAR / MANTENER POSICIONES"
    : "🔴 ROJO — NO ENTRAR / FUERA DE MERCADO";

  const regimeText = regime === "BULLISH" ? "Alcista (SPY > EMA200)"
    : regime === "BEARISH" ? "Bajista (SPY < EMA200)"
    : "Sin datos";

  const lines = [];
  lines.push(`<b>${headline}</b>`);
  lines.push(`Score combinado: <b>${semaphore.composite}/100</b>`);
  lines.push("");
  lines.push(`📊 Régimen de mercado: <b>${regimeText}</b>`);
  lines.push(`📈 Indicadores ponderados (VIX 30·MOVE 20·HYG 20·VVIX 15·TNX 10·LQD 5): <b>${indicators.composite}/100</b> — ${indicatorsLabel(indicators.composite)}`);
  lines.push(`⚠️ Riesgo de pullback S&amp;P 500: <b>${pullbackLabel(pullback.level)}</b>${pullback.score != null ? ` (${pullback.score}/100)` : ""}`);
  if (monetaryCycle && monetaryCycle.hasData) {
    const cycleEmoji = monetaryCycle.phase === 'EASING' ? '📉' : monetaryCycle.phase === 'TIGHTENING' ? '📈' : '➡️';
    lines.push(`${cycleEmoji} Ciclo monetario: <b>${monetaryCycle.label}</b> (Score ${monetaryCycle.score}/100)${monetaryCycle.phase === 'TIGHTENING' ? ' — <b>precaución: riesgo whipsaw</b>' : monetaryCycle.phase === 'EASING' ? ' — entorno favorable para momentum' : ''}`);
  }
  if (pullback.reasons?.length) {
    lines.push(`   ↳ ${pullback.reasons.map(escapeHtml).join(" · ")}`);
  }

  lines.push("");
  lines.push("📰 <b>Noticias clave EE.UU.</b> (últimas ~20h):");
  if (news.ok && news.headlines.length > 0) {
    for (const item of news.headlines) {
      const sourceTag = item.source ? ` [${escapeHtml(item.source)}]` : "";
      lines.push(`• ${escapeHtml(item.headline)}${sourceTag}`);
    }
  } else {
    lines.push("• (sin noticias relevantes disponibles en este momento)");
  }

  lines.push("");
  lines.push(`🕐 Generado: ${formatCanaryTime(generatedAtUtc)} (Canarias)`);

  return lines.join("\n");
}

// Limita una promesa a maxMs milisegundos. Si se agota devuelve el fallback
// en vez de rechazar, así Promise.all nunca se queda colgado.
function withTimeout(promise, maxMs, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), maxMs)),
  ]);
}

const CALL_TIMEOUT_MS = 5000; // cada llamada individual: 5s máximo → total ≤ 6s → seguro en Hobby (10s) y Pro (60s)

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const env = getEnv();

  if (request.method !== "GET" && request.method !== "POST") {
    return sendJson(response, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!isAuthorizedCronCall(request, env)) {
    return sendJson(response, 401, { ok: false, error: "UNAUTHORIZED_CRON_CALL" });
  }

  if (env.ENABLE_REAL_API_CALLS !== "true") {
    return sendJson(response, 200, { ok: false, error: "REAL_API_CALLS_DISABLED" });
  }

  // ── Deduplicación diaria ──────────────────────────────────────────────────
  // Dos disparadores (cron Vercel + GitHub Actions) garantizan la entrega con
  // redundancia; esta guarda evita un segundo mensaje el mismo día. ?force=true
  // la salta (para pruebas manuales).
  const force = request.query?.force === "true";
  const todayKey = `${SENT_KEY_PREFIX}${new Date().toISOString().slice(0, 10)}`;
  if (!force) {
    const alreadySent = await kvGet(todayKey).catch(() => null);
    if (alreadySent) {
      return sendJson(response, 200, { ok: true, skipped: "ALREADY_SENT_TODAY", sentAtUtc: alreadySent });
    }
  }

  const cascadeEnv = {
    FINNHUB_API_KEY:     isConfiguredSecret(env.FINNHUB_API_KEY)     ? env.FINNHUB_API_KEY     : null,
    FRED_API_KEY:        isConfiguredSecret(env.FRED_API_KEY)        ? env.FRED_API_KEY        : null,
    TWELVE_DATA_API_KEY: isConfiguredSecret(env.TWELVE_DATA_API_KEY) ? env.TWELVE_DATA_API_KEY : null,
    FMP_API_KEY:         isConfiguredSecret(env.FMP_API_KEY)         ? env.FMP_API_KEY         : null,
  };

  const QUOTE_FALLBACK = { ok: false, reason: "cron-timeout" };
  const NEWS_FALLBACK  = { ok: false, reason: "cron-timeout", headlines: [] };
  const REGIME_FALLBACK = { regime: "UNKNOWN", technicals: null, bars: [] };

  const [regimeResult, vixQ, moveQ, hygQ, vvixQ, tnxQ, lqdQ, news] = await Promise.all([
    withTimeout(resolveMarketRegime(env),             CALL_TIMEOUT_MS, REGIME_FALLBACK),
    withTimeout(cascadeQuote("VIX.INDX",   cascadeEnv), CALL_TIMEOUT_MS, QUOTE_FALLBACK),
    withTimeout(cascadeQuote("MOVE.INDX",  cascadeEnv), CALL_TIMEOUT_MS, QUOTE_FALLBACK),
    withTimeout(cascadeQuote("HYG.US",     cascadeEnv), CALL_TIMEOUT_MS, QUOTE_FALLBACK),
    withTimeout(cascadeQuote("VVIX.INDX",  cascadeEnv), CALL_TIMEOUT_MS, QUOTE_FALLBACK),
    withTimeout(cascadeQuote("US10Y.GBOND",cascadeEnv), CALL_TIMEOUT_MS, QUOTE_FALLBACK),
    withTimeout(cascadeQuote("LQD.US",     cascadeEnv), CALL_TIMEOUT_MS, QUOTE_FALLBACK),
    withTimeout(fetchUsMarketNewsDigest(env),           CALL_TIMEOUT_MS, NEWS_FALLBACK),
  ]);

  const indicatorInputs = {
    vix:  vixQ.ok  ? pct(vixQ.price)  : null,
    move: moveQ.ok ? pct(moveQ.price) : null,
    vvix: vvixQ.ok ? pct(vvixQ.price) : null,
    hygChangePercent: hygQ.ok ? pct(hygQ.changePercent) : null,
    lqdChangePercent: lqdQ.ok ? pct(lqdQ.changePercent) : null,
    tnxChangePercent: tnxQ.ok ? pct(tnxQ.changePercent) : null,
  };

  const indicators = computeIndicatorsComposite(indicatorInputs);
  const pullback = computeBroadMarketPullbackRisk(regimeResult.technicals);
  const semaphore = computeEntrySemaphore({
    regime: regimeResult.regime,
    indicatorsComposite: indicators.composite,
    pullbackRisk: pullback,
  });

  // ── Ciclo monetario (sin llamada extra — usa datos ya fetched) ────────────
  const monetaryCycle = classifyMonetaryCycle({
    tnxChangePercent: tnxQ.ok ? pct(tnxQ.changePercent) : null,
    hygChangePercent: hygQ.ok ? pct(hygQ.changePercent) : null,
    vixLevel:         vixQ.ok ? pct(vixQ.price) : null,
    moveLevel:        moveQ.ok ? pct(moveQ.price) : null,
  });

  const generatedAtUtc = new Date().toISOString();
  const message = buildMessage({ semaphore, regime: regimeResult.regime, indicators, pullback, news, monetaryCycle, generatedAtUtc });

  const sendResult = await sendTelegramMessage(message, env);

  // Marca el día como enviado SOLO si el envío fue exitoso (TTL 26h) — así si falla,
  // el otro disparador puede reintentar; si tiene éxito, no se duplica.
  if (sendResult.ok) {
    await kvSet(todayKey, generatedAtUtc, 26 * 3600).catch(() => {});
  }

  return sendJson(response, sendResult.ok ? 200 : 502, {
    ok: sendResult.ok,
    telegram: sendResult,
    semaphore,
    regime: regimeResult.regime,
    indicators,
    pullback,
    monetaryCycle,
    indicatorInputs,
    newsStatus: news.ok ? "OK" : `UNAVAILABLE (${news.reason})`,
    headlinesCount: news.ok ? news.headlines.length : 0,
    messagePreview: message,
  });
}
