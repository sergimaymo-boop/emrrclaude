import { buildUniverseResponse } from "../universe.js";
import { attachSnapshotToken, buildSnapshotPlan, processNextSnapshotBatch } from "../_lib/scanSnapshot.js";
import { saveLastScanSnapshot } from "../_lib/kvStorage.js";
import { fetchEodhdHistoricalBars } from "../_lib/historicalDataProvider.js";
import { calculateTechnicals } from "../_lib/technicalEngine.js";
import { calculateScore } from "../_lib/scoreEngine.js";
import { validateUniverseEligibility } from "../_lib/eligibilityEngine.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "SCAN_SNAPSHOT_START";
const ENGINE_VERSION = "2026-06-03-v8"; // force rebuild

function sendJson(response, statusCode, payload) {
  response.status(statusCode).json({
    ...payload,
    app: APP_NAME,
    endpoint: ENDPOINT,
    timestampUtc: new Date().toISOString(),
  });
}

async function readJsonBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return sendJson(response, 405, {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      allowedMethods: ["POST"],
    });
  }

  const queryKeys = Object.keys(request.query ?? {});
  if (queryKeys.length > 0) {
    return sendJson(response, 400, {
      ok: false,
      error: "QUERY_NOT_ALLOWED",
      receivedQueryKeys: queryKeys,
    });
  }

  const body = await readJsonBody(request);
  const scanStartedAtUtc = new Date().toISOString();
  const universe = await buildUniverseResponse({ includeFullAssets: true });

  if (!universe.ok) {
    return sendJson(response, 409, {
      ok: false,
      scanStartedAtUtc,
      scanCompletedAtUtc: new Date().toISOString(),
      status: "DATA_UNAVAILABLE",
      resultScope: "DATA_UNAVAILABLE",
      isGlobalTop8Final: false,
      coveragePercent: 0,
      error: universe.error ?? "UNIVERSE_DISCOVERY_NOT_READY",
      blockedReasons: [universe.error ?? "UNIVERSE_DISCOVERY_NOT_READY"],
      universeSummary: universe.summary,
      assets: [],
      message: "SCAN FULL cannot start without real universe metadata. No substitute data is used.",
    });
  }

  const { eligibleAssets, state } = buildSnapshotPlan(universe, scanStartedAtUtc, {
    batchSize: body.batchSize,
    maxProviderCallsPerInvocation: body.maxProviderCallsPerInvocation,
  });
  const processedState = await processNextSnapshotBatch({ state, eligibleAssets });
  const responseState = attachSnapshotToken(processedState);
  const statusCode = responseState.isGlobalTop8Final ? 200 : responseState.batchesCompleted > 0 ? 206 : 409;

  // DEBUG v10 — run SAP.XETRA through full pipeline and show exact result
  let debugV10 = { v: ENGINE_VERSION };
  try {
    const hist = await fetchEodhdHistoricalBars("SAP.XETRA");
    debugV10.histOk = hist.ok;
    debugV10.histBars = hist.ok ? hist.bars.length : 0;
    debugV10.histProvider = hist.provider;
    if (hist.ok && hist.bars.length > 0) {
      const tech = calculateTechnicals(hist.bars, []);
      debugV10.techOk = tech.ok;
      debugV10.techValidBars = tech.validBars;
      debugV10.technicals = tech.ok ? {
        ema20: tech.technicals?.ema20,
        ema50: tech.technicals?.ema50,
        rvol: tech.technicals?.rvol,
        atrPercent: tech.technicals?.atrPercent,
        momentum20: tech.technicals?.momentum20,
        avgValue20: tech.technicals?.avgValue20,
        rs60: tech.technicals?.rs60,
      } : null;
      if (tech.ok) {
        const elig = validateUniverseEligibility({ asset: { operabilityStatus: 'OPERABLE', region: 'Europe' }, technicalResult: tech, marketStatus: 'OPEN', dataQuality: 'GOOD' });
        debugV10.eligibleForScore = elig.eligibleForScore;
        debugV10.eligibilityBlocked = elig.blockedReasons;
        const score = calculateScore({ operabilityStatus: 'OPERABLE', marketStatus: 'OPEN', dataQuality: 'GOOD', eligibleForScore: elig.eligibleForScore, eligibilityBlockedReasons: elig.blockedReasons, technicals: tech.technicals });
        debugV10.score = score.score;
        debugV10.scoreBlocked = score.blockedReasons;
      }
    }
  } catch(e) { debugV10.error = e.message; }

  const allCandidates = responseState.topCandidates ?? [];
  const debugV9 = {
    v: ENGINE_VERSION,
    totalCandidates: allCandidates.length,
    sample: allCandidates.slice(0, 3).map(c => ({
      ticker: c.ticker, score: c.score, action: c.action,
      blockedReasons: c.blockedReasons
    }))
  };

  const payload = {
    ok: responseState.isGlobalTop8Final,
    mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
    ...responseState,
    assets: responseState.topCandidates,
    _debugV9: debugV9,
    _debugV10: debugV10,
    message: responseState.isGlobalTop8Final
      ? "Global TOP 8 final is available because coveragePercent reached 100%."
      : "SCAN FULL created a real snapshot but remains partial or unavailable until coveragePercent reaches 100%.",
  };

  if (responseState.isGlobalTop8Final) {
    await saveLastScanSnapshot(payload);
  }

  return sendJson(response, statusCode, payload);
}
