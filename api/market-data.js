/**
 * /api/market-data — dispatcher unificado de datos de mercado (GET).
 *
 * Consolida 4 endpoints en 1 sola Serverless Function para respetar el límite de
 * 12 del plan Vercel Hobby. Las rutas originales se preservan SIN cambios en el
 * frontend mediante rewrites en vercel.json:
 *   /api/fear-greed        → /api/market-data?source=fear-greed
 *   /api/market-regime     → /api/market-data?source=market-regime
 *   /api/monetary-cycle    → /api/market-data?source=monetary-cycle
 *   /api/master-indicators → /api/market-data?source=master-indicators
 *
 * La lógica de cada uno vive en api/_lib/*Handler.js (módulos importados — NO
 * cuentan como función serverless). Cada handler conserva su comportamiento exacto.
 */
import { handler as fearGreed } from "./_lib/fearGreedHandler.js";
import { handler as marketRegime } from "./_lib/marketRegimeHandler.js";
import { handler as monetaryCycle } from "./_lib/monetaryCycleHandler.js";
import { handler as masterIndicators } from "./_lib/masterIndicatorsHandler.js";

export default async function handler(req, res) {
  // El rewrite inyecta ?source=...; el fallback parsea la URL por si se llama directo.
  const source = req.query?.source ?? req.url?.split("source=")[1]?.split("&")[0] ?? "";
  switch (source) {
    case "fear-greed":        return fearGreed(req, res);
    case "market-regime":     return marketRegime(req, res);
    case "monetary-cycle":    return monetaryCycle(req, res);
    case "master-indicators": return masterIndicators(req, res);
    default:
      res.setHeader("Cache-Control", "no-store");
      return res.status(400).json({
        ok: false,
        error: "UNKNOWN_SOURCE",
        validSources: ["fear-greed", "market-regime", "monetary-cycle", "master-indicators"],
      });
  }
}
