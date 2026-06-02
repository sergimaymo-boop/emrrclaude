# EMRR 2.0 / Tendencias

Dashboard institucional mobile-first para detectar tendencias alcistas sanas y operables.

## Estado Actual

Fase 12 cierra la auditoria global del proyecto con decision final:

`EMRR 2.0 v1.0 APTO PARA USO CONTROLADO (BETA)`

Correccion estricta de integridad de datos: el dashboard visible ya no admite
datos `MOCK`, `MIXED` ni sustitutos. Los estados permitidos para datos
visibles son `REAL`, `LAST_CLOSE`, `ERROR` y `DATA_UNAVAILABLE`. Si no existe
dato real valido, el modulo debe mostrarse como no disponible; no se rellena con
fixtures ni precios sinteticos. `SCAN FULL` crea un `scanSnapshot` real y
continuable: procesa el universo elegible por lotes de 50-100 candidatos,
muestra cobertura/coste/progreso y solo puede devolver `GLOBAL_TOP8_FINAL` con
`coveragePercent=100%`. Si el scan queda incompleto, el dashboard muestra
`TOP 8 PARTIAL DIAGNOSTIC` o `TOP 8 DATA UNAVAILABLE`, nunca un ranking global.
`/api/visible-top8-quotes` solo enriquece activos ya seleccionados por el
snapshot dinamico. No decide ranking, no ejecuta universe screening externo y
no rellena datos. `/api/quote` y `/api/master-indicators` no usan proveedor
sustituto silencioso: si EODHD no entrega dato primario valido, el dato queda no
disponible. `EXEC` queda deshabilitado salvo dato `REAL`, mercado `OPEN`, activo
operable, calidad valida, score inputs reales, spread/liquidez validos y ningun
bloqueo duro.

Correccion Dynamic Scan: el TOP 8 visible ya no usa una lista fija operativa. Si
el TOP 8 global real sigue bloqueado por Cost Gate, el dashboard muestra `TOP 8
DATA UNAVAILABLE`; no crea sustitutos, no pinta fixtures y no genera precios
sinteticos. Los fixtures mock heredados se retiran de la fuente activa del
dashboard; cualquier dato de prueba futuro debe vivir fuera de la ruta de
produccion y no puede alimentar UI operacional. Fear & Greed y Leading Sectors
se muestran como no disponibles mientras no exista una fuente real aprobada.

El dashboard y Vercel estan operativos, los endpoints criticos responden y los
guardarrailes de coste/seguridad funcionan. La decision beta separa bug critico
real de funcionalidad futura planificada: el TOP 8 global operativo definitivo,
el batching masivo definitivo, la validacion completa de spreads europeos y el
Universe Engine global final pasan a backlog `v1.1`; no bloquean la version
beta controlada. `/api/top8` sigue bloqueando full-run con
`COST_GATE_REQUIRES_BATCHING_STRATEGY`; el flujo nuevo de `scanSnapshot`
permite continuidad manual por lotes firmados, pero no presenta resultado global
sin cobertura completa. El flujo single-invocation legacy sigue siendo
parcial/diagnostico, no TOP 8 global. Tras el diagnostico real de Fase 11.4, la
causa raiz del lote 1 queda identificada: los 25 activos fallan por
`SPREAD_NOT_VERIFIED` porque EODHD no devuelve spread verificable
(`SPREAD_NOT_AVAILABLE`). Las politicas Fase 11.5/11.6/11.7 mantienen
diagnostico no operativo y prohiben que un activo sin bid/ask real verificable
genere `EXEC` o entre en TOP 8 global operativo.

- NO se acepta una lista fija de 8-20 tickers como universo definitivo.
- NO se acepta un universo solo USA.
- `/api/top8` usa universo dinamico y bloquea por coste cuando el universo excede el presupuesto manual.
- Se registran y auditan `UNIVERSE_ENGINE_SPEC`, `OPERABILITY_ENGINE_SPEC` y `SCORE_ENGINE_SPEC`.
- TNX sigue siendo informativo/no operativo; no afecta score, ranking, EXEC ni
  TOP 8.
- El endpoint single-invocation no genera TOP 8 global:
  `resultScope=PARTIAL_BATCH_ONLY`, `isPartialResult=true`,
  `isGlobalTop8Final=false` y `finalizationAvailable=false`.
- Fase 11.4 confirma que el bloqueo `eligibleForScore=0` no es un fallo de
  handoff ni de infraestructura: el problema principal es la dependencia de
  spread verificable para Euronext Amsterdam en lote 1.
- Fase 11.5 formaliza que `SPREAD_NOT_VERIFIED` es diagnostico no operativo:
  estados permitidos `BLOCKED`, `STANDBY` o `WATCH_DIAGNOSTIC_ONLY`; estado
  prohibido `EXEC`.
- Fase 11.7 anade criterios estrictos de bid/ask verificable:
  bid numerico, ask numerico, ask > bid, bid > 0, proveedor y simbolo proveedor
  identificados, timestamp/contexto claro, sin mock, sin proxy y sin sustitutos
  silencioso. Incluso si estos criterios se cumplen, el resultado es solo
  `SPREAD_VERIFICATION_DIAGNOSTIC_ONLY`.
- Fase 12 no abre subfases nuevas: los pendientes de TOP 8 global definitivo,
  batching masivo, spreads europeos completos y persistencia/agregacion global
  pasan a backlog `v1.1`.

Endpoints actuales:

- `/api/health`
- `/api/providers-status`
- `/api/quote?symbol=SPY`
- `/api/quote?symbol=TNX`
- `/api/scan-snapshot/start` inicia `SCAN FULL` por snapshot continuable.
- `/api/scan-snapshot/continue` procesa el siguiente lote del mismo snapshot.
- `/api/scan-snapshot/finalize` solo finaliza con `coveragePercent=100%`.
- `/api/visible-top8-quotes` enriquecimiento manual seguro de precios para los
  activos ya seleccionados por `scanSnapshot`; no decide ranking, no acepta
  query libre y no ejecuta universo/TOP 8 real.
- `/api/master-indicators`
- `/api/universe` metadata-only, manual, sin tickers ad hoc
- `/api/top8` conectado al universo dinamico, bloqueado por `COST_GATE_REQUIRES_BATCHING_STRATEGY` cuando el universo operable supera el presupuesto manual.
- `/api/top8-run?create=true` crea una sesion efimera para agregar resultados de lotes dinamicos autorizados.
- `/api/top8-batch-single?batch=1` muestra dry-run de lote unico sin memoria compartida Vercel.
- El dry-run de `/api/top8-batch-single?batch=1` expone
  `diagnosticMode=DRY_RUN_COST_METADATA_ONLY`, la limitacion de diagnostico sin
  coste y el resumen manual de la ejecucion real de Fase 11.2.
- `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH` fue
  ejecutado una sola vez en Fase 11.2 y una sola vez en Fase 11.4 con finalidad
  diagnostica. Ambos resultados quedaron documentados como parciales, no como
  TOP 8 global.
- `/api/top8-final?runId=...` devuelve TOP 8 final solo si el run esta completo.
- Las respuestas seguras de `/api/top8`, `/api/top8-run` y `/api/top8-batch`
  exponen `costPolicy`, `estimatedProviderCalls`,
  `estimatedFullRunProviderCalls`, `manualApprovalRequired`,
  `recommendedNextAction` y `fullUniverseExecutionAllowed=false`.

## Universe Engine Requerido

El universo inicial EMRR debe determinarse automaticamente sobre:

- USA: Nasdaq, NYSE.
- Europa: Xetra, Euronext, Borsa Italiana, SIX, LSE.

Debe excluir:

- OTC.
- Penny Stocks.
- Warrants.
- Rights.
- ETNs.
- SPACs problematicos.
- Activos sin historico suficiente.
- Activos iliquidos.

Estado actual:

- `/api/universe` descubre listas de símbolos por exchange permitido con EODHD.
- No acepta tickers ni exchanges por query.
- Aplica filtros metadata-only de instrumento y mercado.
- Clasifica candidatos como `OPERABLE`, `NOT_OPERABLE` o `UNKNOWN` por reglas conservadoras.
- Deja pendientes los filtros caros por activo: historico suficiente, liquidez, spread y confirmacion IBKR.
- La logica compartida vive en `api/_lib/universeEngine.js` y no contiene una lista fija de tickers.
- La respuesta publica devuelve resumen y muestra limitada, no una lista gigante tipo screener.

## Operability Engine Requerido

El sistema debe clasificar cada activo para el perfil:

- SL espanola.
- IBKR.
- Restricciones PRIIPs.

Estados:

- `OPERABLE`
- `NOT_OPERABLE`
- `UNKNOWN`

Reglas duras:

- `UNKNOWN` no puede generar `EXEC`.
- `NOT_OPERABLE` no puede entrar en TOP 8 operativo.
- Solo `OPERABLE` puede pasar a ranking operativo.
- La clasificacion metadata-only vive en `api/_lib/operabilityEngine.js`.

## Score Engine Requerido

El Score Engine solo puede actuar despues de:

1. Universe Engine.
2. Operability Engine.
3. Normalizacion de ticker.
4. Validacion de datos.
5. Validacion de market hours.

Ponderacion:

- EMA20 / EMA50: 20.
- RS: 20.
- Momentum: 15.
- Continuidad: 15.
- RVOL: 10.
- Liquidez / Spread: 10.
- ATR saludable: 10.

Estado implementado:

- `api/_lib/technicalEngine.js` calcula EMA20, EMA50, ATR, ATR%, RVOL, momentum, RS, liquidez y drawdown desde OHLCV.
- `api/_lib/eligibilityEngine.js` valida historico, liquidez, spread y calidad antes de permitir score; market status no `OPEN` bloquea ejecucion/`EXEC`, no el score diagnostico.
- `api/_lib/scoreEngine.js` contiene un engine puro y testeable.
- `api/_lib/candidateEvaluationEngine.js` orquesta candidato -> tecnicos -> elegibilidad -> score -> ranking TOP 8, sin llamadas externas.
- `api/_lib/historicalDataProvider.js` prepara consumo historico EODHD diario para simbolos de exchanges aprobados, con cache efimero y sin endpoint publico.
- `api/_lib/spreadDataProvider.js` prepara verificacion de spread EODHD bid/ask para simbolos de exchanges aprobados, con cache efimero y sin endpoint publico.
- `api/_lib/spreadPolicy.js` clasifica spread verificado/no verificado sin
  llamadas externas y mantiene `SPREAD_NOT_VERIFIED` como bloqueo duro para
  `EXEC` y TOP 8 global operativo.
- `api/_lib/top8Pipeline.js` conecta universo dinamico -> cost gate -> historico -> spread -> evaluacion -> TOP 8.
- `api/_lib/top8BatchPlanner.js` genera un plan de lotes sobre el universo dinamico cuando el cost gate bloquea.
- `api/_lib/top8CostPolicy.js` centraliza la politica Fase 8 de coste:
  `SAFE_DRY_RUN`, `MANUAL_APPROVAL_REQUIRED`, `COST_TOO_HIGH` y
  `NOT_OPERATIONAL_FULL_RUN`.
- `api/_lib/top8RunStore.js` mantiene agregacion efimera en memoria runtime para resultados de lotes autorizados.
- Calcula trailing dinamico ATR-based sin cap fijo: `0.65x`, `1.00x`, `1.45x`.
- Bloquea score/action si `operabilityStatus` es `UNKNOWN` o `NOT_OPERABLE`.
- Separa score diagnostico de ejecucion: mercado no `OPEN` permite ranking tecnico manual, pero bloquea `EXEC`.
- `/api/top8` esta conectado al universo dinamico con `top8Endpoint=cost_gate_active`, pero bloquea por cost gate antes de ejecutar llamadas masivas.
- Cuando bloquea por coste, `/api/top8` devuelve `batchPlan` con resumen de lotes, sin exponer una lista gigante de tickers.
- `/api/top8-batch?batch=N` permite dry-run manual de un lote dinamico; no acepta tickers y no ejecuta historico/spread.
- `/api/top8-batch?batch=N&execute=true&runId=...&confirm=EXECUTE_BATCH` puede adjuntar el resultado del lote a una sesion efimera creada con `/api/top8-run?create=true`.
- `execute=true` exige `runId` y `confirm=EXECUTE_BATCH`; no se permite ejecutar batches sueltos o accidentales que puedan confundirse con TOP 8 global.
- Fase 8 mantiene `fullUniverseExecutionAllowed=false`; el universo completo no
  se ejecuta en produccion y solo se muestran estimaciones de coste/lotes.
- Fase 9 marca cada respuesta de lote individual como
  `resultScope=PARTIAL_BATCH_ONLY`, `isPartialResult=true` e
  `isGlobalTop8Final=false`; un batch no es TOP 8 global.
- Fase 10 marca Master Indicators como informativos: `isInformationalOnly=true`,
  `affectsScore=false`, `affectsRanking=false` y `affectsExec=false`.
- TNX incluye `diagnosticStatus` y `providerSymbolsTried`; si EODHD/Finnhub no
  devuelven precio valido, queda `TNX_PROVIDER_UNRESOLVED` y
  `dataQuality=NOT_AVAILABLE`.
- Cada run valida `universeFingerprint`/`universeSignature` y bloquea universos cambiados, batches duplicados o sesiones inexistentes antes de gastar llamadas historicas/spread.
- Cada run informa cobertura con `remainingBatchCount`, `nextBatchNumber` e `isGlobalTop8Final`; un TOP 8 parcial no debe confundirse con TOP 8 global.
- `/api/top8-final` no ejecuta llamadas externas y bloquea con `RUN_NOT_COMPLETE` si falta algun lote.
- `/api/top8-batch-single?batch=1` evita el handoff de memoria Vercel: descubre
  universo, selecciona lote 1 y devuelve dry-run en la misma invocacion.
- `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH` queda como
  ruta futura autorizable, no ejecutada en Fase 11.1.
- La ruta single-invocation no usa `top8RunStore`, no requiere `runId`, no crea
  finalizacion global y siempre marca el resultado como parcial.
- Fase 11.5 no ejecuta ninguna ruta con `execute=true`; solo anade politica y
  validacion local para spread no verificable.

## No Implementado Todavia

- Universe Engine automatico completo de elegibilidad operativa.
- Ejecucion operativa completa del universo dinamico.
- Automatizacion de batches.
- Confirmacion real IBKR/PRIIPs.
- Scanner masivo.
- TOP 8 operativo real.
- Base de datos real.
- SQLite.
- Supabase.
- Snapshots persistentes.
- LearningLog real.
- Polling.
- Auto-refresh.
- Background jobs.
- Ordenes reales.

## Validacion Local

`node --check` debe pasar en rutas API JS.

Validacion Fase 6 sin dependencias externas:

```bash
node scripts/validate-phase6.mjs
```

Validacion Fase 7 sin dependencias externas:

```bash
node scripts/validate-phase7.mjs
```

Validacion Fase 8 sin dependencias externas:

```bash
node scripts/validate-phase8.mjs
```

Validacion Fase 9 sin dependencias externas:

```bash
node scripts/validate-phase9.mjs
```

Validacion Fase 10 sin dependencias externas:

```bash
node scripts/validate-phase10.mjs
```

Validacion Fase 11 sin dependencias externas:

```bash
node scripts/validate-phase11.mjs
```

Validacion Fase 11.1 sin dependencias externas:

```bash
node scripts/validate-phase11-1.mjs
```

Validacion Fase 11.3 sin dependencias externas:

```bash
node scripts/validate-phase11-3.mjs
```

Validacion Fase 11.5 sin dependencias externas:

```bash
node scripts/validate-phase11-5.mjs
```

Validacion Fase 11.6 sin dependencias externas:

```bash
node scripts/validate-phase11-6.mjs
```

Validacion Fase 11.7 sin dependencias externas:

```bash
node scripts/validate-phase11-7.mjs
```

Tambien queda disponible:

```bash
npm run check:phase7
npm run check:phase8
npm run check:phase9
npm run check:phase10
npm run check:phase11
npm run check:phase11-1
npm run check:phase11-3
npm run check:phase11-5
npm run check:phase11-6
npm run check:phase11-7
```

`npm run build` debe validarse en Vercel o en entorno local con `npm`, porque este terminal puede no tener `npm/npx`.

## Vercel

- Estado Fase 6 final: GitHub y Vercel estan sincronizados.
- `/api/health` declara `top8RunEndpoint=ephemeral_manual_aggregation_active`
  y `top8FinalEndpoint=complete_run_only_active`.
- `/api/top8-run?create=true` crea una sesion efimera manual y planifica
  `providerCallsPlanned=0`; no ejecuta historico/spread.
- `/api/top8-final?runId=test` responde `RUN_NOT_FOUND`, confirmando que el
  endpoint existe y bloquea runs invalidos.
- No usar `/api/top8-batch?batch=N&execute=true&runId=...&confirm=EXECUTE_BATCH`
  sin autorizacion explicita, porque ejecuta llamadas reales de historico/spread
  para el lote.
- Fase 7 endurece este punto: si falta `confirm=EXECUTE_BATCH`, el endpoint
  bloquea con `EXECUTION_CONFIRMATION_REQUIRED` antes de cualquier llamada
  externa.
- Fase 8 anade politica de coste visible en dry-runs:
  - `SAFE_DRY_RUN`: lectura de plan sin llamadas historicas/spread.
  - `MANUAL_APPROVAL_REQUIRED`: cualquier ejecucion real exige aprobacion
    manual, `runId` y `confirm=EXECUTE_BATCH`.
  - `COST_TOO_HIGH`: el universo completo supera el presupuesto operativo y no
    debe ejecutarse como full-run.
  - `NOT_OPERATIONAL_FULL_RUN`: aunque el coste no sea extremo, el full-run no
    esta autorizado como operativa automatica.
- Para interpretar un lote seguro, usar solo:

```text
https://emrr-2-tendencias.vercel.app/api/top8-batch?batch=1
```

No usar rutas con `execute=true` sin autorizacion explicita.
- Validacion Vercel Fase 8:
  - `/api/health` reporta `phase8Readiness.costPolicy=PHASE_8_COST_POLICY_V1`.
  - `/api/providers-status` reporta `top8CostPolicy=PHASE_8_COST_POLICY_V1`.
  - `/api/top8` bloquea full-run con `COST_GATE_REQUIRES_BATCHING_STRATEGY`
    y `costPolicy.status=COST_TOO_HIGH`.
  - `/api/top8-batch?batch=1` muestra `SAFE_DRY_RUN`,
    `estimatedProviderCalls=51`,
    `estimatedFullRunProviderCalls=43593` y
    `fullUniverseExecutionAllowed=false`.
- Fase 9 no ejecuta un lote real en Vercel sin autorizacion textual explicita.
  En cierre seguro, `/api/top8-batch?batch=1` sigue siendo dry-run y muestra
  `PARTIAL_BATCH_ONLY`, `isPartialResult=true`, `isGlobalTop8Final=false` y
  `actualProviderCalls=null`; `/api/top8-final` solo puede devolver
  `GLOBAL_TOP8_FINAL` si el run esta completo.
- Fase 10 mantiene TNX como indicador informativo. Si
  `/api/quote?symbol=TNX` devuelve `NOT_AVAILABLE`, no bloquea TOP 8 ni ninguna
  decision operativa.
- Fase 11 autorizo exactamente un intento real:
  `/api/top8-batch?batch=1&execute=true&runId=e59d1a39-e943-41e0-8d45-87ca36a4f0bb&confirm=EXECUTE_BATCH`.
  Vercel respondio `RUN_NOT_FOUND` antes de cualquier llamada historica/spread:
  `providerCallsPlanned=0`, `actualProviderCalls=null`, `assets=[]`.
  No se reintento, no se ejecuto batch 2 y no se hizo full-run.
- Riesgo operativo detectado: los runs son memoria efimera por runtime; entre
  funciones Vercel (`top8-run`, `top8-batch`, `top8-final`) el `runId` puede no
  estar disponible. Hasta corregir este handoff, los batches reales en Vercel no
  deben reintentarse sin nueva autorizacion tecnica y operativa.
- Fase 11.1 corrige el camino de validacion de lote unico mediante:

```text
https://emrr-2-tendencias.vercel.app/api/top8-batch-single?batch=1
```

  Este endpoint es dry-run seguro por defecto, no depende de memoria compartida
  y debe mostrar `singleInvocation=true`, `providerCallsPlanned=0`,
  `resultScope=PARTIAL_BATCH_ONLY` y `fullUniverseExecutionAllowed=false`.
  No usar la variante con `execute=true` sin autorizacion textual posterior.
- Fase 11.5 no ejecuta llamadas reales nuevas y formaliza que Europa/Euronext
  sin spread verificable puede analizarse solo como diagnostico no operativo.
  No se inventa spread, no se calcula proxy operativo y no se permite `EXEC`.
- Fase 11.6 adopta la politica de continuidad
  `EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK`: Europa/Euronext sigue
  solo como diagnostico no operativo mientras no exista bid/ask verificable.
  Las dos fuentes financieras ya configuradas pueden revisarse solo de forma
  puntual, manual y trazable para auditoria/check de produccion, sin cambiar
  configuracion, sin guardar datos y sin autorizar `EXEC`.
- Fase 11.7 no consulta fuentes reales por defecto y no crea endpoint publico:
  solo deja preparado el helper puro de verificacion diagnostica de bid/ask.
  Cualquier comprobacion real futura debe ser autorizada en una fase posterior.
- Framework Preset: Vite.
- Install Command: `npm install`.
- Build Command: `npm run build`.
- Output Directory: `dist`.
- Variables de entorno:
  - `ENABLE_REAL_API_CALLS`
  - `EODHD_API_KEY`
  - `FINNHUB_API_KEY`

Para mantener coste controlado, el dashboard no llama automaticamente a datos reales.
