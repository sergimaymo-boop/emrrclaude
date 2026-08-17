/**
 * RALLY — BIBLIOTECA COMÚN de los estudios de agosto-2026 (ventana-régimen,
 * trailing dinámico por recorrido×estado, rotación de capital).
 *
 * Réplica EXACTA de las fórmulas de producción v4.0 (api/_lib/rallyScoreEngine.js):
 *   · score      = clamp(50 + 50·tanh(mom9m/75))              — el ranking
 *   · runway     = computeRunway (edad EMA50, ext50, prox52w) — ALTO/MEDIO/BAJO
 *   · entryZone  = computeEntryTiming (prox52w)               — IDEAL/LEJOS/EN_MAXIMOS
 *   · trailing   = catástrofe clamp(25+2·ATR, 25, 35)         — legacy; producción usa clamp(12+0,35·runway, 15, 45)
 *   · convicción = convictionWeights (score−50) — LEGACY, solo para comparar; producción usa pesos M9_RAW [4,20] (ver weightsOf)
 *
 * Todo sin lookahead: los rasgos del día k usan solo barras ≤ k. Señales sobre el
 * precio SIN ajustar (convención de los estudios rally previos); rentabilidad
 * sobre el ajustado.
 *
 * ⚠ DIVERGENCIAS CON PRODUCCIÓN (verificación adversarial 15-ago-2026):
 *   1. PRODUCCIÓN calcula las señales sobre adjusted_close (historicalDataProvider:
 *      close = adjusted_close ?? close), NO sobre el cierre sin ajustar de aquí.
 *      Impacto medido re-ejecutando el estudio con señales ajustadas: campeón v4
 *      38,34%/43,82% (antes 39,1%/43,9%) y fijo30+mezcla 39,12%/36,25% (antes
 *      39,2%/36,3%) — las conclusiones RELATIVAS no cambian (la mezcla incluso
 *      mejora frente al campeón).
 *   2. El ATR de aquí es Wilder(14) suavizado; producción usa la media simple de
 *      los últimos 14 TR (technicalEngine.calculateAtr). Solo afecta a las
 *      variantes catATR y queda amortiguado por el clamp de la banda 25-35.
 *
 * Determinista: sin aleatoriedad salvo mulberry32 con semilla fija.
 */
import fs from "node:fs";

export const DATA = "data/universe-10y.json";
export const COST_BPS = Number(process.env.COST_BPS ?? 20) / 1e4;

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
export const f1 = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");

/** PRNG determinista (mulberry32) para cualquier control aleatorio. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spearman rho (para pruebas de estabilidad de parámetros por ticker). */
export function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    idx.forEach(([, i], j) => { r[i] = j; });
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

function emaSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

/**
 * Carga el universo y precomputa por ticker, proyectado al calendario maestro (SPY):
 *   adj[k]  — cierre ajustado (rentabilidad real)
 *   feat[k] — { m1, m3, m6, m9, m12, atr, age, ext50, prox, regAge, inRegime }
 * Régimen (hipótesis 1): SMA200 con pendiente positiva y cierre por encima, SOSTENIDO
 * (≥45 de las últimas 50 sesiones cumplen cierre>SMA200 y SMA200 subiendo a 20 vistas).
 * regAge = sesiones consecutivas con el régimen activo (0 = fuera de régimen).
 *
 * opts:
 *   adjustedSignals — true: las SEÑALES se calculan sobre el cierre AJUSTADO, la
 *     convención real de producción (historicalDataProvider: close = adjusted_close).
 *     false (por defecto): cierre sin ajustar, la convención de los estudios previos.
 *   rich — true: añade a feat los rasgos del estudio de stops adaptativos:
 *     atrProd (ATR de producción: MEDIA SIMPLE de los últimos 14 TR, con high/low
 *     crudos y cierre-señal previo, en % — réplica de technicalEngine.calculateAtr),
 *     rsi14, sma50, sma200, dist50, dist200, slope50 (10 sesiones), slope200 (20),
 *     dd52 (= prox − 1 ≤ 0), ddVel10 (Δ del dd52 en 10 sesiones; negativo = cayendo),
 *     vol20, vol60, vol2060 (régimen de volatilidad).
 */
export function loadUniverse(opts = {}) {
  const { adjustedSignals = false, rich = false } = opts;
  const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const series = raw.series;
  const spyRaw = series["SPY.US"].bars;
  const dates = spyRaw.map((b) => b.d);
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const D = dates.length;
  const spyClose = spyRaw.map((b) => b.a);

  const T = [];
  for (const [sym, obj] of Object.entries(series)) {
    if (sym === "SPY.US") continue;
    const bars = obj.bars;
    if (!bars || bars.length < 300) continue;
    const n = bars.length;
    const closes = bars.map((b) => b.c);
    const adj = bars.map((b) => b.a);
    const sig = adjustedSignals ? adj : closes;   // serie sobre la que se calculan las SEÑALES
    const highs = bars.map((b) => b.h), lows = bars.map((b) => b.l);
    const e50 = emaSeriesOf(sig, 50);

    // ATR de Wilder 14 (la réplica de los estudios previos)
    const atrPct = new Array(n).fill(null);
    { let atr = null;
      for (let i = 1; i < n; i++) {
        const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - sig[i - 1]), Math.abs(lows[i] - sig[i - 1]));
        if (i === 14) { let s0 = 0; for (let q = 1; q <= 14; q++) s0 += Math.max(highs[q] - lows[q], Math.abs(highs[q] - sig[q - 1]), Math.abs(lows[q] - sig[q - 1])); atr = s0 / 14; }
        else if (i > 14) atr = (atr * 13 + tr) / 14;
        if (atr != null && sig[i] > 0) atrPct[i] = (atr / sig[i]) * 100;
      } }

    // ATR de PRODUCCIÓN (technicalEngine.calculateAtr): media SIMPLE de los últimos 14 TR
    let atrProdPct = null;
    if (rich) {
      atrProdPct = new Array(n).fill(null);
      const trArr = new Array(n).fill(0);
      let sTr = 0;
      for (let i = 1; i < n; i++) {
        trArr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - sig[i - 1]), Math.abs(lows[i] - sig[i - 1]));
        sTr += trArr[i]; if (i > 14) sTr -= trArr[i - 14];
        if (i >= 14 && sig[i] > 0) atrProdPct[i] = (sTr / 14 / sig[i]) * 100;
      }
    }

    // edad de la tendencia: sesiones consecutivas cerrando sobre la EMA50 (réplica producción)
    const ageArr = new Array(n).fill(0);
    { let cnt = 0;
      for (let i = 0; i < n; i++) { cnt = isNum(e50[i]) && sig[i] >= e50[i] ? cnt + 1 : 0; ageArr[i] = cnt; } }

    // SMA50/SMA200 + régimen sostenido
    const sma200 = new Array(n).fill(null);
    { let s = 0;
      for (let i = 0; i < n; i++) { s += sig[i]; if (i >= 200) s -= sig[i - 200]; if (i >= 199) sma200[i] = s / 200; } }
    let sma50 = null;
    if (rich) {
      sma50 = new Array(n).fill(null);
      let s = 0;
      for (let i = 0; i < n; i++) { s += sig[i]; if (i >= 50) s -= sig[i - 50]; if (i >= 49) sma50[i] = s / 50; }
    }
    const dayOK = new Array(n).fill(0);
    for (let i = 220; i < n; i++) dayOK[i] = isNum(sma200[i]) && isNum(sma200[i - 20]) && sig[i] > sma200[i] && sma200[i] > sma200[i - 20] ? 1 : 0;
    const regAgeArr = new Array(n).fill(0);
    { let sum50 = 0, age = 0;
      for (let i = 0; i < n; i++) {
        sum50 += dayOK[i]; if (i >= 50) sum50 -= dayOK[i - 50];
        const inReg = i >= 269 && sum50 >= 45;
        age = inReg ? age + 1 : 0;
        regAgeArr[i] = age;
      } }

    // máximo de 252 sesiones (incluye hoy) sobre la serie de señales → prox / dd52
    const hiArr = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const lookback = Math.min(i, 252);
      let hi = 0; for (let q = i - lookback + 1; q <= i; q++) if (sig[q] > hi) hi = sig[q];
      hiArr[i] = hi;
    }

    // rasgos "rich": RSI14 y volatilidad realizada 20/60 (sobre retornos ajustados)
    let rsi14 = null, vol20Arr = null, vol60Arr = null;
    if (rich) {
      rsi14 = new Array(n).fill(null);
      { let ag = 0, al = 0;
        for (let i = 1; i < n; i++) {
          const d = sig[i] - sig[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
          if (i <= 14) { ag += g / 14; al += l / 14; if (i === 14) rsi14[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
          else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; rsi14[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
        } }
      const ret = new Array(n).fill(0);
      for (let i = 1; i < n; i++) ret[i] = adj[i - 1] > 0 ? adj[i] / adj[i - 1] - 1 : 0;
      const rollSd = (win) => {
        const out = new Array(n).fill(null);
        let s = 0, s2 = 0;
        for (let i = 1; i < n; i++) {
          s += ret[i]; s2 += ret[i] * ret[i];
          if (i > win) { s -= ret[i - win]; s2 -= ret[i - win] * ret[i - win]; }
          if (i >= win) { const m = s / win; out[i] = Math.sqrt(Math.max(0, s2 / win - m * m)); }
        }
        return out;
      };
      vol20Arr = rollSd(20); vol60Arr = rollSd(60);
    }

    const mAdj = new Array(D).fill(null);
    const feat = new Array(D).fill(null);
    const rp = (i, lb) => (i - lb >= 0 && sig[i - lb] > 0 ? (sig[i] / sig[i - lb] - 1) * 100 : null);

    for (let i = 0; i < n; i++) {
      const k = dateIdx.get(bars[i].d);
      if (k === undefined) continue;
      mAdj[k] = adj[i];
      if (i < 200) continue;
      const hi = hiArr[i];
      const f = {
        m1: rp(i, 20), m3: rp(i, 63), m6: rp(i, 126), m9: rp(i, 189), m12: rp(i, 252),
        atr: atrPct[i], age: ageArr[i],
        ext50: isNum(e50[i]) && e50[i] > 0 ? (sig[i] - e50[i]) / e50[i] : null,
        prox: hi > 0 ? sig[i] / hi : null,
        regAge: regAgeArr[i], inRegime: regAgeArr[i] > 0,
      };
      if (rich) {
        const p = sig[i];
        const dd52 = f.prox != null ? f.prox - 1 : null;
        const hi10 = i >= 10 ? hiArr[i - 10] : 0;
        const dd52Prev = i >= 10 && hi10 > 0 ? sig[i - 10] / hi10 - 1 : null;
        f.atrProd = atrProdPct[i];
        f.rsi14 = rsi14[i];
        f.sma50 = sma50[i]; f.sma200 = sma200[i];
        f.dist50 = isNum(sma50[i]) && sma50[i] > 0 ? (p - sma50[i]) / sma50[i] : null;
        f.dist200 = isNum(sma200[i]) && sma200[i] > 0 ? (p - sma200[i]) / sma200[i] : null;
        f.slope50 = i >= 10 && isNum(sma50[i]) && isNum(sma50[i - 10]) && sma50[i - 10] > 0 ? sma50[i] / sma50[i - 10] - 1 : null;
        f.slope200 = i >= 20 && isNum(sma200[i]) && isNum(sma200[i - 20]) && sma200[i - 20] > 0 ? sma200[i] / sma200[i - 20] - 1 : null;
        f.dd52 = dd52;
        f.ddVel10 = dd52 != null && dd52Prev != null ? dd52 - dd52Prev : null;
        f.vol20 = vol20Arr[i]; f.vol60 = vol60Arr[i];
        f.vol2060 = isNum(vol20Arr[i]) && isNum(vol60Arr[i]) && vol60Arr[i] > 0 ? vol20Arr[i] / vol60Arr[i] : null;
      }
      feat[k] = f;
    }
    T.push({ sym, name: obj.name, adj: mAdj, feat });
  }
  return { T, dates, D, spyClose };
}

// ─── réplicas exactas de producción ─────────────────────────────────────────
export const scoreV4 = (f) => (f && isNum(f.m9) ? clamp(50 + 50 * Math.tanh(f.m9 / 75)) : null);

export function runwayScore(f) {
  let s = 50;
  if (f.age < 40) s += 25; else if (f.age < 100) s += 5; else s -= 5;
  if (f.ext50 != null) { if (f.ext50 < 0.05) s += 20; else if (f.ext50 < 0.15) s += 5; else if (f.ext50 > 0.30) s -= 10; }
  if (f.prox != null && f.prox > 0.997) s -= 15;
  return clamp(s);
}
export function runwayLevel(f) {
  const s = runwayScore(f);
  return s >= 75 ? "ALTO" : s >= 55 ? "MEDIO" : "BAJO";
}
export function entryZone(f) {
  if (f.prox == null) return "LEJOS";
  if (f.prox > 0.997) return "EN_MAXIMOS";
  if (f.prox >= 0.96) return "IDEAL";
  return "LEJOS";
}
export function trailCat(atr) { return clamp(25 + (isNum(atr) ? atr : 3) * 2, 25, 35) / 100; }
export function trailTight(atr) {
  if (!isNum(atr) || atr <= 0) return 0.10;
  const m = atr < 1.5 ? 2.0 : atr <= 3.0 ? 2.5 : 3.0;
  return clamp(atr * m, 5, 18) / 100;
}

/** Pesos por convicción (réplica assignSuggestedWeights, renormalizados a 100). */
export function convictionWeights(scores) {
  const raws = scores.map((s) => Math.max(0.1, s - 50));
  const tot = raws.reduce((x, y) => x + y, 0) || 1;
  const cl = raws.map((v) => clamp((v / tot) * 100, 4, 18));
  const sum = cl.reduce((x, y) => x + y, 0) || 1;
  return cl.map((v) => (v / sum) * 100);
}

/**
 * SIMULADOR de cartera v4 con trailing dinámico y rotación configurable.
 *
 * opts:
 *   FROM, TO       — índices del calendario maestro
 *   review         — cadencia de revisión (null = solo cartera inicial, rotación pura)
 *   topN           — tamaño de la cartera (10)
 *   conviction     — pesos por convicción (true) o iguales (false)
 *   widthOf(f)     — anchura del trailing para un rasgo dado (null = sin trailing)
 *   dailyWidth     — true: recalcular anchura cada día con el rasgo del día
 *   ratchet        — true: la anchura solo puede CEÑIRSE, nunca ensancharse
 *   pickJump(i, heldSet) — sustituto al saltar el stop (null = sin reinversión)
 *   jumpWeightOf(rep, i, h) — peso del sustituto al reinvertir (h = posición recién
 *     vendida). null (por defecto) = hereda h.w, la convención de producción.
 *     Añadido 17-ago-2026 para rally-joint-study.mjs; cambio aditivo, ruta por
 *     defecto bit a bit idéntica (el coste del salto se carga sobre h.w en AMBAS
 *     rutas — con pesos recalculados la diferencia de coste es de 2º orden a 20 pb).
 *   scoreFn(f)     — ranking en revisión (por defecto scoreV4)
 *   eligible(f, i) — filtro de candidatos en revisión (por defecto todos)
 *   weightsOf(top, i) — pesos INICIALES de la revisión (array % alineado con `top`,
 *     ya ordenado por score desc). null (por defecto) = comportamiento previo
 *     (convicción o iguales según `conviction`). Añadido 17-ago-2026 para el
 *     estudio de ponderación (rally-weighting-study.mjs); cambio aditivo, la ruta
 *     por defecto queda bit a bit idéntica (verificado contra el canon H4 round2).
 *
 * Devuelve { curve, dret, closed, wins, trades, jumpCount }.
 */
export function simulate(T, D, opts) {
  const {
    FROM, TO = D - 1, review = 84, topN = 10, conviction = true,
    widthOf = null, dailyWidth = false, ratchet = false,
    pickJump = null, scoreFn = scoreV4, eligible = null,
    weightsOf = null, jumpWeightOf = null,
  } = opts;
  let eq = 1, closed = 0, wins = 0, trades = 0, jumpCount = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  const dret = [];
  let held = []; // {ti, w, peak, trailPct, entryPx}

  const closeTrade = (h, px) => { closed++; if (isNum(px) && isNum(h.entryPx) && px > h.entryPx) wins++; };

  for (let i = FROM + 1; i <= TO; i++) {
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) {
        const t = T[h.ti]; const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum);
      }
    }
    eq *= 1 + r; curve[i] = eq; dret.push(r);

    // ── trailing stop diario + salto inmediato ──
    if (widthOf && held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const next = [];
      for (const h of held) {
        const t = T[h.ti];
        const px = t.adj[i];
        if (isNum(px)) {
          if (px > h.peak) h.peak = px;
          if (dailyWidth) {
            const f = t.feat[i];
            if (f) {
              // ctx para políticas ratchet/chandelier: ganancia acumulada y pico
              const ctx = { entryPx: h.entryPx, px, peak: h.peak,
                gain: isNum(h.entryPx) && h.entryPx > 0 ? px / h.entryPx - 1 : 0,
                peakGain: isNum(h.entryPx) && h.entryPx > 0 ? h.peak / h.entryPx - 1 : 0 };
              const w = widthOf(f, ctx);
              if (isNum(w)) h.trailPct = ratchet ? Math.min(h.trailPct, w) : w;
            }
          }
          if (px <= h.peak * (1 - h.trailPct)) {
            closeTrade(h, px);
            trades++;
            eq *= 1 - COST_BPS * (h.w / wsum);          // venta
            heldSet.delete(h.ti);
            if (pickJump) {
              const rep = pickJump(i, heldSet);
              if (rep != null) {
                const f = T[rep].feat[i];
                const w0 = f ? widthOf(f, { gain: 0, peakGain: 0 }) : null;
                eq *= 1 - COST_BPS * (h.w / wsum);      // compra del sustituto
                trades++; jumpCount++;
                const epx = T[rep].adj[i];
                next.push({ ti: rep, w: jumpWeightOf ? jumpWeightOf(rep, i, h) : h.w, peak: epx, trailPct: isNum(w0) ? w0 : 0.30, entryPx: epx });
                heldSet.add(rep);
              }
            }
            continue;
          }
        }
        next.push(h);
      }
      held = next;
    }

    // ── revisión periódica (review=null → solo la formación inicial: rotación pura) ──
    const doReview = review == null ? i === FROM + 1 : (i - FROM) % review === 0;
    if (!doReview) continue;
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      if (eligible && !eligible(f, i)) continue;
      const s = scoreFn(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, topN);
    const ws = weightsOf
      ? weightsOf(top, i)
      : conviction ? convictionWeights(top.map((c) => c.s)) : top.map(() => 100 / Math.max(top.length, 1));
    const prev = new Map(held.map((h) => [h.ti, h]));
    const newSet = new Set(top.map((c) => c.ti));
    let turn = 0;
    for (const c of top) if (!prev.has(c.ti)) turn++;
    for (const h of held) if (!newSet.has(h.ti)) { turn++; closeTrade(h, T[h.ti].adj[i]); }
    if (turn) { eq *= 1 - COST_BPS * (turn / Math.max(topN, 1)); trades += turn; }
    held = top.map((c, j) => {
      const old = prev.get(c.ti);
      const w0 = widthOf ? widthOf(c.f, { gain: 0, peakGain: 0 }) : null;
      return {
        ti: c.ti, w: ws[j],
        peak: Math.max(old?.peak ?? 0, T[c.ti].adj[i]),
        trailPct: isNum(w0) ? w0 : 0.30,
        entryPx: old?.entryPx ?? T[c.ti].adj[i],
      };
    });
  }
  // posiciones abiertas al final: cuentan para el winrate a último precio (marcadas aparte)
  let openWins = 0;
  for (const h of held) { let px = null; for (let j = TO; j > FROM; j--) { if (isNum(T[h.ti].adj[j])) { px = T[h.ti].adj[j]; break; } } if (isNum(px) && px > h.entryPx) openWins++; }
  return { curve, dret, closed, wins, trades, jumpCount, open: held.length, openWins };
}

/** Métricas de una curva: CAGR, MDD, MAR, Sharpe aprox y peor mitad. */
export function evalCurve(curve, FROM, D, dret = null) {
  const TO = D - 1;
  const SPLIT = Math.floor((TO - FROM) / 2) + FROM;
  const yA = (SPLIT - FROM) / 252, yB = (TO - SPLIT) / 252, yF = (TO - FROM) / 252;
  const cagr = Math.pow(curve[TO], 1 / yF) - 1;
  const a = Math.pow(curve[SPLIT] / curve[FROM], 1 / yA) - 1;
  const b = Math.pow(curve[TO] / curve[SPLIT], 1 / yB) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const vol = dret ? sd(dret) * Math.sqrt(252) : null;
  return { cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: vol > 0 ? (cagr - 0.03) / vol : null, cagrA: a, cagrB: b, worst: Math.min(a, b) };
}

/** CAGR de un tramo [from, to] de la curva. */
export function cagrOf(curve, from, to) {
  if (!isNum(curve[from]) || !isNum(curve[to]) || curve[from] <= 0) return null;
  const y = (to - from) / 252;
  return y > 0 ? Math.pow(curve[to] / curve[from], 1 / y) - 1 : null;
}

/** Buy & hold del SPY y del universo a partes iguales (con el sesgo de supervivencia del universo actual — decirlo siempre). */
export function buyHolds(T, D, spyClose, FROM, TO = D - 1) {
  let eqS = 1; const cS = new Array(D).fill(null); cS[FROM] = 1; const dS = [];
  let eqU = 1; const cU = new Array(D).fill(null); cU[FROM] = 1; const dU = [];
  for (let i = FROM + 1; i <= TO; i++) {
    const rs = spyClose[i] / spyClose[i - 1] - 1;
    eqS *= 1 + rs; cS[i] = eqS; dS.push(rs);
    let sum = 0, n = 0;
    for (const t of T) { const a = t.adj[i], b = t.adj[i - 1]; if (isNum(a) && isNum(b) && b > 0) { sum += a / b - 1; n++; } }
    const ru = n ? sum / n : 0;
    eqU *= 1 + ru; cU[i] = eqU; dU.push(ru);
  }
  return { spy: { curve: cS, dret: dS }, universe: { curve: cU, dret: dU } };
}
