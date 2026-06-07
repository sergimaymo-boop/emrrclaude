import type { Top8Asset } from "../types";
import type { RallyState } from "../services/rallyRefresh";

/**
 * Pullback Risk Indicator — semaphore for the current "Ticket Perfecto" candidate.
 *
 * NOT the market regime (that's the EMA200-based "Régimen Alcista/Bajista" block).
 * This evaluates whether the SPECIFIC candidate stock (the RALLY ∩ TOP8 intersection)
 * is showing early warning signs of an imminent pullback / pinpoint drop —
 * using only technicals already computed by the scan engines (no extra API calls):
 *
 *   1) Extension above EMA20      — overextended price → mean-reversion risk
 *   2) Momentum divergence        — weak/negative momentum despite high rank
 *   3) Volume confirmation (RVOL) — rally without volume support → fragile
 *   4) Volatility (ATR%)          — higher ATR → bigger/faster potential drop
 *   5) Existing risk classification (LOW/MEDIUM/HIGH from scoreEngine)
 *
 * Output: LOW (verde) / MEDIUM (ámbar) / HIGH (rojo) pullback-risk semaphore.
 */

export interface PullbackRisk {
  level: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  reasons: string[];
  ticker: string;
}

function toNumber(value: unknown): number | null {
  const parsed = parseFloat(String(value ?? "").replace("%", "").replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Re-derives the RALLY ∩ TOP8 intersection candidate (mirrors OptimalSignalPanel's
// "intersection-first" search) — duplicated intentionally to keep this indicator
// fully isolated from the Ticket Perfecto evaluation (zero risk of cross-breakage).
function findCandidateAsset(rallyState: RallyState, top8: Top8Asset[]): Top8Asset | null {
  const rallyDone = rallyState.status === "RALLY_FINAL" || rallyState.status === "RALLY_PARTIAL_DIAGNOSTIC";
  if (!rallyDone || top8.length === 0) return null;

  const rallyLeaders = rallyState.top10 ?? [];
  let best: { asset: Top8Asset; score: number } | null = null;

  for (const leader of rallyLeaders) {
    const match = top8.find((a) => a.ticker === leader.ticker);
    if (match) {
      const s = toNumber(match.score) ?? 0;
      if (s >= 75 && (!best || s > best.score)) {
        best = { asset: match, score: s };
      }
    }
  }

  return best?.asset ?? null;
}

export function evaluatePullbackRisk(asset: Top8Asset): PullbackRisk {
  const price       = toNumber(asset.price);
  const ema20       = toNumber(asset.ema20);
  const momentum    = toNumber(asset.momentum);
  const rvol        = toNumber(asset.rvol);
  const atrPercent  = toNumber(asset.atrPercent);

  const reasons: string[] = [];
  let score = 0;

  // 1) Extension above EMA20 (weight ~30) — mean-reversion / pinpoint-drop risk
  const extension = price !== null && ema20 !== null && ema20 !== 0
    ? ((price - ema20) / ema20) * 100
    : null;
  if (extension !== null) {
    if (extension > 10) { score += 30; reasons.push(`Precio extendido +${extension.toFixed(1)}% sobre EMA20 (sobrecompra)`); }
    else if (extension > 6) { score += 18; reasons.push(`Algo extendido sobre EMA20 (+${extension.toFixed(1)}%)`); }
    else if (extension > 3) { score += 8; }
  }

  // 2) Momentum divergence (weight ~25) — weak/negative momentum despite top rank
  if (momentum !== null) {
    if (momentum < 0) { score += 25; reasons.push(`Momentum negativo (${momentum.toFixed(1)}%) — posible agotamiento`); }
    else if (momentum < 3) { score += 12; reasons.push(`Momentum débil (${momentum.toFixed(1)}%)`); }
  }

  // 3) Volume confirmation (weight ~20) — rally without volume = fragile
  if (rvol !== null) {
    if (rvol < 0.8) { score += 20; reasons.push(`Volumen relativo bajo (RVOL ${rvol.toFixed(2)}) — sin respaldo`); }
    else if (rvol < 1) { score += 10; }
  }

  // 4) Volatility (weight ~15) — higher ATR = bigger/faster potential drop
  if (atrPercent !== null) {
    if (atrPercent > 6) { score += 15; reasons.push(`Volatilidad elevada (ATR ${atrPercent.toFixed(1)}%)`); }
    else if (atrPercent > 4) { score += 8; }
  }

  // 5) Existing risk classification (weight ~10)
  if (asset.risk === "HIGH") { score += 10; reasons.push("Clasificación de riesgo del motor: ALTO"); }
  else if (asset.risk === "MEDIUM") { score += 5; }

  const level: PullbackRisk["level"] = score >= 55 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";

  return { level, score: Math.round(score), reasons, ticker: asset.ticker };
}

const LEVEL_META = {
  LOW:    { color: "#10b981", bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)",  label: "Sin señales de pullback inminente" },
  MEDIUM: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  label: "Vigilar — señales mixtas de agotamiento" },
  HIGH:   { color: "#ef4444", bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   label: "Riesgo de pullback / corrección cercana" },
} as const;

export function PullbackRiskIndicator({ rallyState, top8 }: { rallyState: RallyState; top8: Top8Asset[] }) {
  const candidate = findCandidateAsset(rallyState, top8);
  if (!candidate) return null;

  const risk = evaluatePullbackRisk(candidate);
  const meta = LEVEL_META[risk.level];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 4,
      padding: "8px 16px",
      margin: "0 0 4px",
      borderRadius: 12,
      background: meta.bg,
      border: `1px solid ${meta.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span style={{
          width: 10, height: 10, borderRadius: "50%",
          background: meta.color, boxShadow: `0 0 10px ${meta.color}`,
        }} />
        <span style={{
          fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: meta.color,
        }}>
          Pullback {risk.ticker} · {meta.label}
        </span>
      </div>
      {risk.reasons.length > 0 && (
        <div style={{ fontSize: 9, color: "#64748b", textAlign: "center", lineHeight: 1.5 }}>
          {risk.reasons.join("  ·  ")}
        </div>
      )}
    </div>
  );
}
