/**
 * SP500 ENGINE — motor de entradas y salidas EXCLUSIVO del S&P 500.
 *
 * INDEPENDENCIA TOTAL (mandato de Sergi, 8-ago-2026): este fichero no importa NADA
 * de optimal2026Engine.js ni comparte estado con él. Su única entrada son barras de
 * precio del índice; su única salida es un objeto de señal propio. Los dos módulos
 * pueden dar recomendaciones opuestas y eso es correcto: analizan cosas distintas.
 *
 * La calibración está CONGELADA a partir del estudio documentado en
 * docs/SP500-MODULE-PLAN.md (≈200 variantes sobre 1970-2026, scripts/sp500-study-*.mjs).
 * No tocar sin repetir el estudio: cualquier cambio debe justificarse con datos.
 */

export const SP500_CALIBRATION = {
  version: "1.0.0",
  frozenAt: "2026-08-08",
  study: "scripts/sp500-study-{1,2,3}.mjs · SPY ajustado 1994-02→2026-08 (32,5 años)",

  // Régimen: momento absoluto a 12 meses, confirmado durante 3 sesiones.
  momentumLookback: 252,
  confirmDays: 3,
  // Referencia de tendencia (contexto y filtro del refuerzo en retrocesos).
  trendSma: 200,
  // Dimensionado por volatilidad.
  volWindow: 20,
  volTarget: 0.20,
  volCap: 1.50,
  // Refuerzo en retroceso.
  pullbackRsiPeriod: 2,
  pullbackRsiThreshold: 5,
  pullbackBoost: 0.25,
  // Operativa manual.
  reviewDayOfWeek: 1,      // lunes
  exposureStep: 0.10,      // se redondea a múltiplos de 10 pp
  deadband: 0.10,          // no se mueve la cartera por menos de 10 pp

  // Resultado del estudio, neto de costes (5 pb/lado + comisión del vehículo).
  backtest: {
    period: "1994-02 → 2026-08",
    buyHold: { cagr: 0.109, maxDD: 0.552, mar: 0.20 },
    core: { cagr: 0.136, maxDD: 0.254, mar: 0.54, ordersPerYear: 15 },
  },
};

/** Perfiles de riesgo: multiplican la exposición del núcleo. */
export const SP500_PROFILES = {
  PRUDENTE:    { label: "Prudente",    lev: 1.0, volTarget: 0.15, volCap: 1.00, cagr: 0.102, maxDD: 0.182 },
  EQUILIBRADO: { label: "Equilibrado", lev: 1.0, volTarget: 0.20, volCap: 1.50, cagr: 0.136, maxDD: 0.254 },
  AMBICIOSO:   { label: "Ambicioso",   lev: 1.25, volTarget: 0.20, volCap: 1.50, cagr: 0.159, maxDD: 0.308 },
  AGRESIVO:    { label: "Agresivo",    lev: 1.5, volTarget: 0.20, volCap: 1.50, cagr: 0.177, maxDD: 0.365 },
};

/**
 * Vehículos comprables por un minorista español a través de IBK.
 * PRIIPs impide comprar ETF domiciliados en EE.UU. (SPY, VOO, SSO, UPRO): por eso
 * el módulo NUNCA recomienda esos tickers aunque el estudio se haya hecho con SPY.
 */
export const SP500_VEHICLES = [
  { ticker: "CSPX", isin: "IE00B5BMR087", exchange: "LSE",   currency: "USD", ter: 0.0007, type: "1x acumulación", note: "iShares Core S&P 500 UCITS — línea en dólares" },
  { ticker: "SXR8", isin: "IE00B5BMR087", exchange: "Xetra", currency: "EUR", ter: 0.0007, type: "1x acumulación", note: "Mismo fondo que CSPX, cotizado en euros" },
  { ticker: "VUSA", isin: "IE00B3XXRP09", exchange: "LSE",   currency: "USD", ter: 0.0007, type: "1x reparto",     note: "Vanguard S&P 500 UCITS — reparte dividendo" },
  { ticker: "XS2D", isin: "LU0411078552", exchange: "LSE",   currency: "USD", ter: 0.0060, type: "2x diario",       note: "Xtrackers S&P 500 2x Leveraged — solo perfiles agresivos, sufre decaimiento en lateral" },
];

// ── utilidades numéricas ─────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

function smaAt(closes, period, endIdx) {
  if (endIdx + 1 < period) return null;
  let s = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) s += closes[i];
  return s / period;
}

/** RSI de Wilder. Devuelve la serie completa para poder leer el valor de ayer. */
function rsiSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= period) {
      avgGain += g / period; avgLoss += l / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

function roundToStep(x, step) {
  if (!step) return x;
  return Math.round(x / step) * step;
}

/** Próximo lunes (o hoy si hoy es lunes y aún no se ha revisado). */
function nextReviewDate(fromIso) {
  const d = new Date(fromIso);
  const day = d.getUTCDay();
  const add = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

/**
 * Núcleo del módulo.
 * @param {Array<{date:string,close:number,high?:number,low?:number}>} bars barras diarias del índice, orden ascendente
 * @param {object} opts { profile, vix, previousSignal }
 */
export function computeSp500Signal(bars, opts = {}) {
  const C = SP500_CALIBRATION;
  const profileKey = SP500_PROFILES[opts.profile] ? opts.profile : "EQUILIBRADO";
  const P = SP500_PROFILES[profileKey];

  const clean = (Array.isArray(bars) ? bars : [])
    .filter((b) => b && typeof b.close === "number" && Number.isFinite(b.close) && b.close > 0 && typeof b.date === "string")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const minBars = C.momentumLookback + 5;
  if (clean.length < minBars) {
    return {
      ok: false,
      error: "INSUFFICIENT_HISTORY",
      message: `Se necesitan al menos ${minBars} sesiones para calcular el momento a 12 meses; hay ${clean.length}.`,
      barsAvailable: clean.length,
      barsRequired: minBars,
    };
  }

  const closes = clean.map((b) => b.close);
  const n = closes.length;
  const last = n - 1;
  const price = closes[last];
  const asOf = clean[last].date;

  // ── régimen: momento absoluto a 12 meses, confirmado 3 sesiones ──
  const momAt = (i) => {
    const ref = closes[i - C.momentumLookback];
    return ref > 0 ? closes[i] / ref - 1 : null;
  };
  const momentum = momAt(last);
  const exitLevel = closes[last - C.momentumLookback];   // por debajo de aquí, el momento se vuelve negativo

  const rawSignals = [];
  for (let k = C.confirmDays - 1; k >= 0; k--) {
    const i = last - k;
    const m = momAt(i);
    rawSignals.push(m != null && m > 0 ? 1 : 0);
  }
  const signalToday = rawSignals[rawSignals.length - 1];
  const confirmed = rawSignals.every((s) => s === signalToday);
  // Si la señal aún no está confirmada, se mantiene la anterior (evita latigazos).
  const prevState = opts.previousSignal?.regime === "DENTRO" ? 1 : opts.previousSignal?.regime === "FUERA" ? 0 : signalToday;
  const regimeOn = confirmed ? signalToday === 1 : prevState === 1;

  // ── volatilidad realizada y exposición objetivo ──
  const rets = [];
  for (let i = last - C.volWindow + 1; i <= last; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const realizedVol = stdev(rets) * Math.sqrt(252);

  const sma200 = smaAt(closes, C.trendSma, last);
  const rsi = rsiSeries(closes, C.pullbackRsiPeriod);
  const rsi2 = rsi[last];

  const pullbackOpen = Boolean(
    regimeOn && sma200 != null && price >= sma200 && rsi2 != null && rsi2 < C.pullbackRsiThreshold
  );

  let exposureRaw = 0;
  if (regimeOn && realizedVol > 0) {
    exposureRaw = Math.min(P.volCap, P.volTarget / realizedVol);
    if (pullbackOpen) exposureRaw = Math.min(P.volCap + C.pullbackBoost, exposureRaw + C.pullbackBoost);
  }
  const exposure = Math.max(0, roundToStep(exposureRaw * P.lev, C.exposureStep));

  // ── qué tiene que pasar para cambiar de lado ──
  const distanceToExitPct = exitLevel > 0 ? (price / exitLevel - 1) * 100 : null;
  const distanceToTrendPct = sma200 ? (price / sma200 - 1) * 100 : null;

  // ── contexto de volatilidad implícita (opcional, informativo) ──
  const vix = typeof opts.vix === "number" && Number.isFinite(opts.vix) ? opts.vix : null;

  const nowIso = new Date().toISOString();
  return {
    ok: true,
    module: "SP500",
    calibrationVersion: C.version,
    asOf,
    computedAtUtc: nowIso,
    profile: profileKey,
    profileLabel: P.label,

    price,
    regime: regimeOn ? "DENTRO" : "FUERA",
    regimeConfirmed: confirmed,
    regimeReason: regimeOn
      ? `El índice gana un ${(momentum * 100).toFixed(1)}% en 12 meses (momento positivo)`
      : `El índice pierde un ${(momentum * 100).toFixed(1)}% en 12 meses (momento negativo)`,

    momentum12mPct: momentum != null ? momentum * 100 : null,
    realizedVolPct: realizedVol * 100,
    sma200,
    rsi2,
    vix,

    exposurePct: exposure * 100,
    exposureUnrounded: exposureRaw * P.lev * 100,
    volTargetPct: P.volTarget * 100,
    volCapPct: P.volCap * 100,
    pullbackOpen,
    pullbackReason: pullbackOpen
      ? `Retroceso dentro de tendencia (RSI2 ${rsi2.toFixed(0)}): oportunidad de reforzar ${C.pullbackBoost * 100} pp`
      : null,

    exitLevel,
    distanceToExitPct,
    distanceToTrendPct,
    nextReview: nextReviewDate(nowIso),

    profiles: Object.fromEntries(
      Object.entries(SP500_PROFILES).map(([k, p]) => [k, { label: p.label, cagr: p.cagr, maxDD: p.maxDD }])
    ),
    vehicles: SP500_VEHICLES,
    backtest: C.backtest,
    barsUsed: n,
  };
}

/**
 * Traduce la señal a una orden concreta en euros a partir del capital de la cuenta
 * y de lo que ya se tiene invertido. `deadband` evita órdenes pequeñas e inútiles.
 */
export function buildSp500Order(signal, { accountTotal, currentInvested }) {
  if (!signal?.ok) return null;
  const total = Number(accountTotal);
  const held = Number(currentInvested) || 0;
  if (!Number.isFinite(total) || total <= 0) return null;

  const targetAmount = (signal.exposurePct / 100) * total;
  const delta = targetAmount - held;
  const deltaPct = Math.abs(delta) / total;

  if (deltaPct < SP500_CALIBRATION.deadband) {
    return { action: "MANTENER", targetAmount, currentAmount: held, delta: 0,
      reason: `La diferencia (${(deltaPct * 100).toFixed(0)} pp) es menor que la banda muerta del ${SP500_CALIBRATION.deadband * 100} pp: no compensa operar.` };
  }
  return {
    action: delta > 0 ? "COMPRAR" : "VENDER",
    targetAmount,
    currentAmount: held,
    delta,
    reason: delta > 0
      ? `Subir la exposición hasta el ${signal.exposurePct.toFixed(0)}% del capital.`
      : `Bajar la exposición hasta el ${signal.exposurePct.toFixed(0)}% del capital.`,
  };
}
