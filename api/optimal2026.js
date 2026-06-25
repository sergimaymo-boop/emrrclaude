/**
 * /api/optimal2026 — Optimal2026 module endpoint (read-only GET)
 *
 * Returns the last computed Optimal2026 snapshot from KV cache.
 * The snapshot is computed as a side-effect of the market-breadth scan
 * (POST /api/market-breadth?action=start/continue) — fully independent output.
 *
 * GET /api/optimal2026 → last cached result (fast, KV read)
 */

import { kvGet } from "./_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Optimal2026";
const OPTIMAL2026_KEY = "optimal2026_v1";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED", app: APP_NAME });
  }

  try {
    const data = await kvGet(OPTIMAL2026_KEY);
    if (!data) {
      return res.status(404).json({
        ok: false,
        app: APP_NAME,
        error: "NO_DATA",
        message: "Optimal2026 aún no tiene datos. Ejecuta un scan completo (Amplitud de Mercado) para generarlos.",
        timestampUtc: new Date().toISOString(),
      });
    }
    return res.status(200).json({
      ...data,
      app: APP_NAME,
      retrievedAtUtc: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      app: APP_NAME,
      error: "KV_READ_FAILED",
      message: e?.message ?? "Error al leer KV",
      timestampUtc: new Date().toISOString(),
    });
  }
}
