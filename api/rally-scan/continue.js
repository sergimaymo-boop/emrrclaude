/**
 * POST /api/rally-scan/continue
 * Rally Leaders Engine — continue partial scan
 */
import { saveLastRallySnapshot } from "../_lib/kvStorage.js";
import { runRallyBatch, fetchSpyBars } from "../_lib/rallyBatchProcessor.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "RALLY_SCAN_CONTINUE";

function getEnv() { return globalThis.process?.env ?? {}; }
function isRealApiEnabled() { return getEnv().ENABLE_REAL_API_CALLS === "true"; }

function sendJson(res, status, payload) {
  res.status(status).json({ ...payload, app: APP_NAME, endpoint: ENDPOINT, timestampUtc: new Date().toISOString() });
}

function encodeToken(state) {
  return Buffer.from(JSON.stringify({ v: "RALLY_V1", ...state })).toString("base64url");
}

function decodeToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (decoded.v !== "RALLY_V1") return { ok: false, error: "INVALID_TOKEN_VERSION" };
    return { ok: true, state: decoded };
  } catch {
    return { ok: false, error: "TOKEN_DECODE_FAILED" };
  }
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!isRealApiEnabled()) {
    return sendJson(res, 409, { ok: false, error: "REAL_API_CALLS_DISABLED" });
  }

  const body = await readBody(req);
  if (!body.rallyToken) {
    return sendJson(res, 400, { ok: false, error: "RALLY_TOKEN_REQUIRED" });
  }

  const decoded = decodeToken(body.rallyToken);
  if (!decoded.ok) {
    return sendJson(res, 400, { ok: false, error: decoded.error });
  }

  const state = decoded.state;
  const { scanId, scanStartedAtUtc, universeHash, activeMarkets,
    batchSize, batchesTotal, batchesCompleted, nextBatchIndex,
    eligibleTickers, topCandidates, actualProviderCalls } = state;

  if (nextBatchIndex === null || batchesCompleted >= batchesTotal) {
    return sendJson(res, 400, { ok: false, error: "SCAN_ALREADY_COMPLETE" });
  }

  // Rebuild eligible assets minimal objects from tickers
  const eligibleAssets = eligibleTickers.map(ticker => ({
    providerSymbol: ticker,
    ticker: ticker.split(".")[0],
    name: ticker.split(".")[0],
    market: ticker.includes(".US") ? "Nasdaq/NYSE" : "Europe",
    region: ticker.includes(".US") ? "USA" : "Europe",
    exchange: ticker.split(".").slice(1).join("."),
    currency: ticker.includes(".US") ? "USD" : "EUR",
  }));

  const spyBars = await fetchSpyBars();

  const { candidates, providerCalls: newCalls } = await runRallyBatch({
    eligibleAssets,
    batchIndex: nextBatchIndex,
    batchSize,
    existingCandidates: topCandidates ?? [],
    spyBars,
  });

  const newBatchesCompleted = batchesCompleted + 1;
  const newCoveragePercent = Math.round((newBatchesCompleted / batchesTotal) * 100);
  const isComplete = newBatchesCompleted >= batchesTotal;
  const totalCalls = (actualProviderCalls ?? 0) + newCalls;

  const top10 = candidates.map((c, i) => ({ ...c, rank: i + 1, scanId }));

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
      universeCount: eligibleTickers.length,
      actualProviderCalls: totalCalls,
    });
  }

  const newToken = isComplete ? null : encodeToken({
    scanId, scanStartedAtUtc, universeHash, activeMarkets,
    batchSize, batchesTotal,
    batchesCompleted: newBatchesCompleted,
    nextBatchIndex: isComplete ? null : nextBatchIndex + 1,
    coveragePercent: newCoveragePercent,
    eligibleTickers,
    topCandidates: top10,
    actualProviderCalls: totalCalls,
    spyBarsLength: spyBars.length,
  });

  return sendJson(res, isComplete ? 200 : 206, {
    ok: isComplete,
    mode: "RALLY_LEADERS_SCAN",
    status: isComplete ? "RALLY_FINAL" : "RALLY_SCANNING",
    scanId,
    scanStartedAtUtc,
    scanCompletedAtUtc: isComplete ? new Date().toISOString() : null,
    universeHash,
    activeMarkets,
    universeCount: eligibleTickers.length,
    batchesTotal,
    batchesCompleted: newBatchesCompleted,
    nextBatchIndex: isComplete ? null : nextBatchIndex + 1,
    coveragePercent: newCoveragePercent,
    actualProviderCalls: totalCalls,
    isRallyFinal: isComplete,
    rallyToken: newToken,
    top10,
    message: isComplete
      ? "Rally Leaders final — 100% coverage reached."
      : `Rally scan partial — batch ${newBatchesCompleted}/${batchesTotal} complete.`,
  });
}
