import { decodeScanSnapshotToken, finalizeScanSnapshot } from "../_lib/scanSnapshot.js";
import { saveLastScanSnapshot } from "../_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "SCAN_SNAPSHOT_FINALIZE";

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
  const decoded = decodeScanSnapshotToken(body.snapshotToken);
  if (!decoded.ok) {
    return sendJson(response, 400, {
      ok: false,
      status: "ERROR",
      error: decoded.error,
      blockedReasons: [decoded.error],
      assets: [],
    });
  }

  const state = finalizeScanSnapshot(decoded.state);
  if (!state.isGlobalTop8Final || state.coveragePercent < 100) {
    return sendJson(response, 409, {
      ok: false,
      mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
      ...state,
      assets: [],
      error: "SCAN_SNAPSHOT_NOT_COMPLETE",
      blockedReasons: ["COVERAGE_PERCENT_BELOW_100"],
      message: "GLOBAL_TOP8_FINAL is blocked until coveragePercent reaches 100%. Partial ranking is diagnostic only.",
    });
  }

  const payload = {
    ok: true,
    mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
    ...state,
    assets: state.topCandidates,
    message: "GLOBAL_TOP8_FINAL verified from a complete signed scan snapshot.",
  };

  await saveLastScanSnapshot(payload);

  return sendJson(response, 200, payload);
}
