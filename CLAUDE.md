# EMRR — Institutional Trend Dashboard
## System Specification for Claude

---

## 1. PROJECT IDENTITY

**Name:** Emrrclaude  
**Purpose:** Real-time global market scanner that discovers, scores, and ranks institutional-grade assets. Produces a TOP 8 ranking based on technical momentum and operational eligibility.  
**URL:** https://emrrclaude.vercel.app  
**GitHub:** https://github.com/sergimaymo-boop/emrrclaude  
**Stack:** React 19 + TypeScript + Vite → Vercel (frontend + serverless API)  
**Data:** EODHD (primary), Finnhub (secondary)  
**Persistence:** Upstash Redis (last completed scan, 7-day TTL)

---

## 2. ARCHITECTURE MAP

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND  (src/)                                   │
│  React 19 · TypeScript · Vite                       │
│                                                     │
│  App.tsx → LoginPage / DashboardPage                │
│  DashboardPage orchestrates all state               │
│  services/realDataRefresh.ts → all API calls        │
│  shared/types/ → TypeScript contracts               │
└─────────────────┬───────────────────────────────────┘
                  │ fetch
┌─────────────────▼───────────────────────────────────┐
│  API LAYER  (api/)  — Vercel Serverless Functions   │
│                                                     │
│  GET  /api/master-indicators    SPY VIX VVIX etc    │
│  GET  /api/universe             Asset discovery     │
│  POST /api/scan-snapshot/start  Scan batch 1        │
│  POST /api/scan-snapshot/continue  Batches 2..N     │
│  POST /api/scan-snapshot/finalize  Mark complete    │
│  GET  /api/scan-snapshot/last   Load from Redis     │
│  GET  /api/visible-top8-quotes  Live prices TOP 8   │
│  GET  /api/health               System health       │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│  DATA PROVIDERS                                     │
│  EODHD   → Universe list, real-time quotes          │
│  Finnhub → Secondary quotes (fallback)              │
│  Upstash Redis → Scan persistence (KV)              │
└─────────────────────────────────────────────────────┘
```

---

## 3. SCAN LIFECYCLE (critical flow)

```
1. SCAN FULL pressed
   └─ POST /api/scan-snapshot/start
       ├─ buildUniverseResponse() → EODHD exchange lists
       ├─ Filter: eligibility, spread, liquidity, market OPEN
       ├─ buildSnapshotPlan() → batches of 100 assets
       ├─ processNextSnapshotBatch() → technical analysis + scoring
       └─ Returns: { ok, coveragePercent, snapshotToken, topCandidates }

2. If coveragePercent < 100 → frontend calls CONTINUE
   └─ POST /api/scan-snapshot/continue (snapshotToken)
       └─ Processes next batch, same structure

3. If coveragePercent === 100
   └─ POST /api/scan-snapshot/finalize (snapshotToken)
       ├─ Validates GLOBAL_TOP8_FINAL
       ├─ saveLastScanSnapshot() → Upstash Redis (7 days TTL)
       └─ Returns final TOP 8

4. On next load (markets closed)
   └─ GET /api/scan-snapshot/last
       └─ loadLastScanSnapshot() → Redis
```

**Key constraint:** Universe discovery only returns operable assets when markets are OPEN. Scan returns HTTP 409 when markets are closed — this is correct behavior, not an error.

---

## 4. DATA MODES (state machine)

| Mode | Meaning | Action |
|---|---|---|
| `DATA_UNAVAILABLE` | No scan, no Redis cache | Show empty state |
| `SCANNING` | Scan in progress | Show progress bar |
| `PARTIAL_DATA` | Scan < 100% coverage | Show partial results |
| `LAST_SESSION` | Loaded from Redis cache | Show with cache label |
| `REAL` | Live completed scan | Full operational display |
| `LAST_CLOSE` | Cached real data (stale) | Show with stale label |
| `ERROR` | API failure | Show error state |

**Rule:** Never mix modes in the same response. A response is either fully REAL or clearly labeled as LAST_SESSION/PARTIAL.

---

## 5. SCORING ENGINE

Each asset is scored 0–100 across 9 inputs. All must be REAL for operational status:

| Input | Source | Weight |
|---|---|---|
| EMA20 | Price vs 20-day EMA | Trend |
| EMA50 | Price vs 50-day EMA | Trend |
| RS | Relative Strength 60d | Momentum |
| Momentum | 20-day price momentum | Momentum |
| Continuity | EMA20 slope % | Trend quality |
| RVOL | Relative volume | Liquidity |
| Liquidity | Avg value 20d | Eligibility |
| Spread | Bid-ask spread check | Execution |
| ATR | Average True Range % | Risk |

**scoreInputIntegrity:** all 9 must be `"REAL"` for `operationalDecisionAllowed: true`.

---

## 6. COLOR INTERVALS (data-driven, never arbitrary)

| Indicator | Green | Yellow | Red |
|---|---|---|---|
| VIX | < 15 | 15–20 | > 20 |
| VVIX | < 80 | 80–110 | > 110 |
| MOVE | < 80 | 80–100 | > 100 |
| TNX | < 3.5% | 3.5–4.5% | > 4.5% |
| SPY/HYG/LQD | changePercent > 0 | ±0.05% | changePercent < 0 |
| Coverage % | 100% | 50–99% | < 50% |
| Score | > 70 | 40–70 | < 40 |

---

## 7. ENVIRONMENT VARIABLES (all required in Vercel)

```
ENABLE_REAL_API_CALLS=true        # Master gate for all API calls
EODHD_API_KEY=...                 # Primary data provider
FINNHUB_API_KEY=...               # Secondary data provider
VITE_APP_ENV=production           # Frontend env flag
KV_REST_API_URL=...               # Upstash Redis URL (auto-set by Vercel)
KV_REST_API_TOKEN=...             # Upstash Redis token (auto-set by Vercel)
```

**Never commit real keys.** `.env.example` has placeholders only.

---

## 8. FILE RESPONSIBILITIES

### Frontend (src/)
| File | Responsibility |
|---|---|
| `pages/DashboardPage.tsx` | Central state orchestration. All useEffect, all handlers. |
| `services/realDataRefresh.ts` | Every fetch call to the API. Types for all responses. |
| `components/StickyMiniHeader.tsx` | Sticky bar: time, market status, SCAN FULL button. |
| `components/TechnicalHeader.tsx` | Compact brand header with data mode dot. |
| `components/MasterIndicatorsGrid.tsx` | SPY/VIX/etc cards with interval color coding + mini charts. |
| `components/ScanStatusPanel.tsx` | Coverage progress bar + scan metadata. |
| `components/SystemStatusCards.tsx` | 6-card technical summary (bottom of page). |
| `components/Top8Grid.tsx` | TOP 8 asset cards with full ranking data. |
| `components/ActionButtons.tsx` | Share button (iOS share sheet) + Continue scan. |
| `utils/export.ts` | formatTop8ForExport() + shareTop8() (Web Share API). |
| `utils/operationalDataPolicy.ts` | Derives operational status from data mode + market status. |
| `utils/marketHours.ts` | isMarketOpen() for EU/US exchanges. |
| `styles.css` | All visual styles. Navy palette. No inline styles in components. |

### API (api/)
| File | Responsibility |
|---|---|
| `universe.js` | EODHD exchange-symbol-list → filtered universe. |
| `master-indicators.js` | Real-time quotes for SPY/LQD/HYG/VIX/VVIX/TNX/MOVE. |
| `scan-snapshot/start.js` | Initiates scan, processes batch 1. |
| `scan-snapshot/continue.js` | Processes subsequent batches via snapshotToken. |
| `scan-snapshot/finalize.js` | Validates 100% coverage, saves to Redis. |
| `scan-snapshot/last.js` | GET: loads last scan from Redis. |
| `visible-top8-quotes.js` | Live prices for TOP 8 tickers post-scan. |
| `_lib/scanSnapshot.js` | Batch planning, HMAC token, pipeline execution. |
| `_lib/kvStorage.js` | saveLastScanSnapshot() / loadLastScanSnapshot() via Upstash. |
| `_lib/scoreEngine.js` | Composite score calculation (0–100). |
| `_lib/technicalEngine.js` | EMA, RS, RVOL, ATR, Momentum calculations. |
| `_lib/eligibilityEngine.js` | Asset eligibility rules + execution blocks. |
| `_lib/operabilityEngine.js` | Market-open operability checks. |

### Shared (shared/types/)
| File | Responsibility |
|---|---|
| `domain.ts` | Top8Asset, ScanState, SystemStatus, MasterIndicator, etc. |
| `api.ts` | API response shapes. |

---

## 9. CODING STANDARDS

### TypeScript
- All shared contracts live in `shared/types/domain.ts` — never duplicate types
- `operationalDataPolicy.ts` is the single source of truth for operational decisions
- No `any` types in new code
- Prefer explicit return types on public functions

### API endpoints
- Every response includes `{ ok: boolean, app, endpoint, timestampUtc }`
- HTTP 409 = legitimate blocked state (not an error to fix)
- HTTP 200 = `ok: true` with complete data
- HTTP 206 = partial scan (batchesCompleted > 0 but < batchesTotal)
- Never return mock data when `ENABLE_REAL_API_CALLS=true`

### Frontend patterns
- Single `useEffect` for data loading on mount (already in DashboardPage)
- State flows down via props, events flow up via callbacks
- No direct API calls in components — always via `services/realDataRefresh.ts`
- Inline styles only in components that need dynamic values; everything static goes in `styles.css`

### Build contract
- `npx vite build` must pass with zero errors before every commit
- No unused imports (TypeScript strict)
- All git commits go to `main` → Vercel auto-deploys

---

## 10. DASHBOARD SECTION ORDER (top → bottom)

1. `StickyMiniHeader` — sticky: time, markets, SCAN FULL
2. `TechnicalHeader` — brand, data mode dot, stats
3. `MasterIndicatorsGrid` — real EODHD data, always visible
4. `Top8Grid` — main ranking output
5. `SectorLeaders` — sector momentum
6. `FearGreedPanel` — sentiment (unavailable until Finnhub source approved)
7. `ScanStatusPanel` — coverage bar + scan metadata
8. `ActionButtons` — Share TOP 8 + Continue Scan (if available)
9. `SystemStatusCards` — technical system info (least important, bottom)

**Rationale:** Most valuable real data (Master Indicators) first. Technical debug info last.

---

## 11. OPERATIONAL RULES (never break these)

1. **No mock data in production.** `ENABLE_REAL_API_CALLS=true` must be set.
2. **GLOBAL_TOP8_FINAL requires coveragePercent === 100.** Partial results are never promoted to global.
3. **Scan only works when markets are open.** 409 when closed is correct, not a bug.
4. **scoreInputIntegrity all-REAL required for operationalDecisionAllowed: true.**
5. **Redis saves only after finalize with 100% coverage.** Never save partial scans.
6. **Every API change must keep the { ok, app, endpoint, timestampUtc } envelope.**
7. **Build must pass before push.** Never push a broken build.

---

## 12. VERCEL CONSTRAINTS (Hobby plan)

- Function timeout: **10 seconds** per invocation
- Max function size: 50MB
- Scan batches are designed to fit within 10s (100 assets per batch, ~200 API calls max)
- If a batch times out, the snapshotToken allows the frontend to continue from where it stopped

---

## 13. MARKET HOURS (CET)

| Market | Open | Close |
|---|---|---|
| Europe (Xetra, Euronext) | 08:00 | 17:30 |
| US (NYSE, NASDAQ) | 14:30 | 21:00 |
| Both open | 14:30–17:30 | Optimal scan window |

**Best time to SCAN FULL:** 14:30–17:30 CET (both markets open, maximum universe).

---

## 14. UPSTASH REDIS SCHEMA

```
Key:   "last_scan_snapshot"
Value: Full ScanSnapshotResponse JSON object
TTL:   7 days (604800 seconds)
Set:   After finalize() with isGlobalTop8Final === true
Read:  GET /api/scan-snapshot/last on dashboard load
```
