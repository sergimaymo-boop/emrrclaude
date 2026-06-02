export interface DynamicTrailingInput {
  atrPercent: number;
}

export interface DynamicTrailingResult {
  trailingAdjusted: number;
  trailingMedium: number;
  trailingWide: number;
}

const TRAILING_ADJUSTED_MULTIPLIER = 0.65;
const TRAILING_MEDIUM_MULTIPLIER = 1;
const TRAILING_WIDE_MULTIPLIER = 1.45;

function roundTrailingPercent(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function calculateDynamicTrailing({ atrPercent }: DynamicTrailingInput): DynamicTrailingResult {
  if (!Number.isFinite(atrPercent) || atrPercent <= 0) {
    throw new Error("ATR_PERCENT_INVALID");
  }

  return {
    trailingAdjusted: roundTrailingPercent(atrPercent * TRAILING_ADJUSTED_MULTIPLIER),
    trailingMedium: roundTrailingPercent(atrPercent * TRAILING_MEDIUM_MULTIPLIER),
    trailingWide: roundTrailingPercent(atrPercent * TRAILING_WIDE_MULTIPLIER),
  };
}

export function trailingEngineStub() {
  return "PHASE_5_DYNAMIC_TRAILING_ENGINE_READY_NO_OPERATIONAL_TRAILING";
}
