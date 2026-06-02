# OPERABILITY_ENGINE_SPEC

Operability Engine decide si un activo puede operarse para el perfil EMRR:

- SL espanola
- IBKR
- Restricciones PRIIPs

## Estados

- `OPERABLE`
- `NOT_OPERABLE`
- `UNKNOWN`

## Reglas Duras

- `UNKNOWN` no puede generar `EXEC`.
- `NOT_OPERABLE` no puede entrar en TOP 8 operativo.
- `NOT_OPERABLE` no puede generar `EXEC`.
- Solo `OPERABLE` puede continuar hacia ranking operativo.
- Si existe duda regulatoria, de broker, tipo de instrumento o ticker, clasificar como `UNKNOWN`.

## Bloqueos

- Producto bloqueado por IBKR.
- Producto PRIIPs sin KID/KIID valido cuando aplique.
- ETF/ETP no UCITS restringido para EEA.
- Instrumento ambiguo o no autorizado.
- Activo sin exchange, divisa o tipo de instrumento confirmado.

## Estado Implementado Actual

- `/api/universe` aplica una clasificacion metadata-only conservadora.
- `api/_lib/operabilityEngine.js` centraliza reglas y estados.
- Acciones ordinarias con metadata suficiente pueden marcarse `OPERABLE` como candidatas por regla.
- Instrumentos excluidos se marcan `NOT_OPERABLE`.
- Metadata insuficiente o ambigua se marca `UNKNOWN`.
- Esta clasificacion no sustituye una confirmacion real futura de IBKR.
