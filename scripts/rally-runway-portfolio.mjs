/**
 * RALLY — BACKTEST del ranking "los 10 tickers con el rally más sano".
 *
 * El motor `rallyScoreEngine.js` nunca se había validado con datos: sus pesos
 * (33% fuerza relativa, 23% momento, 17% tendencia…) venían de literatura
 * (O'Neil, Minervini, Weinstein), no de un backtest. Esto lo mide.
 *
 * Método: en cada fecha de revisión se puntúa TODO el universo usando solo datos
 * hasta esa fecha (sin mirar al futuro), se compran los N mejores a peso igual y se
 * mantienen hasta la siguiente revisión (con opción de trailing stop).
 *
 * Se replica la fórmula del motor de producción EXACTAMENTE; hay un test de
 * equivalencia (`--verify`) que compara contra calculateRallyScore().
 */
import fs from "node:fs";

const DATA = "data/universe-10y.json";
const COST_BPS = Number(process.env.COST_BPS ?? 20) / 1e4; // 20 pb por lado

// ─── utilidades ──────────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// ─── réplica EXACTA de los normalizadores del motor de producción ────────────
const normalizeRS = (x) => (isNum(x) ? clamp(50 + 50 * Math.tanh(x / 40)) : 20);
const normLin = (v, mn, mx) => (isNum(v) ? clamp(((v - mn) / (mx - mn)) * 100) : 0);
const scoreRS = (rs3m, rs6m) => normalizeRS(rs3m ?? 0) * 0.70 + normalizeRS(rs6m ?? 0) * 0.30;
const scoreMom = (m1, m3, m6) => normLin(m1 ?? 0, -10, 20) * 0.10 + normLin(m3 ?? 0, -15, 45) * 0.60 + normLin(m6 ?? 0, -20, 65) * 0.30;
function scoreTrend(p, e20, e50, s20, s50) {
  let s = 0;
  if (isNum(p) && isNum(e20) && p > e20) s += 25;
  if (isNum(e20) && isNum(e50) && e20 > e50) s += 25;
  if (isNum(s20) && s20 > 0) s += 25;
  if (isNum(s50) && s50 > 0) s += 25;
  if (isNum(p) && isNum(e50) && p > e50) s = Math.min(100, s + 10);
  return clamp(s);
}
function scoreProx(prox) {
  if (!isNum(prox)) return 40;
  if (prox >= 1.0) return 100;
  if (prox >= 0.95) return 90;
  if (prox >= 0.85) return 70;
  if (prox >= 0.75) return 40;
  return 10;
}
function scoreRvol(rvol, p, e5) {
  if (!isNum(rvol)) return 30;
  const mult = isNum(p) && isNum(e5) && p >= e5 ? 1.0 : 0.25;
  const base = rvol >= 1.5 ? 100 : rvol >= 1.2 ? 75 : rvol >= 1.0 ? 50 : rvol >= 0.8 ? 30 : 10;
  return clamp(base * mult);
}
function scoreAtr(a) {
  if (!isNum(a)) return 30;
  const x = Math.abs(a);
  if (x >= 1.0 && x <= 2.5) return 100;
  if (x >= 0.5 && x < 1.0) return 60;
  if (x > 2.5 && x <= 4.0) return 70;
  if (x < 0.5) return 20;
  return 30;
}
function scoreLiq(avgValue20, region) {
  const minValue = region === "USA" ? 10_000_000 : 5_000_000;
  let s = 100;
  if (isNum(avgValue20) && avgValue20 < minValue) s -= 50;
  return clamp(s); // el spread no está disponible en histórico: se omite (afecta igual a todos)
}
function penalties(base, { p, e20, e50, m1, m3, rvol, rs5d }) {
  let pen = 0;
  if (isNum(p) && isNum(e20) && e20 > 0) {
    const ext = (p - e20) / e20;
    if (ext > 0.30) pen += 25; else if (ext > 0.20) pen += 15; else if (ext > 0.15) pen += 8;
  }
  if (isNum(p) && isNum(e50) && p < e50) pen += 20;
  if (isNum(m1) && m1 > 40) pen += 10;
  if (isNum(m1) && m1 > 60) pen += 15;
  if (isNum(rvol) && rvol > 3.5) pen += 15;
  if (isNum(rs5d) && rs5d < -8) pen += 8;
  if (isNum(rs5d) && rs5d < -15) pen += 8;
  if (isNum(m3) && isNum(m1) && m3 > 15 && m1 < -5) pen += 8;
  return clamp(base - pen);
}

// ─── carga y preparación ─────────────────────────────────────────────────────
console.log("Cargando universo…");
const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const series = raw.series;
const spyRaw = series["SPY.US"]?.bars;
if (!spyRaw) throw new Error("Falta SPY.US en el histórico");

const dates = spyRaw.map((b) => b.d);
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const D = dates.length;
const spyClose = spyRaw.map((b) => b.a);

function emaSeriesOf(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function retPct(v, i, lb) {
  if (i - lb < 0) return null;
  const past = v[i - lb];
  return past > 0 ? ((v[i] - past) / past) * 100 : null;
}

// El benchmark se necesita indexado por fecha para la fuerza relativa.
const spyRet = (i, lb) => retPct(spyClose, i, lb);

console.log("Precomputando indicadores por ticker…");
const T = [];
for (const [sym, obj] of Object.entries(series)) {
  if (sym === "SPY.US") continue;
  const bars = obj.bars;
  if (!bars || bars.length < 300) continue;
  const n = bars.length;
  const closes = bars.map((b) => b.c);       // precio sin ajustar: para las señales técnicas
  const adj = bars.map((b) => b.a);          // ajustado: para la RENTABILIDAD real
  const highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v);
  const e5 = emaSeriesOf(closes, 5), e20 = emaSeriesOf(closes, 20), e50 = emaSeriesOf(closes, 50);

  // ATR de Wilder a 14
  const atrPct = new Array(n).fill(null);
  { let atr = null;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      atr = atr == null ? (i >= 14 ? tr : null) : (atr * 13 + tr) / 14;
      if (i === 14) { let s = 0; for (let k = 1; k <= 14; k++) s += Math.max(highs[k] - lows[k], Math.abs(highs[k] - closes[k - 1]), Math.abs(lows[k] - closes[k - 1])); atr = s / 14; }
      if (atr != null && closes[i] > 0) atrPct[i] = (atr / closes[i]) * 100;
    } }

  // Se proyecta cada barra del ticker sobre el calendario maestro (SPY).
  const mi = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) { const k = dateIdx.get(bars[i].d); if (k !== undefined) mi[i] = k; }

  const mAdj = new Array(D).fill(null);      // precio ajustado por fecha (rentabilidad)
  const mClose = new Array(D).fill(null);
  const mLow = new Array(D).fill(null);
  const feat = new Array(D).fill(null);      // rasgos listos para puntuar

  for (let i = 0; i < n; i++) {
    const k = mi[i]; if (k < 0) continue;
    mAdj[k] = adj[i]; mClose[k] = closes[i]; mLow[k] = lows[i];
    if (i < 130) continue;

    const p = closes[i];
    const s20 = isNum(e20[i]) && isNum(e20[i - 5]) && e20[i - 5] !== 0 ? ((e20[i] - e20[i - 5]) / e20[i - 5]) * 100 : null;
    const s50 = isNum(e50[i]) && isNum(e50[i - 5]) && e50[i - 5] !== 0 ? ((e50[i] - e50[i - 5]) / e50[i - 5]) * 100 : null;
    const m1 = retPct(closes, i, 20), m3 = retPct(closes, i, 63), m6 = retPct(closes, i, 126);
    const v20 = vols.slice(i - 19, i + 1), v40 = vols.slice(i - 39, i - 19);
    const av20 = mean(v20), avPrev = mean(v40);
    const rvol = avPrev > 0 ? av20 / avPrev : null;
    const lookback = Math.min(i, 252);
    let hi = 0; for (let k2 = i - lookback + 1; k2 <= i; k2++) if (closes[k2] > hi) hi = closes[k2];
    // Fuerza relativa contra el S&P 500, en la MISMA fecha de calendario.
    const rs3m = m3 != null && spyRet(k, 63) != null ? m3 - spyRet(k, 63) : null;
    const rs6m = m6 != null && spyRet(k, 126) != null ? m6 - spyRet(k, 126) : null;
    const r5 = retPct(closes, i, 5);
    const rs5d = r5 != null && spyRet(k, 5) != null ? r5 - spyRet(k, 5) : null;

    feat[k] = { p, e5: e5[i], e20: e20[i], e50: e50[i], s20, s50, m1, m3, m6,
                rvol, atr: atrPct[i], av: av20 * p, prox: hi > 0 ? p / hi : null, rs3m, rs6m, rs5d };
  }
  T.push({ sym, name: obj.name, region: obj.exchange === "US" ? "USA" : "EU", adj: mAdj, close: mClose, low: mLow, feat });
}
console.log(`Tickers utilizables: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);


// ─── PRUEBA DECISIVA: ¿el filtro de "recorrido restante" mejora la CARTERA? ───
const W_RSM = { rs: 0.50, mom: 0.50 };
const scoreV3 = (f) => (f ? clamp(scoreRS(f.rs3m, f.rs6m) * W_RSM.rs + scoreMom(f.m1, f.m3, f.m6) * W_RSM.mom) : null);
function trailingPctOf(atrPct) {
  if (!isNum(atrPct) || atrPct <= 0) return 0.10;
  const a = Math.abs(atrPct);
  const mult = a < 1.5 ? 2.0 : a <= 3.0 ? 2.5 : 3.0;
  return clamp(a * mult, 5, 18) / 100;
}

/** Edad de la tendencia: sesiones consecutivas cerrando sobre la EMA50. */
function trendAgeAt(t, i) {
  let n = 0;
  for (let j = i; j > Math.max(130, i - 400); j--) {
    const px = t.close[j]; if (!isNum(px)) continue;
    const f = t.feat[j]; if (!f || !isNum(f.e50) || px < f.e50) break;
    n++;
  }
  return n;
}

/**
 * Puntuación de RECORRIDO RESTANTE (0-100), solo con lo que sobrevivió en AMBAS
 * mitades del estudio (scripts/rally-runway-study.mjs):
 *   · tendencia JOVEN (<40 sesiones sobre EMA50)  → más recorrido por delante
 *   · POCO EXTENDIDA sobre la EMA50 (<5%)          → el tramo aún no se ha estirado
 *   · NO en máximos de 52 semanas (>99,7%)         → penaliza, peor en ambas mitades
 * ATR alto salió bien en las dos mitades pero es un efecto de "trailing más ancho"
 * (más volatilidad = más margen antes de saltar): se prueba por separado.
 */
function runwayScore(t, i, f, useAtr) {
  if (!f) return null;
  let s = 50;
  const age = trendAgeAt(t, i);
  if (age < 40) s += 25; else if (age < 100) s += 5; else s -= 5;
  const ext50 = isNum(f.e50) && f.e50 > 0 ? (f.p - f.e50) / f.e50 : null;
  if (ext50 != null) { if (ext50 < 0.05) s += 20; else if (ext50 < 0.15) s += 5; else if (ext50 > 0.30) s -= 10; }
  if (f.prox != null && f.prox > 0.997) s -= 15;
  if (useAtr && isNum(f.atr) && f.atr > 4.5) s += 15;
  return clamp(s);
}

/**
 * Simulador de cartera. `trail`: gestionar salidas con trailing stop (como opera
 * Sergi). `runwayMode`: "off" | "filter" (solo entra si supera umbral) | "blend"
 * (ordena por rallyScore + recorrido).
 */
function portfolio({ topN = 10, review = 84, trail = false, runwayMode = "off", runwayMin = 65,
                     useAtr = false, blendW = 0.5, label = "", trailMult = null, redeploy = false }) {
  const FROM = 260, TO = D - 1;
  let eq = 1, trades = 0, daysIn = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1; const dret = [];
  let held = []; // {ti, peak, trailPct}

  for (let i = FROM + 1; i <= TO; i++) {
    let r = 0;
    if (held.length) {
      for (const h of held) { const t = T[h.ti]; const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) / held.length; }
      daysIn++;
    }
    eq *= 1 + r; curve[i] = eq; dret.push(r);

    // salidas por trailing stop (se revisan a diario)
    if (trail && held.length) {
      const keep = []; let freed = 0;
      for (const h of held) {
        const px = T[h.ti].adj[i];
        if (isNum(px)) { if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trailPct)) { eq *= 1 - COST_BPS / held.length; trades++; freed++; continue; } }
        keep.push(h);
      }
      held = keep;
      // REINVERSIÓN INMEDIATA: el dinero liberado no puede quedarse parado hasta la
      // siguiente revisión (hasta 84 sesiones). Se coloca en el mejor candidato libre.
      if (redeploy && freed > 0) {
        const busy = new Set(held.map((h) => h.ti));
        const pool = [];
        for (let ti = 0; ti < T.length; ti++) {
          if (busy.has(ti)) continue;
          const t = T[ti], f = t.feat[i];
          if (!f || !isNum(t.adj[i])) continue;
          const rs = scoreV3(f); if (rs == null) continue;
          let rw = null;
          if (runwayMode !== "off") { rw = runwayScore(t, i, f, useAtr); if (rw == null) continue; }
          if (runwayMode === "filter" && rw < runwayMin) continue;
          pool.push({ ti, rank: runwayMode === "blend" ? rs * (1 - blendW) + rw * blendW : rs, trailPct: trailingPctOf(f.atr) });
        }
        pool.sort((a, b) => b.rank - a.rank);
        for (const p of pool.slice(0, freed)) {
          eq *= 1 - COST_BPS / Math.max(topN, 1); trades++;
          held.push({ ti: p.ti, peak: T[p.ti].adj[i], trailPct: trailMult != null ? trailMult : p.trailPct });
        }
      }
    }

    if ((i - FROM) % review !== 0) continue;

    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const rs = scoreV3(f); if (rs == null) continue;
      let rw = null;
      if (runwayMode !== "off") { rw = runwayScore(t, i, f, useAtr); if (rw == null) continue; }
      if (runwayMode === "filter" && rw < runwayMin) continue;
      const rank = runwayMode === "blend" ? rs * (1 - blendW) + rw * blendW : rs;
      cands.push({ ti, rank, trailPct: trailingPctOf(f.atr) });
    }
    cands.sort((a, b) => b.rank - a.rank);
    const pick = cands.slice(0, topN);

    const oldSet = new Set(held.map((h) => h.ti)), newSet = new Set(pick.map((p) => p.ti));
    let turnover = 0;
    for (const ti of newSet) if (!oldSet.has(ti)) turnover++;
    for (const ti of oldSet) if (!newSet.has(ti)) turnover++;
    if (turnover) { eq *= 1 - COST_BPS * (turnover / Math.max(topN, 1)); trades += turnover; }
    const peaks = new Map(held.map((h) => [h.ti, h.peak]));
    held = pick.map((p) => ({ ti: p.ti, peak: peaks.get(p.ti) ?? T[p.ti].adj[i], trailPct: trailMult != null ? trailMult : p.trailPct }));
  }

  const years = (TO - FROM) / 252, cagr = Math.pow(eq, 1 / years) - 1;
  let peak = 0, mdd = 0;
  for (let i = FROM; i <= TO; i++) { if (curve[i] == null) continue; peak = Math.max(peak, curve[i]); mdd = Math.max(mdd, 1 - curve[i] / peak); }
  const vol = sd(dret) * Math.sqrt(252);
  return { label, cagr, mdd, mar: mdd > 0 ? cagr / mdd : 0, sharpe: vol > 0 ? (cagr - 0.03) / vol : 0,
           tradesYr: trades / years, pctIn: daysIn / (TO - FROM), curve };
}

// mitades para validar que la mejora no es de un solo periodo
const SPLIT = Math.floor((D - 260) / 2) + 260;
function halves(cfg) {
  const full = portfolio(cfg);
  const c = full.curve;
  const yA = (SPLIT - 260) / 252, yB = (D - 1 - SPLIT) / 252;
  const cagrA = Math.pow(c[SPLIT] / c[260], 1 / yA) - 1;
  const cagrB = Math.pow(c[D - 1] / c[SPLIT], 1 / yB) - 1;
  return { ...full, cagrA, cagrB, worst: Math.min(cagrA, cagrB) };
}

const f1 = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
console.log("Variante".padEnd(46), "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(6), "Sharpe".padStart(7), "1ª mitad".padStart(9), "2ª mitad".padStart(9), "PEOR".padStart(7));
const rows = [];
function run(cfg) { const r = halves(cfg); rows.push(r);
  console.log(r.label.padEnd(46), f1(r.cagr).padStart(7), f1(r.mdd).padStart(7), r.mar.toFixed(2).padStart(6),
    r.sharpe.toFixed(2).padStart(7), f1(r.cagrA).padStart(9), f1(r.cagrB).padStart(9), f1(r.worst).padStart(7)); }

console.log("\n--- referencia ---");
run({ label: "v3.0 base (sin trailing)" });

console.log("\n--- trailing SIN reinvertir (mi prueba anterior, defectuosa) ---");
run({ trail: true, label: "trailing ATR · dinero parado hasta revisión" });

console.log("\n--- trailing REINVIRTIENDO al instante (como operaría de verdad) ---");
run({ trail: true, redeploy: true, label: "trailing ATR + reinversión inmediata" });
for (const tm of [0.10, 0.15, 0.20, 0.25, 0.30]) {
  run({ trail: true, redeploy: true, trailMult: tm, label: `trailing fijo ${(tm*100).toFixed(0)}% + reinversión` });
}

console.log("\n--- trailing + reinversión, con el recorrido en la mezcla ---");
for (const blendW of [0.3, 0.5]) {
  run({ trail: true, redeploy: true, runwayMode: "blend", blendW, label: `trailing+reinv · mezcla ${Math.round((1-blendW)*100)}/${Math.round(blendW*100)}` });
}
run({ trail: true, redeploy: true, trailMult: 0.20, runwayMode: "blend", blendW: 0.3, label: "trailing 20% + reinv · mezcla 70/30" });

console.log("\n--- ¿y revisar más a menudo, ya que reinvertimos? ---");
for (const review of [42, 63]) {
  run({ trail: true, redeploy: true, trailMult: 0.20, review, label: `trailing 20% + reinv · revisión ${review}d` });
}

console.log("\n=== ORDENADO POR ROBUSTEZ (peor de las dos mitades) ===");
[...rows].sort((a,b)=>b.worst-a.worst).slice(0,10).forEach((r)=>console.log(
  r.label.padEnd(46), f1(r.cagr).padStart(7), f1(r.mdd).padStart(7), "MAR", r.mar.toFixed(2), " peor mitad", f1(r.worst)));

fs.writeFileSync("backtests/rally-runway-portfolio-2.json", JSON.stringify({ ranAt: new Date().toISOString(),
  rows: rows.map(({ curve, ...r }) => r) }, null, 1));
console.log("\nGuardado: backtests/rally-runway-portfolio-2.json");
