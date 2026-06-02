import { loadLastScanSnapshot } from "../_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "SCAN_SNAPSHOT_LAST";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const snapshot = await loadLastScanSnapshot();

  if (!snapshot) {
    return response.status(404).json({
      ok: false,
      app: APP_NAME,
      endpoint: ENDPOINT,
      error: "NO_STORED_SNAPSHOT",
      message: "No completed scan snapshot found. Run SCAN FULL during market hours first.",
      timestampUtc: new Date().toISOString(),
    });
  }

  return response.status(200).json({
    ...snapshot,
    app: APP_NAME,
    endpoint: ENDPOINT,
    source: "LAST_SESSION_CACHE",
    retrievedAtUtc: new Date().toISOString(),
  });
}
