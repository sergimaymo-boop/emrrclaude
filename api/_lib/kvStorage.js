import { Redis } from "@upstash/redis";

const KV_KEY = "last_scan_snapshot";
const KV_RALLY_KEY = "last_rally_snapshot";
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
  } catch (e) {
    console.error("[kvStorage] write failed:", e?.message ?? e);
    return false;
  }
}

export async function loadLastScanSnapshot() {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const data = await redis.get(KV_KEY);
    return data ?? null;
  } catch (e) {
    console.error("[kvStorage] read failed:", e?.message ?? e);
    return null;
  }
}

// ─── Rally Leaders Engine persistence ────────────────────────────────────────

export async function saveLastRallySnapshot(snapshot) {
  try {
    const redis = getRedis();
    if (!redis) return false;
    await redis.set(KV_RALLY_KEY, snapshot, { ex: KV_TTL_SECONDS });
    return true;
  } catch (e) {
    console.error("[kvStorage] write failed:", e?.message ?? e);
    return false;
  }
}

export async function loadLastRallySnapshot() {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const data = await redis.get(KV_RALLY_KEY);
    return data ?? null;
  } catch (e) {
    console.error("[kvStorage] read failed:", e?.message ?? e);
    return null;
  }
}

// ─── SPY Benchmark cache (4h TTL) — ensures RS is always calculable ───────────
const KV_SPY_KEY = "benchmark_spy_bars";
const KV_SPY_TTL_SECONDS = 72 * 60 * 60; // 72h — el cierre diario del SPY sigue válido días para EMA200/régimen (evita re-fetch bajo rate-limit)

export async function saveBenchmarkBars(bars) {
  try {
    const redis = getRedis();
    if (!redis) return false;
    await redis.set(KV_SPY_KEY, { bars, cachedAtUtc: new Date().toISOString() }, { ex: KV_SPY_TTL_SECONDS });
    return true;
  } catch (e) {
    console.error("[kvStorage] write failed:", e?.message ?? e);
    return false;
  }
}

export async function loadBenchmarkBars() {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const data = await redis.get(KV_SPY_KEY);
    if (!data || !Array.isArray(data.bars) || data.bars.length < 61) return null;
    return data.bars;
  } catch (e) {
    console.error("[kvStorage] read failed:", e?.message ?? e);
    return null;
  }
}

// ─── Generic KV helpers (monetary cycle, EPS cache, etc.) ───────────────────

export async function kvGet(key) {
  try {
    const redis = getRedis();
    if (!redis) return null;
    return await redis.get(key);
  } catch (e) {
    console.error("[kvStorage] read failed:", e?.message ?? e);
    return null;
  }
}

export async function kvSet(key, value, exSeconds) {
  try {
    const redis = getRedis();
    if (!redis) return false;
    await redis.set(key, value, { ex: exSeconds });
    return true;
  } catch (e) {
    console.error("[kvStorage] write failed:", e?.message ?? e);
    return false;
  }
}
