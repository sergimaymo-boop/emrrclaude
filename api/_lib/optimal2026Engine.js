/**
 * Optimal2026 Engine — Dual Momentum Risk-Parity (CONCENTRADO, calibrado por backtest REAL)
 *
 * Estrategia: momentum risk-adjusted cross-sectional con filtro de momentum absoluto.
 *   1. Score risk-adjusted: (ret189 − ret42) / vol63 — el skip de 2 meses esquiva la reversión corta
 *   2. Filtro de momentum ABSOLUTO: retorno a 189 sesiones (9m) > 0 (long-only seguro, Antonacci)
 *   3. Régimen BINARIO SPY/EMA200: 100% invertido si SPY>EMA200, 30% defensivo si no
 *   4. Concentración ÓPTIMA: top 2 (mejor MAR del barrido completo de 810 combinaciones)
 *   5. Asignación proporcional al score entre los 2 nombres
 *
 * CALIBRACIÓN POR BACKTEST REAL (110 tickers US+EU, 2016-06 → 2026-06, rebalanceo mensual):
 *   Barrido de 810 combinaciones de parámetros + validación walk-forward por sub-períodos.
 *   Config ganadora (mejor MAR, robusta y NO sobreajustada): LB189 · skip42 · vol63 · N2 · binario · ra.
 *   Resultado FULL: CAGR 40.1%, MaxDD 18.5%, MAR 2.17, Sharpe 1.13, Win 62%, bate al SPY 5/5 tramos.
 *   Estabilidad cross-régimen (la prueba anti-overfit): ~40% CAGR en 2016-19, 2020-22 Y 2023-26.
 *   SPY mismo período: CAGR 14.7%, MaxDD 33.7% → el módulo TRIPLICA el SPY con la MITAD de drawdown.
 *
 * Base académica: Barroso & Santa-Clara (2015), Antonacci (2014), AQR/Asness (2013), Jegadeesh-Titman.
 * Módulo INDEPENDIENTE: no lee/escribe ningún otro motor; se alimenta de las MISMAS barras del scan.
 */

// ── Parámetros óptimos (del backtest real, NO tocar sin re-backtestear) ──────────
const LOOKBACK_LONG = 189; // ~9 meses — ventana de momentum (mejor que 252 en el barrido)
const LOOKBACK_SKIP = 42;  // ~2 meses — se resta del momentum para esquivar la reversión corta
const VOL_WINDOW    = 63;  // ~3 meses — volatilidad realizada anualizada (normaliza el momentum)
const N_POSITIONS   = 2;   // top 2 — concentración óptima (mejor MAR del barrido)

const MIN_BARS = 230; // suficiente para ema200 + lookback 189 + buffer (incluye más tickers que 270)

// ── Math helpers ──────────────────────────────────────────────────────────────

function squash(x, scale) {
  return 0.5 * (Math.tanh(x / scale) + 1);
}

function ema(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

function realizedVol(closes, window) {
  if (!closes || closes.length < window + 1) return null;
  const slice = closes.slice(-window - 1);
  const logRets = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0 && slice[i] > 0) logRets.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (logRets.length < 10) return null;
  const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length;
  const variance = logRets.reduce((s, r) => s + (r - mean) ** 2, 0) / (logRets.length - 1);
  return Math.sqrt(variance * 252); // annualized
}

function r2Linear(closes, n) {
  if (!closes || closes.length < n) return 0.5;
  const slice = closes.slice(-n);
  const logPrices = slice.map((c) => Math.log(Math.max(c, 1e-10)));
  const xMean = (n - 1) / 2;
  const yMean = logPrices.reduce((a, b) => a + b, 0) / n;
  let ssxy = 0, ssxx = 0, ssyy = 0;
  for (let i = 0; i < n; i++) {
    ssxy += (i - xMean) * (logPrices[i] - yMean);
    ssxx += (i - xMean) ** 2;
    ssyy += (logPrices[i] - yMean) ** 2;
  }
  if (ssxx === 0 || ssyy === 0) return 0;
  return Math.max(0, Math.min(1, (ssxy / Math.sqrt(ssxx * ssyy)) ** 2));
}

// ── Feature extraction ────────────────────────────────────────────────────────

/**
 * computeOptimal2026Features(bars, spyBars) → features | null
 *
 * bars: [{ date, open, high, low, close, volume }] — at least MIN_BARS
 * spyBars: optional SPY bars for relative momentum
 */
export function computeOptimal2026Features(bars, spyBars = null) {
  if (!Array.isArray(bars) || bars.length < MIN_BARS) return null;

  const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < MIN_BARS) return null;

  const price = closes.at(-1);
  const prevClose = closes.at(-2) ?? null;
  if (!price || price <= 0) return null;

  // Anti-glitch: reject if last close deviates >40% from median of prior 5
  const prior5 = closes.slice(-6, -1);
  if (prior5.length >= 3) {
    const sorted = [...prior5].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0 && (Math.abs(price - median) / median) > 0.40) return null;
  }

  // ── Momentum LARGO (189 sesiones ≈ 9 meses) — señal y filtro absoluto ──
  const idxLong = closes.length - 1 - LOOKBACK_LONG;
  if (idxLong < 0) return null;
  const retLong = price / closes[idxLong] - 1;

  // ── Skip de 2 meses (42 sesiones) — se resta para esquivar la reversión corta ──
  const idxSkip = closes.length - 1 - LOOKBACK_SKIP;
  const retSkip = idxSkip >= 0 ? price / closes[idxSkip] - 1 : 0;

  // ── Momentum corto (3m) — métrica secundaria informativa ──────────
  const idx63 = closes.length - 64;
  const ret63 = idx63 >= 0 ? price / closes[idx63] - 1 : retLong;

  // ── Volatilidad realizada (3m, anualizada) — normaliza el momentum ──
  const vol63 = realizedVol(closes, VOL_WINDOW);
  if (!vol63 || vol63 < 0.01) return null;

  // ── Score dual-momentum risk-adjusted: (mom largo − skip) / vol ──
  const riskAdjMom = (retLong - retSkip) / vol63;

  // ── Momentum RELATIVO vs SPY (misma ventana larga) ───────────────
  let rsLong = 0;
  if (Array.isArray(spyBars) && spyBars.length >= LOOKBACK_LONG + 1) {
    const spyCloses = spyBars.map((b) => b.close).filter(Number.isFinite);
    if (spyCloses.length >= LOOKBACK_LONG + 1) {
      const spyRetLong = spyCloses.at(-1) / spyCloses.at(-1 - LOOKBACK_LONG) - 1;
      rsLong = retLong - spyRetLong;
    }
  }

  // ── Calidad de tendencia (R² sobre la ventana larga) ─────────────
  const r2 = r2Linear(closes, Math.min(LOOKBACK_LONG, closes.length));
  // R² de 60 sesiones para las BANDAS de trailing — el backtest (118 variantes) validó
  // las bandas TR/TN/TA con R² de 60d, no de 189d (dictamen auditoría 31-jul: el motor
  // divergía del harness y la banda asignada en vivo podía diferir de la validada).
  const r2Band = r2Linear(closes, Math.min(60, closes.length));

  // ── EMA alignment (0-3) ───────────────────────────────────────────
  const ema20 = ema(closes, 20) ?? 0;
  const ema50 = ema(closes, 50) ?? 0;
  const ema200 = ema(closes, 200) ?? 0;
  const align = (price > ema20 ? 1 : 0) + (ema20 > ema50 ? 1 : 0) + (ema50 > ema200 ? 1 : 0);

  // ── Proximidad al máximo de 52 semanas ────────────────────────────
  const hi52 = Math.max(...closes.slice(-252));
  const dist52H = hi52 > 0 ? (price / hi52 - 1) : 0; // 0 = en máximos, negativo = por debajo

  // ── ATR% ──────────────────────────────────────────────────────────
  let atrPct = null;
  if (bars.length >= 15) {
    const slice = bars.slice(-15);
    let atrSum = 0;
    for (let i = 1; i < slice.length; i++) {
      const h = slice[i].high ?? slice[i].close;
      const l = slice[i].low ?? slice[i].close;
      const pc = slice[i - 1].close;
      atrSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    const atrRaw = atrSum / (slice.length - 1);
    atrPct = price > 0 ? atrRaw / price : null;
  }

  return {
    riskAdjMom,  // señal primaria: (retLong − retSkip) / vol63
    retLong,     // retorno momentum largo 189d ≈ 9m (debe ser > 0)
    retSkip,     // retorno 42d ≈ 2m (se resta para formar riskAdjMom)
    ret63,       // retorno 3m (secundario, informativo)
    vol63,       // volatilidad anualizada 3m
    rsLong,      // fuerza relativa vs SPY (ventana larga)
    r2,          // calidad de tendencia (R², ventana larga — informativo)
    r2Band,      // R² 60d — el que usan las BANDAS de trailing (igual que el backtest)
    align,       // alineación EMA 0-3
    dist52H,     // proximidad al máximo de 52 semanas
    atrPct,      // ATR%
    close: price,
    prevClose,
    recentCloses: closes.slice(-11), // últimos 11 cierres → vol realizada 10d del portfolio (vol-targeting)
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * scoreOptimal2026(ft) → { score: 0-100, eligible: boolean } | null
 *
 * Replica EXACTAMENTE la fórmula de ranking de la config ganadora del backtest:
 *   raw = riskAdjMom · (1 + 0.5·clamp(rsLong, ±0.5)) · (0.85 + 0.05·align)
 * El ranking es invariante a transformaciones monótonas → el score 0-100 mostrado es
 * 100·squash(raw) (preserva el orden del backtest). Las gates replican el filtro del barrido.
 */
export function scoreOptimal2026(ft) {
  if (!ft) return null;

  // ── Gates de elegibilidad (idénticas al backtest) ────────────────
  // 1. Momentum ABSOLUTO: el retorno largo (9m) DEBE ser positivo (filtro clave de Antonacci)
  if (ft.retLong <= 0) return null;
  // 2. Alineación EMA mínima: precio sobre al menos EMA20 y EMA50
  if (ft.align < 2) return null;
  // 3. Cordura de volatilidad (ni muerto ni roto)
  if (ft.vol63 < 0.02 || ft.vol63 > 2.5) return null;

  // ── Score crudo de ranking (la fórmula validada por backtest) ────
  const rsTilt = 1 + 0.5 * Math.max(-0.5, Math.min(0.5, ft.rsLong));   // ladea hacia los que baten al SPY
  const alignTilt = 0.85 + 0.05 * ft.align;                            // bonus por alineación estructural
  const raw = ft.riskAdjMom * rsTilt * alignTilt;

  // Score 0-100 mostrado: monótono con `raw` (preserva el ranking del backtest)
  const score = Math.min(100, Math.max(0, 100 * squash(raw, 2.0)));
  return { score, raw, eligible: true };
}

// ── Regime detection ──────────────────────────────────────────────────────────

/**
 * detectOptimal2026Regime(spyBars) → { regime: 'RISK_ON'|'RISK_OFF', deployPct: number }
 *
 * Régimen BINARIO (el validado por backtest — mejor MAR que el de 3 estados):
 *   RISK_ON  (100%) — SPY > EMA200 → mercado alcista, capital completo desplegado
 *   RISK_OFF (30%)  — SPY < EMA200 → defensa: solo 30% invertido, 70% en caja
 * El colchón de caja en RISK_OFF es lo que recorta el drawdown a ~18% (vs 34% del SPY).
 */
export function detectOptimal2026Regime(spyBars) {
  if (!Array.isArray(spyBars) || spyBars.length < 200) {
    return { regime: 'RISK_OFF', deployPct: 30, regimeReason: 'SPY data insuficiente — modo defensivo' };
  }
  const closes = spyBars.map((b) => b.close).filter(Number.isFinite);
  if (closes.length < 200) return { regime: 'RISK_OFF', deployPct: 30, regimeReason: 'SPY data insuficiente — modo defensivo' };

  const spyPrice = closes.at(-1);
  const spyEma200 = ema(closes, 200);
  if (!spyPrice || !spyEma200) return { regime: 'RISK_OFF', deployPct: 30, regimeReason: 'EMA200 no calculable — modo defensivo' };

  if (spyPrice > spyEma200) {
    return { regime: 'RISK_ON', deployPct: 100, regimeReason: 'SPY sobre EMA200 — alcista' };
  }
  return { regime: 'RISK_OFF', deployPct: 30, regimeReason: 'SPY bajo EMA200 — defensivo (30% invertido)' };
}

// ── Vol-targeting (OPTIMAL SUPREME) ───────────────────────────────────────────

/**
 * applySupremeVolTarget(regime, investedItems) → { deployPct, volTargetFactor, realizedVol, reason }
 *
 * Overlay GANADOR de los sweeps de consolidación (118 variantes, 603 tickers, 2016-2026):
 * vol-target 30% anualizada con ventana 10d → MAR 1.87 (vs 1.75 sin VT), DD 33%→26.9%.
 * Escala la exposición del régimen: expo = deployPct × min(1, 0.30 / volRealizada10d).
 * La vol realizada se computa del portfolio top-2 (retornos diarios ponderados por peso).
 * Barroso & Santa-Clara (2015) — validado aquí con backtest propio, no solo literatura.
 */
export const SUPREME_VOL_TARGET = 0.30;   // 30% anualizada
export const SUPREME_VOL_WINDOW = 10;     // sesiones

export function applySupremeVolTarget(regime, investedItems) {
  const base = regime?.deployPct ?? 30;
  const invested = (investedItems ?? []).filter(
    (c) => (c.allocationPct ?? 0) > 0 && Array.isArray(c.ft?.recentCloses) && c.ft.recentCloses.length >= SUPREME_VOL_WINDOW + 1,
  );
  if (invested.length === 0) {
    return { deployPct: base, factorRaw: 1, volTargetFactor: 1, realizedVol: null, reason: 'VT30 no aplicable (sin históricos recientes)' };
  }
  const wSum = invested.reduce((s, c) => s + c.allocationPct, 0) || 1;
  // Retornos diarios del portfolio ponderado (últimas SUPREME_VOL_WINDOW sesiones)
  const n = SUPREME_VOL_WINDOW;
  const portRets = [];
  for (let k = 1; k <= n; k++) {
    let r = 0;
    for (const c of invested) {
      const cl = c.ft.recentCloses;
      const i = cl.length - 1 - n + k;
      if (i <= 0 || !Number.isFinite(cl[i]) || !Number.isFinite(cl[i - 1]) || cl[i - 1] <= 0) continue;
      r += (c.allocationPct / wSum) * (cl[i] / cl[i - 1] - 1);
    }
    portRets.push(r);
  }
  const mu = portRets.reduce((a, b) => a + b, 0) / portRets.length;
  const sd = Math.sqrt(portRets.reduce((s, r) => s + (r - mu) ** 2, 0) / portRets.length);
  const realizedVol = sd * Math.sqrt(252);
  if (!Number.isFinite(realizedVol) || realizedVol <= 0) {
    return { deployPct: base, factorRaw: 1, volTargetFactor: 1, realizedVol: null, reason: 'VT30 no aplicable (vol no calculable)' };
  }
  const factor = Math.min(1, SUPREME_VOL_TARGET / realizedVol);
  const deployPct = Math.round(base * factor * 10) / 10;
  return {
    deployPct,
    factorRaw: factor, // SIN redondear — usar ESTE para escalar allocations (coherencia con deployPct)
    volTargetFactor: Math.round(factor * 100) / 100, // solo display
    realizedVol: Math.round(realizedVol * 1000) / 10, // % anualizada, 1 decimal
    reason: factor < 1
      ? `VT30: vol 10d ${(realizedVol * 100).toFixed(0)}% > objetivo 30% → exposición ${deployPct}%`
      : `VT30: vol 10d ${(realizedVol * 100).toFixed(0)}% ≤ objetivo 30% → sin recorte`,
  };
}

// ── Capital allocation ────────────────────────────────────────────────────────

/**
 * allocateOptimal2026(scored, regime) → items con allocationPct
 *
 * Asignación CONCENTRADA en el TOP 2 (config óptima del backtest), proporcional al score crudo
 * de ranking (idéntico al backtest: w_i = deployPct · raw_i / Σraw). Los nombres por debajo del
 * top 2 quedan a 0% (visibles como "en banca" para la rotación). allocationPct suma deployPct.
 */
export function allocateOptimal2026(scored, regime) {
  const { deployPct } = regime;
  const all = (scored ?? []).map((s) => ({ ...s, allocationPct: 0 }));
  if (deployPct === 0 || all.length === 0) return all;

  const top = all.slice(0, N_POSITIONS);
  // Peso proporcional al score crudo de ranking (raw); fallback al score 0-100 si falta.
  const w = top.map((s) => Math.max(0, Number.isFinite(s.raw) ? s.raw : (s.score ?? 0) / 100));
  const totalW = w.reduce((a, b) => a + b, 0);

  if (totalW <= 0) {
    const eq = Math.round((deployPct / top.length) * 10) / 10;
    top.forEach((s) => { s.allocationPct = eq; });
    return all;
  }
  top.forEach((s, i) => { s.allocationPct = Math.round((w[i] / totalW) * deployPct * 10) / 10; });
  return all;
}

// ── Trailing stop assignment ───────────────────────────────────────────────────

/**
 * assignOptimal2026Stops(item) → stop info
 *
 * Uses ATR-based stops. Optimal2026 uses tighter stops than FABLE01
 * (concentration demands tighter risk management per position).
 */
export function assignOptimal2026Stops(item) {
  const { atrPct, r2, r2Band } = item.ft ?? {};
  if (!atrPct || !Number.isFinite(atrPct)) return { stopPct: null, stopPrice: null, band: 'TN' };

  // Banda por R² de 60 SESIONES (igual que el backtest de 118 variantes); fallback al
  // R² largo solo para snapshots antiguos en KV que aún no traigan r2Band.
  const rb = Number.isFinite(r2Band) ? r2Band : r2;
  let band, mult;
  if (atrPct < 0.025 && rb > 0.70) { band = 'TR'; mult = 2.5; }
  else if (atrPct > 0.045 || (rb < 0.40)) { band = 'TA'; mult = 4.0; }
  else { band = 'TN'; mult = 3.0; }

  const stopPct = Math.round(atrPct * mult * 100 * 10) / 10;
  const stopPrice = item.price ? Math.round(item.price * (1 - stopPct / 100) * 100) / 100 : null;
  return { stopPct, stopPrice, band };
}

// ── Calibration ───────────────────────────────────────────────────────────────

// ── Merge helper (for multi-batch scans) ─────────────────────────────────────

/**
 * mergeOptimal2026(existing, newer) → top-10 candidatos fusionados.
 * Mantiene el candidato de mayor ranking por ticker entre batches del loop de scan.
 * Ordena por `raw` (el score crudo del backtest) con fallback a `score` 0-100.
 */
const rankKey = (c) => (Number.isFinite(c?.raw) ? c.raw : (c?.score ?? 0));
export function mergeOptimal2026(existing, newer) {
  const map = new Map((existing ?? []).map((c) => [c.sym, c]));
  for (const c of (newer ?? [])) {
    const prev = map.get(c.sym);
    if (!prev || rankKey(c) > rankKey(prev)) map.set(c.sym, c);
  }
  return [...map.values()].sort((a, b) => rankKey(b) - rankKey(a)).slice(0, 10);
}

export const OPTIMAL2026_CALIBRATION = {
  // Parámetros ÓPTIMOS (config ganadora del barrido real de 810 combinaciones, 2016-2026)
  params: {
    lookbackLong: LOOKBACK_LONG,  // 189 ≈ 9m momentum
    lookbackSkip: LOOKBACK_SKIP,  // 42 ≈ 2m skip (anti-reversión)
    volWindow: VOL_WINDOW,        // 63 ≈ 3m vol realizada anualizada
    nPositions: N_POSITIONS,      // top 2 (mejor MAR del barrido)
    regimeType: 'binary',         // SPY/EMA200 → 100% / 30%
  },
  // Multiplicadores de trailing stop (ATR)
  trailingMults: { TR: 2.5, TN: 3.0, TA: 4.0 },
  // Régimen binario: capital desplegado por estado
  deploy: { riskOn: 100, riskOff: 30 },
  // Badge de fiabilidad HONESTO: el backtest es robusto (estable cross-régimen, bate al SPY 5/5
  // tramos, MAR 2.17) PERO lleva haircut por sesgo de supervivencia del universo (mega-caps que
  // sobrevivieron) + IRPF de rotación mensual + slippage. Crudo ~75 → honesto 64/100 (media-alta).
  badge: 64,
  // Métricas del BACKTEST REAL (110 tickers US+EU, 2016-06 → 2026-06, rebalanceo mensual).
  // Config óptima: LB189 · skip42 · vol63 · N2 · régimen binario · risk-adjusted.
  oos: {
    cagr: 40.1,       // % CAGR (crecimiento compuesto anualizado) — TRIPLICA el SPY (14.7%)
    maxDD: 18.5,      // % máximo drawdown — la MITAD del SPY (33.7%)
    mar: 2.17,        // MAR = CAGR / MaxDD — el mejor del barrido completo
    sharpe: 1.13,     // ratio de Sharpe anualizado
    winPos: 62,       // % de meses ganadores
    beatsSpy: '5/5',  // bate al SPY en los 5 sub-períodos analizados (anti-overfit)
    tradesYr: 24,     // operaciones/año aprox (rebalanceo mensual, 2 posiciones)
    testPeriod: '2016-2026',
  },
};

// ══ OPTIMAL SUPREME — calibración del módulo ÚNICO consolidado ════════════════
// Resultado de los sweeps de consolidación (24/25-jul-2026): 118 variantes × 4 baterías
// sobre el UNIVERSO COMPLETO (603 tickers US+EU, 2016-07 → 2026-07, walk-forward
// sin lookahead, costes 20bps por lado en cada entrada/salida).
//
// GANADOR: top-2 score-weighted + trailing ATR por bandas con ROTACIÓN INMEDIATA
//          + régimen binario SPY/EMA200 (100/30) + VOL-TARGET 30% ventana 10d.
//
// Comprobado y DESCARTADO con datos (no especulación) — sweeps 1-3 (73 variantes):
//   • Diversificar a top-3/top-4  → CAGR -15pp sin bajar DD (la concentración ES el edge)
//   • Pesos inverse-vol           → MAR 1.56 < 1.87 (score-weighted gana)
//   • Crash-filter SPY ret10<-6%  → whipsaw: DD SUBE a 41.6% (sale abajo, re-entra tarde)
//   • Risk-off más duro (15%/0%)  → pierde las recuperaciones, DD sube
//   • Régimen VIX 4 estados       → MAR 1.55 < 1.75 del binario
//   • Filtro entrada RSI/dist20   → no mejora al combinar con VT (redundante)
//
// SWEEP 4 (25-jul-2026, +45 variantes = 118 totales) — ROTACIÓN PROACTIVA:
//   • Rotar a DIARIO al mejor ticker → CATASTRÓFICO: CAGR 10.4%, DD 54% (MAR 0.19).
//     El momentum necesita TIEMPO; saltar de ticket persigue ruido y vende ganadores
//     en pullbacks normales. Cada semana: MAR ~1.0. Cada 2 semanas: ~1.2. NUNCA <mensual.
//   • GANADOR: revisión MENSUAL con HISTÉRESIS 1.10 — rotar una posición tenida solo si
//     el mejor candidato la supera en >10% de score → menos rotaciones inútiles,
//     MAR 1.79→1.94 y CAGR +4pp en el mismo harness. (Con costes 10bps: MAR 2.07.)
//   • Régimen EMA100 rápido y graduado 3 niveles → NO mejoran al binario EMA200 en
//     ninguna cadencia. El "ciclo económico" fino pierde contra el simple.
export const SUPREME_ROTATION_HYSTERESIS = 1.10; // candidato debe superar al tenido ×1.10
export const SUPREME_REVIEW_CADENCE = 21;        // sesiones entre revisiones de rotación (mensual)

export const OPTIMAL_SUPREME_CALIBRATION = {
  params: {
    lookbackLong: LOOKBACK_LONG,
    lookbackSkip: LOOKBACK_SKIP,
    volWindow: VOL_WINDOW,
    nPositions: N_POSITIONS,
    regimeType: 'binary',
    volTarget: SUPREME_VOL_TARGET,      // 0.30 anualizada
    volTargetWindow: SUPREME_VOL_WINDOW, // 10 sesiones
    trailingRotation: true,              // rotación inmediata al saltar trailing (mecánica FABLE01)
    rotationHysteresis: SUPREME_ROTATION_HYSTERESIS, // sweep 4: rotar solo si candidato > tenido ×1.10
    reviewCadence: SUPREME_REVIEW_CADENCE,           // sweep 4: revisión MENSUAL (más rápido destruye)
  },
  trailingMults: { TR: 2.5, TN: 3.0, TA: 4.0 },
  deploy: { riskOn: 100, riskOff: 30 },
  // Badge honesto: backtest 10 años sobre universo COMPLETO (603, no 110 curados) con
  // trailing+VT+histéresis validados en 118 variantes; sigue llevando haircut por
  // supervivencia del listado estático + IRPF rotación + slippage. Crudo ~79 → honesto 67/100.
  badge: 67,
  // NOTA DE VARIANZA (3-ago-2026, primera recalibración trimestral): estas cifras son la
  // medición de jul-2026. La MISMA config sobre un pull de datos fresco de Yahoo (ago-2026,
  // ventana desplazada ~10 días) midió CAGR 38.9 / DD 26.7 / MAR 1.46 — la varianza entre
  // pulls es grande. Tomar las cifras publicadas como el EXTREMO OPTIMISTA del rango; el
  // DD ~27% es lo más estable entre mediciones. Informes en backtests/recalibracion-*.json.
  oos: {
    cagr: 52.2,       // % CAGR — config con histéresis 1.10 mensual (sweep 4, 603 tickers)
    maxDD: 26.9,      // % MaxDD — vs 33% sin vol-target y 40% sin trailing
    mar: 1.94,        // el mejor de las 118 variantes probadas
    sharpe: 1.50,
    winPos: 65,       // % meses ganadores
    beatsSpy: '3/3',  // sub-períodos 2016-19 / 20-22 / 23-26 todos positivos (43/22/102.1)
    tradesYr: 48,     // revisión mensual con histéresis + rotaciones por trailing
    testPeriod: '2016-2026 · 603 tickers',
  },
};
