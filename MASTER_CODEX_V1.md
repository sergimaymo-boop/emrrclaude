# MASTER_CODEX_V1 - EMRR 2.0 / Tendencias

Documento operativo para desarrollo con Codex + Vercel.

Fecha de creacion: 2026-05-29  
Documento fuente oficial: `/Users/sergimaymo/Desktop/MASTER v14_1.txt`  
Estado: Fase 0.1 completada como documento de trabajo. No inicia Fase 1.

---

## 0. Regla de autoridad documental

`MASTER v14_1.txt` sigue siendo el documento maestro oficial permanente.
No debe modificarse, renombrarse ni usarse como archivo operativo directo.

`MASTER_CODEX_V1.md` es el documento operativo para programacion con Codex.
Todas las fases futuras deben ejecutarse contra este documento, manteniendo
trazabilidad con el MASTER oficial original.

Fuente de verdad operativa desde 2026-05-30:

1. `MASTER_CODEX_V1.md`
2. `CHANGELOG.md`
3. `AUDIT.md`
4. Codigo actual del repositorio
5. Estado actual de Vercel

Antes de iniciar una nueva fase se deben revisar esos cinco elementos. Si hay
contradiccion entre documentacion y codigo, prevalece el codigo actual del
repositorio y despues se propone la actualizacion documental correspondiente.

No crear sistemas documentales complejos ni multiplicar documentos operativos.
La documentacion viva del proyecto debe concentrarse en:

- `MASTER_CODEX_V1.md`: arquitectura, reglas, roadmap y funcionamiento general.
- `CHANGELOG.md`: historial acumulativo de cambios aprobados.
- `AUDIT.md`: auditoria acumulativa, riesgos, deuda tecnica y validaciones.

Los documentos historicos dentro de `docs/` y `audits/` pueden conservarse como
referencia, pero no sustituyen a `CHANGELOG.md` ni `AUDIT.md` como documentos
operativos acumulativos.

---

## 1. Objetivo del sistema

EMRR 2.0 / Tendencias sera una aplicacion financiera tipo dashboard
institucional, mobile-first, orientada a detectar tendencias alcistas sanas y
operables en bolsa.

El sistema debe:

- mostrar solo los TOP 8 activos mas fuertes,
- reducir ruido visual y financiero,
- mantener proporcionalidad visual en todos los cambios de dashboard, evitando
  huecos vacios, bloques descompensados o alineaciones sin logica,
- controlar estrictamente costes de APIs,
- priorizar datos validos y operables,
- bloquear senales EXEC inseguras,
- prepararse para despliegue en Vercel,
- prepararse para usuarios, roles y acceso futuro de terceros.

No debe convertirse en:

- screener masivo,
- dashboard macro saturado,
- laboratorio cuantitativo visible para usuario final,
- lista gigante de tickers,
- sistema con llamadas automaticas o invisibles.

---

## 2. Auditoria tecnica del MASTER v14.1

### 2.1 Hallazgos heredados de Replit

El MASTER oficial original se define como una especificacion optimizada para
Replit. Para el objetivo actual, esa orientacion queda sustituida por
Codex + Vercel.

Elementos detectados y tratamiento:

| Elemento detectado | Riesgo | Decision en este documento |
| --- | --- | --- |
| Titulo "optimizada para Replit" | Confunde el entorno objetivo | Reescrito como Codex + Vercel |
| Protocolo de rebuild infinito de Replit | No aplica a Vercel | Sustituido por protocolo general de bloqueo tecnico |
| Control de implementacion Replit | Dependencia operativa obsoleta | Sustituido por control Codex/Vercel |
| Preparacion local asociada a Replit | Puede introducir archivos no deseados | No usar `.replit`; no depender de Replit |
| SQLite local desde Fase 2 | Riesgo en serverless Vercel | Convertido en persistencia futura autorizada |

### 2.2 Dependencias innecesarias o no autorizadas

No instalar ni integrar sin autorizacion expresa:

- Firebase,
- Supabase,
- Auth.js,
- Clerk,
- SendGrid,
- SMTP externo,
- Canva,
- Figma,
- builders externos,
- servicios cloud de pago,
- APIs financieras adicionales,
- herramientas automaticas de pago.

Supabase, Auth.js, Clerk, Neon, Turso, Vercel Postgres o Vercel KV pueden
evaluarse en fases futuras, pero no se incorporan por defecto.

### 2.3 Contradicciones corregidas

| Contradiccion | Correccion operativa |
| --- | --- |
| Fase 2 con SQLite local real | Fase 2 sera Vercel-ready sin persistencia real obligatoria |
| Botones antiguos `Top Copy` / `BACKUP CODIGO` | Botones oficiales: `exportar resultados` y `exportar código` |
| Fase 2 mezclada con datos reales | Datos reales pasan a fases posteriores autorizadas |
| Replit como entorno principal | Vercel es entorno principal de despliegue |

### 2.4 Riesgos principales

- Coste de APIs por llamadas invisibles o repetidas.
- Exposicion de API keys si se llama a proveedores desde frontend.
- Persistencia local incompatible con Vercel serverless.
- Sobreingenieria temprana antes de validar UI y flujo.
- Scoring real prematuro sin validacion de datos.
- Generar EXEC con mercado cerrado, dato stale, ticker no normalizado o
  liquidez/spread inadecuados.
- Exportar secretos por error en `exportar código`.

### 2.5 Sobreingenieria detectada

El MASTER original define muchos engines desde el inicio. Se conservan como
fronteras modulares, pero su implementacion real queda estrictamente diferida
por fases.

En Fase 1 solo pueden existir carpetas, tipos, interfaces, datos mock y stubs
sin logica financiera real.

---

## 3. Arquitectura recomendada para Vercel

### 3.1 Decision tecnica

Usar React + TypeScript + Vite para Fases 0 a 2.

Justificacion:

- encaja con dashboard visual mock-only,
- build simple para Vercel,
- menor complejidad que Next.js al inicio,
- compatible con `npm install` y `npm run build`,
- output estatico `dist`,
- evita introducir SSR/routing server antes de ser necesario,
- permite evolucionar a Vercel Functions desde Fase 3.

Next.js no se adopta inicialmente. Solo se reconsiderara si una fase futura
requiere de forma clara SSR, rutas API integradas, middleware avanzado,
autenticacion server-side compleja o una arquitectura SaaS mas integrada.

### 3.2 Estructura objetivo

Directorio oficial:

```text
/Users/sergimaymo/Desktop/Bolsa Codex/Tendencias
```

Estructura base:

```text
src/
  components/
  pages/
  engines/
  mocks/
  types/
  utils/
server/
  routes/
  engines/
shared/
  types/
data/
docs/
```

Reglas:

- no usar rutas absolutas locales en runtime,
- no exponer secrets en frontend,
- no depender de archivos fuera del proyecto,
- no crear persistencia real antes de fase autorizada,
- mantener modulos pequenos y sustituibles.

### 3.3 Vercel

Configuracion esperada:

- install command: `npm install`,
- build command: `npm run build`,
- output: `dist`,
- variables de entorno gestionadas en Vercel,
- sin `.env` en repositorio,
- sin claves visibles en logs, UI, exports o backups.

Variables futuras previstas:

```text
EODHD_API_KEY
FINNHUB_API_KEY
ENABLE_REAL_API_CALLS
APP_PASSWORD
AUTH_SECRET
```

`AUTH_SECRET` queda reservado para autenticacion futura. No se implementa en
Fase 1.

---

## 4. Metodologia obligatoria por fases

No avanzar automaticamente entre fases. Cada fase requiere aprobacion explicita
del usuario antes de comenzar.

Cada fase debe entregar:

1. alcance exacto implementado,
2. limites respetados,
3. que NO se ha implementado,
4. archivos creados/modificados,
5. prueba local,
6. prueba en Vercel,
7. auditoria tecnica,
8. riesgos o bloqueos,
9. aprobacion requerida para avanzar.

### Fases oficiales operativas

| Fase | Objetivo | Datos reales |
| --- | --- | --- |
| 0 | Auditar MASTER v14.1 | No |
| 0.1 | Crear `MASTER_CODEX_V1.md` | No |
| 0.2 | Auditar `MASTER_CODEX_V1.md` | No |
| 1 | Dashboard visual mock-only | No |
| 1.1 | Auditoria tecnica de Fase 1 | No |
| 2 | Arquitectura Vercel-ready | No |
| 2.1 | Prueba completa de despliegue en Vercel | No |
| 3 | Capa API modular | Controlado, sin masivo |
| 4 | Integracion EODHD/Finnhub basica | Si, autorizada |
| 5 | Scanner real | Si |
| 6 | TOP 8 real, scoring y validaciones | Si |
| 7 | Trailing dinamico y cache/persistencia autorizada | Si |
| 8 | Exportaciones avanzadas | Segun autorizacion |
| 9 | Usuarios, roles y accesos | Segun autorizacion |
| 10 | Hardening, testing y deploy final | Segun alcance |

---

### Fase 6 - condicion previa de universo automatico

Fase 6 NO puede depender de una lista fija de 8-20 tickers.

Antes de activar TOP 8 real, EMRR debe implementar y auditar:

- `UNIVERSE_ENGINE_SPEC`,
- `OPERABILITY_ENGINE_SPEC`,
- `SCORE_ENGINE_SPEC`.

Reglas obligatorias:

- el universo elegible debe determinarse automaticamente,
- el universo no puede limitarse solo a USA,
- el universo inicial incluye USA y Europa,
- cualquier lista manual solo puede usarse como prueba tecnica aislada, nunca
  como universo definitivo ni como base de ranking operativo,
- `/api/top8` debe permanecer bloqueado si no existe Universe Engine automatico.

Mercados incluidos:

- USA: Nasdaq, NYSE.
- Europa: Xetra, Euronext, Borsa Italiana, SIX, LSE.

Excluir:

- OTC,
- Penny Stocks,
- Warrants,
- Rights,
- ETNs,
- SPACs problematicos,
- activos sin historico suficiente,
- activos iliquidos.

Operability Engine debe clasificar cada activo para SL espanola + IBKR +
restricciones PRIIPs:

- `OPERABLE`,
- `NOT_OPERABLE`,
- `UNKNOWN`.

Puertas duras:

- `UNKNOWN` no puede generar `EXEC`,
- `NOT_OPERABLE` no puede entrar en TOP 8 operativo,
- solo `OPERABLE` puede pasar a ranking operativo.

---

## 5. Reglas absolutas de Fase 1

Fase 1 sera solo visual/mock.

Permitido:

- UI,
- mock data,
- login mock DEV ONLY,
- layout responsive,
- dashboard oscuro institucional,
- cards,
- botones,
- estado scan visual,
- Fear & Greed mock,
- Master Indicators mock,
- sectores lideres mock,
- TOP 8 mock,
- stubs de engines,
- export mock sin APIs.

Prohibido:

- APIs reales,
- EODHD real,
- Finnhub real,
- scraping CNN,
- SQLite/base real,
- scanner real,
- scoring real,
- trailing real,
- calculos financieros reales,
- polling,
- auto-refresh,
- timers persistentes,
- background jobs,
- llamadas externas.

---

## 6. Botones oficiales

### 6.1 SCAN FULL

Texto exacto:

```text
SCAN FULL
```

Reglas:

- siempre en mayusculas,
- CTA principal,
- mayor tamano,
- mayor jerarquia visual,
- unico boton que podra llamar APIs reales en fases futuras autorizadas,
- en Fase 1 solo simula flujo visual mock.

### 6.2 exportar resultados

Texto exacto:

```text
exportar resultados
```

Reglas:

- minusculas,
- boton secundario,
- menor tamano que `SCAN FULL`,
- no llama APIs,
- exporta datos relevantes del TOP 8 para analisis posterior.

Formatos previstos:

- clipboard,
- TXT,
- CSV,
- JSON,
- Markdown,
- DOCX si procede,
- descarga local,
- Archivos iPhone,
- Finder Mac mediante descarga manual,
- Google Drive solo si se autoriza,
- email solo si se autoriza,
- texto compatible con ChatGPT.

Campos minimos:

- ticker,
- nombre,
- mercado,
- estado mercado,
- timestamp,
- precio,
- score,
- conviccion,
- EMA20,
- EMA50,
- slope,
- RS,
- RVOL,
- ATR,
- ATR%,
- momentum,
- riesgo,
- trailing_adjusted,
- trailing_medium,
- trailing_wide,
- accion operativa,
- calidad del dato,
- fuente del dato.

### 6.3 exportar código

Texto exacto:

```text
exportar código
```

Reglas:

- minusculas,
- boton secundario,
- menor tamano que `SCAN FULL`,
- no llama APIs,
- exporta copia tecnica del proyecto y documentacion.

Debe excluir siempre:

- `node_modules`,
- `dist`,
- `build`,
- `.env`,
- `.env.*`,
- passwords,
- API keys,
- tokens,
- secrets,
- logs,
- caches reales,
- bases de datos reales,
- snapshots financieros reales.

---

## 7. Control de costes

Todo se actualiza manualmente.

Prohibido:

- polling automatico,
- auto-refresh,
- llamadas invisibles,
- scans automaticos,
- loops innecesarios,
- actualizaciones al abrir dashboard,
- actualizaciones al refrescar navegador,
- llamadas API desde exportaciones.

Regla:

`SCAN FULL` sera el unico punto de entrada futuro para llamadas reales a APIs.

Controles futuros:

- maximo 1 `SCAN FULL` simultaneo,
- boton bloqueado durante scan,
- timeout global de scan,
- retries limitados,
- fallback controlado,
- cache como ultimo recurso,
- STOP_RUNTIME ante loops o errores criticos.

---

## 8. Proveedores de datos

Proveedor principal:

```text
EODHD
```

Proveedor secundario/fallback:

```text
Finnhub
```

Reglas:

- EODHD siempre primero,
- Finnhub solo si EODHD falla, no tiene dato, da timeout o no valida,
- si EODHD responde correctamente, no usar Finnhub,
- no usar proveedores nuevos sin autorizacion,
- no hardcodear API keys,
- no llamar proveedores desde frontend,
- no llamar APIs reales hasta fase autorizada.

### 8.1 Contrato Fase 3 - Capa API modular mock

Fase 3 crea solo arquitectura API server-side compatible con Vercel.

Rutas minimas:

- `/api/health`: estado tecnico de la aplicacion, fase, entorno, timestamp UTC
  y proveedores sin exponer secrets.
- `/api/providers-status`: prioridad futura EODHD -> Finnhub, modo `MOCK_ONLY`,
  llamadas API a 0 y llamadas reales deshabilitadas.

Reglas:

- EODHD queda como proveedor principal futuro.
- Finnhub queda como fallback futuro.
- en Fase 3 cualquier intento de llamada externa real queda bloqueado por
  guarda de coste,
- `ENABLE_REAL_API_CALLS` existe solo como placeholder futuro y en Fase 3 no
  activa llamadas reales,
- las rutas no deben devolver API keys ni valores de secrets,
- la capa API no implementa scanner real, scoring real, universo real,
  operabilidad real, persistencia ni datos financieros reales.

### 8.2 Contrato Fase 4 - Integracion controlada basica

Fase 4 autoriza solo validacion server-side minima de datos reales para
proveedores y Master Indicators.

Rutas:

- `/api/quote?symbol=SPY`: quote individual para simbolos permitidos.
- `/api/master-indicators`: lectura limitada a `SPY`, `LQD`, `MOVE`, `VIX`,
  `VVIX`, `HYG` y `TNX`.

Reglas:

- EODHD es siempre proveedor principal.
- Finnhub solo actua como fallback si EODHD falla o no devuelve dato valido.
- `ENABLE_REAL_API_CALLS=true` es obligatorio para permitir llamadas reales.
- si faltan claves o `ENABLE_REAL_API_CALLS` no esta activo, las rutas deben
  responder de forma controlada como no configuradas.
- `/api/quote` acepta un solo simbolo por request y solo de allowlist.
- `/api/master-indicators` queda limitado a siete simbolos.
- las llamadas a proveedor deben tener timeout server-side razonable.
- no hay polling, auto-refresh, llamadas invisibles, listas masivas ni retries
  agresivos.
- la Fase 4 no implementa scanner real, ranking TOP 8 real, scoring real,
  Conviction real, Risk real, trailing real, base de datos ni usuarios reales.

Fear & Greed futuro:

- modulo visual separado,
- no duplicarlo en Master Indicators,
- CNN solo best effort si se autoriza,
- si no hay dato parseable, ocultar modulo sin romper dashboard.

---

## 9. Seguridad, usuarios y terceros

Fase 1:

- login mock DEV ONLY,
- no seguridad real,
- no usuarios reales,
- no pagos,
- no roles reales.

Futuro:

- usuarios,
- roles,
- acceso protegido,
- posible modelo SaaS,
- posible integracion con Auth.js, Clerk, Supabase Auth u otro sistema
  autorizado.

Reglas:

- validar credenciales reales en backend o proveedor autorizado,
- no exponer secrets,
- no exportar secrets,
- no escribir keys en consola,
- logout visible,
- preparacion modular sin dependencia prematura.

---

## 10. Estados y tipos base

Estados de mercado:

```ts
type MarketStatus = "OPEN" | "CLOSED" | "HOLIDAY" | "STALE";
```

Calidad de dato:

```ts
type DataQuality = "CLEAN" | "GOOD" | "WARNING" | "STALE" | "INVALID";
```

Accion operativa:

```ts
type ActionStatus =
  | "EXEC"
  | "WATCH"
  | "HOLD"
  | "STANDBY"
  | "EXTENDED"
  | "BLOCKED"
  | "CLOSED_CONTEXT";
```

Health status:

```ts
type HealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "PARTIAL_DATA"
  | "MARKET_CLOSED"
  | "ERROR";
```

Regla absoluta:

Nunca generar `EXEC` si:

- mercado cerrado,
- holiday,
- dato stale,
- dato invalid,
- precio no fiable,
- liquidez mala,
- spread extremo,
- activo no normalizado.

---

## 11. Market Hours

Estados:

- `OPEN`,
- `CLOSED`,
- `HOLIDAY`,
- `STALE`.

Ignorar:

- premarket,
- afterhours,
- subastas.

Reglas:

- `EXEC` solo puede existir con mercado `OPEN`,
- mercado cerrado muestra contexto/cache,
- mercados cerrados no lanzan scanner operativo real,
- USA cerrado y Europa abierta: solo activos europeos operables,
- Europa cerrada y USA abierto: solo activos USA operables,
- ambos cerrados: ultimo snapshot valido cacheado.

### 11.1 Fecha, hora y zona horaria del usuario

El sistema debe quedar preparado para funcionar correctamente aunque el usuario
viaje o use la aplicacion desde distintas zonas horarias: Canarias, Italia,
Tailandia u otros paises.

Regla futura:

- detectar automaticamente fecha, hora y zona horaria del dispositivo/navegador
  cuando sea posible,
- permitir override manual de zona horaria si el usuario lo necesita,
- mostrar timestamps en la zona horaria configurada del usuario,
- no depender de una zona fija como Canarias para todos los usuarios,
- tener en cuenta que al viajar puede cambiar la hora y tambien la fecha local.

Regla critica:

La zona horaria del usuario NO debe usarse para decidir por si sola si un
mercado esta abierto. El estado operativo debe calcularse contra la zona horaria
real de cada mercado/exchange.

Zonas base previstas:

- usuario: `Intl.DateTimeFormat().resolvedOptions().timeZone` como deteccion
  automatica inicial,
- Canarias: `Atlantic/Canary`,
- Italia/Espana peninsular: `Europe/Rome` / `Europe/Madrid`,
- EEUU mercado principal: `America/New_York`,
- Londres: `Europe/London`.

Fases futuras:

- Fase 3: definir contrato tecnico del `marketHoursEngine` y `timezoneEngine`,
- Fase 4/5: aplicar horario real de mercado al validar datos y scans,
- Fase 8/9: guardar preferencia de zona horaria por usuario si hay cuentas reales.

Regla de coste:

La actualizacion de fecha/hora local puede ser automatica en frontend sin llamar
APIs externas. No debe provocar polling financiero, scans automaticos ni consumo
de proveedores de datos.

---

## 12. Master Indicators

Indicadores previstos:

- SPY,
- LQD,
- MOVE,
- VIX,
- VVIX,
- HYG,
- TNX.

Reglas:

- son informativos,
- no modifican directamente score,
- no modifican ranking,
- no modifican `EXEC`,
- deben mostrarse en modulo propio,
- no duplicar Fear & Greed aqui.

Cada card debe contener:

- simbolo,
- nombre,
- valor,
- variacion si aplica,
- timestamp,
- fuente,
- estado `LIVE` / `LAST` / `CLOSED`,
- color dinamico.

---

## 13. UNIVERSE_ENGINE_SPEC

`Universe Engine` responde una sola pregunta:

```text
Que activos analiza EMRR?
```

Es una puerta de entrada previa a cualquier calculo. Decide que activos pueden
entrar al proceso de analisis y cuales quedan fuera.

Separacion obligatoria:

- no forma parte de `Score Engine`,
- no forma parte de `Conviction`,
- no forma parte de `Risk`,
- no forma parte de `Ranking`,
- no forma parte de `Trailing`,
- no forma parte de `Leading Sectors`,
- no decide que activo es mejor,
- no genera `EXEC`.

Regla:

Un activo solo puede pasar a score si primero supera `Universe Engine`.

### 13.1 Mercados incluidos

Estados Unidos:

- Nasdaq,
- NYSE.

Europa:

- Xetra,
- Euronext,
- Borsa Italiana,
- SIX,
- LSE.

### 13.2 Mercados excluidos inicialmente

Excluir:

- OTC,
- Pink Sheets,
- mercados no regulados,
- dark pools,
- mercados sin soporte claro en EODHD/Finnhub,
- premarket,
- afterhours,
- subastas,
- instrumentos negociados solo en mercados secundarios sin liquidez fiable.

### 13.3 Instrumentos incluidos

Incluir inicialmente:

- acciones ordinarias liquidas,
- acciones primarias de companias listadas en mercados incluidos,
- ADRs liquidos solo si cotizan en Nasdaq o NYSE y tienen datos completos,
- acciones europeas ordinarias con ticker normalizable y divisa clara.

Regla:

Si una compania cotiza duplicada en varios mercados, usar preferentemente la
linea primaria mas liquida y mejor cubierta por datos. No duplicar la misma
exposicion economica dentro del universo operativo salvo autorizacion futura.

### 13.4 Instrumentos excluidos

Excluir inicialmente:

- Penny Stocks,
- OTC,
- warrants,
- rights,
- ETNs,
- SPACs problematicos o sin negocio operativo claro,
- preferred shares,
- closed-end funds,
- fondos,
- bonos,
- opciones,
- futuros,
- CFDs,
- cripto,
- forex,
- activos suspendidos,
- activos delisted,
- activos sin historico suficiente,
- activos sin liquidez suficiente,
- ETFs como candidatos TOP 8 salvo autorizacion futura.

Nota:

ETFs como SPY, LQD, HYG o proxies sectoriales pueden usarse en modulos
informativos como Master Indicators o Leading Sectors, pero no forman parte del
universo TOP 8 inicial.

### 13.5 Normalizacion de tickers

Cada activo debe tener un identificador canonico interno:

```text
EXCHANGE:TICKER:CURRENCY
```

Ejemplos:

```text
NASDAQ:NVDA:USD
NYSE:LLY:USD
XETRA:SAP:EUR
EURONEXT:ASML:EUR
LSE:REL:GBX
```

Reglas:

- conservar ticker local original,
- mapear simbolos de proveedor a ticker canonico interno,
- separar ticker visible de ticker API,
- guardar exchange, pais, divisa y nombre de compania,
- normalizar sufijos de mercado de EODHD/Finnhub sin exponerlos en UI si no son
  necesarios,
- no mezclar ADR con accion primaria si representan lineas distintas,
- no aceptar activos sin exchange soportado,
- no aceptar activos sin divisa clara,
- no aceptar activos con ticker ambiguo que no pueda resolverse de forma
  deterministica.

### 13.6 Liquidez minima

Un activo debe cumplir liquidez operable. Umbrales iniciales:

- Estados Unidos: valor medio negociado 20 sesiones >= 10M USD,
- Europa: valor medio negociado 20 sesiones >= 5M EUR equivalente,
- precio minimo: >= 5 USD/EUR/GBP equivalente,
- spread estimado: <= 0.75% en condiciones normales,
- si el spread supera 1.25%, bloquear activo aunque el resto de datos sea bueno.

Regla:

La liquidez mala bloquea el activo antes del score. Un score alto futuro nunca
debe compensar liquidez insuficiente.

### 13.7 Volumen minimo

Umbrales iniciales:

- Estados Unidos: volumen medio 20 sesiones >= 200,000 acciones/dia,
- Europa: volumen medio 20 sesiones >= 100,000 acciones/dia,
- no aceptar volumen cero en la sesion mas reciente valida,
- no aceptar series con huecos de volumen repetidos sin explicacion de mercado.

Si hay conflicto entre volumen y valor negociado, prevalece el criterio mas
conservador.

### 13.8 Calidad de datos

Requisitos minimos:

- OHLCV diario valido,
- close ajustado disponible o ajustable,
- timestamp de dato claro,
- divisa clara,
- exchange claro,
- nombre de compania disponible,
- estado de mercado calculable,
- corporate actions no incoherentes,
- ausencia de gaps extremos no explicados,
- fuente identificada.

Proveedor:

- EODHD es fuente principal,
- Finnhub es fallback,
- si EODHD entrega dato valido, no consultar Finnhub para ese activo,
- si EODHD falla o no valida, Finnhub puede completar solo el dato necesario,
- no llamar APIs reales hasta fase autorizada,
- no exponer claves en frontend.

Calidad minima para entrar al analisis:

- `CLEAN` o `GOOD`: puede pasar,
- `WARNING`: puede pasar solo como `WATCH` futuro, nunca `EXEC`,
- `STALE` o `INVALID`: bloqueado antes del score.

### 13.9 Historico minimo

Historico diario minimo:

- minimo operativo: 260 sesiones validas,
- recomendado: 504 sesiones validas,
- minimo absoluto para cualquier calculo: 80 sesiones validas.

Reglas:

- activos con menos de 80 sesiones quedan excluidos,
- entre 80 y 259 sesiones quedan bloqueados para ranking real salvo autorizacion
  futura especifica,
- para score real completo se requieren al menos 260 sesiones,
- historico insuficiente bloquea `EXEC`.

### 13.10 Tamano estimado del universo

Estimacion inicial tras filtros:

- Estados Unidos: 3,500 a 5,000 activos,
- Europa: 1,500 a 2,500 activos,
- total esperado: 5,000 a 7,500 activos.

Referencia mock actual:

```text
US 4,820 + Europe 2,140 = 6,960
```

Este numero es orientativo y debera recalcularse cuando se autoricen datos
reales.

### 13.11 Auditoria obligatoria del universo

Antes de pasar a scanner real, auditar:

- riesgo de universo demasiado pequeno,
- riesgo de universo demasiado grande,
- riesgo de sesgo geografico,
- riesgo de exclusion de oportunidades,
- riesgo de datos inconsistentes,
- compatibilidad real con EODHD y Finnhub.

Decision actual:

`Universe Engine` queda definido como especificacion operativa. En Fase 6 existe
una primera implementacion de descubrimiento de metadatos en `/api/universe`,
manual, controlada y sin ranking operativo.

Estado Fase 6:

- `/api/universe` puede solicitar listas de simbolos por exchange aprobado si
  `ENABLE_REAL_API_CALLS=true`,
- el maximo inicial es 9 peticiones de metadatos por ciclo manual,
- el cache es efimero en runtime con TTL explicito,
- no acepta query manual de tickers,
- la respuesta publica debe devolver resumen y muestra limitada, nunca una lista
  gigante tipo screener,
- no ejecuta historico, liquidez, spread, scoring, ranking ni TOP 8,
- no sustituye al Universe Engine definitivo completo,
- `/api/top8` permanece bloqueado hasta completar los filtros de historico,
  liquidez, spread, operabilidad y score.

Implementacion tecnica Fase 6:

- `api/_lib/universeEngine.js` centraliza mercados, deduplicacion y mapeo de
  activos descubiertos,
- `api/_lib/operabilityEngine.js` centraliza la clasificacion
  `OPERABLE` / `NOT_OPERABLE` / `UNKNOWN`,
- `api/_lib/historicalDataProvider.js` prepara consumo historico diario interno
  para simbolos de exchanges aprobados, con cache efimero y sin endpoint publico,
- `api/_lib/spreadDataProvider.js` prepara verificacion interna de spread bid/ask
  para simbolos de exchanges aprobados, con cache efimero y sin endpoint publico,
- `api/_lib/technicalEngine.js` centraliza calculo puro de indicadores desde
  OHLCV validado,
- `api/_lib/eligibilityEngine.js` centraliza la puerta previa a score:
  historico, liquidez, spread, market status y calidad,
- `api/_lib/scoreEngine.js` centraliza score puro, bloqueos duros y trailing
  ATR-based,
- `api/_lib/candidateEvaluationEngine.js` orquesta candidato -> tecnicos ->
  elegibilidad -> score -> ranking TOP 8 sin llamadas externas,
- `api/_lib/top8Pipeline.js` conecta universo dinamico con cost gate,
  historico, spread, evaluacion y ranking,
- `api/_lib/top8BatchPlanner.js` genera lotes deterministicos sobre el universo
  dinamico cuando el cost gate bloquea,
- `/api/top8` queda conectado al universo dinamico pero debe bloquear si el
  universo operable supera el presupuesto manual de coste,
- el estado publico de `/api/top8` es `cost_gate_active` mientras no exista una
  estrategia de batching autorizada para universos grandes,
- `/api/top8-batch` permite dry-run manual de lotes dinamicos y solo ejecuta
  proveedores con `execute=true`; no acepta tickers manuales,
- `/api/top8-run` permite crear/consultar una sesion efimera de agregacion de
  lotes dinamicos autorizados, sin base de datos ni automatismos,
- estos engines no contienen una lista fija de 8-20 tickers.

Regla Fase 6 de agregacion:

- La agregacion de TOP 8 por lotes debe ser efimera y manual mientras no exista
  persistencia autorizada.
- Crear una sesion de run no debe ejecutar historico/spread.
- Un lote solo puede ejecutarse con accion manual explicita `execute=true`.
- `execute=true` debe exigir `runId`; no se permiten batches ejecutados fuera de
  una sesion agregable.
- Desde Fase 7, `execute=true` tambien debe exigir
  `confirm=EXECUTE_BATCH`; si falta, debe bloquearse antes de descubrir universo
  o consumir historico/spread con `EXECUTION_CONFIRMATION_REQUIRED`.
- Cada run debe validar fingerprint/firma de universo para no mezclar lotes de
  universos dinamicos distintos, incluso si los conteos coinciden.
- `runId` inexistente o batch ya adjuntado deben bloquearse antes de consumir
  llamadas historicas/spread.
- El TOP 8 global solo puede considerarse final si todos los lotes dinamicos
  autorizados se procesan dentro de la misma sesion viva.
- La salida de una sesion debe exponer cobertura (`remainingBatchCount`,
  `nextBatchNumber`, `isGlobalTop8Final`) para no confundir resultados parciales
  con TOP 8 global.
- La finalizacion de TOP 8 debe requerir run completo; si falta algun lote debe
  bloquear con estado explicito y no ejecutar llamadas externas.

Regla Fase 8 de politica de coste:

- La estrategia de coste debe ser una capa simple, server-side y sin
  persistencia real.
- Las respuestas seguras de `/api/top8`, `/api/top8-run` y `/api/top8-batch`
  deben exponer `costPolicy`, `estimatedProviderCalls`,
  `estimatedFullRunProviderCalls`, `manualApprovalRequired`,
  `recommendedNextAction` y `fullUniverseExecutionAllowed=false`.
- Estados permitidos de politica:
  - `SAFE_DRY_RUN`: solo metadatos/dry-run, sin historico/spread.
  - `MANUAL_APPROVAL_REQUIRED`: ejecucion real solo con aprobacion manual,
    `runId` y `confirm=EXECUTE_BATCH`.
  - `COST_TOO_HIGH`: el coste estimado del universo completo es excesivo para
    una ejecucion operativa.
  - `NOT_OPERATIONAL_FULL_RUN`: el full-run no esta autorizado aunque pueda
    existir plan de lotes.
- Fase 8 no autoriza ejecutar el universo completo, no crea automatismos, no
  crea base de datos y no cambia el modelo manual.
- La accion recomendada debe priorizar dry-run y, si hay aprobacion expresa,
  como maximo un lote manual por sesion operativa.

Regla Fase 9 de resultado parcial:

- Una respuesta de `/api/top8-batch` debe marcarse siempre como resultado de
  lote parcial con `resultScope=PARTIAL_BATCH_ONLY`, `isPartialResult=true` e
  `isGlobalTop8Final=false`.
- Aunque un lote complete un run sintetico o futuro, el resultado del endpoint
  de batch no debe confundirse con el TOP 8 global.
- La finalizacion global solo puede representarse con
  `resultScope=GLOBAL_TOP8_FINAL` desde `/api/top8-final` cuando el run esta
  completo.
- Fase 9 no autoriza full-run, automatizacion de batches, persistencia real ni
  ejecucion real en Vercel sin autorizacion textual explicita del usuario.

Regla Fase 10 de TNX y Master Indicators:

- Master Indicators son informativos y no deben alimentar directamente score,
  ranking, EXEC ni TOP 8.
- Las respuestas de quote/Master Indicators deben exponer
  `isInformationalOnly=true`, `affectsScore=false`,
  `affectsRanking=false` y `affectsExec=false`.
- TNX mantiene simbolo publico `TNX` y mapeos controlados
  `US10Y.GBOND` para EODHD y `^TNX` para Finnhub.
- Si los proveedores no devuelven precio valido, TNX debe quedar estable como
  `dataQuality=NOT_AVAILABLE` y `diagnosticStatus=TNX_PROVIDER_UNRESOLVED`.
- La falta de dato TNX no bloquea fases operativas, TOP 8, score, ranking ni
  decisiones EXEC.
- Fase 10 no autoriza nuevos proveedores, scraping, listas masivas, full-run,
  automatizacion, persistencia real ni ejecucion con `execute=true`.

Regla Fase 11 de lote real unico autorizado:

- Fase 11 puede autorizar exactamente un intento real de `batch=1` solo con
  autorizacion textual explicita del usuario.
- La ejecucion debe exigir `runId` y `confirm=EXECUTE_BATCH`.
- Si el `runId` no esta disponible en Vercel, el sistema debe bloquear con
  `RUN_NOT_FOUND` antes de consumir universo operativo, historico o spread.
- Un bloqueo `RUN_NOT_FOUND` con `providerCallsPlanned=0` no debe reintentarse
  automaticamente ni convertirse en batch 2, full-run o TOP 8 global.
- El resultado de un batch, ejecutado o bloqueado, sigue siendo
  `PARTIAL_BATCH_ONLY` y nunca `GLOBAL_TOP8_FINAL`.
- La memoria efimera Vercel no debe asumirse compartida entre endpoints; antes
  de nuevas ejecuciones reales se debe aprobar un handoff compatible con Vercel
  y con el control de coste.
- Fase 11 no autoriza full-run, automatizacion, persistencia real, base de datos
  ni avance a Fase 12.

Regla Fase 11.1 de handoff Vercel sin base de datos:

- El handoff por memoria efimera entre endpoints Vercel no debe considerarse
  fiable para ejecuciones reales de lotes.
- Fase 11.1 autoriza un endpoint unico manual para lote 1 que resuelva universo,
  seleccione batch y devuelva resultado parcial dentro de la misma invocacion.
- El endpoint single-invocation no debe usar `top8RunStore`, no debe requerir
  `runId`, no debe crear persistencia y no debe finalizar TOP 8 global.
- Dry-run debe ser seguro y no ejecutar historico/spread.
- Cualquier ejecucion real futura debe exigir `confirm=EXECUTE_BATCH` y
  autorizacion textual posterior.
- La respuesta debe exponer `singleInvocation=true`,
  `globalAggregationAvailable=false`, `finalizationAvailable=false` y
  `requiresPersistenceForGlobalFinal=true`.
- Fase 11.1 no autoriza full-run, batch 2, reintentos automaticos,
  automatizacion, persistencia real, base de datos ni avance a Fase 12.

Regla Fase 11.2 de validacion real single-invocation:

- Fase 11.2 autoriza una unica ejecucion real manual de
  `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH`.
- La ejecucion debe realizarse una sola vez, solo para batch 1, sin reintentos
  automaticos y sin usar `/api/top8-batch` con `runId`.
- El resultado de Fase 11.2 siempre debe tratarse como parcial:
  `PARTIAL_BATCH_ONLY`, `isPartialResult=true`, `isGlobalTop8Final=false`.
- Un lote real bloqueado por elegibilidad no equivale a fallo de guardarrail ni
  a TOP 8 global; debe documentarse y no repetirse sin nueva fase aprobada.
- Fase 11.2 no autoriza full-run, batch 2, persistencia real, automatizacion,
  base de datos ni avance a Fase 12.

Regla Fase 11.3 de diagnostico de elegibilidad sin nueva ejecucion real:

- Fase 11.3 no autoriza `execute=true`, batch 2, full-run ni nuevas llamadas
  reales de historico/spread.
- Si un lote real previo devuelve `NO_ELIGIBLE_ASSETS_AFTER_VALIDATION`, el
  sistema debe distinguir entre fallo de infraestructura y bloqueo tecnico de
  elegibilidad.
- Las respuestas futuras del pipeline deben exponer diagnostico agregado de
  elegibilidad cuando exista en memoria de la misma invocacion:
  `eligibilityDiagnostics`, conteos por razon y muestra controlada de activos
  bloqueados.
- El dry-run no debe inventar razones por activo: debe declarar que las razones
  exactas requieren ejecucion manual autorizada.
- No se deben relajar validaciones, inventar datos, mezclar mocks con datos
  reales, ampliar universo ni convertir un resultado parcial en TOP 8 global.
- Fase 11.3 no autoriza persistencia real, base de datos, automatizacion ni
  avance a Fase 12.

Regla Fase 11.4 de ejecucion diagnostica real unica:

- Fase 11.4 puede autorizar exactamente una ejecucion real diagnostica de
  `/api/top8-batch-single?batch=1&execute=true&confirm=EXECUTE_BATCH`.
- La finalidad unica es obtener `eligibilityDiagnostics` reales; no autoriza TOP
  8 global, `EXEC`, batch 2, reintentos automaticos ni full-run.
- El resultado sigue siendo `PARTIAL_BATCH_ONLY` aunque devuelva activos.
- Si `SPREAD_NOT_VERIFIED` bloquea candidatos, no debe relajarse sin una fase
  posterior explicitamente autorizada.
- Cualquier alternativa para spread debe mantener allowlists, coste controlado,
  trazabilidad y prohibicion de automatismos.
- Fase 11.4 no autoriza persistencia real, base de datos, automatizacion ni
  avance a Fase 12.

Regla Fase 11.5 de politica controlada de spread Europa/Euronext:

- `SPREAD_NOT_VERIFIED` y `SPREAD_NOT_AVAILABLE` no deben relajarse para generar
  `EXEC`.
- Un activo sin spread verificable puede quedar solo como diagnostico no
  operativo: `BLOCKED`, `STANDBY` o `WATCH_DIAGNOSTIC_ONLY`.
- Un activo sin spread verificable no puede entrar en TOP 8 global operativo.
- No se debe inventar spread, usar mocks como dato real ni calcular proxy
  operativo sin fase posterior explicitamente autorizada.
- Cualquier alternativa futura de spread debe mantener allowlists, coste
  controlado, trazabilidad, bid/ask verificable y prohibicion de automatismos.
- Fase 11.5 no autoriza ejecucion real, batch 2, full-run, persistencia real,
  base de datos, automatizacion ni avance a Fase 12.

Regla Fase 6 de score vs ejecucion:

- `marketStatus` no `OPEN` bloquea ejecucion y cualquier `EXEC`.
- `marketStatus` no `OPEN` no debe impedir score diagnostico/ranking tecnico
  manual si historico, liquidez, spread, calidad y operabilidad son validos.
- `UNKNOWN` y `NOT_OPERABLE` siguen bloqueando tanto score operativo como
  ejecucion.

---

## 14. OPERABILITY_ENGINE_SPEC

`Operability Engine` responde una pregunta distinta a `Universe Engine`:

```text
Puedo comprar realmente este activo desde IBKR con una SL espanola?
```

Es un filtro operativo posterior a `Universe Engine` y anterior al TOP 8
operativo real. `Universe Engine` decide que activos analiza EMRR; `Operability
Engine` decide si esos activos son realmente operables para el perfil del
usuario.

Separacion obligatoria:

- no forma parte de `Universe Engine`,
- no forma parte de `Score Engine`,
- no forma parte de `Conviction`,
- no forma parte de `Risk`,
- no forma parte de `Ranking`,
- no forma parte de `Trailing`,
- no forma parte de `Leading Sectors`,
- no decide atractivo financiero,
- no calcula indicadores tecnicos,
- no sustituye la confirmacion final de IBKR.

Perfil base:

- empresa SL espanola,
- cuenta IBKR,
- base EUR,
- restricciones PRIIPs aplicables,
- preferencia por instrumentos operables sin restricciones regulatorias.

### 14.1 Estados de operabilidad

Estados permitidos:

```ts
type OperabilityStatus = "OPERABLE" | "NOT_OPERABLE" | "UNKNOWN";
```

`OPERABLE` significa que el activo parece comprable para el perfil operativo
definido y puede continuar hacia score, ranking y validaciones posteriores.

`NOT_OPERABLE` significa que el activo esta bloqueado, restringido o es
incompatible con el perfil operativo.

`UNKNOWN` significa que falta informacion suficiente o no existe confirmacion
fiable.

Regla conservadora:

Si hay duda, clasificar como `UNKNOWN`.

### 14.2 OPERABLE

Clasificar inicialmente como `OPERABLE` solo si existe informacion suficiente y
no hay bloqueo conocido:

- acciones ordinarias elegibles,
- acciones USA permitidas por IBKR para el perfil,
- acciones europeas liquidas y normalizadas,
- ETFs UCITS validos si se autoriza su uso futuro,
- instrumento con mercado, divisa, tipo de activo y ticker canonico claros,
- instrumento sin restriccion conocida de IBKR,
- instrumento sin bloqueo PRIIPs conocido.

Nota:

El universo TOP 8 inicial sigue centrado en acciones ordinarias. Los ETFs UCITS
son una clase operable permitida para modulos futuros autorizados, pero no
entran automaticamente en TOP 8 salvo aprobacion especifica.

### 14.3 NOT_OPERABLE

Clasificar como `NOT_OPERABLE` cuando exista evidencia de bloqueo o
incompatibilidad:

- instrumento bloqueado por IBKR para el perfil de cuenta,
- producto PRIIP sin KID/KIID requerido para cliente EEA/Espana,
- ETF/ETP no UCITS no disponible para clientes EEA bajo restricciones PRIIPs,
- instrumentos incompatibles con el alcance actual,
- warrants,
- rights,
- ETNs,
- preferred shares si no estan autorizadas,
- fondos no autorizados,
- bonos,
- opciones,
- futuros,
- CFDs,
- cripto,
- forex,
- OTC,
- Pink Sheets,
- activos suspendidos,
- activos delisted,
- activos con permisos de trading insuficientes,
- activos expresamente restringidos por normativa, proveedor o broker.

### 14.4 UNKNOWN

Clasificar como `UNKNOWN` cuando falte confirmacion:

- no se conoce el tipo exacto de instrumento,
- no se puede confirmar si es accion ordinaria, ETF UCITS u otro producto,
- no se puede confirmar elegibilidad PRIIPs/KID,
- no se puede confirmar permiso IBKR,
- no se puede confirmar exchange, divisa o ticker canonico,
- hay conflicto entre proveedores,
- ADR, ETF, ETP o producto estructurado ambiguo,
- datos regulatorios incompletos,
- datos de proveedor insuficientes.

### 14.5 Puertas duras

Reglas obligatorias:

- `UNKNOWN` nunca puede generar `EXEC`,
- `NOT_OPERABLE` nunca puede entrar en TOP 8 operativo,
- `NOT_OPERABLE` nunca puede generar `EXEC`,
- solo `OPERABLE` puede continuar hacia TOP 8 operativo real,
- `OPERABLE` no garantiza `EXEC`; solo permite seguir evaluando,
- si IBKR rechaza el instrumento en una fase futura, degradar a
  `NOT_OPERABLE` o `UNKNOWN`,
- score alto, Conviction alta o momentum fuerte nunca compensan falta de
  operabilidad.

### 14.6 Relacion con TOP 8

El TOP 8 operativo real debe contener solo activos `OPERABLE`.

Activos con buen score pero `NOT_OPERABLE`:

- no entran en TOP 8 operativo,
- no generan `EXEC`,
- pueden registrarse en diagnostico futuro si se autoriza.

Activos `UNKNOWN`:

- no entran en TOP 8 operativo,
- no generan `EXEC`,
- pueden aparecer solo como incidencia tecnica o pendiente de clasificacion.

### 14.7 Fuentes futuras y limitaciones

EODHD y Finnhub podran aportar metadatos, pero no sustituyen la confirmacion de
permisos reales de IBKR.

En fases futuras autorizadas, la operabilidad podra apoyarse en:

- metadatos de instrumento,
- exchange,
- divisa,
- tipo de activo,
- flags UCITS/ETF si existen,
- disponibilidad de KID/KIID,
- permisos o rechazos de IBKR si se autoriza integracion,
- historico de bloqueos manuales.

En Fase actual:

- no se llama a IBKR,
- no se llama a EODHD,
- no se llama a Finnhub,
- no se implementa broker check real,
- no se implementa scanner real.

### 14.8 Auditoria obligatoria de operabilidad

Antes de activar scanner real, auditar:

1. Riesgo PRIIPs.
   Productos PRIIPs sin KID/KIID valido para EEA/Espana pueden estar bloqueados.
   Ante duda, usar `UNKNOWN` o `NOT_OPERABLE`.

2. Riesgo IBKR.
   IBKR puede rechazar un instrumento por permisos, perfil de cuenta, mercado,
   pais, tipo de producto o clasificacion regulatoria aunque el dato financiero
   sea correcto.

3. Riesgo de clasificacion erronea.
   Un ticker puede representar accion ordinaria, ADR, ETF, ETN, preferred share
   u otro producto. La clasificacion debe ser conservadora.

4. Riesgo de activos bloqueados.
   Suspensiones, restricciones regulatorias, falta de permisos, sanciones,
   delistings o falta de KID pueden bloquear activos aparentemente buenos.

5. Riesgo de falsos positivos.
   Un activo marcado como `OPERABLE` podria ser rechazado despues. El sistema
   debe degradarlo y no generar `EXEC` sin confirmacion suficiente.

Decision actual:

`Operability Engine` queda definido como especificacion critica, separada del
universo y de los motores de decision. No se implementa todavia como integracion
real ni llama APIs reales.

---

## 15. Indicadores tecnicos futuros

Timeframe base:

- diario.

Indicadores:

- EMA20,
- EMA50,
- slope,
- RS,
- RVOL,
- ATR,
- ATR%,
- momentum,
- liquidez,
- spread,
- score 0-100,
- conviccion 0-100.

Queda excluido hasta autorizacion:

- intradia 1H,
- intradia 4H,
- scalping,
- tick-by-tick,
- premarket,
- afterhours.

---

## 16. SCORE_ENGINE_SPEC

`Score Engine` responde una unica pregunta:

```text
De todos los activos validos y operables, cuales tienen la mejor tendencia
alcista sana y sostenible?
```

Es un motor posterior a:

1. `Universe Engine`,
2. `Operability Engine`,
3. normalizacion de ticker,
4. validacion de datos,
5. validacion de market hours.

Separacion obligatoria:

- no modifica `Universe Engine`,
- no modifica `Operability Engine`,
- no decide si un activo existe en el universo,
- no decide si un activo es comprable en IBKR,
- no sustituye `Risk`,
- no sustituye `Conviction`,
- no modifica `Leading Sectors`,
- no llama APIs reales por si solo.

Regla:

Un activo solo puede recibir score real si ya es valido, normalizado y
`OPERABLE`.

### 16.1 Formula Score

Ponderacion original recuperada:

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

Formula:

```text
score =
  ema_trend_score      +
  relative_strength    +
  momentum_score       +
  continuity_score     +
  rvol_score           +
  liquidity_spread     +
  atr_health
```

Rango:

```text
0 <= score <= 100
```

No se inventa nueva ponderacion en esta fase.

### 16.2 EMA20 / EMA50 - 20 puntos

Objetivo:

Medir estructura primaria de tendencia alcista.

Subcriterios orientativos:

- precio por encima de EMA20,
- EMA20 por encima de EMA50,
- pendiente de EMA20 positiva,
- distancia saludable entre EMA20 y EMA50,
- ausencia de cruce bajista reciente,
- pullback respetando EMA20 o zona de tendencia.

Penalizar:

- precio bajo EMA20,
- EMA20 plana o descendente,
- EMA20 bajo EMA50,
- tendencia rota,
- extension extrema respecto a EMA20.

### 16.3 RS - 20 puntos

Objetivo:

Medir fortaleza relativa del activo frente al mercado de referencia.

Subcriterios orientativos:

- RS positiva frente a benchmark principal,
- RS mejorando en las ultimas semanas,
- RS superior a la media del universo,
- comportamiento mejor que SPY o benchmark equivalente,
- preferencia por activos que suben mas que el mercado y caen menos en
  retrocesos.

Penalizar:

- RS negativa,
- RS deteriorandose,
- activo subiendo solo por rebote debil,
- fortaleza relativa inconsistente.

### 16.4 Momentum - 15 puntos

Objetivo:

Medir impulso actual sin premiar movimientos excesivamente verticales.

Subcriterios orientativos:

- momentum positivo en corto y medio plazo,
- aceleracion progresiva,
- avance ordenado,
- precio cerca de maximos relevantes sin extension extrema,
- continuidad del movimiento sin gaps peligrosos.

Penalizar:

- momentum negativo,
- momentum agotado,
- vela o gap vertical no sostenible,
- subida excesiva sin descanso,
- divergencia entre precio y volumen.

### 16.5 Continuidad - 15 puntos

Objetivo:

Medir si la tendencia es limpia, repetible y operable.

Este bloque no duplica EMA20/EMA50: EMA mide estructura; Continuidad mide
calidad del comportamiento.

Subcriterios orientativos:

- secuencia de maximos y minimos crecientes,
- pullbacks controlados,
- recuperaciones ordenadas tras descanso,
- tendencia madura pero no agotada,
- ausencia de rupturas falsas repetidas,
- estabilidad del avance.

Penalizar:

- movimientos erraticos,
- gaps repetidos sin continuidad,
- retrocesos bruscos,
- rango lateral prolongado,
- tendencia demasiado joven o demasiado extendida.

### 16.6 RVOL - 10 puntos

Objetivo:

Confirmar interes real sin premiar volumen especulativo extremo.

Subcriterios orientativos:

- RVOL moderadamente superior a su media,
- volumen acompanando rupturas o continuaciones,
- volumen decreciente en descansos,
- ausencia de volumen anomalo por evento no recurrente.

Penalizar:

- RVOL muy bajo,
- volumen insuficiente,
- pico extremo tipo blow-off,
- volumen alto asociado a caida o distribucion.

### 16.7 Liquidez / Spread - 10 puntos

Objetivo:

Medir operabilidad real de entrada/salida.

Subcriterios orientativos:

- valor medio negociado suficiente,
- volumen medio suficiente,
- spread normal y estable,
- profundidad razonable,
- slippage estimado bajo.

Penalizar:

- spread elevado,
- liquidez justa,
- volumen irregular,
- gaps por falta de contrapartida,
- activo tecnicamente fuerte pero dificil de ejecutar.

Regla:

Liquidez mala o spread extremo son bloqueos duros. No se compensan con score.

### 16.8 ATR saludable - 10 puntos

Objetivo:

Medir volatilidad operable y compatible con trailing dinamico.

Subcriterios orientativos:

- ATR% suficiente para que el activo se mueva,
- ATR% no excesivo para evitar riesgo descontrolado,
- volatilidad compatible con tendencia,
- ATR estable o normalizado,
- rango diario razonable para entrada y trailing.

Penalizar:

- ATR% demasiado bajo,
- ATR% excesivo,
- volatilidad explosiva,
- rango erratico,
- activo con riesgo de salto no controlable.

### 16.9 Penalizaciones

Penalizaciones aplicables despues del calculo base:

- extension excesiva frente a EMA20,
- gap reciente no consolidado,
- subida vertical sin descanso,
- RVOL extremo asociado a climax,
- deterioro reciente de RS,
- deterioro reciente de momentum,
- ATR% demasiado alto,
- spread cercano al limite,
- liquidez decreciente,
- dato `WARNING`.

Las penalizaciones reducen score, pero no sustituyen bloqueos duros.

### 16.10 Bloqueos duros

Score alto nunca puede compensar:

- mercado cerrado,
- dia festivo,
- dato stale,
- dato invalid,
- precio invalido,
- spread extremo,
- mala liquidez,
- ticker no normalizado,
- activo fuera de `Universe Engine`,
- activo `NOT_OPERABLE`,
- activo `UNKNOWN`,
- historico insuficiente,
- exchange no soportado,
- restricciones operativas o regulatorias.

Si un bloqueo duro aparece:

- no se calcula ranking operativo,
- no se genera `EXEC`,
- el activo puede quedar como `BLOCKED`, `STANDBY` o diagnostico futuro.

### 16.11 Conviction

`Conviction` es una lectura complementaria de confianza operativa.

No es una copia del score.

Rango:

```text
0 <= conviction <= 100
```

Conviction debe combinar:

- score,
- estabilidad de tendencia,
- calidad de RS,
- continuidad,
- calidad de liquidez,
- riesgo,
- calidad del dato,
- estado de mercado,
- coherencia entre indicadores.

Reglas:

- score alto con riesgo alto puede tener Conviction moderada,
- score alto con dato dudoso no puede tener Conviction alta,
- Conviction alta no desbloquea activos bloqueados,
- Conviction no puede generar `EXEC` si hay bloqueo duro.

### 16.12 Risk

`Risk` clasifica la dificultad operativa del activo.

Estados iniciales:

```text
LOW
MEDIUM
HIGH
BLOCKED
```

Factores:

- ATR%,
- extension frente a EMA20,
- spread,
- liquidez,
- volatilidad reciente,
- gaps,
- calidad de dato,
- distancia a zonas tecnicas,
- madurez de tendencia.

Reglas:

- `LOW` no significa sin riesgo,
- `HIGH` puede permitir `WATCH`, pero no debe generar `EXEC` sin validacion
  posterior muy estricta,
- `BLOCKED` nunca genera `EXEC`.

### 16.13 Ranking

El ranking operativo se calcula solo sobre activos:

- dentro de `Universe Engine`,
- normalizados,
- con datos validos,
- con mercado compatible,
- `OPERABLE`,
- sin bloqueos duros.

Orden base:

1. score descendente,
2. Conviction descendente,
3. Risk mas bajo,
4. mejor liquidez/spread,
5. mejor calidad de dato,
6. menor extension si hay empate.

Regla:

Mostrar solo TOP 8 operativo. No mostrar screener completo.

### 16.14 Relacion con EXEC

`EXEC` no depende solo de score.

Para permitir `EXEC` deben cumplirse simultaneamente:

- mercado `OPEN`,
- activo dentro de `Universe Engine`,
- activo `OPERABLE`,
- dato `CLEAN` o `GOOD`,
- ticker normalizado,
- precio valido,
- liquidez correcta,
- spread aceptable,
- score suficiente,
- Conviction suficiente,
- Risk compatible,
- trailing calculable en fase futura autorizada.

Si cualquiera de estas condiciones falla:

- no generar `EXEC`,
- usar `WATCH`, `HOLD`, `STANDBY`, `EXTENDED`, `BLOCKED` o
  `CLOSED_CONTEXT` segun corresponda.

### 16.15 Leading Sectors

`Leading Sectors` no afecta:

- Score,
- Conviction,
- Risk,
- Ranking,
- `EXEC`.

Es un modulo informativo independiente de contexto sectorial.

### 16.16 Auditoria obligatoria de ponderaciones

Optimizacion actual:

La ponderacion se mantiene en 100 puntos con la distribucion original:

- tendencia estructural EMA20/EMA50: 20%,
- fortaleza relativa RS: 20%,
- momentum: 15%,
- continuidad: 15%,
- RVOL: 10%,
- liquidez/spread: 10%,
- ATR saludable: 10%.

Riesgos detectados:

1. Doble ponderacion entre tendencia y momentum.
   EMA20/EMA50 mide estructura; Momentum mide impulso. Mitigacion: no permitir
   que ambos premien la misma subida vertical.

2. Doble ponderacion entre EMA20/EMA50 y continuidad.
   EMA mide posicion y pendiente; Continuidad mide calidad del avance.
   Mitigacion: separar subcriterios y penalizar extension.

3. Riesgo de sobreponderacion.
   Tendencia, RS, Momentum y Continuidad suman 70 puntos. Mitigacion: mantener
   bloqueos duros y penalizaciones por extension, dato, liquidez y ATR.

4. Riesgo de sesgo hacia activos demasiado extendidos.
   Activos fuertes pueden parecer mejores justo antes de descansar. Mitigacion:
   penalizar distancia excesiva a EMA20, gaps y blow-off.

5. Riesgo de infravalorar liquidez.
   Liquidez/spread pesa 10 puntos, pero la liquidez mala bloquea antes del
   score. Mitigacion: mantener liquidez como hard gate.

6. Riesgo de infravalorar ATR%.
   ATR saludable pesa 10 puntos, pero volatilidad extrema puede destruir
   operabilidad. Mitigacion: ATR% excesivo puede penalizar o bloquear segun
   umbral futuro.

Mejoras propuestas:

- mantener ponderacion original para primera version real,
- validar distribucion con datos reales antes de ajustar pesos,
- medir tasa de falsos positivos por extension,
- auditar si liquidez/spread necesita mas peso tras pruebas reales,
- auditar si ATR% debe convertirse parcialmente en bloqueo dinamico,
- conservar trazabilidad por subscore para explicar por que entra cada activo.

Decision actual:

Mantener ponderacion original. No ajustar pesos hasta disponer de backtest,
datos reales controlados y auditoria posterior.

---

## 17. TOP 8

Solo se muestran 8 activos.

No mostrar:

- screener completo,
- ranking secundario,
- universo completo,
- listas masivas.

Cada card debe mostrar:

- ticker,
- nombre,
- mercado,
- estado,
- precio,
- variacion porcentual respecto al cierre anterior o ultimo cierre valido,
- score,
- conviccion,
- RS,
- estado tendencia,
- riesgo,
- trailing_adjusted,
- trailing_medium,
- trailing_wide,
- accion operativa,
- timestamp.

Regla visual de variacion de precio:

- mostrar el porcentaje junto al precio,
- positivo en verde,
- negativo en rojo,
- visualizar divisas detras del precio; ejemplo `876.10 €` en vez de `EUR 876.10`,
- fuente futura prioritaria: EODHD,
- fallback futuro: Finnhub si EODHD no entrega dato valido,
- el dato debe llevar timestamp y control de calidad por posible pequeno delay.

Si mercados cerrados:

- mostrar ultimo TOP 8 cacheado,
- marcar `LAST` / `CLOSED`,
- nunca mostrar nuevo `EXEC`.

---

## 18. Trailing stop

Prohibido imponer limite fijo del 1,5%.

No debe existir ningun cap hardcodeado.

Base inicial futura:

```text
trailing_adjusted = ATR% x 0.65
trailing_medium   = ATR% x 1.00
trailing_wide     = ATR% x 1.45
```

Mapeo visual:

- Tight = trailing_adjusted = ATR% x 0.65
- Medium = trailing_medium = ATR% x 1.00
- Wide = trailing_wide = ATR% x 1.45

El trailing podra optimizarse posteriormente mediante:

- volatilidad,
- liquidez,
- momentum,
- slope,
- RS,
- extension,
- madurez de tendencia.

Trailing persistente futuro:

- puede subir,
- no baja automaticamente,
- mantiene ultimo valor si mercado cerrado,
- no se recalcula operativo fuera de mercado abierto.

---

## 19. Persistencia y cache

Fase 1:

- sin base real,
- sin SQLite real,
- sin snapshots reales,
- sin historico real.

Futuro Vercel:

- evitar SQLite local como requisito de produccion,
- evaluar persistencia externa autorizada,
- opciones posibles: Supabase/Postgres, Neon, Turso, Vercel Postgres, Vercel KV
  u otra aprobada.

Cache futura:

- metadata: 30 dias,
- universo: 7 dias,
- market hours: 24 h,
- ultimo scan: hasta nuevo scan,
- precios: solo dentro del scan,
- master indicators: solo dentro del scan.

Si APIs fallan:

- usar ultimo estado valido,
- marcar `DEGRADED`, `LAST` o `CACHE`,
- no romper dashboard,
- no mostrar pantalla vacia.

---

## 20. Error handling

Estados minimos:

- `RATE_LIMIT`,
- `TIMEOUT`,
- `NO_DATA`,
- `BAD_DATA`,
- `AUTH_ERROR`,
- `NETWORK_ERROR`,
- `MARKET_CLOSED`,
- `SYMBOL_NOT_FOUND`,
- `CACHE_MISS`,
- `INVALID_RESPONSE`,
- `PARTIAL_DATA`,
- `UNKNOWN_ERROR`.

Reglas:

- `RATE_LIMIT`: detener llamadas adicionales,
- `TIMEOUT`: retry controlado,
- `NO_DATA`: fallback proveedor/cache,
- `BAD_DATA`: marcar `INVALID`,
- `AUTH_ERROR`: bloquear proveedor,
- `PARTIAL_DATA`: permitir dashboard degradado,
- `UNKNOWN_ERROR`: activar protocolo de bloqueo runtime.

`INVALID` o `BAD_DATA` nunca pueden generar `EXEC`.

---

## 21. Protocolo STOP_RUNTIME

Usar si:

- loops detectados,
- retries excesivos,
- APIs corruptas,
- errores criticos runtime,
- inconsistencias graves de datos,
- bloqueo de seguridad.

Acciones:

- detener proceso afectado,
- no continuar llamadas,
- mantener dashboard estable,
- usar ultimo cache valido si existe,
- mostrar warning/error controlado.

---

## 22. Protocolo de bloqueo tecnico Codex/Vercel

Usar cuando:

- dependencias fallan,
- build queda inconsistente,
- despliegue Vercel falla por causa no resoluble localmente,
- estructura del proyecto queda ambigua,
- una decision requiere autorizacion del usuario,
- una herramienta externa o servicio cloud seria necesario.

Acciones:

- detener la fase,
- documentar bloqueo,
- no improvisar servicios externos,
- no instalar dependencias no autorizadas,
- pedir aprobacion o decision explicita.

---

## 23. Diseno dashboard

Estilo:

- oscuro,
- institucional,
- limpio,
- moderno,
- mobile-first,
- rapido,
- sin tablas gigantes.

Regla responsive obligatoria:

- el dashboard debe funcionar como pantalla web principal en smartphone, tablet y escritorio,
- prioridad especial de QA visual: iPhone 16 Pro Max,
- compatibilidad general obligatoria: smartphones Android de mercado,
- la interfaz debe adaptarse sin solapes, cortes de texto ni scroll horizontal roto,
- no se implementa app nativa Apple/Android hasta fase futura autorizada,
- la arquitectura debe permitir evolucionar a PWA o wrapper nativo si se autoriza mas adelante.

Regla visual de color:

- el dorado/oro viejo se usa como capa premium de marca, bordes, enfasis y CTA,
- no debe sustituir los colores semanticos definidos por el modelo,
- `GREEN_HARD` y `GREEN_SOFT` deben seguir indicando parametros positivos,
- `YELLOW`, `WHITE_GREY`, `ORANGE` y `RED` deben respetar los intervalos y
  significados definidos en el MASTER oficial original.

Regla visual de mercados:

- el header debe poder mostrar Europa y EEUU por separado,
- estados esperados: Europa abierta / EEUU cerrado, EEUU abierto / Europa
  cerrada, ambos abiertos, ambos cerrados,
- el calculo real se hara por zona horaria del exchange en fases futuras,
- la zona horaria local del usuario solo afecta a visualizacion de hora/fecha,
  no sustituye la hora oficial de mercado.

Orden visual obligatorio:

1. Header tecnico
2. System Status
3. Botones principales
4. Estado scan
5. Fear & Greed
6. Master Indicators
7. Sectores lideres
8. TOP 8

Sticky mini header:

- hora local del sistema/dispositivo/navegador,
- health status,
- market mode,
- boton `SCAN FULL` reducido.

---

## 24. Mock Data Contract para Fase 1

`systemStatus`:

- health_status,
- market_mode,
- markets_open,
- api_status,
- cache_status,
- last_scan_timestamp_local,
- last_scan_timestamp_utc,
- scan_in_progress.
- technical:
  - EODHD status mock,
  - Finnhub status mock,
  - cache entries,
  - uptime mock,
  - API calls mock,
  - blocked calls mock,
  - total tickers EEUU,
  - total tickers Europa,
  - universo total analizado,
  - etiqueta de muestra significativa.

`fearGreed`:

- value,
- label,
- color_token,
- timestamp_local,
- source,
- status.

`masterIndicators`:

- symbol,
- name,
- value,
- change,
- color_token,
- status,
- source,
- timestamp_local.

`sectors`:

- sector,
- performance acumulada de las ultimas 5 sesiones del ETF o proxy sectorial representativo,
- status,
- color_token,
- timestamp_local.

Regla funcional y visual sectorial:

- `Leading Sectors` es un modulo informativo independiente,
- no forma parte de TOP 8, ranking, scoring, Conviction, Riesgo, Momentum de activos, Trailing Stops ni motores de seleccion,
- su objetivo es mostrar contexto, rotacion y fortaleza relativa sectorial,
- la clasificacion futura debe combinar Momentum 5 sesiones, Momentum 20 sesiones, posicion respecto a EMA20, slope de EMA20 y Relative Strength frente a SPY,
- no usar variacion diaria, intradia ni cambio de una sola sesion como dato principal,
- mostrar sector y rendimiento 5 sesiones en la misma linea,
- el porcentaje debe ser complementario, aproximadamente al 50% del tamano visual del nombre del sector,
- ordenar siempre por estado: `LEADING`, `ACCELERATING`, `WEAKENING`, `FALLING`,
- dentro del mismo estado, ordenar por performance descendente,
- porcentaje sectorial positivo en verde y negativo en rojo,
- `LEADING` debe usar verde fuerte,
- `ACCELERATING` debe usar verde suave,
- `WEAKENING` debe usar aviso intermedio naranja/rojo suave,
- `FALLING` debe usar rojo fuerte,
- usar termometro visual de fortaleza derivado del estado sectorial,
- el indicador de estado debe ser una capsula visual moderna, legible y sin solapes.

`top8`:

- rank,
- ticker,
- name,
- market,
- market_status,
- price,
- score,
- conviction,
- ema20,
- ema50,
- slope,
- rs,
- rvol,
- atr,
- atr_percent,
- momentum,
- trend_status,
- risk,
- trailing_adjusted,
- trailing_medium,
- trailing_wide,
- action,
- timestamp_local.

---

## 25. Auditoria obligatoria al cierre de cada fase

Cada cierre debe confirmar:

- alcance implementado,
- archivos creados/modificados,
- que NO se implemento,
- compatibilidad Vercel,
- prueba local,
- prueba Vercel o instrucciones de prueba Vercel,
- riesgos,
- bloqueos,
- aprobacion necesaria para avanzar.

---

## 26. Resultado de esta Fase 0.1

Implementado en esta fase:

- auditoria tecnica del MASTER oficial,
- extraccion de reglas utiles,
- eliminacion operativa de dependencia Replit,
- definicion Codex + Vercel,
- documentacion de arquitectura recomendada,
- normalizacion de botones oficiales,
- separacion clara de fases,
- proteccion contra costes,
- proteccion contra secrets,
- advertencia sobre SQLite local y Vercel.

No implementado:

- codigo de aplicacion,
- Fase 1,
- APIs reales,
- scanner real,
- scoring real,
- trailing real,
- persistencia real,
- autenticacion real,
- exportaciones avanzadas reales.

Riesgos pendientes:

- validar visualmente Fase 1 antes de avanzar,
- decidir persistencia futura compatible con Vercel,
- decidir autenticacion futura,
- controlar costes de EODHD/Finnhub cuando se autoricen APIs,
- validar deploy Vercel real en Fase 2.1.

Siguiente paso:

Esperar aprobacion explicita para iniciar Fase 0.2 o Fase 1.

---

## Regla Fase 11.6 - Continuidad spread Europa/Euronext

Estado actual aprobado:

- Europa/Euronext queda en diagnostico no operativo mientras no exista bid/ask
  verificable.
- La politica oficial es
  `EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK`.
- `SPREAD_NOT_VERIFIED` y `SPREAD_NOT_AVAILABLE` siguen bloqueando `EXEC`.
- Un activo sin spread bid/ask verificable no puede entrar en TOP 8 global
  operativo.
- No se permite inventar spread, usar mocks como datos reales ni calcular un
  proxy operativo de spread.
- Cualquier comprobacion futura con las dos fuentes financieras ya configuradas
  debe ser puntual, manual, trazable y de bajo coste.
- Esas comprobaciones puntuales no autorizan cambios de configuracion, nuevos
  proveedores, persistencia, full-run, batch 2 ni `EXEC`.

No implementado en Fase 11.6:

- Fase 12.
- Ejecucion real con `execute=true`.
- Batch 2.
- Full-run.
- Scanner masivo.
- TOP 8 global operativo.
- Base de datos real.
- Automatismos.

---

## Regla Fase 11.7 - Verificacion diagnostica bid/ask

Estado actual aprobado:

- Fase 11.7 solo disena una prueba puntual manual de spread bid/ask verificable.
- El resultado maximo permitido es `SPREAD_VERIFICATION_DIAGNOSTIC_ONLY`.
- Incluso con bid/ask verificable, `EXEC` sigue prohibido.
- Incluso con bid/ask verificable, TOP 8 global operativo sigue prohibido.
- No se autoriza ejecucion real con `execute=true`, batch 2, full-run ni
  scanner masivo.

Un bid/ask solo puede considerarse verificable si existe:

- bid numerico valido,
- ask numerico valido,
- bid > 0,
- ask > bid,
- proveedor identificado,
- simbolo proveedor identificado,
- timestamp o contexto de dato claro,
- ausencia de mock,
- ausencia de proxy,
- ausencia de fallback silencioso.

Las dos fuentes financieras ya configuradas pueden ser objeto de una prueba real
solo si una fase posterior la autoriza explicitamente. Esa prueba debera ser
puntual, manual, trazable, de bajo coste, sin cambios de configuracion, sin
persistencia y sin autorizar `EXEC`.

No implementado en Fase 11.7:

- Fase 12.
- Endpoint publico nuevo.
- Consulta real a proveedores.
- `EXEC`.
- Full-run.
- Batch 2.
- Persistencia real.
- Automatismos.

---

## Regla final v1.0 beta - Integridad DataMode estricta

El dashboard visible no puede presentar datos `MOCK`, `MIXED` ni sustitutos de
datos de mercado.

DataMode visible permitido:

- `REAL`: dato obtenido de fuente financiera configurada y valido para el
  contexto mostrado.
- `LAST_CLOSE`: ultimo cierre real valido cuando el mercado esta cerrado; nunca
  puede mostrarse como `LIVE`.
- `ERROR`: fallo de lectura o proveedor.
- `DATA_UNAVAILABLE`: dato real no disponible.

Reglas obligatorias:

- Todo precio visible debe exponer proveedor, timestamp, calidad y `DataMode`.
- Un timestamp actualizado de interfaz no convierte un dato no disponible en
  real.
- Fear & Greed y Leading Sectors deben mostrarse como `DATA_UNAVAILABLE`
  mientras no exista fuente real aprobada.
- Master Indicators deben mostrar `REAL`, `LAST_CLOSE`, `ERROR` o
  `DATA_UNAVAILABLE`; TNX no debe inventarse.
- `EXEC` requiere `marketStatus=OPEN` y `dataMode=REAL`.
- `ERROR` y `DATA_UNAVAILABLE` no pueden generar score operacional, ranking
  operacional, TOP 8 operacional ni `EXEC`.

## Regla final v1.0 beta - TOP 8 visible dinamico

El TOP 8 visible debe derivar siempre del pipeline dinamico:

Universe Engine -> Operability Engine -> Eligibility Engine -> Score Engine ->
Ranking.

Orden obligatorio:

1. score descendente,
2. conviction descendente,
3. menor risk,
4. mejor dataQuality/liquidez.

Cualquier lista fija de tickers solo puede existir como archivo historico o
fixture de test excluido del build activo. Nunca puede ser fuente visible ni
operativa del TOP 8 real.

`/api/visible-top8-quotes` solo puede enriquecer precios de activos ya
seleccionados por el pipeline visible. No puede decidir el ranking, aceptar
listas externas arbitrarias, ejecutar universo completo ni convertirse en
screener masivo.

## Regla final v1.0 beta - Operational Data Policy

EMRR no puede tomar decisiones operativas desde datos no reales.

Mercado abierto:

- Solo `DataMode=REAL` puede ser candidato operacional.
- Fallo de proveedor, dato ausente o dato no verificable = `ERROR`.
- Cualquier estado distinto de `REAL` queda bloqueado para decision
  operacional.

Mercado cerrado:

- Solo puede mostrarse `LAST_CLOSE` si existe ultimo cierre real valido con
  proveedor y timestamp.
- `LAST_CLOSE` nunca puede mostrarse como `LIVE`.
- Si no existe cierre real valido, mostrar `DATA_UNAVAILABLE` o `ERROR`.

`EXEC` requiere simultaneamente:

- mercado `OPEN`,
- dato `REAL`,
- activo `OPERABLE`,
- `dataQuality=CLEAN` o `GOOD`,
- precio/timestamp/proveedor validos,
- score inputs reales,
- spread y liquidez validos,
- ningun bloqueo duro.

`ERROR`, `DATA_UNAVAILABLE`, `LAST_CLOSE` y `PARTIAL_BATCH_ONLY` no pueden
generar score operacional, ranking operacional, TOP 8 operacional ni `EXEC`.

Fear & Greed y Leading Sectors solo pueden mostrarse como dato de mercado si
existe fuente real aprobada. Si no existe, deben mostrarse como
`DATA_UNAVAILABLE`/informativos y no afectar Score, Ranking, Conviction, Risk,
TOP 8 ni `EXEC`.

## Regla final v1.0 beta - ScanSnapshot continuable y cobertura global

`SCAN FULL` debe crear un `scanSnapshot` real unico. El snapshot debe exponer:

- `scanId`,
- `scanStartedAtUtc`,
- `lastBatchCompletedAtUtc`,
- `scanCompletedAtUtc`,
- `universeHash`,
- `activeMarkets`,
- `batchesTotal`,
- `batchesCompleted`,
- `nextBatchIndex`,
- `coveragePercent`,
- `estimatedProviderCalls`,
- `actualProviderCalls`,
- `costPolicy`,
- `recommendedNextAction`.

El universo se procesa en este orden:

Universe Engine -> prefiltros de mercado abierto/region/exchange/tipo/divisa/
operabilidad -> Eligibility Engine -> Score Engine -> ranking -> TOP 8.

`Universe Discovered` en produccion debe representar el universo operativo
prefiltrado apto para analisis, no el universo bruto devuelto por el proveedor.
Antes de crear lotes, EMRR debe excluir instrumentos no autorizados como ETFs,
funds, bonds, preferred stock, warrants, rights, notes, OTC/PINK/GREY/BB,
activos delisted/inactive, tipos desconocidos y exchanges cerrados. En mercado
`US OPEN / Europe CLOSED`, el scan operativo solo puede incluir `NASDAQ` y
`NYSE`; Europa queda fuera del TOP 8 activo salvo contexto `LAST_CLOSE`
informativo.

El scan global puede completarse por lotes continuables, con `batchSize`
configurable entre 50 y 100 candidatos. Si una invocacion Vercel no completa el
universo elegible, el dashboard debe permitir continuar manualmente el mismo
`scanSnapshot` mediante token firmado, sin base de datos obligatoria y sin
ejecucion automatica oculta.

Reglas obligatorias:

- `coveragePercent=100%` es obligatorio para `GLOBAL_TOP8_FINAL`.
- `batchesCompleted` debe ser igual a `batchesTotal` para finalizar.
- Todos los lotes deben pertenecer al mismo `scanId` y `universeHash`.
- Un lote duplicado, token invalido o cambio de universo bloquea la
  finalizacion.
- Si `coveragePercent < 100%`, el resultado solo puede ser
  `PARTIAL_BATCH_ONLY`, `TOP_8_PARTIAL_DIAGNOSTIC` o `DATA_UNAVAILABLE`.
- Un resultado parcial nunca puede mostrarse como TOP 8 global.
- `/api/visible-top8-quotes` solo puede enriquecer activos ya seleccionados por
  el snapshot; no puede decidir ranking ni aceptar universe screening externo.
- Si no hay datos reales completos, no se rellena con listas fijas, datos
  mock, mixed, fallback, sinteticos ni precios anteriores.
- `EXEC` queda prohibido salvo `GLOBAL_TOP8_FINAL`, mercado `OPEN`,
  `DataMode=REAL`, spread/liquidez verificados y ausencia de hard blocks.

## Regla final de produccion - Sin mock ni TOP 8 fijo

Production EMRR must never render `MOCK`, `MIXED`, `FALLBACK`, `SYNTHETIC`,
demo fixtures or fixed TOP 8 as market output. Active TOP 8 must derive only
from a real `scanSnapshot` using current provider data. If a real completed scan
is unavailable, the dashboard must show `DATA_UNAVAILABLE`, never substitute
tickers.

Reglas de validacion obligatorias:

- El build de produccion debe fallar validacion si el bundle activo contiene
  mensajes de scan mock, fixtures de TOP 8, listas fijas operativas o imports de
  fuentes mock en la ruta de dashboard.
- `npm run build` debe ejecutar validadores de fuente, typecheck, build Vite y
  validacion posterior de `dist/assets`; si la validacion de bundle no puede
  inspeccionar assets generados, el build de produccion no puede considerarse OK.
- `SCAN FULL` solo puede iniciar el flujo real de `scanSnapshot`.
- `/api/visible-top8-quotes` es solo enriquecimiento de activos ya seleccionados
  por snapshot; no puede devolver tickers por defecto ni decidir ranking.
- Un deploy Vercel que siga sirviendo un bundle antiguo con TOP 8 fijo debe
  considerarse bloqueo de produccion hasta redeploy correcto.
