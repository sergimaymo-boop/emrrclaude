/**
 * GET /api/fear-greed
 * Calculates a Fear & Greed score (0–100) from market indicators:
 * VIX (35%), SPY change (20%), HYG change (20%), MOVE (15%), VVIX (10%)
 */

import { cascadeQuote } from "./_lib/providerCascade.js";

const RATING_LABELS = {
  EXTREME_FEAR: "Miedo Extremo",
  FEAR:         "Miedo",
  NEUTRAL:      "Neutral",
  GREED:        "Codicia",
  EXTREME_GREED:"Codicia Extrema",
};

function vixScore(vix) {
  if (vix < 12)  return 100;
  if (vix < 15)  return 80;
  if (vix < 20)  return 60;
  if (vix < 25)  return 35;
  return 10;
}

function spyScore(change) {
  if (change > 1)    return 90;
  if (change > 0.3)  return 70;
  if (change > 0)    return 55;
  if (change > -0.5) return 40;
  return 20;
}

function hygScore(change) {
  if (change > 0.2)  return 85;
  if (change > 0)    return 65;
  if (change < -0.3) return 20;
  return 35;
}

function moveScore(move) {
  // MOVE = bond volatility index
  // High MOVE (>110) = high volatility = FEAR (lower greed score)
  // Low MOVE (<70) = low volatility = COMPLACENCY (not true greed, but less fear)
  if (move < 70)  return 15;      // Low volatility = low fear
  if (move < 85)  return 30;
  if (move < 100) return 50;
  if (move < 115) return 70;
  return 90;                      // High volatility = high fear
}

function vvixScore(vvix) {
  if (vvix < 80)  return 90;
  if (vvix < 90)  return 70;
  if (vvix < 100) return 50;
  if (vvix < 110) return 35;
  return 15;
}

function toRating(score) {
  if (score <= 25) return "EXTREME_FEAR";
  if (score <= 45) return "FEAR";
  if (score <= 55) return "NEUTRAL";
  if (score <= 75) return "GREED";
  return "EXTREME_GREED";
}

export default async function handler(req, res) {
  try {
    const env = process.env;

    // Fetch all 5 indicators in parallel
    const [spyResult, vixResult, hygResult, moveResult, vvixResult] = await Promise.all([
      cascadeQuote("SPY.US",    env),
      cascadeQuote("VIX.INDX",  env),
      cascadeQuote("HYG.US",    env),
      cascadeQuote("MOVE.INDX", env),
      cascadeQuote("VVIX.INDX", env),
    ]);

    // Extract values — fall back to neutral if unavailable
    const vixValue  = vixResult.ok   ? vixResult.price      : null;
    const moveValue = moveResult.ok  ? moveResult.price     : null;
    const vvixValue = vvixResult.ok  ? vvixResult.price     : null;

    // For SPY/HYG: prefer changePercent, but if 0 (closed market) calculate from price/previousClose
    function resolveChange(result) {
      if (!result.ok) return null;
      const change = result.changePercent;
      if (change !== null && change !== 0) return change;
      // If change is 0 but we have price and previousClose, calculate it
      if (result.price && result.previousClose && result.previousClose !== 0) {
        return ((result.price - result.previousClose) / result.previousClose) * 100;
      }
      return change; // might be 0 or null
    }
    const spyChange = resolveChange(spyResult);
    const hygChange = resolveChange(hygResult);

    // Individual component scores (null = use neutral 50)
    const sVix  = vixValue  !== null ? vixScore(vixValue)   : 50;
    const sSpy  = spyChange !== null ? spyScore(spyChange)  : 50;
    const sHyg  = hygChange !== null ? hygScore(hygChange)  : 50;
    const sMove = moveValue !== null ? moveScore(moveValue) : 50;
    const sVvix = vvixValue !== null ? vvixScore(vvixValue) : 50;

    // Weighted composite (weights sum to 1.00)
    const rawScore = sVix * 0.35 + sSpy * 0.20 + sHyg * 0.20 + sMove * 0.15 + sVvix * 0.10;
    const score    = Math.round(rawScore);
    const rating   = toRating(score);
    const label    = RATING_LABELS[rating];

    res.status(200).json({
      ok: true,
      score,
      rating,
      label,
      components: {
        VIX:       vixValue  !== null ? Math.round(vixValue)   : null,
        SPY_chg:   spyChange !== null ? +spyChange.toFixed(2)  : null,
        HYG_chg:   hygChange !== null ? +hygChange.toFixed(2)  : null,
        MOVE:      moveValue !== null ? Math.round(moveValue)  : null,
        VVIX:      vvixValue !== null ? Math.round(vvixValue)  : null,
      },
      componentScores: { VIX: sVix, SPY: sSpy, HYG: sHyg, MOVE: sMove, VVIX: sVvix },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
