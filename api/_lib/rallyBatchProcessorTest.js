/**
 * RALLY-TEST — batch processor de laboratorio (copia de rallyBatchProcessor.js, 18-ago-2026).
 * Idéntico al de producción salvo que puntúa con rallyScoreEngineTest.js.
 * Rally Leaders NO usa este archivo.
 *
 * Rally Leaders Engine — batch processor (shared between start and continue)
 * IMPORTANT: assets are processed IN PARALLEL (Promise.all), NOT sequentially.
 * Sequential processing at 80 assets × 7s timeout = 560s → Vercel timeout at 10s.
 */
import { fetchEodhdHistoricalBars } from "./historicalDataProvider.js";
import { loadBenchmarkBars, saveBenchmarkBars } from "./kvStorage.js";
import { raceBenchmarkHistory } from "./providerCascade.js";
import { calculateRallyScore } from "./rallyScoreEngineTest.js";

const MAX_TOP_CANDIDATES = 10;
const BENCHMARK_SYMBOL = "SPY.US";

export { BENCHMARK_SYMBOL };

export function mergeRallyCandidates(existing, newOnes) {
  const map = new Map(existing.map(c => [c.providerSymbol, c]));
  for (const c of newOnes) {
    const prev = map.get(c.providerSymbol);
    if (!prev || c.rallyScore > prev.rallyScore) map.set(c.providerSymbol, c);
  }
  return [...map.values()]
    // Desempate por el momento 9m CRUDO: el score satura en 100 con momentos >150%
    // (tanh), y sin esto el orden entre los mega-líderes quedaba arbitrario.
    .sort((a, b) => b.rallyScore - a.rallyScore || (b.metrics?.mom9m ?? 0) - (a.metrics?.mom9m ?? 0))
    .slice(0, MAX_TOP_CANDIDATES);
}

// SPY benchmark — Redis cache (4h TTL) + parallel race across all providers
export async function fetchSpyBars() {
  try {
    const cached = await loadBenchmarkBars();
    if (cached) return cached;

    const env = process.env;
    const result = await raceBenchmarkHistory(270, {
      EODHD_API_KEY:       env.EODHD_API_KEY,
      TWELVE_DATA_API_KEY: env.TWELVE_DATA_API_KEY,
      FMP_API_KEY:         env.FMP_API_KEY,
    });
    if (result.ok && result.bars.length >= 61) {
      saveBenchmarkBars(result.bars); // fire-and-forget
      return result.bars;
    }
    return [];
  } catch {
    return [];
  }
}

// PARALLEL batch — all assets fetched simultaneously, not one-by-one
export async function runRallyBatch({ eligibleAssets, batchIndex, batchSize, existingCandidates, spyBars, minScore = 60 }) {
  const batch = eligibleAssets.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);

  // Process ALL assets in parallel — critical to stay within 10s Vercel limit
  const results = await Promise.all(
    batch.map(async (asset) => {
      try {
        const histResult = await fetchEodhdHistoricalBars(asset.providerSymbol, { fromDate: null });
        if (!histResult.ok || histResult.bars.length < 130) return null;

        const rallyResult = calculateRallyScore({
          bars: histResult.bars,
          spyBars,
          spreadPercent: null,
          region: asset.region ?? (asset.providerSymbol.endsWith(".US") ? "USA" : "Europe"),
        });

        if (!rallyResult.ok || rallyResult.rallyScore < minScore) return null;

        return {
          rank: 0,
          ticker: asset.ticker ?? asset.providerSymbol.split(".")[0],
          name: asset.name ?? asset.ticker ?? asset.providerSymbol.split(".")[0],
          market: asset.market ?? asset.providerExchange ?? "",
          exchange: asset.exchange ?? asset.providerExchange ?? "",
          currency: asset.currency ?? "USD",
          providerSymbol: asset.providerSymbol,
          rallyScore: rallyResult.rallyScore,
          rallyLabel: rallyResult.label,
          rallyColor: rallyResult.color,
          trailingStop: rallyResult.trailingStop,
          // v3.0: el panel necesita AMBOS. Se listaban campo a campo y estos dos
          // se quedaron fuera, así que nunca llegaban al frontend.
          warningFlags: rallyResult.warningFlags ?? [],
          entryTiming: rallyResult.entryTiming ?? null,
          runway: rallyResult.runway ?? null,
          metrics: rallyResult.metrics,
          dataMode: "REAL",
          dataQuality: "GOOD",
          scanId: null,
        };
      } catch {
        return null;
      }
    })
  );

  const newCandidates = results.filter(Boolean);

  return {
    candidates: mergeRallyCandidates(existingCandidates, newCandidates),
    providerCalls: batch.length,
  };
}
