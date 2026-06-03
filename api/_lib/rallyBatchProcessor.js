/**
 * Rally Leaders Engine — batch processor (shared between start and continue)
 */
import { fetchEodhdHistoricalBars } from "./historicalDataProvider.js";
import { calculateRallyScore } from "./rallyScoreEngine.js";

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
    .sort((a, b) => b.rallyScore - a.rallyScore)
    .slice(0, MAX_TOP_CANDIDATES);
}

export async function fetchSpyBars() {
  try {
    const r = await fetchEodhdHistoricalBars(BENCHMARK_SYMBOL, { fromDate: null });
    return r.ok ? r.bars : [];
  } catch {
    return [];
  }
}

export async function runRallyBatch({ eligibleAssets, batchIndex, batchSize, existingCandidates, spyBars, minScore = 60 }) {
  const batch = eligibleAssets.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
  const newCandidates = [];
  let providerCalls = 0;

  for (const asset of batch) {
    try {
      const histResult = await fetchEodhdHistoricalBars(asset.providerSymbol, { fromDate: null });
      providerCalls++;
      if (!histResult.ok || histResult.bars.length < 130) continue;

      const rallyResult = calculateRallyScore({
        bars: histResult.bars,
        spyBars,
        spreadPercent: null,
        region: asset.region ?? (asset.providerSymbol.endsWith(".US") ? "USA" : "Europe"),
      });

      if (!rallyResult.ok || rallyResult.rallyScore < minScore) continue;

      newCandidates.push({
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
        metrics: rallyResult.metrics,
        dataMode: "REAL",
        dataQuality: "GOOD",
        scanId: null,
      });
    } catch {
      // skip asset on error
    }
  }

  return {
    candidates: mergeRallyCandidates(existingCandidates, newCandidates),
    providerCalls,
  };
}
