# MÓDULO RALLY — auditoría, backtest y rediseño
_Mandato de Sergi (8-ago-2026): recuperar el módulo de "los 10 tickers con el rally
alcista más sano", auditarlo, decir en qué se puede mejorar y reactivarlo validado
con backtest de 10 años._

## 1. Qué había

El backend estaba **intacto** (`api/rally-scan.js`, `api/_lib/rallyScoreEngine.js`,
`rallyBatchProcessor.js`, `src/services/rallyRefresh.ts`); solo se quitó del dashboard
en la consolidación del 24-jul, porque alimentaba a "Señal Óptima", que sí se desactivó.

La fórmula v2.0 puntúa de 0 a 100 con 7 componentes:
fuerza relativa 33% · momento 23% · tendencia 17% · proximidad al máximo de 52 semanas 7% ·
volumen relativo 10% · volatilidad ATR 5% · liquidez 5%, menos penalizaciones
(extensión parabólica, precio bajo la EMA50, volumen de distribución…).

## 2. El hallazgo principal de la auditoría

**La fórmula nunca se había validado con datos.** Los pesos venían de literatura
(O'Neil CAN SLIM, Minervini, Weinstein), no de un backtest. Al medirla:

| Estrategia (2017-08 → 2026-08, 603 tickers, 20 pb/lado) | CAGR | Caída máx. | MAR |
|---|---|---|---|
| SPY comprar y mantener | 15,6% | 33,7% | 0,46 |
| **RALLY v2.0 tal cual (top 10, revisión mensual)** | **14,0%** | **44,9%** | **0,31** |

**Como estaba configurado, el módulo perdía contra comprar el índice y con mucha más
caída.** No era una opinión: es lo que dan los datos.

### Las tres causas
1. **Revisaba demasiado rápido.** Con revisión semanal cae a 10,5%; mensual 14,0%;
   cada 84 días sube a **34-44%**. El momento necesita tiempo — rotar rápido persigue ruido.
   (Es el mismo hallazgo que en [OPTIMAL SUPREME](../backtests/) con la rotación proactiva.)
2. **Los pesos diluían lo que sí predice.** Fuerza relativa y momento aportan señal;
   volumen relativo, ATR y proximidad al máximo la emborronan. Rankear solo por
   RS+momento sube el peor semestre de 19,2% a 31,9%.
3. **Las penalizaciones recortaban a los mejores.** Están pensadas para evitar comprar
   parabólicas, pero en la práctica eliminan justo a los líderes. Quitarlas del *ranking*
   añade 2-3 puntos anuales.

### Otros defectos detectados
- **Umbral de liquidez mal aplicado a los mercados no estadounidenses**: compara el volumen
  en euros (y en *peniques* para Londres) contra un umbral pensado en dólares. Los tickers
  en GBX pasan siempre el filtro. Impacto pequeño (5% del peso) pero es un error real.
- **No dice nunca cuándo estar fuera.** Es un ranking puro: siempre devuelve 10 nombres,
  incluso en pleno mercado bajista. El filtro de régimen se probó y **empeora** el resultado
  (11,1% frente a 14,0%), así que la salida debe gestionarse por posición, no por índice.

## 3. Cómo se validó (para no repetir el error de fiarse de la literatura)

1. **Equivalencia**: la réplica del backtest puntúa igual que el motor de producción
   (81 muestras, desvío máximo 2 puntos). Sin esto, el backtest mediría otra fórmula.
2. **Fuera de muestra**: se partió el periodo en dos mitades. Elegir la mejor variante en
   la primera mitad **no predice** cuál será la mejor en la segunda (**rho = 0,03**).
   → Conclusión: **no sobreajustar**. Se elige por *robustez* (el peor de los dos
   semestres), no por el mejor número del backtest.
3. **Control contra el azar** — la prueba decisiva. Si el ranking no aportara nada,
   elegir 5 tickers al azar del mismo universo daría lo mismo:

   | Periodo ciego 2022-02 → 2026-08 | CAGR |
   |---|---|
   | SPY comprar y mantener | 14,0% |
   | Todo el universo a peso igual | 13,9% |
   | 5 tickers **al azar** (mediana de 30 sorteos) | 13,5% |
   | **Ranking RALLY** | **55,3%** |

   Supera a **30 de 30** sorteos al azar, y también 30/30 en la primera mitad (p ≈ 0,032
   en ambas). **Y el universo a peso igual rinde igual que el SPY (13,9% vs 14,0%), lo que
   descarta que esto sea sesgo de supervivencia**: el universo no regala rentabilidad, la
   aporta la selección.

## 4. Configuración ganadora (elegida por robustez, no por el mejor número)

```
Ranking      : fuerza relativa 50% + momento 50%   (nada más)
Revisión     : cada 84 sesiones (~4 meses)
Cartera      : los 10 primeros, a peso igual
Penalizaciones: NO restan del ranking — se muestran como AVISO en pantalla
```

| | CAGR | Caída máx. | MAR | Sharpe | Ops/año |
|---|---|---|---|---|---|
| SPY comprar y mantener | 15,6% | 33,7% | 0,46 | 0,67 | 0 |
| RALLY v2.0 (lo que había) | 14,0% | 44,9% | 0,31 | 0,45 | 182 |
| **RALLY v3.0 (validado)** | **34,3%** | 41,5% | **0,82** | **1,14** | 49 |

Por mitades: 31,9% en la primera, 41,1% en la segunda — consistente en ambas.
Tercios: 24% / 30% / 49%.

## 5. Reservas honestas (a decir siempre al citar estas cifras)
- **La caída máxima es del 41,5%**, más que la del índice. Diez valores de máximo momento
  caen juntos. Esto no es una estrategia tranquila.
- **El tercer tercio (49%) está inflado por la megatendencia de la IA.** La referencia
  realista son los dos primeros: 24-30%.
- **La elección exacta de parámetros no se transfiere (rho 0,03).** Por eso se eligió el
  centro robusto y **no se debe re-optimizar** salvo con evidencia persistente.
- El universo es el estático actual de 606 tickers. El control contra el azar demuestra
  que el sesgo de supervivencia no explica el resultado, pero el universo sigue sin
  incluir valores desaparecidos.

## 6. Los 10 de hoy (cierre 2026-08-07, con la fórmula validada)
PANW · CRWD · HPE · DELL · NTAP · ZBRA · HUM · FTNT · HPQ · EDEN.PA

_(PANW y HUM ya están en la cartera real de Sergi.)_

## 7. Score de momento de entrada por ticker (9-ago-2026)

Mandato de Sergi: el ranking dice QUÉ tickers comprar, pero no decía SI hoy es buen
día para entrar en cada uno. Se estudió con datos si existe una señal de timing.

**Método**: 260 episodios históricos (cada vez que un ticker entró en el top-10 en
una revisión, 2017-2026). Para cada episodio se probaron 6 variables de estado
conocidas el día de la entrada — extensión sobre EMA20, deterioro de fuerza relativa
a 5 días, volumen relativo, ATR, momento a 1 mes, proximidad al máximo de 52
semanas — contra el retorno hasta la siguiente revisión y la caída máxima
intra-periodo. Cada variable se validó partiendo el periodo en dos mitades.

**Resultado, con honestidad por delante**: de las 6 variables, **solo la proximidad
al máximo de 52 semanas mostró señal consistente en ambas mitades**:

| Zona | Entrenamiento (2017-22) | Prueba (2022-26) |
|---|---|---|
| Lejos del máximo (<96%) | alpha 10,5% · caída −13,8% | alpha 6,0% · caída −12,9% |
| **Cerca sin tocarlo (96-99,7%)** | **alpha 9,1% · caída −7,9%** | **alpha 16,3% · caída −9,6%** |
| En máximos/rompiendo (>99,7%) | alpha 1,6% · caída −11,8% | alpha 7,0% · caída −10,5% |

La zona "cerca sin tocarlo" gana en caída máxima en las dos mitades por un margen
grande (~4-6 puntos menos de caída) y empata o gana en rentabilidad. Coincide con
la sabiduría técnica clásica (zona de entrada de O'Neil, VCP de Minervini), pero
aquí **por primera vez validada con datos fuera de muestra**, no solo citada.

**Lo que NO funcionó** — y por eso NO se usa para puntuar, aunque eran justo las
variables en las que se basaban las penalizaciones de v2.0:
- Extensión sobre EMA20: alpha prácticamente idéntico entre terciles (8,2/8,2/8,0%)
  — no predice nada.
- Deterioro de fuerza relativa a 5 días: sin patrón consistente entre mitades.
- Momento a 1 mes: mejoró en la prueba (25,7% en el tercil "acelerado") pero con
  muestra pequeña (n=30) y en la dirección contraria a la intuición de "no
  perseguir" — se deja fuera por prudencia, no se confía en un resultado así.

**Implementación**: `computeEntryTiming()` en `rallyScoreEngine.js`, campo
`entryTiming` independiente del `rallyScore` (no cambia el ranking). Tres zonas:
IDEAL (verde), LEJOS (gris), EN_MAXIMOS (ámbar, cautela). Mostrado como badge en
cada fila del panel y con la explicación completa al desplegar.

**Reserva honesta**: 260 episodios / partido en dos mitades de ~130 es una muestra
mucho más pequeña que el backtest principal (2.514 sesiones × 603 tickers). Es una
señal de apoyo razonablemente validada, no una certeza — así se etiqueta en el panel.

## 8. Recorrido restante y el trailing stop (9-ago-2026)

Mandato de Sergi: poder entrar en tickers a los que **todavía les queda recorrido**,
aunque no hayamos pillado el mejor momento del rally, y recoger con el trailing stop
la parte que queda.

**Variable objetivo correcta**: no el retorno a un horizonte fijo, sino **lo que un
trailing stop captura de verdad** desde la entrada. 1.060 episodios (top-10 cada 21
sesiones, 2017-2026), validados en dos mitades independientes.
Capturado medio general: **4,2%** en 36 sesiones.

### Indicadores que SÍ predicen recorrido (consistentes en ambas mitades)

| Indicador | 1ª mitad | 2ª mitad |
|---|---|---|
| **Tendencia joven** (<40 sesiones sobre EMA50) | 7,3% | 9,4% |
| **Poco extendida sobre EMA50** (<5%) | 11,7% | 7,6% |
| **En máximos de 52 semanas** (>99,7%) — lo PEOR | 1,2% | 1,5% |

La intuición de Sergi era correcta: **un rally que acaba de empezar deja más recorrido
que uno que lleva meses corriendo**.

**Descartados por no ser consistentes**: aceleración del momento, contracción de
volatilidad, extensión sobre la EMA20 (esta última, otra vez, sin poder predictivo).

### Pero filtrar por recorrido NO mejora la cartera

| Variante (10 años) | CAGR | Caída | Peor mitad |
|---|---|---|---|
| **v3.0 base (lo que está en producción)** | **34,3%** | 41,5% | **31,9%** |
| Filtrar por recorrido ≥60 | 26,4% | 42,2% | 26,3% |
| Filtrar por recorrido ≥70 | 20,1% | 46,8% | 16,4% |
| Mezclar 70/30 ranking/recorrido | 35,3% | 42,1% | 30,3% |
| Mezclar 50/50 + trailing | 37,1% | 36,1% | **17,1%** ← espejismo |

La mezcla 50/50 + trailing luce un MAR de 1,03 pero rinde 17,1% en una mitad y 60,5%
en la otra: es un artefacto de un periodo bueno, no una mejora. El criterio del **peor
semestre** lo desenmascara. **Conclusión: el recorrido se muestra como INFORMACIÓN,
no reordena el top-10.** El ranking ya selecciona bien y filtrar también echa fuera
ganadores.

### Hallazgo grande: el trailing stop ceñido DESTRUYE rentabilidad

Se midió con **reinversión inmediata** del capital liberado (la primera prueba dejaba
el dinero parado hasta 84 sesiones — error propio, corregido):

| Gestión de salida | CAGR |
|---|---|
| Sin trailing (revisión cada 84 sesiones) | **34,3%** |
| Trailing ceñido por ATR (5-18%) ← lo que el módulo sugería | 19,3% |
| Trailing fijo 10% | 22,2% |
| Trailing fijo 20% | 26,9% |
| Trailing fijo 30% | 31,5% |

El patrón es **monótono**: cuanto menos actúa el stop, mejor. No es calibración —
el mecanismo perjudica, porque son valores de máximo momento y un stop ceñido los
corta en retrocesos normales de los que se recuperan.

**Riesgo real de operar sin stop** (260 posiciones): retorno medio +13,3%, un 34% en
pérdida, caída intra-periodo media −11,1%, **peor posición del histórico −64%**
(IAG.LSE, desplome de 2020). Un 12% de las posiciones llegó a caer más del 25%, y de
esas **solo el 10% acabó recuperándose**.

**Decisión**: el módulo pasa a sugerir un **stop ancho de catástrofe (~30%)** en vez
del ceñido por ATR. Cuesta ~2,8 puntos anuales y a cambio acota la cola. El panel lo
etiqueta como "Stop de catástrofe" y explica por qué no debe ceñirse.
