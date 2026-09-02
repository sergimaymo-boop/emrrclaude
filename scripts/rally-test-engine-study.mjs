/**
 * RALLY-TEST — ESTUDIO DE MOTOR PROPIO (mandato de Sergi, 2-sep-2026)
 * ===================================================================
 * Mandato: Rally-Test deja de ser copia de producción y pasa a llevar un motor
 * de análisis DISEÑADO AQUÍ, con una sola premisa: máxima rentabilidad esperada
 * del top-10, con un cálculo que NO sea el de Rally Leaders (momentum 9m puro +
 * stops H4 + pesos M9), ni el de Supreme (dual momentum top-2 + régimen), ni el
 * del SP500 (timing de índice). Misma infraestructura y universo (~603 US+EU).
 *
 * FAMILIAS CANDIDATAS (todas cross-sectional, rebalanceo periódico, sin stops
 * intradía — diseño deliberadamente distinto al stop-céntrico de producción):
 *   VAM   momentum 126d con SALTO del último mes (skip 21) ajustado por vol —
 *         el skip evita la reversión de corto plazo; el ajuste por vol prefiere
 *         subidas sostenidas a subidas violentas.
 *   TQ    calidad de tendencia: pendiente × R² de la regresión log-precio 126d —
 *         premia tendencias LIMPIAS, no solo grandes.
 *   FIP   suavidad del camino (information discreteness, Da-Gurun-Warachka):
 *         misma subida en muchos días pequeños > un salto de una noticia
 *         (la lección MRNA de esta semana, medida académicamente).
 *   MIX   combinaciones de las anteriores (z-scores cross-sectional).
 *   CORR  selección voraz con penalización por correlación media con los ya
 *         elegidos (ataca la concentración sectorial que sufrió Rally en agosto).
 * PESOS: iguales · inversa de vol · inversa de vol NEGATIVA (downside), topes.
 * CADENCIA: 21 y 42 sesiones.
 *
 * DISCIPLINA (la de la casa, §10c en espíritu): walk-forward — ELEGIR por TRAIN
 * (2017-2021, peor-fase y media sobre ensemble de 10 fases 260..350) y CONFIRMAR
 * en 2022-2026 sin re-elegir. Costes 20 pb/lado sobre el turnover real. Cierres
 * ajustados. Referencia de contexto: C0 (producción) vía el simulador canon
 * sobre los MISMOS datos.
 *
 * HONESTIDAD: universo superviviente → niveles absolutos inflados, valen las
 * comparaciones relativas. "Ganador 100%" no existe; esto maximiza esperanza,
 * no certeza. Rally-Test es laboratorio (NO OPERAR) — nada de esto toca los
 * otros módulos.
 *
 * Salida: backtests/rally-test-engine-study.json
 */
import fs from "node:fs";
import { loadUniverse, simulate, PRESET_C0, segMetrics, COST_BPS, isNum, mean, sd, f1 } from "./rally-study-lib.mjs";

console.log(`Costes: ${(COST_BPS * 1e4).toFixed(0)} pb/lado`);
console.log("Cargando universo (cierres ajustados)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones) · split ${dates[SPLIT]}`);

// ─── retornos diarios por ticker (null-safe) ─────────────────────────────────
const N = T.length;
const RET = T.map((t) => {
  const r = new Array(D).fill(null);
  for (let i = 1; i < D; i++) {
    const a = t.adj[i], b = t.adj[i - 1];
    if (isNum(a) && isNum(b) && b > 0) r[i] = a / b - 1;
  }
  return r;
});

// ─── factores en el día i (solo pasado; ventanas ≤147 para warmup FROM=260) ──
const MOM_W = 126, MOM_SKIP = 21, TQ_W = 126, VOL_W = 126, FIP_W = 126, DV_W = 126;

// memoización: los mismos (ti, i) se piden en decenas de configs — calcular UNA vez
const _memo = new Map();
function memo(tag, ti, i, fn) {
  const k = tag + ":" + ti + ":" + i;
  if (_memo.has(k)) return _memo.get(k);
  const v = fn();
  _memo.set(k, v);
  return v;
}

function facMom(ti, i) { return memo("m", ti, i, () => _facMom(ti, i)); }
function _facMom(ti, i) {           // momentum 126d saltando el último mes, ajustado por vol
  const a = T[ti].adj[i - MOM_SKIP], b = T[ti].adj[i - MOM_SKIP - MOM_W];
  if (!isNum(a) || !isNum(b) || b <= 0) return null;
  const m = a / b - 1;
  const v = facVol(ti, i);
  if (v == null || v <= 0) return null;
  return { raw: m, adj: m / (v * Math.sqrt(252)) };
}
function facVol(ti, i) { return memo("v", ti, i, () => _facVol(ti, i)); }
function _facVol(ti, i) {           // vol diaria (sd) 126d
  const rs = [];
  for (let k = i - VOL_W + 1; k <= i; k++) { const r = RET[ti][k]; if (r != null) rs.push(r); }
  if (rs.length < VOL_W * 0.7) return null;
  return sd(rs);
}
function facDvol(ti, i) { return memo("d", ti, i, () => _facDvol(ti, i)); }
function _facDvol(ti, i) {          // vol solo de días negativos (downside)
  const rs = [];
  for (let k = i - DV_W + 1; k <= i; k++) { const r = RET[ti][k]; if (r != null && r < 0) rs.push(r); }
  if (rs.length < 10) return null;
  return sd(rs);
}
function facTQ(ti, i) { return memo("t", ti, i, () => _facTQ(ti, i)); }
function _facTQ(ti, i) {            // pendiente anualizada × R² de ln(precio) 126d
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
  const slope = sxy / sxx;                       // por sesión
  const r2 = (sxy * sxy) / (sxx * syy);
  return { slope: slope * 252, r2, tq: slope * 252 * r2 };
}
function facFIP(ti, i) { return memo("f", ti, i, () => _facFIP(ti, i)); }
function _facFIP(ti, i) {           // information discreteness: sign(mom)·(%neg−%pos)
  let pos = 0, neg = 0, tot = 0, cum = 1;
  for (let k = i - FIP_W + 1; k <= i; k++) {
    const r = RET[ti][k];
    if (r == null) continue;
    tot++; cum *= 1 + r;
    if (r > 0) pos++; else if (r < 0) neg++;
  }
  if (tot < FIP_W * 0.7) return null;
  const sign = cum - 1 > 0 ? 1 : -1;
  return sign * ((neg - pos) / tot);             // MÁS NEGATIVO = camino más suave (con mom>0)
}
// retornos semanales (bloques de 5) para correlación — 26 semanas
function weeklyRets(ti, i, weeks = 26) { return memo("w", ti, i, () => _weeklyRets(ti, i, weeks)); }
function _weeklyRets(ti, i, weeks = 26) {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const b = T[ti].adj[i - 5 * (w + 1)], a = T[ti].adj[i - 5 * w];
    if (!isNum(a) || !isNum(b) || b <= 0) return null;
    out.push(a / b - 1);
  }
  return out;
}
function corrOf(x, y) {
  const n = Math.min(x.length, y.length);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const dx = x[k] - mx, dy = y[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

const zs = (vals) => {
  const ok = vals.filter(isNum);
  const m = mean(ok), s = sd(ok) || 1;
  return vals.map((v) => (isNum(v) ? (v - m) / s : null));
};

// ─── motores candidatos ──────────────────────────────────────────────────────
// RESTRICCIÓN DE ARQUITECTURA (deliberada): el scan real puntúa cada ticker POR
// SEPARADO en lotes paralelos — el motor no ve al resto del universo. Por eso
// aquí NO hay normalización cruzada diaria: cada factor se pasa a 0-100 con una
// ESCALA FIJA (tanh, constantes a priori, documentadas), y el blend es una suma
// ponderada. Así el estudio prueba EXACTAMENTE la matemática implementable.
//   sMom  : Sharpe-momentum 126d(skip21) — c=1,0 w=0,8 (Sharpe 1 = notable, ≥3 = élite)
//   sTQ   : pendiente×R² anualizada     — c=0,5 w=0,5 (0,5 = tendencia limpia clara)
//   sSuav : −FIP (suavidad del camino)  — c=0,05 w=0,12 (positivo = más días verdes)
const squash = (x, c, w) => 50 + 50 * Math.tanh((x - c) / w);
function scoreTicker(ti, i, pesosF) {
  const m = facMom(ti, i);
  if (!m || m.raw <= 0) return null;             // universo largo: tendencia positiva
  const sMom = squash(m.adj, 1.0, 0.8);
  let s = pesosF.mom * sMom, wsum = pesosF.mom;
  if (pesosF.tq) {
    const t = facTQ(ti, i);
    if (!t) return null;
    s += pesosF.tq * squash(t.tq, 0.5, 0.5); wsum += pesosF.tq;
  }
  if (pesosF.suav) {
    const id = facFIP(ti, i);
    if (id == null) return null;
    s += pesosF.suav * squash(-id, 0.05, 0.12); wsum += pesosF.suav;
  }
  return s / wsum;                               // 0-100
}
const ENGINES = {
  VAM: { mom: 1, tq: 0, suav: 0 },
  TQ:  { mom: 0.0001, tq: 1, suav: 0 },          // mom solo como filtro de elegibilidad
  FIP: { mom: 1, tq: 0, suav: 0.5 },
  MIX: { mom: 1, tq: 1, suav: 0.5 },
};
function scoreDia(i, engine) { return memo("s" + engine, 0, i, () => _scoreDia(i, engine)); }
function _scoreDia(i, engine) {
  const pesosF = ENGINES[engine];
  const out = [];
  for (let ti = 0; ti < N; ti++) {
    if (!isNum(T[ti].adj[i])) continue;
    const s = scoreTicker(ti, i, pesosF);
    if (s != null) out.push({ ti, score: s });
  }
  return out;
}

// selección: top-K directo, o voraz con penalización por correlación λ (en
// PUNTOS de score 0-100 — implementable al finalizar el scan sobre el top-30)
function seleccionar(scored, i, K, lambda) {
  const pool = scored.slice().sort((a, b) => b.score - a.score).slice(0, 30);
  if (!lambda) return pool.slice(0, K);
  const wk = new Map();
  for (const p of pool) wk.set(p.ti, weeklyRets(p.ti, i));
  const sel = [];
  const usados = new Set();
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

// pesos: EQ, IVOL (1/vol) o IDVOL (1/downside-vol), topes [5,20], Σ=100
function pesos(sel, i, modo) {
  const K = sel.length;
  if (!K) return [];
  if (modo === "EQ") return sel.map(() => 100 / K);
  const inv = sel.map((s) => {
    const v = modo === "IVOL" ? facVol(s.ti, i) : facDvol(s.ti, i);
    return v && v > 0 ? 1 / v : 1;
  });
  // normalización con topes [5,20] por bisección (misma mecánica que producción)
  const f = (t) => inv.reduce((s, v) => s + Math.min(20, Math.max(5, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m2 = Math.sqrt(a * b); (f(m2) < 100 ? (a = m2) : (b = m2)); }
  const t = Math.sqrt(a * b);
  return inv.map((v) => Math.min(20, Math.max(5, v * t)));
}

/**
 * Simulador propio: rebalanceo cada R sesiones al cierre; ENTRE rebalanceos las
 * posiciones derivan con el precio (buy&hold real, no pesos fijos). Coste
 * 20 pb/lado sobre |Δpeso| en cada rebalanceo. Determinista, sin lookahead
 * (factores del día i usan datos ≤ i; la cartera nueva rinde desde i+1).
 */
function simular({ FROM, R, engine, lambda, wMode, K = 10 }) {
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let hold = [];                                   // {ti, w} en % (suman ~100)
  let turnoverY = 0, rebals = 0;
  for (let i = FROM; i <= TO; i++) {
    if (i > FROM) {
      let r = 0, wsum = 0;
      for (const h of hold) { wsum += h.w; const x = RET[h.ti][i]; if (x != null) r += (h.w / 100) * x; }
      if (wsum > 0) r = r * (100 / wsum);          // normaliza si algún peso quedó huérfano
      eq *= 1 + r; curve[i] = eq;
      for (const h of hold) { const x = RET[h.ti][i]; if (x != null) h.w *= 1 + x; }
      const tot = hold.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of hold) h.w = (h.w / tot) * 100;
    }
    if ((i - FROM) % R === 0) {
      const scored = scoreDia(i, engine);
      if (scored.length >= K) {
        const sel = seleccionar(scored, i, K, lambda);
        const ws = pesos(sel, i, wMode);
        const prev = new Map(hold.map((h) => [h.ti, h.w]));
        const next = sel.map((s, k) => ({ ti: s.ti, w: ws[k] }));
        let dSum = 0;
        const all = new Set([...prev.keys(), ...next.map((h) => h.ti)]);
        for (const ti of all) dSum += Math.abs((next.find((h) => h.ti === ti)?.w ?? 0) - (prev.get(ti) ?? 0));
        eq *= 1 - COST_BPS * (dSum / 100);         // 20 pb por lado ≡ pb × Σ|Δw|
        turnoverY += dSum / 100; rebals++;
        hold = next;
      }
    }
  }
  return { curve, turnoverY: turnoverY / ((TO - FROM) / 252) };
}

// ─── malla de configuraciones × ensemble de 10 fases ─────────────────────────
const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
const CONFIGS = [];
for (const engine of ["VAM", "TQ", "FIP", "MIX"])
  for (const lambda of [0, 15])
    for (const wMode of ["EQ", "IVOL", "IDVOL"])
      for (const R of [21, 42])
        CONFIGS.push({ engine, lambda, wMode, R, name: `${engine}${lambda ? "+CORR" : ""}·${wMode}·R${R}` });

console.log(`\nEvaluando ${CONFIGS.length} configuraciones × ${PHASES10.length} fases…`);
const t0 = Date.now();
const RES = [];
for (const cfg of CONFIGS) {
  const cells = PHASES10.map((FROM) => {
    const s = simular({ FROM, R: cfg.R, engine: cfg.engine, lambda: cfg.lambda, wMode: cfg.wMode });
    return { train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO), turnoverY: s.turnoverY };
  });
  const tr = cells.map((c) => c.train.cagr), cf = cells.map((c) => c.confirm.cagr);
  RES.push({
    ...cfg, cells,
    trainMean: mean(tr), trainWorst: Math.min(...tr),
    confirmMean: mean(cf), confirmWorst: Math.min(...cf),
    confirmMddMean: mean(cells.map((c) => c.confirm.mdd)),
    turnoverY: mean(cells.map((c) => c.turnoverY)),
  });
  process.stdout.write(".");
}
console.log(` listo en ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// referencia C0 (producción) sobre los MISMOS datos, mismas fases
const C0 = PHASES10.map((FROM) => {
  const r = simulate(T, D, { FROM, review: 84, topN: 10, ...PRESET_C0(T) });
  return { train: segMetrics(r.curve, FROM, SPLIT), confirm: segMetrics(r.curve, SPLIT, TO) };
});
const c0 = {
  trainMean: mean(C0.map((c) => c.train.cagr)), trainWorst: Math.min(...C0.map((c) => c.train.cagr)),
  confirmMean: mean(C0.map((c) => c.confirm.cagr)), confirmWorst: Math.min(...C0.map((c) => c.confirm.cagr)),
  confirmMddMean: mean(C0.map((c) => c.confirm.mdd)),
};

// ─── selección POR TRAIN (peor-fase; desempate media train) y reporte ────────
RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
console.log("\n═══ TOP-12 POR TRAIN (peor-fase train ‖ media train) — CONFIRM solo se mira, no elige ═══");
console.log("config                      trWorst  trMean ‖ cfMean  cfWorst  MDDcf  turn/a");
for (const r of RES.slice(0, 12)) {
  console.log(`${r.name.padEnd(26)} ${f1(r.trainWorst).padStart(7)} ${f1(r.trainMean).padStart(7)} ‖ ${f1(r.confirmMean).padStart(6)} ${f1(r.confirmWorst).padStart(8)} ${f1(r.confirmMddMean).padStart(6)} ${r.turnoverY.toFixed(1).padStart(6)}`);
}
console.log(`\nREFERENCIA C0 (producción, rev 84): trWorst ${f1(c0.trainWorst)} · trMean ${f1(c0.trainMean)} ‖ cfMean ${f1(c0.confirmMean)} · cfWorst ${f1(c0.confirmWorst)} · MDDcf ${f1(c0.confirmMddMean)}`);

const winner = RES[0];
console.log(`\n🏆 GANADOR POR TRAIN: ${winner.name}`);
console.log(`   confirm (out-of-sample de la elección): media ${f1(winner.confirmMean)} · peor fase ${f1(winner.confirmWorst)} · MDD medio ${f1(winner.confirmMddMean)}`);

fs.writeFileSync("backtests/rally-test-engine-study.json", JSON.stringify({
  ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4,
  mandato: "motor propio para Rally-Test (2-sep-2026) — elegido por TRAIN, confirm solo reporta",
  factores: { MOM_W, MOM_SKIP, TQ_W, VOL_W, FIP_W, DV_W },
  phases: PHASES10, split: dates[SPLIT], tickers: N, sesiones: D,
  results: RES, c0Ref: c0, winner: winner.name,
}, null, 1));
console.log("\nGuardado: backtests/rally-test-engine-study.json");
