const MIN_HISTORY_BARS = 61;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeBar(rawBar) {
  return {
    date: rawBar.date ?? rawBar.datetime ?? rawBar.timestamp ?? "",
    open: toNumber(rawBar.open),
    high: toNumber(rawBar.high),
    low: toNumber(rawBar.low),
    close: toNumber(rawBar.close ?? rawBar.adjusted_close),
    volume: toNumber(rawBar.volume),
  };
}

function hasValidOhlcv(bar) {
  return (
    Boolean(bar.date) &&
    isFiniteNumber(bar.open) &&
    isFiniteNumber(bar.high) &&
    isFiniteNumber(bar.low) &&
    isFiniteNumber(bar.close) &&
    isFiniteNumber(bar.volume) &&
    bar.open > 0 &&
    bar.high > 0 &&
    bar.low > 0 &&
    bar.close > 0 &&
    bar.volume >= 0 &&
    bar.high >= bar.low
  );
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateEma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = average(values.slice(0, period));
  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
  }
  return round(ema);
}

function calculateTrueRanges(bars) {
  return bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
}

export function calculateAtr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const trueRanges = calculateTrueRanges(bars);
  return average(trueRanges.slice(-period));
}

function percentChange(current, previous) {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function maxDrawdownPercent(closes) {
  let peak = closes[0];
  let maxDrawdown = 0;

  for (const close of closes) {
    if (close > peak) peak = close;
    const drawdown = peak === 0 ? 0 : ((peak - close) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

export function calculateTechnicals(rawBars, benchmarkRawBars = []) {
  const bars = Array.isArray(rawBars) ? rawBars.map(normalizeBar).filter(hasValidOhlcv) : [];
  const benchmarkBars = Array.isArray(benchmarkRawBars)
    ? benchmarkRawBars.map(normalizeBar).filter(hasValidOhlcv)
    : [];

  if (bars.length < MIN_HISTORY_BARS) {
    return {
      ok: false,
      dataQuality: "INSUFFICIENT_DATA",
      blockedReasons: ["INSUFFICIENT_HISTORY"],
      requiredBars: MIN_HISTORY_BARS,
      validBars: bars.length,
      technicals: null,
    };
  }

  const closes = bars.map((bar) => bar.close);
  const lastClose = closes.at(-1);
  const ema20 = calculateEma(closes, 20);
  const ema50 = calculateEma(closes, 50);
  const atr = calculateAtr(bars, 14);
  const atrPercent = atr === null ? null : percentChange(lastClose + atr, lastClose);
  const last20 = bars.slice(-20);
  const previous20 = bars.slice(-40, -20);
  const avgVolume20 = average(last20.map((bar) => bar.volume));
  const avgPreviousVolume20 = average(previous20.map((bar) => bar.volume));
  const avgValue20 = avgVolume20 === null ? null : avgVolume20 * lastClose;
  // If previous period volume is 0 or missing, use 1.0 (neutral — no volume amplification)
  // This avoids blocking European stocks where providers return 0 for older volume data
  const rvol = avgVolume20 === null
    ? null
    : (avgPreviousVolume20 === null || avgPreviousVolume20 === 0)
      ? 1.0
      : avgVolume20 / avgPreviousVolume20;
  const momentum5 = percentChange(lastClose, closes.at(-6));
  const momentum20 = percentChange(lastClose, closes.at(-21));
  const ema20Previous = calculateEma(closes.slice(0, -5), 20);
  const ema20SlopePercent = ema20 === null || ema20Previous === null ? null : percentChange(ema20, ema20Previous);
  const maxDrawdown20 = maxDrawdownPercent(closes.slice(-20));

  const benchmarkCloses = benchmarkBars.map((bar) => bar.close);
  const assetReturn20 = momentum20;
  const benchmarkReturn20 = benchmarkCloses.length >= 21
    ? percentChange(benchmarkCloses.at(-1), benchmarkCloses.at(-21))
    : null;
  const assetReturn60 = percentChange(lastClose, closes.at(-61));
  const benchmarkReturn60 = benchmarkCloses.length >= 61
    ? percentChange(benchmarkCloses.at(-1), benchmarkCloses.at(-61))
    : null;

  return {
    ok: true,
    dataQuality: "GOOD",
    blockedReasons: [],
    requiredBars: MIN_HISTORY_BARS,
    validBars: bars.length,
    technicals: {
      ema20,
      ema50,
      ema20SlopePercent: ema20SlopePercent === null ? null : round(ema20SlopePercent),
      atr: atr === null ? null : round(atr),
      atrPercent: atrPercent === null ? null : round(atrPercent),
      rvol: rvol === null ? null : round(rvol),
      momentum5: momentum5 === null ? null : round(momentum5),
      momentum20: momentum20 === null ? null : round(momentum20),
      rs20: assetReturn20 === null || benchmarkReturn20 === null ? null : round(assetReturn20 - benchmarkReturn20),
      rs60: assetReturn60 === null || benchmarkReturn60 === null ? null : round(assetReturn60 - benchmarkReturn60),
      avgVolume20: avgVolume20 === null ? null : round(avgVolume20, 0),
      avgValue20: avgValue20 === null ? null : round(avgValue20, 0),
      maxDrawdown20: round(maxDrawdown20),
      lastClose: round(lastClose),
      lastDate: bars.at(-1).date,
    },
  };
}
