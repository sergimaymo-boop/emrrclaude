/**
 * RALLY LEADERS ENGINE — Rally Score Engine v2.0
 *
 * Upgraded formula based on institutional analysis best practices
 * (O'Neil CAN SLIM, Minervini, Weinstein Stage 2, Jegadeesh-Titman momentum):
 *
 *   Relative Strength  33% — RS 3M + RS 6M (percentile-curve normalization)
 *   Momentum           23% — 3M primary (60%), 6M (30%), 1M noise-filtered (10%)
 *   Trend              17% — EMA20/50 structure + slopes + Stage 2 filter
 *   52W High Proximity  7% — breakout proximity (key institutional signal)
 *   RVOL (directional) 10% — accumulation vs distribution aware
 *   ATR healthy         5% — volatility in sweet spot
 *   Liquidity/Spread    5% — execution quality
 *
 * Key improvements over v1.0:
 * - RS uses curve normalization — exceptional performers (RS>60%) now score higher
 * - Momentum 1M reduced to 10% (too noisy) — 3M raised to 60%
 * - RVOL is direction-aware: high volume on down price = distribution penalty
 * - 52W High Proximity added: breakouts near all-time highs score highest
 * - Total weights sum to exactly 1.0
 */

import { calculateEma, calculateAtr } from "./technicalEngine.js";

const WEIGHTS = {
  relativeStrength: 0.33,
  momentum:         0.23,
  trend:            0.17,
  proximity52w:     0.07,
  rvol:             0.10,
  atr:              0.05,
  liquiditySpread:  0.05,
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

function scoreLiquidity(avgValue20, spreadPercent, region) {
  const thresholds = region === "USA"
    ? { minValue: 10_000_000, maxSpread: 0.35 }
    : { minValue: 5_000_000, maxSpread: 0.50 };

  let score = 100;
  if (isFiniteNum(avgValue20) && avgValue20 < thresholds.minValue) score -= 50;
  if (isFiniteNum(spreadPercent) && spreadPercent > thresholds.maxSpread) score -= 40;
  return clamp(score);
}

// ─── Penalties ───────────────────────────────────────────────────────────────

function applyPenalties(baseScore, metrics) {
  let penalty = 0;
  const { price, ema20, ema50, mom1m, mom3m, rvol, rs5d } = metrics;

  // Extreme extension above EMA20 (parabolic — dangerous entry)
  if (isFiniteNum(price) && isFiniteNum(ema20) && ema20 > 0) {
    const ext = (price - ema20) / ema20;
    if (ext > 0.30) penalty += 25; // >30% above EMA20 = late-stage blow-off
    else if (ext > 0.20) penalty += 15;
    else if (ext > 0.15) penalty += 8;
  }

  // Price below EMA50 — broken trend structure (Stage 3/4)
  if (isFiniteNum(price) && isFiniteNum(ema50) && price < ema50) penalty += 20;

  // Parabolic 1M momentum — acceleration too steep, reversal risk high
  if (isFiniteNum(mom1m) && mom1m > 40) penalty += 10;
  if (isFiniteNum(mom1m) && mom1m > 60) penalty += 15;

  // Blow-off volume — distribution by institutions
  if (isFiniteNum(rvol) && rvol > 3.5) penalty += 15;

  // Recent RS deterioration (5-day)
  if (isFiniteNum(rs5d) && rs5d < -8) penalty += 8;
  if (isFiniteNum(rs5d) && rs5d < -15) penalty += 8;

  // Momentum divergence: strong 3M but stalling (1M deteriorating)
  if (isFiniteNum(mom3m) && isFiniteNum(mom1m) && mom3m > 15 && mom1m < -5) penalty += 8;

  return clamp(baseScore - penalty);
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

  const penaltyMetrics = { price: lastClose, ema20, ema50, mom1m, mom3m, rvol, rs5d };
  const finalScore = Math.round(applyPenalties(rawScore, penaltyMetrics));
  const rangeInfo = getRallyLabel(finalScore);

  return {
    ok: true,
    rallyScore: finalScore,
    label: rangeInfo.label,
    color: rangeInfo.color,
    blockedReasons: [],
    metrics: {
      lastClose: Math.round(lastClose * 100) / 100,
      ema5:  ema5  ? Math.round(ema5  * 100) / 100 : null,
      ema20: ema20 ? Math.round(ema20 * 100) / 100 : null,
      ema50: ema50 ? Math.round(ema50 * 100) / 100 : null,
      ema20Slope: ema20Slope ? Math.round(ema20Slope * 100) / 100 : null,
      ema50Slope: ema50Slope ? Math.round(ema50Slope * 100) / 100 : null,
      rs3m: rs3m ? Math.round(rs3m * 100) / 100 : null,
      rs6m: rs6m ? Math.round(rs6m * 100) / 100 : null,
      rs5d: rs5d ? Math.round(rs5d * 100) / 100 : null,
      mom1m: mom1m ? Math.round(mom1m * 100) / 100 : null,
      mom3m: mom3m ? Math.round(mom3m * 100) / 100 : null,
      mom6m: mom6m ? Math.round(mom6m * 100) / 100 : null,
      rvol: rvol ? Math.round(rvol * 100) / 100 : null,
      atrPercent: atrPercent ? Math.round(atrPercent * 100) / 100 : null,
      avgValue20: Math.round(avgValue20),
      high52w: Math.round(high52w * 100) / 100,
      proximity52w: Math.round((lastClose / high52w) * 100) / 100,
      components: { sRS, sMom, sTrend, sProx52w, sRvol, sAtr, sLiq },
      version: "2.0",
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
