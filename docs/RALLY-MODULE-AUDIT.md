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
