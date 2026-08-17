/**
 * LENTE CORRECCIÓN — verify-selfilter-recompute.mjs (17-ago-2026)
 * ================================================================
 * Re-derivación INDEPENDIENTE de rally-selection-filter-study.mjs:
 *   · Simulador propio (bucle diario, stops, saltos, revisión) escrito desde cero
 *     a partir de la especificación C0 — NO reutiliza simulate() de la lib.
 *   · Selección con filtro por SKIP-AND-FILL explícito (recorrer ranking saltando
 *     no-elegibles y rellenando hasta 10) — NO el truco de score penalizado −1000
 *     del estudio. Si ambos caminos dan lo mismo, el truco queda validado.
 *   · capNormalize propio (bisección lineal, no geométrica).
 *   · scoreV4 / runwayScore / estados re-implementados desde la spec de producción
 *     y contrastados contra la lib en una muestra.
 *   · Prueba de NO-LOOKAHEAD por truncación: features del día i recalculadas desde
 *     barras ≤ i y comparadas con las de la carga completa.
 *   · Prueba de equivalencia de selección: skip-and-fill vs score penalizado.
 * Variantes recomputadas (malla 9 celdas): F0, F2, F3, F3_SOLO_SEL, F6.
 * Comparación contra backtests/rally-selection-filter-study.json y contra el canon
 * M9_RAW de backtests/rally-weighting-study.json.
 * Determinista, sin escritura de JSON (solo consola).
 */
import fs from "node:fs";
import { loadUniverse, scoreV4 as libScoreV4, runwayScore as libRunway, isNum } from "./rally-study-lib.mjs";

const COST = 20 / 1e4; // 20 pb por lado
const t0 = Date.now();

// ─── re-implementaciones propias desde la spec de producción ────────────────
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const myScore = (f) => (f && typeof f.m9 === "number" && Number.isFinite(f.m9)
  ? clampN(50 + 50 * Math.tanh(f.m9 / 75), 0, 100) : null);
function myRunway(f) {
  let s = 50;
  if (f.age < 40) s += 25; else if (f.age < 100) s += 5; else s -= 5;
  if (f.ext50 != null) {
    if (f.ext50 < 0.05) s += 20; else if (f.ext50 < 0.15) s += 5; else if (f.ext50 > 0.30) s -= 10;
  }
  if (f.prox != null && f.prox > 0.997) s -= 15;
  return clampN(s, 0, 100);
}
const isBajo = (f) => myRunway(f) < 55;
const isMax = (f) => f.prox != null && f.prox > 0.997;
const isBelow = (f) => f.ext50 != null && f.ext50 < 0;
const stopW = (f) => clampN(12 + 0.35 * myRunway(f), 15, 45) / 100;

// capNormalize propio: bisección LINEAL sobre el multiplicador
function myCapNorm(raw, lo, hi, target) {
  const n = raw.length;
  if (!n) return [];
  const w = raw.map((v) => (Number.isFinite(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + clampN(v * t, lo, hi), 0);
  let a = 0, b = 1e12;
  for (let k = 0; k < 300; k++) { const m = (a + b) / 2; if (f(m) < target) a = m; else b = m; }
  const t = (a + b) / 2;
  return w.map((v) => clampN(v * t, lo, hi));
}
const wM9 = (top) => myCapNorm(top.map((c) => Math.max(1, c.f.m9 ?? 1)), 4, 20, 100);

// ─── carga ──────────────────────────────────────────────────────────────────
console.log("Cargando universo (señales AJUSTADAS, rich)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D}) · SPLIT ${SPLIT} = ${dates[SPLIT]}`);

// ─── CHEQUEO 1: mis réplicas vs la lib (muestra amplia) ─────────────────────
{
  let n = 0, bad = 0;
  for (let ti = 0; ti < T.length; ti += 7) {
    for (let i = 300; i < D; i += 97) {
      const f = T[ti].feat[i];
      if (!f) continue;
      n++;
      const s1 = myScore(f), s2 = libScoreV4(f);
      const r1 = myRunway(f), r2 = libRunway(f);
      if ((s1 ?? -1) !== (s2 ?? -1) || r1 !== r2) bad++;
    }
  }
  console.log(`CHEQUEO 1 — score/runway propios vs lib: ${n} muestras, ${bad} discrepancias ${bad ? "❌" : "✅"}`);
}

// ─── CHEQUEO 2: NO-LOOKAHEAD por truncación ─────────────────────────────────
// Recalculo m9/ext50(EMA50)/prox/age desde barras ≤ día i (código propio) y comparo.
{
  const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8"));
  const spyDates = raw.series["SPY.US"].bars.map((b) => b.d);
  const dateIdx = new Map(spyDates.map((d, i) => [d, i]));
  const syms = Object.keys(raw.series).filter((s) => s !== "SPY.US" && raw.series[s].bars.length > 2300).slice(0, 4);
  const testK = [800, 1500, 2100];
  let n = 0, bad = 0;
  for (const sym of syms) {
    const bars = raw.series[sym].bars;
    const tRef = T.find((t) => t.sym === sym);
    for (const K of testK) {
      // localizar el índice de barra cuyo date mapea al día maestro K (o el que caiga)
      let bi = -1;
      for (let q = 0; q < bars.length; q++) if (dateIdx.get(bars[q].d) === K) { bi = q; break; }
      if (bi < 260 || !tRef?.feat[K]) continue;
      const sig = bars.slice(0, bi + 1).map((b) => b.a); // TRUNCADO en i
      // EMA50 propio
      let e = sig.slice(0, 50).reduce((s, x) => s + x, 0) / 50;
      for (let q = 50; q <= bi; q++) e = sig[q] * (2 / 51) + e * (1 - 2 / 51);
      const ext50 = (sig[bi] - e) / e;
      const m9 = (sig[bi] / sig[bi - 189] - 1) * 100;
      let hi = 0; for (let q = Math.max(0, bi - 251); q <= bi; q++) if (sig[q] > hi) hi = sig[q];
      const prox = sig[bi] / hi;
      // age: consecutivas cerrando sobre EMA50 — recomputo la serie de EMA hasta bi
      const eSer = new Array(bi + 1).fill(null);
      let e2 = sig.slice(0, 50).reduce((s, x) => s + x, 0) / 50; eSer[49] = e2;
      for (let q = 50; q <= bi; q++) { e2 = sig[q] * (2 / 51) + e2 * (1 - 2 / 51); eSer[q] = e2; }
      let age = 0; for (let q = bi; q >= 0; q--) { if (eSer[q] != null && sig[q] >= eSer[q]) age++; else break; }
      const f = tRef.feat[K];
      n++;
      const ok = Math.abs(f.m9 - m9) < 1e-9 && Math.abs(f.ext50 - ext50) < 1e-12
        && Math.abs(f.prox - prox) < 1e-12 && f.age === age;
      if (!ok) { bad++; console.log(`  ✗ ${sym} @${dates[K]}: lib m9=${f.m9} mío=${m9} ext50 ${f.ext50}/${ext50} prox ${f.prox}/${prox} age ${f.age}/${age}`); }
    }
  }
  console.log(`CHEQUEO 2 — no-lookahead (features día i = features desde barras ≤ i): ${n} casos, ${bad} fallos ${bad ? "❌" : "✅"}`);
}

// ─── simulador PROPIO ───────────────────────────────────────────────────────
// v = { selFilter, rotFilter, soft }
function mySim(v, FROM, review) {
  let eq = 1, jumps = 0, fills = 0, infeas = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let held = []; // {ti, w, peak, trail, entry}

  const rankAt = (i) => {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const f = T[ti].feat[i];
      if (!f || !isNum(T[ti].adj[i])) continue;
      const s = myScore(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    return cands;
  };
  const selectTop = (cands) => {
    if (!v.selFilter) return { top: cands.slice(0, 10), filled: false };
    const elig = [], rest = [];
    for (const c of cands) (v.selFilter(c.f) ? rest : elig).push(c);
    const top = elig.slice(0, 10);
    for (const c of rest) { if (top.length >= 10) break; top.push(c); }
    return { top, filled: elig.length < 10 };
  };
  const pickJump = (i, heldSet) => {
    let bi = null, bv = -Infinity, fbi = null, fbv = -Infinity;
    for (let ti = 0; ti < T.length; ti++) {
      if (heldSet.has(ti)) continue;
      const f = T[ti].feat[i];
      if (!f || !isNum(T[ti].adj[i])) continue;
      const s = myScore(f);
      if (s == null) continue;
      const val = 0.7 * s + 0.3 * myRunway(f);
      if (val > fbv) { fbv = val; fbi = ti; }
      if (v.rotFilter && v.rotFilter(f)) continue;
      if (val > bv) { bv = val; bi = ti; }
    }
    return bi != null ? bi : fbi;
  };
  const weightsOf = (top) => {
    if (!v.soft) return wM9(top);
    const flags = top.map((c) => isBelow(c.f));
    const k = flags.filter(Boolean).length;
    if (k === 0) return wM9(top);
    const nOk = top.length - k, target = 100 - 4 * k;
    if (!(nOk > 0 && nOk * 4 <= target && nOk * 20 >= target)) { infeas++; return wM9(top); }
    const okIdx = [], okRaw = [];
    top.forEach((c, j) => { if (!flags[j]) { okIdx.push(j); okRaw.push(Math.max(1, c.f.m9 ?? 1)); } });
    const okW = myCapNorm(okRaw, 4, 20, target);
    const ws = new Array(top.length).fill(4);
    okIdx.forEach((j, q) => { ws[j] = okW[q]; });
    return ws;
  };

  for (let i = FROM + 1; i <= TO; i++) {
    // retorno diario (pesos objetivo, renormalizados a diario como en producción)
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) {
        const a = T[h.ti].adj[i], b = T[h.ti].adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum);
      }
    }
    eq *= 1 + r; curve[i] = eq;

    // stops diarios + salto inmediato
    if (held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const next = [];
      for (const h of held) {
        const px = T[h.ti].adj[i];
        if (isNum(px)) {
          if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trail)) {
            eq *= 1 - COST * (h.w / wsum);
            heldSet.delete(h.ti);
            const rep = pickJump(i, heldSet);
            if (rep != null) {
              const f = T[rep].feat[i];
              const w0 = f ? stopW(f) : null;
              eq *= 1 - COST * (h.w / wsum);
              jumps++;
              const epx = T[rep].adj[i];
              next.push({ ti: rep, w: h.w, peak: epx, trail: isNum(w0) ? w0 : 0.30, entry: epx });
              heldSet.add(rep);
            }
            continue;
          }
        }
        next.push(h);
      }
      held = next;
    }

    // revisión periódica
    if ((i - FROM) % review !== 0) continue;
    const { top, filled } = selectTop(rankAt(i));
    if (filled) fills++;
    const ws = weightsOf(top);
    const prev = new Map(held.map((h) => [h.ti, h]));
    const newSet = new Set(top.map((c) => c.ti));
    let turn = 0;
    for (const c of top) if (!prev.has(c.ti)) turn++;
    for (const h of held) if (!newSet.has(h.ti)) turn++;
    if (turn) eq *= 1 - COST * (turn / 10);
    held = top.map((c, j) => {
      const old = prev.get(c.ti);
      return {
        ti: c.ti, w: ws[j],
        peak: Math.max(old?.peak ?? 0, T[c.ti].adj[i]),
        trail: stopW(c.f),
        entry: old?.entry ?? T[c.ti].adj[i],
      };
    });
  }
  return { curve, jumps, fills, infeas };
}

function seg(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) { const x = curve[i]; if (x == null) continue; if (x > peak) peak = x; const dd = 1 - x / peak; if (dd > mdd) mdd = dd; }
  return { cagr, mdd, mar: mdd > 0 && cagr != null ? cagr / mdd : 0 };
}

// ─── CHEQUEO 3: equivalencia skip-and-fill vs score penalizado ──────────────
{
  const penalTop = (cands, fn) => {
    const pc = cands.map((c) => ({ ...c, p: fn(c.f) ? c.s - 1000 : c.s }));
    pc.sort((a, b) => b.p - a.p || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    return pc.slice(0, 10).map((c) => c.ti);
  };
  const rank = (i) => {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const f = T[ti].feat[i];
      if (!f || !isNum(T[ti].adj[i])) continue;
      const s = myScore(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    return cands;
  };
  let n = 0, bad = 0;
  const anyState = (f) => isBajo(f) || isMax(f) || isBelow(f);
  for (let i = 260 + 84; i <= TO; i += 84) {
    const cands = rank(i);
    for (const fn of [isBelow, isMax, anyState]) {
      n++;
      const elig = [], rest = [];
      for (const c of cands) (fn(c.f) ? rest : elig).push(c);
      const mine = elig.slice(0, 10); for (const c of rest) { if (mine.length >= 10) break; mine.push(c); }
      const a = mine.map((c) => c.ti).join(","), b = penalTop(cands, fn).join(",");
      if (a !== b) { bad++; console.log(`  ✗ día ${dates[i]}: skip-fill ≠ penalizado`); }
    }
  }
  console.log(`CHEQUEO 3 — selección skip-and-fill ≡ score penalizado (mismo top-10 y orden): ${n} (día×filtro), ${bad} fallos ${bad ? "❌" : "✅"}`);
}

// ─── recomputación de variantes (malla 9 celdas) ────────────────────────────
const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
const VARIANTS = {
  F0: { selFilter: null, rotFilter: null, soft: false },
  F2: { selFilter: isMax, rotFilter: isMax, soft: false },
  F3: { selFilter: isBelow, rotFilter: isBelow, soft: false },
  F3_SOLO_SEL: { selFilter: isBelow, rotFilter: null, soft: false },
  F6: { selFilter: null, rotFilter: null, soft: true },
};

const REF = JSON.parse(fs.readFileSync("backtests/rally-selection-filter-study.json", "utf8"));
const refOf = (n) => (n === "F0" ? REF.c0Referencia : REF.variantes.find((v) => v.name === n));
const WREF = JSON.parse(fs.readFileSync("backtests/rally-weighting-study.json", "utf8"));
const refM9 = WREF.esquemas.find((e) => e.name === "M9_RAW");

const pp = (x) => (x == null ? "  —  " : (x * 100).toFixed(2) + "%");
const dpp = (a, b) => (a == null || b == null ? "—" : ((a - b) * 100).toFixed(3));
const mine = {};
console.log("\n═══ RECOMPUTACIÓN INDEPENDIENTE vs JSON guardado (Δ en pp) ═══");
console.log(["Var".padEnd(12), "trCAGR".padStart(8), "Δ".padStart(7), "trPEOR".padStart(8), "Δ".padStart(7), "cfCAGR".padStart(8), "Δ".padStart(7), "cfMDD".padStart(8), "Δ".padStart(7), "cfMAR".padStart(6), "cfPEOR".padStart(8), "Δ".padStart(7), "saltos".padStart(7)].join(" "));
for (const [name, v] of Object.entries(VARIANTS)) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const r = mySim(v, FROM, review);
    const c = { FROM, review, train: seg(r.curve, FROM, SPLIT), confirm: seg(r.curve, SPLIT, TO), jumps: r.jumps, fills: r.fills, infeas: r.infeas };
    cells.push(c);
    if (FROM === 260 && review === 84) canon = c;
  }
  const worstTrain = Math.min(...cells.map((c) => c.train.cagr));
  const worstConfirm = Math.min(...cells.map((c) => c.confirm.cagr));
  mine[name] = { canon, worstTrain, worstConfirm, cells };
  const ref = refOf(name);
  console.log([name.padEnd(12),
    pp(canon.train.cagr).padStart(8), dpp(canon.train.cagr, ref.canon.train.cagr).padStart(7),
    pp(worstTrain).padStart(8), dpp(worstTrain, ref.worstTrain).padStart(7),
    pp(canon.confirm.cagr).padStart(8), dpp(canon.confirm.cagr, ref.canon.confirm.cagr).padStart(7),
    pp(canon.confirm.mdd).padStart(8), dpp(canon.confirm.mdd, ref.canon.confirm.mdd).padStart(7),
    canon.confirm.mar.toFixed(3).padStart(6),
    pp(worstConfirm).padStart(8), dpp(worstConfirm, ref.worstConfirm).padStart(7),
    `${canon.jumps}/${ref.canon.jumps}`.padStart(7)].join(" "));
  if (name !== "F0" && (canon.fills || cells.some((c) => c.fills))) console.log(`   nota ${name}: revisiones con <10 elegibles = ${cells.map((c) => c.fills).reduce((a, b) => a + b, 0)} (total malla)`);
  if (name === "F6") console.log(`   nota F6: celdas con reparto infactible (canónica) = ${canon.infeas}`);
}

// F0 vs canon M9_RAW del estudio de ponderación (cadena independiente)
console.log(`\nF0 mío vs canon M9_RAW (rally-weighting-study.json): cfCAGR Δ ${dpp(mine.F0.canon.confirm.cagr, refM9.canon.confirm.cagr)} pp · trCAGR Δ ${dpp(mine.F0.canon.train.cagr, refM9.canon.train.cagr)} pp · cfMDD Δ ${dpp(mine.F0.canon.confirm.mdd, refM9.canon.confirm.mdd)} pp`);

// ─── gate re-derivado con MIS números ───────────────────────────────────────
console.log("\n═══ GATE re-derivado (mis cifras) ═══");
const f0 = mine.F0;
for (const name of ["F2", "F3", "F3_SOLO_SEL", "F6"]) {
  const m = mine[name];
  const dC = m.canon.confirm.cagr - f0.canon.confirm.cagr;
  const dW = m.worstConfirm - f0.worstConfirm;
  const dM = m.canon.confirm.mar - f0.canon.confirm.mar;
  const dD = m.canon.confirm.mdd - f0.canon.confirm.mdd;
  const pass = (dC > 0 && dW > 0) && (dC >= 0.02 || dM >= 0.08) && (dD <= 0.05);
  console.log(`${name.padEnd(12)} ΔCAGR ${(dC * 100).toFixed(2)}pp · Δpeor ${(dW * 100).toFixed(2)}pp · ΔMAR ${dM.toFixed(3)} · ΔMaxDD ${(dD * 100).toFixed(2)}pp → ${pass ? "PASA" : "no pasa"}`);
}

// ─── caso usuario: spot-check forward EN_MAXIMOS y BELOW_EMA50 ──────────────
{
  const fwdOf = (ti, i) => { const a = T[ti].adj[i], b = T[ti].adj[i + 84]; return isNum(a) && isNum(b) && a > 0 ? b / a - 1 : null; };
  const rows = [];
  for (let i = 260 + 84; i + 84 <= TO; i += 84) {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const f = T[ti].feat[i];
      if (!f || !isNum(T[ti].adj[i])) continue;
      const s = myScore(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    for (const c of cands.slice(0, 10)) rows.push({ f: c.f, fwd: fwdOf(c.ti, i) });
  }
  for (const [k, fn] of [["EN_MAXIMOS", isMax], ["BELOW_EMA50", isBelow]]) {
    const con = rows.filter((r) => fn(r.f) && isNum(r.fwd)).map((r) => r.fwd);
    const sin = rows.filter((r) => !fn(r.f) && isNum(r.fwd)).map((r) => r.fwd);
    const mn = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const refE = REF.casoUsuario.porEstado[k];
    console.log(`caso usuario ${k}: fwd84 CON ${(mn(con) * 100).toFixed(2)}% (n=${con.length}) vs SIN ${(mn(sin) * 100).toFixed(2)}% (n=${sin.length}) · JSON: CON ${(refE.fwd84_conEstado.media * 100).toFixed(2)}% (n=${refE.fwd84_conEstado.n}) SIN ${(refE.fwd84_sinEstado.media * 100).toFixed(2)}%`);
  }
}
console.log(`\nHecho en ${((Date.now() - t0) / 1000).toFixed(0)}s`);
