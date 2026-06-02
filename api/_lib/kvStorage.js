const KV_KEY = "last_scan_snapshot";
const KV_TTL_SECONDS = 7 * 24 * 60 * 60;

function getRedisClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export async function saveLastScanSnapshot(snapshot) {
  try {
    const config = getRedisClient();
    if (!config) return false;
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis(config);
    await redis.set(KV_KEY, snapshot, { ex: KV_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}

export async function loadLastScanSnapshot() {
  try {
    const config = getRedisClient();
    if (!config) return null;
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis(config);
    const data = await redis.get(KV_KEY);
    return data ?? null;
  } catch {
    return null;
  }
}
