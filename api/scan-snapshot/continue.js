import { buildUniverseResponse } from "../universe.js";
import { attachSnapshotToken, continueScanSnapshot, decodeScanSnapshotToken } from "../_lib/scanSnapshot.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "SCAN_SNAPSHOT_CONTINUE";

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

  const universe = await buildUniverseResponse({ includeFullAssets: true });
  if (!universe.ok) {
    return sendJson(response, 409, {
      ok: false,
      status: "DATA_UNAVAILABLE",
      resultScope: "DATA_UNAVAILABLE",
      isGlobalTop8Final: false,
      error: universe.error ?? "UNIVERSE_DISCOVERY_NOT_READY",
      blockedReasons: [universe.error ?? "UNIVERSE_DISCOVERY_NOT_READY"],
      assets: [],
    });
  }

  const processedState = await continueScanSnapshot({
    universe,
    tokenState: decoded.state,
    options: {
      maxProviderCallsPerInvocation: body.maxProviderCallsPerInvocation,
    },
  });
  const responseState = attachSnapshotToken(processedState);
  const statusCode = responseState.isGlobalTop8Final ? 200 : responseState.status === "ERROR" ? 409 : 206;

  return sendJson(response, statusCode, {
    ok: responseState.isGlobalTop8Final,
    mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT",
    ...responseState,
    assets: responseState.topCandidates,
    message: responseState.isGlobalTop8Final
      ? "Global TOP 8 final is available because coveragePercent reached 100%."
      : "Scan snapshot continued but remains partial until every eligible-universe batch is processed.",
  });
}
