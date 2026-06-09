/**
 * Minimal Telegram Bot API client — sendMessage only.
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars (configured in Vercel).
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 8000;

export async function sendTelegramMessage(text, env = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      return { ok: false, reason: payload?.description ?? `Telegram HTTP ${response.status}` };
    }

    return { ok: true, messageId: payload.result?.message_id ?? null };
  } catch (err) {
    // Log the real error so silent failures (abort/timeout/network) are diagnosable
    // in Vercel logs instead of vanishing behind a generic message.
    console.error("[telegram] sendMessage failed:", err?.message ?? err);
    return { ok: false, reason: `Telegram request failed: ${err?.message ?? "timeout/network"}` };
  } finally {
    clearTimeout(timeout);
  }
}
