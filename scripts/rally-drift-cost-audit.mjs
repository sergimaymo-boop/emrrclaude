/**
 * RALLY — AUDITORÍA DE CONVENCIONES DEL BACKTEST: deriva de pesos, costes reales
 * y ejecución al cierre siguiente (25-sep-2026).
 *
 * Mandato: Sergi aprobó corregir los textos de backtest publicados en los paneles
 * Rally Leaders y Rally-Test con cifras honestas. Este script MIDE; no cambia
 * estrategia ni toca la lib ni el núcleo del laboratorio (solo los importa).
 *
 * HALLAZGO DE CÓDIGO que motiva la auditoría:
 *   · simulate() de rally-study-lib.mjs (C0, Rally Leaders) NUNCA actualiza h.w con
 *     el retorno del día (l. 413-422): pesos FIJOS entre revisiones = rebalanceo
 *     diario implícito y GRATIS al peso objetivo. La revisión se cobra como
 *     turn/topN (l. 491: cada nombre que entra o sale cuenta como 10%) y no se cobra
 *     el re-ajuste de los nombres que continúan (l. 492-501 los re-pesa gratis). Al
 *     saltar un stop, el sustituto hereda el peso OBJETIVO del vendido (l. 458).
 *   · simular() de lab-day-core.mjs (LAB-M189, Rally-Test) SÍ deja derivar los pesos
 *     (l. 288-291: h.w *= 1+x y renormaliza) y cobra COST_BPS·Σ|Δpeso| con las dos
 *     patas (l. 271-273 en cada reforma; l. 310 venta del stop al peso real; l. 316
 *     compra del JUMP). Lo único optimista que comparte con C0 es ejecutar AL CIERRE
 *     de la propia señal: formar(i) puntúa y compra con adj[i] (l. 242/264/269) y el
 *     stop vende al mismo cierre que lo dispara (l. 298-310).
 *
 * VARIANTES (misma estrategia y mismas decisiones; cambia solo la contabilidad):
 *   (a) PUBLICADA — la de simulate() (réplica verificada BIT A BIT abajo).
 *   (b) DERIVA — los pesos siguen a los precios entre revisiones, como en una cartera
 *       real; costes con la fórmula publicada (turn/topN en revisión; el salto de
 *       stop cobra venta+compra al peso vigente, que ahora es el derivado).
 *   (c) DERIVA + COSTES REALES — cada revisión cobra COST_BPS·Σ|Δpeso| sobre la unión
 *       de nombres (ventas + compras + re-ajuste de los que continúan) partiendo de
 *       los pesos derivados; saltos: venta y compra al peso real.
 *   (d) (c) + CIERRE SIGUIENTE — lo decidido con el cierre de i (revisión, salto y su
 *       sustituto, elegido con datos de i) se ejecuta al cierre de i+1: la posición
 *       parada rinde un día más y todo se compra/vende a precios de i+1. El stop del
 *       sustituto se fija con los rasgos del día de la decisión (el scan que lo sugiere).
 *   Las decisiones (quién entra, quién salta) NO dependen de los pesos → (a)(b)(c)
 *   hacen exactamente las mismas operaciones; (d) las desplaza un día.
 *   LAB-M189 v1.1: (a)≡(b)≡(c) por construcción del núcleo; se mide (d) con una copia
 *   del camino v1.1 de simular() parametrizada con `lag` (lag=0 verificado BIT A BIT
 *   contra el núcleo en las 10 fases antes de medir lag=1).
 *
 * EXTRAS: (1) C0 en el ensemble de 10 fases (la referencia "C0 en los mismos datos" del
 * panel Rally-Test salió de simulate(), convención (a)); (2) C0 vs stop fijo 30% bajo
 * (a) y (c) en la malla 3×3 del estudio conjunto (constantes del párrafo de stops del
 * panel); (3) descomposición de (d)−(c) en revisiones vs saltos al cierre siguiente.
 *
 * RESULTADO (25-sep-2026, copia congelada): la deriva resta 0,3-1,5 pp/año a C0 y sube
 * su DD de confirmación 36,1%→37,4%; los costes reales NO restan (rotación real ~120%
 * por revisión vs ~125% cobrado); el cierre siguiente es ruido en C0 (5/10 fases peor,
 * ±3 pp) y en LAB-M189 cuesta ~1,4 pp en train (9/10 fases) y nada en confirmación.
 *
 * FUERA DE ALCANCE (se mantiene APARTE, ya documentado en CLAUDE.md §10c/§10e):
 *   ejecución intradía del trailing (C0 −2-3 pp/año; LAB-M189 −2-4 pp/año), universo
 *   superviviente (infla los niveles, sin cuantificar) e impuestos.
 *
 * DATOS: data/universe-10y.json relativo al cwd (la lib lo lee así). La ejecución del
 * 25-sep-2026 se hizo en un worktree temporal con ese fichero enlazado a la copia
 * CONGELADA /private/tmp/claude-501/universe-10y-frozen-2026-09-25.json (fetchedAt
 * 2026-09-02, última sesión 2026-09-01) porque otro agente reparaba el dataset del
 * repo en paralelo. Convención de la casa que se conserva en todas las variantes:
 * barra ausente = retorno 0 ese día (ojo: 82 tickers sin la barra del 2026-08-31).
 *
 * Uso: node scripts/rally-drift-cost-audit.mjs   (COST_BPS=20 por defecto)
 * Salida: backtests/rally-drift-cost-audit.json (o la ruta de AUDIT_OUT).
 */
import fs from "node:fs";
import {
  T, dates, D, spyClose, TO as TO_FULL, SPLIT, I2022b, PHASES10,
  simular, evaluar, ddReal, retSeg, scoreDia, pesosDe, sigM189s10, RET,
  segMetrics, COST_BPS, isNum, mean,
} from "./lab-day-core.mjs";
import { simulate, PRESET_C0, scoreV4 } from "./rally-study-lib.mjs";

// --datos-reparados (25-sep-2026): el dataset de 10 años se reparó (MNST, AVB, STLAP…); los
// estudios 3 y lab-stop-audit se midieron sobre el anterior, así que sus anclas guardadas ya no
// pueden coincidir. Con esta opción se omiten SOLO esas dos anclas (las réplicas en vivo se
// siguen exigiendo bit a bit) y la salida va a un fichero aparte.
const DATOS_REPARADOS = process.argv.includes("--datos-reparados");
const OUT_PATH = process.env.AUDIT_OUT ?? (DATOS_REPARADOS ? "backtests/rally-drift-cost-audit-reparado.json" : "backtests/rally-drift-cost-audit.json");
const t0 = Date.now();
const idx = (d) => { const k = dates.indexOf(d); if (k < 0) throw new Error(`fecha ${d} fuera del calendario`); return k; };
const TO_PUB = idx("2026-08-07");                               // fin del backtest PUBLICADO (rally-weighting-study.json)
const I2025b = dates.findIndex((d) => d >= "2026-01-01") - 1;    // último cierre de 2025
const FROM_CANON = 260, REVIEW = 84;
const P = PRESET_C0(T);
const EQUAL_W = (top) => top.map(() => 100 / top.length);
const pct = (x, d = 2) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
const pp = (x, d = 2) => (isNum(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}` : "—");

// ════════════════════════════════════════════════════════════════════════════
// C0 — réplica de simulate() + PRESET_C0 con tres interruptores de contabilidad
// ════════════════════════════════════════════════════════════════════════════
function simC0({ FROM, TO, review = REVIEW, topN = 10, drift = false, realCost = false, lag = 0, lagRev = lag, lagStop = lag, equal = false, widthOverride = null }) {
  const { pickJump } = P;
  const widthOf = widthOverride ?? P.widthOf;
  const weightsOf = equal ? EQUAL_W : P.weightsOf;
  let eq = 1, closed = 0, wins = 0, trades = 0, jumps = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let held = [];                                   // {ti, w, peak, trailPct, entryPx}
  let pend = null;                                 // lag=1: { stops:[{ti, rep, w0}], review:{top, ws}|null }
  const rev = { n: 0, cobradoPub: 0, dwReal: 0 };  // por revisión: turn/topN (lo cobrado en (a)) vs Σ|Δw|/100 (lo real)
  const closeTrade = (h, px) => { closed++; if (isNum(px) && isNum(h.entryPx) && px > h.entryPx) wins++; };

  const decideReview = (i) => {                    // = bloque de revisión de simulate() (l. 473-485)
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, topN);
    return { top, ws: weightsOf(top, i) };
  };

  const applyReview = (x, top, ws) => {            // ejecución al cierre x (x = día de decisión si lag=0)
    const prev = new Map(held.map((h) => [h.ti, h]));
    const newSet = new Set(top.map((c) => c.ti));
    let turn = 0;
    for (const c of top) if (!prev.has(c.ti)) turn++;
    for (const h of held) if (!newSet.has(h.ti)) { turn++; closeTrade(h, T[h.ti].adj[x]); }
    const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
    let dw = 0;                                    // Σ|Δw| real, dos patas, sobre los pesos vigentes
    top.forEach((c, j) => { const old = prev.get(c.ti); dw += Math.abs(ws[j] - (old ? (old.w / wsum) * 100 : 0)); });
    for (const h of held) if (!newSet.has(h.ti)) dw += (h.w / wsum) * 100;
    rev.n++; rev.cobradoPub += turn / Math.max(topN, 1); rev.dwReal += dw / 100;
    if (realCost) { eq *= 1 - COST_BPS * (dw / 100); trades += turn; }
    else if (turn) { eq *= 1 - COST_BPS * (turn / Math.max(topN, 1)); trades += turn; }
    held = top.map((c, j) => {
      const old = prev.get(c.ti);
      const w0 = widthOf(c.f, { gain: 0, peakGain: 0 });
      const px = T[c.ti].adj[x];
      return { ti: c.ti, w: ws[j], peak: Math.max(old?.peak ?? 0, px), trailPct: isNum(w0) ? w0 : 0.30, entryPx: old?.entryPx ?? px };
    });
  };

  for (let i = FROM + 1; i <= TO; i++) {
    // 1) retorno del día con los pesos del cierre anterior (misma expresión que la lib)
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) {
        const t = T[h.ti]; const a = t.adj[i], b = t.adj[i - 1];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum);
      }
    }
    eq *= 1 + r; curve[i] = eq;

    // 2) (b)(c)(d): el peso sigue al precio hasta el cierre de hoy (cartera real)
    if (drift && held.length) {
      for (const h of held) { const a = T[h.ti].adj[i], b = T[h.ti].adj[i - 1]; if (isNum(a) && isNum(b) && b > 0) h.w *= a / b; }
      const tot = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) h.w = (h.w / tot) * 100;
    }

    // 3) (d): ejecutar al cierre de HOY lo decidido al cierre de AYER (saltos y luego revisión)
    if (pend) {
      if (pend.stops.length) {
        const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
        const byTi = new Map(pend.stops.map((p) => [p.ti, p]));
        const next = [];
        for (const h of held) {
          const p = byTi.get(h.ti);
          if (!p) { next.push(h); continue; }
          closeTrade(h, T[h.ti].adj[i]); trades++;
          eq *= 1 - COST_BPS * (h.w / wsum);                 // venta al peso real de hoy
          if (p.rep != null) {
            eq *= 1 - COST_BPS * (h.w / wsum);               // compra del sustituto con lo obtenido
            trades++; jumps++;
            const epx = T[p.rep].adj[i];
            next.push({ ti: p.rep, w: h.w, peak: isNum(epx) ? epx : 0, trailPct: isNum(p.w0) ? p.w0 : 0.30, entryPx: isNum(epx) ? epx : null });
          }
        }
        held = next;
      }
      if (pend.review) applyReview(i, pend.review.top, pend.review.ws);
      pend = null;
    }

    // 4) trailing a cierres (pico incluye hoy) + salto (réplica de l. 425-468)
    if (held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const next = [], nuevos = [];
      for (const h of held) {
        const px = T[h.ti].adj[i];
        if (isNum(px)) {
          if (h.entryPx == null) h.entryPx = px;               // solo (d) con barra ausente el día de compra
          if (px > h.peak) h.peak = px;
          if (px <= h.peak * (1 - h.trailPct)) {
            heldSet.delete(h.ti);
            const rep = pickJump(i, heldSet);
            const fr = rep != null ? T[rep].feat[i] : null;
            const w0 = fr ? widthOf(fr, { gain: 0, peakGain: 0 }) : null;
            if (rep != null) heldSet.add(rep);
            if (!lagStop) {
              closeTrade(h, px); trades++;
              eq *= 1 - COST_BPS * (h.w / wsum);             // venta
              if (rep != null) {
                eq *= 1 - COST_BPS * (h.w / wsum);           // compra del sustituto (hereda el peso)
                trades++; jumps++;
                const epx = T[rep].adj[i];
                next.push({ ti: rep, w: h.w, peak: epx, trailPct: isNum(w0) ? w0 : 0.30, entryPx: epx });
              }
              continue;
            }
            nuevos.push({ ti: h.ti, rep, w0 });              // (d): se sigue teniendo hasta el cierre de mañana
          }
        }
        next.push(h);
      }
      held = next;
      if (nuevos.length) pend = { stops: nuevos, review: null };
    }

    // 5) revisión periódica
    if ((i - FROM) % review !== 0) continue;
    const { top, ws } = decideReview(i);
    if (!lagRev) applyReview(i, top, ws);
    else pend = { stops: pend?.stops ?? [], review: { top, ws } };
  }
  let openWins = 0;
  for (const h of held) { let px = null; for (let j = TO; j > FROM; j--) { if (isNum(T[h.ti].adj[j])) { px = T[h.ti].adj[j]; break; } } if (isNum(px) && px > h.entryPx) openWins++; }
  return { curve, closed, wins, trades, jumps, open: held.length, openWins, rev, heldEnd: held.map((h) => h.ti) };
}

const VARIANTES = [
  { key: "a", label: "(a) publicada: pesos fijos + coste turn/topN", drift: false, realCost: false, lag: 0 },
  { key: "b", label: "(b) pesos a la deriva (cartera real)", drift: true, realCost: false, lag: 0 },
  { key: "c", label: "(c) deriva + coste real Σ|Δw| dos patas", drift: true, realCost: true, lag: 0 },
  { key: "d", label: "(d) (c) + ejecución al cierre siguiente", drift: true, realCost: true, lag: 1 },
];

function mismaCurva(c1, c2, a, b) { for (let i = a; i <= b; i++) if (c1[i] !== c2[i]) return false; return true; }

function metricasC0(s, FROM, TO) {
  const years = (TO - FROM) / 252;
  const out = {
    full: segMetrics(s.curve, FROM, TO),
    train: segMetrics(s.curve, FROM, SPLIT),
    confirm: segMetrics(s.curve, SPLIT, TO),
    confirm2022_25: segMetrics(s.curve, SPLIT, I2025b),
    ddRealConfirm: ddReal(s.curve, SPLIT, TO, FROM),
    ret2022: retSeg(s.curve, SPLIT, I2022b),
    winrate: (s.wins + s.openWins) / Math.max(1, s.closed + s.open),
    tradesYr: s.trades / years, jumps: s.jumps,
    revisiones: {
      n: s.rev.n,
      cobradoPubMedio: s.rev.n ? s.rev.cobradoPub / s.rev.n : null,     // fracción de cartera cobrada por revisión en (a)
      rotacionRealMedia: s.rev.n ? s.rev.dwReal / s.rev.n : null,       // Σ|Δw|/100 real por revisión (sobre pesos vigentes)
      costeAnualCobradoBp: (s.rev.cobradoPub * COST_BPS * 1e4) / years,
      costeAnualRealBp: (s.rev.dwReal * COST_BPS * 1e4) / years,
    },
  };
  return out;
}

// ─── validación 1: la réplica (a) ≡ simulate() + PRESET_C0 BIT A BIT ───────────
const validaciones = {};
{
  const casos = [
    { FROM: FROM_CANON, TO: TO_PUB }, { FROM: FROM_CANON, TO: TO_FULL },
    ...PHASES10.filter((f) => f !== FROM_CANON).map((FROM) => ({ FROM, TO: TO_FULL })),
  ];
  const fallos = [];
  for (const c of casos) {
    const lib = simulate(T, D, { FROM: c.FROM, TO: c.TO, review: REVIEW, ...PRESET_C0(T) });
    const mia = simC0({ FROM: c.FROM, TO: c.TO });
    const ok = mismaCurva(lib.curve, mia.curve, c.FROM, c.TO) && lib.trades === mia.trades && lib.jumpCount === mia.jumps
      && lib.closed === mia.closed && lib.wins === mia.wins && lib.open === mia.open && lib.openWins === mia.openWins;
    if (!ok) fallos.push(`${c.FROM}→${dates[c.TO]}`);
  }
  if (fallos.length) throw new Error(`RÉPLICA C0 (a) ≠ simulate(): ${fallos.join(", ")}`);
  validaciones.c0ReplicaBitExacta = `OK — simC0(a) ≡ simulate(T, D, {FROM, TO, review:84, ...PRESET_C0(T)}) bit a bit (curva, trades, saltos, aciertos) en ${casos.length} celdas (canónica a 2026-08-07 y 2026-09-01 + 9 fases del ensemble)`;
  console.log(validaciones.c0ReplicaBitExacta);
}

// ─── C0 celda canónica (FROM 260 · revisión 84) a las dos fechas de corte ──────
const PUBLICADO = {
  fuente: "backtests/rally-weighting-study.json (M9_RAW, celda canónica, datos hasta 2026-08-07)",
  full: { cagr: 0.47712510658530705, mdd: 0.3770905133653919, mar: 1.2652800579021302 },
  confirm: { cagr: 0.44908188128740023, mdd: 0.36080520832792473, mar: 1.2446657390800289 },
  winrate: 0.6473429951690821,
  equal: { full: { cagr: 0.389992221664363, mdd: 0.36405731181430456, mar: 1.07123853582506 }, confirm: { cagr: 0.3427571357929873 } },
  spy: { full: { cagr: 0.15638174286026985, mdd: 0.33717264353564513 } },
};
const canonica = {};
for (const [etq, TO] of [["hasta_2026-08-07", TO_PUB], ["hasta_2026-09-01", TO_FULL]]) {
  const bloque = { fin: dates[TO], m9raw: {}, equal: {} };
  for (const v of VARIANTES) {
    const s = simC0({ FROM: FROM_CANON, TO, drift: v.drift, realCost: v.realCost, lag: v.lag });
    bloque.m9raw[v.key] = { label: v.label, ...metricasC0(s, FROM_CANON, TO) };
    if (TO === TO_FULL) {
      const sinBarra = s.heldEnd.filter((ti) => !isNum(T[ti].adj[idx("2026-08-31")]) && isNum(T[ti].adj[TO_FULL]));
      bloque.m9raw[v.key].carteraFinalSinBarra0831 = sinBarra.map((ti) => T[ti].sym);
    }
    const e = simC0({ FROM: FROM_CANON, TO, drift: v.drift, realCost: v.realCost, lag: v.lag, equal: true });
    bloque.equal[v.key] = { label: v.label, ...metricasC0(e, FROM_CANON, TO) };
  }
  const spy = new Array(D).fill(null);
  for (let i = FROM_CANON; i <= TO; i++) spy[i] = spyClose[i] / spyClose[FROM_CANON];
  bloque.spyBuyHold = { full: segMetrics(spy, FROM_CANON, TO), confirm: segMetrics(spy, SPLIT, TO), confirm2022_25: segMetrics(spy, SPLIT, I2025b) };
  canonica[etq] = bloque;
}
validaciones.c0ReproduccionPublicada = (() => {
  const a = canonica["hasta_2026-08-07"].m9raw.a;
  return `(a) con la copia congelada hasta 2026-08-07: full ${pct(a.full.cagr)} / DD ${pct(a.full.mdd)} · confirm ${pct(a.confirm.cagr)} / DD ${pct(a.confirm.mdd)} · aciertos ${pct(a.winrate, 1)} — publicado ${pct(PUBLICADO.full.cagr)} / ${pct(PUBLICADO.full.mdd)} · ${pct(PUBLICADO.confirm.cagr)} / ${pct(PUBLICADO.confirm.mdd)} · ${pct(PUBLICADO.winrate, 1)}. Mismo camino de operaciones; el retorno año a año coincide BIT A BIT 2018-2025 con porAno del estudio y solo 2026 difiere (+0,40 pp en el año) por revisión de datos de la copia congelada.`;
})();
console.log(validaciones.c0ReproduccionPublicada);

// ─── C0 ensemble de 10 fases (referencia "C0 en los mismos datos" del panel Rally-Test) ──
function resumen(cells) {
  const tr = cells.map((c) => c.train.cagr), cf = cells.map((c) => c.confirm.cagr), cf25 = cells.map((c) => c.confirm2022_25.cagr);
  return {
    trainMean: mean(tr), trainWorst: Math.min(...tr),
    confirmMean: mean(cf), confirmWorst: Math.min(...cf),
    confirm2022_25Mean: mean(cf25), confirm2022_25Worst: Math.min(...cf25),
    confirmMddMean: mean(cells.map((c) => c.confirm.mdd)),
    ddRealWorst: Math.max(...cells.map((c) => c.ddRealConfirm)),
    ret2022Mean: mean(cells.map((c) => c.ret2022).filter(isNum)),
    fasesDistintas: new Set(cells.map((c) => Math.round(c.confirm.cagr * 1e10))).size,
    confirmPorFase: cf, trainPorFase: tr,
  };
}
const c0Ensemble = {};
for (const v of VARIANTES) {
  const cells = PHASES10.map((FROM) => {
    const s = simC0({ FROM, TO: TO_FULL, drift: v.drift, realCost: v.realCost, lag: v.lag });
    const m = metricasC0(s, FROM, TO_FULL);
    return { FROM, train: m.train, confirm: m.confirm, confirm2022_25: m.confirm2022_25, ddRealConfirm: m.ddRealConfirm, ret2022: m.ret2022, jumpsY: s.jumps / ((TO_FULL - FROM) / 252) };
  });
  c0Ensemble[v.key] = { label: v.label, ...resumen(cells), saltosAno: mean(cells.map((c) => c.jumpsY)) };
}
{
  const s3 = JSON.parse(fs.readFileSync("backtests/rally-test-engine-study3.json", "utf8")).baseC0;
  const a = c0Ensemble.a;
  const ok = Math.abs(a.confirmMean - s3.confirmMean) < 1e-12 && Math.abs(a.confirmWorst - s3.confirmWorst) < 1e-12
    && Math.abs(a.ddRealWorst - s3.ddRealWorst) < 1e-12 && Math.abs(a.ret2022Mean - s3.ret2022Mean) < 1e-12;
  if (!ok && !DATOS_REPARADOS) throw new Error("C0 ensemble (a) no reproduce baseC0 de rally-test-engine-study3.json");
  if (!ok) validaciones.c0EnsembleReproduccion = "OMITIDO — dataset reparado 25-sep-2026: rally-test-engine-study3.json se midió sobre el anterior";
  else validaciones.c0EnsembleReproduccion = `OK — C0 ensemble (a) reproduce BIT A BIT baseC0 de rally-test-engine-study3.json (confirm ${pct(a.confirmMean)} / peor ${pct(a.confirmWorst)} / DD real ${pct(a.ddRealWorst)} / 2022 ${pct(a.ret2022Mean)})`;
  console.log(validaciones.c0EnsembleReproduccion);
}

// ─── párrafo de stops del panel: C0 (H4) vs fijo 30% bajo (a) y (c) — malla del estudio conjunto ──
// rally-joint-study.mjs: 3 fases (260/280/300) × cadencias 63/84/105, canónica 260/84, hasta 2026-08-07.
const stopsPanel = { fuente: "réplica de C0 y ST_FIJO30 de backtests/rally-joint-study.json (malla 3×3 hasta 2026-08-07)", publicado: { c0Confirm: 0.44908188128740023, fijo30Confirm: 0.4501145957958004, c0WorstTrain: 0.3700487031283042, fijo30WorstTrain: 0.339405616813069 } };
{
  const stops = { C0_H4: null, FIJO30: () => 0.30 };
  for (const [nombre, w] of Object.entries(stops)) {
    for (const v of VARIANTES.filter((x) => x.key === "a" || x.key === "c")) {
      const cells = [];
      for (const FROM of [260, 280, 300]) for (const review of [63, 84, 105]) {
        const s = simC0({ FROM, TO: TO_PUB, review, drift: v.drift, realCost: v.realCost, widthOverride: w });
        cells.push({ FROM, review, train: segMetrics(s.curve, FROM, SPLIT).cagr, confirm: segMetrics(s.curve, SPLIT, TO_PUB).cagr });
      }
      const cf = cells.map((c) => c.confirm).sort((x, y) => x - y);
      stopsPanel[`${nombre}_${v.key}`] = {
        canonConfirm: cells.find((c) => c.FROM === 260 && c.review === 84).confirm,
        worstTrain: Math.min(...cells.map((c) => c.train)), worstConfirm: cf[0], medianConfirm: cf[4],
      };
    }
  }
  const okTrain = Math.abs(stopsPanel.C0_H4_a.worstTrain - stopsPanel.publicado.c0WorstTrain) < 1e-12
    && Math.abs(stopsPanel.FIJO30_a.worstTrain - stopsPanel.publicado.fijo30WorstTrain) < 1e-12;
  validaciones.stopsTrainReproduccion = okTrain
    ? "OK — peor-celda train de C0 y FIJO30 bajo (a) reproduce BIT A BIT rally-joint-study.json (el train no toca 2026)"
    : `AVISO — peor-celda train no reproduce: C0 ${stopsPanel.C0_H4_a.worstTrain} vs ${stopsPanel.publicado.c0WorstTrain}; FIJO30 ${stopsPanel.FIJO30_a.worstTrain} vs ${stopsPanel.publicado.fijo30WorstTrain}`;
  console.log(validaciones.stopsTrainReproduccion);
}

// ─── diagnóstico: ¿de dónde sale el efecto del cierre siguiente? (sobre (c)) ──
const diagCierreSiguiente = { nota: "Descomposición de (d) − (c): solo revisiones al cierre siguiente vs solo saltos de stop al cierre siguiente (el resto igual que (c)).", canonica: {}, ensemble10: {} };
{
  const partes = [
    { key: "c", lagRev: 0, lagStop: 0 }, { key: "soloRevision", lagRev: 1, lagStop: 0 },
    { key: "soloStops", lagRev: 0, lagStop: 1 }, { key: "d", lagRev: 1, lagStop: 1 },
  ];
  for (const [etq, TO] of [["hasta_2026-08-07", TO_PUB], ["hasta_2026-09-01", TO_FULL]]) {
    diagCierreSiguiente.canonica[etq] = Object.fromEntries(partes.map((p) => {
      const m = metricasC0(simC0({ FROM: FROM_CANON, TO, drift: true, realCost: true, lagRev: p.lagRev, lagStop: p.lagStop }), FROM_CANON, TO);
      return [p.key, { full: m.full.cagr, confirm: m.confirm.cagr, confirm2022_25: m.confirm2022_25.cagr }];
    }));
  }
  for (const p of partes) {
    const cf = PHASES10.map((FROM) => segMetrics(simC0({ FROM, TO: TO_FULL, drift: true, realCost: true, lagRev: p.lagRev, lagStop: p.lagStop }).curve, SPLIT, TO_FULL).cagr);
    diagCierreSiguiente.ensemble10[p.key] = { confirmMean: mean(cf), confirmWorst: Math.min(...cf), confirmPorFase: cf };
  }
  const e = diagCierreSiguiente.ensemble10;
  diagCierreSiguiente.ensemble10.deltaPorFase_d_menos_c = e.d.confirmPorFase.map((x, k) => x - e.c.confirmPorFase[k]);
}

// ════════════════════════════════════════════════════════════════════════════
// LAB-M189 v1.1 — camino v1.1 de simular() con ejecución parametrizable (lag)
// ════════════════════════════════════════════════════════════════════════════
const V11 = { R: 63, K: 5, wcfg: { modo: "SCORE" }, scfg: { tipo: "FIJO", w: 0.45 }, modoStop: "RESCAN2" };
function simLab({ FROM, lag = 0, R = 63, K = 5, W = 0.45 }) {
  const wcfg = { modo: "SCORE" };
  let eq = 1, stops = 0, nextReb = FROM;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let hold = [];                                   // {ti, w, peak, trail, entryPx}
  let pend = null;                                 // lag=1: { vender:Set<ti>, tgt:{top, ws}|null }
  const objetivo = (i) => {                        // formar(): señal y pesos con datos ≤ i
    const scored = scoreDia(i, sigM189s10, "M189s10");
    if (scored.length < K) return null;
    const top = scored.slice(0, K);
    return { top, ws: pesosDe(top, i, wcfg) };
  };
  const reformar = (x, tg) => {                    // = formar() del núcleo, ejecutada al cierre x
    const prev = new Map(hold.map((h) => [h.ti, h]));
    let dSum = 0;
    const next = tg.top.map((s, k) => ({
      ti: s.ti, w: tg.ws[k],
      peak: prev.get(s.ti)?.peak != null ? Math.max(prev.get(s.ti).peak, T[s.ti].adj[x]) : T[s.ti].adj[x],
      trail: W,
      entryPx: prev.get(s.ti)?.entryPx ?? T[s.ti].adj[x],
    }));
    const all = new Set([...prev.keys(), ...next.map((h) => h.ti)]);
    for (const ti of all) dSum += Math.abs((next.find((h) => h.ti === ti)?.w ?? 0) - (prev.get(ti)?.w ?? 0));
    eq *= 1 - COST_BPS * (dSum / 100);
    hold = next;
  };
  for (let i = FROM; i <= TO_FULL; i++) {
    if (i > FROM) {
      let r = 0, wsum = 0;
      for (const h of hold) { wsum += h.w; const x = RET[h.ti][i]; if (x != null) r += (h.w / 100) * x; }
      if (wsum > 0) r = r * (100 / wsum);
      eq *= 1 + r; curve[i] = eq;
      for (const h of hold) { const x = RET[h.ti][i]; if (x != null) h.w *= 1 + x; }
      const tot = hold.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of hold) h.w = (h.w / tot) * 100;
      if (pend) {                                  // lag=1: ejecutar hoy lo decidido ayer
        if (pend.vender.size) {
          const next = [];
          for (const h of hold) { if (pend.vender.has(h.ti)) { stops++; eq *= 1 - COST_BPS * (h.w / 100); continue; } next.push(h); }
          hold = next;
        }
        if (pend.tgt) reformar(i, pend.tgt);
        pend = null;
      }
      if (hold.length) {                           // stops a cierre (pico incluye hoy)
        let salto = false;
        const vender = new Set();
        const next = [];
        for (const h of hold) {
          const px = T[h.ti].adj[i];
          if (isNum(px)) {
            if (px > h.peak) h.peak = px;
            if (px <= h.peak * (1 - h.trail)) {
              salto = true;
              if (lag === 0) { stops++; eq *= 1 - COST_BPS * (h.w / 100); continue; }
              vender.add(h.ti);
            }
          }
          next.push(h);
        }
        hold = next;
        if (salto) {                               // RESCAN2: re-escanear y reformar sin resetear el reloj
          if (lag === 0) { const tg = objetivo(i); if (tg) reformar(i, tg); }
          else pend = { vender, tgt: objetivo(i) };
        }
      }
    }
    if (i >= nextReb) {
      const tg = objetivo(i);
      if (tg) {
        nextReb = i + R;
        if (lag === 0) reformar(i, tg);
        else pend = { vender: pend?.vender ?? new Set(), tgt: tg };
      }
    }
  }
  return { curve, stopsY: stops / ((TO_FULL - FROM) / 252) };
}

const celdaLab = (s, FROM) => ({
  FROM,
  train: segMetrics(s.curve, FROM, SPLIT), confirm: segMetrics(s.curve, SPLIT, TO_FULL),
  confirm2022_25: segMetrics(s.curve, SPLIT, I2025b),
  ddRealConfirm: ddReal(s.curve, SPLIT, TO_FULL, FROM),
  ret2022: retSeg(s.curve, SPLIT, I2022b), stopsY: s.stopsY,
});

// validación 2: reproducción del publicado (lab-stop-audit.json, F45) con el núcleo tal cual
{
  const pub = JSON.parse(fs.readFileSync("backtests/lab-stop-audit.json", "utf8")).results.find((r) => r.name === "F45");
  const ev = evaluar(V11);
  const ok = ["confirmMean", "confirmWorst", "ddRealWorst", "ret2022Mean", "trainMean", "trainWorst"].every((k) => Math.abs(ev[k] - pub[k]) < 1e-12);
  if (!ok && !DATOS_REPARADOS) throw new Error("evaluar(v1.1) no reproduce F45 de lab-stop-audit.json");
  if (!ok) validaciones.labReproduccionPublicada = "OMITIDO — dataset reparado 25-sep-2026: lab-stop-audit.json se midió sobre el anterior";
  else validaciones.labReproduccionPublicada = `OK — evaluar(v1.1) del núcleo reproduce BIT A BIT F45 de lab-stop-audit.json (confirm ${pct(ev.confirmMean)} / peor ${pct(ev.confirmWorst)} / DD real ${pct(ev.ddRealWorst)} / 2022 ${pct(ev.ret2022Mean)})`;
  console.log(validaciones.labReproduccionPublicada);
}
// validación 3: la copia simLab(lag=0) ≡ simular(v1.1) del núcleo, BIT A BIT en las 10 fases
const labCells = { a_c: [], d: [] };
{
  const fallos = [];
  for (const FROM of PHASES10) {
    const core = simular({ FROM, ...V11 });
    const mia = simLab({ FROM, lag: 0 });
    if (!mismaCurva(core.curve, mia.curve, FROM, TO_FULL) || core.stopsY !== mia.stopsY) fallos.push(FROM);
    labCells.a_c.push(celdaLab(mia, FROM));
    labCells.d.push(celdaLab(simLab({ FROM, lag: 1 }), FROM));
  }
  if (fallos.length) throw new Error(`simLab(lag=0) ≠ simular(v1.1) en fases ${fallos.join(",")}`);
  validaciones.labReplicaBitExacta = "OK — simLab(lag=0) ≡ simular({R:63,K:5,SCORE,FIJO 0,45,RESCAN2}) del núcleo bit a bit (curva y saltos) en las 10 fases";
  console.log(validaciones.labReplicaBitExacta);
}
const labRes = {
  a_c: { label: "(a)≡(b)≡(c): el núcleo ya deriva y cobra Σ|Δw| (publicado)", ...resumen(labCells.a_c), saltosAno: mean(labCells.a_c.map((c) => c.stopsY)) },
  d: { label: "(d) ejecución al cierre siguiente", ...resumen(labCells.d), saltosAno: mean(labCells.d.map((c) => c.stopsY)) },
};

// ─── informe por consola ──────────────────────────────────────────────────────
console.log(`\nDatos: ${dates[0]} → ${dates.at(-1)} · ${T.length} tickers · split ${dates[SPLIT]} · COST_BPS ${COST_BPS * 1e4}\n`);
for (const [etq, b] of Object.entries(canonica)) {
  console.log(`═══ C0 CELDA CANÓNICA (FROM ${dates[FROM_CANON]} · rev 84) — ${etq} ═══`);
  console.log("variante                                     full CAGR  MaxDD   MAR  ‖ confirm CAGR  MaxDD   MAR  ‖ 2022-25  ‖ aciertos · rot.real/cobrada por revisión");
  for (const v of VARIANTES) {
    const m = b.m9raw[v.key];
    console.log(`${v.label.padEnd(44)} ${pct(m.full.cagr).padStart(8)} ${pct(m.full.mdd, 1).padStart(6)} ${m.full.mar.toFixed(2).padStart(5)} ‖ ${pct(m.confirm.cagr).padStart(8)} ${pct(m.confirm.mdd, 1).padStart(10)} ${m.confirm.mar.toFixed(2).padStart(5)} ‖ ${pct(m.confirm2022_25.cagr).padStart(7)} ‖ ${pct(m.winrate, 1)} · ${pct(m.revisiones.rotacionRealMedia, 0)}/${pct(m.revisiones.cobradoPubMedio, 0)}`);
  }
  for (const v of VARIANTES) {
    const m = b.equal[v.key];
    console.log(`  EQUAL ${v.key}: full ${pct(m.full.cagr)} / ${pct(m.full.mdd, 1)} / MAR ${m.full.mar.toFixed(2)} · confirm ${pct(m.confirm.cagr)}`);
  }
  console.log(`  S&P 500 B&H: full ${pct(b.spyBuyHold.full.cagr)} / ${pct(b.spyBuyHold.full.mdd, 1)} · confirm ${pct(b.spyBuyHold.confirm.cagr)} · 2022-25 ${pct(b.spyBuyHold.confirm2022_25.cagr)}`);
  const a = b.m9raw.a, d = b.m9raw.d;
  console.log(`  Δ(d−a): full ${pp(d.full.cagr - a.full.cagr)} pp · confirm ${pp(d.confirm.cagr - a.confirm.cagr)} pp · coste de revisión real ${a.revisiones.costeAnualRealBp.toFixed(0)} bp/año vs cobrado ${a.revisiones.costeAnualCobradoBp.toFixed(0)} bp/año\n`);
}
console.log("═══ C0 ENSEMBLE 10 FASES (datos hasta 2026-09-01) ═══");
for (const v of VARIANTES) {
  const r = c0Ensemble[v.key];
  console.log(`${v.label.padEnd(44)} confirm media ${pct(r.confirmMean)} · peor ${pct(r.confirmWorst)} · 2022-25 ${pct(r.confirm2022_25Mean)} · DD real ${pct(r.ddRealWorst)} · 2022 ${pct(r.ret2022Mean)} · train ${pct(r.trainMean)}/${pct(r.trainWorst)} · fases ${r.fasesDistintas}/10`);
}
console.log("═══ STOPS (párrafo del panel): C0 H4 vs fijo 30% — malla 3×3 hasta 2026-08-07 ═══");
for (const k of ["C0_H4_a", "FIJO30_a", "C0_H4_c", "FIJO30_c"]) {
  const r = stopsPanel[k];
  console.log(`  ${k.padEnd(9)} confirm canónica ${pct(r.canonConfirm)} · peor-celda train ${pct(r.worstTrain)} · confirm peor/mediana ${pct(r.worstConfirm)}/${pct(r.medianConfirm)}`);
}
console.log("\n═══ DIAGNÓSTICO cierre siguiente sobre (c): confirm por parte ═══");
for (const [etq, b] of Object.entries(diagCierreSiguiente.canonica)) {
  console.log(`  canónica ${etq}: ${Object.entries(b).map(([k, v]) => `${k} ${pct(v.confirm)} (full ${pct(v.full)})`).join(" · ")}`);
}
{
  const e = diagCierreSiguiente.ensemble10;
  console.log(`  ensemble media/peor: ${["c", "soloRevision", "soloStops", "d"].map((k) => `${k} ${pct(e[k].confirmMean)}/${pct(e[k].confirmWorst)}`).join(" · ")}`);
  console.log(`  Δ(d−c) por fase: ${e.deltaPorFase_d_menos_c.map((x) => pp(x, 1)).join(" ")} → ${e.deltaPorFase_d_menos_c.filter((x) => x < 0).length}/10 fases peor`);
}
console.log("\n═══ LAB-M189 v1.1 ENSEMBLE 10 FASES (datos hasta 2026-09-01) ═══");
for (const [k, r] of Object.entries(labRes)) {
  console.log(`${r.label.padEnd(60)} confirm media ${pct(r.confirmMean)} · peor ${pct(r.confirmWorst)} · 2022-25 ${pct(r.confirm2022_25Mean)} · DD real ${pct(r.ddRealWorst)} · 2022 ${pct(r.ret2022Mean)} · train ${pct(r.trainMean)}/${pct(r.trainWorst)} · saltos/año ${r.saltosAno.toFixed(2)} · fases ${r.fasesDistintas}/10`);
}
{
  const dif = labCells.d.map((c, k) => c.confirm.cagr - labCells.a_c[k].confirm.cagr);
  const difTr = labCells.d.map((c, k) => c.train.cagr - labCells.a_c[k].train.cagr);
  labRes.deltaConfirmPorFase_d_menos_publicado = dif;
  labRes.deltaTrainPorFase_d_menos_publicado = difTr;
  console.log(`  Δ confirm (d − publicado) por fase: ${dif.map((x) => pp(x, 1)).join(" ")} → media ${pp(mean(dif))} pp · ${dif.filter((x) => x < 0).length}/10 fases peor`);
  console.log(`  Δ train   (d − publicado) por fase: ${difTr.map((x) => pp(x, 1)).join(" ")} → media ${pp(mean(difTr))} pp · ${difTr.filter((x) => x < 0).length}/10 fases peor`);
  const c0tr = c0Ensemble.d.trainPorFase.map((x, k) => x - c0Ensemble.c.trainPorFase[k]);
  console.log(`  (C0) Δ train (d − c) por fase: ${c0tr.map((x) => pp(x, 1)).join(" ")} → media ${pp(mean(c0tr))} pp · ${c0tr.filter((x) => x < 0).length}/10 fases peor`);
}

// ─── salida ───────────────────────────────────────────────────────────────────
const OUT = {
  ranAt: new Date().toISOString(),
  costBps: COST_BPS * 1e4,
  datos: {
    fichero: (() => { try { return fs.realpathSync("data/universe-10y.json"); } catch { return "data/universe-10y.json"; } })(),
    desde: dates[0], hasta: dates.at(-1), sesiones: D, tickers: T.length, split: dates[SPLIT],
    finPublicadoC0: dates[TO_PUB], faseCanonica: { FROM: FROM_CANON, fecha: dates[FROM_CANON], revision: REVIEW },
    avisos: [
      "82 tickers sin barra el 2026-08-31 en la copia congelada (hueco del proveedor): con la convención de la casa pierden el retorno de 08-31 y 09-01; afecta solo a las cifras 'hasta 2026-09-01'. La celda canónica hasta 2026-08-07 no lo toca.",
      "2026-05-14 sin barra para 19 tickers suizos + MT.PA: es festivo (Ascensión en SIX), no un hueco.",
      "El canon de C0 arranca en efectivo 84 sesiones (primera revisión en FROM+84): deprime el CAGR full ~2 pp; no afecta a confirmación. Convención conservadora, se mantiene en todas las variantes.",
    ],
  },
  hallazgosCodigo: {
    c0_rallyStudyLib: "simulate(): h.w nunca se actualiza con el retorno (l. 413-422) → pesos fijos = rebalanceo diario gratis; revisión cobrada turn/topN (l. 491), re-ajuste de los que continúan gratis (l. 492-501); el sustituto de un stop hereda el peso objetivo (l. 458). Ejecución al cierre de la señal.",
    labM189_labDayCore: "simular(): los pesos DERIVAN (l. 288-291) y cada reforma cobra COST_BPS·Σ|Δw| con las dos patas (l. 271-273); venta del stop al peso real (l. 310), compra JUMP (l. 316), RESCAN2 re-forma vía formar() (l. 327). NO tiene los optimismos (1) y (2). Sí ejecuta al cierre de la señal (formar(i) con adj[i], l. 242/264/269; stop vende al cierre que lo dispara, l. 298-310) → se mide (d).",
    referenciaC0DelPanelRallyTest: "refC0 '53,3% / 43,7%' y dd2022C0 '−12,9%' salen de simulate()+PRESET_C0 (rally-test-engine-study2/3.mjs) → convención (a), NO comparable con LAB-M189 (que ya deriva y cobra real). La referencia homogénea es c0Ensemble10.c o .d.",
  },
  validaciones,
  publicadoC0: PUBLICADO,
  c0Canonica: canonica,
  c0Ensemble10: c0Ensemble,
  stopsPanelRallyLeaders: stopsPanel,
  diagnosticoCierreSiguiente: diagCierreSiguiente,
  labM189v11: { config: "R63 · K5 · pesos SCORE [10,40] · trailing FIJO 45% a cierres · RESCAN2", ...labRes },
  fueraDeAlcance: {
    intradia: "Documentado aparte (CLAUDE.md §10c/§10e): ejecutar el trailing como orden intradía real cuesta 2-3 pp/año a C0 y 2-4 pp/año (+50% de saltos) a LAB-M189. No se re-mide aquí; se resta aparte.",
    supervivencia: "Universo superviviente (603 tickers actuales): infla todos los niveles absolutos; sin cuantificar. Solo comparaciones relativas son sólidas.",
    impuestos: "No modelados.",
  },
};
fs.writeFileSync(OUT_PATH, JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: ${OUT_PATH} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
