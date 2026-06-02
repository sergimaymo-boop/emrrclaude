# UNIVERSE_ENGINE_SPEC

Universe Engine decide que activos puede analizar EMRR antes de cualquier score.

## Mercados Incluidos

USA:

- Nasdaq
- NYSE

Europa:

- Xetra
- Euronext
- Borsa Italiana
- SIX
- LSE

## Excluir

- OTC
- Penny Stocks
- Warrants
- Rights
- ETNs
- SPACs problematicos
- Activos sin historico suficiente
- Activos iliquidos

## Reglas

- No usar una lista fija de 8-20 tickers como universo definitivo.
- No limitar el universo solo a USA.
- El universo elegible debe determinarse automaticamente desde mercados incluidos.
- Universe Engine no calcula score, conviction, risk ni EXEC.
- Solo activos que pasan Universe Engine pueden pasar a Operability Engine.
- Si no existe Universe Engine automatico, `/api/top8` debe permanecer bloqueado.

## Estado Implementado Actual

- `/api/universe` ejecuta descubrimiento automatico metadata-only.
- `api/_lib/universeEngine.js` centraliza mercados, mapeo y deduplicacion.
- Usa listas de símbolos por mercados permitidos.
- No acepta tickers manuales por query.
- No usa lista fija de 8-20 tickers.
- Devuelve resumen y muestra limitada, no lista gigante de screener.
- No calcula TOP 8.
- No sustituye los filtros completos de historico, liquidez y spread.
- `api/_lib/technicalEngine.js` y `api/_lib/eligibilityEngine.js` ya existen
  como puertas puras posteriores al descubrimiento, pendientes de conexion a
  datos reales controlados.
- `api/_lib/historicalDataProvider.js` existe como proveedor interno para
  historico diario de simbolos aprobados, sin endpoint publico.
- `api/_lib/spreadDataProvider.js` existe como proveedor interno para spread
  bid/ask de simbolos aprobados, sin endpoint publico.
- `/api/top8` consume el universo dinamico internamente y aplica cost gate antes
  de historico/spread por candidato.
- Si el cost gate bloquea, `api/_lib/top8BatchPlanner.js` genera un plan de
  lotes sobre el universo dinamico sin exponer listas masivas.
- `/api/top8-batch` selecciona lotes desde el universo dinamico y no acepta
  tickers ni exchanges manuales.
- `/api/top8-run` crea y consulta una sesion efimera de agregacion manual para
  resultados de lotes dinamicos autorizados.
