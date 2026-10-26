# Estudio 10 — timing de exposición de Rally-Test (26-oct-2026, petición de Sergi)

Gates commiteados ANTES de ejecutar: `4c53707` (`scripts/estudio10-timing.mjs`). Resultados: `backtests/estudio10-timing{,-50bp}.json`.
Rally-Test es PROTEGIDO: este estudio solo mide; nada se ha cambiado.

| Hipótesis (v1.1, 10 fases, 2016-2026) | 20 pb | 50 pb |
|---|---|---|
| H1 recortar al 50% en CODICIA (VIX en su percentil ≤10% y SPY a ≤2% de máximos) | NO PASA: confirm 64,6→60,3% · mejora 0/10 fases | NO PASA: 62,3→54,9% |
| H2 recortar al 50% con SPY bajo su media de 200 | NO PASA: confirm 64,6→49,9%; caída 53→39%; MAR 1,15→1,25 | NO PASA: 62,3→45,5%; MAR 1,10→1,13 |
| H3 entrar en MIEDO (VIX percentil ≥90% o SPY ≥10% bajo máximos): retorno a 63 ses. | PASA los gates: +5,3 pp sobre un día cualquiera (10/10 fases; sin el mejor episodio +3,7 pp; 5 episodios positivos) | igual |

Diagnóstico post-hoc (no es un gate) del desglose por episodio de MIEDO (exceso a 63 ses.): 2018-T4 +17,5% · COVID 2020 +39,1% · 2024-25 +24,7% · oct-2025 +28,8% · mar-2026 +63,4% · pero ago-2019 −19,5% · abr-2024 −9,3% y **2021-11→2023-03 (260 días) −12,1%**. Entrar en miedo paga en caídas en V y pierde en caídas lentas (2022). Las 10 fases correlacionan 0,92 (n efectivo ≈ 2): el gate no es una significación estadística.

Lectura: codicia extrema NO es señal de venta (coincide con el backtest de Fear & Greed del 25-sep); filtrar por tendencia baja la caída pero cuesta 15 pp/año; "más en miedo" es una señal de ESCALONADO de entrada (cuánto del efectivo del módulo desplegar), no de rentabilidad del motor, y es una propuesta que necesita ganar una 2.ª auditoría seguida y el OK de Sergi.
Estado hoy (26-oct): SPY a −2,0% de máximos, VIX 18,8 (percentil 72%) → NO es MIEDO según la definición del estudio, aunque CNN marque 20.

## Estudio 11 (27-oct-2026) — entrada escalonada en 3 tramos (gates `31a1c4a`)
95 entradas (cada 21 sesiones, año de 252), v1.1, 20 y 50 pb. Escalonar (1/3 en s, s+21, s+42; caja al 0%) cuesta **−6,5 pp** de retorno del año
(68,9% → 62,4%) y NO reduce de forma consistente la probabilidad de año negativo (10,5% → 8,4% a 20 pb; 10,5% → 10,5% a 50 pb). La caída p90 baja de 43% a 33%,
pero casi solo en las entradas de 2022 en adelante (antes de 2022: 49,6% → 47,3%). Falla T2 y T4 → **NO PASA**. No se propone nada.
Verificación del catalizador de la caída de chips de oct-2026 (WebSearch): financiación de la IA, tipos, valoraciones y competencia china en memoria (CXMT); 8 sesiones seguidas a la baja del SOX hasta el 16-oct.
No hay fuente que apoye regulación gubernamental ni hackeos como causa.
