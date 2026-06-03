/**
 * GET /api/rally-scan/last
 * Rally Leaders Engine — load last completed rally scan from Redis
 */
import { loadLastRallySnapshot } from "../_lib/kvStorage.js";

const APP_NAME = "EMRR 2.0 / Tendencias";
const ENDPOINT = "RALLY_SCAN_LAST";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED", app: APP_NAME, endpoint: ENDPOINT });
  }

  const snapshot = await loadLastRallySnapshot();

  if (!snapshot) {
    return res.status(404).json({
      ok: false,
      app: APP_NAME,
      endpoint: ENDPOINT,
      error: "NO_STORED_RALLY_SNAPSHOT",
      status: "RALLY_DATA_UNAVAILABLE",
      message: "No completed Rally scan found. Run SCAN RALLY during market hours first.",
      timestampUtc: new Date().toISOString(),
    });
  }

  return res.status(200).json({
    ...snapshot,
    app: APP_NAME,
    endpoint: ENDPOINT,
    source: "LAST_SESSION_CACHE",
    retrievedAtUtc: new Date().toISOString(),
  });
}
