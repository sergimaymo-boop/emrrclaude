/**
 * LAB-DAY CORE — núcleo compartido de la jornada de investigación Rally-Test
 * (mandato Sergi 3-sep-2026: "tienes todo el día... pruébalo todo").
 *
 * UN solo simulador parametrizable para TODAS las fases del día — nada de
 * réplicas por fase (la deriva entre copias es el bug clásico de la casa).
 *
 * ANCLAS DE VALIDACIÓN (se comprueban al importar; si fallan, todo aborta):
 *   A1: señal M189s10 · K5 · SCORE · R42 · sin stop  ≡ BIT A BIT el ganador del
 *       estudio 2 (fase 260, confirm) — backtests/rally-test-engine-study2.json
 *   A2: ídem + stop F45 · RESCAN2 · R63  ≡ BIT A BIT el ganador del estudio 3
 *       (fase 260, confirm) — backtests/rally-test-engine-study3.json
 *
 * ANTI-COLAPSO integrado: cada evaluación reporta cuántas fases del ensemble
 * son trayectorias DISTINTAS en confirm — un resultado con <10/10 se marca y
 * NUNCA se adjudica (trampa RESCAN del estudio 3).
 *
 * Convenciones fijas de la casa: cierres ajustados; señales del día i con datos
 * ≤ i, efectos desde i+1; stops a CIERRES (≈2-3 pp/año optimista vs intradía);
 * costes COST_BPS por lado sobre |Δpeso|; elegir por TRAIN, confirm no vota.
 */
import fs from "node:fs";
import { loadUniverse, segMetrics, COST_BPS, isNum, mean, sd } from "./rally-study-lib.mjs";

export { COST_BPS, isNum, mean, sd, segMetrics };

export const U = loadUniverse({ adjustedSignals: true });
export const { T, dates, D, spyClose } = U;
export const TO = D - 1;
export const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
export const I2020a = dates.findIndex((d) => d >= "2020-01-01");
export const I2020b = dates.findIndex((d) => d >= "2021-01-01") - 1;
export const I2022b = dates.findIndex((d) => d >= "2023-01-01") - 1;
export const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];

const N = T.length;
export const RET = T.map((t) => {
  const r = new Array(D).fill(null);
  for (let i = 1; i < D; i++) {
    const a = t.adj[i], b = t.adj[i - 1];
    if (isNum(a) && isNum(b) && b > 0) r[i] = a / b - 1;
  }
  return r;
});

const _memo = new Map();
export function memo(k, fn) { if (_memo.has(k)) return _memo.get(k); const v = fn(); _memo.set(k, v); return v; }
export const squash = (x, c, w) => 50 + 50 * Math.tanh((x - c) / w);

// ─── factores base (memoizados) ──────────────────────────────────────────────
export function mom(ti, i, W, skip) {
  return memo(`m${W}.${skip}:${ti}:${i}`, () => {
    const a = T[ti].adj[i - skip], b = T[ti].adj[i - skip - W];
    return isNum(a) && isNum(b) && b > 0 ? a / b - 1 : null;
  });
}
export function vol126(ti, i) {
  return memo(`v:${ti}:${i}`, () => {
    const rs = [];
    for (let k = i - 125; k <= i; k++) { const r = RET[ti][k]; if (r != null) rs.push(r); }
    if (rs.length < 88) return null;
    return sd(rs);
  });
}
export function prox252(ti, i) {          // P / máximo 252 sesiones (George-Hwang)
  return memo(`p:${ti}:${i}`, () => {
    const px = T[ti].adj[i];
    if (!isNum(px)) return null;
    let mx = 0, n = 0;
    for (let k = i - 251; k <= i; k++) { const a = T[ti].adj[k]; if (isNum(a)) { if (a > mx) mx = a; n++; } }
    return n >= 176 && mx > 0 ? px / mx : null;
  });
}
export function consistencia(ti, i) {     // nº de meses positivos en los últimos 9 (0..9)
  return memo(`c:${ti}:${i}`, () => {
    let pos = 0;
    for (let m = 0; m < 9; m++) {
      const a = T[ti].adj[i - 10 - 21 * m], b = T[ti].adj[i - 10 - 21 * (m + 1)];
      if (!isNum(a) || !isNum(b) || b <= 0) return null;
      if (a > b) pos++;
    }
    return pos;
  });
}
export function spyMom(i, W, skip) {
  return memo(`sm${W}.${skip}:${i}`, () => {
    const a = spyClose[i - skip], b = spyClose[i - skip - W];
    return isNum(a) && isNum(b) && b > 0 ? a / b - 1 : null;
  });
}
/** % del universo con M189s10 > 0 — amplitud INTERNA del universo (no es el
 *  régimen SPY-EMA200 de Supreme: mide la salud del propio caladero). */
export function breadth(i) {
  return memo(`b:${i}`, () => {
    let pos = 0, tot = 0;
    for (let ti = 0; ti < N; ti++) {
      if (!isNum(T[ti].adj[i])) continue;
      const m = mom(ti, i, 189, 10);
      if (m == null) continue;
      tot++; if (m > 0) pos++;
    }
    return tot >= 100 ? pos / tot : null;
  });
}

// ─── señal por defecto (LAB-M189) y registro de señales del día ──────────────
export function sigM189s10(ti, i) {
  const m = mom(ti, i, 189, 10);
  if (m == null || m <= 0) return null;
  return { score: squash(m, 0.75, 0.75), mRaw: m };
}

export function scoreDia(i, signalFn, sigKey) {
  return memo(`S${sigKey}:${i}`, () => {
    const out = [];
    for (let ti = 0; ti < N; ti++) {
      if (!isNum(T[ti].adj[i])) continue;
      const s = signalFn(ti, i);
      if (s != null && isNum(s.score)) out.push({ ti, score: s.score, mRaw: s.mRaw ?? s.score });
    }
    return out.sort((a, b) => b.score - a.score || b.mRaw - a.mRaw);
  });
}

// pesos: los esquemas del día. sel = [{ti, score, mRaw}]
export function pesosDe(sel, i, wcfg) {
  const K = sel.length;
  if (!K) return [];
  if (wcfg.modo === "EQ") return sel.map(() => 100 / K);
  const lo = wcfg.lo ?? 50 / K, hi = wcfg.hi ?? 200 / K;
  let raw;
  if (wcfg.modo === "SCORE") raw = sel.map((s) => Math.max(1, s.score - 40));
  else if (wcfg.modo === "MRAW") raw = sel.map((s) => Math.max(0.01, s.mRaw));
  else if (wcfg.modo === "RANKPOW") raw = sel.map((_, k) => 1 / Math.pow(k + 1, wcfg.alpha ?? 1));
  else if (wcfg.modo === "IVOLSCORE") raw = sel.map((s) => { const v = vol126(s.ti, i); return Math.max(1, s.score - 40) / Math.max(v ?? 0.02, 0.005); });
  else throw new Error("wcfg desconocido " + wcfg.modo);
  if (K * lo > 100 || K * hi < 100) return sel.map(() => 100 / K);
  const f = (t) => raw.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m2 = Math.sqrt(a * b); (f(m2) < 100 ? (a = m2) : (b = m2)); }
  const t = Math.sqrt(a * b);
  return raw.map((v) => Math.min(hi, Math.max(lo, v * t)));
}

function stopWidth(ti, i, scfg) {
  if (!scfg || scfg.tipo === "NONE") return Infinity;
  if (scfg.tipo === "FIJO") return scfg.w;
  if (scfg.tipo === "ADAPT") {
    const v = vol126(ti, i);
    if (v == null) return 0.30;
    return Math.min(scfg.hi ?? 0.45, Math.max(scfg.lo ?? 0.15, scfg.kv * v * Math.sqrt(252)));
  }
  throw new Error("scfg desconocido");
}

/**
 * SIMULADOR ÚNICO del día.
 * cfg = {
 *   FROM, R, K,
 *   signalFn, sigKey,                  — señal (ti,i)→{score,mRaw}|null
 *   wcfg: {modo,...},                  — pesos
 *   scfg: {tipo:"NONE"|"FIJO"|"ADAPT", w|kv} — trailing a cierres
 *   modoStop: "JUMP"|"RESCAN2",        — reinversión al saltar (RESCAN2 = reforma sin reset de reloj)
 *   cooldown: 0,                       — sesiones sin poder recomprar un ticker parado
 *   expoFn: null | (i)=>0..1,          — overlay de exposición (fracción invertida objetivo,
 *                                        aplicada en cada REFORMA; el resto queda en caja)
 *   breaker: null | {dd, reentry}      — CORTACIRCUITOS DE CARTERA (red para dormir):
 *       si el equity cae `dd` desde su máximo → liquidar TODO a caja (con coste).
 *       Reentrada: {tipo:"DELAY", n} tras n sesiones · {tipo:"BREADTH", umbral, fn}
 *       cuando la amplitud del universo recupera. Mientras está FUERA no se
 *       forma cartera y el equity queda plano. El pico se re-ancla al reentrar
 *       (si no, un solo crash dejaría el cortacircuitos disparado para siempre).
 *       breaker null ⇒ codepath EXACTO del original (anclas intactas).
 * }
 */
export function simular(cfg) {
  const { FROM, R, K = 5, signalFn = sigM189s10, sigKey = "M189s10",
    wcfg = { modo: "SCORE" }, scfg = { tipo: "NONE" }, modoStop = "RESCAN2",
    cooldown = 0, expoFn = null, breaker = null } = cfg;
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let hold = [];                       // {ti, w, peak, trail}
  // CAJA como "posición virtual" de retorno 0. Con expoFn null la caja es 0
  // SIEMPRE (a cero exacto, sin residuo flotante) → la aritmética queda BIT A
  // BIT idéntica a la de los estudios 2/3 (anclas). Con expoFn, la caja entra
  // en wsum del día (diluye el retorno) y se renormaliza con el resto.
  let cashW = 0;
  let stops = 0, rebals = 0, expoMin = 1;
  let nextReb = FROM;
  // cortacircuitos de cartera
  let eqPeak = 1, fuera = false, salidaEn = -1, disparos = 0, diasFuera = 0;
  const vetadoHasta = new Map();       // ti → sesión hasta la que no se puede recomprar

  const formar = (i, resetClock = true) => {
    const scored = scoreDia(i, signalFn, sigKey).filter((c) => (vetadoHasta.get(c.ti) ?? -1) < i);
    if (scored.length < K) return;
    // HISTÉRESIS opcional (cfg.hyst = H): un held se CONSERVA mientras siga en el
    // top-H del ranking; solo se venden los que caen por debajo. Sin cfg.hyst el
    // codepath es EXACTAMENTE el original (anclas intactas).
    let top;
    if (cfg.hyst) {
      const rankOf = new Map(scored.map((c, k) => [c.ti, k]));
      const kept = hold.filter((h) => (rankOf.get(h.ti) ?? 1e9) < cfg.hyst).map((h) => scored[rankOf.get(h.ti)]);
      const keptSet = new Set(kept.map((c) => c.ti));
      const fill = scored.filter((c) => !keptSet.has(c.ti)).slice(0, Math.max(0, K - kept.length));
      top = [...kept, ...fill].sort((a, b) => b.score - a.score || b.mRaw - a.mRaw).slice(0, K);
    } else top = scored.slice(0, K);
    const expo = expoFn ? Math.max(0, Math.min(1, expoFn(i))) : 1;
    if (expo < expoMin) expoMin = expo;
    const base = pesosDe(top, i, wcfg);
    const ws = expoFn ? base.map((w) => w * expo) : base;   // sin overlay: ni un ×1 flotante
    const prev = new Map(hold.map((h) => [h.ti, h]));
    let dSum = 0;
    const next = top.map((s, k) => ({
      ti: s.ti, w: ws[k],
      peak: prev.get(s.ti)?.peak != null ? Math.max(prev.get(s.ti).peak, T[s.ti].adj[i]) : T[s.ti].adj[i],
      trail: stopWidth(s.ti, i, scfg),
    }));
    const all = new Set([...prev.keys(), ...next.map((h) => h.ti)]);
    for (const ti of all) dSum += Math.abs((next.find((h) => h.ti === ti)?.w ?? 0) - (prev.get(ti)?.w ?? 0));
    eq *= 1 - COST_BPS * (dSum / 100);
    hold = next; rebals++;
    cashW = expoFn ? Math.max(0, 100 - next.reduce((s, h) => s + h.w, 0)) : 0;
    if (resetClock) nextReb = i + R;
  };

  for (let i = FROM; i <= TO; i++) {
    if (i > FROM) {
      // retorno del día — MISMA secuencia y expresiones que los estudios 2/3
      // (con cashW=0 la suma extra es +0, bit-neutra)
      let r = 0, wsum = 0;
      for (const h of hold) { wsum += h.w; const x = RET[h.ti][i]; if (x != null) r += (h.w / 100) * x; }
      wsum += cashW;
      if (wsum > 0) r = r * (100 / wsum);
      eq *= 1 + r; curve[i] = eq;
      for (const h of hold) { const x = RET[h.ti][i]; if (x != null) h.w *= 1 + x; }
      const tot = hold.reduce((s, h) => s + h.w, 0) + cashW || 1;
      for (const h of hold) h.w = (h.w / tot) * 100;
      cashW = (cashW / tot) * 100;
      // ── stops a cierre (pico incluye hoy) ──
      if (scfg && scfg.tipo !== "NONE" && hold.length) {
        let salto = false;
        const heldSet = new Set(hold.map((h) => h.ti));
        const next = [];
        for (const h of hold) {
          const px = T[h.ti].adj[i];
          if (isNum(px)) {
            if (px > h.peak) h.peak = px;
            if (px <= h.peak * (1 - h.trail)) {
              stops++; salto = true;
              eq *= 1 - COST_BPS * (h.w / 100);
              heldSet.delete(h.ti);
              if (cooldown > 0) vetadoHasta.set(h.ti, i + cooldown);
              if (modoStop === "JUMP") {
                const cand = scoreDia(i, signalFn, sigKey).find((c) => !heldSet.has(c.ti) && (vetadoHasta.get(c.ti) ?? -1) < i);
                if (cand) {
                  eq *= 1 - COST_BPS * (h.w / 100);
                  next.push({ ti: cand.ti, w: h.w, peak: T[cand.ti].adj[i], trail: stopWidth(cand.ti, i, scfg) });
                  heldSet.add(cand.ti);
                } else if (expoFn) cashW += h.w;   // sin candidato: el peso libre va a caja (solo modo overlay)
              } else if (expoFn) cashW += h.w;     // RESCAN2 con overlay: a caja hasta que formar() reinvierta
              continue;
            }
          }
          next.push(h);
        }
        hold = next;
        if (modoStop === "RESCAN2" && salto) formar(i, false);
      }
    }
    // ── CORTACIRCUITOS DE CARTERA (tras el retorno del día) ──
    if (breaker && i > FROM) {
      if (eq > eqPeak) eqPeak = eq;
      if (!fuera && eq <= eqPeak * (1 - breaker.dd)) {
        // liquidar todo a caja: coste de venta sobre lo invertido
        const inv = hold.reduce((s, h) => s + h.w, 0);
        if (inv > 0) eq *= 1 - COST_BPS * (inv / 100);
        hold = []; cashW = 100;
        fuera = true; salidaEn = i; disparos++;
      } else if (fuera) {
        diasFuera++;
        const re = breaker.reentry;
        const puede = re.tipo === "DELAY" ? (i - salidaEn) >= re.n
          : re.tipo === "BREADTH" ? ((re.fn(i) ?? 0) >= re.umbral)
          : false;
        if (puede) { fuera = false; eqPeak = eq; nextReb = i; }   // re-anclar el pico al reentrar
      }
    }
    if (!fuera && i >= nextReb) formar(i);
  }
  const years = (TO - FROM) / 252;
  return { curve, stopsY: stops / years, rebals, expoMin, disparos, pctFuera: diasFuera / (TO - FROM) };
}

// ─── métricas y evaluación de ensemble con anti-colapso ──────────────────────
export function ddReal(curve, a, b, peakDesde) {
  let peak = 0, mdd = 0;
  for (let i = peakDesde; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; if (i >= a) { const dd = 1 - v / peak; if (dd > mdd) mdd = dd; } }
  return mdd;
}
export const retSeg = (curve, a, b) => (isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? curve[b] / curve[a] - 1 : null);

export function evaluar(cfgBase) {
  const cells = PHASES10.map((FROM) => {
    const s = simular({ ...cfgBase, FROM });
    return {
      train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO),
      ddRealConfirm: ddReal(s.curve, SPLIT, TO, FROM),
      dd2020: ddReal(s.curve, Math.max(I2020a, FROM), I2020b, FROM),
      ret2022: retSeg(s.curve, SPLIT, I2022b),
      stopsY: s.stopsY, expoMin: s.expoMin,
      cfKey: Math.round(segMetrics(s.curve, SPLIT, TO).cagr * 1e10),
    };
  });
  const tr = cells.map((c) => c.train.cagr), cf = cells.map((c) => c.confirm.cagr);
  return {
    trainMean: mean(tr), trainWorst: Math.min(...tr),
    confirmMean: mean(cf), confirmWorst: Math.min(...cf),
    ddRealWorst: Math.max(...cells.map((c) => c.ddRealConfirm)),
    dd2020Worst: Math.max(...cells.map((c) => c.dd2020)),
    ret2022Mean: mean(cells.map((c) => c.ret2022).filter(isNum)),
    stopsY: mean(cells.map((c) => c.stopsY)),
    fasesDistintas: new Set(cells.map((c) => c.cfKey)).size,
    cells,
  };
}

export const f1 = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
export function fila(name, r) {
  const marca = r.fasesDistintas < 10 ? ` ⚠COLAPSO(${r.fasesDistintas}/10)` : "";
  return `${name.padEnd(30)} ${f1(r.trainWorst).padStart(7)} ${f1(r.trainMean).padStart(7)} ‖ ${f1(r.confirmMean).padStart(6)} ${f1(r.confirmWorst).padStart(7)} ‖ DD ${f1(r.ddRealWorst).padStart(6)} · 2020 ${f1(r.dd2020Worst).padStart(6)} · 2022 ${f1(r.ret2022Mean).padStart(7)} · st/a ${r.stopsY.toFixed(1)}${marca}`;
}

// ─── ANCLAS DE VALIDACIÓN ────────────────────────────────────────────────────
{
  const sufijo = COST_BPS > 0.003 ? "-50bp" : "";
  const s2 = JSON.parse(fs.readFileSync(`backtests/rally-test-engine-study2${sufijo}.json`, "utf8"));
  const w2 = s2.results.find((r) => r.name === "M189s10·K5·SCORE·R42");
  const a1 = simular({ FROM: 260, R: 42, K: 5, scfg: { tipo: "NONE" } });
  const c1 = segMetrics(a1.curve, SPLIT, TO).cagr;
  if (Math.abs(c1 - w2.cells[0].confirm.cagr) > 1e-12) throw new Error(`ANCLA A1 FALLA: ${c1} vs ${w2.cells[0].confirm.cagr}`);

  const s3 = JSON.parse(fs.readFileSync(`backtests/rally-test-engine-study3${sufijo}.json`, "utf8"));
  const w3 = s3.results.find((r) => r.name === "F45·RESCAN2·R63");
  const a2 = simular({ FROM: 260, R: 63, K: 5, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2" });
  const c2 = segMetrics(a2.curve, SPLIT, TO).cagr;
  if (Math.abs(c2 - w3.cells[0].confirm.cagr) > 1e-12) throw new Error(`ANCLA A2 FALLA: ${c2} vs ${w3.cells[0].confirm.cagr}`);
  console.log("ANCLAS OK — el núcleo reproduce BIT A BIT los ganadores auditados de los estudios 2 y 3 (fase 260).");
}
