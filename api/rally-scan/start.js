/**
 * POST /api/rally-scan/start
 * Rally Leaders Engine — independent from SCAN FULL / TOP 8
 */
import { buildUniverseResponse } from "../universe.js";
import { saveLastRallySnapshot } from "../_lib/kvStorage.js";
import { runRallyBatch, fetchSpyBars } from "../_lib/rallyBatchProcessor.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "RALLY_SCAN_START";
const RALLY_VERSION = "RALLY_V1";
const BATCH_SIZE = 80;
const MAX_TOP_CANDIDATES = 10;
const MIN_RALLY_SCORE = 60;

function getEnv() { return globalThis.process?.env ?? {}; }
function isRealApiEnabled() { return getEnv().ENABLE_REAL_API_CALLS === "true"; }

function sendJson(res, status, payload) {
  res.status(status).json({ ...payload, app: APP_NAME, endpoint: ENDPOINT, timestampUtc: new Date().toISOString() });
}

function encodeToken(state) {
  return Buffer.from(JSON.stringify({ v: RALLY_VERSION, ...state })).toString("base64url");
}

function createScanId() {
  return `rally-${Date.now().toString(36)}`;
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function mergeCandidates(existing, newOnes) {
  const map = new Map(existing.map(c => [c.providerSymbol, c]));
  for (const c of newOnes) {
    const prev = map.get(c.providerSymbol);
    if (!prev || c.rallyScore > prev.rallyScore) map.set(c.providerSymbol, c);
  }
  return [...map.values()]
    .sort((a, b) => b.rallyScore - a.rallyScore)
    .slice(0, MAX_TOP_CANDIDATES);
}

// runRallyBatch is imported from rallyBatchProcessor.js — no duplicate definition here

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!isRealApiEnabled()) {
    return sendJson(res, 409, {
      ok: false,
      status: "RALLY_DATA_UNAVAILABLE",
      error: "REAL_API_CALLS_DISABLED",
      message: "Set ENABLE_REAL_API_CALLS=true to run Rally scan.",
    });
  }

  const scanStartedAtUtc = new Date().toISOString();
  const scanId = createScanId();

  // Get universe (shared, read-only)
  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok || universe.assets.length === 0) {
    return sendJson(res, 409, {
      ok: false,
      status: "RALLY_DATA_UNAVAILABLE",
      error: universe.error ?? "UNIVERSE_NOT_READY",
      message: "Rally scan requires active universe. Markets may be closed.",
    });
  }

  // Filter operable only
  const eligibleAssets = universe.assets.filter(a => a.operabilityStatus === "OPERABLE");
  if (eligibleAssets.length === 0) {
    return sendJson(res, 409, {
      ok: false,
      status: "RALLY_DATA_UNAVAILABLE",
      error: "NO_OPERABLE_ASSETS",
      message: "No operable assets in universe.",
    });
  }

  const spyBars = await fetchSpyBars();

  const batchesTotal = Math.ceil(eligibleAssets.length / BATCH_SIZE);
  const universeHash = Buffer.from(eligibleAssets.map(a => a.providerSymbol).join(","))
    .toString("base64url").slice(0, 16);
  const activeMarkets = [...new Set(eligibleAssets.map(a => a.market ?? a.providerExchange))];

  // Process batch 0
  const { candidates, providerCalls } = await runRallyBatch({
    eligibleAssets,
    batchIndex: 0,
    batchSize: BATCH_SIZE,
    existingCandidates: [],
    spyBars,
  });

  const batchesCompleted = 1;
  const coveragePercent = Math.round((batchesCompleted / batchesTotal) * 100);
  const isComplete = batchesCompleted >= batchesTotal;

  // Stamp scanId on candidates
  const top10 = candidates.map((c, i) => ({ ...c, rank: i + 1, scanId }));

  // Save if complete
  if (isComplete) {
    await saveLastRallySnapshot({
      ok: true,
      scanId,
      scanStartedAtUtc,
      scanCompletedAtUtc: new Date().toISOString(),
      coveragePercent: 100,
      isRallyFinal: true,
      top10,
      universeHash,
      activeMarkets,
      universeCount: eligibleAssets.length,
      actualProviderCalls: providerCalls,
    });
  }

  const rallyToken = encodeToken({
    scanId,
    scanStartedAtUtc,
    universeHash,
    activeMarkets,
    universeCount: eligibleAssets.length,
    batchSize: BATCH_SIZE,
    batchesTotal,
    batchesCompleted,
    nextBatchIndex: isComplete ? null : 1,
    coveragePercent,
    eligibleTickers: eligibleAssets.map(a => a.providerSymbol),
    topCandidates: top10,
    actualProviderCalls: providerCalls,
    spyBarsLength: spyBars.length,
  });

  const statusCode = isComplete ? 200 : 206;

  return sendJson(res, statusCode, {
    ok: isComplete,
    mode: "RALLY_LEADERS_SCAN",
    status: isComplete ? "RALLY_FINAL" : "RALLY_SCANNING",
    scanId,
    scanStartedAtUtc,
    scanCompletedAtUtc: isComplete ? new Date().toISOString() : null,
    universeHash,
    activeMarkets,
    universeCount: eligibleAssets.length,
    batchesTotal,
    batchesCompleted,
    nextBatchIndex: isComplete ? null : 1,
    coveragePercent,
    actualProviderCalls: providerCalls,
    isRallyFinal: isComplete,
    rallyToken: isComplete ? null : rallyToken,
    top10,
    message: isComplete
      ? "Rally Leaders final — 100% coverage reached."
      : `Rally scan partial — batch 1/${batchesTotal} complete.`,
  });
}
