# AUDIT - EMRR 2.0 / Tendencias

Auditoria acumulativa oficial del proyecto.

Reglas:

- Nunca borrar auditorias anteriores.
- Anadir una nueva seccion por fase o cambio relevante.
- Registrar riesgos, deuda tecnica, incidencias, validaciones locales y validaciones Vercel.
- Mantener el documento simple, practico y facil de revisar.

---

## Correccion Operativa EMRR - Universo Filtrado, Scan Continuable y Etiquetado Real - 2026-06-02

Contexto:

- Correccion operativa posterior a produccion, no nueva fase.
- Estado observado por el usuario el 02/06/2026 a las 18:12 Canarias:
  `US OPEN / Europe CLOSED`.
- Produccion desplegada en Vercel ya no muestra TOP 8 mock, pero el scan
  parcial descubria `~61.000` simbolos y generaba `344` batches, lo que apunta a
  universo bruto de proveedor, no universo operativo EMRR.

Causa raiz:

- El universo procedente de EODHD se aceptaba antes de aplicar filtros estrictos
  de tipo de instrumento, exchange permitido, delisted/inactive y mercado
  abierto.
- `Universe Discovered` mostraba universo bruto o excesivamente amplio, no
  activos aptos para analisis.
- La planificacion de batches se hacia sobre una lista demasiado grande y sin
  priorizacion por liquidez/exchange antes del primer lote.
- `CONTINUE SCAN` tenia estado continuable, pero el dashboard no persistia de
  forma robusta el `snapshotToken` visible de la sesion.
- TNX y algunos Master Indicators mezclaban estado informativo con estado de
  fallo operativo visual.

Correccion aplicada:

- `api/_lib/universeEngine.js`:
  - `isEligibleForUniverse` exige `Type="Common Stock"`.
  - Excluye ETF, Fund, Bond, Preferred Stock, Warrant, Right, Note y tipos
    desconocidos por exclusion conservadora.
  - Solo permite `NASDAQ`, `NYSE`, `XETRA/ETR`, `EURONEXT/EPA/AMS/EBR`, `LSE`,
    `BIT/MIL` y `SIX/VTX`.
  - Excluye delisted/inactive si el proveedor informa `Status` o `isDelisted`.
  - Excluye sufijos `-W`, `-R`, `WT`, `.WS`, `-P`, `-WT`.
- `api/universe.js`:
  - separa `rawProviderSymbolsDiscovered` de `universeDiscovered` filtrado.
  - `Universe Discovered` pasa a representar activos elegibles para analisis,
    no todos los simbolos EODHD.
- `api/_lib/scanSnapshot.js`:
  - filtra por mercado activo en el momento del snapshot.
  - con `US OPEN / Europe CLOSED` solo entran activos USA de `NASDAQ/NYSE`.
  - `batchSize=100`.
  - `maxProviderCallsPerInvocation=201` para cuadrar con la estimacion interna
    `2 * candidatos + 1`.
- `api/_lib/top8BatchPlanner.js`:
  - prioriza candidatos antes de dividir en lotes por exchange, market cap y
    ticker estable.
- `api/_lib/eligibilityEngine.js`:
  - mantiene `MAX_SPREAD_PERCENT=0.35`.
  - agrega umbrales explicitos de precio, historico, volumen y valor medio por
    region.
- `api/_lib/candidateEvaluationEngine.js` y `api/_lib/top8Pipeline.js`:
  - agregan `eligibilityDiagnostics` con conteos por causa de bloqueo.
- `src/pages/DashboardPage.tsx` y `src/components/ActionButtons.tsx`:
  - guardan/recuperan `localStorage["emrr_scan_state"]`.
  - muestran `continue scan (batch X/Y)`.
- `api/master-indicators.js` y `src/services/realDataRefresh.ts`:
  - TNX no resuelto queda como `DATA_UNAVAILABLE` neutro.
  - Master Indicators reales no heredan `MISS` del estado parcial del TOP 8.

Validaciones especificas ejecutadas:

- `node scripts/validate-universe-prescan-filter.mjs` OK.
- `node scripts/validate-active-market-universe-filter.mjs` OK.
- `node scripts/validate-universe-count-not-raw-eodhd.mjs` OK.
- `node scripts/validate-batch-prioritization.mjs` OK.
- `node scripts/validate-eligibility-thresholds.mjs` OK.
- `node scripts/validate-eligibility-diagnostics.mjs` OK.
- `node scripts/validate-scan-continue-localstorage-token.mjs` OK.
- `node scripts/validate-tnx-data-unavailable-neutral.mjs` OK.
- `node scripts/validate-master-indicators-real-not-miss.mjs` OK.
- `node scripts/validate-vercel-hobby-function-count.mjs` OK: 11/12 funciones.

Validacion de cierre local:

- `git diff --check` OK.
- `node scripts/run-all-validators.mjs` OK.
- `npm run build` no ejecutable en este entorno local porque `npm` no esta en
  `PATH` y no existe `node_modules`; Vercel debe confirmar build/typecheck al
  desplegar.
- Vercel production queda pendiente de revalidar despues de push/deploy.

Riesgos restantes:

- Sin persistencia real, completar un scan global requiere continuar manualmente
  el mismo snapshot hasta `coveragePercent=100%`.
- El numero exacto de activos filtrados depende de los campos reales devueltos
  por EODHD (`Type`, `Exchange`, `Status`, `isDelisted`).
- Si EODHD no informa `Exchange` por simbolo USA, el filtro conservador excluye
  esos activos para evitar OTC/PINK ambiguos.

No se hizo:

- No se relajo spread.
- No se modifico Score Engine, Conviction, Risk, ranking conceptual ni EXEC.
- No se ejecuto `execute=true`, batch 2 automatico, full-run oculto, polling,
  cron, workers, base de datos ni persistencia real.

## Critical Production Fix - Remove Mock/Fixed TOP 8 - 2026-06-02

Contexto:

- Correccion critica de produccion, no nueva fase.
- Instruccion vigente: produccion es `REAL SCAN DATA ONLY`; no puede mostrar
  `MOCK`, `MIXED`, fallback visual, fixtures demo, precios sinteticos ni TOP 8
  fijo.
- No se autoriza `execute=true`, batch 2, full-run, polling, cron, workers,
  persistencia, base de datos, auth ni llamadas masivas.

Precheck:

- `git status -sb`: repo local en `main...origin/main` limpio antes de anadir
  validadores de esta correccion.
- Ultimo commit previo revisado: `102350c Audit Vercel deployment pending for
  scan snapshot`.
- Documentos revisados: `MASTER_CODEX_V1.md`, `CHANGELOG.md`, `AUDIT.md`.
- Codigo revisado: `DashboardPage`, `realDataRefresh`, `emptyDashboardData`,
  endpoints `scan-snapshot`, `/api/visible-top8-quotes`, validadores y
  configuracion `package.json`.

Causa raiz exacta:

- Production Vercel sigue sirviendo el bundle antiguo
  `/assets/index-BGTr6Ewp.js`.
- Ese bundle contiene TOP 8 fijo/mock y cadenas prohibidas:
  - `NVDA`, `ASML`, `MSFT`, `AVGO`, `AIR`, `LLY`, `REL`, `SAP`.
  - `MOCK_READY`.
  - `MOCK_CACHE`.
  - `CNN Fear & Greed (mock)`.
  - `Mock scan completed`.
  - `Mock visual refresh completed`.
- Production `/api/providers-status` aun expone metadata antigua:
  `fallbackProvider` y `top8MaxCandidatesPerRun=25`.
- Production `/api/visible-top8-quotes` devuelve `404 NOT_FOUND`.
- Production `GET /api/scan-snapshot/start` devuelve `404 NOT_FOUND`.
- Conclusion: el bug visible viene de un deploy Vercel obsoleto, no del codigo
  actual de `main`.

Estado del codigo local actual:

- `src/mocks/mockData.ts` ya no existe.
- `src/engines/scannerEngine.ts` ya no existe.
- El dashboard arranca con `unavailableTop8=[]` y estado
  `DATA_UNAVAILABLE`.
- `SCAN FULL` usa `startScanSnapshot`; `CONTINUE SCAN` usa
  `continueScanSnapshot`.
- `/api/visible-top8-quotes` es solo enriquecimiento de assets seleccionados por
  snapshot y no decide ranking.

Archivos modificados en esta correccion:

- `MASTER_CODEX_V1.md`.
- `CHANGELOG.md`.
- `AUDIT.md`.
- `package.json`.
- `scripts/build-production.mjs`.
- `scripts/run-all-validators.mjs`.
- `scripts/validate-no-mock-in-production-dashboard.mjs`.
- `scripts/validate-no-fixed-top8-production.mjs`.
- `scripts/validate-no-mock-toast.mjs`.
- `scripts/validate-real-scan-snapshot-required.mjs`.
- `scripts/validate-production-initial-state-data-unavailable.mjs`.
- `scripts/validate-europe-open-us-closed-excludes-us-assets.mjs`.
- `scripts/validate-no-mock-mixed-fallback-visible.mjs`.
- `scripts/validate-production-bundle-no-mock-fixed-top8.mjs`.

Validadores anadidos:

- `validate-no-mock-in-production-dashboard`: bloquea imports activos de mock,
  `mockData`, `runMockScan`, cadenas `MOCK_*` prohibidas y directorios mock en la
  ruta activa de produccion.
- `validate-no-fixed-top8-production`: bloquea listas fijas operativas de TOP 8
  y exige que `/api/visible-top8-quotes` no decida ranking.
- `validate-no-mock-toast`: bloquea mensajes visibles de scan mock.
- `validate-real-scan-snapshot-required`: exige que `SCAN FULL` use
  `scanSnapshot` y que los endpoints sean POST-only para ejecucion.
- `validate-production-initial-state-data-unavailable`: exige TOP 8 inicial
  vacio y `DATA_UNAVAILABLE`.
- `validate-europe-open-us-closed-excludes-us-assets`: valida que mercado Europa
  abierto/EEUU cerrado excluye activos USA, y viceversa.
- `validate-no-mock-mixed-fallback-visible`: reusa la validacion estricta de no
  mock/mixed/fallback visible.
- `validate-production-bundle-no-mock-fixed-top8`: inspecciona
  `dist/assets/*.js` cuando exista build local y falla si aparece mock/fixed TOP
  8 prohibido.

Hard gate de build:

- `npm run build` queda definido como `node scripts/build-production.mjs`.
- El build de produccion ejecuta:
  1. `node scripts/run-all-validators.mjs`.
  2. `node_modules/.bin/tsc -b`.
  3. `node_modules/.bin/vite build`.
  4. `node scripts/validate-production-bundle-no-mock-fixed-top8.mjs
     --require-dist`.
- En modo `--require-dist`, el validador de bundle falla si `dist/assets` no
  existe; esto evita declarar OK un build que no haya generado assets
  inspeccionables.
- Marcadores prohibidos en bundle: `MOCK`, `MIXED`, `Mock visual refresh
  completed`, `Mock scan completed`, `mockData`, `runMockScan`, `MOCK_READY`,
  `MOCK_CACHE`, `MOCK_FALLBACK`, `staticTop8`, `fallbackTop8`, `demoTop8`,
  `fixtureTop8` y secuencias de tickers fijos TOP 8.

Validaciones locales ejecutadas:

- `git diff --check` OK.
- Todos los validadores `scripts/validate-*.mjs` disponibles OK.
- El validador de bundle quedo correctamente en modo skip porque `dist/assets`
  no existe sin build local.
- `node --version`: `v24.14.0`.
- `npm run build`: no ejecutable en este entorno porque `npm` no esta disponible
  (`command -v npm` sin resultado).
- `node scripts/validate-production-bundle-no-mock-fixed-top8.mjs
  --require-dist`: falla localmente como esperado sin `dist/assets`; ese modo
  solo es valido despues de `vite build`.
- `git ls-remote origin refs/heads/main`: confirma remoto en
  `6cdd7a365a235fe85ddd26d5d5a06f565cdf5a64` antes de aplicar el hard gate de
  build de esta iteracion.

Criterio de cierre de produccion:

- Vercel debe dejar de servir `/assets/index-BGTr6Ewp.js`.
- `/api/visible-top8-quotes` debe dejar de devolver `404`.
- `GET /api/scan-snapshot/start` debe existir y rechazar con metodo no permitido,
  no con `404`.
- `/api/providers-status` debe exponer metadata actual de scan snapshot y no
  `fallbackProvider` antiguo.
- El bundle activo no puede contener `Mock visual refresh completed`,
  `MOCK_READY`, `mockTop8`, `runMockScan`, `MOCK_FALLBACK` ni listas fijas TOP 8.

Resultado Vercel post-push del commit `b26ca50`:

- GitHub quedo sincronizado con `origin/main`.
- `/` sigue sirviendo el HTML con
  `/assets/index-BGTr6Ewp.js`.
- `/api/health` responde HTTP 200, pero con metadata antigua `phase=6`.
- `/api/providers-status` responde HTTP 200, pero conserva
  `fallbackProvider` y `top8MaxCandidatesPerRun=25`.
- `/api/visible-top8-quotes` sigue devolviendo HTTP 404 `NOT_FOUND`.
- `GET /api/scan-snapshot/start` sigue devolviendo HTTP 404 `NOT_FOUND`.
- No hay `vercel` CLI disponible, no hay `gh` CLI disponible y no existe carpeta
  `.vercel` vinculada en el repo local.
- No se encontro deploy hook documentado en el repositorio.
- Sin acceso a dashboard/CLI/token Vercel no se puede identificar desde este
  entorno el project id, production branch configurada, auto-deploy ni deployed
  commit SHA. La evidencia publica disponible demuestra que Production sigue
  apuntando al bundle viejo.

Decision operativa:

- Codigo local y GitHub: OK.
- Validadores locales: OK.
- Build local: no verificable por ausencia de `npm`.
- Produccion Vercel: NO OK; requiere redeploy manual del ultimo `main` o revisar
  conexion Vercel-GitHub.
- Mientras Vercel siga sirviendo `/assets/index-BGTr6Ewp.js`, el dashboard de
  produccion puede mostrar TOP 8 fijo/mock antiguo y no cumple la regla `REAL
  SCAN DATA ONLY`.

Resultado Vercel post-push del commit `f437451`:

- GitHub remoto confirmado:
  `f437451f51de9c30df310588eceff365ae13a9af refs/heads/main`.
- `/` sigue sirviendo:
  `/assets/index-BGTr6Ewp.js`.
- `/api/health`: HTTP 200 con metadata antigua `phase=6`.
- `/api/providers-status`: HTTP 200 con `fallbackProvider` y
  `top8MaxCandidatesPerRun=25`.
- `/api/universe`: HTTP 200, endpoint antiguo metadata-only activo.
- `/api/master-indicators`: HTTP 200, endpoint antiguo fase 5 activo.
- `/api/visible-top8-quotes`: HTTP 404 `NOT_FOUND`.
- `GET /api/scan-snapshot/start`: HTTP 404 `NOT_FOUND`.
- `GET /api/scan-snapshot/continue`: HTTP 404 `NOT_FOUND`.
- `GET /api/scan-snapshot/finalize`: HTTP 404 `NOT_FOUND`.

Interpretacion:

- El hard gate de build ya esta en `origin/main`, pero Production no esta
  sirviendo ese commit.
- Si Vercel intenta construir `f437451`, `npm run build` ejecutara validadores,
  typecheck, Vite y gate de bundle. Si el bundle contiene mock/fixed TOP 8,
  el build debe fallar.
- La evidencia publica sigue apuntando a conexion/deploy obsoleto, production
  branch incorrecta, auto-deploy desactivado, build fallido no visible desde este
  entorno, o proyecto Vercel distinto al repo actual.
- Se requiere acceso al dashboard Vercel o CLI/token para identificar project id,
  production deployment URL, deployed commit SHA y disparar redeploy sin cache.

Diagnostico adicional de commit desplegado:

- La respuesta publica actual de `/api/providers-status` coincide con el codigo
  de `api/providers-status.js` en el commit `303ef83 Add phase 11.1 single batch
  handoff`.
- En `303ef83` no existen:
  - `api/visible-top8-quotes.js`.
  - `api/scan-snapshot/start.js`.
- En `303ef83`, `src/pages/DashboardPage.tsx` contiene:
  - `Mock scan completed`.
  - `Mock visual refresh completed`.
- En `303ef83`, `src/mocks/mockData.ts` contiene:
  - `MOCK_READY`.
  - `MOCK_CACHE`.
  - TOP 8 fijo con `NVDA`, `ASML`, `MSFT`, `SAP`, `AVGO`, `AIR`, etc.
- El bundle publico actual `/assets/index-BGTr6Ewp.js` contiene:
  - `Mock visual refresh completed`.
  - `Mock scan completed`.
  - `MOCK_READY`.
  - `MOCK_CACHE`.
  - `NVDA`, `ASML`, `MSFT`, `AVGO`, `SAP`, `AIR`.
- Conclusion: la evidencia publica demuestra que Production esta anclada a una
  build antigua compatible con `303ef83`, mientras `origin/main` esta en commits
  posteriores (`d5bafe9` y despues hard gate).

Validador publico de produccion:

- Se anade `scripts/validate-vercel-production-deploy.mjs`.
- Script npm: `npm run validate-vercel-production`.
- Queda excluido de `npm run validate:all` y de `npm run build` porque depende
  de red externa y debe usarse manualmente despues de un redeploy.
- Comprueba:
  - HTML de `/`.
  - asset Vite activo.
  - ausencia de bundle antiguo `/assets/index-BGTr6Ewp.js`.
  - ausencia de marcadores mock/fixed TOP 8 en bundle.
  - rutas `/api/visible-top8-quotes` y `scan-snapshot/*` sin 404.
- Resultado actual:
  - Falla correctamente con
    `Production must not serve the known old mock bundle
    /assets/index-BGTr6Ewp.js`.
- Recheck tras push de `9fcf2b8`:
  - `origin/main` confirmado en
    `9fcf2b8b5376c9ad5676e5c46be60de69eaf3a0c`.
  - `node scripts/validate-vercel-production-deploy.mjs` sigue fallando por
    `/assets/index-BGTr6Ewp.js`.
  - Production sigue pendiente de redeploy manual / correccion de conexion
    Vercel-GitHub.

Herramientas de redeploy disponibles en este entorno:

- `vercel`: no disponible.
- `gh`: no disponible.
- `npm`: no disponible.
- `npx`: no disponible.
- `corepack`: no disponible.
- `pnpm`: no disponible.
- `yarn`: no disponible.
- `.vercel/`: no existe.
- API pública de Vercel para alias responde `403 missing authentication token`.

Recheck adicional de bloqueo Vercel:

- Variables de entorno presentes: ninguna de `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`,
  `VERCEL_ORG_ID`, `VERCEL_TEAM_ID`, `GITHUB_TOKEN` ni `GH_TOKEN`.
- Configuracion local Vercel: no existe `~/.vercel`, `~/.config/vercel` ni
  `.vercel` en el repo/proximidad.
- `node scripts/validate-vercel-production-deploy.mjs` sigue fallando con:
  `Production must not serve the known old mock bundle
  /assets/index-BGTr6Ewp.js`.
- Cabeceras publicas de `/`:
  - HTTP 200.
  - `x-vercel-cache: HIT`.
  - `last-modified: Mon, 01 Jun 2026 18:17:35 GMT`.
  - HTML sigue referenciando `/assets/index-BGTr6Ewp.js`.
- Conclusion actual: el entorno Codex local no tiene capacidad material para
  forzar redeploy, consultar deployments privados ni corregir la conexion
  Vercel-GitHub. La accion pendiente debe hacerse desde Vercel Dashboard o con
  token/CLI Vercel autorizado.

Evidencia aportada desde Vercel Dashboard:

- Proyecto visible: `emrr-2-tendencias`.
- Deployment actual abierto: `HLHg6TMpF`.
- Estado: `Ready Stale`.
- Environment: `Production` y marcado como `Current`.
- Source: branch `main`, commit `80a6c8b`.
- Dominio production asignado: `emrr-2-tendencias.vercel.app`.
- Alias de branch mostrado:
  `emrr-2-tendencias-git-main-sergi-maymo-s-projects.vercel.app`.
- Deployment URL mostrado:
  `emrr-2-tendencias-prxlod8nz-sergi-maymo-s-projects.vercel.app`.
- El commit production `80a6c8b` no coincide con `origin/main` actual
  `508aa002a46de663e362aaff5dc59beee03f86db`.

Comprobacion publica de aliases de la captura:

- `emrr-2-tendencias-git-main-sergi-maymo-s-projects.vercel.app` responde con
  Vercel Authentication, no con dashboard publico.
- `emrr-2-tendencias-prxlod8nz-sergi-maymo-s-projects.vercel.app` responde con
  Vercel Authentication, no con dashboard publico.
- Esto indica que hay deployment/alias protegido, pero el dominio production
  publico `emrr-2-tendencias.vercel.app` sigue apuntando al deployment viejo.

Accion operativa requerida:

- Desde Vercel Dashboard, buscar un deployment reciente de `main` con commit
  `508aa00` o posterior.
- Si existe, usar `Promote to Production`.
- Si no existe, ejecutar `Redeploy` del branch `main` sin cache.
- Si Vercel vuelve a usar `80a6c8b`, revisar `Settings -> Git` y confirmar repo,
  production branch `main` y auto-deploy.

Build failure detectado en Vercel:

- Deployment abierto: `D7KCyNymb`.
- Source: branch `main`, commit `1571a6d`.
- Estado: `Build Failed`.
- Error principal: `Command "npm run build" exited with 1`.
- Build Logs:
  - `src/services/realDataRefresh.ts(651,5): error TS2322`.
  - Causa: `source/provider` quedaba inferido como `string` y no como
    `DataProvider`.
  - `server/providers/mockProvider.ts(6,16)` y `(9,20): error TS2322`.
  - Causa: el provider local devolvia `"mock"`, valor ya eliminado de
    `ApiProviderPublicState`.

Correccion aplicada:

- `server/providers/mockProvider.ts` devuelve `not_configured` si no hay API key,
  API key vacia o placeholder.
- `src/services/realDataRefresh.ts` anota explicitamente el provider de master
  indicators como `DataProvider`.
- Recheck del deployment `Cof7QDTds` en commit `5486772` detecto dos errores
  restantes:
  - `MasterIndicator.status` se inferia como `string`.
  - `server/providers/providerRouter.ts` seguia usando `mode: "MOCK_ONLY"`.
- Correccion adicional:
  - `mergeMasterIndicators` devuelve explicitamente `MasterIndicator[]`.
  - `providerRouter` usa `mode: "REAL_API_DISABLED"` y
    `secondaryProviderConfiguredOnly: "Finnhub"`.
- No se modifico la logica financiera, Score Engine, Universe Engine,
  endpoints reales prohibidos, Cost Gate ni reglas de EXEC.

Build failure por limite Vercel Hobby:

- Deployment en commit `c342f28` falla con:
  `No more than 12 Serverless Functions can be added to a Deployment on the
  Hobby plan`.
- Causa tecnica: habia 14 funciones publicas bajo `api/`.
- Rutas publicas activas antes:
  `health`, `providers-status`, `quote`, `master-indicators`, `universe`,
  `top8`, `top8-batch-single`, `visible-top8-quotes`, `scan-snapshot/start`,
  `scan-snapshot/continue`, `scan-snapshot/finalize`, mas las legacy
  `top8-run`, `top8-batch`, `top8-final`.
- Correccion:
  - Se retiran de produccion `api/top8-run.js`, `api/top8-batch.js` y
    `api/top8-final.js`.
  - Quedan 11 funciones publicas, dentro del limite Hobby.
  - El flujo actual de produccion se mantiene en `scan-snapshot` continuable y
    `top8-batch-single` diagnostico.
  - Se anade `scripts/validate-vercel-hobby-function-count.mjs`.
- No se ejecuta `execute=true`, no se ejecuta batch 2, no se hace full-run y no
  se anaden bases de datos, workers, cron, polling ni persistencia.

Confirmaciones negativas:

- No se ejecuto `execute=true`.
- No se ejecuto batch 2.
- No se hizo full-run.
- No se anadieron mocks, fallbacks, fixtures demo, persistencia, DB, auth,
  polling, cron, workers ni background jobs.
- No se modificaron conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, spread/liquidez, IBKR/PRIIPs ni ranking.

## Continuable Full Universe Scan Snapshot Integrity Fix - 2026-06-02

Contexto:

- Correccion critica post-cierre beta, no nueva fase.
- El usuario rechazo el limite anterior de un lote simbolico de 25 candidatos.
- Objetivo: `SCAN FULL` debe representar el universo elegible completo por
  lotes continuables y solo mostrar TOP 8 global con cobertura completa.

Precheck:

- `git status -sb`: `main...origin/main` limpio antes de editar.
- Ultimos commits revisados:
  - `3043c83 Audit strict data integrity Vercel status`
  - `f656971 Enforce no mock mixed fallback dashboard data`
  - `4fc3ebe Audit operational integrity Vercel status`
- Documentacion revisada: `MASTER_CODEX_V1.md`, `CHANGELOG.md`, `AUDIT.md`.
- Codigo revisado: dashboard, `realDataRefresh`, `/api/top8`,
  `/api/top8-batch-single`, batch planner, pipeline, universe, providers y
  validadores.
- Estado Vercel conocido previo: `/api/health` OK, `/api/top8` bloqueado por
  Cost Gate, `/api/top8-batch-single?batch=1` dry-run OK; Production anterior
  no reflejaba todavia `/api/visible-top8-quotes`.

Archivos modificados:

- `api/_lib/scanSnapshot.js`
- `api/_lib/top8BatchPlanner.js`
- `api/_lib/top8Pipeline.js`
- `api/_lib/candidateEvaluationEngine.js`
- `api/scan-snapshot/start.js`
- `api/scan-snapshot/continue.js`
- `api/scan-snapshot/finalize.js`
- `api/visible-top8-quotes.js`
- `api/providers-status.js`
- `shared/types/domain.ts`
- `src/pages/DashboardPage.tsx`
- `src/components/ActionButtons.tsx`
- `src/components/ScanStatusPanel.tsx`
- `src/components/StickyMiniHeader.tsx`
- `src/services/realDataRefresh.ts`
- `src/mocks/mockData.ts` eliminado.
- `src/engines/scannerEngine.ts` eliminado.
- `scripts/validate-*.mjs`
- `tsconfig.app.json`
- `package.json`
- `MASTER_CODEX_V1.md`
- `CHANGELOG.md`
- `AUDIT.md`

Politica implementada:

- `SCAN FULL` inicia un `scanSnapshot` real con `scanId`,
  `scanStartedAtUtc`, `universeHash`, mercados activos, lotes, cobertura y
  coste.
- El universo se filtra por mercados abiertos y activos operables antes de
  llamadas caras.
- Batching controlado:
  - `batchSize` 50-100.
  - Por invocacion se procesa el siguiente lote permitido por coste.
  - El dashboard muestra `CONTINUE SCAN` si quedan lotes pendientes.
- Handoff sin base de datos:
  - token firmado con `SCAN_SNAPSHOT_SIGNING_SECRET` o secreto server-side ya
    configurado.
  - cada continuacion verifica `scanId`, `universeHash`, lotes completados y no
    duplicados.
- `GLOBAL_TOP8_FINAL` requiere:
  - `coveragePercent=100%`,
  - `batchesCompleted === batchesTotal`,
  - activos con datos reales y score inputs validos,
  - mismo `scanId` y `universeHash`.
- Si `coveragePercent < 100%`:
  - resultado `PARTIAL_BATCH_ONLY`,
  - `isGlobalTop8Final=false`,
  - dashboard muestra `TOP 8 PARTIAL DIAGNOSTIC` o
    `TOP 8 DATA UNAVAILABLE`.

Resultado tecnico:

- El dashboard ya no usa `/api/top8` como fuente directa de `SCAN FULL`; usa
  `POST /api/scan-snapshot/start`.
- El usuario puede continuar el mismo snapshot con
  `POST /api/scan-snapshot/continue`.
- `/api/scan-snapshot/finalize` bloquea finalizacion si la cobertura no llega a
  100%.
- `/api/visible-top8-quotes` solo enriquece activos ya seleccionados por el
  snapshot y no contiene lista fija operativa.
- `/api/quote` y `/api/master-indicators` quedan sin sustituto silencioso:
  EODHD es proveedor primario controlado; si no hay dato valido, la salida queda
  no disponible y no se marca como dato sustituto.
- El ranking conserva score descendente, conviction descendente, menor risk y
  mejor calidad/liquidez.
- No se introducen datos mock, mixed, fallback, sinteticos ni listas fijas como
  fuente operativa.
- Se eliminan los fixtures mock heredados de `src/` y se sustituyen los
  validadores que dependian de ellos por validacion del pipeline real/snapshot.

Limitaciones:

- El entorno local no tiene `npm` ni `node_modules`, por lo que no se pudo
  ejecutar `npm run build` ni `tsc -b`.
- GitHub queda sincronizado con commit `7721023`, pero Production Vercel seguia
  sirviendo el build anterior tras varias comprobaciones seguras:
  - `/api/providers-status` seguia mostrando `fallbackProvider` y
    `top8MaxCandidatesPerRun=25`.
  - `/api/visible-top8-quotes` seguia en `404 NOT_FOUND`.
  - `GET /api/scan-snapshot/start` seguia en `404 NOT_FOUND`.
  Esto bloquea el cierre Vercel de la correccion hasta que Vercel despliegue el
  commit nuevo o se dispare redeploy manual.
- Si el proveedor historico solo devuelve barras EOD y el mercado esta abierto,
  el snapshot puede bloquear final global por falta de datos tecnicos frescos
  del momento del scan. Esto es correcto: no se sustituye con datos antiguos.
- Si falta secreto de firma, el snapshot no genera token inseguro y la
  continuacion queda bloqueada.

Validaciones locales ejecutadas:

- `git diff --check` OK.
- `node scripts/validate-continuable-scan-snapshot.mjs` OK.
- `node scripts/validate-coverage-required-for-global-top8.mjs` OK.
- `node scripts/validate-partial-never-global.mjs` OK.
- `node scripts/validate-scan-token-handoff.mjs` OK.
- `node scripts/validate-no-duplicate-batches.mjs` OK.
- `node scripts/validate-same-scanid-ranking.mjs` OK.
- `node scripts/validate-cost-progress-visible.mjs` OK.
- `node scripts/validate-exec-only-global-real-open.mjs` OK.
- `node scripts/validate-visible-top8-quotes.mjs` OK.
- `node scripts/validate-visible-quotes-not-ranking-source.mjs` OK.
- `node scripts/validate-no-mock-mixed-fallback-data.mjs` OK.
- `node scripts/validate-operational-data-policy.mjs` OK.
- `node scripts/validate-score-integrity.mjs` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK tras actualizar el supuesto de coste.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK tras actualizar el supuesto de coste.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `node scripts/validate-phase11-6.mjs` OK.
- `node scripts/validate-phase11-7.mjs` OK.
- Validadores dashboard/market/universe/master/timestamps ejecutados con OK.

Confirmaciones negativas:

- No se ejecuto `execute=true`.
- No se ejecuto batch 2.
- No se ejecuto full-run oculto ni scanner automatico.
- No se anadio base de datos, persistencia real, auth real, polling, cron,
  workers ni background jobs.
- No se modificaron conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, spread/liquidez, IBKR/PRIIPs ni
  metodologia de ranking.
- Decision de cierre de esta correccion en Production: pendiente/no OK hasta
  que Vercel sirva los endpoints del commit `7721023`.

## Strict No-Substitute Data Correction - 2026-06-02

Contexto:

- Correccion final post-cierre beta, no nueva fase.
- Instruccion vigente del usuario: no puede haber datos `MOCK`, `MIXED` ni
  sustitutos en dashboard visible.
- Esta seccion supersede la tolerancia anterior a datos mock etiquetados.

Precheck:

- `git status -sb`: repo limpio antes de editar.
- Ultimo commit pre-correccion: `4fc3ebe Audit operational integrity Vercel status`.
- Vercel seguro antes de editar:
  - `/api/health` OK.
  - `/api/top8` responde 409 esperado por Cost Gate, sin full-run.
  - `/api/top8-batch-single?batch=1` OK en dry-run, `providerCallsPlanned=0`.
  - `/api/visible-top8-quotes` seguia en 404 `NOT_FOUND`.

Archivos modificados:

- `shared/types/domain.ts`
- `src/data/emptyDashboardData.ts`
- `src/utils/systemStatus.ts`
- `src/utils/operationalDataPolicy.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/services/realDataRefresh.ts`
- `src/components/Top8Grid.tsx`
- `src/components/FearGreedPanel.tsx`
- `src/components/MasterIndicatorsGrid.tsx`
- `src/components/SystemStatusCards.tsx`
- `src/components/ScanStatusPanel.tsx`
- `src/components/TechnicalHeader.tsx`
- `src/engines/index.ts`
- `api/visible-top8-quotes.js`
- `tsconfig.app.json`
- validadores en `scripts/`
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `AUDIT.md`
- `MASTER_CODEX_V1.md`

Resultado tecnico:

- El dashboard activo deja de importar `src/mocks/mockData.ts`; en la
  correccion de snapshot continuable posterior, ese fixture heredado queda
  eliminado de `src/`.
- `runMockScan`, `mockTop8`, `mockFearGreed`, `MOCK_SCAN`,
  `MIXED_REFRESH`, `MOCK_FALLBACK`, `lastMockRefresh` y precios sinteticos
  salen de la ruta activa.
- `DataMode` visible queda limitado a:
  - `REAL`
  - `LAST_CLOSE`
  - `ERROR`
  - `DATA_UNAVAILABLE`
- Si `/api/top8` queda bloqueado por Cost Gate, el TOP 8 visible queda vacio y
  muestra `TOP 8 DATA UNAVAILABLE`.
- Fear & Greed y Leading Sectors quedan no disponibles hasta tener fuente real
  aprobada.
- `/api/visible-top8-quotes`:
  - GET no devuelve lista fija.
  - POST solo acepta tickers ya seleccionados por ranking dinamico.
  - No decide ranking.
  - No ejecuta universo, full-run, historico/spread masivo ni batches.
  - No usa proveedor sustituto silencioso; si EODHD no entrega dato valido, el
    activo queda `DATA_UNAVAILABLE`.
- Fixtures legacy de mock scan/output quedan retirados de la ruta activa; la
  correccion posterior elimina `src/mocks/mockData.ts` y
  `src/engines/scannerEngine.ts` para evitar cualquier dependencia heredada.

Riesgos / limitaciones:

- Produccion Vercel no sera OK hasta que `/api/visible-top8-quotes` deje de
  devolver 404 tras deploy.
- Recheck post-push tras espera adicional: `/api/visible-top8-quotes` sigue
  devolviendo 404 y `/` sigue sirviendo el asset antiguo
  `/assets/index-BGTr6Ewp.js`; Production no refleja todavia el commit
  `f656971`.
- Si `/api/top8` sigue bloqueado por Cost Gate, el dashboard beta mostrara TOP 8
  no disponible. Esto es correcto bajo la nueva regla: no se rellena con datos
  no reales.
- No existe fuente real aprobada para Fear & Greed ni Leading Sectors.

Validaciones locales ejecutadas:

- `git diff --check` OK.
- `node --check api/visible-top8-quotes.js` OK.
- `node scripts/validate-no-mock-mixed-fallback-data.mjs` OK.
- `node scripts/validate-data-mode-integrity.mjs` OK.
- `node scripts/validate-operational-data-policy.mjs` OK.
- `node scripts/validate-visible-top8-quotes.mjs` OK.
- Validadores Fase 6, 7, 8, 9, 10, 11, 11.1, 11.3, 11.5, 11.6 y 11.7 OK.
- Validadores de score, universe, dashboard, TOP 8, EXEC, Fear & Greed,
  Master Indicators, timestamps, market hours y quotes visibles OK.
- `npm run build` no pudo ejecutarse localmente: `command not found: npm`.
- `node_modules/.bin` no existe en el entorno local.

Confirmaciones negativas:

- No se ejecuto `execute=true`.
- No se ejecuto batch 2.
- No se ejecuto full-run.
- No se anadio base de datos, persistencia real, auth real, polling, cron,
  workers ni background jobs.
- No se modificaron conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, spread/liquidez, IBKR/PRIIPs ni
  ranking real.

## EMRR Operational Integrity Master Fix - 2026-06-02

Contexto:

- Correccion maestra post-cierre beta, no nueva fase.
- Objetivo: impedir que datos `MOCK`, `MIXED`, `STALE` o no disponibles
  produzcan decisiones operativas, ranking operacional, TOP 8 operacional o
  `EXEC`.
- Precheck Vercel seguro antes de editar:
  - `/api/health` OK.
  - `/api/providers-status` OK.
  - `/api/top8-batch-single?batch=1` OK en dry-run con `providerCallsPlanned=0`.
  - `/api/visible-top8-quotes` devolvia 404 `NOT_FOUND`.

Archivos modificados:

- `shared/types/domain.ts`
- `shared/types/index.ts`
- `src/types/index.ts`
- `src/utils/operationalDataPolicy.ts`
- `src/mocks/mockData.ts`
- `src/services/realDataRefresh.ts`
- `src/pages/DashboardPage.tsx`
- `src/components/Top8Grid.tsx`
- `src/components/FearGreedPanel.tsx`
- `src/components/SectorLeaders.tsx`
- `src/components/MasterIndicatorsGrid.tsx`
- `src/components/SystemStatusCards.tsx`
- `src/components/TechnicalHeader.tsx`
- `src/utils/export.ts`
- `api/visible-top8-quotes.js`
- nuevos/actualizados validadores en `scripts/`
- `package.json`
- `README.md`
- `MASTER_CODEX_V1.md`
- `CHANGELOG.md`
- `AUDIT.md`

Operational Data Policy implementada:

- Mercado abierto: solo `REAL` con calidad `CLEAN`/`GOOD`, proveedor,
  timestamp, cache valida y score inputs reales puede ser candidato operacional.
- Mercado cerrado: solo `LAST_CLOSE` si existe ultimo cierre real valido; nunca
  se muestra como `LIVE`.
- `MOCK`, `MIXED`, `STALE`, `ERROR`, `MOCK_FALLBACK` y `PARTIAL_BATCH_ONLY`
  quedan bloqueados para decision operacional.
- `EXEC` requiere dato real completo, mercado abierto, activo operable, spread y
  liquidez validos y ningun bloqueo duro.

TOP 8 / Universe / Dashboard:

- El dashboard consulta `/api/top8` en scan manual para incorporar estado real
  del universo dinamico y Cost Gate.
- Si `/api/top8` queda bloqueado por Cost Gate, el dashboard muestra TOP 8
  operacional no disponible y mantiene cualquier fallback como no operativo.
- `/api/visible-top8-quotes` continua como enriquecedor de precio, no fuente de
  ranking ni screener.
- Fear & Greed se muestra como no disponible mientras no haya fuente real
  aprobada.
- Leading Sectors se muestra como `DATA UNAVAILABLE` si no hay fuente real.
- Master Indicators muestran estado operacional separado; TNX no se inventa.

Score Integrity Audit:

- No se modifica `api/_lib/scoreEngine.js`.
- Pesos actuales del codigo conservados:
  - `trend=25`
  - `momentum=20`
  - `relativeStrength=20`
  - `liquidity=15`
  - `volatility=10`
  - `drawdown=10`
- La diferencia con pesos nombrados en documentacion antigua queda registrada
  como deuda documental; no se toca el motor en esta correccion.
- `scoreInputIntegrity` bloquea decisiones operativas cuando EMA20, EMA50, RS,
  Momentum, Continuity, RVOL, Liquidity, Spread o ATR no son reales.

Validaciones:

- `node --check api/visible-top8-quotes.js` OK.
- `node scripts/validate-operational-data-policy.mjs` OK.
- `node scripts/validate-score-integrity.mjs` OK.
- `node scripts/validate-universe-integrity.mjs` OK.
- `node scripts/validate-dashboard-integrity.mjs` OK.
- `node scripts/validate-data-mode-integrity.mjs` OK.
- `node scripts/validate-visible-top8-quotes.mjs` OK.
- `node scripts/validate-dynamic-top8-source.mjs` OK.
- `node scripts/validate-top8-ranking-sort.mjs` OK.
- `node scripts/validate-exec-real-data-guard.mjs` OK.
- `node scripts/validate-exec-dynamic-guard.mjs` OK.
- `node scripts/validate-fear-greed-refresh.mjs` OK.
- `node scripts/validate-master-indicators-refresh.mjs` OK.
- `node scripts/validate-scan-updates-dashboard.mjs` OK.
- `node scripts/validate-market-hours.mjs` OK.
- `node scripts/validate-timestamps.mjs` OK.
- Validadores Fase 6, 7, 8, 9, 10, 11, 11.1, 11.3, 11.5, 11.6 y
  11.7 OK.
- Validadores dashboard heredados OK:
  - `validate-scanfull-mock-refresh`
  - `validate-universe-dynamic`
  - `validate-top8-closed-market-exec-block`
  - `validate-leading-sectors-order`
  - `validate-trailing-label-map`
  - `validate-top8-mock-prices-2026`
  - `validate-top8-trend-render`
  - `validate-top8-open-market-exec-eligibility`
  - `validate-fear-greed-mock-anchor`
- `git diff --check` OK.
- `npm run build` no pudo ejecutarse localmente: `command not found: npm`.
- `node_modules/.bin` no existe en el entorno local; se uso Node embebido de
  Codex (`v24.14.0`) para validaciones directas.

Estado Vercel:

- Pre-push:
  - `/api/health` OK.
  - `/api/providers-status` OK.
  - `/api/top8-batch-single?batch=1` OK en dry-run.
  - `/api/visible-top8-quotes` seguia en 404 `NOT_FOUND`.
- Post-push:
  - GitHub sincronizado con `origin/main` tras commit `dfbb674`.
  - `/api/health` OK.
  - `/api/top8` responde 409 esperado por
    `COST_GATE_REQUIRES_BATCHING_STRATEGY`; no ejecuta full-run.
  - `/api/visible-top8-quotes` sigue devolviendo 404 `NOT_FOUND` incluso tras
    espera breve post-push.
- Criterio OK: `/api/visible-top8-quotes` debe dejar de devolver 404 y Vercel
  debe responder rutas seguras.
- Prohibido y no ejecutado: `execute=true`, batch 2, full-run o llamadas
  masivas.

Decision final:

- Codigo local: OK por validadores directos.
- Build local: no verificado por falta de `npm`.
- Produccion Vercel: NOT OK porque `/api/visible-top8-quotes` sigue sin estar
  servido en Production.
- Resultado: `EMRR OPERATIONAL INTEGRITY MASTER FIX — NOT OK`.

## Dynamic Scan & Dashboard Integrity Fix - 2026-06-01

Contexto:

- Correccion post-cierre beta, no nueva fase.
- Causa raiz: el dashboard podia seguir dependiendo de un TOP 8 visible fijo
  para la experiencia mock/controlada y el endpoint de quotes podia interpretarse
  como fuente del ranking.
- Objetivo: el TOP 8 visible debe derivar de un pipeline dinamico y trazable; si
  no hay TOP 8 global real por Cost Gate, el resultado debe quedar como
  `MOCK_FALLBACK`/no operativo.

Archivos modificados:

- `shared/types/domain.ts`
- `shared/types/index.ts`
- `src/types/index.ts`
- `src/mocks/mockData.ts`
- `src/pages/DashboardPage.tsx`
- `src/services/realDataRefresh.ts`
- `src/components/SystemStatusCards.tsx`
- `src/components/TechnicalHeader.tsx`
- `src/components/Top8Grid.tsx`
- `api/visible-top8-quotes.js`
- `scripts/validate-dynamic-top8-source.mjs`
- `scripts/validate-top8-ranking-sort.mjs`
- `scripts/validate-visible-quotes-not-ranking-source.mjs`
- `scripts/validate-universe-count-not-fixed.mjs`
- `scripts/validate-scan-updates-dashboard.mjs`
- `scripts/validate-fear-greed-refresh.mjs`
- `scripts/validate-master-indicators-refresh.mjs`
- `scripts/validate-exec-dynamic-guard.mjs`
- `scripts/validate-visible-top8-quotes.mjs`
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `AUDIT.md`
- `MASTER_CODEX_V1.md`

Implementado:

- El fixture TOP 8 mock pasa a ser un pool de candidatos mayor que 8.
- Cada scan construye `dynamicTop8` desde el pool:
  - refresco tecnico/precio mock,
  - salida de score/conviction/risk controlada,
  - orden por score, conviction, menor risk y mejor dataQuality,
  - seleccion de los 8 primeros.
- Cada card TOP 8 queda marcada con `top8Source=MOCK_FALLBACK` y
  `resultScope=MOCK_FALLBACK` cuando el resultado no es global real.
- `System Status` muestra `universeDiscovered`, `universeOperable`,
  `universeEligibleForScore`, `universeRanked`, `finalTop8Count`, Source y
  Scope.
- `universeOperable` refleja mercado USA/Europa abierto/cerrado para no sugerir
  `EXEC` si una region esta cerrada.
- `/api/visible-top8-quotes` pasa a modo `PRICE_ENRICHMENT_ONLY`:
  - POST acepta solo hasta 8 tickers seleccionados por el dashboard,
  - todos deben estar en allowlist interna,
  - rechaza tickers externos,
  - no ordena ni calcula TOP 8,
  - no ejecuta universo, full-run, historico/spread masivo ni scanner.
- GET se mantiene como ruta segura de comprobacion sin query y no decide ranking.
- Leading Sectors se refresca en scan manteniendo el orden MASTER.

Que sigue siendo REAL / MOCK / PARTIAL:

- REAL: cotizaciones visibles y Master Indicators solo si proveedores ya
  configurados responden.
- MOCK: Fear & Greed y el pipeline visible cuando actua como fallback beta.
- MIXED: precio real con score/tecnicos mock/controlados.
- PARTIAL: endpoints de batch/single-invocation siguen parciales y no generan
  TOP 8 global.

Confirmaciones negativas:

- No se modifico conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, Conviction, Risk ni Ranking real.
- No se relajaron guardarrailes de `EXEC`, spread, liquidez, coste, IBKR/PRIIPs
  ni operabilidad.
- No se ejecuto `execute=true`.
- No se ejecuto batch 2, full-run, scanner masivo ni ejecucion automatica.
- No se anadio base de datos, persistencia real, polling financiero, cron,
  workers ni ordenes reales.

Validaciones locales ejecutadas:

- `node --check api/visible-top8-quotes.js` OK.
- `node scripts/validate-dynamic-top8-source.mjs` OK.
- `node scripts/validate-top8-ranking-sort.mjs` OK.
- `node scripts/validate-visible-quotes-not-ranking-source.mjs` OK.
- `node scripts/validate-universe-count-not-fixed.mjs` OK.
- `node scripts/validate-scan-updates-dashboard.mjs` OK.
- `node scripts/validate-fear-greed-refresh.mjs` OK.
- `node scripts/validate-master-indicators-refresh.mjs` OK.
- `node scripts/validate-exec-dynamic-guard.mjs` OK.
- `node scripts/validate-data-mode-integrity.mjs` OK.
- `node scripts/validate-timestamps.mjs` OK.
- `node scripts/validate-visible-top8-quotes.mjs` OK.
- Validadores dashboard existentes OK.
- Validadores Fase 6, 7, 8, 9, 10, 11, 11.1, 11.3, 11.5, 11.6 y 11.7 OK.
- `git diff --check` OK.

Limitacion local:

- `npm` no esta disponible en el PATH local (`command not found: npm`), por lo
  que `npm run build` no pudo ejecutarse aqui.

Estado Vercel:

- GitHub queda sincronizado con `origin/main` tras los commits de esta
  correccion.
- `/` responde HTTP 200, pero sigue sirviendo build anterior
  (`last-modified: 2026-06-01T18:17:35Z`).
- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/universe` OK metadata-only; no full-run.
- `/api/top8` bloquea por `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` OK en dry-run con
  `providerCallsPlanned=0`.
- `/api/master-indicators` OK; TNX sigue `NOT_AVAILABLE`.
- `/api/visible-top8-quotes` sigue devolviendo 404 `NOT_FOUND`; Production aun
  no sirve el endpoint nuevo.
- Prohibido y no ejecutado: `execute=true`, batch 2 o full-run.

Decision de correccion:

- Codigo local y GitHub: OK.
- Produccion Vercel: NO OK hasta que se despliegue el commit `b6451b6` y
  `/api/visible-top8-quotes` responda correctamente.

## Real Data Integrity Fix - 2026-06-01

Contexto:

- Correccion post-cierre beta, no nueva fase.
- Causa raiz: el dashboard podia refrescar datos mock y timestamps visuales con
  apariencia de dato actual/real.
- Riesgo corregido: el usuario podia interpretar precios, Fear & Greed o TOP 8
  mock como informacion real de mercado.

Archivos modificados:

- `api/visible-top8-quotes.js`
- `shared/types/domain.ts`
- `shared/types/index.ts`
- `src/types/index.ts`
- `src/mocks/mockData.ts`
- `src/services/realDataRefresh.ts`
- `src/pages/DashboardPage.tsx`
- `src/components/Top8Grid.tsx`
- `src/components/FearGreedPanel.tsx`
- `src/components/MasterIndicatorsGrid.tsx`
- `src/components/SystemStatusCards.tsx`
- `src/components/ScanStatusPanel.tsx`
- `src/components/ActionButtons.tsx`
- `src/components/StickyMiniHeader.tsx`
- `src/components/TechnicalHeader.tsx`
- `src/utils/export.ts`
- `src/styles.css`
- `scripts/validate-data-mode-integrity.mjs`
- `scripts/validate-visible-top8-quotes.mjs`
- `scripts/validate-exec-real-data-guard.mjs`
- `scripts/validate-fear-greed-labeling.mjs`
- `scripts/validate-timestamps.mjs`
- validadores dashboard existentes ajustados a la nueva regla DataMode
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `AUDIT.md`
- `MASTER_CODEX_V1.md`

Implementado:

- `DataMode = MOCK | REAL | MIXED | STALE | ERROR`.
- `/api/visible-top8-quotes` solo devuelve las 8 cotizaciones visibles internas:
  NVDA, MSFT, AVGO, LLY, ASML, SAP, AIR y REL.
- El endpoint no acepta query libre, no acepta tickers externos, no ejecuta
  universo, no ejecuta TOP 8, no usa historico/spread masivo y no permite
  full-run.
- El boton principal pasa a `REAL QUOTES REFRESH`; la accion manual intenta leer
  cotizaciones visibles y Master Indicators reales seguros.
- Si una cotizacion falla, el dashboard conserva mock solo etiquetado como
  `MOCK`/`ERROR`; no se inventa precio real.
- Cards TOP 8 muestran DataMode, proveedor, cache/timestamp y guardia de EXEC.
- Fear & Greed queda `MOCK`, source `mock`, no operativo.
- Master Indicators pueden quedar `REAL`, `STALE`, `ERROR` o `MOCK`; TNX sigue
  `NOT_AVAILABLE` si el proveedor no lo resuelve.
- Se separan `lastRealDataUpdate`, `lastMockRefresh` y `lastScanClicked`.

Que queda REAL / MOCK / MIXED:

- REAL: cotizaciones visibles y Master Indicators solo cuando responden las
  fuentes ya configuradas.
- MOCK: Fear & Greed y cualquier precio visible no resuelto por proveedor.
- MIXED: TOP 8 cuando el precio es real pero score/tecnicos siguen
  mock/controlados.
- STALE: dato cacheado usado como ultimo valor valido.
- ERROR: dato real no disponible o fallo de lectura.

Confirmaciones negativas:

- No se modifico conceptualmente Score Engine, Conviction, Risk, Ranking,
  Universe Engine, Operability Engine ni Cost Gate.
- No se relajo ningun guardarrail de spread, operabilidad, coste o `EXEC`.
- No se ejecuto `execute=true`.
- No se ejecuto batch real, batch 2, full-run ni ejecucion masiva.
- No se anadio base de datos, persistencia real, auth, polling financiero, cron,
  workers ni ordenes reales.

Validaciones locales ejecutadas durante la correccion:

- `node scripts/validate-data-mode-integrity.mjs` OK.
- `node scripts/validate-visible-top8-quotes.mjs` OK.
- `node scripts/validate-exec-real-data-guard.mjs` OK.
- `node scripts/validate-fear-greed-labeling.mjs` OK.
- `node scripts/validate-timestamps.mjs` OK.
- `node scripts/validate-scanfull-mock-refresh.mjs` OK.
- `node scripts/validate-top8-open-market-exec-eligibility.mjs` OK.
- `node scripts/validate-market-hours.mjs` OK.
- `node scripts/validate-universe-dynamic.mjs` OK.
- `node scripts/validate-top8-closed-market-exec-block.mjs` OK.
- `node --check api/visible-top8-quotes.js` OK.

Limitacion local:

- `npm` no esta disponible en el PATH local de esta sesion; `npm run build` no
  pudo ejecutarse localmente y debe validarse con Vercel tras deploy.

Estado Vercel pre-correccion:

- `/api/health` respondio OK en Production.

Estado Vercel post-push 2026-06-01:

- GitHub quedo sincronizado con `origin/main`.
- `/` responde 200, pero los headers siguen apuntando al build anterior
  (`last-modified: 2026-06-01T18:17:35Z`).
- `/api/health` responde OK.
- `/api/providers-status` responde OK.
- `/api/master-indicators` responde OK con datos reales controlados y TNX
  `NOT_AVAILABLE`.
- `/api/visible-top8-quotes` devuelve 404 `NOT_FOUND`, por lo que Production
  aun no sirve el endpoint nuevo.
- Conclusion operativa: la correccion queda implementada y sincronizada en
  GitHub, pero no puede cerrarse como OK en Vercel hasta que Production despliegue
  el commit final `b93abd7`.

## Estado base consolidado - 2026-05-30

Fuentes revisadas:

- `MASTER_CODEX_V1.md`
- documentacion previa en `docs/`
- auditorias previas en `audits/`
- codigo actual del repositorio
- estado Git local

Estado Git local al crear esta auditoria:

- repositorio limpio antes de esta consolidacion documental.

Estado Vercel:

- proyecto desplegado en Vercel bajo `emrr-2-tendencias.vercel.app`.
- el dashboard fue validado visualmente por el usuario tras despliegue.
- antes de iniciar una fase nueva debe revisarse de nuevo Vercel: build, URL, dashboard y responsive.

## Auditoria Fase 0 / 0.1

Resultado:

- `MASTER_CODEX_V1.md` creado como documento operativo para Codex + Vercel.
- `MASTER v14_1.txt` permanece como documento maestro oficial no operativo.
- Replit queda descartado como entorno objetivo.
- React + TypeScript + Vite queda recomendado para fases iniciales.

Riesgos detectados:

- instrucciones heredadas de Replit podian confundir el despliegue.
- SQLite local no era adecuado como requisito de produccion en Vercel serverless.
- demasiados engines definidos pronto podian generar sobreingenieria.

Decision:

- conservar engines como fronteras modulares, pero sin logica real antes de fases autorizadas.

## Auditoria Fase 1

Resultado:

- dashboard visual mock-only implementado.
- login mock DEV ONLY implementado.
- Header tecnico, System Status, botones, Estado Scan, Fear & Greed, Master Indicators, Sectores lideres y TOP 8 visibles.
- mock data tipado separado de componentes.

Validaciones:

- no se implementaron APIs reales.
- no se implementaron EODHD, Finnhub ni CNN reales.
- no se implementaron scanner, scoring, trailing real ni base de datos.
- no se implementaron usuarios reales, Supabase/Auth ni pagos.
- no se implemento polling, auto-refresh, workers ni cron jobs.

Riesgos:

- UI inicial era funcional, pero visualmente demasiado tecnica y poco premium.
- TOP 8 tenia exceso de campos visibles.

## Auditoria Fase 2

Resultado:

- proyecto consolidado para Vercel con React + TypeScript + Vite.
- `package.json` contiene scripts `dev`, `build` y `preview`.
- `vercel.json` queda configurado para Vite.
- `.env.example` contiene solo placeholders.
- no hay `.replit` ni `replit.nix`.

Validaciones:

- Vercel quedo configurado con:
  - Framework Preset: Vite
  - Install Command: `npm install`
  - Build Command: `npm run build`
  - Output Directory: `dist`
  - variables Fase 2: ninguna
- despliegue Vercel realizado por el usuario.
- dashboard abrio correctamente en Vercel tras correccion de timezone.

Limitacion local:

- en esta sesion Codex no estaba disponible `npm` en el PATH, por lo que la comprobacion local `npm run build` no pudo ejecutarse aqui.

Riesgos antes de Fase 3:

- no llamar APIs reales hasta autorizacion.
- no exponer claves en frontend.
- definir capa API server-side antes de EODHD/Finnhub reales.
- decidir persistencia externa compatible con Vercel solo cuando sea necesaria.

## Auditoria visual premium post-Fase 2

Resultado:

- dashboard evolucionado a estilo premium/institucional.
- `SCAN FULL` convertido en CTA oro viejo dominante.
- botones secundarios mantenidos exactos y con menor jerarquia.
- TOP 8 simplificado visualmente.
- TOP 8 convertido a ranking vertical.
- Score y Conviction con barras finas.
- Conviction con mayor protagonismo.
- trailing visual simplificado a Tight, Medium y Wide.
- colores semanticos preservados para positivos, negativos, cautela y riesgo.

Validaciones:

- no se alteraron formulas, calculos, rankings, scoring, conviccion, riesgo, momentum ni trailing interno.
- no se anadieron APIs reales.
- no se anadieron dependencias nuevas de pago.

Riesgos/deuda:

- revisar responsive real en iPhone 16 Pro Max.
- revisar responsive Android generalista.
- comprobar que no haya solapes en Safari, Chrome y Vercel preview.
- cuando haya datos reales, verificar que los colores respeten intervalos del MASTER oficial.

## Auditoria mercados, hora local y universo mock

Resultado:

- se muestra hora local del dispositivo/navegador como hora principal visible.
- se retira UTC de la vista principal para reducir confusion.
- se separan estados Europe y United States en header y System Status.
- se anade consola tecnica compacta mock para proveedores, llamadas, cache y universo analizado.

Riesgos/deuda:

- el calculo real de mercado abierto/cerrado sigue pendiente.
- debe implementarse en fase futura con timezone oficial del exchange.
- la hora local del usuario no debe sustituir la hora oficial de mercado para calcular OPEN/CLOSED.
- debe contemplarse viaje del usuario a otros paises, cambio de fecha local y DST.

## Auditoria sectores y precio porcentual

Resultado:

- sectores ordenados por porcentaje de periodo descendente.
- porcentaje sectorial positivo en verde y negativo en rojo.
- porcentaje del precio TOP 8 ubicado junto al estado de mercado para evitar solapes con precio.
- `EUR` se visualiza como `€` detras del precio.

Riesgos/deuda:

- en datos reales, el porcentaje de precio debe calcularse contra cierre anterior o ultimo cierre valido.
- EODHD debe ser fuente principal y Finnhub fallback.
- si hay delay de datos, debe indicarse calidad/timestamp del dato.

## Auditoria documental simple - 2026-05-30

Resultado:

- se crean `CHANGELOG.md` y `AUDIT.md` como documentos raiz acumulativos.
- se actualiza `MASTER_CODEX_V1.md` para definir fuente de verdad operativa.
- se mantiene documentacion simple: MASTER + CHANGELOG + AUDIT.

Decision:

- los documentos existentes en `docs/` y `audits/` quedan como historicos por ahora.
- no se borran automaticamente para no perder informacion aprobada.
- en una limpieza futura autorizada, su contenido puede consolidarse y archivarse o eliminarse si ya esta cubierto por `CHANGELOG.md` y `AUDIT.md`.

Bloqueos actuales:

- ninguno para continuar documentando.
- antes de nueva fase se debe revisar Vercel de nuevo.

## Auditoria indicadores superiores de mercado - 2026-05-30

Resultado:

- se refuerza visualmente Europe y United States en la parte superior del dashboard.
- `OPEN` usa verde semantico.
- `CLOSED` usa naranja semantico.
- los indicadores se disenan como pildoras/botones premium centrados y proporcionales al dashboard.
- se mantienen dentro de visual/mock-only.

Validaciones:

- no se implementan APIs reales.
- no se implementa calculo real de horarios.
- no se cambia scanner, scoring, trailing ni ranking.

Riesgos/deuda:

- revisar en Vercel que no haya solapes en iPhone 16 Pro Max ni Android.
- en fase futura, conectar estos estados al `marketHoursEngine` real por exchange timezone.

## Auditoria universo analizado visible - 2026-05-30

Resultado:

- el total de tickers/empresas del universo analizado deja de estar solo en la consola tecnica pequena.
- se muestra como metrica superior normal: `Analysed Universe`.
- se conserva desglose US y Europe en tamano compacto dentro de la misma tarjeta.
- el cambio es visual/mock-only.

Validaciones:

- no se implementa scanner real.
- no se anaden APIs reales.
- no se cambia la muestra mock ni el ranking.

Riesgos/deuda:

- en fase futura, esta metrica debe reflejar el universo realmente procesado por scan.
- si un mercado esta cerrado, debe indicarse claramente en el estado de mercado y no confundirse con el total de universo disponible.

## Auditoria limpieza visual de mercados - 2026-05-30

Resultado:

- se eliminan de `System Status` los duplicados `Europe Market` y `US Market`.
- los mercados quedan representados solo en los indicadores superiores con color:
  verde para `OPEN` y naranja para `CLOSED`.
- se ajusta el layout del header para evitar scroll innecesario en escritorio y mejorar proporcion en movil.

Validaciones:

- cambio visual/mock-only.
- no se modifica calculo real de mercado.
- no se anaden APIs ni polling.

Riesgos/deuda:

- validar en Vercel sobre iPhone 16 Pro Max y desktop que no haya solapes.
- cuando exista `marketHoursEngine` real, conectar estos indicadores superiores como unica fuente visual principal de mercado.

## Auditoria consola tecnica compacta - 2026-05-30

Resultado:

- se elimina `EMRR 2.0` duplicado dentro de la consola tecnica pequena.
- se reordenan los datos para lectura logica:
  proveedores, cache/uptime/API, universo US/Europe y muestra.
- se conserva la consola como informacion tecnica secundaria, por debajo del titulo principal.

Validaciones:

- no se anaden APIs reales.
- no se modifica scanner real.
- no se modifican datos reales ni calculos.

Riesgos/deuda:

- revisar en Vercel que la consola no haga saltos visuales feos en movil.
- en fase futura, conectar esos valores a metricas reales de scan solo cuando exista capa API autorizada.

## Auditoria header principal optimizado - 2026-05-30

Resultado:

- se eliminan los indicadores grandes duplicados de `Europe` y `United States` del header principal.
- se mantiene el estado de mercados solo en la barra superior compacta, donde cambia de color segun `OPEN` o `CLOSED`.
- el header principal queda centrado en hora local, universo analizado, salud del sistema y logout.
- se reduce ruido visual y se mejora la proporcion para escritorio, iPhone y Android.

Validaciones:

- cambio visual/mock-only.
- no se implementan APIs reales.
- no se modifica scanner real, scoring real, trailing real ni ranking.
- no se anaden timers, polling ni auto-refresh.

Riesgos/deuda:

- validar en Vercel que el header quede limpio en Safari desktop y en iPhone 16 Pro Max.
- conectar estados de mercado a un motor real de horarios solo en fase futura autorizada.

## Auditoria logout reubicado - 2026-05-30

Resultado:

- `Logout` se mueve a la zona alta de identidad del dashboard.
- deja de compartir bloque visual con salud, universo y metricas principales.
- queda separado de `SCAN FULL` para reducir riesgo de pulsacion accidental.
- el estilo pasa a ser secundario, discreto y ambar/naranja, coherente con accion de cierre.

Validaciones:

- cambio visual/mock-only.
- no se implementa autenticacion real.
- no se implementa persistencia real de ultima sesion.
- no se anaden APIs, base de datos, Supabase/Auth, polling ni timers.

Riesgos/deuda:

- en fase futura autorizada, el cierre de sesion debe conservar ultimo snapshot valido de scan en cache/persistencia compatible con Vercel.
- si al siguiente scan fallan datos nuevos, el sistema debe mostrar ultimo dato valido con estado de calidad claro, timestamp y aviso de stale/fallback.

## Auditoria proporcionalidad visual - 2026-05-30

Resultado:

- se ajusta la fila superior de metricas para ocupar el ancho disponible con logica visual.
- hora local y universo analizado quedan como dos bloques proporcionados.
- se elimina la tarjeta `HEALTHY` duplicada del header principal.
- `HEALTHY` se mantiene solo en la barra superior compacta.
- se reduce el espacio vacio a la derecha que aparecia tras mover botones y metricas.
- se registra en el MASTER operativo que futuros cambios deben evitar huecos, bloques descompensados y alineaciones sin logica.

Validaciones:

- cambio visual/mock-only.
- no se modifican datos, calculos, APIs, scanner, scoring, trailing ni ranking.
- `Logout` permanece separado de `SCAN FULL`.

Riesgos/deuda:

- validar en Vercel desktop y movil que la fila superior mantenga proporcion en Safari y pantallas pequenas.

## Auditoria termometro sectorial - 2026-05-30

Resultado:

- se incorpora un termometro longitudinal en cada fila de sectores lideres.
- el termometro ocupa el espacio entre el porcentaje y el estado, reduciendo vacios visuales.
- `LEADING` usa mayor longitud y verde fuerte.
- `ACCELERATING` usa longitud alta y verde suave.
- `WEAKENING` usa longitud media-baja y naranja.
- `FALLING` usa longitud baja y rojo.

Validaciones:

- cambio visual/mock-only.
- no se modifica calculo sectorial.
- no se modifica ranking, scanner, scoring, trailing, APIs ni datos reales.
- mantiene responsive: en movil el termometro pasa a ocupar una linea completa dentro de cada fila.

Riesgos/deuda:

- validar en Vercel y Safari que el indicador no genere solapes en iPhone 16 Pro Max ni Android.
- en fase futura, si el MASTER define intervalos exactos por estado, mapear la longitud del termometro a esos intervalos.

## Auditoria limpieza Health Status duplicado - 2026-05-30

Resultado:

- se elimina la tarjeta `Health Status` del bloque `System Status`.
- se mantiene `HEALTHY` solo en la barra superior compacta, evitando informacion repetida.
- el panel principal queda mas limpio y proporcional.

Validaciones:

- cambio visual/mock-only.
- no se modifican APIs, scanner, scoring, trailing, ranking ni datos reales.
- no se anade autenticacion real, Supabase, base de datos, polling ni auto-refresh.

Riesgos/deuda:

- validar en Vercel que el panel `System Status` queda equilibrado en escritorio y movil.

## Auditoria color semantico Health - 2026-05-30

Resultado:

- el indicador superior de salud deja de ser visualmente neutro.
- se mapea `HEALTHY` a verde, `PARTIAL_DATA` a amarillo, `DEGRADED`/`MARKET_CLOSED` a naranja y `ERROR` a rojo.
- se anade fondo suave y borde semantico para lectura rapida.

Validaciones:

- cambio visual/mock-only.
- no se modifican formulas, APIs, scanner, scoring, trailing, ranking ni persistencia.

Riesgos/deuda:

- en fase futura, conectar el estado de salud a validaciones reales de datos, mercado, API y cache.

## Auditoria universo analizado destacado - 2026-05-30

Resultado:

- se corrige la jerarquia visual del bloque `Analysed Universe`.
- el numero total de tickers analizados pasa a mostrarse mas grande y con color dorado.
- el desglose por mercado queda como informacion secundaria.

Validaciones:

- cambio visual/mock-only.
- no se modifica scanner real, universo real, APIs, scoring, ranking ni calculos.

Riesgos/deuda:

- validar en Vercel que el bloque mantiene proporcion en escritorio, iPhone 16 Pro Max y Android.

## Auditoria limpieza universo duplicado - 2026-05-30

Resultado:

- se eliminan las lineas `US ...` y `Europe ...` de la consola tecnica compacta.
- el universo analizado queda representado una sola vez en el bloque principal `Analysed Universe`.
- se reduce ruido y repeticion visual en el header.

Validaciones:

- cambio visual/mock-only.
- no se modifican datos mock, APIs, scanner, scoring, ranking ni calculos.

Riesgos/deuda:

- validar que la consola compacta sigue ocupando el ancho de forma equilibrada en Vercel.

## Auditoria mejora Leading Sectors independiente - 2026-05-30

Resultado:

- se registra `Leading Sectors` como modulo informativo desacoplado del motor principal.
- se elimina la contradiccion documental que ordenaba solo por porcentaje descendente.
- el orden visual queda por estado: `LEADING`, `ACCELERATING`, `WEAKENING`, `FALLING`.
- el porcentaje visible queda definido como rendimiento acumulado de 5 sesiones.
- se reduce el tamano visual del porcentaje para que sea complementario.
- el termometro visual queda asociado a la clasificacion sectorial.

Validaciones:

- no se modifica TOP 8.
- no se modifica ranking, scoring, Conviction, Riesgo, Momentum de activos ni Trailing.
- no se implementan APIs reales ni calculos reales sectoriales.
- el cambio actual sigue siendo mock/visual/documental.

Riesgos/deuda:

- en fase futura de datos reales, implementar la clasificacion sectorial con Momentum 5d, Momentum 20d, EMA20, slope EMA20 y RS frente a SPY.
- asegurar que los ETFs o proxies sectoriales quedan definidos antes de conectar EODHD/Finnhub.

## Auditoria proporcion botones y universo - 2026-05-30

Resultado:

- la banda de botones principales mantiene una distribucion proporcional a todo el ancho del dashboard.
- el bloque `Analysed Universe` queda dividido en informacion izquierda y total derecho.
- el total del universo analizado se reduce de tamano y queda centrado a la derecha del modulo.
- en pantallas pequenas el bloque se apila para preservar legibilidad.

Validaciones:

- cambio visual/mock-only.
- no se modifican datos, APIs, scanner, scoring, ranking, Conviction, Riesgo ni Trailing.
- no se anaden llamadas externas, polling, auto-refresh ni persistencia real.

Riesgos/deuda:

- validar en Vercel que no quedan huecos visuales en escritorio y que en iPhone/Android no aparecen solapes.

## Auditoria Logout alineado con header - 2026-05-30

Resultado:

- `Logout` deja de estar dentro de la linea del subtitulo y pasa a una zona propia del header.
- en escritorio queda alineado visualmente con el bloque `EMRR 2.0` y separado del CTA superior `SCAN FULL`.
- el boton usa el mismo tamano base que el `SCAN FULL` compacto superior.
- el color se adapta al lenguaje visual de mercado cerrado: marron/naranja con borde y glow suaves.
- en movil el boton se apila a ancho completo para preservar legibilidad.

Validaciones:

- cambio visual/mock-only.
- no se modifica autenticacion real.
- no se modifica persistencia de sesion.
- no se modifican APIs, scanner, scoring, ranking, Conviction, Riesgo ni Trailing.

Riesgos/deuda:

- validar en Vercel que la alineacion del boton se mantiene correctamente en Safari, iPhone 16 Pro Max y Android.

## Auditoria UNIVERSE_ENGINE_SPEC - 2026-05-30

Resultado:

- se crea la especificacion definitiva `UNIVERSE_ENGINE_SPEC` en `MASTER_CODEX_V1.md`.
- el universo queda definido como filtro previo a cualquier calculo de Score.
- se separa de Score Engine, Conviction, Risk, Ranking, Trailing y Leading Sectors.
- se fijan mercados incluidos: Nasdaq, NYSE, Xetra, Euronext, Borsa Italiana, SIX y LSE.
- se fijan exclusiones iniciales: OTC, Penny Stocks, warrants, rights, ETNs, SPACs problematicos, instrumentos no operables, activos sin liquidez y activos sin historico suficiente.
- se definen reglas de normalizacion, liquidez minima, volumen minimo, calidad de datos e historico minimo.
- se documenta tamano estimado de universo de 5,000 a 7,500 activos, con referencia mock actual de 6,960.

Auditoria obligatoria:

- Riesgo de universo demasiado pequeno: los filtros de liquidez, historico y mercados incluidos podrian excluir small/mid caps interesantes. Mitigacion: revisar conteo por mercado en Fase 5 antes de bloquear oportunidades validas.
- Riesgo de universo demasiado grande: 5,000 a 7,500 activos puede elevar coste y tiempo de API. Mitigacion: scans manuales, cache, lotes controlados y no polling.
- Riesgo de sesgo geografico: USA tendra mas peso que Europa por cobertura y liquidez. Mitigacion: mostrar conteo separado US/Europe y auditar balance del universo real.
- Riesgo de exclusion de oportunidades: excluir ETFs, OTC, SPACs y activos poco liquidos reduce ruido pero puede dejar fuera oportunidades especiales. Mitigacion: no abrir excepciones sin fase futura autorizada.
- Riesgo de datos inconsistentes: EODHD y Finnhub pueden usar simbolos, sufijos, divisas o exchanges distintos. Mitigacion: identificador canonico `EXCHANGE:TICKER:CURRENCY` y separacion entre ticker visible y ticker API.
- Compatibilidad futura con EODHD/Finnhub: la especificacion respeta EODHD como fuente principal y Finnhub como fallback; falta validar cobertura real por exchange en fases de datos reales.

Validaciones:

- cambio documental.
- no se implementa scanner real.
- no se implementan APIs reales.
- no se modifica TOP 8, ranking, scoring, Conviction, Risk, Trailing ni Leading Sectors.
- no se anaden dependencias, bases de datos, polling ni auto-refresh.

Estado:

- especificacion lista para revision del usuario.
- no continuar a implementacion real del Universe Engine hasta aprobar esta auditoria.

## Auditoria OPERABILITY_ENGINE_SPEC - 2026-05-30

Resultado:

- se crea la especificacion critica `OPERABILITY_ENGINE_SPEC` en `MASTER_CODEX_V1.md`.
- `Operability Engine` queda separado de Universe Engine, Score Engine, Conviction, Risk, Ranking, Trailing y Leading Sectors.
- se define la pregunta central: si el usuario puede comprar realmente el activo desde IBKR con una SL espanola.
- se documenta el perfil base: SL espanola, IBKR, base EUR, restricciones PRIIPs y preferencia por instrumentos operables sin restricciones regulatorias.
- se crean tres estados: `OPERABLE`, `NOT_OPERABLE` y `UNKNOWN`.
- se fija que `UNKNOWN` nunca puede generar `EXEC`.
- se fija que `NOT_OPERABLE` nunca puede entrar en TOP 8 operativo ni generar `EXEC`.
- se fija que solo `OPERABLE` puede continuar hacia score, ranking y validaciones posteriores.

Auditoria obligatoria:

1. Riesgo PRIIPs.
   Productos PRIIPs sin KID/KIID valido para EEA/Espana pueden estar bloqueados. Mitigacion: no asumir operabilidad de ETFs/ETPs/productos estructurados sin confirmacion; ante duda usar `UNKNOWN` o `NOT_OPERABLE`.

2. Riesgo IBKR.
   IBKR puede rechazar un instrumento por permisos, perfil de cuenta, mercado, pais, tipo de producto o clasificacion regulatoria aunque el dato financiero sea correcto. Mitigacion: en fases futuras, incorporar confirmacion o rechazo de IBKR si se autoriza.

3. Riesgo de clasificacion erronea.
   Un ticker puede representar accion ordinaria, ADR, ETF, ETN, preferred share u otro producto. Mitigacion: exigir tipo de instrumento, exchange, divisa y ticker canonico antes de permitir `OPERABLE`.

4. Riesgo de activos bloqueados.
   Suspensiones, delistings, restricciones regulatorias, sanciones, falta de permisos o falta de KID pueden bloquear activos aparentemente validos. Mitigacion: degradar a `NOT_OPERABLE` o `UNKNOWN` cuando aparezca evidencia de bloqueo.

5. Riesgo de falsos positivos.
   Un activo marcado como `OPERABLE` podria ser rechazado despues por IBKR. Mitigacion: `OPERABLE` solo permite continuar evaluando; no garantiza `EXEC`, y cualquier rechazo posterior debe bloquear el activo.

Validaciones:

- cambio documental.
- no se implementa broker check real.
- no se implementan APIs reales.
- no se implementa EODHD real.
- no se implementa Finnhub real.
- no se modifica TOP 8 visual ni ranking real.
- no se modifica scoring.
- no se modifica Conviction.
- no se modifica Risk.
- no se modifica Trailing.
- no se modifica Leading Sectors.
- no se anaden dependencias, bases de datos, polling, auto-refresh ni background jobs.

Fuentes regulatorias/operativas a verificar en fases futuras:

- Reglamento PRIIPs UE 1286/2014: exige documento de datos fundamentales antes de poner PRIIPs a disposicion de inversores minoristas. Referencia: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014R1286
- Documentacion oficial de IBKR sobre restricciones PRIIPs/KID: IBKR indica que debe bloquear trading en un PRIIP si no hay KID disponible, y que clientes retail EEA/UK quedan restringidos si no existe KID. Referencia: https://www.ibkrguides.com/kb/en-us/article-2993.htm

Estado:

- especificacion lista para revision del usuario.
- no continuar a implementacion real del Operability Engine hasta aprobar esta auditoria.

## Auditoria SCORE_ENGINE_SPEC - 2026-05-30

Resultado:

- se crea la especificacion critica `SCORE_ENGINE_SPEC` en `MASTER_CODEX_V1.md`.
- se mantiene intacto `Universe Engine`.
- se mantiene intacto `Operability Engine`.
- `Score Engine` queda definido como motor posterior a Universe, Operability, normalizacion, validacion de datos y market hours.
- se recupera la ponderacion original de 100 puntos.
- se definen formula, subcriterios, penalizaciones, bloqueos duros, Conviction, Risk, Ranking y relacion con `EXEC`.
- se confirma que `Leading Sectors` es solo contexto y no afecta Score, Conviction, Risk, Ranking ni `EXEC`.

Optimizacion actual (%):

```text
EMA20 / EMA50       = 20
RS                  = 20
Momentum            = 15
Continuidad         = 15
RVOL                = 10
Liquidez / Spread   = 10
ATR saludable       = 10
TOTAL               = 100
```

Auditoria obligatoria de ponderaciones:

1. Doble ponderacion entre tendencia y momentum.
   Riesgo: EMA20/EMA50 y Momentum podrian premiar dos veces un activo que solo esta subiendo fuerte en el corto plazo. Mitigacion: EMA20/EMA50 mide estructura; Momentum mide impulso. Penalizar subidas verticales, gaps y extension extrema.

2. Doble ponderacion entre EMA20/EMA50 y continuidad.
   Riesgo: ambos bloques podrian medir tendencia de forma redundante. Mitigacion: EMA20/EMA50 mide posicion/pediente; Continuidad mide calidad del comportamiento, pullbacks y secuencia de maximos/minimos.

3. Riesgo de sobreponderacion.
   Riesgo: tendencia, RS, Momentum y Continuidad suman 70 puntos y pueden dominar la puntuacion. Mitigacion: mantener bloqueos duros por datos, liquidez, spread, operabilidad y mercado.

4. Riesgo de sesgo hacia activos demasiado extendidos.
   Riesgo: activos muy fuertes pueden aparecer arriba justo antes de descanso o correccion. Mitigacion: penalizar distancia excesiva frente a EMA20, gaps, blow-off y RVOL extremo.

5. Riesgo de infravalorar liquidez.
   Riesgo: Liquidez/Spread pesa 10 puntos. Mitigacion: liquidez mala y spread extremo son hard gates, no simples penalizaciones.

6. Riesgo de infravalorar ATR%.
   Riesgo: ATR saludable pesa 10 puntos, pero volatilidad excesiva puede invalidar una operacion. Mitigacion: ATR% excesivo puede penalizar fuerte o bloquear en fases futuras segun umbrales reales.

Mejoras propuestas:

- mantener la ponderacion original en la primera version real.
- conservar trazabilidad por subscore para explicar por que un activo entra en TOP 8.

- auditar con datos reales si Liquidez/Spread debe subir de peso.
- auditar con datos reales si ATR% debe convertirse parcialmente en bloqueo dinamico.
- medir falsos positivos por extension excesiva antes de ajustar pesos.
- no ajustar ponderaciones sin backtest o evidencia real.

Decision:

- mantener ponderacion original.
- no inventar nueva ponderacion en esta fase.
- no implementar scoring real hasta fase autorizada.

Validaciones:

- cambio documental.
- no se implementa scanner real.
- no se implementa scoring real.
- no se implementan APIs reales.
- no se modifica Universe Engine.
- no se modifica Operability Engine.
- no se modifica TOP 8 visual ni ranking real.
- no se modifica Conviction real.
- no se modifica Risk real.
- no se modifica Trailing.
- no se modifica Leading Sectors.
- no se anaden dependencias, bases de datos, polling, auto-refresh ni background jobs.

Estado:

- especificacion lista para revision del usuario.
- Fase 3 queda autorizada despues de esta auditoria; no iniciar implementacion real del Score Engine hasta fase futura aprobada.

## Auditoria Fase 3 - Capa API modular Vercel-ready - 2026-05-30

Resultado:

- se crea la capa API server-side mock compatible con Vercel Functions.
- se anaden rutas `/api/health` y `/api/providers-status`.
- se crean stubs/adaptadores para EODHD y Finnhub.
- se fija EODHD como proveedor principal futuro y Finnhub como fallback futuro.
- se crea `providerRouter` para concentrar prioridad y respuestas mock.
- se crea `apiCostGuard` para impedir llamadas reales durante Fase 3.
- se anaden tipos compartidos de API.
- se anade `ENABLE_REAL_API_CALLS=false` a `.env.example` como placeholder no operativo.

Auditoria tecnica:

1. Arquitectura API:
   - rutas serverless en `api/`, logica modular en `server/` y tipos compartidos
     en `shared/`.
   - compatible con proyecto Vite desplegado en Vercel.

2. Compatibilidad Vercel:
   - `vercel.json` mantiene framework Vite, `npm run build` y output `dist`.
   - las rutas API quedan en carpeta raiz `api/`, patron compatible con Vercel.

3. Seguridad:
   - no se devuelven API keys.
   - no se imprimen secrets.
   - frontend no recibe claves.
   - `.env.example` contiene solo placeholders.

4. Costes:
   - `realApiCallsEnabled` queda siempre `false`.
   - `apiCalls` queda en 0.
   - cualquier intento de llamada real queda bloqueado por diseno.

5. Ausencias validadas:
   - no EODHD real.
   - no Finnhub real.
   - no APIs externas reales.
   - no scanner real.
   - no scoring real.
   - no Universe Engine real.
   - no Operability Engine real.
   - no base de datos real.
   - no Supabase/Auth real.
   - no usuarios reales.
   - no pagos.
   - no polling.
   - no auto-refresh.
   - no background jobs.

Validacion local:

- `npm run build` no pudo ejecutarse con `npm` del sistema porque esta sesion no
  tiene `npm` disponible en PATH.
- el Node embebido de Codex existe, pero no incluye binario `npm`.
- queda pendiente ejecutar `npm install` y `npm run build` desde Terminal o
  entorno con npm antes de aprobar despliegue final.

Checklist Vercel:

- estado actual revisado antes de deploy Fase 3: dashboard publico responde HTTP 200.
- `/api/health` y `/api/providers-status` responden 404 en el deploy actual porque
  la Fase 3 todavia no se ha subido a GitHub/Vercel.
- despues de push a GitHub, Vercel debe desplegar automaticamente.
- comprobar `https://emrr-2-tendencias.vercel.app`.
- comprobar `https://emrr-2-tendencias.vercel.app/api/health`.
- comprobar `https://emrr-2-tendencias.vercel.app/api/providers-status`.
- confirmar JSON valido, ausencia de secrets y ausencia de llamadas reales.

Riesgos antes de Fase 4:

- validar build local con npm real.
- validar que Vercel compila las rutas TypeScript de `api/`.
- no introducir llamadas reales hasta autorizacion expresa de Fase 4.
- definir limites de coste, timeouts y fallback antes de conectar EODHD/Finnhub.

## Auditoria Fix Fase 3 - Rutas API Vercel - 2026-05-31

Incidencia:

- el dashboard publico carga correctamente.
- `/api/health` y `/api/providers-status` devolvian `500 FUNCTION_INVOCATION_FAILED`
  en Vercel despues del deploy de Fase 3.

Correccion:

- se convierten `/api/health` y `/api/providers-status` en funciones serverless
  autosuficientes.
- las rutas devuelven JSON mock/controlado sin depender de imports internos de
  `/server`.
- se mantiene la arquitectura futura en `/server/providers` y `/server/guards`,
  pero no se usa como dependencia runtime de las rutas publicas hasta validacion
  posterior.

Validaciones:

- no se modifico la UI del dashboard.
- no se exponen API keys ni secrets.
- no se anaden llamadas externas reales.
- no se implementa EODHD real.
- no se implementa Finnhub real.
- no se implementa scanner real.
- no se implementa scoring real.
- no se implementa base de datos real.
- no se anaden timers, polling, auto-refresh ni background jobs.

Checklist pendiente:

- ejecutar `git diff --check`.
- ejecutar `npm run build` en entorno con `npm`.
- hacer commit `Fix phase 3 Vercel API routes`.
- hacer `Push origin` desde GitHub Desktop.
- comprobar en Vercel que `/api/health` y `/api/providers-status` devuelven JSON
  y no error 500.

## Auditoria Fase 4 - Integracion controlada EODHD/Finnhub - 2026-05-31

Resultado:

- se anade capa minima de datos reales controlados para Vercel Functions.
- se mantiene EODHD como proveedor principal y Finnhub como fallback.
- se anaden `/api/quote` y `/api/master-indicators`.
- se mantiene el dashboard sin conexion automatica a APIs reales.
- se actualizan `/api/health` y `/api/providers-status` a contrato Fase 4.

Auditoria tecnica:

1. Arquitectura API:
   - las rutas publicas usan helpers ligeros en `/api/_lib` para reducir riesgo
     de error serverless.
   - `/server/providers` y `/server/guards` quedan como arquitectura futura,
     sin ser dependencia runtime de los endpoints publicos.

2. Seguridad:
   - las claves solo se leen server-side.
   - ninguna respuesta JSON devuelve API keys ni valores secretos.
   - `.env.example` mantiene placeholders.

3. Control de costes:
   - `ENABLE_REAL_API_CALLS=true` es obligatorio para llamadas reales.
   - `/api/quote` acepta solo un simbolo.
   - la allowlist inicial queda limitada a `SPY`, `LQD`, `HYG`, `VIX`, `VVIX`,
     `TNX` y `MOVE`.
   - `/api/master-indicators` queda limitado a siete simbolos.
   - las llamadas a proveedor usan timeout server-side de 8 segundos.
   - no hay polling, auto-refresh, timers, cron jobs ni background jobs.

4. Ausencias validadas:
   - no scanner real.
   - no TOP 8 real.
   - no scoring real.
   - no Conviction real.
   - no Risk real.
   - no trailing real.
   - no Universe Engine real completo.
   - no Operability Engine real completo.
   - no base de datos real.
   - no Supabase/Auth real.
   - no usuarios reales.
   - no pagos.

Riesgos antes de Fase 5:

- validar claves reales en Vercel antes de asumir disponibilidad de datos.
- comprobar cobertura de simbolos especiales como `MOVE`, `VIX`, `VVIX` y `TNX`
  en EODHD/Finnhub, porque cada proveedor puede usar ticker distinto.
- definir cache/persistencia autorizada antes de ampliar universo o hacer scans.
- no conectar el frontend a datos reales automaticos hasta aprobar el control de
  coste y frecuencia.

## Auditoria Fix Fase 4 - Imports API Vercel - 2026-05-31

Incidencia:

- el dashboard publico responde correctamente en Vercel.
- las funciones `/api/health`, `/api/providers-status` y
  `/api/master-indicators` devolvian `FUNCTION_INVOCATION_FAILED`.

Correccion:

- se cambian los imports internos de las funciones API y helpers a imports sin
  extension `.ts`, formato mas estable para el empaquetado serverless de Vercel.
- se mantiene la arquitectura `/api/_lib`.
- no se modifica la UI.
- no se activan llamadas reales automaticas.

Validacion pendiente:

- hacer commit y `Push origin`.
- esperar deploy automatico en Vercel.
- comprobar dashboard y endpoints:
  - `https://emrr-2-tendencias.vercel.app`
  - `https://emrr-2-tendencias.vercel.app/api/health`
  - `https://emrr-2-tendencias.vercel.app/api/providers-status`
  - `https://emrr-2-tendencias.vercel.app/api/quote?symbol=SPY`
  - `https://emrr-2-tendencias.vercel.app/api/master-indicators`

## Auditoria Fix Fase 4 - Rutas API autosuficientes Vercel - 2026-05-31

Incidencia:

- despues del fix de imports, Vercel seguia devolviendo `FUNCTION_INVOCATION_FAILED`
  en `/api/health` y `/api/providers-status`.
- el dashboard publico seguia funcionando correctamente.

Correccion:

- se convierten las cuatro rutas publicas de Fase 4 en funciones autosuficientes,
  sin imports locales runtime.
- se mantiene la arquitectura `/api/_lib` como referencia futura, pero no como
  dependencia de los endpoints publicos hasta validar estabilidad completa.
- no se modifica la UI.
- no se exponen secrets.
- no se anaden llamadas automaticas, polling, auto-refresh ni background jobs.

Validacion requerida:

- `git diff --check`: OK.
- prueba directa local con Node 24 y `--experimental-strip-types`: OK para
  `/api/health`, `/api/providers-status`, `/api/quote` y
  `/api/master-indicators`, todas con respuesta `200` en modo `MOCK_ONLY`.
- `npm run build`: no ejecutable en el terminal Codex actual porque `npm` no
  esta disponible; Vercel debe validar build en el deploy.
- commit y `Push origin`.
- Vercel debe devolver JSON, no error 500, en:
  - `https://emrr-2-tendencias.vercel.app/api/health`
  - `https://emrr-2-tendencias.vercel.app/api/providers-status`
  - `https://emrr-2-tendencias.vercel.app/api/quote?symbol=SPY`
  - `https://emrr-2-tendencias.vercel.app/api/master-indicators`

## Auditoria Fix Fase 4 - Rutas API JavaScript Vercel - 2026-05-31

Incidencia:

- el dashboard publico seguia respondiendo `200`.
- las rutas `/api/health`, `/api/providers-status`, `/api/quote?symbol=SPY`
  y `/api/master-indicators` seguian devolviendo `FUNCTION_INVOCATION_FAILED`
  en Vercel.

Correccion:

- se reemplazan las rutas publicas TypeScript por rutas JavaScript ESM simples.
- se mantiene cada ruta autosuficiente y sin imports locales runtime.
- se anade una funcion de respuesta JSON compatible con distintas formas de
  ejecucion serverless.
- se mantiene `/api/_lib` como arquitectura futura, pero no como dependencia de
  las rutas publicas actuales.

Auditoria:

- no se modifica el dashboard visual.
- no se exponen secrets.
- no se activan llamadas automaticas.
- no se implementa scanner real.
- no se implementa TOP 8 real.
- no se implementa scoring real.
- no se implementa trailing real.
- no se implementan base de datos, Supabase, usuarios reales, pagos, polling,
  auto-refresh ni background jobs.

Validacion requerida:

- ejecutar `git diff --check`.
- validar rutas localmente con Node.
- commit y `Push origin`.
- esperar deploy automatico Vercel.
- comprobar que las cuatro rutas API devuelven JSON y no error 500.

## Auditoria Cierre Fase 4 - Vercel real controlado - 2026-05-31

Resultado:

- Fase 4 queda operativa en Vercel con `ENABLE_REAL_API_CALLS=true`.
- EODHD y Finnhub aparecen como `configured`.
- El dashboard publico responde `200`.
- Las cuatro rutas publicas devuelven JSON correcto:
  - `/api/health`
  - `/api/providers-status`
  - `/api/quote?symbol=SPY`
  - `/api/master-indicators`

Datos reales validados:

- `/api/quote?symbol=SPY` devuelve precio real con `providerUsed=EODHD` y
  `dataQuality=GOOD`.
- `/api/master-indicators` devuelve datos reales para `SPY`, `LQD`, `HYG`,
  `VIX`, `VVIX` y `MOVE`.
- `TNX` devuelve `NOT_AVAILABLE`; queda pendiente revisar simbolo/mapeo de
  proveedor antes de considerarlo indicador real fiable.

Guardarrailes validados:

- `AAPL` devuelve `SYMBOL_NOT_ALLOWED`.
- `SPY,LQD` devuelve `MULTI_SYMBOL_BLOCKED`.
- La allowlist sigue limitada a `SPY`, `LQD`, `HYG`, `VIX`, `VVIX`, `TNX` y
  `MOVE`.
- No hay polling, auto-refresh, jobs de fondo ni llamadas automaticas desde el
  dashboard.

Ausencias validadas:

- no scanner real.
- no TOP 8 real.
- no scoring real.
- no Conviction real.
- no Risk real.
- no trailing real.
- no base de datos real.
- no Supabase/Auth real.
- no usuarios reales.
- no pagos.

Estado:

- Fase 4 queda cerrada tecnica y operativamente.
- Antes de Fase 5 se recomienda corregir o decidir el tratamiento de `TNX`.

## Auditoria Fase 5 - Cache controlado, trailing dinamico y hardening previo - 2026-05-31

Precheck:

- `MASTER_CODEX_V1.md`, `CHANGELOG.md`, `AUDIT.md`, codigo actual y Vercel
  fueron revisados antes de modificar.
- El repo estaba limpio y alineado con `origin/main`.
- Vercel respondia correctamente antes de iniciar la fase:
  - `/api/health`
  - `/api/providers-status`
  - `/api/quote?symbol=SPY`
  - `/api/master-indicators`

Implementacion:

- Se anade cache efimero server-side en memoria de runtime para `/api/quote`
  y `/api/master-indicators`.
- El TTL queda fijado en 60 segundos.
- Las respuestas exponen:
  - `cacheStatus`: `HIT`, `MISS`, `BYPASS` o `STALE`.
  - `cachedAtUtc`.
  - `ttlSeconds`.
- Solo se cachean quotes validas. Las respuestas no configuradas o no
  disponibles no se guardan como datos frescos.
- Si existe cache expirado y los proveedores fallan, se puede devolver ultimo
  dato valido como `STALE`.
- `TNX` se remapea en EODHD a `US10Y.GBOND`; debe confirmarse en Vercel tras
  deploy.
- Se implementa `calculateDynamicTrailing` como engine puro, sin llamadas API y
  sin dependencia de UI/proveedores.

Trailing dinamico:

- `trailing_adjusted = ATR% x 0.65`.
- `trailing_medium = ATR% x 1.00`.
- `trailing_wide = ATR% x 1.45`.
- No se introduce cap fijo ni limite maximo hardcoded.
- No se implementa trailing operativo conectado a ordenes.

Validacion local:

- `node --check` OK para las cuatro rutas JavaScript.
- `/api/quote` local en modo mock devuelve `phase=5`, `cacheStatus=BYPASS` y
  `ttlSeconds=60`.
- `/api/master-indicators` local en modo mock devuelve `phase=5`,
  `cacheStatus=BYPASS` y `ttlSeconds=60`.
- Prueba local con fetch simulado:
  - primera llamada `/api/quote`: `MISS`.
  - segunda llamada `/api/quote`: `HIT`.
  - primera llamada `/api/master-indicators`: `MISS`.
  - segunda llamada `/api/master-indicators`: `HIT`.
- `calculateDynamicTrailing({ atrPercent: 2.4 })` devuelve:
  - adjusted `1.56`.
  - medium `2.4`.
  - wide `3.48`.

Pendiente de validacion tras deploy:

- `npm run build` no se pudo ejecutar en este terminal porque `npm` no esta
  disponible.
- Vercel debe validar build y endpoints tras commit/push.
- Confirmar que `TNX` devuelve dato real con `US10Y.GBOND` o documentarlo como
  pendiente si el proveedor no lo permite en el endpoint actual.

Ausencias validadas:

- no scanner real.
- no TOP 8 real.
- no scoring real.
- no Conviction real.
- no Risk real.
- no trailing operativo real.
- no base de datos real.
- no Supabase/Auth real.
- no usuarios reales.
- no pagos.
- no polling.
- no auto-refresh.
- no background jobs.

MASTER_CODEX:

- No requiere cambio funcional para esta fase: ya contempla trailing dinamico y
  cache/persistencia autorizada.
- Existe diferencia de numeracion operativa: el prompt actual denomina Fase 5
  a un bloque que MASTER ubica mas adelante. Se mantiene el alcance del prompt
  aprobado y se documenta aqui.

## Auditoria Cierre Fase 5 - Vercel cache y guardarrailes - 2026-05-31

Estado Vercel comprobado:

- `/api/health` responde `ok=true`, `phase=5`, entorno `production`,
  `realApiCallsEnabled=true`, proveedores EODHD/Finnhub configurados y cache
  `EPHEMERAL_MEMORY` con TTL de 60 segundos.
- `/api/providers-status` responde `mode=CONTROLLED_REAL_DATA`, EODHD como
  proveedor primario, Finnhub como fallback, maximo 1 simbolo por quote, maximo
  7 Master Indicators y sin polling, auto-refresh ni background jobs.
- `/api/quote?symbol=SPY` responde `ok=true`, dato real EODHD,
  `dataQuality=GOOD`, `cacheStatus=MISS/HIT`, `cachedAtUtc` y `ttlSeconds=60`.
- `/api/master-indicators` responde `ok=true`, `phase=5`, allowlist de 7
  simbolos y mensaje explicito de que no ejecuta scanner, ranking, scoring ni
  trailing.

Guardarrailes Vercel:

- `AAPL` devuelve `SYMBOL_NOT_ALLOWED`.
- `SPY,LQD` devuelve `MULTI_SYMBOL_BLOCKED`.
- No se observan secrets en las respuestas.
- Las rutas siguen siendo manuales; el dashboard no dispara llamadas reales de
  forma automatica.

TNX:

- `TNX` sigue devolviendo `NOT_AVAILABLE` en Vercel incluso tras el remapeo
  controlado a `US10Y.GBOND`.
- No se amplia universo ni se fuerza investigacion masiva.
- Queda documentado como indicador pendiente/no fiable para decidir tratamiento
  en una fase futura autorizada.

Conclusion:

- Fase 5 queda aprobada tecnicamente para preparar Fase 6 con aprobacion
  explicita del usuario.
- No se implementa Fase 6.
- No se implementa scanner real.
- No se implementa TOP 8 real.
- No se implementa scoring real.
- No se implementa trailing operativo real.
- No se implementa base de datos real.
- No se implementa polling ni auto-refresh.

## Auditoria Fase 6 - intento piloto anulado - 2026-05-31

Precheck:

- Se revisan `MASTER_CODEX_V1.md`, `CHANGELOG.md`, `AUDIT.md`, `README.md`,
  codigo actual y Vercel antes de modificar.
- Vercel estaba sano en Fase 5:
  - `/api/health` respondia `phase=5`.
  - `/api/providers-status` respondia `CONTROLLED_REAL_DATA`.
  - `/api/quote?symbol=SPY` respondia dato real EODHD.
  - `/api/master-indicators` respondia la allowlist de 7 indicadores.
  - `AAPL` devolvia `SYMBOL_NOT_ALLOWED`.
  - `SPY,LQD` devolvia `MULTI_SYMBOL_BLOCKED`.
- `TNX` seguia `NOT_AVAILABLE`, sin bloquear Fase 6.

Resultado:

- El enfoque de universo piloto fijo queda anulado.
- Una lista manual de tickers no cumple el objetivo de Fase 6.
- `/api/top8` no debe rankear activos hasta que exista Universe Engine
  automatico.
- El Universe Engine automatico debe cubrir Nasdaq, NYSE, Xetra, Euronext,
  Borsa Italiana, SIX y LSE aplicando filtros completos de liquidez, historico,
  operabilidad y calidad de datos.

Controles y ausencias:

- No se conecta el dashboard automaticamente a `/api/top8`.
- No se implementa Fase 7.
- No se implementa scanner masivo.
- No se implementa Universe Engine definitivo.
- No se implementa base de datos real ni SQLite.
- No se implementan snapshots persistentes ni learningLog real.
- No se implementan polling, auto-refresh, workers, cron jobs ni background jobs.
- No se implementan ordenes reales ni trailing operativo conectado a broker.

Validacion local:

- Esta auditoria queda supersedida por la correccion de Universe Engine
  automatico obligatorio.
- `npx`/`npm` no estan disponibles en este terminal; `npm run build` debe
  validarse en entorno con Node/npm o en Vercel.

MASTER_CODEX:

- Debe registrar que Fase 6 no puede depender de lista fija y que Universe,
  Operability y Score specs son condicion previa.

## Auditoria Correccion Fase 6 - Universe, Operability y Score antes de TOP 8 - 2026-05-31

Motivo:

- El usuario rechaza depender de una lista manual fija de 8-20 tickers.
- El enfoque de universo piloto fijo queda anulado como camino valido para Fase 6.
- Antes de continuar Fase 6 se exige especificar y auditar Universe Engine,
  Operability Engine y Score Engine.

Correcciones aplicadas:

- `/api/top8` ya no ejecuta ranking sobre una lista fija.
- `/api/top8` devuelve `UNIVERSE_ENGINE_NOT_IMPLEMENTED` hasta que exista
  Universe Engine automatico y auditado.
- `providers-status` deja de publicar una lista piloto y declara
  `DYNAMIC_UNIVERSE_REQUIRED`.
- `health` declara que Fase 6 requiere Universe Engine automatico antes de TOP 8.
- `README.md` se actualiza para retirar el estado de Fase 6 como TOP 8 activo.
- `MASTER_CODEX_V1.md` registra que Fase 6 no puede usar una lista fija y debe
  usar universo automatico.
- Se crean:
  - `docs/UNIVERSE_ENGINE_SPEC.md`.
  - `docs/OPERABILITY_ENGINE_SPEC.md`.
  - `docs/SCORE_ENGINE_SPEC.md`.

UNIVERSE_ENGINE_SPEC auditado:

- Mercados USA incluidos: Nasdaq y NYSE.
- Mercados Europa incluidos: Xetra, Euronext, Borsa Italiana, SIX y LSE.
- Excluir OTC, Penny Stocks, Warrants, Rights, ETNs, SPACs problematicos,
  activos sin historico suficiente y activos iliquidos.
- No limitar universo a USA.
- No usar lista fija de 8-20 tickers como universo definitivo.

OPERABILITY_ENGINE_SPEC auditado:

- Perfil: SL espanola, IBKR y restricciones PRIIPs.
- Estados: `OPERABLE`, `NOT_OPERABLE`, `UNKNOWN`.
- `UNKNOWN` nunca puede generar `EXEC`.
- `NOT_OPERABLE` no puede entrar en TOP 8 operativo.
- Solo `OPERABLE` puede avanzar a ranking operativo.

SCORE_ENGINE_SPEC auditado:

- Score solo actua despues de Universe Engine, Operability Engine,
  normalizacion, datos validos y market hours.
- Ponderacion mantenida: EMA20/EMA50 20, RS 20, Momentum 15, Continuidad 15,
  RVOL 10, Liquidez/Spread 10 y ATR saludable 10.
- Score alto no compensa mercado cerrado para generar `EXEC`; market status
  no `OPEN` bloquea ejecucion, pero no impide score diagnostico manual si los
  datos tecnicos son validos.
- Score alto no compensa dato invalido, mala liquidez, spread extremo,
  `UNKNOWN` o `NOT_OPERABLE`.

Pendiente real antes de cerrar Fase 6:

- Implementar Universe Engine automatico sobre los mercados incluidos.
- Implementar Operability Engine real o diagnostico suficientemente conservador.
- Implementar scanner controlado por lotes/coste sin polling ni auto-refresh.
- Rehabilitar `/api/top8` solo cuando el universo elegible sea automatico y
  auditado.

Ausencias validadas:

- No se implementa Universe Engine automatico todavia.
- No se implementa TOP 8 operativo real.
- No se implementa scanner masivo.
- No se implementa base de datos real.
- No se implementa polling, auto-refresh ni background jobs.

## Auditoria Fase 6 - Universe Engine metadata discovery inicial - 2026-05-31

Implementacion:

- Se crea `/api/universe` como endpoint manual, GET only.
- No acepta parametros de query; no permite tickers manuales ni exchanges ad hoc.
- Usa EODHD `exchange-symbol-list` para descubrimiento metadata-only de mercados permitidos.
- Mercados solicitados:
  - US para Nasdaq/NYSE.
  - XETRA.
  - AS, PA, BR y LS para Euronext.
  - MI para Borsa Italiana.
  - SW para SIX.
  - LSE.
- El coste queda acotado a 9 listas de exchange por ejecucion y cache efimero de 24h.

Operability Engine aplicado:

- Clasificacion metadata-only:
  - `OPERABLE` para acciones ordinarias con metadata suficiente.
  - `NOT_OPERABLE` para instrumentos excluidos por tipo/nombre.
  - `UNKNOWN` para metadata insuficiente o ambigua.
- La clasificacion no sustituye una confirmacion real futura de IBKR.
- Productos PRIIPs/ETF/ETP ambiguos se excluyen o degradan conservadoramente.

Pendientes antes de activar TOP 8:

- Validar historico suficiente por activo.
- Validar liquidez por activo.
- Validar spread por activo.
- Confirmar operabilidad IBKR/PRIIPs con fuente autorizada o mantener `UNKNOWN`.
- Conectar Score Engine solo despues de Universe + Operability + datos validos.

Validacion local:

- `node --check` OK en `api/universe.js`, `api/health.js`,
  `api/providers-status.js` y `api/top8.js`.
- Sin `ENABLE_REAL_API_CALLS=true`, `/api/universe` devuelve `MOCK_ONLY` y no
  llama proveedores.
- Query ad hoc en `/api/universe` devuelve `QUERY_NOT_ALLOWED`.
- Simulacion local con `fetch` falso descubre 27 activos metadata-only sobre 9
  exchanges, clasifica 9 `OPERABLE`, 18 `NOT_OPERABLE`, 0 `UNKNOWN` y devuelve
  `cacheStatus=MISS`.

Ausencias validadas:

- `/api/top8` sigue bloqueado con `UNIVERSE_ENGINE_NOT_IMPLEMENTED`.
- No se implementa TOP 8 operativo real.
- No se implementa scanner masivo.
- No se implementan polling, auto-refresh ni background jobs.

## Auditoria Fase 6 - Engines puros Universe/Operability/Score - 2026-05-31

Objetivo auditado:

- Evitar que Fase 6 dependa de una lista fija de 8-20 tickers.
- Registrar engines reales, aunque todavia no exista TOP 8 operativo.
- Mantener Universe, Operability y Score separados.

Archivos revisados/creados:

- `api/_lib/universeEngine.js`.
- `api/_lib/operabilityEngine.js`.
- `api/_lib/technicalEngine.js`.
- `api/_lib/eligibilityEngine.js`.
- `api/_lib/scoreEngine.js`.
- `api/_lib/candidateEvaluationEngine.js`.
- `api/_lib/historicalDataProvider.js`.
- `api/_lib/spreadDataProvider.js`.
- `api/_lib/top8Pipeline.js`.
- `api/_lib/top8BatchPlanner.js`.
- `api/universe.js`.
- `api/top8.js`.

Resultado Universe Engine:

- Usa mercados aprobados: US, XETRA, Euronext Amsterdam/Paris/Brussels/Lisbon,
  Borsa Italiana, SIX y LSE.
- No contiene lista fija de tickers.
- Deduplica por ISIN o simbolo proveedor.
- La respuesta publica se limita a una muestra de 50 activos y resumen agregado
  para no convertirse en screener masivo.
- Mantiene pendientes filtros de historico, liquidez, spread y confirmacion IBKR.

Resultado Operability Engine:

- Clasifica metadata como `OPERABLE`, `NOT_OPERABLE` o `UNKNOWN`.
- Excluye instrumentos no permitidos por tipo/nombre: ETF/ETN, warrants,
  rights, preferred, units, funds, bonds, notes, SPACs y derivados.
- `UNKNOWN` genera bloqueo operativo.
- `NOT_OPERABLE` genera bloqueo para TOP 8 operativo.

Resultado Score Engine:

- Es puro y no llama APIs.
- Calcula score solo si existen tecnicos suficientes.
- Bloquea score si falta dato, si la liquidez esta por debajo del minimo Fase 6
  o si operabilidad no es `OPERABLE`.
- Separa bloqueo de ejecucion: si el mercado no esta `OPEN`, registra
  `MARKET_NOT_OPEN` en `executionBlockedReasons`.
- Calcula trailing dinamico ATR-based:
  - `trailing_adjusted = ATR% x 0.65`.
  - `trailing_medium = ATR% x 1.00`.
  - `trailing_wide = ATR% x 1.45`.
- No existe cap fijo 1.5%.

Resultado Technical Engine:

- Es puro y no llama APIs.
- Normaliza OHLCV y exige barras validas.
- Calcula EMA20, EMA50, pendiente EMA20, ATR, ATR%, RVOL, momentum5,
  momentum20, RS20, RS60, avgVolume20, avgValue20 y maxDrawdown20.
- Exige 61 barras para poder calcular RS60 sin dato inventado.

Resultado Eligibility Engine:

- Es puro y no llama APIs.
- Bloquea `UNKNOWN` y `NOT_OPERABLE`.
- Bloquea historico insuficiente.
- Bloquea liquidez insuficiente por `avgValue20`.
- Bloquea spread no verificado o superior al maximo Fase 6.
- Bloquea calidad de dato no buena para score.
- Mercado no `OPEN` bloquea ejecucion/`EXEC`, no score diagnostico.

Resultado Candidate Evaluation Engine:

- Es puro y no llama APIs.
- Orquesta un candidato ya descubierto con OHLCV, benchmark, spread, market
  status y calidad de dato.
- Ejecuta Technical Engine, Eligibility Engine y Score Engine en orden.
- Genera ranking TOP 8 solo desde evaluaciones `OPERABLE`, elegibles y con score.
- `NOT_OPERABLE` y `UNKNOWN` quedan fuera aunque tengan historico valido.

Resultado Historical Data Provider:

- Es interno y no expone endpoint publico.
- Usa EODHD diario solo para `providerSymbol` con sufijo de exchange aprobado.
- Bloquea simbolos fuera de exchanges aprobados y listas multiples.
- Bloquea llamadas si `ENABLE_REAL_API_CALLS` no esta activo.
- Normaliza OHLCV y limita a 260 barras.
- Usa cache efimero con TTL 24h.
- No activa `/api/top8` ni ejecuta scanner.

Resultado Spread Data Provider:

- Es interno y no expone endpoint publico.
- Usa EODHD real-time solo para `providerSymbol` con sufijo de exchange aprobado.
- Bloquea simbolos fuera de exchanges aprobados y listas multiples.
- Bloquea llamadas si `ENABLE_REAL_API_CALLS` no esta activo.
- Calcula spread porcentual desde bid/ask.
- Si bid/ask no son validos, devuelve `SPREAD_NOT_AVAILABLE`.
- Usa cache efimero con TTL 60s.
- No activa `/api/top8` ni ejecuta scanner.

Resultado Top8 Pipeline:

- `/api/top8` se conecta a Universe Engine dinamico.
- `health` y `providers-status` declaran `top8Endpoint=cost_gate_active`.
- No acepta query params, tickers manuales, listas ni exchanges ad hoc.
- Aplica `Cost Gate` antes de historico/spread por candidato.
- Si el universo `OPERABLE` supera 25 candidatos por ejecucion, devuelve
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- En ese caso, no hace llamadas historicas/spread por candidato.
- En universos pequenos/sinteticos, calcula ranking TOP 8 usando Score Engine.
- No genera `EXEC`.

Resultado Top8 Batch Planner:

- Genera lotes deterministicos desde activos `OPERABLE` del universo dinamico.
- No usa lista fija de tickers.
- No acepta tickers manuales.
- Expone resumen por region/exchange y llamadas estimadas.
- No devuelve lista gigante de tickers en la respuesta publica.
- Requiere autorizacion futura antes de procesar lotes reales.

Resultado `/api/top8-batch`:

- Endpoint manual GET.
- Acepta solo `batch=N` y opcional `execute=true`.
- No acepta tickers, listas ni exchanges custom.
- Dry-run por defecto: devuelve lote seleccionado y llamadas estimadas sin
  ejecutar historico/spread.
- `execute=true` ejecuta solo el lote dinamico seleccionado.
- Si market status no esta verificado `OPEN`, Eligibility Engine bloquea
  ejecucion/`EXEC`; el score diagnostico puede calcularse si historico, liquidez,
  spread, calidad y operabilidad son validos.

Validacion local:

- `node --check` OK en los nuevos engines.
- Prueba sintetica:
  - accion ordinaria -> `OPERABLE`.
  - ETF -> `NOT_OPERABLE`.
  - metadata incompleta -> `UNKNOWN`.
  - 20 barras OHLCV -> `INSUFFICIENT_HISTORY`.
  - 70 barras OHLCV -> tecnicos calculados con RS60.
  - spread no verificado -> `SPREAD_NOT_VERIFIED` conservado tambien al pasar por Score Engine.
  - pipeline con tres candidatos sinteticos:
    - `OPERABLE` rankea.
    - `NOT_OPERABLE` queda bloqueado.
    - `UNKNOWN` queda bloqueado.
  - historical provider:
    - `AAA.BAD` bloquea por exchange no aprobado.
    - `AAA.US` bloquea si llamadas reales estan desactivadas.
    - fetch simulado normaliza OHLCV y usa cache `MISS` -> `HIT`.
  - spread provider:
    - `AAA.BAD` bloquea por exchange no aprobado.
    - `AAA.US` bloquea si llamadas reales estan desactivadas.
    - bid 99.9 / ask 100.1 genera spread 0.2%.
    - payload sin bid/ask devuelve `SPREAD_NOT_AVAILABLE`.
    - fetch simulado usa cache `MISS` -> `HIT`.
  - top8 pipeline:
    - 30 candidatos `OPERABLE` activan `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
    - el bloqueo incluye `batchPlan` con lotes de 25 y llamadas estimadas.
    - universo sintetico pequeno genera ranking con score.
    - `/api/top8?symbol=AAPL` devuelve `QUERY_NOT_ALLOWED`.
    - `/api/top8` sin APIs reales devuelve `UNIVERSE_DISCOVERY_NOT_READY`.
    - `/api/top8-batch?batch=1` dry-run no ejecuta historico/spread.
    - `/api/top8-batch?symbol=AAPL&batch=1` devuelve `QUERY_NOT_ALLOWED`.
    - `/api/top8-batch?batch=1&execute=true&runId=...` procesa solo un lote sintetico,
      calcula score diagnostico si el resto de datos es valido y bloquea
      ejecucion con `MARKET_NOT_OPEN` si market status queda `UNKNOWN`.
  - `UNKNOWN` devuelve accion `BLOCKED` en Score Engine.
  - ATR% 3.2 genera trailing wide 4.64, confirmando que no hay cap 1.5%.

Estado de `/api/top8`:

- Sigue bloqueado.
- Error actual: `UNIVERSE_ELIGIBILITY_NOT_COMPLETE`.
- No calcula TOP 8 ni ranking operativo hasta completar elegibilidad dinamica.

Pendiente real:

- Desplegar la correccion de salida limitada en Vercel; la version observada en
  produccion todavia devolvia demasiados activos en `/api/universe`.
- Implementar validacion historica por activo descubierto.
- Definir estrategia de batching/coste para universos grandes sin convertir EMRR
  en screener masivo.

## Auditoria Fase 6 - Validacion Vercel y score vs ejecucion - 2026-05-31

Validacion local:

- `node --check` OK en:
  - `api/top8.js`.
  - `api/top8-batch.js`.
  - `api/universe.js`.
  - `api/_lib/top8Pipeline.js`.
  - `api/_lib/top8BatchPlanner.js`.
  - `api/_lib/eligibilityEngine.js`.
  - `api/_lib/scoreEngine.js`.
  - `api/_lib/candidateEvaluationEngine.js`.
- Prueba sintetica `OPERABLE` con market status `UNKNOWN`:
  - calcula score diagnostico.
  - devuelve accion no ejecutiva `WATCH`.
  - `eligibleForScore=true`.
  - `eligibleForExecution=false`.
  - `executionBlockedReasons=["MARKET_NOT_OPEN"]`.
- Prueba sintetica `UNKNOWN` / `NOT_OPERABLE`:
  - bloquea score.
  - bloquea ejecucion.
- `/api/top8-batch?batch=1&execute=true&runId=...` con fetch simulado procesa un lote
  sintetico, calcula score diagnostico y mantiene bloqueo de ejecucion si
  market status no esta `OPEN`.
- `git diff --check` OK.
- No quedan los 12 tickers piloto como universo activo.
- `npm run build` no se pudo ejecutar en este terminal porque `npm` no esta
  instalado/disponible.

Validacion Vercel:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/quote?symbol=SPY` OK.
- `/api/master-indicators` OK.
- `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/top8` bloquea con `COST_GATE_REQUIRES_BATCHING_STRATEGY` y no ejecuta
  llamadas historicas/spread masivas.
- `/api/top8-batch?batch=1` responde en dry-run y no ejecuta historico/spread.
- `TNX` sigue `NOT_AVAILABLE`, documentado como pendiente/no fiable.

Estado:

- Fase 6 esta bien encaminada tecnicamente para universo dinamico y cost gate.
- No queda cerrada como TOP 8 global operativo porque falta estrategia aprobada
  para procesar/agregar lotes dinamicos sin coste masivo ni efecto screener.
- No se implementa Fase 7.
- No se implementa base de datos, polling, auto-refresh, background jobs,
  scanner masivo ni ordenes reales.
- Definir fuente autorizada para confirmacion IBKR/PRIIPs o mantener
  `UNKNOWN` conservador.
- Conectar Score Engine a candidatos elegibles solo cuando los filtros anteriores
  esten completos y auditados.

## Auditoria Fase 6 - Agregacion efimera de lotes dinamicos - 2026-05-31

Implementacion:

- Se crea `api/_lib/top8RunStore.js`.
- Se crea `/api/top8-run`.
- Se amplía `/api/top8-batch` para aceptar `runId`; es opcional en dry-run y
  obligatorio cuando `execute=true`.
- `health` y `providers-status` declaran `top8RunEndpoint`.

Reglas validadas:

- La sesion de run no acepta tickers, listas ni exchanges manuales.
- `create=true` solo descubre universo dinamico y crea estado efimero.
- Crear run no ejecuta historico/spread.
- Ejecutar batch requiere `execute=true` y `runId`.
- La agregacion conserva como maximo 8 candidatos.
- La sesion guarda `universeFingerprint` y `universeSignature` para validar que
  los batches pertenecen al mismo universo dinamico descubierto al crear el run.
- `universeFingerprint` se calcula desde hashes internos de activos `OPERABLE`
  ordenados, sin exponer una lista gigante de tickers.
- La firma detecta cambios de composicion aunque los conteos sean iguales.
- Un `runId` inexistente bloquea antes de ejecutar llamadas externas.
- Un batch ya adjuntado bloquea antes de repetir historico/spread y evita doble
  conteo de llamadas.
- La salida del run informa cobertura de universo:
  - `completedBatchCount`,
  - `remainingBatchCount`,
  - `nextBatchNumber`,
  - `isGlobalTop8Final`.
- Un TOP 8 agregado solo puede tratarse como global/final si
  `isGlobalTop8Final=true`.
- `/api/top8-final` entrega activos solo si el run esta completo.
- `/api/top8-final` no ejecuta llamadas externas y bloquea runs parciales con
  `RUN_NOT_COMPLETE`.
- `/api/top8-batch` exige `runId` cuando `execute=true` para impedir resultados
  parciales sueltos.
- No se usa lista fija de acciones.
- No se implementa persistencia real.
- No se implementan polling, auto-refresh, workers, cron ni background jobs.

Limitaciones:

- El estado vive solo en memoria runtime de Vercel.
- El TTL de run es 30 minutos y se conservan como maximo 5 sesiones.
- En Vercel serverless, una sesion puede perderse si cambia el runtime.
- El TOP 8 global solo es final si todos los lotes dinamicos autorizados se
  procesan dentro de la misma sesion viva.

Validacion local:

- `node --check` OK en:
  - `api/_lib/top8RunStore.js`.
  - `api/top8-run.js`.
  - `api/top8-batch.js`.
  - `api/health.js`.
  - `api/providers-status.js`.
- Simulacion con fetch falso:
  - `/api/top8-run?create=true` crea run con 0 llamadas historicas/spread.
  - `/api/top8-batch?batch=1&execute=true&runId=...` adjunta candidatos.
  - `/api/top8-run?runId=...` devuelve run `COMPLETE` en universo sintetico de un lote.
  - el run informa `remainingBatchCount=0`, `nextBatchNumber=null` e
    `isGlobalTop8Final=true` cuando todos los lotes sinteticos se procesan.
  - `/api/top8-final?runId=...` devuelve activos solo tras completar el run.
  - `/api/top8-final` bloquea querys con tickers/listas.
  - `/api/top8-batch?batch=1&execute=true` sin `runId` devuelve
    `RUN_ID_REQUIRED_FOR_EXECUTION`.
  - repetir el mismo batch devuelve `BATCH_ALREADY_ATTACHED` y no suma llamadas.
  - `runId` inexistente devuelve `RUN_NOT_FOUND` con 0 llamadas externas.
  - dos universos sinteticos con los mismos conteos pero distintos activos
    generan fingerprints/firmas diferentes.
  - si el universo cambia entre crear run y ejecutar batch, devuelve
    `RUN_UNIVERSE_MISMATCH` antes de historico/spread.
- Se anade `scripts/validate-phase6.mjs` como validacion local sin dependencias
  externas para comprobar:
  - ausencia de lista piloto fija en archivos criticos,
  - bloqueo de batch ejecutado sin `runId`,
  - creacion de run,
  - bloqueo de finalizacion temprana,
  - adjuncion de batch,
  - bloqueo de batch duplicado sin nuevas llamadas,
  - finalizacion solo con run completo,
  - bloqueo de querys ad hoc en `/api/top8-final`.

Validacion Vercel posterior inicial:

- `/api/health` responde, pero todavia no declara `top8RunEndpoint` ni
  `top8FinalEndpoint`.
- `/api/top8-run?create=true` devuelve `NOT_FOUND`.
- `/api/top8-final?runId=test` devuelve `NOT_FOUND`.
- Conclusion: los cambios de agregacion/finalizacion estan validados en local,
  pero aun no estan desplegados en Vercel.
- Fase 6 no debe considerarse cerrada hasta hacer commit/push/deploy y validar
  los endpoints nuevos en produccion.

Nota posterior:

- Esta situacion quedo resuelta en el cierre final de Fase 6 tras
  commit/push/deploy y validacion segura en Vercel.

## Auditoria Cierre Final Fase 6 - Vercel, documentacion y guardarrailes - 2026-05-31

Estado Git/GitHub:

- `git status -sb` devuelve `## main...origin/main`, sin commits locales
  pendientes.
- Ultimos commits relevantes:
  - `2632b14 Add phase6 validation script`.
  - `28e54a9 Add dynamic top8 run finalization`.
- El usuario borro el token GitHub expuesto tras el push.

Validacion local:

- `node scripts/validate-phase6.mjs` OK:
  `Phase 6 validation OK: dynamic universe flow, run aggregation, finalization and guardrails passed.`
- `git diff --check` OK.
- `npm run build` no pudo ejecutarse en este terminal porque `npm` no esta
  disponible (`command not found: npm`); la validacion de build queda delegada a
  Vercel/entorno con Node/npm.

Checklist Vercel seguro:

- `/api/health` OK con `phase=6`, `top8RunEndpoint` y `top8FinalEndpoint`
  activos.
- `/api/providers-status` OK; EODHD y Finnhub configurados; sin polling,
  auto-refresh ni background jobs.
- `/api/quote?symbol=SPY` OK con dato real controlado de EODHD y cache efimero.
- `/api/master-indicators` OK; no ejecuta scanner/ranking/scoring/trailing.
- `TNX` sigue `NOT_AVAILABLE`, documentado como pendiente/no fiable y no apto
  para decisiones operativas.
- `/api/top8-run?create=true` OK; crea run manual efimero, `dryRun=true` y
  `providerCallsPlanned=0`.
- `/api/top8-final?runId=test` OK; devuelve `RUN_NOT_FOUND`, confirmando que el
  endpoint existe y bloquea runs invalidos.

Guardarrailes confirmados:

- No se ejecuto ningun batch real con `execute=true` durante este cierre.
- No hay llamadas automaticas desde el dashboard.
- No se implementa Fase 7.
- No se implementa base de datos real, SQLite, Redis, Vercel KV, snapshots
  persistentes ni learningLog real.
- No se implementa polling, auto-refresh, workers, cron ni background jobs.
- No se implementa scanner masivo automatico ni ordenes reales.
- El TOP 8 global solo puede considerarse final si todos los lotes dinamicos
  autorizados se procesan en la misma sesion runtime viva y
  `isGlobalTop8Final=true`.

Riesgos pendientes:

- La agregacion de runs vive en memoria efimera de Vercel; puede perderse si el
  runtime cambia o expira el TTL.
- Procesar todo el universo dinamico con `execute=true` puede implicar muchas
  llamadas de proveedor; requiere autorizacion y estrategia de coste antes de
  uso operativo.
- Falta fuente autorizada para confirmar IBKR/PRIIPs; mientras tanto, los casos
  no verificables deben permanecer conservadores.
- `TNX` continua no fiable hasta resolver proveedor/mapeo validado.

Estado MASTER_CODEX_V1.md:

- No requiere modificacion funcional en este cierre. Ya registra que Fase 6 no
  puede usar lista fija, exige Universe/Operability/Score Engine y describe la
  agregacion efimera manual.

Estado final:

- Fase 6 queda cerrada documentalmente y validada de forma segura en Vercel.
- No se avanza a Fase 7.

## Auditoria Fase 7 - Hardening final, testing y cost safety - 2026-05-31

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimo commit inicial: `3749b02 Close phase 6 documentation`.
- Vercel estaba sano antes de modificar:
  - `/api/health` OK con `phase=6`.
  - `/api/providers-status` OK.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.

Implementacion:

- `/api/top8-batch` acepta `confirm` como query permitida.
- `execute=true` con `runId` pero sin `confirm=EXECUTE_BATCH` devuelve
  `EXECUTION_CONFIRMATION_REQUIRED`.
- El bloqueo de confirmacion ocurre antes de descubrir universo o consumir
  historico/spread.
- `execute=true` sin `runId` sigue devolviendo
  `RUN_ID_REQUIRED_FOR_EXECUTION`.
- El dry-run `/api/top8-batch?batch=N` sigue sin ejecutar historico/spread.
- `/api/top8-run` informa la ruta completa segura con
  `confirm=EXECUTE_BATCH`.
- Se crea `scripts/validate-phase7.mjs`.
- Se anade `npm run check:phase7`.
- Se ajusta `scripts/validate-phase6.mjs` para incluir la confirmacion explicita
  en ejecuciones simuladas.
- `MASTER_CODEX_V1.md` queda actualizado con la regla Fase 7 de doble
  confirmacion.

Validacion local:

- `node --check api/top8-batch.js` OK.
- `node --check scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK:
  `Phase 7 validation OK: execution confirmation, dry-run safety, run finalization and guardrails passed.`
- `git diff --check` OK.
- `npm run check:phase7` no pudo ejecutarse en este terminal porque `npm` no
  esta disponible (`command not found: npm`); la validacion equivalente directa
  con `node scripts/validate-phase7.mjs` fue OK.
- `npm run build` no pudo ejecutarse en este terminal porque `npm` no esta
  disponible (`command not found: npm`); Vercel debe validar build/deploy tras
  push.

Checklist Vercel posterior al deploy:

- Commit desplegado: `0818357 Add phase 8 cost policy planning`.
- `/api/health` OK; expone
  `phase8Readiness.costPolicy=PHASE_8_COST_POLICY_V1`,
  `fullUniverseExecutionAllowed=false` y
  `manualBatchLimitPerSession=1`.
- `/api/providers-status` OK; expone
  `costControls.top8CostPolicy=PHASE_8_COST_POLICY_V1`,
  `fullUniverseExecutionAllowed=false` y mantiene `polling=false`,
  `autoRefresh=false`, `backgroundJobs=false`.
- `/api/quote?symbol=SPY` OK con dato real controlado.
- `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/master-indicators` OK; `TNX` sigue `NOT_AVAILABLE`.
- `/api/top8-run?create=true` OK; crea run efimero con
  `providerCallsPlanned=0`, `costPolicy.status=SAFE_DRY_RUN`,
  `estimatedFullRunProviderCalls=43593` y
  `fullUniverseExecutionAllowed=false`.
- `/api/top8-batch?batch=1` OK en dry-run; devuelve
  `providerCallsPlanned=0`, `costPolicy.status=SAFE_DRY_RUN`,
  `costPolicy.fullRunStatus=COST_TOO_HIGH`,
  `estimatedProviderCalls=51`,
  `estimatedFullRunProviderCalls=43593` y
  `fullUniverseExecutionAllowed=false`.
- `/api/top8` OK como bloqueo seguro; devuelve
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`,
  `costPolicy.status=COST_TOO_HIGH`,
  `estimatedFullRunProviderCalls=43593` y no calcula TOP 8.
- `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuto ninguna ruta con `execute=true` durante la validacion Vercel.

Checklist Vercel permitido para cierre:

- Se comprobaron solo rutas seguras:
  - `/api/health` OK con `phase=6`.
  - `/api/providers-status` OK con controles de coste activos.
  - `/api/quote?symbol=SPY` OK.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
  - `/api/master-indicators` OK; `TNX` sigue `NOT_AVAILABLE`.
  - `/api/top8-run?create=true` OK; crea run efimero y
    `providerCallsPlanned=0`.
  - `/api/top8-batch?batch=1` OK en dry-run; devuelve
    `confirmationRequiredForExecution=confirm=EXECUTE_BATCH`,
    `providerCallsPlanned=0` y no ejecuta historico/spread.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuto ninguna ruta con `execute=true` en Vercel durante Fase 7.

Guardarrailes confirmados:

- No se implementa Fase 8.
- No se anade base de datos real, SQLite, Redis, Vercel KV, snapshots
  persistentes ni learningLog real.
- No se anaden polling, auto-refresh, workers, cron, sockets ni background jobs.
- No se implementa scanner masivo automatico ni ordenes reales.
- `TNX` sigue pendiente/no fiable y no bloquea Fase 7.

Riesgos pendientes:

- La agregacion de runs sigue siendo efimera en memoria Vercel.
- Procesar batches reales con `execute=true` consume llamadas de proveedor y
  exige autorizacion expresa.
- Falta una estrategia futura de coste/lotes para uso operativo real sin efecto
  screener masivo.

## Auditoria Fase 8 - Estrategia de coste y lotes sin ejecucion masiva - 2026-05-31

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `dd8ceff Document phase 7 Vercel validation`.
  - `fb313df Add phase 7 cost safety hardening`.
- Vercel estaba sano antes de modificar:
  - `/api/health` OK.
  - `/api/providers-status` OK.
  - `/api/quote?symbol=SPY` OK.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
  - `/api/master-indicators` OK; `TNX` sigue `NOT_AVAILABLE`.
  - `/api/top8-run?create=true` OK con `providerCallsPlanned=0`.
  - `/api/top8-batch?batch=1` OK en dry-run y sin historico/spread.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuto ninguna ruta con `execute=true` en Vercel.

Implementacion:

- Se crea `api/_lib/top8CostPolicy.js` como capa pura de politica de coste.
- Estados disponibles:
  - `SAFE_DRY_RUN`.
  - `MANUAL_APPROVAL_REQUIRED`.
  - `COST_TOO_HIGH`.
  - `NOT_OPERATIONAL_FULL_RUN`.
- `/api/top8`, `/api/top8-run` y `/api/top8-batch` devuelven metadatos de
  coste:
  - `costPolicy`.
  - `estimatedProviderCalls`.
  - `estimatedFullRunProviderCalls`.
  - `manualApprovalRequired`.
  - `recommendedNextAction`.
  - `fullUniverseExecutionAllowed=false`.
- `/api/health` y `/api/providers-status` informan la politica Fase 8 como
  metadata de readiness/cost controls.
- `/api/top8-batch` mantiene `execute=true` protegido por `runId` y
  `confirm=EXECUTE_BATCH`.
- No se crea endpoint nuevo, persistencia, base de datos ni servicio externo.
- Se anade `scripts/validate-phase8.mjs` y `npm run check:phase8`.
- `MASTER_CODEX_V1.md` se actualiza para registrar la regla Fase 8 de politica
  de coste.

Validacion local:

- `node --check api/_lib/top8CostPolicy.js` OK.
- `node --check scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK:
  `Phase 8 validation OK: cost policy, safe metadata, dry-run behavior and no-cost guardrails passed.`
- `git diff --check` OK.
- `npm run check:phase8` no pudo ejecutarse en este terminal porque `npm` no
  esta disponible (`command not found: npm`); la validacion equivalente directa
  con `node scripts/validate-phase8.mjs` fue OK.
- `npm run build` no pudo ejecutarse en este terminal porque `npm` no esta
  disponible (`command not found: npm`); Vercel debe validar build/deploy tras
  push.

Guardarrailes confirmados:

- No se ejecuto `execute=true` en Vercel.
- No se implementa Fase 9.
- No se implementa scanner masivo automatico ni TOP 8 operativo final
  automatico.
- No se procesa el universo completo en produccion.
- No se anade base de datos real, SQLite, Redis, Vercel KV, Supabase ni
  Firebase.
- No se anaden polling, auto-refresh, cron, workers, sockets ni background
  jobs.
- No se anaden usuarios reales, auth real, broker integration ni ordenes reales.

Riesgos pendientes:

- La agregacion de runs sigue siendo efimera en memoria Vercel.
- Cualquier batch real con `execute=true` sigue consumiendo llamadas de
  proveedor y requiere autorizacion explicita.
- `TNX` sigue `NOT_AVAILABLE`, pendiente/no fiable y no apto para decisiones
  operativas.

## Auditoria Fase 10 - TNX controlled diagnostic y estabilizacion informativa - 2026-05-31

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `40ea5e6 Document phase 9 Vercel validation`.
  - `8745f2f Add phase 9 partial batch traceability`.
- Vercel estaba sano antes de modificar:
  - `/api/health` OK.
  - `/api/providers-status` OK.
  - `/api/quote?symbol=SPY` OK.
  - `/api/quote?symbol=TNX` responde estable con `dataQuality=NOT_AVAILABLE`.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
  - `/api/master-indicators` OK; `TNX` sigue `NOT_AVAILABLE`.
  - `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
  - `/api/top8-run?create=true` crea run efimero con `providerCallsPlanned=0`.
  - `/api/top8-batch?batch=1` sigue en dry-run parcial.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuto ninguna ruta con `execute=true`.

Implementacion:

- Se anaden metadatos informativos a `/api/quote` y `/api/master-indicators`:
  - `isInformationalOnly=true`.
  - `affectsScore=false`.
  - `affectsRanking=false`.
  - `affectsExec=false`.
- TNX mantiene los mapeos controlados `US10Y.GBOND` y `^TNX`.
- TNX expone `diagnosticStatus` y `providerSymbolsTried`.
- Si TNX no tiene precio valido, queda `TNX_PROVIDER_UNRESOLVED` y
  `dataQuality=NOT_AVAILABLE`.
- Se actualizan tipos compartidos en `shared/types/api.ts` y
  `api/_lib/marketData.ts`.
- Se crea `scripts/validate-phase10.mjs`.
- Se anade `npm run check:phase10`.
- `MASTER_CODEX_V1.md` se actualiza con la regla Fase 10 de TNX y Master
  Indicators informativos.

Validacion local:

- `node --check api/quote.js` OK.
- `node --check api/master-indicators.js` OK.
- `node --check scripts/validate-phase10.mjs` OK.
- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `npm run check:phase10` no pudo ejecutarse en este terminal porque `npm` no
  esta disponible (`command not found: npm`); la validacion equivalente directa
  con `node scripts/validate-phase10.mjs` fue OK.
- `npm run build` no pudo ejecutarse en este terminal porque `npm` no esta
  disponible (`command not found: npm`); Vercel valida build/deploy tras push.

Checklist Vercel seguro:

- Solo se comprobaron rutas seguras sin `execute=true`.
- Commit desplegado en Production: `9f625fe`.
- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/quote?symbol=SPY` OK.
- `/api/quote?symbol=TNX` responde estable con:
  - `dataQuality=NOT_AVAILABLE`.
  - `providerUsed=none`.
  - `fallbackUsed=false`.
  - `isInformationalOnly=true`.
  - `affectsScore=false`.
  - `affectsRanking=false`.
  - `affectsExec=false`.
  - `diagnosticStatus=TNX_PROVIDER_UNRESOLVED`.
  - `providerSymbolsTried={eodhd:US10Y.GBOND,finnhub:^TNX}`.
- `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/master-indicators` OK, mantiene los 7 indicadores allowlisted y marca
  todos como informativos.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-run?create=true` crea run efimero con `providerCallsPlanned=0`.
- `/api/top8-batch?batch=1` sigue en dry-run parcial con
  `resultScope=PARTIAL_BATCH_ONLY`, `actualProviderCalls=null` y
  `fullUniverseExecutionAllowed=false`.
- `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.

Guardarrailes confirmados:

- TNX es informativo/no operativo.
- TNX no afecta score, ranking, EXEC ni TOP 8.
- No se implementa Fase 11.
- No se ejecuta full-run.
- No se procesa el universo completo.
- No se ejecuta ningun lote real.
- No se anade automatizacion, base de datos real, SQLite, Redis, Vercel KV,
  Supabase, Firebase, polling, auto-refresh, cron, workers, sockets ni
  background jobs.

Riesgos pendientes:

- TNX puede seguir `NOT_AVAILABLE` si EODHD/Finnhub no devuelven precio valido
  para los mapeos controlados actuales.
- La agregacion de runs sigue siendo efimera en memoria Vercel.
- La politica de coste es conservadora y no sustituye una futura decision de
  presupuesto operativo real.

## Auditoria Fase 9 - Trazabilidad de lote parcial sin ejecucion real por defecto - 2026-05-31

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `5439926 Document phase 8 Vercel validation`.
  - `0818357 Add phase 8 cost policy planning`.
- Vercel estaba sano antes de modificar:
  - `/api/health` OK.
  - `/api/providers-status` OK.
  - `/api/quote?symbol=SPY` OK.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
  - `/api/master-indicators` OK; `TNX` sigue `NOT_AVAILABLE`.
  - `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY` y
    `costPolicy.status=COST_TOO_HIGH`.
  - `/api/top8-run?create=true` OK con `providerCallsPlanned=0`.
  - `/api/top8-batch?batch=1` OK en dry-run.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuto ninguna ruta con `execute=true` en Vercel.

Implementacion:

- Se crea `api/_lib/top8ResultMetadata.js`.
- `/api/top8-batch` anade:
  - `batchExecutionMode`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isPartialResult=true`.
  - `isGlobalTop8Final=false`.
  - `executedBatchCount`.
  - `remainingBatchCount`.
  - `actualProviderCalls`.
- `/api/top8-final` refuerza que `RUN_NOT_COMPLETE` es parcial, no TOP 8
  global, y no ejecuta llamadas externas.
- `/api/top8-final` solo expone `resultScope=GLOBAL_TOP8_FINAL` cuando el run
  esta completo.
- Se crea `scripts/validate-phase9.mjs`.
- Se anade `npm run check:phase9`.
- `MASTER_CODEX_V1.md` se actualiza con la regla Fase 9 de resultado parcial.

Validacion local:

- `node --check api/_lib/top8ResultMetadata.js` OK.
- `node --check api/top8-batch.js` OK.
- `node --check api/top8-final.js` OK.
- `node --check scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `git diff --check` OK.
- `npm run check:phase9` no pudo ejecutarse en este terminal porque `npm` no
  esta disponible (`command not found: npm`); la validacion equivalente directa
  con `node scripts/validate-phase9.mjs` fue OK.
- `npm run build` no pudo ejecutarse en este terminal porque `npm` no esta
  disponible (`command not found: npm`); Vercel valida build/deploy tras push.

Checklist Vercel seguro:

- No se ejecuta ningun lote real con `execute=true` porque no existe
  autorizacion textual explicita del usuario.
- Solo se comprobaron rutas seguras sin `execute=true`.
- Commit desplegado en Production: `8745f2f Add phase 9 partial batch traceability`.
- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/quote?symbol=SPY` OK.
- `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/master-indicators` OK; `TNX` sigue `NOT_AVAILABLE`.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`,
  `costPolicy.status=COST_TOO_HIGH` y
  `fullUniverseExecutionAllowed=false`.
- `/api/top8-run?create=true` crea run efimero con `providerCallsPlanned=0`.
- `/api/top8-batch?batch=1` sigue en dry-run y expone
  `batchExecutionMode=DRY_RUN`, `resultScope=PARTIAL_BATCH_ONLY`,
  `isPartialResult=true`, `isGlobalTop8Final=false`,
  `remainingBatchCount=855` y `actualProviderCalls=null`.
- `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.

Guardarrailes confirmados:

- No se implementa Fase 10.
- No se ejecuta full-run.
- No se procesa el universo completo.
- No se anade automatizacion de batches.
- No se anade base de datos real, SQLite, Redis, Vercel KV, Supabase ni
  Firebase.
- No se anaden polling, auto-refresh, cron, workers, sockets ni background
  jobs.
- No se anaden usuarios reales, auth real, broker integration ni ordenes reales.

Riesgos pendientes:

- La agregacion de runs sigue siendo efimera en memoria Vercel.
- Cualquier batch real futuro con `execute=true` consume llamadas de proveedor y
  requiere autorizacion textual explicita.
- `TNX` sigue `NOT_AVAILABLE`, pendiente/no fiable y no apto para decisiones
  operativas.

## Auditoria Fase 11 - Validacion controlada de un unico lote real autorizado - 2026-05-31

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `947f403 Document phase 10 Vercel validation`.
  - `9f625fe a`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - rutas `top8-run`, `top8-batch`, `top8-final`.
- Vercel estaba sano antes del intento real:
  - `/api/health` OK.
  - `/api/providers-status` OK.
  - `/api/quote?symbol=SPY` OK.
  - `/api/quote?symbol=TNX` OK estable con `TNX_PROVIDER_UNRESOLVED`.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
  - `/api/master-indicators` OK.
  - `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
  - `/api/top8-batch?batch=1` OK en dry-run con
    `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
    `resultScope=PARTIAL_BATCH_ONLY`, `actualProviderCalls=null` y
    `fullUniverseExecutionAllowed=false`.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.

Autorizacion y ejecucion:

- Autorizacion recibida: `AUTORIZO EJECUTAR UN UNICO LOTE REAL: batch=1`.
- Run creado:
  - `runId=e59d1a39-e943-41e0-8d45-87ca36a4f0bb`.
  - `providerCallsPlanned=0`.
  - `completedBatchCount=0`.
  - `remainingBatchCount=855`.
  - `fullUniverseExecutionAllowed=false`.
- Se intento exactamente una vez:
  - `/api/top8-batch?batch=1&execute=true&runId=e59d1a39-e943-41e0-8d45-87ca36a4f0bb&confirm=EXECUTE_BATCH`.
- Resultado:
  - `ok=false`.
  - `error=RUN_NOT_FOUND`.
  - `providerCallsPlanned=0`.
  - `actualProviderCalls=null`.
  - `assets=[]`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isPartialResult=true`.
  - `isGlobalTop8Final=false`.
- El bloqueo ocurre antes de descubrir universo para ejecucion y antes de
  consumir historico/spread.
- No se reintento el lote real.
- No se ejecuto `batch=2`.
- No se ejecuto full-run.

Comprobaciones posteriores:

- `/api/top8-run?runId=e59d1a39-e943-41e0-8d45-87ca36a4f0bb` devolvio el run
  parcial desde la funcion de run:
  - `completedBatchCount=0`.
  - `remainingBatchCount=855`.
  - `processedProviderCalls=0`.
- `/api/top8-final?runId=e59d1a39-e943-41e0-8d45-87ca36a4f0bb` devolvio
  `RUN_NOT_FOUND` desde la funcion de finalizacion.
- Diagnostico: el run store efimero en memoria no es compartido de forma fiable
  entre funciones/runtime Vercel (`top8-run`, `top8-batch`, `top8-final`).

Implementacion documental/validacion:

- Se crea `scripts/validate-phase11.mjs`.
- Se anade `npm run check:phase11`.
- `README.md` documenta el intento unico, el bloqueo `RUN_NOT_FOUND`, el coste
  cero y el riesgo de handoff efimero en Vercel.
- `CHANGELOG.md` documenta Fase 11 como validacion segura con bloqueo operativo.
- `MASTER_CODEX_V1.md` se actualiza con la regla Fase 11.

Validacion local:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `npm run check:phase11` no pudo ejecutarse en este terminal porque `npm` no
  esta disponible (`command not found: npm`); la validacion equivalente directa
  con `node scripts/validate-phase11.mjs` fue OK.
- `npm run build` no pudo ejecutarse en este terminal porque `npm` no esta
  disponible (`command not found: npm`); Vercel queda como validacion de
  build/deploy tras push.

Estado TNX:

- TNX sigue `NOT_AVAILABLE`.
- TNX es informativo/no operativo.
- TNX no afecta score, ranking, EXEC ni TOP 8.

Guardarrailes confirmados:

- Solo se intento una ejecucion real autorizada.
- No hubo llamadas reales historicas/spread porque `RUN_NOT_FOUND` bloqueo antes
  de coste.
- No se ejecuto full-run.
- No se ejecuto batch 2.
- No se implementa Fase 12.
- No se anade automatizacion, polling, auto-refresh, cron, workers, sockets,
  background jobs ni base de datos real.
- No se anade SQLite, Redis, Vercel KV, Supabase ni Firebase.

## Auditoria Fase 11.6 - Decision controlada spread Europa/Euronext - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `2892208 Add phase 11.5 controlled spread policy`.
  - `75db26d Document phase 11.4 diagnostic execution`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/_lib/spreadPolicy.js`.
  - `api/_lib/eligibilityEngine.js`.
  - `api/_lib/candidateEvaluationEngine.js`.
  - `api/top8-batch-single.js`.

Checklist Vercel seguro pre-implementacion:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  `providerCallsPlanned=0`, `estimatedProviderCalls=51`,
  `resultScope=PARTIAL_BATCH_ONLY` y `fullUniverseExecutionAllowed=false`.

Decision Fase 11.6:

- Se adopta como estado actual
  `EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK`.
- Europa/Euronext queda solo como diagnostico no operativo mientras no exista
  bid/ask verificable.
- `SPREAD_NOT_VERIFIED` sigue bloqueando `EXEC`.
- Los activos sin spread verificable no pueden entrar en TOP 8 global operativo.
- Cualquier comprobacion futura con las dos fuentes financieras ya configuradas
  debe ser puntual, manual, trazable, sin cambio de configuracion, sin
  persistencia y sin autorizar `EXEC`.

Implementacion:

- `api/_lib/spreadPolicy.js` anade `SPREAD_CONTINUATION_POLICY` y
  `getSpreadContinuationPolicy`.
- La politica expone:
  - `unverifiedSpreadExecAllowed=false`.
  - `unverifiedSpreadGlobalTop8Allowed=false`.
  - `requiresVerifiedBidAsk=true`.
  - `productionProviderChecksAllowed=PUNCTUAL_MANUAL_ONLY`.
  - `productionProviderCheckScope=EXISTING_CONFIGURED_SOURCES_ONLY`.
  - `configurationChangeAllowed=false`.
  - `providerChangeAllowed=false`.
  - `persistenceAllowed=false`.
  - `spreadProxyOperationalAllowed=false`.
- `/api/top8-batch-single?batch=1` expone
  `spreadContinuationDecision` en dry-run sin ejecutar proveedores.
- Se crea `scripts/validate-phase11-6.mjs` y `npm run check:phase11-6`.

Fuentes financieras:

- No se consultaron directamente EODHD/Finnhub durante Fase 11.6.
- No fue necesario para cerrar la decision: la auditoria usa los resultados
  reales ya registrados de Fase 11.4 y endpoints Vercel seguros.
- No se modificaron variables de entorno ni configuracion Vercel.

Estado `MASTER_CODEX_V1.md`:

- Actualizado con la regla Fase 11.6 para dejar constancia normativa de la
  continuidad Europa/Euronext como diagnostico no operativo hasta bid/ask
  verificable.

Checks locales:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `node scripts/validate-phase11-6.mjs` OK.
- `npm run build` no pudo ejecutarse localmente:
  `command not found: npm`.
- Vercel se usa como validacion de despliegue/build cuando el terminal local no
  dispone de `npm`.

Post-deploy Vercel seguro:

- Commit desplegado desde GitHub: `b2c0b86 Add phase 11.6 spread continuation policy`.
- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`,
  `fullUniverseExecutionAllowed=false` y `estimatedFullRunProviderCalls=43791`
  en la comprobacion posterior.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  - `providerCallsPlanned=0`.
  - `estimatedProviderCalls=51`.
  - `diagnosticMode=DRY_RUN_COST_METADATA_ONLY`.
  - `spreadContinuationDecision.version=PHASE_11_6_SPREAD_CONTINUATION_POLICY_V1`.
  - `spreadContinuationDecision.spreadContinuationPolicy=EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK`.
  - `spreadContinuationDecision.unverifiedSpreadExecAllowed=false`.
  - `spreadContinuationDecision.unverifiedSpreadGlobalTop8Allowed=false`.
  - `spreadContinuationDecision.requiresVerifiedBidAsk=true`.
  - `spreadContinuationDecision.productionProviderChecksAllowed=PUNCTUAL_MANUAL_ONLY`.
  - `spreadContinuationDecision.configurationChangeAllowed=false`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isGlobalTop8Final=false`.
  - `fullUniverseExecutionAllowed=false`.
- No se comprobo ninguna ruta con `execute=true`.

Riesgos pendientes:

- Si los proveedores configurados no ofrecen bid/ask fiable para Europa, no
  habra `EXEC` ni TOP 8 global operativo para esos activos.
- Una fase posterior puede autorizar una prueba puntual de fuentes ya
  configuradas, pero no debe convertir proxy o ausencia de spread en dato
  operativo.

Confirmaciones negativas:

- No se ejecuto `execute=true`.
- No se ejecuto batch 2.
- No se hizo full-run.
- No se implementa Fase 12.
- No se permite `EXEC` sin bid/ask verificable.
- No se inventa spread.
- No se cambia configuracion del proyecto.
- No se anaden proveedores nuevos.
- No se anade base de datos, persistencia real, polling, auto-refresh, cron,
  workers, sockets ni background jobs.

## Auditoria Fase 11.7 - Prueba manual disenada de spread bid/ask verificable - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `6a8a76e Document phase 11.6 Vercel validation`.
  - `b2c0b86 Add phase 11.6 spread continuation policy`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/_lib/spreadPolicy.js`.
  - `api/_lib/spreadDataProvider.js`.
  - `api/_lib/eligibilityEngine.js`.
  - `api/_lib/candidateEvaluationEngine.js`.
  - `api/top8-batch-single.js`.

Checklist Vercel seguro pre-implementacion:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  `providerCallsPlanned=0`, `estimatedProviderCalls=51`,
  `spreadContinuationDecision.version=PHASE_11_6_SPREAD_CONTINUATION_POLICY_V1`
  y `fullUniverseExecutionAllowed=false`.

Diseno Fase 11.7:

- Se crea `api/_lib/spreadVerificationPolicy.js` como helper puro.
- No se crea endpoint publico nuevo.
- No se llama a proveedores reales.
- La politica Fase 11.7 define `SPREAD_VERIFICATION_DIAGNOSTIC_ONLY`.
- El resultado sigue siendo diagnostico:
  - `execAllowed=false`.
  - `globalTop8Allowed=false`.
  - `verificationResultScope=DIAGNOSTIC_ONLY`.
  - `requiresRealBidAsk=true`.
- Criterios estrictos de bid/ask verificable:
  bid numerico, ask numerico, bid > 0, ask > bid, proveedor y simbolo proveedor
  identificados, timestamp/contexto claro, sin mock, sin proxy y sin fallback
  silencioso.

Fuentes financieras:

- No se consultaron directamente EODHD/Finnhub durante Fase 11.7.
- La fase queda como diseno tecnico y validacion local sin coste.
- Cualquier prueba real futura debe ser puntual, manual, trazable, con fuentes
  ya configuradas, sin cambio de configuracion, sin persistencia y sin autorizar
  `EXEC`.

Estado `MASTER_CODEX_V1.md`:

- Actualizado con la regla Fase 11.7 para dejar constancia normativa de los
  criterios de bid/ask verificable y del alcance diagnostico.

Checks locales:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `node scripts/validate-phase11-6.mjs` OK.
- `node scripts/validate-phase11-7.mjs` OK.
- `npm run build` no pudo ejecutarse localmente:
  `command not found: npm`.
- Vercel se usa como validacion de despliegue/build cuando el terminal local no
  dispone de `npm`.

Post-deploy Vercel seguro:

- Commit desplegado desde GitHub: `3929b03 Add phase 11.7 spread verification policy`.
- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`,
  `fullUniverseExecutionAllowed=false` y `estimatedFullRunProviderCalls=43816`
  en la comprobacion posterior.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  - `providerCallsPlanned=0`.
  - `estimatedProviderCalls=51`.
  - `diagnosticMode=DRY_RUN_COST_METADATA_ONLY`.
  - `spreadContinuationDecision.version=PHASE_11_6_SPREAD_CONTINUATION_POLICY_V1`.
  - `spreadContinuationDecision.spreadContinuationPolicy=EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isGlobalTop8Final=false`.
  - `fullUniverseExecutionAllowed=false`.
- No se comprobo ninguna ruta con `execute=true`.
- Fase 11.7 no crea endpoint publico nuevo; por tanto Vercel valida estabilidad
  de la superficie existente y la ausencia de regresiones operativas.

Riesgos pendientes:

- Aunque se disene la validacion, todavia no se ha demostrado que EODHD/Finnhub
  devuelvan bid/ask verificable para Europa/Euronext.
- Una fase posterior puede autorizar una comprobacion real puntual, pero no debe
  convertir el resultado en `EXEC` ni TOP 8 global operativo.

Confirmaciones negativas:

- No se ejecuto `execute=true`.
- No se ejecuto batch 2.
- No se hizo full-run.
- No se implementa Fase 12.
- No se permite `EXEC`.
- No se creo endpoint publico nuevo.
- No se consultaron proveedores reales.
- No se cambia configuracion del proyecto.
- No se anaden proveedores nuevos.
- No se anade base de datos, persistencia real, polling, auto-refresh, cron,
  workers, sockets ni background jobs.

## Auditoria Fase 11.5 - Politica controlada de spread Europa/Euronext - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimo commit inicial: `75db26d Document phase 11.4 diagnostic execution`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/top8-batch-single.js`.
  - `api/_lib/top8Pipeline.js`.
  - `api/_lib/candidateEvaluationEngine.js`.
  - `api/_lib/eligibilityEngine.js`.
  - `api/_lib/spreadDataProvider.js`.
  - `api/_lib/scoreEngine.js`.

Precheck Vercel seguro:

- `/api/health` OK.
- `/api/providers-status` OK.
- Primer intento seguro de `/api/top8` y `/api/top8-batch-single?batch=1`
  devolvio `UNIVERSE_DISCOVERY_NOT_READY`; se repitio una sola vez sin
  `execute=true` para descartar fallo transitorio.
- Reintento seguro OK:
  - `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
  - `/api/top8-batch-single?batch=1` responde dry-run con
    `providerCallsPlanned=0`, `estimatedProviderCalls=51` y
    `fullUniverseExecutionAllowed=false`.
- No se ejecuto ninguna URL con `execute=true`.

Cambios implementados:

- Se crea `api/_lib/spreadPolicy.js` como helper puro, sin llamadas externas.
- La politica clasifica:
  - `SPREAD_VERIFIED`.
  - `SPREAD_NOT_AVAILABLE`.
  - `SPREAD_NOT_VERIFIED`.
  - `SPREAD_DIAGNOSTIC_ONLY`.
  - `SPREAD_BLOCKS_EXEC`.
- `api/_lib/eligibilityEngine.js` incorpora `spreadPolicy` y conserva
  `SPREAD_NOT_VERIFIED` como bloqueo duro.
- `api/_lib/candidateEvaluationEngine.js` expone la politica en diagnosticos por
  activo y agrega `spreadPolicyCounts`.
- `api/top8-batch-single.js` actualiza el resumen manual de ultima ejecucion real
  a Fase 11.4 y anade categorias de politica de spread al dry-run.
- Se crea `scripts/validate-phase11-5.mjs` y `check:phase11-5`.

Politica resultante:

- Spread verificado y dentro del maximo puede seguir el flujo normal.
- Spread no disponible o no verificado queda como diagnostico no operativo.
- Ante spread no verificado solo se permiten estados no operativos:
  `BLOCKED`, `STANDBY` o `WATCH_DIAGNOSTIC_ONLY`.
- `EXEC` queda prohibido cuando el spread no esta verificado.
- Activos con spread no verificado no entran en TOP 8 global operativo.
- No se inventa spread, no se calcula proxy operativo y no se relajan umbrales de
  liquidez, historico, ATR, calidad de dato ni market hours.

Checks locales:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `npm run build` no pudo ejecutarse localmente: `command not found: npm`.

Checklist Vercel final seguro:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` sigue funcionando en dry-run con
  `providerCallsPlanned=0`, `estimatedProviderCalls=51` y
  `fullUniverseExecutionAllowed=false`.
- No se ejecuto ninguna URL con `execute=true`.

Estado de TNX:

- TNX sigue informativo/no operativo.
- TNX no afecta score, ranking, EXEC ni TOP 8.
- TNX no bloquea Fase 11.5.

Riesgos pendientes:

- El lote 1 de Euronext Amsterdam seguira sin activos elegibles mientras no
  exista spread verificable o una politica posterior explicitamente autorizada.
- La siguiente fase deberia decidir si se mantiene diagnostico no operativo para
  Europa o si se prueba una fuente/procedimiento controlado de spread, sin
  permitir `EXEC` hasta verificar bid/ask real.

Guardarrailes confirmados:

- No se ejecuta `execute=true`.
- No se ejecuta batch 2.
- No se ejecuta full-run.
- No se genera TOP 8 global.
- No se implementa Fase 12.
- No se crea base de datos real ni persistencia real.
- No se anaden automatismos, polling, auto-refresh, cron, workers, sockets ni
  background jobs.

## Auditoria Fase 11.3 - Diagnostico de elegibilidad del lote 1 sin nueva ejecucion real - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimo commit inicial: `dd57f25 Document phase 11.2 single batch validation`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/top8-batch-single.js`.
  - `api/_lib/top8Pipeline.js`.
  - `api/_lib/candidateEvaluationEngine.js`.
  - `api/_lib/eligibilityEngine.js`.
  - `api/_lib/technicalEngine.js`.
  - `api/_lib/historicalDataProvider.js`.
  - `api/_lib/spreadDataProvider.js`.
  - `api/_lib/universeEngine.js`.
  - `api/_lib/top8BatchPlanner.js`.
  - scripts de validacion Fase 6 a Fase 11.1.

Precheck Vercel seguro, sin `execute=true`:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  `providerCallsPlanned=0`, `estimatedProviderCalls=51`,
  `resultScope=PARTIAL_BATCH_ONLY`, `singleInvocation=true` y
  `fullUniverseExecutionAllowed=false`.

Diagnostico:

- Fase 11.2 produjo `NO_ELIGIBLE_ASSETS_AFTER_VALIDATION` con 25 activos
  analizados, 0 elegibles y 25 bloqueados.
- La causa exacta por activo del run real de Fase 11.2 no se puede reconstruir
  desde la respuesta ya recibida, porque esa respuesta no exponia
  `evaluations`, `blockedReasons` por activo ni motivos agregados.
- El codigo si calculaba evaluaciones internas, pero no devolvia diagnostico
  suficiente en respuestas `NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`.
- Causa raiz tecnica del problema de auditoria: falta de exposicion de razones
  de bloqueo por activo en la respuesta del pipeline, no fallo de handoff ni
  fallo de guardarrailes.
- Causas operativas probables, ahora trazables en futuras respuestas:
  historico insuficiente, proveedor historico sin barras validas, spread no
  verificable, liquidez insuficiente, ATR% invalido, calidad de dato o reglas de
  elegibilidad.

Cambios aplicados:

- `api/_lib/candidateEvaluationEngine.js`:
  - acepta `historyStatus` y `spreadStatus`.
  - anade `buildEligibilityDiagnostics`.
  - agrega conteos por razon de bloqueo, proveedor, tecnicos y ejecucion.
  - devuelve muestra controlada `perAssetBlockedReasons`.
- `api/_lib/top8Pipeline.js`:
  - conserva estado de historico y spread por activo.
  - devuelve `eligibilityDiagnostics` en el resultado del pipeline.
- `api/top8-batch-single.js`:
  - dry-run expone `diagnosticMode=DRY_RUN_COST_METADATA_ONLY`.
  - dry-run declara `requiresRealExecutionForPerAssetReasons=true`.
  - respuestas futuras de ejecucion incluyen `eligibilityDiagnostics`.
  - se documenta `lastRealRunSummary` manual de Fase 11.2 sin persistencia.
- `scripts/validate-phase11-3.mjs`:
  - reproduce con mocks 25 activos analizados, 0 elegibles y razones por activo.
  - valida que el dry-run no llama historico/spread.
  - valida que no se introduce run store, full-run, persistencia ni automatismos.
- `package.json`:
  - anade `check:phase11-3`.
- `README.md`, `CHANGELOG.md`, `AUDIT.md` y `MASTER_CODEX_V1.md` actualizados.

Checks locales:

- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `npm run check:phase11-3` no pudo ejecutarse localmente:
  `command not found: npm`.
- `npm run build` no pudo ejecutarse localmente:
  `command not found: npm`.
- Vercel se usa como validacion de despliegue/build cuando el terminal local no
  dispone de `npm`.

Post-deploy Vercel seguro:

- Commit desplegado desde GitHub: `32c2b31 Add phase 11.3 eligibility diagnostics`.
- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  - `providerCallsPlanned=0`.
  - `estimatedProviderCalls=51`.
  - `diagnosticMode=DRY_RUN_COST_METADATA_ONLY`.
  - `eligibilityDiagnosticsAvailable=false`.
  - `requiresRealExecutionForPerAssetReasons=true`.
  - `lastRealRunSummary.error=NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`.
  - `lastRealRunSummary.evaluationSummary.blocked=25`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isGlobalTop8Final=false`.
  - `fullUniverseExecutionAllowed=false`.
- No se comprobo ninguna ruta con `execute=true`.

Estado de TNX:

- TNX sigue informativo/no operativo.
- TNX no afecta score, ranking, EXEC ni TOP 8.
- TNX no bloquea Fase 11.3.

Riesgos pendientes:

- El resultado real de Fase 11.2 no permite saber la razon exacta por activo ya
  ejecutado; la nueva exposicion diagnostica aplica a futuras ejecuciones
  autorizadas.
- Si se necesita causa real exacta del lote 1, la siguiente fase debe autorizar
  de forma expresa una unica ejecucion diagnostica con la nueva salida
  `eligibilityDiagnostics`, manteniendo control de coste y sin batch 2.
- El universo completo sigue bloqueado por coste y no debe ejecutarse como
  full-run.

Guardarrailes confirmados:

- No se ejecuta `execute=true`.
- No se ejecuta lote real.
- No se ejecuta batch 2.
- No se ejecuta full-run.
- No se implementa Fase 12.
- No se crea base de datos real ni persistencia real.
- No se anaden automatismos, polling, auto-refresh, cron, workers, sockets ni
  background jobs.

## Auditoria Fase 11.4 - Ejecucion diagnostica real unica con eligibility diagnostics - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimo commit inicial: `875fe53 Document phase 11.3 Vercel validation`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/top8-batch-single.js`.
  - `api/_lib/candidateEvaluationEngine.js`.
  - `api/_lib/top8Pipeline.js`.
- Validacion local sin coste:
  - `git diff --check` OK.
  - `node scripts/validate-phase6.mjs` OK.
  - `node scripts/validate-phase7.mjs` OK.
  - `node scripts/validate-phase8.mjs` OK.
  - `node scripts/validate-phase9.mjs` OK.
  - `node scripts/validate-phase10.mjs` OK.
  - `node scripts/validate-phase11.mjs` OK.
  - `node scripts/validate-phase11-1.mjs` OK.
  - `node scripts/validate-phase11-3.mjs` OK.

Precheck Vercel seguro:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  - `providerCallsPlanned=0`.
  - `estimatedProviderCalls=51`.
  - `diagnosticMode=DRY_RUN_COST_METADATA_ONLY`.
  - `fullUniverseExecutionAllowed=false`.

Ejecucion real autorizada:

- Se ejecuta exactamente una vez:
  `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH`.
- No se repite la ejecucion.
- No se ejecuta batch 2.
- No se ejecuta full-run.

Resultado de la ejecucion:

- HTTP status: `409`.
- Timestamp UTC: `2026-06-01T09:30:11.235Z`.
- `ok=false`.
- `phase=11.1` en respuesta del endpoint, esperado porque Fase 11.4 valida la
  ruta creada en Fase 11.1.
- `dryRun=false`.
- `error=NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`.
- `providerCallsPlanned=51`.
- `actualProviderCalls=51`.
- `estimatedProviderCalls=51`.
- `selectedAssets=25`.
- `assets=[]`.
- `evaluationSummary.analyzed=25`.
- `evaluationSummary.eligibleForScore=0`.
- `evaluationSummary.blocked=25`.
- `evaluationSummary.operable=25`.
- `resultScope=PARTIAL_BATCH_ONLY`.
- `isPartialResult=true`.
- `isGlobalTop8Final=false`.
- `singleInvocation=true`.
- `fullUniverseExecutionAllowed=false`.

Eligibility diagnostics reales:

- `diagnosticMode=PIPELINE_EVALUATION`.
- `eligibilityDiagnosticsAvailable=true`.
- `requiresRealExecutionForPerAssetReasons=false`.
- `blockingReasonCounts`:
  - `SPREAD_NOT_VERIFIED=25`.
  - `UNIVERSE_ELIGIBILITY_NOT_COMPLETE=25`.
  - `ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM=14`.
  - `LIQUIDITY_BELOW_PHASE6_MINIMUM=14`.
  - `INSUFFICIENT_HISTORY=1`.
  - `INVALID_ATR_PERCENT=1`.
  - `TECHNICALS_MISSING=1`.
- `providerReasonCounts`:
  - `SPREAD_NOT_AVAILABLE=25`.
- `technicalReasonCounts`:
  - `INSUFFICIENT_HISTORY=1`.
- `executionReasonCounts`:
  - `MARKET_NOT_OPEN=25`.

Causa raiz:

- Causa principal: el proveedor no devuelve spread verificable para ninguno de
  los 25 activos del lote 1, todos Euronext Amsterdam.
- La regla `SPREAD_NOT_VERIFIED` bloquea correctamente la elegibilidad para
  score operativo y evita cualquier `EXEC`.
- Causa secundaria: 14 activos tambien incumplen el umbral de liquidez media
  (`ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM` / `LIQUIDITY_BELOW_PHASE6_MINIMUM`).
- Caso individual adicional: `COLT.AS` tiene solo 32 barras validas y queda con
  `INSUFFICIENT_HISTORY`, `TECHNICALS_MISSING` e `INVALID_ATR_PERCENT`.
- `MARKET_NOT_OPEN=25` bloquea ejecucion, pero no es la causa principal de que
  `eligibleForScore=0`.

Post-ejecucion Vercel seguro:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` sigue funcionando en dry-run con
  `providerCallsPlanned=0`, `estimatedProviderCalls=51` y
  `fullUniverseExecutionAllowed=false`.

Estado de TNX:

- TNX sigue informativo/no operativo.
- TNX no afecta score, ranking, EXEC ni TOP 8.
- TNX no bloquea Fase 11.4.

Riesgos pendientes:

- Mientras el spread para Euronext Amsterdam no sea verificable con el proveedor
  actual, el lote 1 no podra generar activos elegibles sin relajar guardarrailes.
- Relajar `SPREAD_NOT_VERIFIED` no esta autorizado y seria un cambio operativo
  de riesgo.
- La siguiente fase deberia revisar una alternativa controlada para spread o una
  politica explicita de diagnostico no-operativo, sin generar `EXEC`.

Guardarrailes confirmados:

- Se ejecuta una sola llamada real autorizada.
- No se repite la ejecucion.
- No se ejecuta batch 2.
- No se ejecuta full-run.
- No se genera TOP 8 global.
- No se implementa Fase 12.
- No se crea base de datos real ni persistencia real.
- No se anaden automatismos, polling, auto-refresh, cron, workers, sockets ni
  background jobs.

Riesgos pendientes:

- Fase 11 detecta que la agregacion efimera en memoria Vercel no sirve como
  handoff fiable entre endpoints separados para ejecutar batches reales.
- Antes de otro intento real debe decidirse una solucion compatible con control
  de coste:
  - token de run stateless firmado sin persistencia, o
  - persistencia minima autorizada en fase futura, o
  - endpoint unico manual que cree run y ejecute un lote en la misma invocacion.
- No se recomienda pasar a una fase de mas ejecucion real hasta resolver este
  bloqueo.

## Auditoria Fase 11.1 - Handoff Vercel sin base de datos - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `aeed69e Document phase 11 controlled batch validation`.
  - `947f403 Document phase 10 Vercel validation`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/top8-run.js`.
  - `api/top8-batch.js`.
  - `api/top8-final.js`.
  - `api/_lib/top8RunStore.js`.
  - `api/_lib/top8Pipeline.js`.
  - `api/_lib/top8CostPolicy.js`.
  - `api/_lib/top8ResultMetadata.js`.
- Vercel estaba sano antes de implementar:
  - `/api/health` OK.
  - `/api/top8-batch?batch=1` OK en dry-run con
    `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
    `resultScope=PARTIAL_BATCH_ONLY` y `fullUniverseExecutionAllowed=false`.
  - `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuto ninguna ruta con `execute=true` durante el precheck.

Implementacion:

- Se crea `/api/top8-batch-single`.
- La ruta acepta solo:
  - `batch`.
  - `execute`.
  - `confirm`.
- `batch` debe ser numerico y exactamente `1`.
- `batch=2` o superior bloquea con `BATCH_NOT_AUTHORIZED_PHASE_11_1`.
- `execute=true` sin `confirm=EXECUTE_BATCH` bloquea antes de llamadas externas.
- Dry-run `/api/top8-batch-single?batch=1` descubre universo metadata-only y no
  ejecuta historico/spread.
- La ruta no importa ni usa `top8RunStore`, no requiere `runId`, no crea
  persistencia y no finaliza TOP 8 global.
- Se actualizan `/api/health` y `/api/providers-status` con
  `top8BatchSingleEndpoint=single_invocation_dry_run_active`.
- Se crea `scripts/validate-phase11-1.mjs`.
- Se anade `npm run check:phase11-1`.
- `MASTER_CODEX_V1.md` registra la regla Fase 11.1.

Estado del endpoint single-invocation:

- Resultado esperado en dry-run:
  - `singleInvocation=true`.
  - `globalAggregationAvailable=false`.
  - `finalizationAvailable=false`.
  - `requiresPersistenceForGlobalFinal=true`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isPartialResult=true`.
  - `isGlobalTop8Final=false`.
  - `providerCallsPlanned=0`.
  - `fullUniverseExecutionAllowed=false`.

Validacion local:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `npm run check:phase11-1` no pudo ejecutarse localmente:
  `command not found: npm`.
- `npm run build` no pudo ejecutarse localmente:
  `command not found: npm`.
- Vercel queda como validacion de build/deploy tras push.

Checklist Vercel seguro tras deploy del commit `303ef83`:

- `/api/health` OK:
  `top8BatchSingleEndpoint=single_invocation_dry_run_active`.
- `/api/providers-status` OK:
  `top8BatchSingleEndpoint=single_invocation_dry_run_active`,
  `fullUniverseExecutionAllowed=false`.
- `/api/quote?symbol=SPY` OK:
  `dataQuality=GOOD`, proveedor EODHD, caché controlada.
- `/api/quote?symbol=TNX` estable:
  `dataQuality=NOT_AVAILABLE`, `diagnosticStatus=TNX_PROVIDER_UNRESOLVED`,
  `isInformationalOnly=true`, `affectsScore=false`, `affectsRanking=false`,
  `affectsExec=false`.
- `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/master-indicators` OK:
  mantiene 7 indicadores allowlisted; TNX sigue informativo/no operativo.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY` y
  `fullUniverseExecutionAllowed=false`.
- `/api/top8-batch?batch=1` OK en dry-run:
  `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
  `resultScope=PARTIAL_BATCH_ONLY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  `phase=11.1`, `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
  `singleInvocation=true`, `resultScope=PARTIAL_BATCH_ONLY`,
  `isPartialResult=true`, `isGlobalTop8Final=false`,
  `globalAggregationAvailable=false`, `finalizationAvailable=false`,
  `requiresPersistenceForGlobalFinal=true`,
  `fullUniverseExecutionAllowed=false`.
- `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.

Guardarrailes confirmados:

- No se ejecuto `execute=true` en Vercel durante Fase 11.1.
- No se ejecuto full-run.
- No se ejecuto batch 2.
- No se implementa Fase 12.
- No se anade automatizacion, polling, auto-refresh, cron, workers, sockets,
  background jobs ni base de datos real.
- No se anade SQLite, Redis, Vercel KV, Supabase ni Firebase.

Riesgos pendientes:

- La ruta single-invocation permite validar un lote sin memoria compartida, pero
  sigue sin producir TOP 8 global.
- Para TOP 8 global futuro hara falta persistencia autorizada o un diseno
  stateless completo aprobado.

## Auditoria Fase 11.2 - Validacion real single-invocation - 2026-06-01

Precheck:

- `git status -sb` inicial: `## main...origin/main`.
- Ultimos commits iniciales:
  - `ac04662 Document phase 11.1 Vercel validation`.
  - `303ef83 Add phase 11.1 single batch handoff`.
- Documentacion y codigo revisados:
  - `MASTER_CODEX_V1.md`.
  - `README.md`.
  - `CHANGELOG.md`.
  - `AUDIT.md`.
  - `api/top8-batch-single.js`.
  - `api/top8-batch.js`.
  - `api/top8-run.js`.
  - `api/top8-final.js`.
  - `api/_lib/top8Pipeline.js`.
  - `api/_lib/top8CostPolicy.js`.
  - `api/_lib/top8ResultMetadata.js`.
- Validacion local sin coste:
  - `git diff --check` OK.
  - `node scripts/validate-phase6.mjs` OK.
  - `node scripts/validate-phase7.mjs` OK.
  - `node scripts/validate-phase8.mjs` OK.
  - `node scripts/validate-phase9.mjs` OK.
  - `node scripts/validate-phase10.mjs` OK.
  - `node scripts/validate-phase11.mjs` OK.
  - `node scripts/validate-phase11-1.mjs` OK.
- `npm run build` no pudo ejecutarse localmente:
  `command not found: npm`.

Precheck Vercel seguro:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/quote?symbol=SPY` OK con `dataQuality=GOOD`.
- `/api/quote?symbol=TNX` estable como informativo/no operativo:
  `dataQuality=NOT_AVAILABLE`, `diagnosticStatus=TNX_PROVIDER_UNRESOLVED`,
  `affectsScore=false`, `affectsRanking=false`, `affectsExec=false`.
- `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/master-indicators` OK.
- `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch?batch=1` OK en dry-run:
  `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
  `resultScope=PARTIAL_BATCH_ONLY`.
- `/api/top8-batch-single?batch=1` OK en dry-run:
  `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
  `singleInvocation=true`, `fullUniverseExecutionAllowed=false`.
- `/api/top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.

Ejecucion real autorizada:

- Autorizacion recibida en prompt:
  `AUTORIZO EJECUTAR FASE 11.2 SINGLE BATCH REAL: batch=1`.
- Se ejecuta exactamente una vez:
  `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH`.
- No se repite la ejecucion.
- No se usa `/api/top8-batch` con `runId`.
- No se ejecuta batch 2.

Resultado de la ejecucion:

- HTTP status: `409`.
- Timestamp UTC: `2026-06-01T08:05:04.262Z`.
- `ok=false`.
- `phase=11.1` en respuesta del endpoint, esperado porque Fase 11.2 valida la
  ruta creada en Fase 11.1.
- `dryRun=false`.
- `error=NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`.
- `providerCallsPlanned=51`.
- `actualProviderCalls=51`.
- `estimatedProviderCalls=51`.
- `selectedAssets=25`.
- `assets=[]`.
- `evaluationSummary.analyzed=25`.
- `evaluationSummary.eligibleForScore=0`.
- `evaluationSummary.blocked=25`.
- `resultScope=PARTIAL_BATCH_ONLY`.
- `isPartialResult=true`.
- `isGlobalTop8Final=false`.
- `singleInvocation=true`.
- `globalAggregationAvailable=false`.
- `finalizationAvailable=false`.
- `requiresPersistenceForGlobalFinal=true`.
- `fullUniverseExecutionAllowed=false`.

Post-ejecucion Vercel:

- `/api/health` OK.
- `/api/providers-status` OK.
- `/api/top8` sigue bloqueando full-run con
  `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
- `/api/top8-batch-single?batch=1` sigue funcionando en dry-run con
  `providerCallsPlanned=0`, `estimatedProviderCalls=51`,
  `singleInvocation=true` y `fullUniverseExecutionAllowed=false`.

Conclusion:

- Fase 11.2 confirma que el endpoint single-invocation ejecuta dentro de una
  sola invocacion Vercel y no depende de `runId` ni memoria compartida.
- El lote 1 no produce candidatos validos: todos los 25 activos analizados quedan
  bloqueados por validacion tecnica.
- El resultado es parcial y no operativo; no es TOP 8 global.
- Fase 11.2 queda cerrada como validacion real con bloqueo de elegibilidad y
  requiere analisis/correccion antes de cualquier nueva ejecucion real.

Guardarrailes confirmados:

- Se ejecuto como maximo un lote real.
- El lote real fue solo `batch=1`.
- No se ejecuto full-run.
- No se ejecuto batch 2.
- No se genero TOP 8 global.
- No se creo persistencia real.
- No se implementa Fase 12.
- No se anade automatizacion, polling, auto-refresh, cron, workers, sockets,
  background jobs ni base de datos real.
- No se anade SQLite, Redis, Vercel KV, Supabase ni Firebase.

## Auditoria Fase 12 - Cierre y consolidacion final EMRR 2.0 - 2026-06-01

Objetivo:

- Ejecutar una unica auditoria global de cierre.
- No abrir Fase 12.1 ni nuevas subfases.
- Corregir solo bloqueos criticos pequenos si existieran.
- Clasificar todo lo pendiente como CRITICO, IMPORTANTE u OPCIONAL.
- Emitir una decision binaria final.

Fuentes revisadas:

- `MASTER_CODEX_V1.md`.
- `README.md`.
- `CHANGELOG.md`.
- `AUDIT.md`.
- Codigo actual del repositorio.
- Estado Vercel de produccion.

Estado Git inicial:

- `git status -sb`: `## main...origin/main`.
- Ultimos commits revisados:
  - `56e6b67 Document phase 11.7 Vercel validation`.
  - `3929b03 Add phase 11.7 spread verification policy`.
  - `6a8a76e Document phase 11.6 Vercel validation`.
  - `b2c0b86 Add phase 11.6 spread continuation policy`.

Checks locales:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `node scripts/validate-phase11-6.mjs` OK.
- `node scripts/validate-phase11-7.mjs` OK.
- `node -v`: `v24.14.0`.
- `npm -v`: no disponible en este entorno (`command not found: npm`).
- `npm run build`: no ejecutado localmente por ausencia de `npm`; Vercel queda
  como validacion de build/deploy de produccion.

Vercel final:

- Dashboard `/`: HTTP 200.
- `/api/health`: OK, entorno `production`, EODHD y Finnhub configurados,
  cache efimero, endpoints TOP 8 registrados.
- `/api/providers-status`: OK, `realApiCallsEnabled=true`,
  `fullUniverseExecutionAllowed=false`, sin polling, sin auto-refresh, sin
  background jobs.
- `/api/quote?symbol=SPY`: OK con `dataQuality=GOOD`.
- `/api/quote?symbol=TNX`: estable como informativo/no operativo,
  `dataQuality=NOT_AVAILABLE`, `diagnosticStatus=TNX_PROVIDER_UNRESOLVED`,
  `affectsScore=false`, `affectsRanking=false`, `affectsExec=false`.
- `/api/quote?symbol=AAPL`: bloquea con `SYMBOL_NOT_ALLOWED`.
- `/api/quote?symbol=SPY,LQD`: bloquea con `MULTI_SYMBOL_BLOCKED`.
- `/api/master-indicators`: OK con 7 simbolos allowlisted; TNX no bloquea.
- `/api/top8`: bloquea con `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
  - `totalDiscovered=61145`.
  - `operable=21478`.
  - `totalBatches=860`.
  - `estimatedProviderCallsForAllBatches=43816`.
  - `providerCallsPlanned=0`.
  - `assets=[]`.
- `/api/top8-batch-single?batch=1`: OK en dry-run.
  - `providerCallsPlanned=0`.
  - `estimatedProviderCalls=51`.
  - `resultScope=PARTIAL_BATCH_ONLY`.
  - `isPartialResult=true`.
  - `isGlobalTop8Final=false`.
  - `fullUniverseExecutionAllowed=false`.
  - `singleInvocation=true`.
  - `finalizationAvailable=false`.

Mercado USA y Europa:

- El universo incluye USA (`Nasdaq`, `NYSE`) y Europa (`Xetra`, `Euronext`,
  `Borsa Italiana`, `SIX`, `LSE`).
- Los endpoints de quote e indicadores devuelven `marketStatus=UNKNOWN` cuando
  no hay verificacion de apertura fiable.
- El sistema mantiene politica conservadora: mercado no verificado o cerrado no
  debe generar `EXEC`.
- Europa/Euronext queda en diagnostico no operativo mientras no exista bid/ask
  verificable.

Auditoria global:

- Arquitectura: modular y estable para Vercel serverless; no hay backend
  complejo ni dependencias innecesarias.
- Build/deploy: Vercel sirve dashboard y APIs; build local no comprobable en
  esta sesion por ausencia de `npm`.
- Dashboard: disponible en produccion y visualmente funcional como experiencia
  mock/controlada.
- APIs: endpoints criticos responden y mantienen guardarrailes.
- TOP 8: apto para uso controlado beta como flujo protegido y diagnostico;
  `/api/top8` bloquea por coste y el endpoint single-invocation solo entrega
  diagnostico parcial. El TOP 8 global operativo completo queda como backlog
  `v1.1`, no como bug critico de v1.0 beta.
- Universe Engine: activo como descubrimiento metadata-only sobre USA y Europa.
- Operability Engine: activo con reglas metadata-only; mantiene estados
  `OPERABLE`, `NOT_OPERABLE` y `UNKNOWN`.
- Score Engine: puro y validado localmente; mantiene guardarrailes y no genera
  `EXEC` cuando faltan condiciones operativas.
- Trailing: dinamico ATR-based sin cap fijo, no conectado a ordenes reales.
- Exportaciones: funcionales en dashboard mock; no son exportaciones operativas
  financieras finales.
- Seguridad: sin secrets expuestos, sin base de datos real, sin auth real, sin
  ordenes reales, sin polling, sin cron, sin workers.
- Rendimiento/costes: cost gate funciona y evita full-run caro.
- UX/UI: dashboard institucional usable para beta controlada; la conexion a TOP
  8 global operativo queda en backlog.

Clasificacion de pendientes:

CRITICO:

- Ninguno detectado para uso controlado beta.
- No hay fallo critico de dashboard, Vercel, APIs, Score Engine,
  guardarrailes, control de costes ni arquitectura.

IMPORTANTE:

- Completar TOP 8 global operativo como funcionalidad futura `v1.1`.
- Definir batching/agregacion definitiva autorizada sin full-run caro ni
  confusion entre resultados parciales y TOP 8 global.
- Definir una solucion autorizada para bid/ask verificable en Europa/Euronext
  sin inventar spread ni permitir proxy operativo.
- Confirmar market hours por exchange para USA y Europa con estado abierto o
  cerrado verificable.
- Conectar dashboard a TOP 8 real global solo cuando el alcance `v1.1` este
  aprobado y auditado.

OPCIONAL:

- Mejorar observabilidad, logs no sensibles y paneles tecnicos.
- Exportaciones avanzadas.
- Pulido UX/UI adicional.
- Automatizaciones futuras solo si existe autorizacion expresa.

Backlog futuro:

v1.1:

- Completar TOP 8 global operativo.
- Implementar batching/agregacion definitiva autorizada.
- Resolver validacion de spread bid/ask verificable en Europa/Euronext.
- Mantener guardarrailes actuales: no full-run caro, no spread inventado, no
  `EXEC` sin bid/ask verificable, no automatismos.
- Confirmar market hours por USA y Europa antes de permitir estados operativos.

v2.0:

- Persistencia autorizada si se necesita agregacion global robusta.
- Observabilidad avanzada.
- Usuarios/auth real.
- Integracion broker/ordenes reales solo tras auditoria legal, tecnica y de
  riesgo.
- Automatizaciones controladas solo si dejan de ser incompatibles con coste y
  seguridad.

Cambios realizados en Fase 12:

- `README.md`: actualizado estado final y decision.
- `CHANGELOG.md`: anadido cierre Fase 12.
- `AUDIT.md`: anadida auditoria global final.
- No se modifica `MASTER_CODEX_V1.md`; no se detecta contradiccion normativa
  critica que requiera tocar el documento maestro.

Bugs criticos encontrados:

- No se detecta bug de infraestructura en Vercel ni en guardarrailes.
- No se detecta bug critico real que impida uso controlado beta.
- El TOP 8 global operativo completo, el batching definitivo y la validacion
  completa de spreads europeos se reclasifican como funcionalidad futura
  planificada `v1.1`.

Bugs criticos corregidos:

- Ninguno. No existe una correccion critica pequena compatible con la regla de
  no redisenar, no abrir subfases y no relajar guardarrailes.

Riesgos restantes:

- El producto no debe usarse como generador operativo final de TOP 8 global.
- Un resultado parcial de batch no debe interpretarse como TOP 8 global.
- TNX sigue informativo/no operativo.
- El build local no pudo ejecutarse en esta sesion por falta de `npm`, aunque
  Vercel de produccion responde correctamente.

Confirmaciones negativas:

- No se ejecuto `execute=true`.
- No se ejecuto batch 2.
- No se ejecuto full-run.
- No se implemento Fase 12.1 ni ninguna subfase.
- No se anadio base de datos real.
- No se anadieron automatismos, polling, cron, workers, sockets ni background
  jobs.
- No se anadieron proveedores nuevos ni cambios de configuracion.

Decision final:

`EMRR 2.0 v1.0 APTO PARA USO CONTROLADO (BETA)`

Alcance exacto de la decision:

- Apto para uso controlado beta porque dashboard, Vercel, APIs, Score Engine,
  guardarrailes, control de costes y arquitectura estan operativos y auditados.
- No apto todavia como sistema operativo final de TOP 8 global completo:
  `/api/top8` bloquea por coste y el flujo single-invocation validado sigue
  siendo parcial, diagnostico y no operativo.
- Esa limitacion queda clasificada como backlog `v1.1`, no como bug critico de
  v1.0 beta.

---

## Correccion final bugs dashboard - Auditoria 2026-06-01

Tipo de intervencion:

- Correccion final de bugs visibles del dashboard mock/controlado.
- No es Fase 13.
- No abre subfases.
- No toca endpoints reales prohibidos.
- No anade APIs reales, dependencias, base de datos, persistencia ni auth.

Estado por bug:

- BUG-01 UNIVERSO MOCK DINAMICO: corregido. Se usa `technical.universeStats`
  como fuente unica y el valor total se deriva de USA + Europa.
- BUG-02 MARKET HOURS CLIENT-SIDE SIN API: corregido. `src/utils/marketHours.ts`
  calcula `OPEN/CLOSED` con hora UTC del navegador y sin llamadas externas.
- BUG-03 TOP 8 MOCK ACTUALIZABLE EN SCAN FULL: corregido. `SCAN FULL` simula
  scan de 1,7 s y refresca precios, EMA, ATR, trailing y timestamps.
- BUG-04 EXEC BLOQUEADO CON MERCADO CERRADO: corregido. Si el mercado no esta
  `OPEN`, cualquier `EXEC` se degrada a `CLOSED_CONTEXT` antes de renderizar.
- BUG-05 FEAR & GREED MOCK ACTUALIZABLE: corregido. Se regenera valor, label,
  color, fuente y timestamp en cada scan.
- BUG-06 MASTER INDICATORS MOCK ACTUALIZABLE: corregido. Se actualizan valores,
  cambios y timestamps en cada scan con rangos mock plausibles.
- BUG-07 LAST SCAN TIMESTAMP: corregido. `Last Scan` refleja la ultima ejecucion
  manual de `SCAN FULL` en la sesion.
- ERR-01 LEADING SECTORS: corregido. El componente conserva orden
  `LEADING`, `ACCELERATING`, `WEAKENING`, `FALLING` y performance descendente
  dentro de cada grupo.
- ERR-02 FUENTE UNICA DE UNIVERSO: corregido. El header consume
  `universeStats` y no recalcula el universo en otra ruta visual.
- ERR-03 TRAILING DOCUMENTADO: corregido. `MASTER_CODEX_V1.md` documenta
  `Tight`, `Medium` y `Wide` como equivalencias de trailing.
- ERR-04 MARKET_STATUS POR ACTIVO: corregido. TOP 8 mock deriva estado de
  mercado desde `isMarketOpen(asset.market)`.

Archivos modificados:

- `shared/types/domain.ts`.
- `shared/types/index.ts`.
- `src/types/index.ts`.
- `src/utils/marketHours.ts`.
- `src/engines/marketHoursEngine.ts`.
- `src/engines/scannerEngine.ts`.
- `src/mocks/mockData.ts`.
- `src/pages/DashboardPage.tsx`.
- `src/components/TechnicalHeader.tsx`.
- `package.json`.
- `scripts/validate-market-hours.mjs`.
- `scripts/validate-scanfull-mock-refresh.mjs`.
- `scripts/validate-universe-dynamic.mjs`.
- `scripts/validate-top8-closed-market-exec-block.mjs`.
- `scripts/validate-leading-sectors-order.mjs`.
- `scripts/validate-trailing-label-map.mjs`.
- `MASTER_CODEX_V1.md`.
- `CHANGELOG.md`.
- `AUDIT.md`.

Validadores ejecutados:

- `git diff --check` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `node scripts/validate-phase11-6.mjs` OK.
- `node scripts/validate-phase11-7.mjs` OK.
- `node scripts/validate-market-hours.mjs` OK.
- `node scripts/validate-scanfull-mock-refresh.mjs` OK.
- `node scripts/validate-universe-dynamic.mjs` OK.
- `node scripts/validate-top8-closed-market-exec-block.mjs` OK.
- `node scripts/validate-leading-sectors-order.mjs` OK.
- `node scripts/validate-trailing-label-map.mjs` OK.
- `npm run build` no pudo ejecutarse localmente porque `npm` no esta
  disponible en este entorno (`command not found: npm`).

Estado Vercel:

- Pendiente de validar tras commit/push/deploy.
- Rutas seguras previstas: `/`, `/api/health`, `/api/providers-status`,
  `/api/master-indicators`, `/api/quote?symbol=SPY`, `/api/quote?symbol=TNX`,
  `/api/top8`, `/api/top8-batch-single?batch=1`.
- Prohibido ejecutar cualquier ruta con `execute=true`.

Limitaciones restantes:

- Market holidays reales no implementados; `HOLIDAY` queda reservado.
- Los datos siguen siendo mock/controlados en dashboard.
- No se conecta el dashboard a TOP 8 global operativo real.

Confirmaciones negativas:

- No se modifican `/api/top8`, `/api/top8-batch-single`, `/api/universe` ni
  endpoints reales.
- No se modifica el Score Engine conceptual ni sus ponderaciones.
- No se relajan guardarrailes de `EXEC`, spread, operability ni cost gate.
- No se ejecuta `execute=true`, batch 2 ni full-run.

Decision de correccion local:

`EMRR 2.0 v1.0 BETA CONTROLADA — CORRECCION FINAL OK` en validadores locales.
Build local queda no ejecutado por falta de `npm`; Vercel post-deploy queda
pendiente de commit/push/deploy.

---

## Correccion precios mock y TREND - Auditoria 2026-06-01

Tipo de intervencion:

- Correccion final adicional sobre bugs confirmados visualmente en produccion
  Vercel el 2026-06-01 a las 18:02.
- No es Fase 13.
- No abre subfases.
- No toca endpoints reales ni APIs externas.
- No cambia formulas, ponderaciones ni bloqueos duros del Score Engine.

Estado por bug:

- BUG-CRITICO-1 PRECIOS BASE DEL MOCK: corregido. `ASML`, `SAP`, `AVGO`,
  `MSFT` y `NVDA` quedan dentro de los rangos verosimiles indicados para junio
  de 2026. `AIR`, `LLY` y `REL` se ajustan para conservar coherencia mock.
- BUG-CRITICO-2 TREND TRUNCADO: corregido. La card muestra etiquetas cortas y
  legibles, mantiene el texto completo en `title` y elimina el ellipsis del
  bloque `TREND`.
- BUG-IMPORTANTE-3 ACCION EXEC EN MODO MOCK: corregido. Los activos mock USA
  con mercado `OPEN`, dato `CLEAN`/`GOOD`, score >= 82, conviction >= 78 y risk
  `LOW`/`MEDIUM` pueden mostrar `EXEC`. Esta regla solo aplica al dashboard
  mock/controlado.
- Europa cerrada sigue bloqueando `EXEC` con `CLOSED_CONTEXT`.

Tabla de precios base verificados:

| Activo | Precio base | Rango auditado | EMA20 | EMA50 | ATR | ATR% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ASML | EUR 1620.00 | 1550-1700 | EUR 1580.00 | EUR 1520.00 | EUR 38.00 | 2.35% |
| SAP | EUR 168.00 | 155-180 | EUR 163.00 | EUR 152.00 | EUR 3.20 | 1.90% |
| AVGO | $242.00 | 220-265 | $235.00 | $218.00 | $9.20 | 3.80% |
| MSFT | $462.00 | 440-495 | $448.00 | $425.00 | $6.60 | 1.43% |
| NVDA | $135.00 | 120-155 | $128.00 | $112.00 | $6.80 | 5.04% |

Archivos modificados:

- `src/mocks/mockData.ts`.
- `src/components/Top8Grid.tsx`.
- `src/styles.css`.
- `scripts/validate-top8-closed-market-exec-block.mjs`.
- `scripts/validate-top8-mock-prices-2026.mjs`.
- `scripts/validate-top8-trend-render.mjs`.
- `scripts/validate-top8-open-market-exec-eligibility.mjs`.
- `package.json`.
- `CHANGELOG.md`.
- `AUDIT.md`.

Validadores nuevos ejecutados:

- `node scripts/validate-top8-mock-prices-2026.mjs` OK.
- `node scripts/validate-top8-trend-render.mjs` OK.
- `node scripts/validate-top8-open-market-exec-eligibility.mjs` OK.

Validaciones obligatorias:

- `git diff --check` OK.
- `node scripts/validate-market-hours.mjs` OK.
- `node scripts/validate-scanfull-mock-refresh.mjs` OK.
- `node scripts/validate-universe-dynamic.mjs` OK.
- `node scripts/validate-top8-closed-market-exec-block.mjs` OK.
- `node scripts/validate-leading-sectors-order.mjs` OK.
- `node scripts/validate-trailing-label-map.mjs` OK.
- `node scripts/validate-top8-mock-prices-2026.mjs` OK.
- `node scripts/validate-top8-trend-render.mjs` OK.
- `node scripts/validate-top8-open-market-exec-eligibility.mjs` OK.
- `node scripts/validate-phase6.mjs` OK.
- `node scripts/validate-phase7.mjs` OK.
- `node scripts/validate-phase8.mjs` OK.
- `node scripts/validate-phase9.mjs` OK.
- `node scripts/validate-phase10.mjs` OK.
- `node scripts/validate-phase11.mjs` OK.
- `node scripts/validate-phase11-1.mjs` OK.
- `node scripts/validate-phase11-3.mjs` OK.
- `node scripts/validate-phase11-5.mjs` OK.
- `node scripts/validate-phase11-6.mjs` OK.
- `node scripts/validate-phase11-7.mjs` OK.
- `npm run build` no pudo ejecutarse localmente porque `npm` no esta
  disponible en este entorno (`command not found: npm`).

Estado Vercel:

- Pendiente de validar tras commit/push/deploy.
- Rutas seguras previstas: `/`, `/api/health`, `/api/providers-status`,
  `/api/master-indicators`, `/api/quote?symbol=SPY`, `/api/quote?symbol=TNX`,
  `/api/top8`, `/api/top8-batch-single?batch=1`.
- Prohibido ejecutar cualquier ruta con `execute=true`.

Confirmaciones negativas:

- No se anaden APIs reales.
- No se tocan `/api/top8`, `/api/top8-batch-single`, `/api/universe` ni rutas
  reales de servidor.
- No se modifica el Score Engine conceptual.
- No se relajan guardarrailes reales de `EXEC`, spread, operability ni cost gate.
- No se ejecuta `execute=true`, batch 2 ni full-run.

---

## Auditoria anclaje TOP 8 y Fear & Greed - 2026-06-01

Motivo:

- Tras validar produccion, el usuario detecta que los precios del TOP 8 despues
  de `SCAN FULL` siguen alejandose del mercado y que Fear & Greed no es
  verosimil.
- Estado de mercado indicado por el usuario: EEUU abierto, Europa cerrada.

Diagnostico:

- El refresh anterior aplicaba la variacion de precio sobre el ultimo precio
  renderizado. Aunque la base inicial fuese razonable, varios scans podian
  acumular desviacion y alejar el mock del mercado.
- Fear & Greed usaba una distribucion demasiado amplia y podia devolver valores
  poco coherentes con el contexto reciente de `Greed`.

Correccion aplicada:

- `src/mocks/mockData.ts` incorpora `MOCK_TOP8_PRICE_REFERENCES` como tabla
  auditada de referencias por ticker.
- `refreshTop8Asset` calcula el precio de cada scan desde la referencia del
  ticker y no desde el precio previo renderizado.
- Para mercados `OPEN`, se aplica una deriva pequena y acotada alrededor de la
  referencia.
- Para mercados `CLOSED`, la deriva queda en `0`; Europa conserva precios de
  referencia/ultimo contexto y no simula movimiento intradia.
- Fear & Greed queda anclado a `61 / Greed`, con rango de scan mock `58-66`.

Referencias mock actuales:

| Activo | Mercado | Precio referencia | Estado |
| --- | --- | ---: | --- |
| NVDA | Nasdaq | $218.41 | EEUU abierto |
| MSFT | Nasdaq | $450.24 | EEUU abierto |
| AVGO | Nasdaq | $412.65 | EEUU abierto |
| LLY | NYSE | $987.05 | EEUU abierto |
| ASML | Euronext | EUR 1630.00 | Europa cerrada |
| SAP | Xetra | EUR 167.90 | Europa cerrada |
| AIR | Euronext | EUR 186.00 | Europa cerrada |
| REL | LSE | GBX 4,050 | Europa cerrada |

Validadores anadidos/actualizados:

- `scripts/validate-top8-mock-prices-2026.mjs`.
- `scripts/validate-scanfull-mock-refresh.mjs`.
- `scripts/validate-fear-greed-mock-anchor.mjs`.

Confirmaciones:

- No se conectan APIs reales al dashboard.
- No se tocan endpoints reales.
- No se modifica Score Engine conceptual.
- No se relajan guardarrailes.
- No se ejecuta `execute=true`, batch 2 ni full-run.
