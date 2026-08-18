/**
 * RALLY LEADERS ENGINE — Rally Score Engine v4.0 (super-auditoría, 9-ago-2026)
 *
 * HISTORIA DE VERSIONES (cada salto, validado con 10 años / 603 tickers):
 *   v2.0 — 7 componentes de literatura (O'Neil/Minervini/Weinstein), nunca medidos.
 *          Al medirlos: 14,0%/año con caída 44,9% — PERDÍA contra el S&P 500.
 *   v3.0 — RS 50% + momento 50%: 34,3% (37,5% con pesos por convicción).
 *   v4.0 — MOMENTO PURO A 9 MESES. La super-auditoría de familias de indicadores
 *          (scripts/rally-super-audit*.mjs: momento 6/9/12m, 12-1 clásico, RSI(14),
 *          RS a 3 ventanas, momento/volatilidad, combos por percentil) reveló que la
 *          medición simple es sensible a la fecha de inicio, así que el criterio fue
 *          DOMINANCIA EN MALLA: 3 fases de arranque × 3 cadencias de revisión, y en
 *          cada celda el PEOR de los dos semestres. El momento a 9 meses ganó al
 *          campeón v3 en las 9/9 celdas; con pesos por convicción mejora en 9/9 más:
 *
 *            v3 (RS+mom, convicción) ... CAGR 37,5% · caída 41,9% · MAR 0,89
 *            v4 (mom9, convicción) ..... CAGR 39,4% · caída 43,9% · MAR 0,90
 *            v4 robustez: peor semestre mediana 32,8% · mínimo de las 9 celdas 24,2%
 *
 *          CONVERGENCIA INDEPENDIENTE: 9 meses = 189 sesiones, el MISMO lookback que
 *          OPTIMAL SUPREME encontró con sus 118 variantes en julio. Dos estudios
 *          separados sobre el mismo universo apuntan a la misma ventana — la señal
 *          de momento en este universo vive en ~9 meses.
 *
 *   score = clamp(50 + 50·tanh(mom9m / 75)) — transformación MONÓTONA del momento a
 *   9 meses: el orden del ranking es EXACTAMENTE el del momento crudo (equivale al
 *   percentil transversal con el que se auditó), y la escala 0-100 alimenta los pesos
 *   por convicción igual que antes. RSI(14) como ranking: probado, de lo PEOR (6,8%).
 *
 * RS/tendencia/proximidad/RVOL/ATR siguen calculándose y mostrándose como contexto,
 * pero NO puntúan. Las penalizaciones siguen siendo `warningFlags` informativos.
 */

import { calculateEma, calculateAtr } from "./technicalEngine.js";

export const RALLY_ENGINE_VERSION = "4.0.0";

const WEIGHTS = {
  relativeStrength: 0.50,
  momentum:         0.50,
  trend:            0,
  proximity52w:     0,
  rvol:             0,
  atr:              0,
  liquiditySpread:  0,
};

export const RALLY_RANGES = [
  { min: 90, label: "ELITE RALLY",  color: "#10b981" },
  { min: 80, label: "STRONG RALLY", color: "#34d399" },
  { min: 70, label: "ACTIVE RALLY", color: "#6366f1" },
  { min: 60, label: "WATCH",        color: "#eab308" },
  { min: 0,  label: "DISCARD",      color: "#4b5563" },
];

export function getRallyLabel(score) {
  return RALLY_RANGES.find(r => score >= r.min) ?? RALLY_RANGES[RALLY_RANGES.length - 1];
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Curve normalization for RS — uses asymptotic function so exceptional
 * performers (RS > 60%) continue to differentiate instead of capping at 100.
 * RS = 0  → score 50 (in line with market)
 * RS = 20 → score ~73
 * RS = 40 → score ~87
 * RS = 80 → score ~97
 * RS = -20 → score ~23
 */
function normalizeRS(excessReturn) {
  if (!isFiniteNum(excessReturn)) return 20;
  // Sigmoid-like curve: 50 + 50 * tanh(rs / 40)
  const t = Math.tanh(excessReturn / 40);
  return clamp(50 + 50 * t);
}

function normalizeLinear(value, min, max) {
  if (!isFiniteNum(value)) return 0;
  if (max === min) return 50;
  return clamp(((value - min) / (max - min)) * 100);
}

function returnPercent(closes, lookback) {
  if (closes.length < lookback + 1) return null;
  const past = closes[closes.length - lookback - 1];
  const current = closes[closes.length - 1];
  if (!past || past === 0) return null;
  return ((current - past) / past) * 100;
}

function emaSeries(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const series = [];
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    series.push(ema);
  }
  return series;
}

// ─── Component scorers ────────────────────────────────────────────────────────

function scoreRS(rs3m, rs6m) {
  // Use curve normalization — no artificial cap for exceptional RS leaders
  const s3m = normalizeRS(rs3m ?? 0);
  const s6m = normalizeRS(rs6m ?? 0);
  // More recent RS (3M) weighted heavier — 70/30 split
  return s3m * 0.70 + s6m * 0.30;
}

function scoreMomentum(mom1m, mom3m, mom6m) {
  // 3M is the primary signal (academically validated, less noise than 1M)
  // 1M reduced to 10% — too noisy, subject to short-term reversal
  const s1m = normalizeLinear(mom1m ?? 0, -10, 20);
  const s3m = normalizeLinear(mom3m ?? 0, -15, 45);
  const s6m = normalizeLinear(mom6m ?? 0, -20, 65);
  return s1m * 0.10 + s3m * 0.60 + s6m * 0.30;
}

function scoreTrend(price, ema20, ema50, ema20Slope, ema50Slope) {
  let score = 0;
  // Classic Weinstein Stage 2: price > EMA20 > EMA50 with positive slopes
  if (isFiniteNum(price) && isFiniteNum(ema20) && price > ema20) score += 25;
  if (isFiniteNum(ema20) && isFiniteNum(ema50) && ema20 > ema50) score += 25;
  if (isFiniteNum(ema20Slope) && ema20Slope > 0) score += 25;
  if (isFiniteNum(ema50Slope) && ema50Slope > 0) score += 25;
  // Bonus: price also above EMA50 (strongest Stage 2 confirmation)
  if (isFiniteNum(price) && isFiniteNum(ema50) && price > ema50) score = Math.min(100, score + 10);
  return clamp(score);
}

/**
 * 52-Week High Proximity — key institutional breakout signal
 *
 * O'Neil: buy stocks within 5-15% of their 52W high on tight bases
 * Minervini: VCP (Volatility Contraction Pattern) near highs
 *
 * Scoring:
 *   ≥ 100% of 52W high (NEW HIGH): 100 — rare but explosive
 *   95-100%: 90 — tight consolidation near high
 *   85-95%:  70 — still in range
 *   75-85%:  40 — pulling back from highs
 *   < 75%:   10 — too far from highs
 */
/**
 * ENTRY TIMING SCORE — "¿es buen momento de entrar en ESTE ticker concreto, o
 * espero?" Distinto del rallyScore (que decide QUÉ tickers merecen estar en el
 * top-10). Validado con estudio propio (docs/RALLY-MODULE-AUDIT.md §7,
 * scripts/rally-entry-timing-study.mjs): de 6 variables candidatas (extensión
 * sobre EMA20, deterioro de fuerza relativa 5d, volumen relativo, ATR, momento
 * 1m, proximidad al máximo de 52 semanas), probadas contra 260 episodios
 * históricos de entrada en el top-10 con partición fuera de muestra, SOLO la
 * proximidad al máximo de 52 semanas mostró una señal consistente en AMBAS
 * mitades del periodo (2017-2022 y 2022-2026):
 *
 *   cerca del máximo SIN TOCARLO (96-99,7%): mejor alpha Y menor caída en las
 *     dos mitades (caída intra-periodo -7,9%/-9,6% frente a -13,8%/-12,9% lejos
 *     del máximo, o -11,8%/-10,5% rompiendo máximos nuevos)
 *   lejos del máximo (<96%) y en máximos/rompiéndolos (>99,7%): peor en ambas.
 *
 * Extensión sobre EMA20 y deterioro de RS 5d — las señales en las que se
 * basaban las PENALIZACIONES de v2.0 — NO mostraron predecir nada (alpha
 * prácticamente idéntico entre terciles): por eso NO se usan aquí. Momento 1m
 * mostró mejora en la prueba pero con muestra pequeña (n=30) y económicamente
 * a la inversa de lo esperado — se deja fuera del score por prudencia.
 */
function computeEntryTiming(proximity52w) {
  if (typeof proximity52w !== "number" || !Number.isFinite(proximity52w)) {
    return { score: null, zone: "SIN_DATOS", label: "Sin histórico suficiente para valorar el momento de entrada" };
  }
  if (proximity52w >= 0.96 && proximity52w <= 0.997) {
    return { score: 90, zone: "IDEAL", label: "Cerca de su máximo de 52 semanas sin haberlo tocado — la zona con mejor rentabilidad y menor caída en el estudio" };
  }
  if (proximity52w > 0.997) {
    return { score: 45, zone: "EN_MAXIMOS", label: "En máximos históricos o rompiéndolos ahora mismo — el estudio muestra más riesgo de retroceso a corto plazo" };
  }
  return { score: 55, zone: "LEJOS", label: "Alejado de su máximo de 52 semanas — el estudio muestra menor rentabilidad esperada que la zona ideal" };
}

function scoreProximity52w(price, closes) {
  const lookback = Math.min(closes.length - 1, 252);
  if (lookback < 50) return 40; // not enough data, neutral
  const high52w = Math.max(...closes.slice(-lookback));
  if (!high52w || high52w === 0) return 40;
  const proximity = price / high52w;
  if (proximity >= 1.00) return 100; // at or above 52W high — breakout
  if (proximity >= 0.95) return 90;
  if (proximity >= 0.85) return 70;
  if (proximity >= 0.75) return 40;
  return 10;
}

/**
 * Direction-aware RVOL — distinguishes accumulation from distribution
 *
 * High RVOL + price above recent short-term EMA = ACCUMULATION (bullish)
 * High RVOL + price below recent short-term EMA = DISTRIBUTION (bearish)
 */
function scoreRvol(rvol, price, ema5) {
  if (!isFiniteNum(rvol)) return 30;

  // Determine if volume is accumulation or distribution
  const isAccumulation = isFiniteNum(price) && isFiniteNum(ema5) && price >= ema5;
  const directionMultiplier = isAccumulation ? 1.0 : 0.25; // heavy penalty for down volume

  let baseScore;
  if (rvol >= 1.5) baseScore = 100;
  else if (rvol >= 1.2) baseScore = 75;
  else if (rvol >= 1.0) baseScore = 50;
  else if (rvol >= 0.8) baseScore = 30;
  else baseScore = 10;

  return clamp(baseScore * directionMultiplier);
}

function scoreAtr(atrPercent) {
  if (!isFiniteNum(atrPercent)) return 30;
  const atp = Math.abs(atrPercent);
  if (atp >= 1.0 && atp <= 2.5) return 100; // sweet spot
  if (atp >= 0.5 && atp < 1.0) return 60;
  if (atp > 2.5 && atp <= 4.0) return 70;
  if (atp < 0.5) return 20; // too dead
  return 30; // too wild
}

/**
 * Trailing stop — CORREGIDO 9-ago-2026 tras medirlo (docs/RALLY-MODULE-AUDIT.md §8).
 *
 * La versión anterior sugería un stop ceñido por ATR (2,0-3,0× ATR, acotado a
 * [5%, 18%]) siguiendo la lógica clásica de Wilder/Chandelier. El backtest de
 * cartera demostró que ESO DESTRUYE RENTABILIDAD en esta estrategia concreta:
 *
 *   sin trailing ................................ 34,3% anual
 *   trailing ceñido por ATR (5-18%) ............. 19,3%   ← lo que se sugería antes
 *   trailing fijo 10% ........................... 22,2%
 *   trailing fijo 20% ........................... 26,9%
 *   trailing fijo 30% ........................... 31,5%
 *
 * (todo con REINVERSIÓN inmediata del capital liberado, para que la comparación
 * sea justa). El patrón es monótono: cuanto MENOS actúa el stop, mejor. No es un
 * problema de calibración — el mecanismo perjudica, porque estos son valores de
 * máximo momento y un stop ceñido los corta en retrocesos normales de los que se
 * recuperan.
 *
 * Qué se sugiere ahora: un stop ANCHO de catástrofe (~30%), que apenas cuesta
 * rentabilidad (−2,8 pp) y sí acota la cola: sin ningún stop, la peor posición
 * del histórico fue −64% (IAG.LSE en el desplome de 2020), y de las posiciones
 * que llegaron a caer más del 25%, solo el 10% acabó recuperándose en positivo.
 * Se mantiene un ajuste leve por volatilidad para que los valores más nerviosos
 * tengan algo más de margen, pero SIEMPRE en la banda ancha.
 *
 * ⚠ LEGACY desde 15-ago-2026: ya NO es el stop que se muestra. El estudio de
 * stops adaptativos (ver suggestedStopPct más abajo) la sustituyó por la anchura
 * por FASE del ticker; esta banda 25-35 midió celda mínima 21,5% (por debajo del
 * suelo de robustez) frente a 25,0% de la adaptativa. Se conserva como referencia.
 */
function calculateTrailingStop(atrPercent) {
  if (!isFiniteNum(atrPercent) || atrPercent <= 0) return 30;
  const atp = Math.abs(atrPercent);
  // Banda ancha 25-35%: solo salta ante un derrumbe real, no ante un retroceso.
  const raw = 25 + atp * 2;
  return Math.round(clamp(raw, 25, 35) * 10) / 10;
}

/**
 * STOP SUGERIDO POR TICKER — adaptativo por FASE (estudio 15-ago-2026 ronda 2:
 * scripts/rally-adaptive-stop-study.mjs + rally-adaptive-stop-round2.mjs,
 * backtests/rally-adaptive-stop-round2.json). Sustituye a la banda fija 25-35
 * como stop mostrado: cada ticker recibe SU anchura según su recorrido.
 *
 *   stop% = clamp(12 + 0,35 · runwayScore, 15, 45)
 *   (fijado a la entrada y RE-FIJADO en cada revisión, ~84 sesiones — es lo que
 *    hace la simulación y lo que muestra el panel en cada scan)
 *
 * runwayScore (0-100, computeRunway) resume la FASE del ticker: edad de la
 * tendencia, extensión sobre la media de 50 y cercanía al máximo de 52 semanas.
 * Recorrido alto → stop amplio (dejar correr); recorrido bajo → ceñido (ceder
 * poco en el pullback y rotar). Señales sobre cierre ajustado, protocolo malla
 * 9 celdas, salto por mezcla 0,7·score+0,3·recorrido:
 *
 *   · elegida por WALK-FORWARD honesto: mejor 1ª mitad de todas las políticas
 *     elegibles (42,0%) y confirmada en la 2ª (40,2%) — no elegida en test
 *   · QUÉ COMPRA frente al fijo 30%: igual robustez con mejor suelo (peor celda
 *     25,0% frente a 23,3%) y stop propio por ticker — NO más rentabilidad
 *     esperada (mitad de confirmación: 40,2% frente a 41,4% del fijo 30%,
 *     empate estadístico; el mérito es robustez + adaptividad)
 *   · backtest completo: CAGR 41,1% · caída máx 36,9% · MAR 1,11 · winrate 65%
 *     · gana 7/9 celdas al campeón sin stops y 6/9 al fijo 30%
 *   · probadas y DESCARTADAS con números: k·ATR puro (satura y pierde mediana),
 *     salud compuesta, k por ticker incluso con shrinkage (rho 0,02 con n=17;
 *     captura 30,6% frente a 38,8% del global), ratchets de beneficio
 *   · clasificador de pullback: ninguna COMBINACIÓN explotable out-of-sample
 *     (mejor combo OLS 0,16); m9 y slope200 sí muestran IC estable moderado
 *     (0,24-0,30) — lo que justifica no ceñir es la evidencia a NIVEL DE
 *     POLÍTICA (todas las variantes ceñidas pierden), no "nada predice"
 *
 * Cifras de backtest (universo superviviente, cierres diarios, 20 pb): valen
 * para comparar variantes entre sí, no como rentabilidad esperada.
 */
export function suggestedStopPct(runwayScoreValue) {
  if (!isFiniteNum(runwayScoreValue)) return 30; // sin dato de recorrido: neutro
  return Math.round(clamp(12 + 0.35 * runwayScoreValue, 15, 45));
}

/**
 * RECORRIDO RESTANTE — "¿a este rally le queda gasolina desde hoy?" (mandato de
 * Sergi, 9-ago-2026). Distinto del rallyScore (QUÉ comprar) y del entryTiming
 * (si el precio está en buena zona).
 *
 * Validado en scripts/rally-runway-study.mjs: 1.060 episodios históricos de
 * entrada en el top-10, midiendo lo que un trailing stop captura de verdad desde
 * la entrada, con partición en dos mitades independientes. Solo tres señales
 * fueron consistentes en AMBAS mitades (capturado medio general: 4,2%):
 *
 *   · tendencia JOVEN, <40 sesiones sobre la EMA50 ... 7,3% y 9,4%
 *   · POCO EXTENDIDA sobre la EMA50, <5% ............ 11,7% y 7,6%
 *   · EN MÁXIMOS de 52 semanas (>99,7%) ............. 1,2% y 1,5%  (lo peor)
 *
 * Descartadas por NO ser consistentes entre mitades: aceleración del momento,
 * contracción de volatilidad, y la extensión sobre la EMA20.
 *
 * IMPORTANTE: es INFORMATIVO, no reordena el top-10. Se probó filtrar y mezclar
 * esta puntuación dentro del ranking y ninguna variante mejoró a la cartera base
 * en el peor de los dos semestres — el ranking ya selecciona bien y el filtro
 * también dejaba fuera a ganadores.
 */
function computeRunway(price, closes, ema50Series, ema50, proximity52w) {
  let score = 50;
  const reasons = [];

  // Edad de la tendencia: sesiones consecutivas cerrando sobre la EMA50.
  let trendAge = null;
  if (Array.isArray(ema50Series) && ema50Series.length) {
    // ema50Series[k] corresponde a closes[k + (closes.length - ema50Series.length)]
    const offset = closes.length - ema50Series.length;
    trendAge = 0;
    for (let k = ema50Series.length - 1; k >= 0; k--) {
      const px = closes[k + offset];
      if (!isFiniteNum(px) || !isFiniteNum(ema50Series[k]) || px < ema50Series[k]) break;
      trendAge++;
    }
  }
  if (trendAge != null) {
    if (trendAge < 40) { score += 25; reasons.push(`Tendencia joven (${trendAge} sesiones sobre su media de 50) — históricamente la que más recorrido deja`); }
    else if (trendAge < 100) { score += 5; reasons.push(`Tendencia de ${trendAge} sesiones — recorrido intermedio`); }
    else { score -= 5; reasons.push(`Tendencia madura (${trendAge} sesiones) — buena parte del recorrido puede estar hecha`); }
  }

  const ext50 = isFiniteNum(ema50) && ema50 > 0 && isFiniteNum(price) ? (price - ema50) / ema50 : null;
  if (ext50 != null) {
    if (ext50 < 0.05) { score += 20; reasons.push(`Solo un ${(ext50 * 100).toFixed(0)}% sobre su media de 50 — el tramo aún no se ha estirado`); }
    else if (ext50 < 0.15) { score += 5; }
    else if (ext50 > 0.30) { score -= 10; reasons.push(`Un ${(ext50 * 100).toFixed(0)}% por encima de su media de 50 — tramo muy estirado`); }
  }

  if (isFiniteNum(proximity52w) && proximity52w > 0.997) {
    score -= 15;
    reasons.push("Justo en máximos de 52 semanas — en el estudio es la peor zona para lo que queda de recorrido");
  }

  score = clamp(score);
  const level = score >= 75 ? "ALTO" : score >= 55 ? "MEDIO" : "BAJO";
  return { score: Math.round(score), level, trendAge, reasons };
}

function scoreLiquidity(avgValue20, spreadPercent, region) {
  const thresholds = region === "USA"
    ? { minValue: 10_000_000, maxSpread: 0.35 }
    : { minValue: 5_000_000, maxSpread: 0.50 };

  let score = 100;
  if (isFiniteNum(avgValue20) && avgValue20 < thresholds.minValue) score -= 50;
  if (isFiniteNum(spreadPercent) && spreadPercent > thresholds.maxSpread) score -= 40;
  return clamp(score);
}

// ─── Avisos (v3.0: ya NO restan puntos del ranking — el backtest mostró que ─────
// recortaban justo a los líderes; se muestran como aviso explícito en el panel) ──

function computeWarningFlags(metrics) {
  const flags = [];
  const { price, ema20, ema50, mom1m, mom3m, rvol, rs5d } = metrics;

  if (isFiniteNum(price) && isFiniteNum(ema20) && ema20 > 0) {
    const ext = (price - ema20) / ema20;
    if (ext > 0.30) flags.push({ code: "EXTENDED_30", label: `Extendido +${Math.round(ext * 100)}% sobre su media de 20 sesiones — entrada tardía / parabólico` });
    else if (ext > 0.20) flags.push({ code: "EXTENDED_20", label: `Extendido +${Math.round(ext * 100)}% sobre su media de 20 sesiones` });
  }
  if (isFiniteNum(price) && isFiniteNum(ema50) && price < ema50) {
    flags.push({ code: "BELOW_EMA50", label: "Precio por debajo de su media de 50 sesiones — estructura de tendencia rota" });
  }
  if (isFiniteNum(mom1m) && mom1m > 60) {
    flags.push({ code: "PARABOLIC_1M", label: `Subida del ${Math.round(mom1m)}% en 1 mes — ritmo insostenible, riesgo de giro` });
  } else if (isFiniteNum(mom1m) && mom1m > 40) {
    flags.push({ code: "FAST_1M", label: `Subida del ${Math.round(mom1m)}% en 1 mes — acelerado` });
  }
  if (isFiniteNum(rvol) && rvol > 3.5) {
    flags.push({ code: "BLOWOFF_VOLUME", label: "Volumen anómalo (>3,5x) — posible distribución institucional" });
  }
  if (isFiniteNum(rs5d) && rs5d < -15) {
    flags.push({ code: "RS_DETERIORATING", label: "Fuerza relativa cayendo con fuerza en los últimos 5 días" });
  } else if (isFiniteNum(rs5d) && rs5d < -8) {
    flags.push({ code: "RS_WEAKENING", label: "Fuerza relativa debilitándose en los últimos 5 días" });
  }
  if (isFiniteNum(mom3m) && isFiniteNum(mom1m) && mom3m > 15 && mom1m < -5) {
    flags.push({ code: "MOMENTUM_DIVERGENCE", label: "Momento a 3 meses fuerte pero frenando en el último mes — divergencia" });
  }
  return flags;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * PESO SUGERIDO POR MOMENTUM 9M CRUDO — esquema M9_RAW (estudio 17-ago-2026:
 * scripts/rally-weighting-study.mjs → backtests/rally-weighting-study.json,
 * triple verificación adversarial: verify-weighting-recompute.mjs (simulador
 * independiente + waterfilling KKT) y verify-weighting-stress.mjs →
 * backtests/rally-weighting-stress.json).
 *
 * QUÉ CAMBIA: antes se ponderaba por (score−50), pero el score satura en ~100
 * con momentos >150% (tanh), así que entre los mega-líderes los pesos apenas
 * separaban (perfil medio 11,8% → 8,9%). Ahora la base es el momentum 9 meses
 * CRUDO en % — la misma señal del ranking, sin saturar — y el perfil medio pasa
 * a 18,1% → 7,0%: el capital sigue de verdad a la convicción del modelo.
 *
 *   w_i = clamp(base_i · t, 4%, 20%)  con  base_i = max(1, mom9m_i)  y un único
 *   t tal que Σ w_i = 100 (reparto proporcional EXACTO dentro de topes; la
 *   bisección está validada a 5e-15 contra un solver waterfilling independiente).
 *
 * CIFRAS (misma selección, mismos stops H4, solo cambian los pesos):
 *   · Confirmación 2022-26: CAGR 44,9% vs 36,2% del esquema por score saturado
 *     (+8,7 pp) · MaxDD 36,1% vs 34,4% (+1,6 pp) · MAR 1,24 vs 1,05.
 *   · Dominancia 9/9 celdas de la malla fase×cadencia en TRAIN y 9/9 en
 *     CONFIRMACIÓN; winrate idéntico 65% (los stops no cambian).
 *   · Periodo completo 2017-26: CAGR 47,7% · MaxDD 37,7% · MAR 1,27.
 *
 * ADVERTENCIA DE VENTA HONESTA (estrés 17-ago-2026):
 *   · El exceso se CONCENTRA en mega-trends: casi todo el +8,7 pp cae en
 *     2024-26 (WDC/MU/PLTR aportan ~80% del exceso neto). En régimen
 *     lateral/bajista rinde ≈ igual que el esquema anterior (2022-23 ≈ neutro,
 *     gana solo 3/9 sub-celdas) y PIERDE en crashes de momentum tipo 2021
 *     (−8,5 pp ese año). Expectativa realista: ~0-3 pp en régimen normal más
 *     opcionalidad grande cuando aparece un mega-trend; nunca daño material
 *     (peor rebanada observada −2,2 pp).
 *   · Universo superviviente: el Δ de los esquemas concentradores puede estar
 *     algo inflado; las cifras comparan variantes, no prometen rentabilidad.
 *   · NO SUBIR EL TECHO DEL 20%: el cap [4,25] mide +1,0 pp más en el backtest,
 *     pero ese extra viene de UN solo ticker en una revisión — concentración
 *     sin evidencia robusta. El suelo del 4% evita posiciones simbólicas.
 *
 * Solo cambia la asignación de pesos: score, stops, rotación y ranking intactos.
 */
export function assignSuggestedWeights(assets) {
  if (!Array.isArray(assets) || !assets.length) return assets;
  const n = assets.length;
  const FLOOR = 4, CEIL = 20;
  // base_i = momentum 9m crudo en % ya calculado por el engine (metrics.mom9m);
  // suelo 1 para que negativos/planos/ausentes cuenten igual (mínimo del estudio).
  // Un asset sin mom9m finito aquí es anómalo (el engine descarta sin 189 sesiones):
  // se avisa por consola con el ticker y se mantiene la base neutra 1.
  const base = assets.map((a) => {
    const m9 = a?.metrics?.mom9m;
    if (!Number.isFinite(m9)) {
      console.warn(`[rallyScoreEngine] assignSuggestedWeights: ${a?.ticker ?? a?.providerSymbol ?? "?"} sin mom9m finito — base neutra 1`);
      return 1;
    }
    return Math.max(1, m9);
  });

  let weights;
  if (n * CEIL < 100) {
    // Menos de 5 posiciones: ni todo al techo suma 100 → equiponderado 100/N.
    weights = base.map(() => 100 / n);
  } else if (base.every((v) => v === base[0])) {
    // Bases idénticas: equiponderado (evita depender del t degenerado).
    weights = base.map(() => 100 / n);
  } else {
    weights = capNormalizeWeights(base, FLOOR, CEIL);
  }
  // Redondeo por MAYOR RESTO a 1 decimal: Σ pesos SERVIDOS = 100,0 EXACTO.
  // (El redondeo independiente por peso servía 100,2 en scans reales.)
  const served = roundWeightsTo100(weights);
  return assets.map((a, i) => ({ ...a, suggestedWeightPct: served[i] }));
}

/**
 * Redondeo por MAYOR RESTO (Hamilton) a `decimals` decimales, forzando que la suma
 * servida sea EXACTAMENTE 100. Cada peso se trunca a su décima inferior y las
 * décimas que faltan hasta 100,0 se reparten a los mayores restos fraccionales
 * (empate → primer índice, determinista). Un peso en el techo exacto (frac 0) no
 * recibe décima extra salvo caso degenerado imposible con Σ=100. Sesgo máximo por
 * peso: ±0,1. El bucle final cubre el caso de deriva flotante (Σfloors > objetivo).
 */
function roundWeightsTo100(weights, decimals = 1) {
  const factor = 10 ** decimals;
  const scaled = weights.map((w) => w * factor);
  const floors = scaled.map((v) => Math.floor(v + 1e-9));
  const out = floors.slice();
  let remaining = Math.round(100 * factor) - floors.reduce((s, v) => s + v, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && remaining > 0; k++) { out[order[k].i] += 1; remaining--; }
  for (let k = order.length - 1; k >= 0 && remaining < 0; k--) {
    if (out[order[k].i] > 0) { out[order[k].i] -= 1; remaining++; }
  }
  return out.map((v) => v / factor);
}

/**
 * Reparto proporcional EXACTO dentro de topes [lo, hi]: w_i = clamp(raw_i·t, lo, hi)
 * con t único tal que Σw = 100. Bisección geométrica (f(t) continua y no
 * decreciente; solución única en pesos), determinista — algoritmo copiado tal
 * cual del estudio (rally-weighting-study.mjs, capNormalize), donde está
 * validado a 5e-15 contra un solver waterfilling KKT independiente.
 */
function capNormalizeWeights(raw, lo = 4, hi = 20) {
  const n = raw.length;
  if (!n) return [];
  // GUARDA DE INFACTIBILIDAD POR EL SUELO: con n·lo > 100 ni poniendo TODOS los
  // pesos en el suelo se baja a 100 (p.ej. n=26 con suelo 4% → mínimo 104) — no
  // existe t válido y la bisección devolvería basura. Reparto igualitario 100/n.
  if (n * lo > 100) return raw.map(() => 100 / n);
  // Guarda simétrica por el techo (n·hi < 100 → ni todo al techo llega a 100).
  // assignSuggestedWeights ya la cubre aguas arriba; se repite aquí para que la
  // función sea segura por sí sola.
  if (n * hi < 100) return raw.map(() => 100 / n);
  const w = raw.map((v) => (Number.isFinite(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return w.map((v) => Math.min(hi, Math.max(lo, v * t)));
}

/**
 * RANKING DE ROTACIÓN — ¿a qué ticker saltar cuando salta un trailing stop?
 * (estudio 15-ago-2026: scripts/rally-rotation-strategy.mjs,
 *  backtests/rally-rotation-strategy.json).
 *
 * MEZCLA 70/30 del rally score con la puntuación de recorrido. De los siete
 * criterios de salto probados (mejor score, recorrido ALTO, entrada IDEAL,
 * ALTO+IDEAL, mezcla, excluir BAJO, aleatorio-top30 con semilla fija) es LA
 * VARIANTE MÁS ROBUSTA — no "la ganadora": gana 7/9 celdas de la malla
 * fase×cadencia al campeón sin trailing, no domina 9/9. Con stop fijo 30% al
 * cierre: CAGR 39,2% · caída máx 36,3% · MAR 1,08 frente a 39,1%/43,9%/0,89 del
 * campeón; elegida solo con la 1ª mitad del histórico aguantó en la 2ª
 * (37,9% → 40,6%). El salto por score puro mide más CAGR canónico (40,8%) pero
 * con peor cola de robustez (celda mínima 18,0% frente a 24,6%). Con el stop de
 * catástrofe del panel gana 6/9 con la mejor mediana de peor semestre (33,4%).
 * Cifras de backtest (universo superviviente, ejecución al cierre): valen para
 * comparar variantes entre sí, no como rentabilidad esperada.
 *
 * Lecciones que NO cambiar sin re-medir:
 *   · Exigir "entrada IDEAL" al saltar DESTRUYE rentabilidad (0/9 celdas,
 *     CAGR ~29-30%) — segunda confirmación tras el §11 del audit doc. Ponderar
 *     el recorrido sí; filtrar por estado, no.
 *   · El control aleatorio dentro del top-30 dio 31,3%: el criterio aporta
 *     ~8-9 puntos reales, no es ruido de selección.
 *
 * Es INFORMATIVO-OPERATIVO (guía del salto manual): no reordena el top-10 del
 * scanner ni toca score, runway, entryTiming ni pesos por convicción.
 */
export function rotationRank(rallyScore, runwayScore) {
  const s = isFiniteNum(rallyScore) ? rallyScore : 0;
  const r = isFiniteNum(runwayScore) ? runwayScore : 50; // sin dato de recorrido: neutro
  return Math.round((0.7 * s + 0.3 * r) * 10) / 10;
}

export function calculateRallyScore({ bars, spyBars = [], spreadPercent = null, region = "USA" }) {
  // v4.0: el score necesita 189 sesiones de momento 9m + margen; con menos histórico
  // el ticker queda DISCARD (sin 9 meses cotizando no hay señal comparable).
  const MIN_BARS = 200;

  if (!Array.isArray(bars) || bars.length < MIN_BARS) {
    return {
      ok: false, rallyScore: 0, label: "DISCARD", color: "#4b5563",
      blockedReasons: ["INSUFFICIENT_HISTORY_FOR_RALLY_SCORE"], metrics: null,
    };
  }

  const closes = bars.map(b => b.close).filter(Number.isFinite);
  const volumes = bars.map(b => b.volume ?? 0);
  const lastClose = closes[closes.length - 1];

  // Cambio de SESIÓN: siempre desde las DOS ÚLTIMAS BARRAS ADYACENTES del array
  // ORIGINAL de barras (no del array `closes` filtrado: si la penúltima barra
  // viniera inválida, el filtrado saltaría a una barra anterior y el % pasaría a
  // ser multi-día sin avisar). Si la penúltima barra no tiene close finito → null.
  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const dayChangePct = (Number.isFinite(lastBar?.close) && Number.isFinite(prevBar?.close) && prevBar.close > 0)
    ? Math.round((lastBar.close / prevBar.close - 1) * 10000) / 100
    : null;

  if (!lastClose || lastClose <= 0) {
    return { ok: false, rallyScore: 0, label: "DISCARD", color: "#4b5563", blockedReasons: ["INVALID_CLOSE_PRICE"], metrics: null };
  }

  // ─── EMAs ───
  const ema5  = calculateEma(closes, 5);
  const ema20 = calculateEma(closes, 20);
  const ema50 = calculateEma(closes, 50);

  // EMA slopes (5-bar lookback for responsiveness)
  const ema20PrevSeries = emaSeries(closes.slice(0, -5), 20);
  const ema50PrevSeries = emaSeries(closes.slice(0, -5), 50);
  const ema20Prev = ema20PrevSeries.at(-1) ?? null;
  const ema50Prev = ema50PrevSeries.at(-1) ?? null;
  const ema20Slope = (isFiniteNum(ema20) && isFiniteNum(ema20Prev) && ema20Prev !== 0)
    ? ((ema20 - ema20Prev) / ema20Prev) * 100 : null;
  const ema50Slope = (isFiniteNum(ema50) && isFiniteNum(ema50Prev) && ema50Prev !== 0)
    ? ((ema50 - ema50Prev) / ema50Prev) * 100 : null;

  // ─── Momentum (3M primary, 1M noise-reduced) ───
  const mom1m = returnPercent(closes, 20);
  const mom3m = returnPercent(closes, 63);
  const mom6m = returnPercent(closes, 126);
  const mom9m = returnPercent(closes, 189);   // v4.0: LA señal del ranking
  const mom5d = returnPercent(closes, 5);

  // ─── ATR ───
  const atr = calculateAtr(bars, 14);
  const atrPercent = (atr && lastClose > 0) ? (atr / lastClose) * 100 : null;

  // ─── RVOL (direction-aware) ───
  const vol20     = volumes.slice(-20);
  const volPrev20 = volumes.slice(-40, -20);
  const avgVol20     = vol20.reduce((s, v) => s + v, 0) / Math.max(vol20.length, 1);
  const avgVolPrev20 = volPrev20.reduce((s, v) => s + v, 0) / Math.max(volPrev20.length, 1);
  const rvol = avgVolPrev20 > 0 ? avgVol20 / avgVolPrev20 : null;
  const avgValue20 = avgVol20 * lastClose;

  // ─── RS vs SPY (curve normalization, no artificial cap) ───
  const spyCloses = spyBars.map(b => b.close).filter(Number.isFinite);
  const rs3m = calculateRelativeReturn(closes, spyCloses, 63);
  const rs6m = calculateRelativeReturn(closes, spyCloses, 126);
  const rs5d = calculateRelativeReturn(closes, spyCloses, 5);

  // ─── 52W High Proximity ───
  const proximity52wScore = scoreProximity52w(lastClose, closes);
  const high52w = Math.max(...closes.slice(-Math.min(closes.length - 1, 252)));

  // ─── Score components ───
  const sRS      = scoreRS(rs3m, rs6m);
  const sMom     = scoreMomentum(mom1m, mom3m, mom6m);
  const sTrend   = scoreTrend(lastClose, ema20, ema50, ema20Slope, ema50Slope);
  const sProx52w = proximity52wScore;
  const sRvol    = scoreRvol(rvol, lastClose, ema5);
  const sAtr     = scoreAtr(atrPercent);
  const sLiq     = scoreLiquidity(avgValue20, spreadPercent, region);

  // v4.0: el momento a 9 meses ES el score. Sin 189 sesiones → DISCARD.
  if (!isFiniteNum(mom9m)) {
    return { ok: false, rallyScore: 0, label: "DISCARD", color: "#4b5563", blockedReasons: ["INSUFFICIENT_HISTORY_FOR_MOM9"], metrics: null };
  }

  const warningFlags = computeWarningFlags({ price: lastClose, ema20, ema50, mom1m, mom3m, rvol, rs5d });
  const entryTiming = computeEntryTiming(high52w > 0 ? lastClose / high52w : null);
  const runway = computeRunway(lastClose, closes, emaSeries(closes, 50), ema50, high52w > 0 ? lastClose / high52w : null);
  const finalScore = Math.round(clamp(50 + 50 * Math.tanh(mom9m / 75)));
  const rangeInfo = getRallyLabel(finalScore);
  // 15-ago-2026: el stop sugerido pasa a ser ADAPTATIVO POR FASE (ver suggestedStopPct).
  // La banda fija 25-35 por ATR (calculateTrailingStop) queda como referencia legacy.
  const trailingStop = suggestedStopPct(runway?.score);

  return {
    ok: true,
    rallyScore: finalScore,
    label: rangeInfo.label,
    color: rangeInfo.color,
    trailingStop, // optimal trailing stop % for this specific ticker
    warningFlags, // v3.0: ya no restan del score — se muestran explícitos
    entryTiming, // "¿es buen momento de entrar en ESTE ticker?" — validado, ver docstring
    runway,      // "¿cuánto recorrido le queda al rally?" — informativo, no reordena
    blockedReasons: [],
    metrics: {
      lastClose: Math.round(lastClose * 100) / 100,
      // Rentabilidad de la SESIÓN en el momento del scan: última barra vs barra
      // ADYACENTE anterior (null si la penúltima barra es inválida — nunca un %
      // multi-día disfrazado). Serie según proveedor: cierre AJUSTADO por splits y
      // dividendos en EODHD (adjusted_close), Yahoo (adjclose, con fallback al close
      // crudo si no viene) y TwelveData (adjust=all); crudo solo en Stooq (último
      // recurso). Con mercado cerrado = variación de la última sesión.
      // SOLO informativo para la fila del panel: no entra en score, stops ni pesos.
      dayChangePct,
      ema5:  ema5  ? Math.round(ema5  * 100) / 100 : null,
      ema20: ema20 ? Math.round(ema20 * 100) / 100 : null,
      ema50: ema50 ? Math.round(ema50 * 100) / 100 : null,
      // Number.isFinite (no truthiness): un valor LEGÍTIMO de 0 (RS/momentum exactamente
      // en línea con el SPY, pendiente EMA plana) no debe convertirse en null.
      ema20Slope: Number.isFinite(ema20Slope) ? Math.round(ema20Slope * 100) / 100 : null,
      ema50Slope: Number.isFinite(ema50Slope) ? Math.round(ema50Slope * 100) / 100 : null,
      rs3m: Number.isFinite(rs3m) ? Math.round(rs3m * 100) / 100 : null,
      rs6m: Number.isFinite(rs6m) ? Math.round(rs6m * 100) / 100 : null,
      rs5d: Number.isFinite(rs5d) ? Math.round(rs5d * 100) / 100 : null,
      mom1m: Number.isFinite(mom1m) ? Math.round(mom1m * 100) / 100 : null,
      mom3m: Number.isFinite(mom3m) ? Math.round(mom3m * 100) / 100 : null,
      mom6m: Number.isFinite(mom6m) ? Math.round(mom6m * 100) / 100 : null,
      mom9m: Number.isFinite(mom9m) ? Math.round(mom9m * 100) / 100 : null,
      rvol: Number.isFinite(rvol) ? Math.round(rvol * 100) / 100 : null,
      atrPercent: Number.isFinite(atrPercent) ? Math.round(atrPercent * 100) / 100 : null,
      trailingStop,
      avgValue20: Math.round(avgValue20),
      high52w: Math.round(high52w * 100) / 100,
      proximity52w: Math.round((lastClose / high52w) * 100) / 100,
      components: { sRS, sMom, sTrend, sProx52w, sRvol, sAtr, sLiq },
      version: RALLY_ENGINE_VERSION,
    },
  };
}

function calculateRelativeReturn(assetCloses, benchmarkCloses, lookback) {
  if (assetCloses.length < lookback + 1 || benchmarkCloses.length < lookback + 1) return null;
  const assetReturn = returnPercent(assetCloses, lookback);
  const benchReturn = returnPercent(benchmarkCloses, lookback);
  if (assetReturn === null || benchReturn === null) return null;
  return assetReturn - benchReturn;
}
