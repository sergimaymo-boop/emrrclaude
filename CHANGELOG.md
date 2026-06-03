# CHANGELOG - EMRR 2.0 / Tendencias

Registro oficial acumulativo de cambios aprobados.

Reglas:

- Nunca borrar historial.
- Siempre anadir nuevas entradas.
- Registrar cambios visuales, arquitectura, Vercel, exportaciones, indicadores visibles, layout, colores, botones y decisiones relevantes.
- Mantener el documento simple y facil de leer.

---

## Rally Leaders Engine v1.0 — Motor Independiente - 2026-06-03

Nuevo motor completamente independiente del TOP 8 principal.

- `api/_lib/rallyScoreEngine.js` — Rally Score engine: RS 35% + Momentum 25% + Trend 20% + RVOL 10% + ATR 5% + Liquidez/Spread 5%. Sin tickers favoritos, sin listas fijas. Detecta estructuras de rally puras.
- `api/rally-scan/start.js` — endpoint POST que inicia el Rally Scan. Usa el mismo universo estático pero scoring independiente.
- `api/rally-scan/continue.js` — endpoint POST para continuar batches parciales vía rallyToken.
- `api/rally-scan/last.js` — endpoint GET que carga el último Rally Scan completado desde Redis (clave `last_rally_snapshot`).
- `api/_lib/kvStorage.js` — añadidas `saveLastRallySnapshot` / `loadLastRallySnapshot` con clave Redis separada del TOP 8.
- `src/services/rallyRefresh.ts` — servicio frontend independiente: `startRallyScan`, `continueRallyScan`, `fetchLastRallyScan`.
- `src/components/RallyLeadersPanel.tsx` — panel visual Top 10: rank, ticker, nombre, mercado, precio, cambio día, RS 3M, RVOL, Rally Score badge.
- `src/components/StickyMiniHeader.tsx` — botón SCAN RALLY añadido al lado de SCAN FULL en el header sticky. Color índigo/violeta para diferenciarlo.
- `src/pages/DashboardPage.tsx` — estado `rallyState`, handler `handleScanRally`, carga automática desde Redis al montar, panel integrado después del TOP 8.
- 8 validadores creados y verificados: no-mock, no-fixed-list, operability-required, market-hours, score-integrity, data-integrity, coverage-required, dashboard-panel. Todos pasan (8/8).
- Build: 52 módulos, sin errores.

Rangos Rally Score: ELITE RALLY (90-100) · STRONG RALLY (80-89) · ACTIVE RALLY (70-79) · WATCH (60-69) · DISCARD (<60).
Solo activos OPERABLE. Sin mock, sin listas fijas, sin datos sintéticos. Resultado 100% dependiente de datos reales en el momento del scan.

---

## Correccion Operativa EMRR - Universo Filtrado, Scan Continuable y Etiquetado Real - 2026-06-02

- Se corrige el origen del universo operativo: `/api/universe` ya no cuenta el
  universo bruto completo de EODHD como `Universe Discovered`.
- `api/_lib/universeEngine.js` aplica prefiltro conservador antes del scan:
  solo `Common Stock`, exchanges autorizados, activos no delisted/inactive y
  sin sufijos de warrants/rights/preferred.
- Con `US OPEN / Europe CLOSED`, el universo operativo queda limitado a
  `NASDAQ` y `NYSE`; Europa solo puede aparecer como contexto no operativo.
- `api/_lib/top8BatchPlanner.js` prioriza el universo antes de crear lotes:
  exchange de mayor liquidez, market cap cuando exista y ticker como fallback
  estable.
- `batchSize` queda en `100` y el limite visible por invocacion se ajusta a
  `201` provider calls para que el lote de 100 no se bloquee por su propia
  estimacion (`2 * candidatos + 1`).
- `Eligibility Engine` mantiene spread duro `0.35%` y anade umbrales explicitos:
  precio minimo `5`, historico absoluto `80`, historico completo `260`, USA
  `200k` acciones / `10M` valor medio y Europa `100k` / `5M`.
- La respuesta diagnostica de elegibilidad agrega conteos por causa:
  historico, precio, volumen, spread, operabilidad, calidad de dato y tipo
  excluido.
- `CONTINUE SCAN` conserva el `snapshotToken` en `localStorage` con
  `emrr_scan_state` y muestra progreso tipo `continue scan (batch X/Y)`.
- `TNX` queda neutro cuando no resuelve proveedor: `DATA_UNAVAILABLE`, `N/A`,
  informativo y sin badge rojo de error operativo.
- `Master Indicators` separa su estado real del estado parcial del scan TOP 8:
  un dato valido de proveedor se etiqueta como `REAL`/informativo y no como
  `MISS` heredado del snapshot.
- Se anaden validadores de filtro pre-scan, mercado activo, universo no bruto,
  priorizacion de batches, umbrales, diagnosticos, localStorage de continue,
  TNX neutro, Master Indicators y limite Vercel Hobby.
- No se modifican formulas del Score Engine, ranking conceptual, Cost Gate,
  spread/liquidez, EXEC guards, endpoints prohibidos, DB, polling, cron ni
  ejecucion automatica.

## Critical Production Fix - Remove Mock/Fixed TOP 8 - 2026-06-02

- Se identifica causa raiz de produccion: Vercel sigue sirviendo el bundle
  antiguo `/assets/index-BGTr6Ewp.js`.
- Ese bundle antiguo contiene salida TOP 8 fija/mock (`NVDA`, `ASML`, `MSFT`,
  `AVGO`, etc.) y mensajes prohibidos como `Mock visual refresh completed`,
  `Mock scan completed`, `MOCK_READY`, `MOCK_CACHE` y
  `CNN Fear & Greed (mock)`.
- El codigo local `main` ya habia eliminado `src/mocks/mockData.ts` y
  `src/engines/scannerEngine.ts`; el dashboard actual arranca desde
  `DATA_UNAVAILABLE` y usa `startScanSnapshot` / `continueScanSnapshot`.
- Se anaden validadores de produccion para impedir regresiones:
  - `validate-no-mock-in-production-dashboard`.
  - `validate-no-fixed-top8-production`.
  - `validate-no-mock-toast`.
  - `validate-real-scan-snapshot-required`.
  - `validate-production-initial-state-data-unavailable`.
  - `validate-europe-open-us-closed-excludes-us-assets`.
  - `validate-no-mock-mixed-fallback-visible`.
  - `validate-production-bundle-no-mock-fixed-top8`.
- Los validadores bloquean imports activos de mock, listas fijas operativas,
  mensajes de scan mock, `MOCK_FALLBACK`/`MIXED` visibles, TOP 8 inicial no
  vacio y cualquier `SCAN FULL` que no pase por `scanSnapshot`.
- La validacion de bundle inspecciona `dist/assets/*.js` cuando existe build
  local y falla si encuentra cadenas de mock/fixed TOP 8 prohibidas.
- `npm run build` queda endurecido mediante `scripts/build-production.mjs`:
  ejecuta validadores de fuente, typecheck, `vite build` y gate posterior sobre
  `dist/assets`.
- Se anade `scripts/run-all-validators.mjs` y `npm run validate:all` para ejecutar
  todas las validaciones locales de forma uniforme.
- Todos los validadores `scripts/validate-*.mjs` disponibles pasan en local; el
  build local queda no ejecutado porque `npm` no esta disponible en este entorno.
- Se documenta en `MASTER_CODEX_V1.md` la regla normativa final: produccion no
  puede renderizar `MOCK`, `MIXED`, `FALLBACK`, `SYNTHETIC`, fixtures demo ni
  TOP 8 fijo como salida de mercado.
- Tras push del commit `b26ca50`, Vercel Production sigue sirviendo el bundle
  antiguo `/assets/index-BGTr6Ewp.js` y los endpoints nuevos siguen `404`; se
  documenta que el cierre de produccion requiere redeploy manual o revision de la
  conexion Vercel-GitHub.
- Tras push del commit `f437451`, Vercel Production sigue sirviendo el mismo
  asset antiguo y `/api/visible-top8-quotes` + endpoints `scan-snapshot` siguen
  en `404`; queda confirmado que el bloqueo activo es redeploy/conexion Vercel,
  no ausencia del hard gate en `origin/main`.
- Se anade `scripts/validate-vercel-production-deploy.mjs` y
  `npm run validate-vercel-production` para validar despues del redeploy que
  Production ya no sirve `/assets/index-BGTr6Ewp.js`, que el bundle no contiene
  marcadores mock/fixed TOP 8 y que los endpoints nuevos no devuelven `404`.
- Tras push de `9fcf2b8`, `npm run validate-vercel-production` sigue fallando
  porque Production aun sirve `/assets/index-BGTr6Ewp.js`.
- Recheck adicional confirma que no hay variables/token/configuracion local de
  Vercel disponibles y que el HTML publico de `/` sigue con `x-vercel-cache: HIT`
  y `last-modified: Mon, 01 Jun 2026 18:17:35 GMT`.
- Captura del Vercel Dashboard confirma que el deployment production actual es
  `HLHg6TMpF`, estado `Ready Stale`, source `main` en commit `80a6c8b`, mientras
  `origin/main` actual esta en `508aa00` o posterior.
- Los aliases `git-main` y deployment URL de la captura estan protegidos por
  Vercel Authentication; el dominio publico production sigue apuntando al bundle
  viejo.
- Captura de Build Logs del deployment `D7KCyNymb` en commit `1571a6d` confirma
  fallo de build por TypeScript: `src/services/realDataRefresh.ts` inferia
  `source/provider` como `string` en lugar de `DataProvider`, y
  `server/providers/mockProvider.ts` devolvia el estado ya prohibido `mock`.
- Se corrige el build sin tocar logica financiera: `mockProvider` devuelve
  `not_configured` cuando no hay API key o hay placeholder, y
  `realDataRefresh` tipa explicitamente el provider como `DataProvider`.
- Captura posterior del deployment `Cof7QDTds` en commit `5486772` muestra dos
  errores de typecheck restantes: `MasterIndicator.status` inferido como
  `string` y `providerRouter.ts` usando el modo obsoleto `MOCK_ONLY`.
- Se corrige con tipado explicito `MasterIndicator[]` en `mergeMasterIndicators`
  y `providerRouter` pasa a `REAL_API_DISABLED` con
  `secondaryProviderConfiguredOnly`.
- Captura del deployment `c342f28` confirma nuevo bloqueo no relacionado con
  TypeScript: Vercel Hobby permite maximo 12 Serverless Functions y el repo
  exponia 14 rutas publicas en `api/`.
- Se retiran de produccion las rutas legacy `api/top8-run.js`,
  `api/top8-batch.js` y `api/top8-final.js`; el flujo actual queda en
  `api/scan-snapshot/*`, `api/top8-batch-single.js`, `api/top8.js`,
  `api/universe.js`, `api/visible-top8-quotes.js`, `api/master-indicators.js`,
  `api/quote.js`, `api/providers-status.js` y `api/health.js`.
- Se anade `validate-vercel-hobby-function-count` para bloquear builds con mas
  de 12 funciones publicas en Vercel Hobby.
- La evidencia publica actual coincide con una build antigua compatible con
  `303ef83 Add phase 11.1 single batch handoff`, mientras `origin/main` ya esta
  varias correcciones por delante.
- No se ejecuta `execute=true`, batch 2, full-run, polling, cron, workers,
  base de datos, persistencia real, auth ni llamadas masivas.

## Continuable Full Universe Scan Snapshot Integrity Fix - 2026-06-02

- Se implementa el flujo `scanSnapshot` continuable para `SCAN FULL`.
- Se anaden endpoints seguros:
  - `POST /api/scan-snapshot/start`
  - `POST /api/scan-snapshot/continue`
  - `POST /api/scan-snapshot/finalize`
- `SCAN FULL` crea `scanId`, `scanStartedAtUtc`, `universeHash`,
  progreso de lotes, coste estimado/real y cobertura.
- El dashboard permite `CONTINUE SCAN` sobre el mismo snapshot firmado hasta
  completar todos los lotes del universo elegible.
- Se sustituye el limite operativo de 25 candidatos por batching controlado:
  `batchSize` 50-100 y cobertura acumulada por `coveragePercent`.
- `GLOBAL_TOP8_FINAL` solo puede mostrarse cuando `coveragePercent=100%` y
  todos los lotes pertenecen al mismo `scanId`/`universeHash`.
- Si `coveragePercent < 100%`, el dashboard muestra
  `TOP 8 PARTIAL DIAGNOSTIC` o `TOP 8 DATA UNAVAILABLE`; nunca lo presenta como
  TOP 8 global.
- `/api/visible-top8-quotes` deja de depender de una lista fija operativa y
  solo acepta hasta 8 `selectedAssets` ya rankeados por snapshot.
- `/api/quote` y `/api/master-indicators` dejan de usar sustituto silencioso:
  si EODHD no entrega dato primario valido, devuelven estado no disponible en
  vez de `FALLBACK_USED`.
- El ranking mantiene orden por score descendente, conviction descendente,
  menor risk y mejor calidad/liquidez.
- Se anaden validadores de snapshot continuable, cobertura requerida, parcial no
  global, token firmado, lotes duplicados, mismo `scanId`, coste visible y
  `EXEC` solo con global real abierto.
- No se ejecuta `execute=true`, batch 2, full-run oculto, polling, cron,
  workers, base de datos, persistencia real ni automatismos.
- `npm run build` no pudo ejecutarse localmente porque `npm` y `node_modules`
  no estan disponibles en este entorno; se ejecutan validadores Node directos.

## Strict No-Substitute Data Correction - 2026-06-02

- Se endurece la correccion de integridad: el dashboard visible ya no admite
  datos `MOCK`, `MIXED` ni sustitutos de datos de mercado.
- `DataMode` visible queda limitado a `REAL`, `LAST_CLOSE`, `ERROR` y
  `DATA_UNAVAILABLE`.
- El dashboard deja de importar `src/mocks/mockData.ts`, deja de usar
  `runMockScan`, se retiran los fixtures mock heredados de `src/` y arranca
  desde estado `DATA_UNAVAILABLE`.
- Si `/api/top8` queda bloqueado por Cost Gate, el TOP 8 visible queda vacio
  con mensaje `TOP 8 DATA UNAVAILABLE`; no se rellena con lista fija, fixture ni
  precio sintetico.
- `/api/visible-top8-quotes` ya no expone una lista fija en GET; GET solo
  informa contrato seguro y POST exige tickers ya seleccionados por ranking
  dinamico.
- `/api/visible-top8-quotes` deja de usar proveedor sustituto para el dashboard
  visible; si EODHD no devuelve dato primario valido, el activo queda
  `DATA_UNAVAILABLE`.
- Fear & Greed y Leading Sectors quedan `DATA_UNAVAILABLE` mientras no haya
  fuente real aprobada.
- Se elimina la ruta mock heredada de la fuente activa y se actualizan
  validadores para comprobar el pipeline snapshot real.
- Se actualizan validadores para prohibir `MOCK`, `MIXED`,
  `MOCK_FALLBACK`, sustituto silencioso, `lastMockRefresh` y scan mock en la
  ruta activa del dashboard.
- No se modifica conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, spread/liquidez, IBKR/PRIIPs ni
  ranking real.
- No se ejecuta `execute=true`, batch 2, full-run, polling, cron, workers,
  base de datos, persistencia real ni llamadas masivas.

## EMRR Operational Integrity Master Fix - 2026-06-02

- Se implementa una politica operacional estricta: mercado abierto requiere
  dato `REAL`; `MOCK`, `MIXED`, `STALE` y `ERROR` quedan bloqueados para
  decisiones operativas.
- Se anaden metadatos no rompedores a modelos visibles:
  `operationalDataStatus`, `operationalDecisionAllowed`,
  `operationalBlockReasons` y `scoreInputIntegrity`.
- El dashboard consulta `/api/top8` en cada refresco manual para reflejar el
  estado real de universo dinamico y Cost Gate antes de usar fallback visual.
- Si `/api/top8` queda bloqueado por Cost Gate, el dashboard muestra contexto
  no operativo y no lo presenta como TOP 8 global.
- `/api/visible-top8-quotes` sigue siendo solo enriquecimiento de precios:
  devuelve `rankingSource=false`, no ejecuta universo, no decide ranking y
  anade estado operacional por activo.
- Fear & Greed se muestra como no disponible mientras no exista fuente real
  aprobada; sus fixtures mock quedan solo como contexto interno/no operativo.
- Leading Sectors se muestra como `DATA UNAVAILABLE` si no hay fuente real; no
  afecta TOP 8, Score, Ranking ni `EXEC`.
- Master Indicators muestran estado operacional separado de `DataMode`; TNX
  sigue sin inventarse si queda `NOT_AVAILABLE`.
- `EXEC` queda bloqueado cuando no hay dato operacional completo, incluso si
  existe precio real pero score/tecnicos/spread/liquidez siguen mock o no
  verificados.
- Se documenta que el Score Engine backend actual conserva sus pesos/fórmulas
  de codigo; cualquier diferencia con documentacion antigua queda como deuda
  documental, no como cambio de motor.
- Se anaden validadores de Operational Data Policy, Score Integrity, Universe
  Integrity y Dashboard Integrity.
- No se modifica conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, spread/liquidez, IBKR/PRIIPs ni
  ranking real.
- No se ejecuta `execute=true`, batch 2, full-run, polling, cron, workers,
  base de datos, persistencia real ni llamadas masivas.

## Dynamic Scan & Dashboard Integrity Fix - 2026-06-01

- Se corrige el dashboard para que el TOP 8 visible deje de depender
  operativamente de una lista fija de 8 tickers.
- Se introduce un pool de candidatos mock/controlado mayor que 8 como fixture
  explicito, y cada `REAL QUOTES REFRESH` calcula salida dinamica:
  universo -> operabilidad -> elegibilidad -> score mock/controlado -> ranking
  -> TOP 8.
- El ranking visible se ordena por score descendente, conviction descendente,
  menor risk y mejor dataQuality.
- Se anaden metadatos de universo al dashboard:
  `universeDiscovered`, `universeOperable`, `universeEligibleForScore`,
  `universeRanked`, `finalTop8Count`, `top8Source` y `resultScope`.
- `universeOperable` refleja el estado de mercado USA/Europa en cliente: si una
  region esta cerrada, no aporta universo operable para `EXEC`.
- `/api/visible-top8-quotes` queda como enriquecedor de precios, no como fuente
  de ranking: acepta solo POST con hasta 8 tickers ya seleccionados por el
  dashboard y dentro de una allowlist interna; rechaza tickers externos.
- El endpoint mantiene GET seguro sin query para comprobacion Vercel, pero no
  decide el TOP 8.
- `REAL QUOTES REFRESH` pasa los tickers seleccionados dinamicamente al endpoint
  de quotes y conserva `MOCK_FALLBACK`/`MIXED` como no operativo.
- Leading Sectors se refresca en cada scan manteniendo orden MASTER por estado y
  performance dentro de grupo.
- Se actualiza `MASTER_CODEX_V1.md` con la regla normativa: TOP 8 visible debe
  derivar del pipeline dinamico; listas fijas solo pueden ser fixture/mock
  explicitamente etiquetado.
- Se anaden validadores:
  - `validate-dynamic-top8-source`
  - `validate-top8-ranking-sort`
  - `validate-visible-quotes-not-ranking-source`
  - `validate-universe-count-not-fixed`
  - `validate-scan-updates-dashboard`
  - `validate-fear-greed-refresh`
  - `validate-master-indicators-refresh`
  - `validate-exec-dynamic-guard`
- No se modifica conceptualmente Score Engine, Universe Engine, Operability
  Engine, Eligibility Engine, Cost Gate, guardarrailes de EXEC ni reglas de
  spread/liquidez.
- No se ejecuta `execute=true`, batch 2, full-run ni ejecucion masiva.

## Real Data Integrity Fix - 2026-06-01

- Se corrige la integridad visual de datos del dashboard beta: ningun precio mock
  se presenta como real.
- Se anade `DataMode` global y por modulo: `MOCK`, `REAL`, `MIXED`, `STALE` y
  `ERROR`.
- Se crea `/api/visible-top8-quotes` como endpoint seguro para refrescar solo
  las 8 cotizaciones visibles actuales.
- El endpoint no acepta query de simbolos, no acepta listas externas, no ejecuta
  universo completo, no llama historico/spread masivo y no toca `/api/top8`.
- `REAL QUOTES REFRESH` intenta actualizar manualmente precios visibles y
  Master Indicators; si algo falla, conserva mock solo con etiqueta `MOCK` o
  `ERROR`.
- Fear & Greed queda explicitamente `MOCK`, source `mock`, informativo y sin
  efecto sobre Score, Ranking, Risk, Conviction, EXEC ni TOP 8.
- Las cards TOP 8 muestran DataMode, proveedor, cache/timestamp de precio y
  motivo de bloqueo de `EXEC` cuando procede.
- `EXEC` queda bloqueado con `MOCK`, `MIXED`, `STALE`, `ERROR` o mercado cerrado.
- Se anaden validadores de integridad: data mode, visible TOP 8 quotes, guardia
  EXEC por dato real, Fear & Greed mock y separacion de timestamps.
- Se actualiza `MASTER_CODEX_V1.md` con la regla normativa de DataMode.
- No se modifica conceptualmente Score Engine, Universe Engine, Operability
  Engine, Cost Gate ni guardarrailes de spread.
- No se ejecuta `execute=true`, batch 2, full-run ni ejecucion masiva.

## Fase 0 / 0.1 - Documento operativo Codex

- Se mantiene `MASTER v14_1.txt` como documento maestro oficial permanente y solo de referencia.
- Se crea `MASTER_CODEX_V1.md` como documento operativo para Codex + Vercel.
- Se sustituye la orientacion Replit por Codex + Vercel.
- Se define React + TypeScript + Vite como stack inicial para Fases 0 a 2.
- Se fija Vercel como entorno principal de despliegue.
- Se documentan EODHD como proveedor principal y Finnhub como fallback futuro.
- Se bloquean APIs reales, secrets, bases de datos, Supabase/Auth y pagos hasta fases autorizadas.

## Fase 1 - Dashboard visual mock-only

- Se crea dashboard oscuro institucional mobile-first.
- Se implementa login mock DEV ONLY.
- Se anaden Header tecnico, System Status, botones principales, Estado Scan, Fear & Greed, Master Indicators, Sectores lideres y TOP 8.
- Se usan datos mock tipados separados de componentes.
- Se crean stubs de engines sin logica financiera real.
- Se mantienen botones oficiales: `SCAN FULL`, `exportar resultados`, `exportar código`.
- Se confirma que no hay APIs reales, scanner real, scoring real, trailing real ni base de datos real.

## Fase 2 - Arquitectura Vercel-ready

- Se consolida proyecto React + TypeScript + Vite compatible con Vercel.
- Se anade `vercel.json` con framework Vite, build command y output directory.
- Se prepara `.env.example` solo con placeholders futuros.
- Se mantiene Fase 2 sin variables obligatorias.
- Se confirma ausencia de configuracion Replit activa.
- Se conserva `server/` solo como stub/documentacion, sin backend financiero real.
- Se mantiene el uso actual como personal; Supabase/Auth/usuarios/pagos quedan diferidos hasta necesidad comercial real.
- Se documenta compatibilidad futura con dispositivos Apple y Android mediante web responsive.

## Ajustes post-Fase 2 - Vercel y fecha/hora

- Se corrige el problema de zona horaria para evitar pantalla negra en Vercel.
- Se cambia la hora visible principal a hora local del navegador/dispositivo.
- Se documenta que el futuro `timezoneEngine` debe detectar fecha, hora y zona del sistema automaticamente.
- Se documenta que los estados reales de mercado deben calcularse por timezone oficial del exchange, no solo por timezone local del usuario.

## Ajustes post-Fase 2 - Visual premium institucional

- Se evoluciona el dashboard hacia estilo premium institucional inspirado en referencias tipo BlackRock/executive dashboard.
- Se adopta una paleta visual con negro premium, azul profundo, gris antracita, oro viejo/ambar y colores semanticos.
- Se conserva verde para estados positivos y rojo para negativos cuando el dato lo requiera.
- Se mantiene `SCAN FULL` como CTA dominante con estilo oro viejo.
- Se mantienen `exportar resultados` y `exportar código` como botones secundarios.
- Se convierte la interfaz visible a ingles, salvo los dos botones secundarios que deben conservar texto exacto en minusculas.
- Se simplifica la visualizacion del TOP 8 eliminando de la vista RS, EMA20, EMA50, RVOL, ATR, ATR% y Slope.
- Se conservan internamente los datos y mocks tecnicos para fases futuras.
- Se da mas protagonismo visual a Conviction.
- Se cambia trailing visual a `Trailing`, `Tight`, `Medium`, `Wide` sin alterar valores ni formulas.
- Se cambia TOP 8 hacia lista vertical de ranking de 1 a 8.
- Se anaden barras finas tipo indicador para Score y Conviction.
- Se reducen solapes y se simplifican estados largos como `CLOSED_CONTEXT` a `CLOSED` solo a nivel visual.

## Ajustes post-Fase 2 - Mercados, sectores y precios

- Se muestra Europa y Estados Unidos como estados de mercado separados.
- Se elimina el bloque UTC visible principal y se mantiene una sola hora local visible.
- Se anade consola tecnica compacta mock con EODHD, Finnhub, cache, API calls, llamadas bloqueadas, universo US, universo Europe y total analizado.
- Se anade porcentaje mock junto al precio del TOP 8 para representar variacion frente al cierre anterior.
- El porcentaje de precio se muestra en verde si es positivo y rojo si es negativo.
- Se mueven divisas detras del precio; `EUR` se renderiza visualmente como `€`.
- Se ordenan sectores de mayor porcentaje de periodo a menor.
- El porcentaje sectorial positivo se muestra en verde y el negativo en rojo.
- Se preserva la logica futura: EODHD sera fuente principal y Finnhub fallback.

## Ajustes post-Fase 2 - Documentacion simple acumulativa

- Se adopta `MASTER_CODEX_V1.md`, `CHANGELOG.md` y `AUDIT.md` como documentacion operativa principal.
- Se establece que antes de cada fase se revisan MASTER, CHANGELOG, AUDIT, codigo actual y estado Vercel.
- Se establece que al finalizar cada fase se actualizan CHANGELOG y AUDIT.
- Se evita crear nuevos documentos operativos innecesarios.

## Ajustes post-Fase 2 - Indicadores visuales de mercado

- Se refuerzan los indicadores superiores de mercado para Europe y United States.
- Cada mercado se muestra como una pildora/boton visual premium en la parte superior.
- Mercado abierto se representa en verde.
- Mercado cerrado se representa en naranja.
- El cambio es visual/mock-only y no implementa calculo real de horarios de mercado.

## Ajustes post-Fase 2 - Universo analizado visible

- Se eleva el total del universo analizado a una metrica superior visible.
- Se muestra `Analysed Universe` con total de tickers/empresas de la muestra mock.
- Se muestra desglose compacto US + Europe dentro de la misma metrica.
- El cambio es visual/mock-only y no modifica scanner real ni datos reales.

## Ajustes post-Fase 2 - Limpieza de duplicados de mercado

- Se eliminan las tarjetas duplicadas `Europe Market` y `US Market` de `System Status`.
- Los estados de mercado quedan solo en los indicadores superiores con color dinamico.
- Se ajusta el header para mantener alineacion y proporcionalidad en movil y escritorio.

## Ajustes post-Fase 2 - Consola tecnica compacta

- Se elimina `EMRR 2.0` duplicado de la consola tecnica pequena.
- Se ordenan los datos tecnicos por grupos: proveedores, cache/uptime/API, universo y muestra.
- Se mantienen los datos en modo mock sin llamadas reales.

## Ajustes post-Fase 2 - Header principal optimizado

- Se eliminan del header principal los indicadores grandes duplicados de `Europe` y `United States`.
- Los estados de mercado quedan concentrados solo en la barra superior compacta con color semantico.
- Se reorganiza el header principal para priorizar hora local, universo analizado, estado de salud y logout.
- Se reduce ruido visual y se mejora proporcionalidad en escritorio y movil sin tocar logica financiera.

## Ajustes post-Fase 2 - Logout reubicado

- Se mueve `Logout` fuera del bloque de metricas principales para evitar cercania visual con `SCAN FULL`.
- Se coloca `Logout` en la zona alta de identidad de la aplicacion como accion secundaria de sesion.
- Se aplica estilo discreto ambar/naranja, coherente con cierre de sesion y sin competir con el CTA principal.
- Se documenta que la recuperacion de ultima sesion queda como requisito futuro sin implementar persistencia real en esta fase.

## Ajustes post-Fase 2 - Proporcionalidad del dashboard

- Se ajusta el header para que las metricas superiores ocupen el ancho de forma logica y estructurada.
- Se evita que queden huecos visuales grandes en la parte derecha del dashboard.
- Se elimina la tarjeta `HEALTHY` duplicada del header principal; el estado de salud queda solo en la barra superior compacta.
- Se dejan `Local time` y `Analysed Universe` como dos bloques superiores proporcionados a todo el ancho.
- Se anade al MASTER operativo la regla de mantener proporcionalidad visual en futuros cambios.

## Ajustes post-Fase 2 - Termometro sectorial

- Se anade una barra longitudinal tipo termometro entre el porcentaje sectorial y el estado.
- La barra rellena el espacio vacio de cada sector y mejora la lectura visual del liderazgo.
- La longitud y color del termometro dependen del estado visual mock: `LEADING`, `ACCELERATING`, `WEAKENING` o `FALLING`.
- El cambio es exclusivamente visual y no altera calculos, ranking, sectores ni datos reales.

## Ajustes post-Fase 2 - Limpieza de Health Status duplicado

- Se elimina la tarjeta `Health Status` del bloque principal `System Status`.
- El estado `HEALTHY` queda solo en la barra superior compacta.
- Se reduce duplicidad visual y se mantiene el panel `System Status` centrado en API, cache, ultimo scan y readiness.
- El cambio es exclusivamente visual y no altera datos, APIs ni logica financiera.

## Ajustes post-Fase 2 - Color semantico Health

- El indicador superior de salud cambia de color segun estado.
- `HEALTHY` usa verde.
- `PARTIAL_DATA` usa amarillo.
- `DEGRADED` y `MARKET_CLOSED` usan naranja.
- `ERROR` usa rojo.
- El cambio es visual/mock-only y no altera calculos ni datos reales.

## Ajustes post-Fase 2 - Universo analizado destacado

- Se aumenta el tamano visual del total `Analysed Universe`.
- El total de la muestra analizada gana jerarquia porque es un dato operativo importante.
- El desglose `US` y `Europe` se mantiene mas pequeno para no saturar el bloque.
- El cambio es exclusivamente visual y no altera scanner, datos reales ni universo operativo.

## Ajustes post-Fase 2 - Limpieza de universo duplicado

- Se eliminan de la consola tecnica pequena las lineas duplicadas `US ...` y `Europe ...`.
- El desglose de universo queda solo dentro del bloque principal `Analysed Universe`.
- La consola tecnica queda enfocada en proveedores, cache, uptime, API calls, bloqueos y muestra.
- El cambio es visual/mock-only y no modifica datos ni scanner real.

## Mejora aprobada - Leading Sectors independiente

- Se registra `Leading Sectors` como modulo informativo independiente.
- No afecta TOP 8, ranking, scoring, Conviction, Riesgo, Momentum de activos, Trailing ni motores de seleccion.
- El modulo debe mostrar contexto sectorial, rotacion, fortaleza relativa y termometro visual de mercado.
- La clasificacion futura se basara en Momentum 5 sesiones, Momentum 20 sesiones, EMA20, slope de EMA20 y RS frente a SPY.
- El porcentaje visible representa rendimiento acumulado de las ultimas 5 sesiones, no variacion diaria ni intradia.
- El orden visual obligatorio pasa a ser `LEADING`, `ACCELERATING`, `WEAKENING`, `FALLING`.
- El porcentaje sectorial reduce protagonismo visual y queda como dato complementario.

## Ajustes post-Fase 2 - Proporcion de botones y universo

- Se refuerza que la banda de botones principales ocupe todo el ancho disponible de forma proporcional.
- Se recoloca el total de `Analysed Universe` a la derecha del modulo.
- El numero total del universo se reduce para mantener elegancia visual y proporcionalidad.
- El titulo y desglose `US`/`Europe` quedan a la izquierda del mismo modulo.
- En movil el modulo vuelve a apilarse para evitar solapes.

## Ajustes post-Fase 2 - Logout alineado con header

- Se mueve `Logout` a una accion propia del header principal, fuera del subtitulo.
- Se alinea visualmente con `EMRR 2.0` en escritorio y queda bajo la zona del `SCAN FULL` superior.
- Se iguala su tamano base al `SCAN FULL` superior compacto.
- Se aplica color marron/naranja institucional inspirado en `Europe CLOSED`.
- En movil el boton ocupa el ancho disponible para evitar solapes.

## Especificacion critica - UNIVERSE_ENGINE_SPEC

- Se crea `UNIVERSE_ENGINE_SPEC` en `MASTER_CODEX_V1.md`.
- Se define que `Universe Engine` responde que activos analiza EMRR antes de cualquier score.
- Se separa expresamente de Score Engine, Conviction, Risk, Ranking, Trailing y Leading Sectors.
- Se fijan mercados incluidos: Nasdaq, NYSE, Xetra, Euronext, Borsa Italiana, SIX y LSE.
- Se excluyen OTC, Penny Stocks, warrants, rights, ETNs, SPACs problematicos, activos sin historico suficiente y activos sin liquidez.
- Se definen reglas de normalizacion canonica `EXCHANGE:TICKER:CURRENCY`.
- Se definen umbrales iniciales de liquidez, volumen, calidad de datos e historico minimo.
- Se fija tamano estimado inicial del universo: 5,000 a 7,500 activos, con referencia mock actual de 6,960.
- Se confirma que esta especificacion no implementa scanner real ni llamadas APIs reales.

## Especificacion critica - OPERABILITY_ENGINE_SPEC

- Se crea `OPERABILITY_ENGINE_SPEC` en `MASTER_CODEX_V1.md`.
- Se define que `Operability Engine` responde si el usuario puede comprar realmente un activo desde IBKR con una SL espanola.
- Se separa expresamente de Universe Engine, Score Engine, Conviction, Risk, Ranking, Trailing y Leading Sectors.
- Se define el perfil base: SL espanola, IBKR, base EUR, restricciones PRIIPs y preferencia por instrumentos sin restricciones regulatorias.
- Se crean estados de operabilidad: `OPERABLE`, `NOT_OPERABLE` y `UNKNOWN`.
- Se fija que `UNKNOWN` nunca puede generar `EXEC`.
- Se fija que `NOT_OPERABLE` nunca puede entrar en TOP 8 operativo ni generar `EXEC`.
- Se permite que solo `OPERABLE` continue hacia score, ranking y validaciones posteriores.
- Se documentan clases iniciales operables: acciones ordinarias elegibles, acciones USA permitidas por IBKR, acciones europeas liquidas y ETFs UCITS validos si se autorizan en fases futuras.
- Se documentan clases no operables: instrumentos bloqueados, productos incompatibles, activos expresamente restringidos y productos PRIIPs sin KID/KIID valido cuando aplique.
- Se confirma que esta especificacion no implementa broker check real, scanner real ni llamadas APIs reales.

## Especificacion critica - SCORE_ENGINE_SPEC

- Se crea `SCORE_ENGINE_SPEC` en `MASTER_CODEX_V1.md`.
- Se define que `Score Engine` responde que activos validos y operables tienen la mejor tendencia alcista sana y sostenible.
- Se mantiene intacto `Universe Engine`.
- Se mantiene intacto `Operability Engine`.
- Se recupera la ponderacion original de 100 puntos: EMA20/EMA50 20, RS 20, Momentum 15, Continuidad 15, RVOL 10, Liquidez/Spread 10 y ATR saludable 10.
- Se definen subcriterios de cada bloque de score.
- Se definen penalizaciones por extension, gaps, RVOL extremo, deterioro de RS/momentum, ATR%, spread y liquidez.
- Se fijan bloqueos duros: mercado cerrado, dato stale/invalid, spread extremo, mala liquidez, ticker no normalizado y activo no operable.
- Se define `Conviction` como lectura de confianza operativa separada del score.
- Se define `Risk` como clasificacion de dificultad operativa separada del score.
- Se define el ranking operativo y su relacion con `EXEC`.
- Se confirma que `Leading Sectors` no afecta Score, Conviction, Risk, Ranking ni `EXEC`.
- Se confirma que esta especificacion no implementa scanner real, scoring real ni llamadas APIs reales.

## Fase 3 - Capa API modular Vercel-ready

- Se crea carpeta raiz `api/` con rutas serverless mock/controladas para Vercel.
- Se anade `/api/health` con estado de fase, entorno, timestamp UTC y estado publico de proveedores sin secrets.
- Se anade `/api/providers-status` con prioridad futura EODHD -> Finnhub, modo `MOCK_ONLY`, API calls a 0 y llamadas reales deshabilitadas.
- Se crean adaptadores/stubs server-side para EODHD y Finnhub sin llamadas externas.
- Se crea router de proveedores mock con EODHD como primario y Finnhub como fallback futuro.
- Se crea guarda de coste para bloquear intentos de llamadas reales en Fase 3.
- Se anaden tipos API compartidos en `shared/types/api.ts`.
- Se anade `ENABLE_REAL_API_CALLS=false` a `.env.example` solo como placeholder.
- Se incluye `api/`, `server/` y `shared/` en `tsconfig.node.json` para cubrir la capa server/API en typecheck.
- Se actualiza `MASTER_CODEX_V1.md` con el contrato estable de Fase 3.
- Se confirma que no hay EODHD real, Finnhub real, APIs reales, scanner real, scoring real, base de datos real, Supabase, usuarios reales, pagos, polling ni auto-refresh.

## Fix Fase 3 - Rutas API Vercel sin error 500

- Se detecta en Vercel error `500 FUNCTION_INVOCATION_FAILED` en `/api/health` y `/api/providers-status`.
- Se simplifican ambas rutas para devolver JSON mock estable sin depender de imports internos de `/server`.
- Se mantiene `/server/providers` y `/server/guards` como arquitectura futura, pero las rutas publicas de Fase 3 quedan autosuficientes para maxima estabilidad serverless.
- Se confirma que el fix no anade APIs reales, EODHD real, Finnhub real, scanner, scoring, base de datos, secrets, polling ni auto-refresh.

## Fase 4 - Integracion controlada EODHD/Finnhub

- Se actualiza `/api/health` a Fase 4 manteniendo estado publico de proveedores sin exponer secrets.
- Se actualiza `/api/providers-status` con modo `CONTROLLED_REAL_DATA` solo si `ENABLE_REAL_API_CALLS=true`.
- Se anade `/api/quote?symbol=SPY` para validar un unico simbolo permitido por request.
- Se anade `/api/master-indicators` limitado a `SPY`, `LQD`, `MOVE`, `VIX`, `VVIX`, `HYG` y `TNX`.
- Se crea helper serverless estable en `/api/_lib` para evitar imports fragiles desde las rutas publicas de Vercel.
- Se implementa prioridad EODHD -> Finnhub con fallback controlado y sin exponer API keys.
- Se bloquean listas masivas, simbolos fuera de allowlist, metodos no autorizados y llamadas reales si faltan claves o `ENABLE_REAL_API_CALLS` no esta activo.
- Se anade timeout server-side de 8 segundos para evitar funciones Vercel colgadas por proveedores lentos.
- Se actualiza `.env.example` para aclarar que las claves reales solo deben configurarse en Vercel.
- Se mantiene el dashboard visual sin llamadas automaticas para evitar costes invisibles.
- Se confirma que no se implementa scanner real, TOP 8 real, scoring real, trailing real, base de datos, Supabase, usuarios, pagos, polling ni auto-refresh.

## Fix Fase 4 - Compatibilidad imports API Vercel

- Se detecta en Vercel que el dashboard responde correctamente pero las rutas `/api/health`, `/api/providers-status` y `/api/master-indicators` devuelven `FUNCTION_INVOCATION_FAILED`.
- Se ajustan los imports de las funciones serverless y helpers `/api/_lib` a formato extensionless compatible con el empaquetado de Vercel.
- Se mantiene intacta la UI y no se anaden llamadas automaticas ni datos reales forzados.

## Fix Fase 4 - Rutas API autosuficientes Vercel

- Se confirma que el dashboard responde correctamente pero las rutas API seguian devolviendo `FUNCTION_INVOCATION_FAILED`.
- Se hacen autosuficientes `/api/health`, `/api/providers-status`, `/api/quote` y `/api/master-indicators` para no depender de imports locales en runtime serverless.
- Se conserva la integracion controlada EODHD -> Finnhub, allowlist de siete simbolos, bloqueo de listas masivas y `ENABLE_REAL_API_CALLS`.
- Se mantiene intacta la UI y no se anaden scanner real, TOP 8 real, scoring real, trailing real, polling ni auto-refresh.

## Fix Fase 4 - Rutas API JavaScript Vercel

- Se detecta que Vercel seguia devolviendo `FUNCTION_INVOCATION_FAILED` aunque las rutas TypeScript fueran autosuficientes.
- Se convierten las rutas publicas `/api/health`, `/api/providers-status`, `/api/quote` y `/api/master-indicators` de TypeScript a JavaScript ESM simple.
- Se anade envio JSON compatible con `response.status().json`, `writeHead/end` y `Response` para evitar diferencias de runtime.
- Se conserva el contrato de Fase 4, el modo controlado, EODHD como proveedor principal y Finnhub como fallback.
- Se mantiene intacto el dashboard visual y no se anaden scanner real, TOP 8 real, scoring real, trailing real, polling ni auto-refresh.

## Cierre Fase 4 - Validacion Vercel real controlada

- Se activa `ENABLE_REAL_API_CALLS=true` en Vercel con EODHD y Finnhub configurados.
- Se valida que `/api/health`, `/api/providers-status`, `/api/quote?symbol=SPY` y `/api/master-indicators` devuelven JSON correcto en produccion.
- `/api/quote?symbol=SPY` devuelve dato real usando EODHD.
- `/api/master-indicators` devuelve datos reales para `SPY`, `LQD`, `HYG`, `VIX`, `VVIX` y `MOVE`.
- `TNX` queda como pendiente menor porque no devuelve precio valido con el mapeo actual.
- Se validan guardarrailes: simbolos fuera de allowlist y listas multiples quedan bloqueados.
- Se confirma que no se implementa scanner real, TOP 8 real, scoring real, trailing real, base de datos, polling ni auto-refresh.

## Fase 5 - Cache controlado, trailing dinamico y hardening previo

- Se anade cache efimero en memoria runtime de Vercel para `/api/quote` y `/api/master-indicators`.
- El cache tiene TTL explicito de 60 segundos y expone `cacheStatus`, `cachedAtUtc` y `ttlSeconds`.
- El cache solo guarda quotes validas; los errores/no disponibilidad no se cachean como datos frescos.
- Se mantiene fallback a cache `STALE` solo si existe ultimo dato valido y los proveedores no responden con dato valido.
- Se actualizan `/api/health` y `/api/providers-status` a contrato Fase 5 con estrategia `EPHEMERAL_MEMORY`.
- Se implementa `calculateDynamicTrailing` como engine puro ATR-based: 0.65x, 1.00x y 1.45x.
- Se confirma que no existe cap fijo hardcoded para `trailing_wide`.
- Se remapea `TNX` en EODHD a `US10Y.GBOND` manteniendo la allowlist estricta.
- Se mantienen guardarrailes: GET only, un simbolo por quote, bloqueo multi-symbol, allowlist, timeout y no secrets en responses.
- Se confirma que no se implementa scanner real, TOP 8 real, scoring real, trailing operativo real, base de datos, polling ni auto-refresh.

## Cierre Fase 5 - Validacion Vercel cache y guardarrailes

- Se valida en Vercel que `/api/health` responde con `phase=5`, proveedores configurados, `ENABLE_REAL_API_CALLS=true` y cache `EPHEMERAL_MEMORY`.
- Se valida en Vercel que `/api/providers-status` responde en modo `CONTROLLED_REAL_DATA` con coste controlado, sin polling, sin auto-refresh y sin background jobs.
- Se valida en Vercel que `/api/quote?symbol=SPY` devuelve dato real de EODHD y metadatos de cache `cacheStatus`, `cachedAtUtc` y `ttlSeconds`.
- Se valida en Vercel que `/api/master-indicators` devuelve los 7 indicadores allowlisted sin ejecutar scanner, ranking, scoring ni trailing.
- Se confirma que `AAPL` queda bloqueado con `SYMBOL_NOT_ALLOWED`.
- Se confirma que `SPY,LQD` queda bloqueado con `MULTI_SYMBOL_BLOCKED`.
- `TNX` sigue como `NOT_AVAILABLE`; queda pendiente/no fiable en el endpoint actual sin ampliar universo ni romper la respuesta.
- Se confirma que Fase 5 no implementa Fase 6, scanner real, TOP 8 real, scoring real, trailing operativo real, base de datos, polling ni auto-refresh.

## Fase 6 - intento piloto anulado

- Se detecta que un enfoque basado en una lista fija de tickers no cumple el objetivo operativo de EMRR.
- Se anula el intento de usar un universo piloto fijo como base de Fase 6.
- Se conserva la decision de mantener `/api/top8` manual y sin auto-refresh, pero queda bloqueado hasta Universe Engine automatico.
- Se confirma que una lista manual puede servir solo para pruebas tecnicas aisladas, nunca como universo definitivo ni como base de TOP 8 operativo.

## Correccion previa Fase 6 - Universe Engine automatico obligatorio

- Se anula el enfoque de universo piloto fijo como camino valido para Fase 6.
- Se confirma que EMRR no debe depender de una lista fija de 8-20 acciones.
- Se confirma que el universo inicial no puede limitarse solo a USA.
- `/api/top8` debe permanecer bloqueado hasta que exista Universe Engine automatico y presupuesto de coste controlado.
- Se registran artefactos explicitos:
  - `docs/UNIVERSE_ENGINE_SPEC.md`
  - `docs/OPERABILITY_ENGINE_SPEC.md`
  - `docs/SCORE_ENGINE_SPEC.md`
- Se actualiza `MASTER_CODEX_V1.md` para exigir universo automatico antes de TOP 8 real.
- Se actualiza `README.md` para reflejar que Fase 6 no esta activa como TOP 8 operativo real.
- Universe Engine debera analizar automaticamente Nasdaq, NYSE, Xetra, Euronext, Borsa Italiana, SIX y LSE.
- Operability Engine debera clasificar `OPERABLE`, `NOT_OPERABLE` y `UNKNOWN` para SL espanola + IBKR + PRIIPs.
- Score Engine solo podra actuar despues de Universe Engine, Operability Engine, normalizacion, datos validos y market hours.
- Se confirma que no se implementa scanner masivo, TOP 8 operativo real, base de datos, polling, auto-refresh, background jobs ni ordenes reales.

## Fase 6 - Universe Engine metadata discovery inicial

- Se anade `/api/universe` como endpoint manual GET only.
- `/api/universe` no acepta tickers, listas ni exchanges por query.
- El endpoint descubre universo por listas de símbolos de EODHD en mercados permitidos.
- Mercados cubiertos: US, XETRA, Euronext Amsterdam, Euronext Paris, Euronext Brussels, Euronext Lisbon, Borsa Italiana, SIX y LSE.
- Se aplica filtro metadata-only para excluir instrumentos no autorizados: ETFs/ETNs, warrants, rights, preferred, units, funds, bonds, notes, SPACs y productos ambiguos.
- Se clasifica operabilidad inicial como `OPERABLE`, `NOT_OPERABLE` o `UNKNOWN`.
- Se mantiene `/api/top8` bloqueado porque aun faltan filtros completos por activo: historico suficiente, liquidez, spread y confirmacion IBKR/PRIIPs.
- Se confirma que no se implementa TOP 8 operativo real ni scanner masivo.

## Fase 6 - Engines puros para auditoria previa a TOP 8

- Se separa `Universe Engine` en `api/_lib/universeEngine.js`.
- Se separa `Operability Engine` en `api/_lib/operabilityEngine.js`.
- Se anade `Technical Engine` puro en `api/_lib/technicalEngine.js`.
- Se anade `Eligibility Engine` puro en `api/_lib/eligibilityEngine.js`.
- Se anade `Score Engine` puro en `api/_lib/scoreEngine.js`.
- Se anade `Candidate Evaluation Engine` puro en `api/_lib/candidateEvaluationEngine.js`.
- `api/universe.js` reutiliza los engines compartidos y deja de mantener reglas duplicadas.
- `/api/universe` queda limitado a resumen y muestra publica de 50 activos para evitar una respuesta tipo screener gigante.
- `Score Engine` valida bloqueos duros antes de calcular score:
  - `UNKNOWN` no puede generar accion operativa.
  - `NOT_OPERABLE` no puede entrar en TOP 8 operativo.
  - dato no valido o liquidez insuficiente bloquean score.
  - mercado no abierto bloquea ejecucion/`EXEC`, pero puede permitir score diagnostico manual si el resto de datos es valido.
- `Score Engine` calcula trailing dinamico ATR-based con `0.65x`, `1.00x` y `1.45x`, sin cap fijo.
- `/api/top8` mantiene bloqueo manual y ahora reporta `UNIVERSE_ELIGIBILITY_NOT_COMPLETE`.
- Se confirma que aun no se conecta scoring a un endpoint operativo ni se implementa TOP 8 real.

## Fase 6 - Elegibilidad tecnica previa a score

- `Technical Engine` calcula indicadores desde OHLCV validado: EMA20, EMA50, ATR, ATR%, RVOL, momentum, RS20/RS60, avgValue20 y maxDrawdown20.
- El historico minimo pasa a 61 barras para poder calcular RS60 correctamente.
- `Eligibility Engine` bloquea candidatos sin historico suficiente, sin liquidez minima, sin spread verificado o con calidad de dato no buena.
- La salida de elegibilidad separa `eligibleForScore` y `eligibleForExecution`: mercado no abierto bloquea ejecucion, no score diagnostico.
- La implementacion sigue sin llamadas externas nuevas y sin conectar `/api/top8` operativo.

## Fase 6 - Separacion score diagnostico vs ejecucion

- Se separa la elegibilidad tecnica para score de la elegibilidad para ejecucion.
- `marketStatus` no `OPEN` anade `MARKET_NOT_OPEN` a `executionBlockedReasons`.
- Un activo `OPERABLE` con historico, liquidez, spread y calidad validos puede recibir score diagnostico aunque el mercado este `UNKNOWN` o cerrado.
- `UNKNOWN` y `NOT_OPERABLE` siguen bloqueando score y ejecucion.
- No se genera `EXEC`; Fase 6 mantiene acciones no operativas como `WATCH`/`STANDBY` o `BLOCKED`.

## Fase 6 - Pipeline puro de candidato a TOP 8

- Se crea un orquestador puro candidato -> Technical Engine -> Eligibility Engine -> Score Engine.
- El pipeline no contiene lista fija de tickers.
- El pipeline no llama APIs, no escanea y no escribe persistencia.
- `NOT_OPERABLE` y `UNKNOWN` quedan fuera del ranking operativo aunque tengan historico valido.
- Solo candidatos `OPERABLE` con elegibilidad aprobada y score real pueden entrar en el TOP 8 generado por el engine.
- `/api/top8` permanece bloqueado hasta conectar datos reales historicos/spread con coste controlado.

## Fase 6 - Provider historico controlado interno

- Se anade `api/_lib/historicalDataProvider.js`.
- El provider prepara historico diario EODHD para simbolos derivados de exchanges aprobados por Universe Engine.
- Bloquea simbolos con sufijo no aprobado, simbolos multiples y llamadas si `ENABLE_REAL_API_CALLS` no esta activo.
- Normaliza OHLCV y limita la ventana a 260 barras.
- Usa cache efimero en memoria con TTL 24h.
- No crea endpoint publico, no activa `/api/top8`, no escanea el universo y no ejecuta llamadas automaticas.

## Fase 6 - Provider spread controlado interno

- Se anade `api/_lib/spreadDataProvider.js`.
- El provider prepara verificacion de spread EODHD bid/ask para simbolos derivados de exchanges aprobados.
- Bloquea simbolos con sufijo no aprobado, simbolos multiples y llamadas si `ENABLE_REAL_API_CALLS` no esta activo.
- Si el proveedor no devuelve bid/ask valido, devuelve `SPREAD_NOT_AVAILABLE`.
- Usa cache efimero en memoria con TTL 60s.
- No crea endpoint publico, no activa `/api/top8`, no escanea el universo y no ejecuta llamadas automaticas.

## Fase 6 - TOP 8 pipeline con cost gate

- Se anade `api/_lib/top8Pipeline.js`.
- Se anade `api/_lib/top8BatchPlanner.js`.
- Se anade `/api/top8-batch` como endpoint manual de lote dinamico.
- `/api/top8` deja de ser solo placeholder y se conecta a Universe Engine dinamico.
- `health` y `providers-status` reportan `top8Endpoint=cost_gate_active`.
- `/api/top8` no acepta query, tickers manuales, listas ni exchanges ad hoc.
- El endpoint descubre universo automatico y aplica una compuerta de coste antes de historico/spread.
- Si el universo operable supera el maximo controlado, devuelve `COST_GATE_REQUIRES_BATCHING_STRATEGY` y no calcula TOP 8.
- Cuando bloquea por coste, devuelve `batchPlan` con lotes derivados del universo dinamico.
- El `batchPlan` expone resumen por region/exchange y estimacion de llamadas, no una lista gigante de tickers.
- `/api/top8-batch?batch=N` hace dry-run por defecto y no ejecuta historico/spread.
- `/api/top8-batch?batch=N&execute=true&runId=...` ejecuta solo ese lote dinamico acotado y lo adjunta al run.
- `/api/top8-batch` bloquea cualquier query que no sea `batch`, `execute` o `runId`.
- El pipeline puede calcular TOP 8 en universos pequenos/sinteticos donde el coste queda dentro del gate.
- Se mantiene sin polling, sin auto-refresh, sin background jobs, sin base de datos y sin lista fija de acciones.

## Fase 6 - Validacion Vercel y cierre tecnico parcial

- Vercel responde OK en `/api/health` y declara Fase 6 con engines activos.
- `/api/providers-status` responde OK con EODHD principal, Finnhub fallback y controles de coste activos.
- `/api/quote?symbol=SPY` responde OK con datos reales controlados.
- `/api/master-indicators` responde OK; `TNX` sigue `NOT_AVAILABLE` y no bloquea Fase 6.
- Guardarrailes validados: `/api/quote?symbol=AAPL` devuelve `SYMBOL_NOT_ALLOWED` y `/api/quote?symbol=SPY,LQD` devuelve `MULTI_SYMBOL_BLOCKED`.
- `/api/top8` esta conectado al universo dinamico y bloquea correctamente con `COST_GATE_REQUIRES_BATCHING_STRATEGY` para evitar llamadas masivas.
- `/api/top8-batch?batch=1` funciona en modo dry-run y no ejecuta historico/spread sin `execute=true`.
- Build local no se pudo ejecutar en este terminal porque `npm` no esta disponible; queda pendiente validarlo en entorno con Node/npm o Vercel.

## Fase 6 - Agregacion efimera de lotes dinamicos

- Se anade `api/_lib/top8RunStore.js`.
- Se anade `/api/top8-run` como endpoint manual para crear o consultar sesiones efimeras de TOP 8.
- `/api/top8-run?create=true` descubre el universo dinamico y crea una sesion de agregacion sin ejecutar historico/spread.
- `/api/top8-run?runId=...` consulta el estado de una sesion viva en memoria runtime.
- `/api/top8-batch` acepta `runId` para adjuntar resultados de un lote ejecutado manualmente.
- `runId` es opcional en dry-run y obligatorio cuando `execute=true`.
- La agregacion conserva solo los mejores 8 candidatos por score/conviccion.
- Cada run guarda una huella interna de activos operables ordenados y una firma del universo dinamico para evitar mezclar lotes de universos distintos.
- La firma detecta cambios de composicion aunque los conteos del universo sean iguales.
- Un batch ya adjuntado se bloquea antes de repetir llamadas historicas/spread.
- Un `runId` inexistente se bloquea antes de cualquier llamada externa.
- La sesion es efimera, limitada a memoria Vercel runtime, TTL 30 minutos y maximo 5 sesiones.
- Cada run informa `completedBatchCount`, `remainingBatchCount`, `nextBatchNumber` e `isGlobalTop8Final`.
- El TOP 8 agregado se marca como final solo cuando `remainingBatchCount=0` e `isGlobalTop8Final=true`.
- Se anade `/api/top8-final` para devolver TOP 8 global solo si el run esta completo.
- `/api/top8-final` no llama proveedores, no acepta tickers y bloquea runs parciales con `RUN_NOT_COMPLETE`.
- `/api/top8-batch` exige `runId` para cualquier `execute=true`; se bloquean ejecuciones sueltas con `RUN_ID_REQUIRED_FOR_EXECUTION`.
- Se anade `scripts/validate-phase6.mjs` y script `npm run check:phase6` para validar el flujo dinamico sin depender de servicios externos reales.
- No se anade base de datos, SQLite, Redis, Vercel KV, polling, auto-refresh, worker ni cron.
- El TOP 8 global solo es final si todos los lotes dinamicos autorizados de la sesion se procesan en el mismo runtime vivo.
- Nota posterior: esta situacion quedo resuelta en el cierre final de Fase 6 tras
  commit/push/deploy y validacion segura en Vercel.

## Cierre Fase 6 final - Auditoria Vercel y documentacion

- GitHub queda sincronizado con `origin/main`; el push posterior responde
  `Everything up-to-date`.
- Vercel responde OK en `/api/health` con `phase=6`,
  `top8RunEndpoint=ephemeral_manual_aggregation_active` y
  `top8FinalEndpoint=complete_run_only_active`.
- `/api/providers-status` confirma EODHD/Finnhub configurados, controles de coste,
  sin polling, sin auto-refresh y sin background jobs.
- `/api/quote?symbol=SPY` devuelve dato real controlado con cache efimero.
- `/api/master-indicators` responde; `TNX` sigue `NOT_AVAILABLE` y no bloquea
  Fase 6.
- `/api/top8-run?create=true` crea una sesion efimera manual con
  `providerCallsPlanned=0`; no ejecuta historico/spread.
- `/api/top8-final?runId=test` devuelve `RUN_NOT_FOUND`, confirmando que el
  endpoint existe y bloquea runs invalidos.
- No se ejecuta ningun batch real con `execute=true` durante el cierre.
- No se implementa Fase 7, base de datos real, SQLite, Redis, Vercel KV,
  polling, auto-refresh, worker, cron, scanner masivo ni ordenes reales.

## Fase 7 - Hardening final, testing y cost safety

- `/api/top8-batch` acepta ahora `confirm=EXECUTE_BATCH` como guardarrail de
  segunda confirmacion.
- Cualquier `execute=true` con `runId` pero sin `confirm=EXECUTE_BATCH` bloquea
  con `EXECUTION_CONFIRMATION_REQUIRED` antes de descubrir universo o ejecutar
  llamadas historicas/spread.
- `execute=true` sigue exigiendo `runId`; las ejecuciones sueltas continuan
  bloqueadas con `RUN_ID_REQUIRED_FOR_EXECUTION`.
- El dry-run `/api/top8-batch?batch=N` permanece manual y sin historico/spread.
- Se actualizan mensajes de `/api/top8-run` y `/api/top8-batch` para mostrar la
  ruta completa segura:
  `/api/top8-batch?batch=N&execute=true&runId=...&confirm=EXECUTE_BATCH`.
- Se anade `scripts/validate-phase7.mjs` y script `npm run check:phase7`.
- Se actualiza `scripts/validate-phase6.mjs` para convivir con el nuevo
  hardening.
- `MASTER_CODEX_V1.md` registra la regla Fase 7 de doble confirmacion.
- Vercel valida rutas seguras tras deploy: health/providers OK, guardarrailes de
  quote OK, Master Indicators OK, `top8-run` OK, `top8-batch?batch=1` dry-run OK
  con `confirmationRequiredForExecution=confirm=EXECUTE_BATCH`, y
  `top8-final?runId=test` bloquea con `RUN_NOT_FOUND`.
- No se ejecuta `execute=true` en Vercel durante la fase.
- No se implementa Fase 8, base de datos real, SQLite, Redis, Vercel KV,
  polling, auto-refresh, workers, cron, scanner masivo ni ordenes reales.

## Fase 8 - Estrategia de coste y lotes sin ejecucion masiva

- Se anade `api/_lib/top8CostPolicy.js` como capa pura de politica de coste.
- La politica centraliza estados `SAFE_DRY_RUN`,
  `MANUAL_APPROVAL_REQUIRED`, `COST_TOO_HIGH` y
  `NOT_OPERATIONAL_FULL_RUN`.
- `/api/top8`, `/api/top8-run` y `/api/top8-batch` anaden metadatos:
  `costPolicy`, `estimatedProviderCalls`,
  `estimatedFullRunProviderCalls`, `manualApprovalRequired`,
  `recommendedNextAction` y `fullUniverseExecutionAllowed=false`.
- `/api/health` y `/api/providers-status` reportan la politica Fase 8 como
  readiness/cost control, manteniendo el modo operativo manual.
- `/api/top8-batch?batch=N` mantiene dry-run seguro con
  `providerCallsPlanned=0` y muestra coste estimado del lote y del universo
  completo sin ejecutar historico/spread.
- `execute=true` sigue protegido por `runId` y
  `confirm=EXECUTE_BATCH`; Fase 8 no relaja ningun guardarrail de Fase 7.
- Se anade `scripts/validate-phase8.mjs` y script `npm run check:phase8`.
- `MASTER_CODEX_V1.md` queda actualizado con la regla Fase 8 de politica de
  coste.
- Vercel queda validado en rutas seguras: health/providers exponen politica
  Fase 8, quote/guardarrailes OK, Master Indicators OK, `/api/top8` bloquea
  full-run con `COST_TOO_HIGH`, `top8-run` y `top8-batch?batch=1` muestran
  metadatos de coste sin historico/spread.
- No se ejecuta `execute=true` en Vercel durante la fase.
- No se implementa Fase 9, base de datos real, SQLite, Redis, Vercel KV,
  polling, auto-refresh, workers, cron, scanner masivo, full-run operativo ni
  ordenes reales.

## Fase 9 - Trazabilidad de lote parcial sin ejecucion real por defecto

- Se anade `api/_lib/top8ResultMetadata.js` para centralizar metadatos de
  alcance de resultado.
- `/api/top8-batch` marca respuestas de lote como
  `resultScope=PARTIAL_BATCH_ONLY`, `isPartialResult=true` e
  `isGlobalTop8Final=false`.
- `/api/top8-batch` expone `batchExecutionMode`, `executedBatchCount`,
  `remainingBatchCount` y `actualProviderCalls`.
- `/api/top8-final` refuerza `RUN_NOT_COMPLETE` como agregacion parcial, no TOP
  8 global, y solo usa `resultScope=GLOBAL_TOP8_FINAL` en runs completos.
- Se anade `scripts/validate-phase9.mjs` y script `npm run check:phase9`.
- `MASTER_CODEX_V1.md` registra la regla Fase 9 de resultado parcial.
- Vercel Production queda validado tras deploy del commit `8745f2f`; el dry-run
  `/api/top8-batch?batch=1` devuelve `PARTIAL_BATCH_ONLY`,
  `isPartialResult=true`, `isGlobalTop8Final=false` y
  `actualProviderCalls=null`.
- No se ejecuta ningun lote real con `execute=true` en Vercel durante la fase
  porque no existe autorizacion textual explicita.
- No se implementa Fase 10, full-run, scanner masivo automatico, base de datos
  real, SQLite, Redis, Vercel KV, polling, auto-refresh, workers, cron, sockets
  ni ordenes reales.

## Fase 10 - TNX controlled diagnostic y estabilizacion informativa

- Se anaden metadatos informativos a quotes y Master Indicators:
  `isInformationalOnly=true`, `affectsScore=false`,
  `affectsRanking=false` y `affectsExec=false`.
- TNX mantiene los mapeos controlados actuales: EODHD `US10Y.GBOND` y Finnhub
  `^TNX`; no se introducen simbolos alternativos por adivinanza.
- TNX expone `providerSymbolsTried` y `diagnosticStatus`; si no hay precio
  valido queda `TNX_PROVIDER_UNRESOLVED` y `dataQuality=NOT_AVAILABLE`.
- Se actualiza `api/_lib/marketData.ts` y `shared/types/api.ts` para reflejar
  los campos publicos nuevos sin romper el contrato existente.
- Se anade `scripts/validate-phase10.mjs` y script `npm run check:phase10`.
- `MASTER_CODEX_V1.md` registra que TNX y Master Indicators son informativos y
  no afectan score, ranking, EXEC ni TOP 8.
- Vercel Production queda validado tras deploy del commit `9f625fe`; TNX sigue
  `NOT_AVAILABLE` pero expone metadatos informativos y
  `diagnosticStatus=TNX_PROVIDER_UNRESOLVED`.
- No se ejecuta `execute=true`, no se ejecuta lote real, no se hace full-run y
  no se implementa Fase 11.

## Fase 11 - Validacion controlada de un unico lote real autorizado

- Se realiza precheck documental, codigo y Vercel con rutas seguras.
- El usuario autoriza una unica ejecucion real: `batch=1`.
- Se crea run efimero en Vercel:
  `e59d1a39-e943-41e0-8d45-87ca36a4f0bb`, con
  `providerCallsPlanned=0`, `remainingBatchCount=855` y
  `fullUniverseExecutionAllowed=false`.
- El dry-run `/api/top8-batch?batch=1` queda sano y muestra
  `estimatedProviderCalls=51`, `resultScope=PARTIAL_BATCH_ONLY`,
  `isPartialResult=true` e `isGlobalTop8Final=false`.
- Se intenta exactamente una vez la ruta autorizada:
  `/api/top8-batch?batch=1&execute=true&runId=e59d1a39-e943-41e0-8d45-87ca36a4f0bb&confirm=EXECUTE_BATCH`.
- Vercel bloquea antes de consumir proveedores con `RUN_NOT_FOUND`;
  `providerCallsPlanned=0`, `actualProviderCalls=null`, `assets=[]`.
- No se reintenta, no se ejecuta `batch=2`, no se hace full-run y no se genera
  TOP 8 global.
- Se detecta riesgo operativo: la agregacion efimera en memoria no es fiable
  entre funciones/runtime Vercel para handoff `top8-run` -> `top8-batch` ->
  `top8-final`.
- Se anade `scripts/validate-phase11.mjs` y script `npm run check:phase11`.
- `MASTER_CODEX_V1.md` registra la regla Fase 11: un intento autorizado, bloqueo
  sin coste si `runId` no esta disponible y no reintentar sin nueva aprobacion.
- Fase 11 queda cerrada como validacion segura con bloqueo operativo detectado;
  no queda aprobada para ejecutar mas lotes reales hasta resolver handoff de run
  compatible con Vercel.

## Fase 11.1 - Handoff Vercel sin base de datos

- Se anade `/api/top8-batch-single` como endpoint unico manual para evitar el
  handoff de memoria efimera entre funciones Vercel.
- `/api/top8-batch-single?batch=1` hace dry-run seguro de lote 1 con
  `providerCallsPlanned=0`, `singleInvocation=true`,
  `resultScope=PARTIAL_BATCH_ONLY`, `isPartialResult=true`,
  `isGlobalTop8Final=false`, `finalizationAvailable=false` y
  `requiresPersistenceForGlobalFinal=true`.
- La ruta acepta solo `batch`, `execute` y `confirm`; bloquea querys extra,
  batch no numerico y cualquier batch distinto de `1`.
- `execute=true` exige `confirm=EXECUTE_BATCH`, pero no se ejecuta en Vercel
  durante Fase 11.1 por falta de autorizacion textual posterior.
- El endpoint nuevo no importa ni usa `top8RunStore`, no requiere `runId`, no
  crea persistencia y no genera TOP 8 global.
- `/api/health` y `/api/providers-status` reportan
  `top8BatchSingleEndpoint=single_invocation_dry_run_active`.
- Vercel Production queda validado tras deploy del commit `303ef83`:
  `/api/top8-batch-single?batch=1` responde en dry-run con
  `phase=11.1`, `estimatedProviderCalls=51`, `providerCallsPlanned=0`,
  `singleInvocation=true`, `resultScope=PARTIAL_BATCH_ONLY` y
  `fullUniverseExecutionAllowed=false`.
- Checklist Vercel segura OK: health, providers, SPY, TNX informativo,
  bloqueo AAPL, bloqueo multi-symbol, Master Indicators, `/api/top8`
  bloqueando full-run, `/api/top8-batch?batch=1` dry-run y
  `/api/top8-final?runId=test` con `RUN_NOT_FOUND`.
- Se anade `scripts/validate-phase11-1.mjs` y script
  `npm run check:phase11-1`.
- `MASTER_CODEX_V1.md` registra la regla Fase 11.1.
- `npm` no esta disponible localmente en esta maquina (`command not found:
  npm`); los validadores directos con Node pasan y Vercel valida deploy.
- No se implementa Fase 12, full-run, batch 2, automatizacion ni base de datos
  real.

## Fase 11.2 - Validacion real controlada single-invocation

- Se realiza precheck documental, codigo, validadores locales y Vercel con rutas
  seguras.
- Se ejecuta exactamente una vez la ruta autorizada:
  `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH`.
- Resultado Vercel:
  - timestamp UTC `2026-06-01T08:05:04.262Z`.
  - HTTP 409.
  - `ok=false`.
  - `error=NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`.
  - `providerCallsPlanned=51`.
  - `actualProviderCalls=51`.
  - `estimatedProviderCalls=51`.
  - `assets=[]`.
  - `analyzed=25`, `eligibleForScore=0`, `blocked=25`.
- El resultado queda correctamente marcado como parcial:
  `resultScope=PARTIAL_BATCH_ONLY`, `isPartialResult=true`,
  `isGlobalTop8Final=false`, `singleInvocation=true`,
  `globalAggregationAvailable=false`, `finalizationAvailable=false` y
  `requiresPersistenceForGlobalFinal=true`.
- Post-ejecucion, Vercel sigue sano: health/providers OK, `/api/top8` sigue
  bloqueando full-run y `/api/top8-batch-single?batch=1` sigue funcionando en
  dry-run con `providerCallsPlanned=0`.
- No se repite la ejecucion, no se ejecuta batch 2, no se hace full-run, no se
  genera TOP 8 global, no se crea persistencia y no se implementa Fase 12.
- Fase 11.2 queda cerrada como validacion real con bloqueo de elegibilidad del
  lote 1; requiere analisis/correccion antes de cualquier nueva ejecucion real.

## Fase 11.3 - Diagnostico de elegibilidad del lote 1 sin nueva ejecucion real

- Se revisa el bloqueo de Fase 11.2 sin repetir `execute=true`, sin batch 2 y
  sin full-run.
- Se detecta la limitacion principal del resultado real de Fase 11.2: la
  respuesta expuso `evaluationSummary` pero no razones de bloqueo por activo, por
  lo que la causa exacta del lote real no puede reconstruirse sin nueva
  ejecucion autorizada.
- Se anade diagnostico puro en `api/_lib/candidateEvaluationEngine.js`:
  `buildEligibilityDiagnostics` agrega razones por categoria, proveedor,
  tecnicos y ejecucion, y devuelve muestra controlada `perAssetBlockedReasons`.
- `api/_lib/top8Pipeline.js` conserva `historyStatus` y `spreadStatus` por
  activo y devuelve `eligibilityDiagnostics` junto al resumen del pipeline.
- `/api/top8-batch-single` conserva su contrato partial-only y anade:
  - `diagnosticMode=DRY_RUN_COST_METADATA_ONLY` en dry-run.
  - `eligibilityDiagnostics` en respuestas de ejecucion futuras.
  - `lastRealRunSummary` manual de Fase 11.2 para trazabilidad documental sin
    persistencia.
- Se crea `scripts/validate-phase11-3.mjs` y `npm run check:phase11-3`.
- Validaciones locales directas con Node OK:
  - `node scripts/validate-phase6.mjs`.
  - `node scripts/validate-phase7.mjs`.
  - `node scripts/validate-phase8.mjs`.
  - `node scripts/validate-phase9.mjs`.
  - `node scripts/validate-phase10.mjs`.
  - `node scripts/validate-phase11.mjs`.
  - `node scripts/validate-phase11-1.mjs`.
  - `node scripts/validate-phase11-3.mjs`.
- Fase 11.3 no ejecuta `execute=true`, no ejecuta lote real, no ejecuta batch 2,
  no hace full-run, no anade base de datos, no anade automatismos y no implementa
  Fase 12.

## Fase 11.4 - Ejecucion diagnostica real unica con eligibility diagnostics

- Se realiza precheck documental, codigo, validadores locales y Vercel con rutas
  seguras.
- Se ejecuta exactamente una vez la ruta autorizada:
  `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH`.
- Resultado Vercel:
  - timestamp UTC `2026-06-01T09:30:11.235Z`.
  - HTTP 409.
  - `ok=false`.
  - `error=NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`.
  - `providerCallsPlanned=51`.
  - `actualProviderCalls=51`.
  - `estimatedProviderCalls=51`.
  - `selectedAssets=25`.
  - `assets=[]`.
  - `evaluationSummary.analyzed=25`.
  - `evaluationSummary.eligibleForScore=0`.
  - `evaluationSummary.blocked=25`.
- `eligibilityDiagnostics` queda disponible y confirma:
  - `SPREAD_NOT_VERIFIED=25`.
  - `SPREAD_NOT_AVAILABLE=25` como razon de proveedor.
  - `ILLIQUID_AVG_VALUE_20_BELOW_MINIMUM=14`.
  - `LIQUIDITY_BELOW_PHASE6_MINIMUM=14`.
  - `INSUFFICIENT_HISTORY=1`.
  - `MARKET_NOT_OPEN=25` como bloqueo de ejecucion, no como causa primaria de
    score.
- Causa raiz principal: el lote 1 no puede producir activos elegibles porque el
  proveedor no devuelve spread verificable para ninguno de los 25 activos
  Euronext Amsterdam del lote.
- Fase 11.4 no repite la ejecucion, no ejecuta batch 2, no hace full-run, no
  genera TOP 8 global, no anade base de datos, no anade automatismos y no
  implementa Fase 12.

## Fase 11.5 - Politica controlada de spread Europa/Euronext

- Se define una politica pura y auditable en `api/_lib/spreadPolicy.js`.
- La politica clasifica:
  - `SPREAD_VERIFIED`.
  - `SPREAD_NOT_AVAILABLE`.
  - `SPREAD_NOT_VERIFIED`.
  - `SPREAD_DIAGNOSTIC_ONLY`.
  - `SPREAD_BLOCKS_EXEC`.
- `api/_lib/eligibilityEngine.js` incorpora la politica sin relajar
  guardarrailes: spread no verificado sigue bloqueando elegibilidad operativa.
- `api/_lib/candidateEvaluationEngine.js` expone la politica en diagnosticos por
  activo y agrega `spreadPolicyCounts`.
- `/api/top8-batch-single?batch=1` actualiza el resumen de ultima ejecucion real
  a la auditoria diagnostica Fase 11.4 y mantiene dry-run sin coste.
- Se crea `scripts/validate-phase11-5.mjs` y `npm run check:phase11-5`.
- Validacion Fase 11.5 confirma:
  - spread no disponible bloquea `EXEC`.
  - spread no verificado puede quedar como diagnostico no operativo.
  - activos sin spread verificado no entran en TOP 8 global operativo.
  - no se inventa spread ni se usa proxy operativo.
- Fase 11.5 no ejecuta `execute=true`, no ejecuta batch 2, no hace full-run, no
  anade base de datos, no anade automatismos y no implementa Fase 12.

## Fase 11.6 - Decision controlada sobre spread Europa/Euronext

- Se adopta la politica de continuidad
  `EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK`.
- Estado actual recomendado:
  - Europa/Euronext queda en `DIAGNOSTIC_ONLY` si no hay bid/ask verificable.
  - `SPREAD_NOT_VERIFIED` sigue bloqueando `EXEC`.
  - Los activos sin spread verificable no pueden entrar en TOP 8 global
    operativo.
  - No se inventa spread ni se calcula proxy operativo.
- `api/_lib/spreadPolicy.js` centraliza la decision Fase 11.6 con:
  - `unverifiedSpreadExecAllowed=false`.
  - `unverifiedSpreadGlobalTop8Allowed=false`.
  - `requiresVerifiedBidAsk=true`.
  - `productionProviderChecksAllowed=PUNCTUAL_MANUAL_ONLY`.
  - `configurationChangeAllowed=false`.
- `/api/top8-batch-single?batch=1` expone en dry-run
  `spreadContinuationDecision` sin ejecutar historico/spread.
- Se crea `scripts/validate-phase11-6.mjs` y `npm run check:phase11-6`.
- No se consultaron directamente las fuentes financieras configuradas; no fue
  necesario para cerrar la politica. Solo se comprobaron endpoints Vercel
  seguros y ya existentes.
- Fase 11.6 no ejecuta `execute=true`, no ejecuta batch 2, no hace full-run, no
  permite `EXEC`, no cambia configuracion, no anade proveedores, no anade base
  de datos, no anade automatismos y no implementa Fase 12.

## Fase 11.7 - Prueba manual disenada de spread bid/ask verificable

- Se crea `api/_lib/spreadVerificationPolicy.js` como helper puro, sin llamadas
  externas y sin endpoint publico nuevo.
- La politica Fase 11.7 define `SPREAD_VERIFICATION_DIAGNOSTIC_ONLY` para casos
  donde exista bid/ask verificable, manteniendo:
  - `execAllowed=false`.
  - `globalTop8Allowed=false`.
  - `verificationResultScope=DIAGNOSTIC_ONLY`.
  - `requiresRealBidAsk=true`.
- Criterios estrictos de bid/ask verificable:
  - bid numerico valido.
  - ask numerico valido.
  - bid > 0.
  - ask > bid.
  - proveedor identificado.
  - simbolo proveedor identificado.
  - timestamp/contexto de dato claro.
  - sin mock.
  - sin proxy.
  - sin fallback silencioso.
- Se crea `scripts/validate-phase11-7.mjs` y `npm run check:phase11-7`.
- No se consultaron fuentes financieras reales durante Fase 11.7; la fase queda
  como diseno y validacion local sin coste. Cualquier comprobacion real futura
  debe ser autorizada en una fase posterior.
- Fase 11.7 no ejecuta `execute=true`, no ejecuta batch 2, no hace full-run, no
  permite `EXEC`, no cambia configuracion, no anade proveedores, no anade base
  de datos, no anade automatismos y no implementa Fase 12.

## Fase 12 - Cierre y consolidacion final EMRR 2.0

- Se realiza auditoria global unica de cierre sobre arquitectura, build,
  Vercel, dashboard, APIs, TOP 8, Universe Engine, Operability Engine, Score
  Engine, trailing, exportaciones, seguridad, rendimiento, costes y UX/UI.
- Checks locales ejecutados:
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
- `npm run build` no pudo ejecutarse localmente porque `npm` no esta disponible
  en este entorno Codex (`command not found: npm`). Vercel queda como
  validacion de build/deploy de produccion.
- Comprobacion Vercel final:
  - Dashboard `/` responde HTTP 200.
  - `/api/health` OK.
  - `/api/providers-status` OK con EODHD y Finnhub configurados.
  - `/api/quote?symbol=SPY` OK.
  - `/api/quote?symbol=TNX` estable como informativo/no operativo con
    `TNX_PROVIDER_UNRESOLVED`.
  - `/api/quote?symbol=AAPL` bloquea con `SYMBOL_NOT_ALLOWED`.
  - `/api/quote?symbol=SPY,LQD` bloquea con `MULTI_SYMBOL_BLOCKED`.
  - `/api/master-indicators` OK.
  - `/api/top8` bloquea el TOP 8 global con
    `COST_GATE_REQUIRES_BATCHING_STRATEGY`.
  - `/api/top8-batch-single?batch=1` OK en dry-run, con
    `providerCallsPlanned=0`, `estimatedProviderCalls=51`,
    `resultScope=PARTIAL_BATCH_ONLY` y `fullUniverseExecutionAllowed=false`.
- Revision de decision final:
  - Se distingue bug critico real de funcionalidad futura planificada.
  - No se detecta bug critico real de dashboard, Vercel, APIs, Score Engine,
    guardarrailes, control de costes ni arquitectura.
  - El TOP 8 global completo, el batching masivo definitivo, el Universe Engine
    global final y la validacion completa de spreads europeos se reclasifican
    como backlog `v1.1`, no como bloqueo de v1.0 beta.
- Clasificacion final:
  - CRITICO: ninguno detectado para uso controlado beta.
  - IMPORTANTE / v1.1: completar TOP 8 global, agregacion persistente o
    equivalente autorizada, bid/ask europeo verificable y market hours
    verificados para USA/Europa.
  - OPCIONAL / v2.0: mejoras de UX, exportaciones avanzadas, observabilidad,
    auth real, usuarios, broker, ordenes reales y automatizaciones futuras.
- No se aplican cambios de logica en Fase 12 porque no se detecta una correccion
  critica necesaria para uso controlado beta.
- No se ejecuta `execute=true`, no se ejecuta batch 2, no se hace full-run, no se
  anade base de datos, no se anaden automatismos y no se crean subfases.
- Decision final:
  `EMRR 2.0 v1.0 APTO PARA USO CONTROLADO (BETA)`.

## Correcciones auditoria 2026-06-01

- Se corrigen bugs visibles del dashboard mock/controlado sin abrir nueva fase
  ni tocar endpoints reales.
- BUG-01 / ERR-02: el universo mock deja de depender del fijo `6.960` y pasa a
  una unica fuente `universeStats` con rangos controlados para USA y Europa.
- BUG-02 / ERR-04: se anade `src/utils/marketHours.ts` para calcular
  `OPEN/CLOSED` client-side con UTC, sin APIs externas ni polling financiero.
- BUG-03 / BUG-07: `SCAN FULL` simula un scan de 1,7 s y refresca universo,
  precios TOP 8, timestamps y `Last Scan`.
- BUG-04: cualquier `EXEC` se degrada a `CLOSED_CONTEXT` cuando el mercado del
  activo no esta `OPEN`.
- BUG-05: Fear & Greed mock se regenera en cada scan con fuente
  `CNN Fear & Greed (mock)`.
- BUG-06: Master Indicators mock se actualizan en cada scan con rangos
  plausibles y timestamps nuevos.
- ERR-01: se valida el orden de Leading Sectors por estado MASTER y performance
  descendente dentro de cada grupo.
- ERR-03: `MASTER_CODEX_V1.md` documenta el mapeo visual Tight/Medium/Wide del
  trailing sin cambiar formulas.
- Se anaden validadores locales:
  - `scripts/validate-market-hours.mjs`.
  - `scripts/validate-scanfull-mock-refresh.mjs`.
  - `scripts/validate-universe-dynamic.mjs`.
  - `scripts/validate-top8-closed-market-exec-block.mjs`.
  - `scripts/validate-leading-sectors-order.mjs`.
  - `scripts/validate-trailing-label-map.mjs`.
- `git diff --check`, validadores historicos Fase 6 a Fase 11.7 y nuevos
  validadores dashboard ejecutados correctamente.
- `npm run build` no pudo ejecutarse localmente porque `npm` no esta disponible
  en este entorno (`command not found: npm`).
- No se anaden APIs reales, no se relajan guardarrailes, no se modifica el Score
  Engine conceptual, no se ejecuta `execute=true`, no se ejecuta batch 2 y no se
  hace full-run.

## Correccion precios mock y TREND - 2026-06-01

- Se corrige el mock base del TOP 8 para que los precios de primer render sean
  verosimiles para junio de 2026:
  - `ASML`: `EUR 1620.00`, EMA20 `EUR 1580.00`, EMA50 `EUR 1520.00`, ATR
    `EUR 38.00`, ATR% `2.35%`.
  - `SAP`: `EUR 168.00`, EMA20 `EUR 163.00`, EMA50 `EUR 152.00`, ATR
    `EUR 3.20`, ATR% `1.90%`.
  - `AVGO`: `$242.00`, EMA20 `$235.00`, EMA50 `$218.00`, ATR `$9.20`,
    ATR% `3.80%`.
  - `MSFT`: `$462.00`, EMA20 `$448.00`, EMA50 `$425.00`, ATR `$6.60`,
    ATR% `1.43%`.
  - `NVDA`: `$135.00`, EMA20 `$128.00`, EMA50 `$112.00`, ATR `$6.80`,
    ATR% `5.04%`.
- Se ajustan precios/EMA/ATR de `AIR`, `LLY` y `REL` para mantener coherencia
  mock entre precio, EMA20, EMA50, ATR% y trailing.
- Se corrige el render de `TREND` en la card TOP 8:
  - etiquetas cortas legibles (`Bull Strong`, `Bullish`, `EMA20 > EMA50`);
  - `title` accesible con el texto completo;
  - se elimina el ellipsis del bloque `TREND`.
- Se corrige la logica mock de accion para que activos USA (`Nasdaq`/`NYSE`)
  con mercado `OPEN`, dato `CLEAN`/`GOOD`, score >= 82, conviction >= 78 y risk
  `LOW`/`MEDIUM` puedan mostrar `EXEC`.
- Europa cerrada sigue bloqueando `EXEC` mediante `CLOSED_CONTEXT`.
- No se modifica el Score Engine conceptual, no se tocan endpoints reales, no se
  llaman APIs externas, no se ejecuta `execute=true`, no se hace full-run y no
  se anaden dependencias.
- Se anaden validadores locales:
  - `scripts/validate-top8-mock-prices-2026.mjs`.
  - `scripts/validate-top8-trend-render.mjs`.
  - `scripts/validate-top8-open-market-exec-eligibility.mjs`.

## Correccion anclaje precios TOP 8 y Fear & Greed - 2026-06-01

- Se corrige el problema detectado tras `SCAN FULL`: los precios ya no hacen
  una caminata aleatoria desde el precio anterior.
- Se anade `MOCK_TOP8_PRICE_REFERENCES` como tabla unica de referencia mock por
  ticker. Cada scan deriva el precio desde esa referencia, no desde el ultimo
  valor renderizado.
- Se actualizan referencias principales para mercado EEUU abierto:
  - `NVDA`: `$218.41`.
  - `MSFT`: `$450.24`.
  - `AVGO`: `$412.65`.
  - `LLY`: `$987.05`.
- Se mantiene Europa como mercado cerrado/controlado:
  - `ASML`: `EUR 1630.00`.
  - `SAP`: `EUR 167.90`.
  - `AIR`: `EUR 186.00`.
  - `REL`: `GBX 4,050`.
- En mercado `OPEN`, el scan aplica una deriva pequena y acotada alrededor de
  la referencia. En mercado `CLOSED`, la deriva queda en `0`.
- Se corrige el segundo desfase detectado en auditoria: `AVGO` deja de usar una
  referencia cercana a `$458` y pasa a la zona `$412-$414`; `LLY` deja la zona
  `$1041` y pasa a la zona `$987`.
- Fear & Greed deja de regenerarse con rango amplio y queda anclado a
  `61 / Greed` con rango mock controlado `58-66`.
- Se anade `scripts/validate-fear-greed-mock-anchor.mjs`.
- No se conectan APIs reales al dashboard, no se cambia el Score Engine, no se
  tocan endpoints reales y no se ejecuta `execute=true`.
