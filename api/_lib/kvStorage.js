const KV_KEY = "last_scan_snapshot";
const KV_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function saveLastScanSnapshot(snapshot) {
  try {
    const { kv } = await import("@vercel/kv");
    await kv.set(KV_KEY, snapshot, { ex: KV_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}

export async function loadLastScanSnapshot() {
  try {
    const { kv } = await import("@vercel/kv");
    const data = await kv.get(KV_KEY);
    return data ?? null;
  } catch {
    return null;
  }
}
