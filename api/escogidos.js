/**
 * /api/escogidos — LOS ESCOGIDOS (endpoint independiente, solo lectura).
 * Sirve el top-10 con mayor probabilidad alcista a 5 sesiones (~7 días) calculado durante el
 * scan de amplitud (las MISMAS barras del universo US+EU — cero coste extra) y persistido en
 * Redis (escogidos_v1). El frontend lo refresca con GET; el cálculo lo dispara el SCAN o el cron.
 */
import { kvGet } from "./_lib/kvStorage.js";

const ESCOGIDOS_KEY = "escogidos_v1";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cached = await kvGet(ESCOGIDOS_KEY).catch(() => null);
  if (!cached) {
    return res.status(200).json({
      ok: true, items: [], reason: "NO_DATA_YET",
      message: "Sin datos — ejecuta un SCAN para calcular Los Escogidos.",
      timestampUtc: new Date().toISOString(),
    });
  }
  return res.status(200).json({ ...cached, fromCache: true, timestampUtc: new Date().toISOString() });
}
