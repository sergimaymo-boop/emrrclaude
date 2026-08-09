/**
 * RALLY LEADERS ENGINE — Rally Score Engine v3.0 (validado con backtest, 9-ago-2026)
 *
 * v2.0 usaba pesos de literatura (O'Neil CAN SLIM, Minervini, Weinstein) que NUNCA se
 * habían contrastado con datos. Auditoría con 10 años / 603 tickers (docs/RALLY-MODULE-AUDIT.md,
 * scripts/rally-backtest-*.mjs): v2.0 tal cual RENTABILIDAD 14,0%/año, caída 44,9% — PIERDE
 * contra comprar y mantener el S&P 500 (15,6%/33,7%). Validado en 3 pasos: equivalencia
 * réplica↔producción, partición fuera de muestra (elegir el mejor del entrenamiento NO se
 * transfiere, rho=0,03 → se eligió por robustez) y control contra selección al azar (supera
 * 30/30 sorteos en ambas mitades del periodo, p≈0,032 — descarta sesgo de supervivencia).
 *
 *   Fuerza relativa   50% — RS 3M + RS 6M (normalización curva, sin techo artificial)
 *   Momento           50% — 3M principal (60%), 6M (30%), 1M filtrado de ruido (10%)
 *
 * Trend/Proximidad52s/RVOL/ATR/Liquidez SIGUEN CALCULÁNDOSE (se muestran en el panel para
 * contexto) pero YA NO puntúan: el backtest mostró que diluyen la señal.
 *
 * Las penalizaciones (extensión parabólica, precio bajo EMA50…) YA NO restan puntos del
 * ranking — el backtest mostró que recortaban justo a los líderes. Se devuelven como
 * `warningFlags` explícitos para que el panel las muestre sin distorsionar el orden.
 */

import { calculateEma, calculateAtr } from "./technicalEngine.js";

export const RALLY_ENGINE_VERSION = "3.0.0";

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
 * Optimal trailing stop % based on ATR (Average True Range).
 *
 * Institutional method (Wilder / Chandelier exit logic):
 * - Low volatility (ATR% < 1.5): tighter 2.0× multiplier — protect gains
 * - Normal volatility (1.5-3%): standard 2.5× multiplier
 * - High volatility (> 3%): wider 3.0× multiplier — avoid noise stop-outs
 *
 * Clamped to [5%, 18%] so it stays operationally meaningful.
 * Returns the % below the high at which to exit.
 */
function calculateTrailingStop(atrPercent) {
  if (!isFiniteNum(atrPercent) || atrPercent <= 0) return null;
  const atp = Math.abs(atrPercent);

  let multiplier;
  if (atp < 1.5) multiplier = 2.0;
  else if (atp <= 3.0) multiplier = 2.5;
  else multiplier = 3.0;

  const rawStop = atp * multiplier;
  // Operational bounds: never tighter than 5%, never wider than 18%
  return Math.round(clamp(rawStop, 5, 18) * 10) / 10;
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

export function calculateRallyScore({ bars, spyBars = [], spreadPercent = null, region = "USA" }) {
  const MIN_BARS = 130;

  if (!Array.isArray(bars) || bars.length < MIN_BARS) {
    return {
      ok: false, rallyScore: 0, label: "DISCARD", color: "#4b5563",
      blockedReasons: ["INSUFFICIENT_HISTORY_FOR_RALLY_SCORE"], metrics: null,
    };
  }

  const closes = bars.map(b => b.close).filter(Number.isFinite);
  const volumes = bars.map(b => b.volume ?? 0);
  const lastClose = closes[closes.length - 1];

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

  const rawScore =
    sRS      * WEIGHTS.relativeStrength +
    sMom     * WEIGHTS.momentum +
    sTrend   * WEIGHTS.trend +
    sProx52w * WEIGHTS.proximity52w +
    sRvol    * WEIGHTS.rvol +
    sAtr     * WEIGHTS.atr +
    sLiq     * WEIGHTS.liquiditySpread;

  const warningFlags = computeWarningFlags({ price: lastClose, ema20, ema50, mom1m, mom3m, rvol, rs5d });
  const entryTiming = computeEntryTiming(high52w > 0 ? lastClose / high52w : null);
  const finalScore = Math.round(clamp(rawScore));
  const rangeInfo = getRallyLabel(finalScore);
  const trailingStop = calculateTrailingStop(atrPercent);

  return {
    ok: true,
    rallyScore: finalScore,
    label: rangeInfo.label,
    color: rangeInfo.color,
    trailingStop, // optimal trailing stop % for this specific ticker
    warningFlags, // v3.0: ya no restan del score — se muestran explícitos
    entryTiming, // "¿es buen momento de entrar en ESTE ticker?" — validado, ver docstring
    blockedReasons: [],
    metrics: {
      lastClose: Math.round(lastClose * 100) / 100,
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
