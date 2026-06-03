/**
 * RALLY LEADERS ENGINE — Rally Score Engine v1.0
 *
 * Calculates rally score (0-100) based on:
 *   Relative Strength  35% — RS 3M + RS 6M vs SPY
 *   Momentum           25% — 1M + 3M + 6M price momentum
 *   Trend              20% — EMA20/50 structure + slopes
 *   RVOL               10% — volume confirmation
 *   ATR healthy         5% — volatility in sweet spot
 *   Liquidity/Spread    5% — execution quality
 *
 * Completely independent from EMRR TOP 8 scoring engine.
 * No tickers, no sectors, no fixed lists. Pure structure detection.
 */

import { calculateEma, calculateAtr } from "./technicalEngine.js";

const WEIGHTS = {
  relativeStrength: 0.35,
  momentum:         0.25,
  trend:            0.20,
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

function normalizeLinear(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 50;
  return clamp(((value - min) / (max - min)) * 100);
}

function isFinite(v) {
  return typeof v === "number" && Number.isFinite(v);
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
  // RS > 1.0 = outperforming market, premiate strongly
  const s3m = normalizeLinear(rs3m ?? 0, -30, 60); // -30% to +60% excess return
  const s6m = normalizeLinear(rs6m ?? 0, -40, 80);
  return s3m * 0.6 + s6m * 0.4;
}

function scoreMomentum(mom1m, mom3m, mom6m) {
  const s1m = normalizeLinear(mom1m ?? 0, -10, 20);
  const s3m = normalizeLinear(mom3m ?? 0, -15, 40);
  const s6m = normalizeLinear(mom6m ?? 0, -20, 60);
  return s1m * 0.30 + s3m * 0.40 + s6m * 0.30;
}

function scoreTrend(price, ema20, ema50, ema20Slope, ema50Slope) {
  let score = 0;
  if (isFinite(price) && isFinite(ema20) && price > ema20) score += 25;
  if (isFinite(ema20) && isFinite(ema50) && ema20 > ema50) score += 25;
  if (isFinite(ema20Slope) && ema20Slope > 0) score += 25;
  if (isFinite(ema50Slope) && ema50Slope > 0) score += 25;
  return score;
}

function scoreRvol(rvol) {
  if (!isFinite(rvol)) return 30;
  if (rvol >= 1.5) return 100;
  if (rvol >= 1.2) return 75;
  if (rvol >= 1.0) return 50;
  if (rvol >= 0.8) return 30;
  return 10;
}

function scoreAtr(atrPercent) {
  if (!isFinite(atrPercent)) return 30;
  const atp = Math.abs(atrPercent);
  if (atp >= 1.0 && atp <= 2.5) return 100; // sweet spot
  if (atp >= 0.5 && atp < 1.0) return 60;
  if (atp > 2.5 && atp <= 4.0) return 70;
  if (atp < 0.5) return 20; // too dead
  return 30; // too wild (> 4%)
}

function scoreLiquidity(avgValue20, spreadPercent, region) {
  const thresholds = region === "USA"
    ? { minValue: 10_000_000, maxSpread: 0.35 }
    : { minValue: 5_000_000, maxSpread: 0.50 };

  let score = 100;
  if (isFinite(avgValue20) && avgValue20 < thresholds.minValue) {
    score -= 50; // severe penalty for insufficient liquidity
  }
  if (isFinite(spreadPercent) && spreadPercent > thresholds.maxSpread) {
    score -= 40; // severe penalty for excessive spread
  }
  return clamp(score);
}

// ─── Penalties ───────────────────────────────────────────────────────────────

function applyPenalties(baseScore, metrics) {
  let penalty = 0;
  const { price, ema20, mom1m, mom3m, rvol, rs5d } = metrics;

  // Extreme extension above EMA20
  if (isFinite(price) && isFinite(ema20) && ema20 > 0) {
    const ext = (price - ema20) / ema20;
    if (ext > 0.25) penalty += 20;
    else if (ext > 0.15) penalty += 10;
  }

  // Vertical rally (parabolic 1M momentum)
  if (isFinite(mom1m) && mom1m > 30) penalty += 5;
  if (isFinite(mom1m) && mom1m > 50) penalty += 10;

  // Blow-off RVOL (distribution candles, not accumulation)
  if (isFinite(rvol) && rvol > 3.0) penalty += 10;

  // Recent weakness (5-day RS deterioration)
  if (isFinite(rs5d) && rs5d < -5) penalty += 5;
  if (isFinite(rs5d) && rs5d < -10) penalty += 5;

  // Recent momentum deterioration (3M momentum stalling short term)
  if (isFinite(mom3m) && isFinite(mom1m) && mom3m > 10 && mom1m < -3) penalty += 5;

  return clamp(baseScore - penalty);
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Calculate Rally Score for an asset.
 *
 * @param {object} params
 * @param {Array} params.bars           - Normalized OHLCV bars (sorted oldest→newest)
 * @param {Array} params.spyBars        - SPY benchmark bars (same format)
 * @param {number|null} params.spreadPercent
 * @param {string} params.region        - "USA" | "Europe"
 * @returns {{ ok, rallyScore, label, color, metrics, blockedReasons }}
 */
export function calculateRallyScore({ bars, spyBars = [], spreadPercent = null, region = "USA" }) {
  const MIN_BARS = 130; // need at least 6M of data for RS6M

  if (!Array.isArray(bars) || bars.length < MIN_BARS) {
    return {
      ok: false,
      rallyScore: 0,
      label: "DISCARD",
      color: "#4b5563",
      blockedReasons: ["INSUFFICIENT_HISTORY_FOR_RALLY_SCORE"],
      metrics: null,
    };
  }

  const closes = bars.map(b => b.close).filter(Number.isFinite);
  const volumes = bars.map(b => b.volume ?? 0);
  const lastClose = closes[closes.length - 1];

  if (!lastClose || lastClose <= 0) {
    return { ok: false, rallyScore: 0, label: "DISCARD", color: "#4b5563", blockedReasons: ["INVALID_CLOSE_PRICE"], metrics: null };
  }

  // ─── EMAs ───
  const ema20 = calculateEma(closes, 20);
  const ema50 = calculateEma(closes, 50);
  const ema20PrevSeries = emaSeries(closes.slice(0, -5), 20);
  const ema50PrevSeries = emaSeries(closes.slice(0, -5), 50);
  const ema20Prev = ema20PrevSeries.at(-1) ?? null;
  const ema50Prev = ema50PrevSeries.at(-1) ?? null;
  const ema20Slope = (isFinite(ema20) && isFinite(ema20Prev) && ema20Prev !== 0)
    ? ((ema20 - ema20Prev) / ema20Prev) * 100 : null;
  const ema50Slope = (isFinite(ema50) && isFinite(ema50Prev) && ema50Prev !== 0)
    ? ((ema50 - ema50Prev) / ema50Prev) * 100 : null;

  // ─── Momentum ───
  const mom1m  = returnPercent(closes, 20);  // ~1 month
  const mom3m  = returnPercent(closes, 63);  // ~3 months
  const mom6m  = returnPercent(closes, 126); // ~6 months
  const mom5d  = returnPercent(closes, 5);   // 5 days for penalty

  // ─── ATR ───
  const atr = calculateAtr(bars, 14);
  const atrPercent = (atr && lastClose > 0) ? (atr / lastClose) * 100 : null;

  // ─── RVOL ───
  const vol20 = volumes.slice(-20);
  const volPrev20 = volumes.slice(-40, -20);
  const avgVol20 = vol20.reduce((s, v) => s + v, 0) / Math.max(vol20.length, 1);
  const avgVolPrev20 = volPrev20.reduce((s, v) => s + v, 0) / Math.max(volPrev20.length, 1);
  const rvol = avgVolPrev20 > 0 ? avgVol20 / avgVolPrev20 : null;
  const avgValue20 = avgVol20 * lastClose;

  // ─── RS vs SPY ───
  const spyCloses = spyBars.map(b => b.close).filter(Number.isFinite);
  const rs3m = calculateRelativeStrength(closes, spyCloses, 63);
  const rs6m = calculateRelativeStrength(closes, spyCloses, 126);
  const rs5d = calculateRelativeStrength(closes, spyCloses, 5);

  // ─── Score components ───
  const sRS   = scoreRS(rs3m, rs6m);
  const sMom  = scoreMomentum(mom1m, mom3m, mom6m);
  const sTrend = scoreTrend(lastClose, ema20, ema50, ema20Slope, ema50Slope);
  const sRvol = scoreRvol(rvol);
  const sAtr  = scoreAtr(atrPercent);
  const sLiq  = scoreLiquidity(avgValue20, spreadPercent, region);

  const rawScore =
    sRS   * WEIGHTS.relativeStrength +
    sMom  * WEIGHTS.momentum +
    sTrend * WEIGHTS.trend +
    sRvol * WEIGHTS.rvol +
    sAtr  * WEIGHTS.atr +
    sLiq  * WEIGHTS.liquiditySpread;

  const penaltyMetrics = { price: lastClose, ema20, mom1m, mom3m, rvol, rs5d };
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
      ema20: ema20 ? Math.round(ema20 * 100) / 100 : null,
      ema50: ema50 ? Math.round(ema50 * 100) / 100 : null,
      ema20Slope: ema20Slope ? Math.round(ema20Slope * 100) / 100 : null,
      ema50Slope: ema50Slope ? Math.round(ema50Slope * 100) / 100 : null,
      rs3m: rs3m ? Math.round(rs3m * 100) / 100 : null,
      rs6m: rs6m ? Math.round(rs6m * 100) / 100 : null,
      mom1m: mom1m ? Math.round(mom1m * 100) / 100 : null,
      mom3m: mom3m ? Math.round(mom3m * 100) / 100 : null,
      mom6m: mom6m ? Math.round(mom6m * 100) / 100 : null,
      rvol: rvol ? Math.round(rvol * 100) / 100 : null,
      atrPercent: atrPercent ? Math.round(atrPercent * 100) / 100 : null,
      avgValue20: Math.round(avgValue20),
      components: { sRS, sMom, sTrend, sRvol, sAtr, sLiq },
    },
  };
}

function calculateRelativeStrength(assetCloses, benchmarkCloses, lookback) {
  if (assetCloses.length < lookback + 1 || benchmarkCloses.length < lookback + 1) return null;
  const assetReturn = returnPercent(assetCloses, lookback);
  const benchReturn = returnPercent(benchmarkCloses, lookback);
  if (assetReturn === null || benchReturn === null) return null;
  return assetReturn - benchReturn; // excess return over benchmark
}
