/**
 * Optimal2026 — handler de lectura (GET) servido vía /api/market-data?source=optimal2026.
 *
 * Se movió aquí desde api/optimal2026.js para respetar el límite de 12 Serverless
 * Functions del plan Vercel Hobby (los módulos de _lib/ NO cuentan como función).
 * La ruta pública /api/optimal2026 se preserva SIN cambios en el frontend mediante
 * un rewrite en vercel.json. Comportamiento idéntico al endpoint original.
 *
 * Devuelve el último snapshot Optimal2026 calculado (cache KV). El snapshot se computa
 * como side-effect del scan de Amplitud de Mercado — salida totalmente independiente.
 */

import { kvGet } from "./kvStorage.js";

const APP_NAME = "EMRR 2.0 / Optimal2026";
const OPTIMAL2026_KEY = "optimal2026_v1";

export async function handler(req, res) {
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
