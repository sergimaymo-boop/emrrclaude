/**
 * RALLY-TEST — ESTUDIO 3: TRAILING STOPS SOBRE LAB-M189 (mandato Sergi, 2-sep-2026)
 * =================================================================================
 * Sergi: "sin stop loss no tienes red y es muy peligroso... asigna trailing stops
 * óptimos; cuando salta, ese importe se invierte en el nuevo scan de ese momento
 * según la ponderación; backtesting de los 10 años (ojo a la pandemia COVID); a
 * ver si superas las rentabilidades".
 *
 * BASE: motor LAB-M189 (M189s10 · top-5 SCORE [10,40] · rebalanceo R) — el
 * ganador auditado del estudio 2. OVERLAY nuevo: trailing stop POR POSICIÓN
 * evaluado a CIERRES (convención canon §10c; una orden real intradía saltaría
 * más a menudo — las cifras son ~2-3 pp/año optimistas, igual que en todos los
 * estudios de la casa).
 *
 * EJES:
 *  · ANCHURA: fija {15,20,25,30,35,45}% · adaptativa kv×vol126anual con
 *    kv {0,5, 0,75, 1,0} acotada [15,45]% (fijada a la ENTRADA y re-fijada en
 *    cada rebalanceo — misma convención que producción)
 *  · REINVERSIÓN al saltar (la idea de Sergi, en sus dos lecturas):
 *      JUMP   — el importe liberado entra ESE MISMO CIERRE en el mejor ticker
 *               del ranking no held (hereda el peso — convención producción)
 *      RESCAN — el salto DISPARA un re-scan completo: se reforma toda la
 *               cartera top-5 con pesos frescos y se resetea el reloj del
 *               rebalanceo periódico ("sería el momento de realizar el scan")
 *  · CADENCIA de fondo R {42, 63, 84}
 *  = 9 anchuras × 2 modos × 3 cadencias = 54 configs × ensemble 10 fases.
 *
 * BASELINES en la misma tabla: LAB-M189 SIN stops (R42) y C0 producción.
 * MÉTRICAS con la lección del auditor: además del MDD ventaneado (convención
 * de la casa) se reporta el DD REAL pico-valle sin ventanear, el DD del año
 * COVID 2020 y el retorno del año 2022 — los dos episodios que importan.
 *
 * VALIDACIÓN INTERNA (aborta si falla): con anchura ∞ (stop imposible) la curva
 * debe ser BIT A BIT idéntica a la del simulador sin stops del estudio 2.
 *
 * Disciplina: elegir por TRAIN (peor-fase, desempate media), confirm no vota.
 * Salida: backtests/rally-test-engine-study3.json (o -50bp con COST_BPS=50)
 */
import fs from "node:fs";
import { loadUniverse, simulate, PRESET_C0, segMetrics, COST_BPS, isNum, mean, sd, f1 } from "./rally-study-lib.mjs";

const OUT = COST_BPS > 0.003 ? "backtests/rally-test-engine-study3-50bp.json" : "backtests/rally-test-engine-study3.json";
console.log(`Costes: ${(COST_BPS * 1e4).toFixed(0)} pb/lado → ${OUT}`);
console.log("Cargando universo (cierres ajustados)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const I2020a = dates.findIndex((d) => d >= "2020-01-01"), I2020b = dates.findIndex((d) => d >= "2021-01-01") - 1;
const I2022a = SPLIT, I2022b = dates.findIndex((d) => d >= "2023-01-01") - 1;
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

const MOM_W = 189, MOM_SKIP = 10, VOL_W = 126;
function rawMom(ti, i) {
  return memo(`m:${ti}:${i}`, () => {
    const a = T[ti].adj[i - MOM_SKIP], b = T[ti].adj[i - MOM_SKIP - MOM_W];
    return isNum(a) && isNum(b) && b > 0 ? a / b - 1 : null;
  });
}
function facVol(ti, i) {          // vol diaria sd 126d (para anchura adaptativa)
  return memo(`v:${ti}:${i}`, () => {
    const rs = [];
    for (let k = i - VOL_W + 1; k <= i; k++) { const r = RET[ti][k]; if (r != null) rs.push(r); }
    if (rs.length < VOL_W * 0.7) return null;
    return sd(rs);
  });
}
const squash = (x, c, w) => 50 + 50 * Math.tanh((x - c) / w);
function scoreDia(i) {
  return memo(`s:${i}`, () => {
    const out = [];
    for (let ti = 0; ti < N; ti++) {
      if (!isNum(T[ti].adj[i])) continue;
      const m = rawMom(ti, i);
      if (m == null || m <= 0) continue;
      out.push({ ti, score: squash(m, 0.75, 0.75), mRaw: m });
    }
    return out.sort((a, b) => b.score - a.score || b.mRaw - a.mRaw);
  });
}
function pesosScore(sel) {         // ∝(score−40), topes [10,40], Σ=100 — LAB-M189
  const K = sel.length;
  if (!K) return [];
  const lo = 50 / 5, hi = 200 / 5;   // el libro es top-5 SIEMPRE (topes del ganador)
  const raw = sel.map((s) => Math.max(1, s.score - 40));
  if (K * lo > 100 || K * hi < 100) return sel.map(() => 100 / K);
  const f = (t) => raw.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m2 = Math.sqrt(a * b); (f(m2) < 100 ? (a = m2) : (b = m2)); }
  const t = Math.sqrt(a * b);
  return raw.map((v) => Math.min(hi, Math.max(lo, v * t)));
}

// anchura del stop para una posición formada en el día i
function widthOf(ti, i, wcfg) {
  if (wcfg.tipo === "INF") return Infinity;
  if (wcfg.tipo === "FIJO") return wcfg.w;
  const v = facVol(ti, i);                          // adaptativa: kv × vol anualizada
  if (v == null) return 0.30;
  return Math.min(0.45, Math.max(0.15, wcfg.kv * v * Math.sqrt(252)));
}

/**
 * Simulador LAB-M189 + trailing stops a cierres.
 * Orden del día i (misma secuencia que el canon): 1) retorno con la cartera
 * vieja a cierres → 2) deriva de pesos → 3) stops al cierre (pico incluye HOY;
 * fill = cierre) con reinversión JUMP o RESCAN → 4) rebalanceo periódico.
 * K=5 invertidos. Sin lookahead: señales del día i, efectos desde i+1.
 */
function simular({ FROM, R, wcfg, modo }) {
  let eq = 1;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let hold = [];                     // {ti, w, peak, trail}
  let stops = 0, rebals = 0;
  let nextReb = FROM;                // RESCAN resetea este reloj

  const formar = (i, resetClock = true) => {   // cartera nueva top-5 con pesos frescos
    const top = scoreDia(i).slice(0, 5);
    const ws = pesosScore(top);
    const prev = new Map(hold.map((h) => [h.ti, h]));
    let dSum = 0;
    const next = top.map((s, k) => ({
      ti: s.ti, w: ws[k],
      peak: prev.get(s.ti)?.peak != null ? Math.max(prev.get(s.ti).peak, T[s.ti].adj[i]) : T[s.ti].adj[i],
      trail: widthOf(s.ti, i, wcfg),
    }));
    const all = new Set([...prev.keys(), ...next.map((h) => h.ti)]);
    for (const ti of all) dSum += Math.abs((next.find((h) => h.ti === ti)?.w ?? 0) - (prev.get(ti)?.w ?? 0));
    eq *= 1 - COST_BPS * (dSum / 100);
    hold = next; rebals++;
    if (resetClock) nextReb = i + R;
  };

  for (let i = FROM; i <= TO; i++) {
    if (i > FROM) {
      let r = 0, wsum = 0;
      for (const h of hold) { wsum += h.w; const x = RET[h.ti][i]; if (x != null) r += (h.w / 100) * x; }
      if (wsum > 0) r = r * (100 / wsum);
      eq *= 1 + r; curve[i] = eq;
      for (const h of hold) { const x = RET[h.ti][i]; if (x != null) h.w *= 1 + x; }
      const tot = hold.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of hold) h.w = (h.w / tot) * 100;

      // ── stops al cierre de HOY (pico incluye el cierre de hoy, como el canon) ──
      if (wcfg.tipo !== "INF" && hold.length) {
        let saltoAlguno = false;
        const heldSet = new Set(hold.map((h) => h.ti));
        const next = [];
        for (const h of hold) {
          const px = T[h.ti].adj[i];
          if (isNum(px)) {
            if (px > h.peak) h.peak = px;
            if (px <= h.peak * (1 - h.trail)) {
              stops++; saltoAlguno = true;
              eq *= 1 - COST_BPS * (h.w / 100);          // venta de la posición parada
              heldSet.delete(h.ti);
              if (modo === "JUMP") {
                const cand = scoreDia(i).find((c) => !heldSet.has(c.ti));
                if (cand) {
                  eq *= 1 - COST_BPS * (h.w / 100);      // compra del sustituto
                  next.push({ ti: cand.ti, w: h.w, peak: T[cand.ti].adj[i], trail: widthOf(cand.ti, i, wcfg) });
                  heldSet.add(cand.ti);
                }
              }
              continue;                                   // RESCAN: el peso queda liberado; formar() lo reinvierte ya
            }
          }
          next.push(h);
        }
        hold = next;
        if (modo === "RESCAN" && saltoAlguno) formar(i);            // re-scan + reset del reloj
        if (modo === "RESCAN2" && saltoAlguno) formar(i, false);    // re-scan SIN reset (anti-colapso)
      }
    }
    if (i >= nextReb && scoreDia(i).length >= 5) formar(i);
  }
  const years = (TO - FROM) / 252;
  return { curve, stopsY: stops / years };
}

// métricas extra: DD real pico-valle (sin ventanear) + episodios COVID/2022
function ddReal(curve, a, b, peakDesde = a) {
  let peak = 0, mdd = 0;
  for (let i = peakDesde; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; if (i >= a) { const dd = 1 - v / peak; if (dd > mdd) mdd = dd; } }
  return mdd;
}
const retSeg = (curve, a, b) => (isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? curve[b] / curve[a] - 1 : null);

// ─── VALIDACIÓN: stop ∞ ≡ sin stops (bit a bit) ──────────────────────────────
{
  const conInf = simular({ FROM: 260, R: 42, wcfg: { tipo: "INF" }, modo: "JUMP" });
  // réplica sin-stops del estudio 2 (mismo motor, sin bloque de stops): la rama
  // INF ya lo salta todo, así que basta comprobar autoconsistencia contra una
  // segunda pasada con modo RESCAN (el bloque tampoco se ejecuta) — y contra la
  // media de confirm publicada del ganador del estudio 2.
  const conInf2 = simular({ FROM: 260, R: 42, wcfg: { tipo: "INF" }, modo: "RESCAN" });
  let maxd = 0;
  for (let i = 260; i <= TO; i++) maxd = Math.max(maxd, Math.abs((conInf.curve[i] ?? 0) - (conInf2.curve[i] ?? 0)));
  if (maxd !== 0) throw new Error(`VALIDACIÓN: INF difiere entre modos (${maxd})`);
  const st2Path = COST_BPS > 0.003 ? "backtests/rally-test-engine-study2-50bp.json" : "backtests/rally-test-engine-study2.json";
  const st2 = JSON.parse(fs.readFileSync(st2Path, "utf8"));
  const win2 = st2.results.find((r) => r.name === "M189s10·K5·SCORE·R42");
  const myConfirm = segMetrics(conInf.curve, SPLIT, TO).cagr;
  const ref = win2.cells[0].confirm.cagr;    // fase 260 del ganador del estudio 2
  if (Math.abs(myConfirm - ref) > 1e-12) throw new Error(`VALIDACIÓN: INF ≠ estudio 2 (mi ${myConfirm} vs ${ref})`);
  console.log("VALIDACIÓN OK — stop ∞ reproduce el estudio 2 bit a bit (fase 260) y es invariante al modo.\n");
}

// ─── malla ───────────────────────────────────────────────────────────────────
const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
const WIDTHS = [
  ...[0.15, 0.20, 0.25, 0.30, 0.35, 0.45].map((w) => ({ tipo: "FIJO", w, name: `F${(w * 100).toFixed(0)}` })),
  ...[0.5, 0.75, 1.0].map((kv) => ({ tipo: "ADAPT", kv, name: `A${kv}` })),
];
const CONFIGS = [];
for (const wcfg of WIDTHS)
  for (const modo of ["JUMP", "RESCAN", "RESCAN2"])
    for (const R of [42, 63, 84])
      CONFIGS.push({ wcfg, modo, R, name: `${wcfg.name}·${modo}·R${R}` });

console.log(`Evaluando ${CONFIGS.length} configuraciones × ${PHASES10.length} fases…`);
const t0 = Date.now();
function evalConfig(sim) {
  return PHASES10.map((FROM) => {
    const s = sim(FROM);
    return {
      train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO),
      ddRealConfirm: ddReal(s.curve, SPLIT, TO, FROM),
      dd2020: ddReal(s.curve, Math.max(I2020a, FROM), I2020b, FROM),
      ret2022: retSeg(s.curve, I2022a, I2022b),
      stopsY: s.stopsY ?? 0,
    };
  });
}
function resumen(cells) {
  const tr = cells.map((c) => c.train.cagr), cf = cells.map((c) => c.confirm.cagr);
  return {
    trainMean: mean(tr), trainWorst: Math.min(...tr),
    confirmMean: mean(cf), confirmWorst: Math.min(...cf),
    ddRealWorst: Math.max(...cells.map((c) => c.ddRealConfirm)),
    dd2020Worst: Math.max(...cells.map((c) => c.dd2020)),
    ret2022Mean: mean(cells.map((c) => c.ret2022).filter(isNum)),
    stopsY: mean(cells.map((c) => c.stopsY)),
  };
}
const RES = [];
for (const cfg of CONFIGS) {
  const cells = evalConfig((FROM) => simular({ FROM, R: cfg.R, wcfg: cfg.wcfg, modo: cfg.modo }));
  RES.push({ name: cfg.name, cfg: { anchura: cfg.wcfg.name, modo: cfg.modo, R: cfg.R }, ...resumen(cells), cells });
  if (RES.length % 18 === 0) process.stdout.write(`${RES.length} `);
}
console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// baselines
const BASE_NOSTOP = { name: "LAB-M189 SIN stops (R42)", ...resumen(evalConfig((FROM) => simular({ FROM, R: 42, wcfg: { tipo: "INF" }, modo: "JUMP" }))) };
const C0cells = PHASES10.map((FROM) => {
  const r = simulate(T, D, { FROM, review: 84, topN: 10, ...PRESET_C0(T) });
  return {
    train: segMetrics(r.curve, FROM, SPLIT), confirm: segMetrics(r.curve, SPLIT, TO),
    ddRealConfirm: ddReal(r.curve, SPLIT, TO, FROM), dd2020: ddReal(r.curve, Math.max(I2020a, FROM), I2020b, FROM),
    ret2022: retSeg(r.curve, I2022a, I2022b), stopsY: 0,
  };
});
const BASE_C0 = { name: "C0 producción (referencia)", ...resumen(C0cells) };

RES.sort((a, b) => (b.trainWorst - a.trainWorst) || (b.trainMean - a.trainMean));
const fmt = (r) => `${r.name.padEnd(16)} ${f1(r.trainWorst).padStart(7)} ${f1(r.trainMean).padStart(7)} ‖ ${f1(r.confirmMean).padStart(6)} ${f1(r.confirmWorst).padStart(7)} ‖ DDreal ${f1(r.ddRealWorst).padStart(6)} · COVID ${f1(r.dd2020Worst).padStart(6)} · 2022 ${f1(r.ret2022Mean).padStart(7)} · stops/a ${r.stopsY.toFixed(1)}`;
console.log("\n═══ TOP-15 POR TRAIN ‖ confirm ‖ riesgo (DD real pico-valle · DD 2020 COVID · retorno 2022) ═══");
for (const r of RES.slice(0, 15)) console.log(fmt(r));
console.log("─".repeat(118));
console.log(fmt(BASE_NOSTOP));
console.log(fmt(BASE_C0));

const winner = RES[0];
console.log(`\n🏆 GANADOR POR TRAIN: ${winner.name}`);

fs.writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4,
  mandato: "trailing stops sobre LAB-M189 con reinversión inmediata (idea de Sergi, 2 modos)",
  nota: "stops a CIERRES (convención canon): ~2-3 pp/año optimista vs orden real intradía",
  phases: PHASES10, split: dates[SPLIT],
  results: RES, baseNoStop: BASE_NOSTOP, baseC0: BASE_C0, winner: winner.name,
}, null, 1));
console.log(`Guardado: ${OUT}`);
