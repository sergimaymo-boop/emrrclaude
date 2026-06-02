# EMRR 2.0 - Fase 1

Fase 1 implementa solo UI visual, datos mock, login DEV ONLY y stubs de engines.

No incluye APIs reales, scanner real, scoring real, SQLite, polling, auto-refresh,
workers, sockets, cron jobs ni integracion REDIT real.

Password mock local: `emrr-dev`.

## Fase 1.1 - Correccion tecnica

Fase 1.1 corrige deuda tecnica antes de Fase 2:

- `shared/types` es la fuente neutral de tipos.
- `src/types` reexporta desde `shared/types`.
- `MarketHoursStatus` queda separado de `AssetMarketDisplayStatus`.
- `SCAN FULL` mantiene flujo visual mock con estado temporal.
- `exportar resultados` mantiene salida mock del TOP 8 para analisis posterior.
- `exportar código` mantiene comportamiento mock estable por defecto.
- Se mantiene preparacion basica para Vercel: `.gitignore`, `.nvmrc` y `engines.node`.

Fase 1.1 no agrega APIs reales, SQLite real, scanner real, scoring real,
trailing real, calculos financieros reales ni integracion REDIT real.

## Regla futura de trailing

No existe cap fijo hardcoded.

Cuando el trailing real se implemente en una fase autorizada, debe ser dinamico
y basado en ATR%:

- `trailing_adjusted = ATR% x 0.65`
- `trailing_medium = ATR% x 1.00`
- `trailing_wide = ATR% x 1.45`

`trailing_wide` no debe limitarse con un maximo fijo. El trailing queda libre y dinamico
segun ATR%, volatilidad y logica futura del sistema.
