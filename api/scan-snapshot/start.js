import { buildUniverseResponse } from "../universe.js";
import { attachSnapshotToken, buildSnapshotPlan, processNextSnapshotBatch } from "../_lib/scanSnapshot.js";
import { saveLastScanSnapshot } from "../_lib/kvStorage.js";

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

  const payload = {
    ok: responseState.isGlobalTop8Final,
    mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
    ...responseState,
    assets: responseState.topCandidates,
    message: responseState.isGlobalTop8Final
      ? "Global TOP 8 final is available because coveragePercent reached 100%."
      : "SCAN FULL created a real snapshot but remains partial or unavailable until coveragePercent reaches 100%.",
  };

  if (responseState.isGlobalTop8Final) {
    await saveLastScanSnapshot(payload);
  }

  return sendJson(response, statusCode, payload);
}
