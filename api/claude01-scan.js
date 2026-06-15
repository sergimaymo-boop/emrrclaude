/**
 * /api/claude01-scan — Claude01: Momentum Catalítico Adaptativo
 * =============================================================
 * GET → devuelve el análisis Claude01 (régimen + oportunidades de pullback + catalizadores).
 * Completamente independiente: no toca ningún otro módulo, no lanza scans, no modifica Redis
 * de otros módulos. Solo lee FABLE01 cache + SPY bars + indicators, y escribe su propia clave.
 */
import { kvGet, kvSet, loadBenchmarkBars } from "./_lib/kvStorage.js";
import { cascadeHistory, cascadeQuote } from "./_lib/providerCascade.js";
import {
  detectPullback,
  fetchEarningsCalendar,
  buildClaude01Items,
} from "./_lib/claude01Engine.js";

const CLAUDE01_KEY   = "claude01_v1";
const CLAUDE01_TTL   = 30 * 60; // 30 min
const FABLE01_KEY    = "fable01_v1";
const SPY_REGIME_KEY = "spy_bullish_last"; // mismo key que market-breadth usa
const LOOKBACK_DAYS  = 310; // >300 → Yahoo "2y" (~500 barras, suficiente para EMA200)
const MAX_TICKERS    = 8;   // analizar los 8 primeros FABLE01 (evitar timeout Vercel)

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Module", "claude01");

  if (req.method === "POST") {
    // POST → forzar recálculo (botón "Actualizar" del frontend)
    await kvSet(CLAUDE01_KEY, null, 1); // invalida cache inmediatamente
  }

  // ── 1. Cache hit ──────────────────────────────────────────────────────────
  const cached = await kvGet(CLAUDE01_KEY).catch(() => null);
  if (cached && cached.opportunities) {
    return res.status(200).json({ ...cached, fromCache: true });
  }

  // ── 2. Leer inputs desde Redis + quotes en vivo de VIX/HYG ──────────────
  const finnhubKey = process.env.FINNHUB_API_KEY ?? null;
  const env = { FINNHUB_API_KEY: finnhubKey };

  const [fable01Raw, spyBars, spyRegime, vixQuote, hygQuote] = await Promise.all([
    kvGet(FABLE01_KEY).catch(() => null),
    loadBenchmarkBars().catch(() => null),
    kvGet(SPY_REGIME_KEY).catch(() => null),  // { spyBullish: boolean }
    cascadeQuote("VIX.INDX", env).catch(() => null),
    cascadeQuote("HYG.US", env).catch(() => null),
  ]);

  const fable01Items = (fable01Raw?.items ?? []).slice(0, MAX_TICKERS);

  // Construir array de indicators simplificado para classifyRegime
  const indicators = [
    vixQuote?.ok  ? { symbol: "VIX", value: vixQuote.price,  trend: vixQuote.changePercent > 0 ? "UP" : "DOWN" } : null,
    hygQuote?.ok  ? { symbol: "HYG", value: hygQuote.price,  trend: hygQuote.changePercent > 0 ? "UP" : "DOWN" } : null,
  ].filter(Boolean);

  if (fable01Items.length === 0) {
    return res.status(200).json({
      ok: false,
      reason: "NO_FABLE01_DATA",
      message: "Ejecuta un SCAN completo primero para calcular FABLE01.",
      opportunities: [], watching: [],
      fromCache: false,
      timestampUtc: new Date().toISOString(),
    });
  }

  // SPY bars: si loadBenchmarkBars devuelve null, usar spyBullish cacheado como fallback
  const spyBarsForRegime = spyBars ?? [];

  // ── 3. Fetch bars para cada ticker (paralelo, degradación silenciosa) ─────
  const yahooResults = await Promise.allSettled(
    fable01Items.map(item =>
      cascadeHistory(item.symbol, LOOKBACK_DAYS, env)
        .catch(() => ({ ok: false }))
    )
  );

  // Añadir _pullback a cada item
  const enrichedItems = fable01Items.map((item, i) => {
    const result = yahooResults[i];
    if (result.status !== "fulfilled" || !result.value?.ok) return item;
    const bars = result.value.bars ?? [];
    if (bars.length < 60) return item;
    return { ...item, _pullback: detectPullback(bars), _bars: bars };
  });

  // ── 4. Finnhub earnings calendar (1 llamada, no bloquea si falla) ─────────
  const symbols = fable01Items.map(i => i.symbol);
  const earningsMap = await fetchEarningsCalendar(symbols, finnhubKey, 12).catch(() => ({}));

  // ── 5. Build resultado ────────────────────────────────────────────────────
  // spyBullish cacheado como fallback si no hay barras SPY disponibles
  const spyBullishFallback = spyRegime?.spyBullish ?? null;
  const { regimeResult, opportunities, watching } = buildClaude01Items(
    enrichedItems, spyBarsForRegime, indicators, earningsMap, spyBullishFallback
  );

  // Limpiar _bars (no serializar las 500 barras en Redis)
  const cleanItems = (arr) => arr.map(({ _bars, _pullback, ...rest }) => rest);

  const result = {
    ok: true,
    ...regimeResult,
    opportunities: cleanItems(opportunities),
    watching: cleanItems(watching),
    totalAnalyzed: enrichedItems.length,
    fromCache: false,
    timestampUtc: new Date().toISOString(),
  };

  // ── 6. Guardar en Redis ───────────────────────────────────────────────────
  await kvSet(CLAUDE01_KEY, result, CLAUDE01_TTL).catch(() => {});

  return res.status(200).json(result);
}
