/**
 * Market Pulse — shared scoring for the daily Telegram entry semaphore.
 *
 * Combines THREE independent signals into one binary decision (GREEN/RED):
 *   1) Market Regime        — SPY vs EMA200 (institutional: "even the best
 *                             rallies fail in a bearish regime" → hard override)
 *   2) Master Indicators    — weighted composite (NOT all 6 weigh the same):
 *                             VIX 30% · MOVE 20% · HYG 20% · VVIX 15% · TNX 10% · LQD 5%
 *   3) Broad-market pullback risk — same methodology as the dashboard's
 *                             per-stock Pullback Risk Indicator, applied to the
 *                             S&P 500 benchmark (extension over EMA20, momentum,
 *                             RVOL, ATR%) — works without requiring a manual SCAN.
 */

// ── 1) Master Indicators — weighted composite ──────────────────────────────
export const INDICATOR_WEIGHTS = Object.freeze({ VIX: 0.30, MOVE: 0.20, HYG: 0.20, VVIX: 0.15, TNX: 0.10, LQD: 0.05 });

function vixScore(v) {
  if (v == null) return 50;
  if (v < 12) return 100;
  if (v < 15) return 80;
  if (v < 20) return 60;
  if (v < 25) return 35;
  return 10;
}

function moveScore(v) {
  if (v == null) return 50;
  if (v < 70) return 85;
  if (v < 85) return 70;
  if (v < 100) return 50;
  if (v < 115) return 30;
  return 10;
}

function vvixScore(v) {
  if (v == null) return 50;
  if (v < 80) return 90;
  if (v < 90) return 70;
  if (v < 100) return 50;
  if (v < 110) return 35;
  return 15;
}

// Generic "% change → risk-on score" for credit ETFs (HYG / LQD)
function creditChangeScore(changePercent, { strong, weak } = { strong: 0.2, weak: -0.3 }) {
  if (changePercent == null) return 50;
  if (changePercent > strong) return 85;
  if (changePercent > 0) return 65;
  if (changePercent > weak) return 40;
  return 20;
}

// 10Y yield — large daily moves (either direction) = macro stress; small = calm
function tnxScore(changePercent) {
  if (changePercent == null) return 50;
  const magnitude = Math.abs(changePercent);
  if (magnitude < 1) return 80;
  if (magnitude < 2) return 60;
  if (magnitude < 4) return 40;
  return 20;
}

/**
 * @param {{vix:number|null, move:number|null, vvix:number|null,
 *          hygChangePercent:number|null, lqdChangePercent:number|null, tnxChangePercent:number|null}} values
 */
export function computeIndicatorsComposite(values) {
  const scores = {
    VIX:  vixScore(values.vix),
    MOVE: moveScore(values.move),
    HYG:  creditChangeScore(values.hygChangePercent, { strong: 0.2, weak: -0.3 }),
    VVIX: vvixScore(values.vvix),
    TNX:  tnxScore(values.tnxChangePercent),
    LQD:  creditChangeScore(values.lqdChangePercent, { strong: 0.15, weak: -0.2 }),
  };

  let composite = 0;
  for (const [key, weight] of Object.entries(INDICATOR_WEIGHTS)) {
    composite += scores[key] * weight;
  }

  return { composite: Math.round(composite), scores, weights: INDICATOR_WEIGHTS };
}

export function indicatorsLabel(composite) {
  if (composite >= 70) return "Calma / apetito de riesgo";
  if (composite >= 50) return "Neutral";
  if (composite >= 35) return "Cautela / estrés moderado";
  return "Estrés elevado";
}

// ── 2) Broad-market pullback risk (S&P 500 / SPY) ──────────────────────────
// Mirrors PullbackRiskIndicator.tsx methodology — adapted for benchmark-level
// thresholds (SPY moves far less than individual high-beta stocks).
export function computeBroadMarketPullbackRisk(technicals) {
  if (!technicals) return { level: "UNKNOWN", score: 50, reasons: [] };

  const { ema20, atrPercent, rvol, momentum20, lastClose } = technicals;
  const reasons = [];
  let score = 0;

  const extension = (lastClose != null && ema20 != null && ema20 !== 0)
    ? ((lastClose - ema20) / ema20) * 100
    : null;
  if (extension !== null) {
    if (extension > 6) { score += 30; reasons.push(`S&P 500 extendido +${extension.toFixed(1)}% sobre su EMA20`); }
    else if (extension > 3) { score += 16; reasons.push(`S&P 500 algo extendido (+${extension.toFixed(1)}% sobre EMA20)`); }
    else if (extension > 1.5) { score += 6; }
  }

  if (momentum20 != null) {
    if (momentum20 < 0) { score += 25; reasons.push(`Momentum 20 sesiones negativo (${momentum20.toFixed(1)}%)`); }
    else if (momentum20 < 2) { score += 10; }
  }

  if (rvol != null) {
    if (rvol < 0.8) { score += 20; reasons.push(`Volumen relativo bajo (RVOL ${rvol.toFixed(2)})`); }
    else if (rvol < 1) { score += 8; }
  }

  if (atrPercent != null) {
    if (atrPercent > 2) { score += 15; reasons.push(`Volatilidad del índice elevada (ATR ${atrPercent.toFixed(1)}%)`); }
    else if (atrPercent > 1.3) { score += 6; }
  }

  const level = score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  return { level, score: Math.round(score), reasons };
}

export function pullbackLabel(level) {
  if (level === "HIGH") return "ALTO — señales de agotamiento";
  if (level === "MEDIUM") return "MODERADO — vigilar";
  if (level === "LOW") return "BAJO";
  return "SIN DATOS";
}

// ── 3) Final binary semaphore ───────────────────────────────────────────────
/**
 * @param {{regime:"BULLISH"|"BEARISH"|"UNKNOWN", indicatorsComposite:number, pullbackRisk:{score:number}}} input
 */
export function computeEntrySemaphore({ regime, indicatorsComposite, pullbackRisk }) {
  const regimeScore = regime === "BULLISH" ? 100 : regime === "BEARISH" ? 0 : 50;
  const pullbackScoreInverted = 100 - (pullbackRisk?.score ?? 50);

  // Weights: regime 40% (dominant — institutional gate), indicators 35%, pullback 25%
  const composite = Math.round(regimeScore * 0.40 + indicatorsComposite * 0.35 + pullbackScoreInverted * 0.25);

  // Hard override: a bearish regime always forces RED — "even the best rallies fail"
  const signal = regime === "BEARISH" ? "RED" : (composite >= 55 ? "GREEN" : "RED");

  return { signal, composite, regimeScore, pullbackScoreInverted };
}

// ── Semáforo SOLO-INDICADORES (para el aviso de Telegram) ───────────────────
// Decisión binaria invertir/esperar basada EXCLUSIVAMENTE en el composite ponderado
// de los 6 indicadores de mercado en tiempo real (VIX·MOVE·HYG·VVIX·TNX·LQD), sin
// régimen SPY ni pullback (no requiere scan). Umbral 55: por encima de neutral (50)
// para no entrar en la duda — criterio prudente de gestión de riesgo.
export function computeIndicatorsSemaphore(composite) {
  return { signal: composite >= 55 ? "GREEN" : "RED", composite };
}

// Veredicto visual por indicador según su sub-score 0-100.
export function indicatorVerdict(score) {
  if (score >= 65) return { emoji: "🟢", tone: "favorable" };
  if (score >= 40) return { emoji: "🟡", tone: "neutral" };
  return { emoji: "🔴", tone: "adverso" };
}

// Análisis tipo "mejor inversor del mundo" — interpreta el conjunto de los 6
// indicadores y da la conclusión accionable (invertir / esperar).
export function investorAnalysis(composite, signal) {
  if (signal === "GREEN") {
    if (composite >= 72) {
      return "Entorno de bajo riesgo: volatilidad contenida y crédito sólido. Las condiciones acompañan para mantener o abrir exposición a renta variable.";
    }
    return "Predominan las señales de apetito de riesgo, con algún foco de tensión puntual. Contexto favorable para entrar de forma selectiva y con stop de protección.";
  }
  if (composite >= 45) {
    return "Señales encontradas con sesgo de cautela: el binomio riesgo/recompensa no compensa hoy. Prudente esperar confirmación antes de exponerse.";
  }
  return "Estrés de mercado: volatilidad elevada y/o deterioro del crédito. Lo prudente es esperar fuera del mercado hasta que las condiciones mejoren.";
}
