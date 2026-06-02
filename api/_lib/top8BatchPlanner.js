const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
const MIN_BATCH_SIZE = 50;
const MAX_BATCHES_RETURNED = 5;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBatchSize(value, fallback = DEFAULT_BATCH_SIZE) {
  const parsed = parsePositiveInteger(value, fallback);
  return Math.min(Math.max(parsed, MIN_BATCH_SIZE), MAX_BATCH_SIZE);
}

function stableCandidateKey(asset) {
  return [
    asset.region ?? "",
    asset.exchange ?? "",
    asset.providerExchange ?? "",
    asset.ticker ?? "",
    asset.providerSymbol ?? "",
    asset.isin ?? "",
  ].join(":");
}

function exchangePriority(asset) {
  const exchange = String(asset?.exchange ?? "").toUpperCase();
  const providerExchange = String(asset?.providerExchange ?? "").toUpperCase();
  if (exchange.includes("NASDAQ") || providerExchange === "NASDAQ") return 1;
  if (exchange.includes("NYSE") || providerExchange === "NYSE" || exchange === "USA_SUPPORTED" || providerExchange === "US") return 2;
  if (exchange.includes("LSE") || providerExchange === "LSE") return 3;
  if (exchange.includes("XETRA") || providerExchange === "XETRA" || providerExchange === "ETR") return 4;
  if (exchange.includes("EURONEXT") || ["AS", "PA", "BR", "LS", "EPA", "AMS", "EBR"].includes(providerExchange)) return 5;
  if (exchange.includes("BORSA") || ["BIT", "MIL", "MI"].includes(providerExchange)) return 6;
  if (exchange.includes("SIX") || ["VTX", "SW"].includes(providerExchange)) return 7;
  return 99;
}

function numericPriority(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareUniverseCandidates(left, right) {
    const exchangeDelta = exchangePriority(left) - exchangePriority(right);
    if (exchangeDelta !== 0) return exchangeDelta;

    const marketCapDelta = numericPriority(right.marketCapitalization) - numericPriority(left.marketCapitalization);
    if (marketCapDelta !== 0) return marketCapDelta;

    const volumeDelta = numericPriority(right.averageVolume) - numericPriority(left.averageVolume);
    if (volumeDelta !== 0) return volumeDelta;

    return stableCandidateKey(left).localeCompare(stableCandidateKey(right));
}

export function prioritizeUniverseCandidates(assets) {
  return safeArray(assets).sort(compareUniverseCandidates);
}

function summarizeBatch(batchAssets) {
  const byRegion = {};
  const byExchange = {};

  for (const asset of batchAssets) {
    const region = asset.region ?? "UNKNOWN";
    const exchange = asset.exchange ?? "UNKNOWN";
    byRegion[region] = (byRegion[region] ?? 0) + 1;
    byExchange[exchange] = (byExchange[exchange] ?? 0) + 1;
  }

  return { byRegion, byExchange };
}

export function buildTop8BatchPlan(assets, options = {}) {
  const batchSize = parseBatchSize(options.batchSize);
  const maxBatchesReturned = Math.min(
    parsePositiveInteger(options.maxBatchesReturned, MAX_BATCHES_RETURNED),
    MAX_BATCHES_RETURNED,
  );
  const operableCandidates = safeArray(assets)
    .filter((asset) => asset.operabilityStatus === "OPERABLE")
    .sort(compareUniverseCandidates);
  const totalBatches = Math.ceil(operableCandidates.length / batchSize);
  const batches = [];

  for (let index = 0; index < Math.min(totalBatches, maxBatchesReturned); index += 1) {
    const startIndex = index * batchSize;
    const batchAssets = operableCandidates.slice(startIndex, startIndex + batchSize);
    batches.push({
      batchNumber: index + 1,
      size: batchAssets.length,
      startIndex,
      endIndex: startIndex + batchAssets.length - 1,
      estimatedProviderCalls: batchAssets.length * 2 + 1,
      summary: summarizeBatch(batchAssets),
    });
  }

  return {
    strategy: "MANUAL_BATCHES_OVER_DYNAMIC_UNIVERSE",
    batchSize,
    totalOperableCandidates: operableCandidates.length,
    totalBatches,
    returnedBatches: batches.length,
    maxBatchesReturned,
    estimatedProviderCallsPerFullBatch: batchSize * 2 + 1,
    estimatedProviderCallsForAllBatches: operableCandidates.length * 2 + totalBatches,
    batches,
    warnings: [
      "Batch plan is derived from the dynamic universe, not from a fixed manual ticker list.",
      "Only summary metadata is returned to avoid a screener-style public asset list.",
      "Batches require explicit future authorization before processing.",
    ],
  };
}

export function getTop8Batch(assets, batchNumber, options = {}) {
  const batchSize = parseBatchSize(options.batchSize);
  const normalizedBatchNumber = parsePositiveInteger(batchNumber, 1);
  const operableCandidates = safeArray(assets)
    .filter((asset) => asset.operabilityStatus === "OPERABLE")
    .sort(compareUniverseCandidates);
  const startIndex = (normalizedBatchNumber - 1) * batchSize;

  return {
    batchNumber: normalizedBatchNumber,
    batchSize,
    assets: operableCandidates.slice(startIndex, startIndex + batchSize),
    totalOperableCandidates: operableCandidates.length,
    totalBatches: Math.ceil(operableCandidates.length / batchSize),
  };
}
