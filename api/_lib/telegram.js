/**
 * Telegram Bot API client — sendMessage with retry and error classification.
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars (configured in Vercel).
 *
 * Error types:
 *   BOT_BLOCKED      — usuario bloqueó el bot. No reintentar.
 *   CHAT_NOT_FOUND   — chat_id inválido. No reintentar.
 *   INVALID_TOKEN    — token inválido/expirado. No reintentar.
 *   CONFIG_MISSING   — vars de entorno no configuradas. No reintentar.
 *   TRANSIENT        — timeout/red/error temporal. SÍ reintentar.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 10000;

// Errores de Telegram que son permanentes — reintentar no sirve de nada.
const NON_RETRYABLE_CODES = new Set([400, 401, 403]);
const NON_RETRYABLE_PHRASES = [
  "bot was blocked",
  "chat not found",
  "user is deactivated",
  "bot was kicked",
  "not enough rights",
  "have no rights",
  "unauthorized",
  "invalid token",
];

function classifyError(description = "", httpStatus) {
  const lower = (description || "").toLowerCase();
  if (lower.includes("bot was blocked") || lower.includes("bot was kicked")) return "BOT_BLOCKED";
  if (lower.includes("chat not found"))  return "CHAT_NOT_FOUND";
  if (lower.includes("unauthorized") || lower.includes("invalid token")) return "INVALID_TOKEN";
  if (NON_RETRYABLE_CODES.has(httpStatus) || NON_RETRYABLE_PHRASES.some(p => lower.includes(p))) return "NON_RETRYABLE";
  return "TRANSIENT";
}

async function attemptSend(token, chatId, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const desc = payload?.description ?? `HTTP ${response.status}`;
      return { ok: false, reason: desc, errorType: classifyError(desc, response.status), retryable: false };
    }
    return { ok: true, messageId: payload.result?.message_id ?? null };
  } catch (err) {
    const msg = err?.message ?? "timeout/network";
    console.error("[telegram] sendMessage attempt failed:", msg);
    return { ok: false, reason: msg, errorType: "TRANSIENT", retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

// Reintenta sólo en errores transitorios (red, timeout). Falla rápido en permanentes.
export async function sendTelegramMessage(text, env = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured", errorType: "CONFIG_MISSING", retryable: false };
  }

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 4000;
  let lastResult;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastResult = await attemptSend(token, chatId, text);
    if (lastResult.ok) return lastResult;

    // Error permanente — no reintentar, fallar rápido.
    if (!lastResult.retryable) {
      console.error(`[telegram] Non-retryable error (${lastResult.errorType}): ${lastResult.reason}`);
      return lastResult;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[telegram] Transient error attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${RETRY_DELAY_MS}ms…`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  console.error(`[telegram] All ${MAX_ATTEMPTS} attempts failed. Last: ${lastResult.reason}`);
  return lastResult;
}
