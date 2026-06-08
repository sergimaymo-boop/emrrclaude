/**
 * Monetary Cycle Classifier
 *
 * Clasifica el ciclo monetario actual de la Fed como:
 *   EASING     — tipos bajando, credit spreads cerrándose → favorable para momentum
 *   NEUTRAL    — estabilidad, sin señal direccional clara
 *   TIGHTENING — tipos subiendo, credit spreads abriéndose → riesgo whipsaw elevado
 *
 * Usa datos ya disponibles en el sistema (TNX, HYG, VIX, MOVE).
 * No hace llamadas API — cálculo puro sobre señales de mercado.
 */

/**
 * @param {Object} signals
 * @param {number|null} signals.tnxChangePercent   — % cambio diario yield 10Y
 * @param {number|null} signals.hygChangePercent   — % cambio diario HYG (high yield bonds)
 * @param {number|null} signals.vixLevel           — nivel absoluto VIX
 * @param {number|null} signals.moveLevel          — nivel absoluto MOVE (vol bonos)
 * @returns {{ phase, score, label, signals, rallyScoreAdjustment, hasData }}
 */
export function classifyMonetaryCycle({ tnxChangePercent, hygChangePercent, vixLevel, moveLevel } = {}) {
  let easingPts = 0;
  let tighteningPts = 0;
  const signalDetails = [];

  // ── TNX (yield 10Y) — peso 40% ─────────────────────────────────────────────
  // Yield bajando → dinero barato → easing. Yield subiendo → encarecimiento → tightening.
  if (typeof tnxChangePercent === 'number' && isFinite(tnxChangePercent)) {
    if (tnxChangePercent <= -1.5) {
      easingPts += 40;
      signalDetails.push({ key: 'TNX', label: `Yields cayendo fuerte (${tnxChangePercent.toFixed(2)}%)`, dir: 'easing' });
    } else if (tnxChangePercent <= -0.4) {
      easingPts += 22;
      signalDetails.push({ key: 'TNX', label: `Yields bajando (${tnxChangePercent.toFixed(2)}%)`, dir: 'mild_easing' });
    } else if (tnxChangePercent >= 1.5) {
      tighteningPts += 40;
      signalDetails.push({ key: 'TNX', label: `Yields subiendo fuerte (${tnxChangePercent.toFixed(2)}%)`, dir: 'tightening' });
    } else if (tnxChangePercent >= 0.4) {
      tighteningPts += 22;
      signalDetails.push({ key: 'TNX', label: `Yields subiendo (${tnxChangePercent.toFixed(2)}%)`, dir: 'mild_tightening' });
    } else {
      signalDetails.push({ key: 'TNX', label: `Yields estables (${tnxChangePercent.toFixed(2)}%)`, dir: 'neutral' });
    }
  }

  // ── HYG (high yield bond ETF) — peso 30% ──────────────────────────────────
  // HYG subiendo → crédito sano → easing. HYG cayendo → estrés crediticio → tightening.
  if (typeof hygChangePercent === 'number' && isFinite(hygChangePercent)) {
    if (hygChangePercent >= 0.4) {
      easingPts += 30;
      signalDetails.push({ key: 'HYG', label: `Crédito mejorando (${hygChangePercent.toFixed(2)}%)`, dir: 'easing' });
    } else if (hygChangePercent >= 0.1) {
      easingPts += 15;
      signalDetails.push({ key: 'HYG', label: `Crédito positivo (${hygChangePercent.toFixed(2)}%)`, dir: 'mild_easing' });
    } else if (hygChangePercent <= -0.4) {
      tighteningPts += 30;
      signalDetails.push({ key: 'HYG', label: `Crédito bajo presión (${hygChangePercent.toFixed(2)}%)`, dir: 'tightening' });
    } else if (hygChangePercent <= -0.1) {
      tighteningPts += 15;
      signalDetails.push({ key: 'HYG', label: `Crédito ligeramente negativo (${hygChangePercent.toFixed(2)}%)`, dir: 'mild_tightening' });
    } else {
      signalDetails.push({ key: 'HYG', label: `Crédito neutral (${hygChangePercent.toFixed(2)}%)`, dir: 'neutral' });
    }
  }

  // ── VIX (volatilidad mercado) — peso 20% ──────────────────────────────────
  if (typeof vixLevel === 'number' && isFinite(vixLevel)) {
    if (vixLevel < 15) {
      easingPts += 20;
      signalDetails.push({ key: 'VIX', label: `VIX bajo (${vixLevel.toFixed(1)})`, dir: 'easing' });
    } else if (vixLevel < 20) {
      easingPts += 10;
      signalDetails.push({ key: 'VIX', label: `VIX normal (${vixLevel.toFixed(1)})`, dir: 'mild_easing' });
    } else if (vixLevel > 30) {
      tighteningPts += 20;
      signalDetails.push({ key: 'VIX', label: `VIX elevado (${vixLevel.toFixed(1)})`, dir: 'tightening' });
    } else if (vixLevel > 22) {
      tighteningPts += 10;
      signalDetails.push({ key: 'VIX', label: `VIX en alza (${vixLevel.toFixed(1)})`, dir: 'mild_tightening' });
    } else {
      signalDetails.push({ key: 'VIX', label: `VIX moderado (${vixLevel.toFixed(1)})`, dir: 'neutral' });
    }
  }

  // ── MOVE (volatilidad bonos) — peso 10% ──────────────────────────────────
  // Mid-tier added: MOVE 110–130 now contributes 5 tighteningPts instead of 0,
  // activating the weight in the most common elevated-vol zone (100–130) that
  // was previously a blind spot (audit finding: weight was cosmetic).
  if (typeof moveLevel === 'number' && isFinite(moveLevel)) {
    if (moveLevel < 90) {
      easingPts += 10;
      signalDetails.push({ key: 'MOVE', label: `MOVE bajo (${moveLevel.toFixed(0)})`, dir: 'easing' });
    } else if (moveLevel > 130) {
      tighteningPts += 10;
      signalDetails.push({ key: 'MOVE', label: `MOVE elevado (${moveLevel.toFixed(0)})`, dir: 'tightening' });
    } else if (moveLevel > 110) {
      tighteningPts += 5;
      signalDetails.push({ key: 'MOVE', label: `MOVE en alza (${moveLevel.toFixed(0)})`, dir: 'mild_tightening' });
    } else {
      signalDetails.push({ key: 'MOVE', label: `MOVE normal (${moveLevel.toFixed(0)})`, dir: 'neutral' });
    }
  }

  // ── Clasificación ──────────────────────────────────────────────────────────
  const net = easingPts - tighteningPts;
  let phase;
  let score; // 0 = restrictivo extremo, 50 = neutral, 100 = expansivo extremo

  if (net >= 28) {
    phase = 'EASING';
    score = Math.min(100, 50 + net);
  } else if (net <= -28) {
    phase = 'TIGHTENING';
    score = Math.max(0, 50 + net);
  } else {
    phase = 'NEUTRAL';
    score = Math.max(0, Math.min(100, 50 + net));
  }

  const label = phase === 'EASING'
    ? 'Ciclo Expansivo'
    : phase === 'TIGHTENING'
    ? 'Ciclo Restrictivo'
    : 'Ciclo Neutral';

  const color = phase === 'EASING' ? '#10b981'
    : phase === 'TIGHTENING' ? '#f59e0b'
    : '#64748b';

  // Ajuste sobre el rallyScore: entorno restrictivo reduce la señal de entrada
  // para evitar whipsaw repetido durante transiciones de tipo (2022-style).
  const rallyScoreAdjustment = phase === 'TIGHTENING' ? -8 : phase === 'EASING' ? +3 : 0;

  return {
    phase,
    score,
    label,
    color,
    signals: signalDetails,
    rallyScoreAdjustment,
    hasData: signalDetails.length > 0,
  };
}
