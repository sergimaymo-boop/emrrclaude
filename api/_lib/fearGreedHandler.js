/**
 * GET /api/fear-greed
 * Primary source: CNN Business Fear & Greed Index (public dataviz feed) —
 * matches the reference value users compare against (cnn.com/markets/fear-and-greed).
 * Fallback (only if CNN is unreachable): internal composite calculated from
 * the SAME 7 market indicators shown in the "Master Indicators" panel —
 * VIX (25%), SPY (15%), HYG (15%), MOVE (15%), VVIX (10%), LQD (10%), TNX (10%)
 */

import { cascadeQuote } from "./providerCascade.js";

const RATING_LABELS = {
  EXTREME_FEAR: "Miedo Extremo",
  FEAR:         "Miedo",
  NEUTRAL:      "Neutral",
  GREED:        "Codicia",
  EXTREME_GREED:"Codicia Extrema",
};

const CNN_FNG_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const CNN_FETCH_TIMEOUT_MS = 6000;
const CNN_RATING_MAP = {
  "extreme fear": "EXTREME_FEAR",
  "fear":         "FEAR",
  "neutral":      "NEUTRAL",
  "greed":        "GREED",
  "extreme greed":"EXTREME_GREED",
};

async function fetchCnnFearGreed() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CNN_FETCH_TIMEOUT_MS);

  try {
    const providerResponse = await fetch(CNN_FNG_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        referer: "https://www.cnn.com/markets/fear-and-greed",
      },
      signal: controller.signal,
    });

    if (!providerResponse.ok) {
      return { ok: false, reason: `CNN feed returned HTTP ${providerResponse.status}.` };
    }

    const payload = await providerResponse.json();
    const fg = payload?.fear_and_greed;

    if (!fg || typeof fg.score !== "number" || !Number.isFinite(fg.score)) {
      return { ok: false, reason: "CNN feed payload missing a valid score." };
    }

    const ratingKey = CNN_RATING_MAP[String(fg.rating ?? "").trim().toLowerCase()] ?? toRating(Math.round(fg.score));

    return {
      ok: true,
      score: Math.round(fg.score),
      rawScore: fg.score,
      rating: ratingKey,
      label: RATING_LABELS[ratingKey],
      asOfUtc: typeof fg.timestamp === "string" ? fg.timestamp : null,
      previousClose: typeof fg.previous_close === "number" ? Math.round(fg.previous_close) : null,
    };
  } catch {
    return { ok: false, reason: "CNN feed request failed or timed out." };
  } finally {
    clearTimeout(timeout);
  }
}

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
  // MOVE = bond market volatility index — same fear/greed convention as VIX:
  // LOW MOVE = calm bond market = LESS fear → HIGH score (greed-leaning)
  // HIGH MOVE = stressed bond market = MORE fear → LOW score (fear-leaning)
  // (previous version had these buckets inverted — fixed to match VIX/VVIX direction)
  if (move < 70)  return 90;      // Low volatility = calm = less fear
  if (move < 85)  return 70;
  if (move < 100) return 50;
  if (move < 115) return 30;
  return 10;                      // High volatility = stress = more fear
}

function vvixScore(vvix) {
  if (vvix < 80)  return 90;
  if (vvix < 90)  return 70;
  if (vvix < 100) return 50;
  if (vvix < 110) return 35;
  return 15;
}

// Investment-grade credit ETF (LQD) — same "% change → risk-on score" convention as HYG,
// just with tighter thresholds (LQD typically moves less than high-yield credit)
function lqdScore(change) {
  if (change > 0.15) return 85;
  if (change > 0)    return 65;
  if (change < -0.2) return 20;
  return 35;
}

// 10Y Treasury yield (TNX) — large daily moves in either direction = macro stress = fear
// (small/calm moves = less fear → higher score), mirrors api/_lib/marketPulse.js::tnxScore
function tnxScore(changePercent) {
  const magnitude = Math.abs(changePercent);
  if (magnitude < 1) return 80;
  if (magnitude < 2) return 60;
  if (magnitude < 4) return 40;
  return 20;
}

function toRating(score) {
  if (score <= 25) return "EXTREME_FEAR";
  if (score <= 45) return "FEAR";
  if (score <= 55) return "NEUTRAL";
  if (score <= 75) return "GREED";
  return "EXTREME_GREED";
}

export async function handler(req, res) {
  // Indicador de mercado EN VIVO — nunca cachear (ni navegador ni edge).
  res.setHeader("Cache-Control", "no-store");
  try {
    const env = process.env;

    // Fetch the CNN reference index and all 7 internal indicators in parallel —
    // the SAME set (and symbols) shown in the "Master Indicators" panel, so the
    // breakdown displayed here is consistent with what the user sees there.
    const [cnnResult, spyResult, vixResult, hygResult, moveResult, vvixResult, lqdResult, tnxResult] = await Promise.all([
      fetchCnnFearGreed(),
      cascadeQuote("SPY.US",     env),
      cascadeQuote("VIX.INDX",   env),
      cascadeQuote("HYG.US",     env),
      cascadeQuote("MOVE.INDX",  env),
      cascadeQuote("VVIX.INDX",  env),
      cascadeQuote("LQD.US",     env),
      cascadeQuote("US10Y.GBOND",env),
    ]);

    // Extract values — fall back to neutral if unavailable
    const vixValue  = vixResult.ok   ? vixResult.price      : null;
    const moveValue = moveResult.ok  ? moveResult.price     : null;
    const vvixValue = vvixResult.ok  ? vvixResult.price     : null;

    // For SPY/HYG/LQD/TNX: prefer changePercent, but if 0 (closed market) calculate from price/previousClose
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
    const lqdChange = resolveChange(lqdResult);
    const tnxChange = resolveChange(tnxResult);

    // Individual component scores (null = use neutral 50)
    const sVix  = vixValue  !== null ? vixScore(vixValue)   : 50;
    const sSpy  = spyChange !== null ? spyScore(spyChange)  : 50;
    const sHyg  = hygChange !== null ? hygScore(hygChange)  : 50;
    const sMove = moveValue !== null ? moveScore(moveValue) : 50;
    const sVvix = vvixValue !== null ? vvixScore(vvixValue) : 50;
    const sLqd  = lqdChange !== null ? lqdScore(lqdChange)  : 50;
    const sTnx  = tnxChange !== null ? tnxScore(tnxChange)  : 50;

    // Weighted composite (weights sum to 1.00) — internal fallback / diagnostic reference.
    // Mirrors the 7 indicators of the Master Indicators panel (VIX/SPY/HYG/MOVE/VVIX/LQD/TNX).
    const internalRawScore =
      sVix  * 0.25 +
      sSpy  * 0.15 +
      sHyg  * 0.15 +
      sMove * 0.15 +
      sVvix * 0.10 +
      sLqd  * 0.10 +
      sTnx  * 0.10;
    const internalScore    = Math.round(internalRawScore);
    const internalRating   = toRating(internalScore);

    // Primary source: CNN Business Fear & Greed Index (the reference value users compare against).
    // Fall back to the internal composite ONLY when the CNN feed is unreachable.
    const useCnn = cnnResult.ok;
    const score  = useCnn ? cnnResult.score  : internalScore;
    const rating = useCnn ? cnnResult.rating : internalRating;
    const label  = RATING_LABELS[rating];

    res.status(200).json({
      ok: true,
      score,
      rating,
      label,
      source: useCnn ? "CNN_BUSINESS" : "INTERNAL_COMPOSITE_FALLBACK",
      sourceLabel: useCnn
        ? "Fuente: CNN Business — Índice de Miedo y Codicia"
        : "Fuente: composite interno (CNN no disponible)",
      cnnAsOfUtc: useCnn ? cnnResult.asOfUtc : null,
      cnnPreviousClose: useCnn ? cnnResult.previousClose : null,
      cnnFeedStatus: useCnn ? "OK" : `UNAVAILABLE (${cnnResult.reason})`,
      components: {
        VIX:       vixValue  !== null ? Math.round(vixValue)   : null,
        SPY_chg:   spyChange !== null ? +spyChange.toFixed(2)  : null,
        HYG_chg:   hygChange !== null ? +hygChange.toFixed(2)  : null,
        MOVE:      moveValue !== null ? Math.round(moveValue)  : null,
        VVIX:      vvixValue !== null ? Math.round(vvixValue)  : null,
        LQD_chg:   lqdChange !== null ? +lqdChange.toFixed(2)  : null,
        TNX_chg:   tnxChange !== null ? +tnxChange.toFixed(2)  : null,
      },
      componentScores: { VIX: sVix, SPY: sSpy, HYG: sHyg, MOVE: sMove, VVIX: sVvix, LQD: sLqd, TNX: sTnx },
      internalScore,
      internalRating,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}
