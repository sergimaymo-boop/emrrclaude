# SCORE_ENGINE_SPEC

Score Engine ordena activos validos y operables. No decide universo ni operabilidad.

## Precondiciones

Antes de score:

1. Universe Engine aprobado.
2. Operability Engine aprobado.
3. Ticker normalizado.
4. Datos OHLCV validos.
5. Technical Engine calculado con historico suficiente.
6. Eligibility Engine aprobado.
7. Market hours validado para ejecucion.

## Ponderacion

- EMA20 / EMA50: 20
- RS: 20
- Momentum: 15
- Continuidad: 15
- RVOL: 10
- Liquidez / Spread: 10
- ATR saludable: 10

Total: 100.

## Reglas Duras

- Score alto no compensa mercado cerrado para generar `EXEC`.
- Score alto no compensa dato stale/invalid.
- Score alto no compensa mala liquidez.
- Score alto no compensa spread extremo.
- Score alto no compensa `UNKNOWN` o `NOT_OPERABLE`.
- `EXEC` requiere activo `OPERABLE`, mercado `OPEN`, dato valido y ausencia de bloqueos duros.

## Estado Implementado Actual

- `api/_lib/scoreEngine.js` existe como engine puro y testeable.
- `api/_lib/historicalDataProvider.js` prepara OHLCV diario controlado para simbolos de exchanges aprobados.
- `api/_lib/spreadDataProvider.js` prepara spread bid/ask controlado para simbolos de exchanges aprobados.
- `api/_lib/technicalEngine.js` calcula indicadores puros desde OHLCV.
- `api/_lib/eligibilityEngine.js` bloquea candidatos antes de score si faltan historico, liquidez, spread o calidad.
- `api/_lib/candidateEvaluationEngine.js` orquesta evaluacion completa de candidato y ranking TOP 8 en modo puro.
- `api/_lib/top8Pipeline.js` conecta universo dinamico con cost gate, historico, spread y ranking.
- `api/_lib/top8BatchPlanner.js` devuelve plan de lotes si el universo operable supera el presupuesto por ejecucion.
- `/api/top8` bloquea con `COST_GATE_REQUIRES_BATCHING_STRATEGY` si el universo operable excede el presupuesto manual.
- `/api/top8-batch` permite dry-run o ejecucion manual de un lote dinamico, sin tickers ad hoc.
- `/api/top8-run` permite agregar en memoria efimera los mejores candidatos de
  lotes autorizados, sin base de datos ni lista fija.
- La agregacion usa fingerprint/firma de universo para evitar mezclar batches de
  universos dinamicos distintos, incluso si los conteos coinciden.
- Score Engine no llama APIs y no depende del frontend.
- Score Engine bloquea `UNKNOWN`, `NOT_OPERABLE`, dato no valido y liquidez insuficiente.
- Market status no `OPEN` queda separado como bloqueo de ejecucion: impide `EXEC`, pero permite score diagnostico/ranking manual si el resto de datos es valido.
- Calcula trailing dinamico ATR-based sin cap fijo:
  - `trailing_adjusted = ATR% x 0.65`
  - `trailing_medium = ATR% x 1.00`
  - `trailing_wide = ATR% x 1.45`
- `/api/top8` permanece bloqueado hasta completar Universe Engine automatico con filtros de historico, liquidez, spread y operabilidad.
- El TOP 8 global solo puede considerarse final cuando todos los lotes dinamicos
  autorizados de la sesion han sido procesados.
- La respuesta de run debe exponer `remainingBatchCount`, `nextBatchNumber` e
  `isGlobalTop8Final` para distinguir TOP 8 parcial de TOP 8 global.
- `/api/top8-final` debe bloquear runs parciales y no ejecutar llamadas externas.
- La ejecucion real de batches debe exigir `runId`; no se permiten resultados
  ejecutados sueltos fuera de una sesion agregable.
- Los batches duplicados o sesiones inexistentes deben bloquearse antes de
  consumir llamadas historicas/spread.
- El scoring no debe ejecutarse sobre una lista fija manual.
