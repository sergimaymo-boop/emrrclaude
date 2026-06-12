/**
 * /api/fable5 — FABLE 5 (endpoint independiente, solo lectura).
 * Sirve el top-10 de TENDENCIA ALCISTA LIMPIA (sin pullback inminente) calculado durante el
 * scan de amplitud (mismas barras del universo US+EU, cero coste extra) y persistido en Redis
 * (fable5_v1). El frontend lo refresca con GET; el cálculo lo dispara el SCAN o el cron.
 */
import { kvGet } from "./_lib/kvStorage.js";

const FABLE5_KEY = "fable5_v1";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cached = await kvGet(FABLE5_KEY).catch(() => null);
  if (!cached) {
    return res.status(200).json({
      ok: true, items: [], reason: "NO_DATA_YET",
      message: "Sin datos — ejecuta un SCAN para calcular FABLE 5.",
      timestampUtc: new Date().toISOString(),
    });
  }
  return res.status(200).json({ ...cached, fromCache: true, timestampUtc: new Date().toISOString() });
}
