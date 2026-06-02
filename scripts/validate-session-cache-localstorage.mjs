import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");

assert.match(dashboardSource, /SESSION_CACHE_STORAGE_KEY\s*=\s*"emrr_session_cache"/);
assert.match(dashboardSource, /SESSION_CACHE_TTL_MS\s*=\s*4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
assert.match(dashboardSource, /function loadSessionCache/);
assert.match(dashboardSource, /window\.localStorage\.getItem\(SESSION_CACHE_STORAGE_KEY\)/);
assert.match(dashboardSource, /window\.localStorage\.setItem\(\s*SESSION_CACHE_STORAGE_KEY/);
assert.match(dashboardSource, /clearSessionCacheForNewScan\(\)/);
assert.match(dashboardSource, /snapshotToken/);
assert.match(dashboardSource, /LAST_SESSION_CACHE_REQUIRES_REFRESH/);
assert.match(dashboardSource, /top8Result:/);

console.log("Session cache localStorage validation OK.");
