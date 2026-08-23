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
| Primary data | Yahoo Finance (histórico diario) · cascada Finnhub/Yahoo/Stooq para quotes (`api/_lib/providerCascade.js`) — EODHD CANCELADO jun-2026 |
| Universo | Estático (`api/_lib/staticUniverse.js`, ~603 tickers US+EU) — nunca filtrar por mercado abierto |
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

VERCEL SERVERLESS FUNCTIONS  (api/) — ⚠️ LÍMITE DURO: 12 funciones (plan Hobby). Ahora 11/12.
El 23-ago-2026 `api/universe.js` se MOVIÓ a `api/_lib/universeResponse.js`: no tenía
`export default` (como endpoint HTTP devolvía 500 y nadie lo llamaba), pero SÍ exporta
`buildUniverseResponse`, del que dependen scan-snapshot, rally-scan y market-breadth.
O sea: ocupaba un hueco de función sin dar servicio HTTP, siendo en realidad una librería.
⚠️ Un fichero en `api/` raíz cuenta como función AUNQUE nadie lo invoque por HTTP; los de
`api/_lib/` no. Antes de borrar un "endpoint muerto", comprobar SIEMPRE quién lo importa
(`grep "from ['\"]./fichero.js"`) — borrarlo habría tumbado los tres scans.
Queda UN hueco libre. Por defecto, toda API nueva se sigue añadiendo como action= dentro de
un handler existente + rewrite en vercel.json (/api/rally-scan/last → ?action=last).

├── scan-snapshot.js   → start/continue/last del SCAN FULL (action=)
├── rally-scan.js      → start/continue/last del Rally + ibk-portfolio GET/POST (snapshot cartera IBK)
├── market-data.js     → fear-greed / market-regime / monetary-cycle / master-indicators / optimal2026 / sp500 (source=)
├── market-breadth.js  → amplitud de mercado
├── visible-top8-quotes.js · sector-leaders-data.js · eps-batch.js
├── claude01-scan.js · fable01.js · fable5.js   → motores auxiliares
└── cron/market-pulse.js → cron Vercel (14:00 y 16:00 UTC L-V)

EXTERNAL SERVICES
├── Yahoo Finance → histórico diario ajustado (primario)
├── Finnhub / Stooq → quotes en cascada (providerCascade.js)
└── Upstash Redis → persistencia scans + cartera IBK (kvStorage.js; TTL 7d scans, 180d cartera)
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

### 3.2 SCAN FULL lifecycle (funciona con mercados abiertos o cerrados: el universo NUNCA se filtra por horario — con mercados cerrados puntúa sobre los últimos cierres asentados, que es el mejor momento para el scan oficial)
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

  When coveragePercent === 100 (dentro del propio start/continue que completa):
    ├─ isGlobalTop8Final = true (batchesCompleted === batchesTotal)
    ├─ saveLastScanSnapshot() → Upstash Redis (7-day TTL) — la escritura la hace
    │  el handler de start/continue al completar; NO existe endpoint finalize
    └─ Respuesta final con scope GLOBAL_TOP8_FINAL (token null, sin continuación)

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

Set in Vercel → Settings → Environment Variables:

```
ENABLE_REAL_API_CALLS = true          # Master gate. false = nothing works.
FINNHUB_API_KEY       = <real key>    # Primary provider (EODHD cancelled June 2026)
VITE_APP_ENV          = production    # Frontend flag
KV_REST_API_URL       = <upstash>     # Auto-set by Vercel Upstash integration
KV_REST_API_TOKEN     = <upstash>     # Auto-set by Vercel Upstash integration
```

**EODHD cancelled June 2026.** No longer needed. Static universe replaces exchange-symbol-list.
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
| `scan-snapshot.js` | SCAN FULL vía `?action=start/continue/last` (rewrites `/api/scan-snapshot/*`); al completar 100% guarda en Redis dentro del propio start/continue — NO existe `finalize` |
| `rally-scan.js` | Rally Leaders vía `?action=start/continue/last` + `?action=ibk-portfolio` GET/POST (snapshot cartera IBK) |
| `market-data.js` | Multiplexor vía `?source=fear-greed/market-regime/monetary-cycle/master-indicators/optimal2026/sp500` (rewrites `/api/master-indicators`, `/api/optimal2026`, `/api/sp500`, …) |
| `market-breadth.js` | Amplitud de mercado |
| `visible-top8-quotes.js` | Live prices for TOP 8 post-scan |
| `sector-leaders-data.js` | Ranking de momentum sectorial |
| `eps-batch.js` | EPS por lotes |
| `claude01-scan.js` · `fable01.js` · `fable5.js` | Motores auxiliares |
| `cron/market-pulse.js` | Cron Vercel (14:00 y 16:00 UTC L-V) |
| `_lib/universeResponse.js` | `buildUniverseResponse()` — universo filtrado que consumen scan-snapshot, rally-scan y market-breadth (era `api/universe.js`, movido 23-ago-2026 para liberar un hueco de función) |
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
✅ Commit messages: "feat:", "fix:", "style:", "docs:", "study:", "ux:", "audit:"
✅ Never force push
```

---

## 10. DASHBOARD SECTION ORDER

Orden DICTADO por Sergi (16-ago-2026) — no reordenar sin su OK. Separación uniforme 14px entre módulos.

| # | Component | Módulo |
|---|---|---|
| 0 | `RallyTestPanel` | 🧪 Rally-Test (laboratorio, arriba del todo bajo la cabecera — mandato 18-ago-2026; ver §10e) |
| 1 | `StickyMiniHeader` | SCAN EMRR (barra superior, intocable) |
| 2 | `FearGreedPanel` | Fear & Greed |
| 3 | (riesgo) | Riesgo de mercado |
| 4 | `MarketBreadthPanel` | Amplitud de mercado |
| 5 | `SP500Panel` | SP500 |
| 6 | `PortfolioCard` | Carga de cartera IBK (fotos → OCR → % invertido/efectivo, SIN listado por ticker) |
| 7 | `RallyPanel` | Rally Leaders |
| 8 | `Optimal2026Panel` | Optimal Supreme |
| 9 | `IntraDayFlowsPanel` | Flujos de capital |
| 10 | `TechnicalHeader` | Cabecera EMRR/INSTITUTIONAL (penúltimo por mandato) |
| 11 | `SystemStatusCards` | System Status (último) |

## 10b. RALLY LEADERS ENGINE — v4.0 CERTIFICADA (auditoría conjunta 17-ago-2026)

Motor independiente del TOP 8 (Redis key propia `last_rally_snapshot`, sin compartir rankings).
Config C0 EN PRODUCCIÓN, certificada con triple verificación adversarial — ⚠️ los PARÁMETROS DE
ESTRATEGIA (score, stops, pesos, top-N, cadencia, selección, rotación) están BLOQUEADOS: solo se
cambian si un estudio walk-forward supera los gates pre-registrados (ver §10c). Nunca "a ojo".

| Item | Value |
|---|---|
| Endpoints | POST /api/rally-scan/{start,continue} · GET /api/rally-scan/last (action= vía rewrites) |
| Score v4 | `clamp(50 + 50·tanh(mom9m/75), 0, 100)` — momentum 9 meses puro (189 sesiones, cierre ajustado); desempate por mom9m crudo |
| Selección | Top-10 · revisión ~84 sesiones · SIN filtros por estado (estudio 18-ago: excluir runway BAJO / EN_MAXIMOS / bajo-EMA50 destruye rentabilidad — bajo-EMA50 rinde MÁS, 20,9% vs 11,4% fwd) |
| Trailing stop | por ticker `clamp(12 + 0,35·runwayScore, 15, 45)` %, fijado a la entrada y RE-FIJADO en cada revisión; sobre cierres diarios, no intradía (`suggestedStopPct`) |
| Pesos | M9_RAW: `w_i = clamp(max(1,mom9m_i)·t, 4, 20)` con Σ=100, reparto proporcional exacto (`capNormalizeWeights`); techo 20% INTOCABLE |
| Rotación | al saltar stop → mejor por `0,7·score + 0,3·runwayScore` (`rotationRank`), sin exigir IDEAL; el sustituto hereda el peso |
| Extras emitidos | `dayChangePct` (rentabilidad de la sesión, solo display), `runway`, `entryTiming`, `warningFlags`, `pullbackRisk` NO se emite (estudio 17-ago: sin señal OOS — badge PB dormido en RallyPanel) |
| Backtest canon | full 47,7%/MaxDD 37,7%/MAR 1,27/aciertos 65% · confirmación 2022-26: 44,9%/36,1%/1,24 — universo superviviente: solo comparaciones relativas |
| Frontend | `src/services/rallyRefresh.ts` (RALLY_BACKTEST = cifras canon) · `src/components/RallyPanel.tsx` (layout 2 líneas <680px — no romper) |
| Venta honesta | stops = ROBUSTEZ (no CAGR extra); pesos = concentración en mega-tendencias (en lateral ≈ esquema anterior); nunca prometer rentabilidad futura |

---

## 10c. ESTUDIOS Y BACKTESTS — PROTOCOLO OBLIGATORIO

- **Infraestructura**: `scripts/rally-study-lib.mjs` (réplica de producción + simulador) · `data/universe-10y.json` (603 tickers, 10 años, cierres ajustados) · resultados canon en `backtests/*.json`. ⚠️ La ruta POR DEFECTO del simulador (`simulate` sin opciones) reproduce la config LEGACY (pesos por convicción, sin stops H4 ni salto mezcla); el canon C0 exige pasar explícitamente `widthOf` = stop H4 + `pickJump` = mezcla 70/30 + `weightsOf` = M9_RAW — usar el preset `PRESET_C0(T)` exportado por el lib (y sus helpers `stopH4pct`/`pickJumpMix70`/`capNormalizeTarget`/`segMetrics`), prohibido re-tipear las fórmulas en estudios nuevos.
- **Disciplina**: walk-forward SIEMPRE (elegir en train 2016/17-2021, confirmar en 2022-26), malla 9 celdas (3 fases × 3 cadencias), sin lookahead, determinista. Gate estándar para cambiar producción: batir a C0 en confirmación en CAGR Y peor-celda + mejora material (≥2 pp CAGR o ≥0,08 MAR) + MaxDD ≤ +5 pp + elección por TRAIN entre passers. Sin dominancia → no cambiar (parsimonia).
- **⚠️ TRAMPA DE COSTES (18-ago-2026)**: `simulate()` NO mete los costes de rotación en `dret` — los aplica directo a `eq`. Reconstruir una curva desde `dret` da ~+1,4 pp/año de CAGR fantasma (49,1% vs 47,7% en la celda canónica). Para overlays a nivel de cartera (objetivo de volatilidad, caja, mezclas) derivar la serie de la PROPIA curva: `netRet[i] = curve[i]/curve[i-1] - 1` (reproduce la curva del simulador con diferencia 0,000000%). Comparar una variante reconstruida contra un C0 tomado de `curve` la favorece indebidamente.
- **⚠️ EJECUCIÓN: cierres vs intradía (19-ago-2026)**: el simulador canon evalúa el trailing stop sobre CIERRES diarios; una orden real de bróker persigue el máximo INTRADÍA y salta al TOCAR el nivel dentro de la sesión. Medido con `scripts/../lab (sesión 19-ago)/simulate-intradia.mjs` (réplica en malla 9 celdas): las cifras publicadas (47,7% CAGR / 44,9% confirmación / MAR 1,27) son **2-3 pp/año optimistas** frente a ejecución real (43,5-44,8% / 42,3-43,4% / MAR 1,15-1,25) — dato correcto para el texto del panel, PENDIENTE de aplicar (cambio solo de texto, no de estrategia; requiere OK expreso porque toca Rally Leaders). Validado por reproducción bit a bit del estudio `rally-joint-study.json` (edgePorFase de CAD_63 idéntico en los dos modos). Para adjudicar un retador usar SIEMPRE el **ensemble de 10 fases** (arranques 260..350, sondas P1 ≥7/10 fases + P2 ≥+2pp media) — la malla de 3 fases da falsos negativos (top-8 parecía fallar por el estadístico de peor-celda) y falsos positivos (cadencia 63 parecía ganar con jitter de 3 fases). Con el ensemble de 10 fases: **top-8 (5-25) SUPERA** en los dos modos (10/10 fases, +4,2 a +4,6 pp) — candidato con mejor respaldo del proyecto, aún sin pasar a producción (falta decisión de Sergi); cadencia 63 sigue REFUTADA en ambos modos.
- **Tras re-ejecutar cualquier estudio rally-***: correr sus `verify-*` ANTES de leer conclusiones (`verify-joint-recompute.mjs`, `verify-joint-cadence.mjs` a 20 y 50 pb, `verify-coherence-scan-recompute.mjs`, `verify-coherence-data-sanity.mjs`).
- **Estudios CERRADOS — no repetir** (detalles y cifras en la memoria de sesión, archivo `project_emrr_rally_leaders_estrategia_15ago.md`): pullback score (sin señal OOS), ponderar por riesgo (resta), filtros de selección por estado (0/10 pasa), ceñir stops en máximos (resta), cadencia 63 (trampa test-brillante/train-flojo). **Candidato futuro nº1**: top-8 con topes [5,25] — exige estudio propio pre-registrado.
- **Re-auditoría conjunta**: ~feb-2027, o antes si drawdown >25% o cambio de régimen (SPY<EMA200) — en ese caso REPORTAR, no cambiar.
- **Supreme**: `scripts/recalibrate-supreme.mjs` con regla de PERSISTENCIA (un retador solo se recomienda tras ganar 2 recalibraciones consecutivas — nunca churning semanal). Módulo independiente: NUNCA cruzar con Rally ni SP500.
- **Auditoría semanal automática**: tarea programada viernes 6:00 Canarias (`auditoria-semanal-emrr-supreme` en ~/.claude/scheduled-tasks/) — salud + coherencia + refutación + email de veredicto.

---

## 10d. SISTEMA CARTERA IBK (fotos + export automático)

- **Carga por fotos** (`PortfolioCard` + `src/services/optimal2026Refresh.ts`): OCR client-side (tesseract.js), EXIF + downscale 2200px + PNG antes de OCR (verificado: MÁS preciso que full-res), etiqueta y valor en LÍNEAS DISTINTAS en la UI de IBK, identidad `NAV = VAL.MDO. + EXCESO LIQ. (±3%)` autocorrige, posiciones con separador decimal perdido se reconstruyen por valor÷precio. Foto de cabecera sola (0 posiciones) = carga VÁLIDA. UI: solo % invertido/efectivo + barra — SIN listado por ticker (mandato 16-ago). El input file va SIN atributo accept (compatibilidad iPhone).
- **Semántica IBK**: invertido = Σ(Posición × Último) = VAL.MDO. · efectivo = EXCESO LIQ. · total = NAV. Posiciones US cotizan en USD, totales de cuenta en EUR → FX implícito = VAL.MDO. / Σ(valores USD).
- **Espejo servidor**: al cargar fotos con éxito, POST fire-and-forget a `/api/rally-scan/ibk-portfolio` (Redis 180d). Endpoint sin auth (riesgo aceptado, sin datos identificativos).
- **Export automático**: launchd `com.emrr.cartera-ibk` (cada 5 min) ejecuta `scripts/cartera_ibk_export.py`: con scan nuevo o cartera nueva genera `~/Desktop/CarteraIBK/Cartera_RallyLeaders_<fecha>_<hora>.{xlsx,pdf}` (hora Canarias del scan) con ± posiciones a operar y trailing stop por ticker, y lo ENVÍA POR EMAIL vía Mail.app a sergimaymo@gmail.com (el iCloud del usuario está lleno — el Escritorio NO sincroniza al iPhone). Estado/logs en `~/Library/Application Support/CarteraIBK/`. FORMATO PERMANENTE: columnas de importes € SIN decimales (round() real en la celda, no solo number_format).

---

## 10e. RALLY-TEST — MÓDULO DE LABORATORIO (18-ago-2026)

Mandato de Sergi: *"haz una copia del módulo Rally Leaders que se llame Rally-Test para hacer pruebas
sobre este último **sin tocar nada** del módulo de Rally Leaders"*. **Rally Leaders (§10b) queda
CONGELADO**: todo experimento se hace aquí.

| Item | Value |
|---|---|
| Endpoints | POST /api/rally-test/{start,continue} · GET /api/rally-test/last → rewrites a `/api/rally-scan?action=test-*` (NO se crea función nueva: el plan Hobby está en su tope de 12) |
| Backend | handlers `handleTest*` en `api/rally-scan.js` (copia de los de producción, que NO se tocan) · token con versión propia `RALLY_TEST_V1` |
| Motor | `api/_lib/rallyScoreEngineTest.js` + `api/_lib/rallyBatchProcessorTest.js` — copias byte-idénticas del motor de producción salvo cabecera |
| Persistencia | Redis `last_rally_test_snapshot` (clave propia: un scan de test NUNCA pisa `last_rally_snapshot`) |
| Frontend | `src/services/rallyTestRefresh.ts` (tipos reexportados de producción) · `src/components/RallyTestPanel.tsx` (color violeta `#a855f7` para no confundirlo con el ámbar de producción) |
| Aislamiento UI | NO se registra en el bus de SCAN EMRR (botón propio) y NO dispara `RALLY_SCAN_UPDATED_EVENT` → ni la banda de alineación de cartera ni el export CarteraIBK ven un scan de test |
| Regla | Mientras el motor de test sea idéntico, su top-10 = el de Rally Leaders. En cuanto cambie un parámetro, las cifras de backtest de §10b DEJAN de aplicar: hay que recalcularlas y pasar los gates de §10c antes de proponer nada para producción |

---

## 10f. MOTIVO DEL MOVIMIENTO — "¿por qué se ha movido este ticker?" (20-ago-2026)

- **Solo Rally Leaders, solo display.** `api/_lib/tickerNews.js` elige UN titular por ticker
  de entre los devueltos por el buscador de Yahoo (sin clave); NO participa en score,
  pesos, stops, selección ni rotación — si falla, el módulo funciona exactamente igual.
- **Guardas duras** (nacidas de fallos reales vistos en producción el 20-ago): el titular
  DEBE nombrar a la empresa (Yahoo devolvía noticias de otras compañías para tickers
  europeos) y DEBE describir un catalizador real — resultados, FDA, fusión, cambio de
  recomendación (una opinión de tertuliano o un patrocinio de eSports NO cuentan).
  Convocatorias/agenda ("celebrará conferencia...") restan y topan la puntuación.
  Sin catalizador → `null` → "sin motivo identificado", nunca se inventa una explicación.
- **SIEMPRE en español** (norma de Sergi, 20-ago-2026): traducción con MyMemory (gratuita,
  sin clave) + `GLOSARIO_ES` propio — los traductores automáticos destrozan la jerga
  financiera ("upgrades"→"actualiza") y los nombres propios ("Target"→"el objetivo");
  se protegen con testigos antes de traducir y se restauran después. Si la traducción
  falla se sirve el original y `idioma:"en"` lo delata (visible en el título/tooltip).
- **Endpoint**: `GET /api/rally-scan/news` (rewrite de `?action=news`, sin función nueva en
  Vercel) sobre el ÚLTIMO scan persistido; caché Redis 30 min por scanId (`?fresh=1` la
  salta, solo para verificación). Consulta SIEMPRE por símbolo Y por nombre de empresa y
  fusiona — Yahoo devuelve un conjunto rotatorio, la misma noticia entra y sale del top
  entre refrescos.
- **UI**: nota de una línea en el desplegable de cada ticker (`RallyPanel.tsx`) — verde si
  el ticker sube en la sesión del scan, roja si baja, gris si no hay motivo. El color lo
  marca el PRECIO, no el tono de la noticia (no se mide sentimiento).

---

## 11. OPERATIONAL INVARIANTS (never violate)

These are absolute rules. No exception, no workaround:

```
INV-01  GLOBAL_TOP8_FINAL ← only when coveragePercent === 100
INV-02  operationalDecisionAllowed ← only when all 9 scoreInputIntegrity = "REAL"
INV-03  Redis save ← only when the completing start/continue batch confirms GLOBAL_TOP8_FINAL
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
Write:  POST /api/scan-snapshot/{start,continue} al completar (isGlobalTop8Final === true) — NO existe endpoint finalize
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
❌ Crear archivos nuevos en api/ raíz (límite 12 funciones Vercel — usar action= en handlers existentes)
❌ Cambiar parámetros de estrategia (score, stops, pesos, top-N, cadencia, selección) sin estudio walk-forward que supere los gates de §10c
❌ Confiar en `npx tsc --noEmit` a secas — el typecheck real es `npx tsc -p tsconfig.app.json --noEmit` (ver nota final)
```

---

## 18. WHAT CLAUDE MUST ALWAYS DO

```
✅ Read CLAUDE.md at the start of every session
✅ Run npx vite build before every commit
✅ Update ALL affected files in one pass (CSS + components + API)
✅ Verify the change doesn't break existing functionality
✅ Respetar el orden del §10 en DashboardPage (dictado por Sergi 16-ago — no reordenar sin su OK)
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


## Typecheck (IMPORTANTE)
`npx tsc --noEmit` a secas es un NO-OP en este repo (tsconfig.json raíz solo tiene
references y files:[]). El typecheck REAL es:
```
npx tsc -p tsconfig.app.json --noEmit
```
El 11-ago-2026 este no-op ocultó dos identificadores sin importar en la ruta de subida
de fotos (Optimal2026Panel), rotos en producción durante ~1 semana. Vite build NO
typechecka: no confiar en que "compila" signifique "tipos correctos".
