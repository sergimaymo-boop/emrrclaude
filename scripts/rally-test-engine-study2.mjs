/**
 * RALLY-TEST — ESTUDIO DE MOTOR PROPIO, ASALTO 2 (2-sep-2026)
 * ============================================================
 * El asalto 1 (rally-test-engine-study.mjs) probó las familias "de manual"
 * (Sharpe-momentum 126d con skip, calidad TQ, suavidad FIP) y quedó a la MITAD
 * de C0 en confirmación (25,6% vs 53,3%). Lección (coherente con la
 * super-auditoría de la casa): en este universo superviviente y este régimen,
 * el momentum CRUDO y la CONCENTRACIÓN son lo que paga; el ajuste por vol y el
 * skip del último mes diluyen la señal dominante.
 *
 * ASALTO 2 — la esquina agresiva de MI diseño (sigue siendo estructuralmente
 * distinto de Rally Leaders: rebalanceo periódico con deriva real de pesos, sin
 * stops H4, blend con calidad de tendencia, selección anti-correlación, filtro
 * de momentum absoluto de medio plazo):
 *   · ventana de momentum 126/189, skip 0/10, NIVEL crudo (escala tipo tanh
 *     sobre el % — no Sharpe)
 *   · blend con TQ (pendiente×R²) — el único factor del asalto 1 con señal
 *   · concentración K ∈ {5, 8, 10}
 *   · pesos EQ o proporcionales al score (topes)
 *   · filtro de elegibilidad: momentum 63d > 0 (higiene de momentum absoluto —
 *     NO es un stop ni un régimen de índice)
 *   · cadencia R ∈ {42, 63} · CORR λ ∈ {0, 15}
 * Misma disciplina: elegir por TRAIN (ensemble 10 fases), confirmar sin votar.
 * Salida: backtests/rally-test-engine-study2.json
 */
import fs from "node:fs";
import { loadUniverse, simulate, PRESET_C0, segMetrics, COST_BPS, isNum, mean, sd, f1 } from "./rally-study-lib.mjs";

console.log(`Costes: ${(COST_BPS * 1e4).toFixed(0)} pb/lado`);
console.log("Cargando universo (cierres ajustados)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones) · split ${dates[SPLIT]}`);

const N = T.length;
const RET = T.map((t) => {
  const r = new Array(D).fill(null);
  for (let i = 1; i < D; i++) {
    const a = t.adj[i], b = t.adj[i - 1];
    if (isNum(a) && isNum(b) && b > 0) r[i] = a / b - 1;
  }
  return r;
});

const _memo = new Map();
function memo(k, fn) { if (_memo.has(k)) return _memo.get(k); const v = fn(); _memo.set(k, v); return v; }

function rawMom(ti, i, W, skip) {
  return memo(`m${W}.${skip}:${ti}:${i}`, () => {
    const a = T[ti].adj[i - skip], b = T[ti].adj[i - skip - W];
    return isNum(a) && isNum(b) && b > 0 ? a / b - 1 : null;
  });
}
const TQ_W = 126;
function facTQ(ti, i) {
  return memo(`t:${ti}:${i}`, () => {
    const ys = [], xs = [];
    for (let k = i - TQ_W + 1; k <= i; k++) {
      const a = T[ti].adj[k];
      if (isNum(a) && a > 0) { ys.push(Math.log(a)); xs.push(k); }
    }
    const n = ys.length;
    if (n < TQ_W * 0.7) return null;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < n; k++) { const dx = xs[k] - mx, dy = ys[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx <= 0 || syy <= 0) return null;
    const slope = sxy / sxx;
    return { r2: (sxy * sxy) / (sxx * syy), tq: slope * 252 * ((sxy * sxy) / (sxx * syy)) };
  });
}
function weeklyRets(ti, i, weeks = 26) {
  return memo(`w:${ti}:${i}`, () => {
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const b = T[ti].adj[i - 5 * (w + 1)], a = T[ti].adj[i - 5 * w];
      if (!isNum(a) || !isNum(b) || b <= 0) return null;
      out.push(a / b - 1);
    }
    return out;
  });
}
function corrOf(x, y) {
  const n = Math.min(x.length, y.length);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const dx = x[k] - mx, dy = y[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// score por ticker con ESCALAS FIJAS (implementable en el scan por lotes):
// sMom = 50+50·tanh((mom−0,75)/0,75)  — nivel crudo: 75% a 6-9m ya es élite
// sTQ  = 50+50·tanh((tq−0,5)/0,5)
const squash = (x, c, w) => 50 + 50 * Math.tanh((x - c) / w);
function scoreTicker(ti, i, cfg) {
  const m = rawMom(ti, i, cfg.momW, cfg.momSkip);
  if (m == null || m <= 0) return null;
  if (cfg.absFilter) {
    const m63 = rawMom(ti, i, 63, 0);
    if (m63 == null || m63 <= 0) return null;    // higiene: sin momentum de medio plazo, fuera
  }
  let s = cfg.wMom * squash(m, 0.75, 0.75), wsum = cfg.wMom;
  if (cfg.wTQ) {
    const t = facTQ(ti, i);
    if (!t) return null;
    s += cfg.wTQ * squash(t.tq, 0.5, 0.5); wsum += cfg.wTQ;
  }
  return { score: s / wsum, mRaw: m };
}
function scoreDia(i, cfg) {
  return memo(`s${cfg.key}:${i}`, () => {
    const out = [];
    for (let ti = 0; ti < N; ti++) {
      if (!isNum(T[ti].adj[i])) continue;
      const r = scoreTicker(ti, i, cfg);
      if (r != null) out.push({ ti, score: r.score, mRaw: r.mRaw });
    }
    return out;
  });
}
function seleccionar(scored, i, K, lambda) {
  const pool = scored.slice().sort((a, b) => b.score - a.score || b.mRaw - a.mRaw).slice(0, 30);
  if (!lambda) return pool.slice(0, K);
  const wk = new Map();
  for (const p of pool) wk.set(p.ti, weeklyRets(p.ti, i));
  const sel = [], usados = new Set();
  while (sel.length < K && sel.length < pool.length) {
    let best = null, bv = -Infinity;
    for (let k = 0; k < pool.length; k++) {
      if (usados.has(k)) continue;
      const w = wk.get(pool[k].ti);
      let pen = 0;
      if (w && sel.length) {
        let s = 0, n = 0;
        for (const sIdx of sel) { const w2 = wk.get(pool[sIdx].ti); if (w2) { s += corrOf(w, w2); n++; } }
        pen = n ? s / n : 0;
      }
      const v = pool[k].score - lambda * pen;
      if (v > bv) { bv = v; best = k; }
    }
    if (best == null) break;
    usados.add(best); sel.push(best);
  }
  return sel.map((k) => pool[k]);
}
// pesos: EQ o proporcionales a (score−40) con topes que escalan con K (2× plano / 0,5× plano)
function pesos(sel, mode, K) {
  if (!sel.length) return [];
  if (mode === "EQ") return sel.map(() => 100 / sel.length);
  const lo = 50 / K, hi = 200 / K;
  const raw = sel.map((s) => Math.max(1, s.score - 40));
  const f = (t) => raw.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m2 = Math.sqrt(a * b); (f(m2) < 100 ? (a = m2) : (b = m2)); }
  const t = Math.sqrt(a * b);
  return raw.map((v) => Math.min(hi, Math.max(lo, v * t)));
}

function simular({ FROM, cfg }) {
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let hold = [];
  for (let i = FROM; i <= TO; i++) {
    if (i > FROM) {
      let r = 0, wsum = 0;
      for (const h of hold) { wsum += h.w; const x = RET[h.ti][i]; if (x != null) r += (h.w / 100) * x; }
      if (wsum > 0) r = r * (100 / wsum);
      eq *= 1 + r; curve[i] = eq;
      for (const h of hold) { const x = RET[h.ti][i]; if (x != null) h.w *= 1 + x; }
      const tot = hold.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of hold) h.w = (h.w / tot) * 100;
    }
    if ((i - FROM) % cfg.R === 0) {
      const scored = scoreDia(i, cfg);
      if (scored.length >= cfg.K) {
        const sel = seleccionar(scored, i, cfg.K, cfg.lambda);
        const ws = pesos(sel, cfg.wMode, cfg.K);
        const prev = new Map(hold.map((h) => [h.ti, h.w]));
        const next = sel.map((s, k) => ({ ti: s.ti, w: ws[k] }));
        let dSum = 0;
        const all = new Set([...prev.keys(), ...next.map((h) => h.ti)]);
        for (const ti of all) dSum += Math.abs((next.find((h) => h.ti === ti)?.w ?? 0) - (prev.get(ti) ?? 0));
        eq *= 1 - COST_BPS * (dSum / 100);
        hold = next;
      }
    }
  }
  return { curve };
}

// ─── malla del asalto 2 ──────────────────────────────────────────────────────
const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
const CONFIGS = [];
let ck = 0;
for (const [momW, momSkip] of [[189, 10], [126, 0]])
  for (const wTQ of [0, 0.5])
    for (const absFilter of [false, true])
      for (const K of [5, 8, 10])
        for (const wMode of ["EQ", "SCORE"])
          for (const R of [42, 63])
            for (const lambda of [0, 15])
              CONFIGS.push({
                key: ck++, momW, momSkip, wMom: 1, wTQ, absFilter, K, wMode, R, lambda,
                name: `M${momW}s${momSkip}${wTQ ? "+TQ" : ""}${absFilter ? "+ABS" : ""}·K${K}·${wMode}·R${R}${lambda ? "+CORR" : ""}`,
              });

console.log(`\nEvaluando ${CONFIGS.length} configuraciones × ${PHASES10.length} fases…`);
const t0 = Date.now();
const RES = [];
for (const cfg of CONFIGS) {
  const cells = PHASES10.map((FROM) => {
    const s = simular({ FROM, cfg });
    return { train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO) };
  });
  const tr = cells.map((c) => c.train.cagr), cf = cells.map((c) => c.confirm.cagr);
  RES.push({
    name: cfg.name, cfg: { ...cfg, key: undefined },
    trainMean: mean(tr), trainWorst: Math.min(...tr),
    confirmMean: mean(cf), confirmWorst: Math.min(...cf),
    confirmMddMean: mean(cells.map((c) => c.confirm.mdd)),
    cells,
  });
  if (RES.length % 24 === 0) process.stdout.write(`${RES.length} `);
}
console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const C0 = PHASES10.map((FROM) => {
  const r = simulate(T, D, { FROM, review: 84, topN: 10, ...PRESET_C0(T) });
  return { train: segMetrics(r.curve, FROM, SPLIT), confirm: segMetrics(r.curve, SPLIT, TO) };
});
const c0 = {
  trainMean: mean(C0.map((c) => c.train.cagr)), trainWorst: Math.min(...C0.map((c) => c.train.cagr)),
  confirmMean: mean(C0.map((c) => c.confirm.cagr)), confirmWorst: Math.min(...C0.map((c) => c.confirm.cagr)),
  confirmMddMean: mean(C0.map((c) => c.confirm.mdd)),
};

RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("\n═══ TOP-15 POR TRAIN (peor-fase ‖ media) — CONFIRM no vota ═══");
console.log("config                                trWorst  trMean ‖ cfMean  cfWorst  MDDcf");
for (const r of RES.slice(0, 15)) {
  console.log(`${r.name.padEnd(37)} ${f1(r.trainWorst).padStart(7)} ${f1(r.trainMean).padStart(7)} ‖ ${f1(r.confirmMean).padStart(6)} ${f1(r.confirmWorst).padStart(8)} ${f1(r.confirmMddMean).padStart(6)}`);
}
console.log(`\nREFERENCIA C0: trWorst ${f1(c0.trainWorst)} · trMean ${f1(c0.trainMean)} ‖ cfMean ${f1(c0.confirmMean)} · cfWorst ${f1(c0.confirmWorst)} · MDDcf ${f1(c0.confirmMddMean)}`);
console.log(`ASALTO 1 (mejor): TQ+CORR·EQ·R42 → cfMean 25.6%`);

const winner = RES[0];
console.log(`\n🏆 GANADOR ASALTO 2 POR TRAIN: ${winner.name}`);
console.log(`   confirm: media ${f1(winner.confirmMean)} · peor ${f1(winner.confirmWorst)} · MDD ${f1(winner.confirmMddMean)}`);

fs.writeFileSync("backtests/rally-test-engine-study2.json", JSON.stringify({
  ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4,
  phases: PHASES10, split: dates[SPLIT], tickers: N, sesiones: D,
  results: RES.map((r) => ({ ...r, cells: r.cells })), c0Ref: c0, winner: winner.name,
}, null, 1));
console.log("Guardado: backtests/rally-test-engine-study2.json");
