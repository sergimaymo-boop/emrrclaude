/**
 * /api/fable01 — FABLE01 (endpoint independiente, solo lectura).
 * Sirve el top-10 de SALUD DE TENDENCIA con ASIGNACIÓN DE CAPITAL (allocation % + trailing TR/TN/TA),
 * calculado durante el scan de amplitud (mismas barras del universo US+EU, cero coste extra) y
 * persistido en Redis (fable01_v1). El frontend lo refresca con GET; el cálculo lo dispara el SCAN o el cron.
 * Aislado: un fallo o vacío aquí nunca afecta a otros módulos.
 */
import { kvGet } from "./_lib/kvStorage.js";

const FABLE01_KEY = "fable01_v1";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cached = await kvGet(FABLE01_KEY).catch(() => null);
  if (!cached) {
    return res.status(200).json({
      ok: true, items: [], reason: "NO_DATA_YET",
      message: "Sin datos — ejecuta un SCAN para calcular FABLE01.",
      timestampUtc: new Date().toISOString(),
    });
  }
  return res.status(200).json({ ...cached, fromCache: true, timestampUtc: new Date().toISOString() });
}
