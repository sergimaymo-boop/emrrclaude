# MÓDULO SP500 — estudio, arquitectura y plan
_Mandato de Sergi (8-ago-2026): módulo TOTALMENTE independiente del OPTIMAL SUPREME, dedicado
en exclusiva a entradas y salidas en el S&P 500, con máxima rentabilidad a corto/medio/largo plazo._

## 1. Auditoría de conexiones reutilizables

| Servicio ya existente | Qué aporta al módulo SP500 | Se reutiliza |
|---|---|---|
| `masterIndicatorsHandler` | SPY, VIX, VVIX, TNX, LQD, HYG, MOVE en vivo | Sí (lectura) |
| `providerCascade` / `historicalDataProvider` | Finnhub → TwelveData → Yahoo → Stooq, con caché | Sí (lectura) |
| `marketBreadthEngine` | amplitud interna del mercado | Sí (lectura) |
| `fearGreedHandler`, `monetaryCycleHandler` | sentimiento y ciclo monetario | Sí (contexto) |
| `kvStorage` (Upstash) | persistencia de snapshots | Sí, **con prefijo propio `sp500:`** |
| `optimal2026Engine` / `Optimal2026Panel` | estrategia multi-acción | **NO se toca** |

**Límite duro de Vercel: 12/12 funciones serverless ya consumidas.** El módulo NO puede añadir
ficheros a `api/`. Se engancha como `source=sp500` dentro del dispatcher `api/market-data.js`
(el mismo patrón que ya usa optimal2026), con la lógica en `api/_lib/sp500Engine.js` +
`api/_lib/sp500Handler.js`, que no cuentan como función.

**Independencia garantizada por diseño** (ningún dato se cruza):
- Motor propio: `sp500Engine.js`, sin importar nada de `optimal2026Engine.js`.
- Clave KV propia: `sp500:snapshot` (SUPREME usa `optimal2026:*`).
- `localStorage` propio: `sp500_*` (SUPREME usa `optimal2026_*`), incluida una cartera SP500
  separada — la foto de IBK que se cargue en un módulo NO alimenta al otro.
- Panel propio y escaneo propio, con su botón; no comparte el mutex de SUPREME.

## 2. El estudio (3 barridos, datos 1970-2026)

Datos: `data/sp500-history.json` — ^GSPC desde 1970, SPY ajustado desde 1993 (con dividendos),
^VIX, ^IRX (remuneración del efectivo), crédito HYG/LQD, bonos IEF/TLT, 9 sectores, SSO y UPRO.
Costes 5 pb por lado, comisión del vehículo y coste de financiación del apalancamiento incluidos.
Periodo principal 1994-02 → 2026-08 (32,5 años: incluye 2000, 2008, 2020 y 2022).

### Referencia a batir
`comprar y mantener SPY` → **CAGR 10,9% · caída máxima 55,2% · MAR 0,20**

### Hallazgos con datos (no volver a probar sin motivo nuevo)
1. **Rotar sectores del S&P 500 PIERDE.** En ventana comparable (1999-06→2026) el mejor
   ajuste sectorial da 8,5% CAGR frente al 10,9% del índice con la misma regla de régimen.
   → *La respuesta a "qué tickers": el índice entero, no sectores.*
2. **Revisar MENSUALMENTE es demasiado lento**: la caída máxima salta de 25% a 42%.
   **Revisión SEMANAL** conserva el resultado (MAR 0,52) con solo ~8-15 órdenes al año.
3. **Mover la exposición a saltos de 10 pp con banda muerta de 10 pp no cuesta nada**
   frente al ajuste continuo diario → el sistema es ejecutable a mano.
4. **El momento absoluto a 12 meses bate a la media de 200 sesiones** como interruptor
   principal (MAR 0,55 vs 0,50), y con 3 días de confirmación evita los latigazos.
5. **El objetivo de volatilidad es el mando de riesgo**: VT15·tope100% → MAR 0,56 (defensivo);
   VT20·tope150% → más rentabilidad con MAR 0,52.
6. **El refuerzo en retrocesos SÍ aporta**, pero poco: +0,4 pp de CAGR (+25 pp de exposición
   cuando el RSI(2) < 5 dentro de tendencia alcista). Se incluye por ser barato, no es el motor.
7. **Aparcar en bonos (IEF) en vez de efectivo**: solo +0,5 pp y con más caída. Opcional, no núcleo.
8. **El apalancamiento sintético está validado** contra los ETF reales: SSO 2x desvía 0,57 pp
   anuales y UPRO 3x desvía 0,38 pp → las cifras apalancadas del estudio son creíbles.
9. **Fuera de muestra 1970-1993** (^GSPC, solo precio): la regla da 8,5% frente al 7,3% de
   comprar y mantener. Ventaja real pero modesta en aquella época — honestidad obligada.

### Fórmula ganadora — "SP500 CORE"
```
Régimen      : momento absoluto 12 meses > 0, confirmado 3 días
Exposición   : objetivo de volatilidad 20% sobre volatilidad realizada 20 sesiones, tope 150%
Retroceso    : +25 pp de exposición si RSI(2) < 5 estando en tendencia (se mira a diario)
Revisión     : semanal (lunes), saltos de 10 pp, banda muerta de 10 pp
Fuera        : efectivo remunerado
```

### Perfiles de riesgo tal y como se han publicado en el módulo
Cada uno verificado sesión a sesión por `scripts/sp500-verify-engine.mjs`, que compara el motor
de producción contra estas cifras y **falla si se desvían** (así el panel nunca enseña un número
que la estrategia no da).

| Perfil | CAGR | Caída máx. | ¿Apalanca? |
|---|---|---|---|
| Comprar y mantener | 10,9% | 55,2% | no |
| **Prudente** | 10,2% | **18,2%** | no |
| **Equilibrado** (recomendado) | 11,2% | 21,0% | no |
| Ambicioso | 13,6% | 25,4% | sí, hasta 150% |
| Agresivo | 17,7% | 36,5% | sí, hasta 225% |

**Recomendación**: Equilibrado. Gana a comprar y mantener con **menos de la mitad de caída** y
sin necesitar margen. Los perfiles apalancados existen porque el estudio los valida, pero el
panel avisa en rojo cada vez que la exposición pasa del 100%.

## 3. Restricción real de ejecución (España + IBK)
La normativa PRIIPs impide a un minorista europeo comprar ETF domiciliados en EE.UU. → **SPY,
VOO, SSO y UPRO no son comprables desde IBK España.** Equivalentes UCITS:
- 1x: **CSPX** (LSE, USD) o **SXR8** (Xetra, EUR) — mismo fondo iShares Core S&P 500 Acc,
  TER 0,07%. **VUSA** si se prefiere reparto de dividendo.
- 2x: **Xtrackers S&P 500 2x Leveraged Daily Swap UCITS ETF** (TER 0,60%, Luxemburgo).
- El apalancamiento diario tiene decaimiento en mercados laterales: el módulo lo mostrará.

## 4. Construcción — COMPLETADA (8-ago-2026)
1. ✅ `api/_lib/sp500Engine.js` — calibración congelada, tope duro de exposición por perfil.
2. ✅ `api/_lib/sp500Handler.js` + `source=sp500` + rewrite `/api/sp500` (0 funciones nuevas).
3. ✅ `src/services/sp500Refresh.ts` — claves `sp500_*`, todo con estado seguro ante fallos.
4. ✅ `src/components/SP500Panel.tsx` — semáforo, % de capital, importe exacto de la orden,
   distancia a la salida, próxima revisión, perfiles y vehículos UCITS.
5. ✅ Verificado en producción: endpoint, panel, aviso de apalancamiento, convivencia con
   SUPREME sin colisión de claves, y sin desbordamiento en móvil (375 px).

### Pendiente para próximas vueltas
- Cartera SP500 propia por foto (aislada de la del SUPREME) — solo si Sergi la pide: hoy el
  módulo ya da el importe exacto introduciendo capital e invertido a mano.
- Añadir el módulo a la auditoría semanal de los lunes.
