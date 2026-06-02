import { Redis } from "@upstash/redis";

const KV_KEY = "last_scan_snapshot";
const KV_TTL_SECONDS = 7 * 24 * 60 * 60;

// Singleton — create client once per cold start, not on every call
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export async function saveLastScanSnapshot(snapshot) {
  try {
    const redis = getRedis();
    if (!redis) return false;
    await redis.set(KV_KEY, snapshot, { ex: KV_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}

export async function loadLastScanSnapshot() {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const data = await redis.get(KV_KEY);
    return data ?? null;
  } catch {
    return null;
  }
}
