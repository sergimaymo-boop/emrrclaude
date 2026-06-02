# EMRR — Institutional Trend Dashboard
## Master System Specification · Claude Operating Document

> This file is the single source of truth for all development decisions.
> Read it entirely before making any change. Never contradict it.

---

## 0. PRIME DIRECTIVES

1. **Functionality is sacred.** Never break what works. A visual improvement is not worth a broken scan.
2. **Build must pass before every commit.** Run `npx vite build` and verify zero errors.
3. **When in doubt, do not change.** Propose first, implement after confirmation.
4. **Update ALL affected files together.** CSS + components + pages + API in one coherent pass.
5. **No mock data in production, ever.** `ENABLE_REAL_API_CALLS=true` is the hard gate.

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| Name | Emrrclaude |
| Purpose | Real-time global market scanner → scores → ranks → TOP 8 institutional assets |
| Live URL | https://emrrclaude.vercel.app |
| GitHub | https://github.com/sergimaymo-boop/emrrclaude |
| Stack | React 19 + TypeScript + Vite → Vercel Serverless |
| Primary data | EODHD API |
| Secondary data | Finnhub API |
| Persistence | Upstash Redis (Vercel integration) |
| Design | Dark navy dashboard, Bloomberg-inspired, optimised for iPhone 16 Pro Max |
| Auth | None — public access, no password |

---

## 2. FULL ARCHITECTURE

```
BROWSER (iPhone / Desktop)
│
├── src/App.tsx
│   ├── LoginPage.tsx          ← splash screen, no auth
│   └── DashboardPage.tsx      ← ALL state lives here
│       ├── StickyMiniHeader   ← sticky: clock, markets, SCAN FULL
│       ├── TechnicalHeader    ← brand + data mode indicator
│       ├── MasterIndicatorsGrid ← SPY/VIX/VVIX/HYG/LQD/TNX/MOVE
│       ├── Top8Grid           ← ranked assets with full scoring data
│       ├── SectorLeaders      ← sector momentum ranking
│       ├── FearGreedPanel     ← sentiment (source pending)
│       ├── ScanStatusPanel    ← coverage bar + batch metadata
│       ├── ActionButtons      ← Compartir TOP 8 + Continue scan
│       └── SystemStatusCards  ← technical debug (bottom)
│
├── services/realDataRefresh.ts ← ALL fetch calls, ALL response types
├── utils/
│   ├── operationalDataPolicy.ts  ← single source of operational logic
│   ├── marketHours.ts            ← isMarketOpen() per exchange
│   ├── export.ts                 ← formatTop8ForExport + shareTop8 (Web Share API)
│   └── systemStatus.ts           ← refreshSystemMarketStatus
├── shared/types/domain.ts     ← ALL TypeScript contracts
└── styles.css                 ← ALL visual styles (navy palette)

VERCEL SERVERLESS FUNCTIONS  (api/)
│
├── GET  /api/master-indicators      → EODHD real-time: SPY LQD HYG VIX VVIX TNX MOVE
├── GET  /api/universe               → EODHD exchange-symbol-list → filtered universe
├── POST /api/scan-snapshot/start    → batch 1: universe → eligibility → score → TOP 8
├── POST /api/scan-snapshot/continue → batches 2..N via snapshotToken
├── POST /api/scan-snapshot/finalize → validate 100% → save Redis → return GLOBAL_TOP8_FINAL
├── GET  /api/scan-snapshot/last     → load last completed scan from Redis
├── POST /api/visible-top8-quotes    → live prices for scanned TOP 8 tickers
└── GET  /api/health                 → system health check

EXTERNAL SERVICES
├── EODHD    → exchange lists + real-time quotes (primary)
├── Finnhub  → real-time quotes (secondary / fallback)
└── Upstash Redis → scan persistence (7-day TTL)
```

---

## 3. COMPLETE DATA FLOW

### 3.1 On page load (every session)
```
DashboardPage mounts
  │
  ├─ 1. loadSessionCache() → localStorage
  │      If indicators cached → show with LAST_SESSION tag
  │      If top8 cached (coverage=100) → show immediately
  │      If partial scan token → restore scan state
  │
  ├─ 2. fetchMasterIndicators() → GET /api/master-indicators
  │      → EODHD real-time prices (works regardless of market hours)
  │      → SPY LQD HYG VIX VVIX TNX MOVE with color-coded intervals
  │      → saveSessionCache() → localStorage
  │
  └─ 3. fetchLastScanSnapshot() → GET /api/scan-snapshot/last
         → Redis → last completed scan (if any)
         → If found: populate TOP 8 with LAST_SESSION label
         → If not found: show empty TOP 8 state
```

### 3.2 SCAN FULL lifecycle (markets must be OPEN)
```
User presses SCAN FULL
  │
  POST /api/scan-snapshot/start
    │
    ├─ buildUniverseResponse()
    │    └─ EODHD exchange-symbol-list (US + EU exchanges)
    │    └─ isEligibleForUniverse() → filters: market cap, liquidity, spread
    │    └─ Returns: { ok, assets[], summary }
    │    └─ If ok=false → HTTP 409 (markets closed or API error)
    │
    ├─ buildSnapshotPlan()
    │    └─ Sorts assets by priority score
    │    └─ Creates batches of 100 assets
    │    └─ Signs HMAC snapshot token
    │
    ├─ processNextSnapshotBatch()
    │    └─ For each asset in batch:
    │         ├─ fetchHistoricalData() → EODHD (20+ bars)
    │         ├─ runTechnicalEngine() → EMA20 EMA50 RS RVOL ATR Momentum
    │         ├─ runEligibilityEngine() → spread, liquidity, market status
    │         ├─ runScoreEngine() → composite 0-100 score
    │         └─ runCandidateEvaluationEngine() → action + conviction
    │
    └─ Returns: { ok, coveragePercent, snapshotToken, topCandidates, batchesCompleted }

  If coveragePercent < 100:
    Frontend calls POST /api/scan-snapshot/continue (snapshotToken)
    → Repeat until coveragePercent === 100

  When coveragePercent === 100:
    Frontend calls POST /api/scan-snapshot/finalize (snapshotToken)
    ├─ Validates isGlobalTop8Final === true
    ├─ saveLastScanSnapshot() → Upstash Redis (7-day TTL)
    └─ Returns final TOP 8 with GLOBAL_TOP8_FINAL scope

  Frontend merges:
    ├─ buildDashboardTop8FromScanSnapshot() → Top8Asset[]
    └─ POST /api/visible-top8-quotes → live prices for each ticker
```

### 3.3 HTTP status contract
| Code | Meaning | Frontend action |
|---|---|---|
| 200 | Complete success | Use data |
| 206 | Partial scan batch | Continue scanning |
| 409 | Blocked (closed market, no universe) | Show reason, do not retry automatically |
| 405 | Wrong HTTP method | Code bug — fix immediately |
| 400 | Bad request / invalid token | Code bug — fix immediately |
| 500 | Unhandled server error | Show error toast, allow retry |

---

## 4. STATE MACHINE

### 4.1 DataMode (dashboard-level)
```
         ┌──────────────────┐
         │  DATA_UNAVAILABLE│ ← initial state, no scan, no Redis
         └────────┬─────────┘
                  │ SCAN FULL pressed
         ┌────────▼─────────┐
         │    SCANNING      │ ← scan in progress
         └────────┬─────────┘
          ┌───────┴────────┐
          │                │
  ┌───────▼──────┐  ┌──────▼──────────┐
  │ PARTIAL_DATA │  │      REAL       │ ← coveragePercent=100
  └───────┬──────┘  └──────┬──────────┘
          │ continue        │ markets close
          └────────┐        │
                   │  ┌─────▼─────────┐
                   │  │  LAST_CLOSE   │ ← stale real data
                   │  └───────────────┘
                   │
         ┌─────────▼────────┐
         │  LAST_SESSION    │ ← loaded from Redis on next session
         └──────────────────┘
```

### 4.2 OperationalDataStatus (per-asset)
```
REAL           → all 9 scoreInputIntegrity = "REAL" + market OPEN
LAST_CLOSE     → real data but market now CLOSED
DATA_UNAVAILABLE → missing score inputs or no price data
ERROR          → API failure
```

### 4.3 Action (per-asset)
```
EXEC           → operationalDecisionAllowed=true + market OPEN
WATCH          → good score but market CLOSED or data incomplete
BLOCKED        → scoreInputIntegrity has ERROR inputs
CLOSED_CONTEXT → was EXEC but market just closed
```

---

## 5. SCORING ENGINE (9 inputs, all must be REAL)

| # | Input | Calculation | Interval |
|---|---|---|---|
| 1 | EMA20 | Price / EMA(20) - 1 | Trend proximity |
| 2 | EMA50 | Price / EMA(50) - 1 | Trend direction |
| 3 | RS | Asset return / SPY return (60d) | Relative strength |
| 4 | Momentum | (Price - Price[20]) / Price[20] | Price momentum |
| 5 | Continuity | EMA20 slope % | Trend quality |
| 6 | RVOL | Volume / AvgVolume(20) | Relative volume |
| 7 | Liquidity | AvgDailyValue(20) in USD | Minimum threshold |
| 8 | Spread | (Ask - Bid) / Mid | Execution cost |
| 9 | ATR | ATR(14) / Price | Volatility / risk |

**Final score:** weighted composite 0–100  
**Conviction:** secondary scoring for position sizing context  
**operationalDecisionAllowed = true** only when all 9 = "REAL"

---

## 6. COLOR INTERVALS (data-driven, never arbitrary)

### Master Indicators
| Indicator | Green (low risk) | Yellow (caution) | Red (high risk) |
|---|---|---|---|
| VIX | < 15 | 15 – 20 | > 20 |
| VVIX | < 80 | 80 – 110 | > 110 |
| MOVE | < 80 | 80 – 100 | > 100 |
| TNX | < 3.5% | 3.5 – 4.5% | > 4.5% |
| SPY / HYG / LQD | change > +0.05% | ±0.05% | change < -0.05% |

### Scan / Coverage
| Value | Color |
|---|---|
| 100% | Green — GLOBAL_TOP8_FINAL |
| 50–99% | Amber — PARTIAL_DATA |
| < 50% | Red — insufficient coverage |

### Score
| Value | Color |
|---|---|
| > 70 | Green — strong candidate |
| 40–70 | Amber — moderate |
| < 40 | Red — weak |

---

## 7. ENVIRONMENT VARIABLES

All 6 must be set in Vercel → Settings → Environment Variables:

```
ENABLE_REAL_API_CALLS = true          # Master gate. false = nothing works.
EODHD_API_KEY         = <real key>    # Primary provider
FINNHUB_API_KEY       = <real key>    # Secondary provider
VITE_APP_ENV          = production    # Frontend flag
KV_REST_API_URL       = <upstash>     # Auto-set by Vercel Upstash integration
KV_REST_API_TOKEN     = <upstash>     # Auto-set by Vercel Upstash integration
```

**Rule:** Never commit real keys. `.env.example` contains placeholders only.

---

## 8. FILE MAP & SINGLE RESPONSIBILITIES

### Frontend — src/

| File | Single Responsibility | Touch when |
|---|---|---|
| `pages/DashboardPage.tsx` | ALL state, ALL useEffect, ALL handlers | Adding features, fixing state bugs |
| `services/realDataRefresh.ts` | Every API fetch + response types | Adding/changing API calls |
| `components/StickyMiniHeader.tsx` | Sticky bar: clock + markets + SCAN FULL | Changing header layout |
| `components/TechnicalHeader.tsx` | Brand bar: EMRR + data mode dot + stats | Changing brand display |
| `components/MasterIndicatorsGrid.tsx` | 7 indicator cards with color intervals + mini charts | Changing indicator display |
| `components/ScanStatusPanel.tsx` | Coverage progress bar + scan metadata | Changing scan status display |
| `components/SystemStatusCards.tsx` | 6-card technical summary | Changing system status display |
| `components/Top8Grid.tsx` | TOP 8 ranked asset cards | Changing asset card layout |
| `components/ActionButtons.tsx` | Share TOP 8 (iOS) + Continue scan | Changing action buttons |
| `utils/export.ts` | formatTop8ForExport + shareTop8 | Changing export format |
| `utils/operationalDataPolicy.ts` | deriveOperationalDataPolicy — SINGLE SOURCE OF TRUTH | Only if policy logic changes |
| `utils/marketHours.ts` | isMarketOpen(exchange) | Only if market hours change |
| `styles.css` | ALL visual styles — navy palette | All visual changes |
| `shared/types/domain.ts` | ALL TypeScript contracts | Adding/changing data shapes |

### API — api/

| File | Single Responsibility |
|---|---|
| `universe.js` | EODHD exchange-symbol-list → filter → universe |
| `master-indicators.js` | Real-time quotes: SPY LQD HYG VIX VVIX TNX MOVE |
| `scan-snapshot/start.js` | Universe → plan → batch 1 → score → partial TOP 8 |
| `scan-snapshot/continue.js` | Next batch via snapshotToken |
| `scan-snapshot/finalize.js` | Validate 100% → save Redis → GLOBAL_TOP8_FINAL |
| `scan-snapshot/last.js` | GET last completed scan from Redis |
| `visible-top8-quotes.js` | Live prices for TOP 8 post-scan |
| `_lib/scanSnapshot.js` | Batch planning, HMAC tokens, pipeline orchestration |
| `_lib/kvStorage.js` | Redis singleton: save/load scan snapshot |
| `_lib/scoreEngine.js` | Composite score 0–100 |
| `_lib/technicalEngine.js` | EMA, RS, RVOL, ATR, Momentum |
| `_lib/eligibilityEngine.js` | Asset eligibility + execution block rules |
| `_lib/operabilityEngine.js` | Market-open operability per exchange |
| `_lib/candidateEvaluationEngine.js` | Action + conviction per asset |
| `_lib/top8Pipeline.js` | Controlled pipeline execution |
| `_lib/top8BatchPlanner.js` | Batch sizing + prioritisation |

---

## 9. CODING STANDARDS

### TypeScript (frontend + shared)
```
✅ All types in shared/types/domain.ts — never duplicate
✅ Explicit return types on all exported functions
✅ No `any` — use `unknown` + type guard if needed
✅ operationalDataPolicy.ts is the ONLY place that decides operational status
✅ No API calls inside components — always via services/realDataRefresh.ts
✅ Static styles in styles.css — inline styles only for dynamic values
```

### JavaScript (api/)
```
✅ Every endpoint returns { ok: boolean, app, endpoint, timestampUtc }
✅ Every provider call has AbortController with 8000ms timeout
✅ ENABLE_REAL_API_CALLS=true must be checked at function entry
✅ No dynamic import() — use static imports at file top
✅ Redis client as module singleton (not recreated per call)
✅ Batch max provider calls: 150 (safely within Vercel 10s timeout)
```

### Git & Deploy
```
✅ npx vite build → zero errors → then commit
✅ Every commit touches ALL files affected by the change
✅ main branch → Vercel auto-deploys
✅ Commit messages: "feat:", "fix:", "style:", "docs:"
✅ Never force push
```

---

## 10. DASHBOARD SECTION ORDER

Order is intentional. Most valuable real data first, technical debug last.

| # | Component | Data source | Always visible |
|---|---|---|---|
| 1 | `StickyMiniHeader` | systemStatus | ✅ sticky |
| 2 | `TechnicalHeader` | systemStatus | ✅ |
| 3 | `MasterIndicatorsGrid` | EODHD real-time | ✅ loads on mount |
| 4 | `Top8Grid` | scan + live quotes | when scan complete |
| 5 | `SectorLeaders` | scan derived | when scan complete |
| 6 | `FearGreedPanel` | Finnhub (pending) | ✅ shows unavailable |
| 7 | `ScanStatusPanel` | scanState | ✅ |
| 8 | `ActionButtons` | — | ✅ |
| 9 | `SystemStatusCards` | systemStatus | ✅ bottom |

---

## 11. OPERATIONAL INVARIANTS (never violate)

These are absolute rules. No exception, no workaround:

```
INV-01  GLOBAL_TOP8_FINAL ← only when coveragePercent === 100
INV-02  operationalDecisionAllowed ← only when all 9 scoreInputIntegrity = "REAL"
INV-03  Redis save ← only after finalize() confirms GLOBAL_TOP8_FINAL
INV-04  No mock data in production ← ENABLE_REAL_API_CALLS=true is the gate
INV-05  HTTP 409 when markets closed ← correct behavior, not a bug
INV-06  snapshotToken ← HMAC-signed, never forge or skip validation
INV-07  Never mix REAL + PARTIAL in same TOP 8 response
INV-08  Build must pass ← never push a broken build
INV-09  All 6 env vars must be set ← app silently degrades without them
INV-10  Batch provider calls ≤ 150 ← stay within 10s Vercel timeout
```

---

## 12. VERCEL CONSTRAINTS (Hobby plan)

| Constraint | Value | Impact |
|---|---|---|
| Function timeout | 10 seconds | Batch calls capped at 150 |
| Function size | 50 MB | No heavy npm packages |
| Bandwidth | 100 GB/month | Not a concern |
| Deployments | Unlimited | Auto on every push to main |
| Redis (Upstash free) | 500k commands/month | ~1000 scans/month safe |

**If timeout is hit:** snapshotToken allows seamless continuation. Frontend retries automatically.

---

## 13. MARKET HOURS

> User is in **Canary Islands (WET = UTC+0 winter, UTC+1 summer)** — always use Canary Islands time.

| Market | Exchanges | Open (CET) | Close (CET) | Open (Canarias) | Close (Canarias) |
|---|---|---|---|---|---|
| Europe | XETRA, EPA, AMS, BME | 08:00 | 17:30 | **07:00** | **16:30** |
| US | NYSE, NASDAQ | 14:30 | 21:00 | **13:30** | **20:00** |
| Both open | — | 14:30 | 17:30 | **13:30** | **16:30** |

**Morning scan (before 13:30 Canarias):** only European tickers (XETRA, Euronext, BME)  
**Afternoon scan (13:30–16:30 Canarias):** both EU + US — maximum universe, best coverage  
**Master Indicators:** work any time (EODHD returns last-close outside market hours)

---

## 14. PERSISTENCE SCHEMA

### Upstash Redis
```
Key:    "last_scan_snapshot"
Type:   JSON object (ScanSnapshotResponse)
TTL:    604800 seconds (7 days)
Write:  POST /api/scan-snapshot/finalize → isGlobalTop8Final === true
Read:   GET /api/scan-snapshot/last → on every dashboard load
Client: Redis singleton in api/_lib/kvStorage.js
```

### Browser localStorage
```
Key: "emrr_session_cache"
  → masterIndicators: MasterIndicator[] + timestamp + dataMode
  → top8Result: Top8Asset[] + scanState (if coverage=100)
  → sessionTimestamp: ISO string

Key: "emrr_scan_state"
  → Partial<ScanState> (scanId, snapshotToken, coveragePercent, batches)
  → Deleted when coverage reaches 100 or scan resets
```

---

## 15. ERROR HANDLING PATTERNS

### API endpoints
```javascript
// Pattern for every endpoint handler:
try {
  // work
  return sendJson(response, 200, { ok: true, ...data });
} catch (error) {
  return sendJson(response, 500, { ok: false, error: "INTERNAL_ERROR" });
}
```

### Frontend fetch calls
```typescript
// Pattern in services/realDataRefresh.ts:
// 1. AbortController with 8000ms timeout
// 2. Throw on !response.ok (triggers catch in DashboardPage)
// 3. DashboardPage .catch() shows toast + sets ERROR state

// Silent catch ONLY for non-critical background loads:
fetchLastScanSnapshot().catch(() => showToast("Sin datos de sesión anterior", "info"));
```

### Provider calls (EODHD / Finnhub)
```javascript
// Pattern in api/_lib/ providers:
// 1. AbortController 8000ms
// 2. Return { ok: false, reason: string } on failure — never throw
// 3. Caller checks ok before using data
// 4. Provider failure = DATA_UNAVAILABLE, not ERROR
```

---

## 16. VISUAL DESIGN SYSTEM

```
Background:    #0f0f1a   (deep navy)
Panel:         #16162a   (card background)
Card:          #1c1c32   (inner cards)
Elevated:      #222240   (modals / elevated)

Gold accent:   #f59e0b   (primary actions, highlights)
Gold soft:     #fbbf24   (hover states)
Green:         #10b981   (positive, operational)
Red:           #ef4444   (negative, error)
Amber:         #eab308   (warning, partial)

Text primary:  #f0ece0
Text muted:    #9ca3af
Text dim:      #6b7280
Text very dim: #4b5563

Border:        rgba(255,255,255,0.06)
Border gold:   rgba(245,158,11,0.25)

Radius large:  12px   (section blocks)
Radius medium: 10px   (cards)
Radius small:  6px    (buttons, badges)
Radius pill:   999px  (market pills)
```

### Grid breakpoints
| Width | Status grid | Indicator grid |
|---|---|---|
| ≤ 460px (iPhone) | 2 cols | 2 cols |
| 461–979px (tablet) | 3 cols | 4 cols |
| ≥ 980px (desktop) | 3 cols | 7 cols |

### Touch targets (iOS requirement)
- Minimum height: 48px for all interactive elements
- `touch-action: manipulation` on all buttons (removes 300ms delay)
- `-webkit-tap-highlight-color: transparent` on all buttons

---

## 17. WHAT CLAUDE MUST NEVER DO

```
❌ Push code without running npx vite build first
❌ Change api/_lib/scanSnapshot.js token logic without full understanding
❌ Remove the HMAC signature from snapshot tokens
❌ Allow mock data to reach production
❌ Promote a partial scan (coveragePercent < 100) to GLOBAL_TOP8_FINAL
❌ Add setTimeout/setInterval without a corresponding clearTimeout/clearInterval
❌ Use console.log in production code
❌ Add new npm packages without checking bundle impact
❌ Change shared/types/domain.ts without updating all consumers
❌ Partial file updates — always update all affected files together
❌ Break the { ok, app, endpoint, timestampUtc } API response envelope
```

---

## 18. WHAT CLAUDE MUST ALWAYS DO

```
✅ Read CLAUDE.md at the start of every session
✅ Run npx vite build before every commit
✅ Update ALL affected files in one pass (CSS + components + API)
✅ Verify the change doesn't break existing functionality
✅ Keep the section order in DashboardPage (Master Indicators first)
✅ Use operationalDataPolicy.ts as the single authority for operational status
✅ Keep all API calls in services/realDataRefresh.ts
✅ Keep all types in shared/types/domain.ts
✅ Surface errors to the user via showToast — never swallow silently
✅ Test the golden path mentally: load → indicators → scan → TOP 8 → share
```

---

## 19. GOLDEN PATH (manual test checklist)

Run this mental checklist before every deploy:

```
□ Page loads → MasterIndicators show real EODHD prices
□ SCAN FULL button visible in sticky header
□ With markets closed → scan shows reason, does not crash
□ With markets open → scan starts, shows progress bar
□ Coverage bar advances as batches complete
□ At 100% coverage → TOP 8 appears with scores
□ Compartir TOP 8 → iOS share sheet opens
□ Reload page → MasterIndicators persist from localStorage
□ If previous scan exists → TOP 8 loads from Redis
□ Logout → returns to splash screen
```
