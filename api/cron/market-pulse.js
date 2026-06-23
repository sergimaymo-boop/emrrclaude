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

import { cascadeQuote } from "../_lib/providerCascade.js";
import {
  computeIndicatorsComposite, indicatorsLabel,
  computeIndicatorsSemaphore, indicatorVerdict, investorAnalysis,
} from "../_lib/marketPulse.js";
import { fetchUsMarketNewsDigest } from "../_lib/newsDigest.js";
import { sendTelegramMessage } from "../_lib/telegram.js";
import { kvGet, kvSet } from "../_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
// Clave diaria de deduplicación: dos triggers (cron Vercel + GitHub Actions) cubren
// el envío con redundancia, pero solo se manda UN mensaje por día. ?force=true lo ignora.
const SENT_KEY_PREFIX = "market_pulse_sent_";
const ENDPOINT = "MARKET_PULSE_TELEGRAM";

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

function buildMessage({ semaphore, indicators, indicatorRows, news, generatedAtUtc }) {
  const isGreen = semaphore.signal === "GREEN";
  // El semáforo va PRIMERO para que se lea en la notificación push sin abrir Telegram.
  const headline = isGreen
    ? "🟢 VERDE — INVERTIR"
    : "🔴 ROJO — ESPERAR";

  const lines = [];
  lines.push(`<b>${headline}</b>`);
  lines.push(`Análisis de indicadores en tiempo real · <b>${indicators.composite}/100</b> — ${indicatorsLabel(indicators.composite)}`);
  lines.push("");
  // Análisis "mejor inversor del mundo" — conclusión accionable.
  lines.push(`💡 ${escapeHtml(investorAnalysis(indicators.composite, semaphore.signal))}`);
  lines.push("");

  // Los 6 indicadores ponderados, en tiempo real, con su veredicto.
  lines.push("📊 <b>Indicadores de mercado</b> (ponderados):");
  for (const row of indicatorRows) {
    const v = indicatorVerdict(row.score);
    lines.push(`${v.emoji} <b>${escapeHtml(row.label)}</b> ${escapeHtml(row.value)} · ${escapeHtml(row.desc)}`);
  }

  lines.push("");
  lines.push("📰 <b>Noticias clave EE.UU. / Europa</b> (en español):");
  if (news.ok && news.headlines.length > 0) {
    for (const item of news.headlines) {
      const sourceTag = item.source ? ` [${escapeHtml(item.source)}]` : "";
      lines.push(`• ${escapeHtml(item.headline)}${sourceTag}`);
    }
  } else {
    lines.push("• (sin noticias relevantes disponibles en este momento)");
  }

  lines.push("");
  lines.push(`🕐 ${formatCanaryTime(generatedAtUtc)} (Canarias)`);

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

  // SOLO los 6 indicadores de mercado en tiempo real + noticias. Sin régimen SPY ni
  // pullback (no requieren scan ni historia) — el análisis es exclusivamente sobre
  // estos 6 índices, ponderados. Esto además acelera el cron (sin fetch de 260 barras).
  const [vixQ, moveQ, hygQ, vvixQ, tnxQ, lqdQ, news] = await Promise.all([
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
  // Semáforo binario invertir/esperar SOLO con el composite ponderado de los 6 índices.
  const semaphore = computeIndicatorsSemaphore(indicators.composite);

  // Valores en tiempo real para mostrar cada indicador con su veredicto.
  const fmtLvl = (q) => (q.ok && Number.isFinite(q.price)) ? q.price.toFixed(2) : "—";
  const fmtChg = (q) => (q.ok && Number.isFinite(q.changePercent)) ? `${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%` : "—";
  const fmtTnx = (q) => {
    if (!q.ok) return "—";
    const lvl = Number.isFinite(q.price) ? `${q.price.toFixed(2)}%` : "—";
    const chg = Number.isFinite(q.changePercent) ? ` (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%)` : "";
    return `${lvl}${chg}`;
  };
  const indicatorRows = [
    { label: "VIX",  value: fmtLvl(vixQ),  score: indicators.scores.VIX,  desc: "volatilidad S&P 500" },
    { label: "MOVE", value: fmtLvl(moveQ), score: indicators.scores.MOVE, desc: "volatilidad de bonos" },
    { label: "HYG",  value: fmtChg(hygQ),  score: indicators.scores.HYG,  desc: "crédito high-yield" },
    { label: "VVIX", value: fmtLvl(vvixQ), score: indicators.scores.VVIX, desc: "volatilidad de la volatilidad" },
    { label: "TNX",  value: fmtTnx(tnxQ),  score: indicators.scores.TNX,  desc: "bono 10 años EE.UU." },
    { label: "LQD",  value: fmtChg(lqdQ),  score: indicators.scores.LQD,  desc: "crédito investment-grade" },
  ];

  const generatedAtUtc = new Date().toISOString();
  const message = buildMessage({ semaphore, indicators, indicatorRows, news, generatedAtUtc });

  const sendResult = await sendTelegramMessage(message, env);

  // Marca el día como enviado SOLO si el envío fue exitoso (TTL 26h) — así si falla,
  // el otro disparador puede reintentar; si tiene éxito, no se duplica.
  // IMPORTANTE: las llamadas con ?force=true (pruebas/auditoría) NO marcan el día, para
  // que una prueba manual nunca bloquee el disparo automático real de ese día.
  if (sendResult.ok && !force) {
    await kvSet(todayKey, generatedAtUtc, 26 * 3600).catch(() => {});
  }

  // Guardar diagnóstico del último intento (éxito O fallo) para poder inspeccionarlo.
  // TTL 8 días — permite auditar la semana anterior.
  const diagKey = `market_pulse_diag_${generatedAtUtc.slice(0, 10)}`;
  await kvSet(diagKey, JSON.stringify({
    sentAtUtc: generatedAtUtc,
    ok: sendResult.ok,
    errorType: sendResult.errorType ?? null,
    reason: sendResult.ok ? null : sendResult.reason,
    composite: indicators.composite,
    signal: semaphore.signal,
  }), 8 * 24 * 3600).catch(() => {});

  // Log claro en Vercel para que los errores no se pierdan en el ruido.
  if (!sendResult.ok) {
    console.error(
      `[market-pulse] ❌ Telegram send FAILED. errorType=${sendResult.errorType ?? "?"} reason="${sendResult.reason}" — ` +
      (sendResult.errorType === "BOT_BLOCKED"
        ? "ACCIÓN REQUERIDA: el usuario bloqueó el bot. Ir a Telegram → buscar el bot → pulsar Start/Iniciar."
        : sendResult.errorType === "INVALID_TOKEN"
        ? "ACCIÓN REQUERIDA: TELEGRAM_BOT_TOKEN inválido o expirado. Regenerar el token en @BotFather."
        : sendResult.errorType === "CHAT_NOT_FOUND"
        ? "ACCIÓN REQUERIDA: TELEGRAM_CHAT_ID incorrecto. Verificar el chat_id en Vercel env vars."
        : "Error transitorio — el siguiente disparador reintentará automáticamente.")
    );
  } else {
    console.log(`[market-pulse] ✅ Telegram sent OK. composite=${indicators.composite} signal=${semaphore.signal}`);
  }

  return sendJson(response, sendResult.ok ? 200 : 502, {
    ok: sendResult.ok,
    telegram: sendResult,
    semaphore,
    indicators,
    indicatorInputs,
    newsStatus: news.ok ? "OK" : `UNAVAILABLE (${news.reason})`,
    headlinesCount: news.ok ? news.headlines.length : 0,
    messagePreview: message,
  });
}
