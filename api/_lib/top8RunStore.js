import { createHash, randomUUID } from "node:crypto";

const RUN_TTL_MS = 30 * 60 * 1000;
const MAX_RUNS = 5;
const MAX_TOP_ASSETS = 8;

const runs = new Map();

function stableUniverseAssetKey(asset) {
  return [
    asset?.region ?? "",
    asset?.exchange ?? "",
    asset?.providerExchange ?? "",
    asset?.ticker ?? "",
    asset?.providerSymbol ?? "",
    asset?.isin ?? "",
    asset?.currency ?? "",
  ].join(":");
}

export function buildTop8UniverseFingerprint(assets = []) {
  const operableKeys = assets
    .filter((asset) => asset?.operabilityStatus === "OPERABLE")
    .map(stableUniverseAssetKey)
    .sort();

  return createHash("sha256").update(JSON.stringify(operableKeys)).digest("hex").slice(0, 24);
}

export function buildTop8RunSignature({ universeSummary, batchPlan, universeFingerprint }) {
  const payload = {
    universeSummary: {
      totalDiscovered: universeSummary?.totalDiscovered ?? 0,
      operable: universeSummary?.operable ?? 0,
      notOperable: universeSummary?.notOperable ?? 0,
      unknown: universeSummary?.unknown ?? 0,
      exchangesRequested: universeSummary?.exchangesRequested ?? 0,
      exchangesOk: universeSummary?.exchangesOk ?? 0,
      exchangesFailed: universeSummary?.exchangesFailed ?? 0,
    },
    batchPlan: {
      batchSize: batchPlan?.batchSize ?? 0,
      totalOperableCandidates: batchPlan?.totalOperableCandidates ?? 0,
      totalBatches: batchPlan?.totalBatches ?? 0,
    },
    universeFingerprint: universeFingerprint ?? null,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function nowUtc() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function sortTopAssets(assets) {
  return [...assets].sort((left, right) => {
    const scoreDelta = (right.score ?? -1) - (left.score ?? -1);
    if (scoreDelta !== 0) return scoreDelta;

    const convictionDelta = (right.conviction ?? -1) - (left.conviction ?? -1);
    if (convictionDelta !== 0) return convictionDelta;

    return String(left.ticker ?? "").localeCompare(String(right.ticker ?? ""));
  });
}

function mergeTopAssets(existingAssets, nextAssets) {
  const byTicker = new Map();

  for (const asset of [...existingAssets, ...nextAssets]) {
    if (!asset?.ticker) continue;
    const current = byTicker.get(asset.ticker);
    if (!current || (asset.score ?? -1) > (current.score ?? -1)) {
      byTicker.set(asset.ticker, asset);
    }
  }

  return sortTopAssets([...byTicker.values()]).slice(0, MAX_TOP_ASSETS);
}

function purgeExpiredRuns() {
  const cutoff = nowMs() - RUN_TTL_MS;
  for (const [runId, run] of runs.entries()) {
    if (run.createdAtMs < cutoff) runs.delete(runId);
  }

  const orderedRuns = [...runs.values()].sort((left, right) => right.createdAtMs - left.createdAtMs);
  for (const run of orderedRuns.slice(MAX_RUNS)) {
    runs.delete(run.runId);
  }
}

function publicRun(run) {
  if (!run) return null;
  const completedBatches = [...run.completedBatchNumbers].sort((left, right) => left - right);
  const totalBatches = run.batchPlan?.totalBatches ?? 0;
  const remainingBatchCount = Math.max(totalBatches - completedBatches.length, 0);
  const completedSet = run.completedBatchNumbers;
  let nextBatchNumber = null;

  for (let batchNumber = 1; batchNumber <= totalBatches; batchNumber += 1) {
    if (!completedSet.has(batchNumber)) {
      nextBatchNumber = batchNumber;
      break;
    }
  }

  const status = completedBatches.length >= totalBatches && totalBatches > 0 ? "COMPLETE" : "PARTIAL";

  return {
    runId: run.runId,
    status,
    isGlobalTop8Final: status === "COMPLETE",
    createdAtUtc: run.createdAtUtc,
    updatedAtUtc: run.updatedAtUtc,
    ttlSeconds: Math.floor(RUN_TTL_MS / 1000),
    universeSummary: run.universeSummary,
    batchPlan: run.batchPlan,
    universeFingerprint: run.universeFingerprint,
    universeSignature: run.universeSignature,
    completedBatches,
    completedBatchCount: completedBatches.length,
    remainingBatchCount,
    nextBatchNumber,
    totalBatches,
    processedProviderCalls: run.processedProviderCalls,
    top8Candidates: run.top8Candidates,
    warnings: [
      "Run state is ephemeral Vercel runtime memory only.",
      "Global TOP 8 is only final when every authorized dynamic batch has been processed in the same live runtime.",
      "No fixed manual ticker list is used.",
    ],
  };
}

export function createTop8Run({ universeSummary, batchPlan, universeFingerprint }) {
  purgeExpiredRuns();

  const runId = randomUUID();
  const timestampUtc = nowUtc();

  const run = {
    runId,
    createdAtMs: nowMs(),
    createdAtUtc: timestampUtc,
    updatedAtUtc: timestampUtc,
    universeSummary,
    batchPlan,
    universeFingerprint,
    universeSignature: buildTop8RunSignature({ universeSummary, batchPlan, universeFingerprint }),
    completedBatchNumbers: new Set(),
    processedProviderCalls: 0,
    top8Candidates: [],
  };

  runs.set(runId, run);
  return publicRun(run);
}

export function getTop8Run(runId) {
  purgeExpiredRuns();
  return publicRun(runs.get(runId));
}

export function finalizeTop8Run(runId) {
  purgeExpiredRuns();

  const run = publicRun(runs.get(runId));
  if (!run) {
    return {
      ok: false,
      error: "RUN_NOT_FOUND",
      message: "Top8 run was not found or expired from ephemeral runtime memory.",
    };
  }

  if (!run.isGlobalTop8Final) {
    return {
      ok: false,
      error: "RUN_NOT_COMPLETE",
      message: "Global TOP 8 is not final until every dynamic batch in the run has been processed.",
      run,
    };
  }

  return {
    ok: true,
    run,
    assets: run.top8Candidates,
  };
}

export function validateTop8RunForBatch({ runId, batchNumber, universeSignature }) {
  purgeExpiredRuns();

  const run = runs.get(runId);
  if (!run) {
    return {
      ok: false,
      error: "RUN_NOT_FOUND",
      message: "Top8 run was not found or expired from ephemeral runtime memory.",
    };
  }

  if (universeSignature && run.universeSignature !== universeSignature) {
    return {
      ok: false,
      error: "RUN_UNIVERSE_MISMATCH",
      message: "Current dynamic universe does not match the universe captured when the run was created.",
      run: publicRun(run),
    };
  }

  if (run.completedBatchNumbers.has(batchNumber)) {
    return {
      ok: false,
      error: "BATCH_ALREADY_ATTACHED",
      message: "This batch was already attached to the run; provider calls are blocked to avoid double counting.",
      run: publicRun(run),
    };
  }

  return {
    ok: true,
    run: publicRun(run),
  };
}

export function updateTop8RunWithBatch({ runId, batchNumber, pipeline, universeSignature }) {
  const validation = validateTop8RunForBatch({ runId, batchNumber, universeSignature });
  if (!validation.ok) return validation;

  const run = runs.get(runId);
  run.completedBatchNumbers.add(batchNumber);
  run.processedProviderCalls += pipeline?.providerCallsPlanned ?? 0;
  run.top8Candidates = mergeTopAssets(run.top8Candidates, pipeline?.assets ?? []);
  run.updatedAtUtc = nowUtc();

  return {
    ok: true,
    run: publicRun(run),
  };
}
