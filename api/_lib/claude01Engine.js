/**
 * Claude01 Engine — Momentum Catalítico Adaptativo
 * =================================================
 * Añade una segunda capa de filtrado encima de FABLE01:
 *   1. Régimen de mercado (A/B/C/D) — qué estrategia aplicar HOY
 *   2. Detector de pullback sano — ¿está el activo en zona de entrada óptima?
 *   3. Catalizador próximo — earnings en los próximos 10 días (Finnhub)
 *   4. Kelly sizing — tamaño de posición óptimo dado régimen + señales
 *   5. Señal de entrada — ¿hay breakout del pullback o espera?
 *
 * Completamente independiente de todos los demás motores.
 */

// ─── Utilidades matemáticas ───────────────────────────────────────────────────

function emaOf(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function round2(v) { return Math.round(v * 100) / 100; }

// RSI-14 con suavizado de Wilder (estándar de la industria)
function calculateRsi14(closes) {
  if (!closes || closes.length < 20) return null;
  // Usar al menos 50 barras para que el seed del EMA sea estable
  const data = closes.slice(-Math.min(80, closes.length));
  const changes = [];
  for (let i = 1; i < data.length; i++) changes.push(data[i] - data[i - 1]);
  if (changes.length < 14) return null;
  const gains = changes.map(c => Math.max(0, c));
  const losses = changes.map(c => Math.max(0, -c));
  let avgGain = gains.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  let avgLoss = losses.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (let i = 14; i < changes.length; i++) {
    avgGain = (avgGain * 13 + gains[i]) / 14;
    avgLoss = (avgLoss * 13 + losses[i]) / 14;
  }
  if (avgLoss === 0) return 100;
  return round2(100 - 100 / (1 + avgGain / avgLoss));
}

// ─── 1. CLASIFICADOR DE RÉGIMEN ───────────────────────────────────────────────

const REGIME_CONFIG = {
  A: {
    label: "Expansión",
    color: "#10b981",
    description: "SPY > EMA200 · VIX bajo · Crédito sano",
    actionBias: "MÁXIMA EXPOSICIÓN — entrar en momentum puro",
    note: "Tendencias sanas tienen la mayor probabilidad de continuar",
  },
  B: {
    label: "Corrección en alcista",
    color: "#f59e0b",
    description: "SPY > EMA200 · Volatilidad moderada",
    actionBias: "VENTANA ÓPTIMA — pullbacks en tendencias sanas = mejor entrada",
    note: "El mercado 'respira'. Las correcciones en bull son oportunidades, no riesgo",
  },
  C: {
    label: "Risk-OFF / Bear",
    color: "#ef4444",
    description: "SPY < EMA200 o VIX elevado",
    actionBias: "REDUCIR EXPOSICIÓN — preservar capital, esperar confirmación",
    note: "Momento de reducir tamaño, no de buscar entradas agresivas",
  },
  D: {
    label: "Capitulación / Rebote",
    color: "#a78bfa",
    description: "VIX extremo > 35 · Pánico de mercado",
    actionBias: "ENTRADA CONTRARIAN AGRESIVA — pánico = oportunidad histórica",
    note: "Los rebotes de capitulación son los movimientos más violentos y rápidos",
  },
};

export function classifyRegime(indicators, spyBars, spyBullishFallback = null) {
  const vixInd = indicators.find(i => i.symbol === "VIX");
  const hygInd = indicators.find(i => i.symbol === "HYG");

  const vix = typeof vixInd?.value === "number" ? vixInd.value : null;
  const hygValue = typeof hygInd?.value === "number" ? hygInd.value : null;
  const hygTrend = hygInd?.trend ?? null;

  // SPY vs EMA200: primero intentar calcular desde barras, fallback al valor cacheado
  let spyAboveEma200 = spyBullishFallback;
  if (Array.isArray(spyBars) && spyBars.length >= 200) {
    const closes = spyBars.map(b => b.close ?? b.adjusted_close).filter(v => typeof v === "number" && v > 0);
    if (closes.length >= 200) {
      const ema200 = emaOf(closes, 200);
      const last = closes[closes.length - 1];
      if (ema200 !== null) spyAboveEma200 = last > ema200;
    }
  }

  // Crédito sano: HYG en tendencia UP o al menos plana
  const creditSane = hygTrend === "UP" || (hygTrend !== "DOWN" && hygValue !== null && hygValue > 78);

  let regime = "B"; // default conservador
  if (vix !== null) {
    if (vix > 35) {
      regime = "D";
    } else if (vix >= 28 || spyAboveEma200 === false) {
      regime = "C";
    } else if (spyAboveEma200 === true && creditSane && vix < 18) {
      regime = "A";
    } else if (spyAboveEma200 !== false && vix < 28) {
      regime = "B";
    }
  } else if (spyAboveEma200 === false) {
    regime = "C";
  }

  return {
    regime,
    ...REGIME_CONFIG[regime],
    vix,
    hygHealth: hygTrend === "UP" ? "SANO" : hygTrend === "DOWN" ? "DÉBIL" : "NEUTRAL",
    spyVsEma200: spyAboveEma200 === true ? "SOBRE" : spyAboveEma200 === false ? "BAJO" : "DESCONOCIDO",
  };
}

// ─── 2. DETECTOR DE PULLBACK SANO ────────────────────────────────────────────

export function detectPullback(bars) {
  if (!Array.isArray(bars) || bars.length < 60) return null;

  const closes = bars.map(b => b.close ?? b.adjusted_close).filter(v => typeof v === "number" && v > 0);
  const highs  = bars.map(b => b.high).filter(v => typeof v === "number" && v > 0);

  if (closes.length < 60) return null;

  const currentPrice = closes[closes.length - 1];

  // Máximo de las últimas 60 sesiones (3 meses aprox)
  const high60 = Math.max(...highs.slice(-60));
  const pullbackPct = round2(((high60 - currentPrice) / high60) * 100);

  // RSI-14
  const rsi14 = calculateRsi14(closes);

  // EMA50 — semilla con primeras 50 barras, actualizada con el resto
  const ema50 = closes.length >= 50 ? round2(emaOf(closes, 50)) : null;

  // EMA200 — requiere mínimo 200 barras
  const ema200 = closes.length >= 200 ? round2(emaOf(closes, 200)) : null;

  const inUptrend = ema50 !== null && ema200 !== null && currentPrice > ema50 && ema50 > ema200;
  const inPullback = pullbackPct >= 4 && pullbackPct <= 22;
  const rsiSane = rsi14 !== null && rsi14 >= 32 && rsi14 <= 62;

  // Señal de entrada: precio cierra por encima del máximo de las últimas 3 barras
  const last4bars = bars.slice(-4);
  const last3High = last4bars.length >= 4
    ? Math.max(...last4bars.slice(0, 3).map(b => b.high).filter(v => typeof v === "number"))
    : null;
  let entrySignal = "ESPERANDO";
  if (last3High !== null) {
    if (currentPrice > last3High) entrySignal = "BREAKOUT";
    else if (!inPullback) entrySignal = "EXTENDIDO";
  }

  return {
    currentPrice: round2(currentPrice),
    pullbackPct,
    rsi14,
    ema50,
    ema200,
    inUptrend,
    inPullback,
    rsiSane,
    isOpportunity: inUptrend && inPullback && rsiSane,
    entrySignal,
    high60: round2(high60),
  };
}

// ─── 3. KELLY SIZING ─────────────────────────────────────────────────────────

export function calcKellySize(regime, hasCatalyst, pullbackPct, rsi14) {
  if (regime === "C") return 0; // Nunca operar en bear sin confirmación

  const base = { A: 8, B: 10, D: 14 }[regime] ?? 6;
  const catalystMult = hasCatalyst ? 1.4 : 1.0;
  // Mejor entry = pullback entre 7-14% con RSI 38-52
  const pullbackMult = pullbackPct >= 10 ? 1.2 : pullbackPct >= 6 ? 1.1 : 1.0;
  const rsiMult = rsi14 !== null && rsi14 >= 38 && rsi14 <= 52 ? 1.15 : 1.0;

  // Kelly fraccional (1/4 Kelly para realismo): cap 15%
  return Math.min(15, Math.round(base * catalystMult * pullbackMult * rsiMult));
}

// ─── 4. FINNHUB EARNINGS CALENDAR ────────────────────────────────────────────

// Convierte símbolo del universo (ASML.AS, SAP.XETRA, NVDA) al ticker Finnhub
function toFinnhubTicker(symbol) {
  return symbol.split(".")[0]; // quitar sufijo de mercado
}

export async function fetchEarningsCalendar(symbols, finnhubKey, daysAhead = 12) {
  if (!finnhubKey) return {};
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + daysAhead * 86_400_000).toISOString().slice(0, 10);

  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${finnhubKey}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "EMRR/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    const calendar = data?.earningsCalendar ?? [];

    // Construir mapa: ticker_base → {date, daysAway, hour}
    const tickerSet = new Set(symbols.map(toFinnhubTicker));
    const result = {};
    for (const entry of calendar) {
      const sym = entry.symbol;
      if (!sym || !tickerSet.has(sym)) continue;
      // Comparar SOLO fecha (ambos a medianoche UTC) para no perder earnings del MISMO día:
      // new Date("YYYY-MM-DD") es medianoche UTC; restarle `now` (instante actual) daba diferencias
      // fraccionarias negativas → Math.round → -1 → se descartaban los earnings de hoy. Como `from`
      // y entry.date son ambos YYYY-MM-DD (medianoche UTC), la diferencia es múltiplo exacto de 1 día.
      const daysAway = Math.round((Date.parse(entry.date) - Date.parse(from)) / 86_400_000);
      if (daysAway < 0 || daysAway > daysAhead) continue;
      // Si ya hay uno más cercano, mantenerlo
      if (!result[sym] || daysAway < result[sym].daysAway) {
        result[sym] = {
          date: entry.date,
          daysAway,
          hour: entry.hour ?? null, // "bmo"=pre-mercado, "amc"=post-mercado
        };
      }
    }
    return result;
  } catch {
    return {}; // degradación silenciosa — no bloquea el módulo
  }
}

// ─── 5. CONSTRUCTOR DEL RESULTADO ────────────────────────────────────────────

export function buildClaude01Items(fable01Items, spyBars, indicators, earningsMap, spyBullishFallback = null) {
  const regimeResult = classifyRegime(indicators, spyBars, spyBullishFallback);

  const items = fable01Items.map(item => {
    const pb = item._pullback ?? null; // ya calculado en el endpoint con fetchYahooHistory
    const baseTicker = toFinnhubTicker(item.symbol);
    // El calendario gratuito de Finnhub es US-only: un símbolo base (p.ej. "SAP") denota la
    // cotización ESTADOUNIDENSE. Solo adjuntar el catalizador a la cotización US (.US o sin sufijo);
    // para listings no-US (.XETRA/.PA/.L/.AS/.MI/.SW…) NO adjuntar — sería cross-atribución desde un
    // valor US distinto con misma base (p.ej. SAP.XETRA recibiría los earnings de SAP US).
    const isUsListing = item.symbol.endsWith(".US") || !item.symbol.includes(".");
    const earningsInfo = isUsListing ? (earningsMap[baseTicker] ?? null) : null;

    const kellySize = pb?.isOpportunity
      ? calcKellySize(regimeResult.regime, Boolean(earningsInfo), pb.pullbackPct, pb.rsi14)
      : 0;

    return {
      symbol: item.symbol,
      name: item.name,
      fable01Score: item.score,
      fable01Rank: item.rank,
      currentPrice: pb?.currentPrice ?? item.price ?? null,
      pullbackPct: pb?.pullbackPct ?? null,
      rsi14: pb?.rsi14 ?? null,
      ema50: pb?.ema50 ?? null,
      ema200: pb?.ema200 ?? null,
      inUptrend: pb?.inUptrend ?? false,
      inPullback: pb?.inPullback ?? false,
      rsiSane: pb?.rsiSane ?? false,
      isOpportunity: pb?.isOpportunity ?? false,
      entrySignal: pb?.entrySignal ?? "SIN_DATOS",
      earningsDate: earningsInfo?.date ?? null,
      earningsDaysAway: earningsInfo?.daysAway ?? null,
      earningsHour: earningsInfo?.hour ?? null,
      kellySize,
      hasCatalyst: Boolean(earningsInfo),
    };
  });

  // Primero oportunidades (pullback sano), luego el resto ordenado por rank
  const opportunities = items.filter(i => i.isOpportunity).sort((a, b) => b.kellySize - a.kellySize || a.fable01Rank - b.fable01Rank);
  const watching      = items.filter(i => !i.isOpportunity).sort((a, b) => a.fable01Rank - b.fable01Rank);

  return { regimeResult, opportunities, watching };
}
