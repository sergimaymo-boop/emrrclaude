/**
 * RALLY — ESTUDIO 7b (G7): ENSEMBLE EN EJECUCIÓN INTRADÍA — top-8 [5,25] vs C0
 * ============================================================================
 * El simulador canon evalúa el trailing a CIERRES; una orden real de bróker
 * persigue el máximo intradía y salta al TOCAR el nivel. La réplica del 19-ago
 * (carpeta lab, ya no está en el repo) midió ese efecto en ~2-3 pp/año y
 * adjudicó el ensemble en AMBOS modos. Este script reconstruye esa réplica con
 * la validación más fuerte disponible:
 *
 *   VALIDACIÓN: simulateX(mode="close") debe reproducir BIT A BIT la curva de
 *   simulate() del lib (diff exactamente 0 en las celdas canónicas de C0 y
 *   T8_PROP). Solo si eso se cumple se le cree el modo intradía, que cambia
 *   ÚNICAMENTE el bloque del trailing:
 *     · pico con el MÁXIMO intradía ajustado (no el cierre)
 *     · disparo cuando el MÍNIMO intradía ajustado toca peak·(1−trail)
 *     · fill al nivel del stop (no al cierre)
 *   Sin precio de apertura en el dataset (barras d/h/l/c/a/v), el hueco (gap)
 *   por debajo del nivel se acota con DOS convenciones → BANDA:
 *     PES (pesimista): pico actualizado con el máximo de HOY ANTES de comprobar
 *          el mínimo (asume máximo→mínimo) y gap ejecutado al MÍNIMO del día.
 *     OPT (optimista): mínimo comprobado contra el pico de AYER (asume
 *          mínimo→máximo) y gap ejecutado a min(nivel, máximo del día).
 *   La verdad está entre ambas; se reportan las dos (la banda del 19-ago se
 *   construyó igual). Máx/mín se ajustan por dividendos/splits con el factor
 *   a/c de la MISMA barra.
 *
 * SONDAS (G7, pre-registradas en rally-top8-study.mjs): P1 confirm(T8)>C0 en
 * ≥7/10 fases del ensemble 260..350 · P2 media de edges ≥ +2 pp — deben
 * cumplirse en AMBAS convenciones para dar G7 por bueno.
 *
 * Determinista, sin lookahead. Salida: backtests/rally-top8-intradia.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, PRESET_C0, capNormalizeTarget, segMetrics,
  COST_BPS, isNum, mean, f1,
} from "./rally-study-lib.mjs";

console.log("Cargando universo (lib, señales ajustadas)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const dateIdx = new Map(dates.map((d, i) => [d, i]));

// ─── máximos/mínimos AJUSTADOS alineados al calendario maestro ───────────────
console.log("Alineando máximos/mínimos intradía ajustados…");
const raw = JSON.parse(fs.readFileSync("data/universe-10y.json", "utf8")).series;
const bySym = new Map();
for (const t of T) {
  const bars = raw[t.sym]?.bars ?? [];
  const hi = new Array(D).fill(null), lo = new Array(D).fill(null);
  for (const b of bars) {
    const k = dateIdx.get(b.d);
    if (k == null || !isNum(b.c) || b.c <= 0) continue;
    const f = isNum(b.a) ? b.a / b.c : 1;
    if (isNum(b.h)) hi[k] = b.h * f;
    if (isNum(b.l)) lo[k] = b.l * f;
  }
  bySym.set(t.sym, { hi, lo });
}

/**
 * Copia FIEL de simulate() del lib con el bloque de trailing parametrizado.
 * mode: "close" (≡ lib, para la validación bit a bit) · "pes" · "opt".
 * En "close": px = cierre ajustado, pico a cierres, fill = px — misma secuencia
 * aritmética de eq (suma de r en el mismo orden, mismos costes en el mismo
 * orden) para que la igualdad sea exacta, no aproximada.
 */
function simulateX(T, D, opts, mode) {
  const {
    FROM, TO = D - 1, review = 84, topN = 10,
    widthOf = null, pickJump = null, scoreFn = null, weightsOf = null,
  } = opts;
  const score = scoreFn ?? ((f) => (f && isNum(f.m9) ? Math.max(0, Math.min(100, 50 + 50 * Math.tanh(f.m9 / 75))) : null));
  let eq = 1, closed = 0, wins = 0, trades = 0, jumpCount = 0;
  const curve = new Array(D).fill(null); curve[FROM] = 1;
  let held = [];
  const closeTrade = (h, px) => { closed++; if (isNum(px) && isNum(h.entryPx) && px > h.entryPx) wins++; };

  for (let i = FROM + 1; i <= TO; i++) {
    // 1) decidir stops del día y sus fills (en "close" replica la condición del lib)
    const stopped = new Set();
    const fills = new Map();
    if (widthOf && held.length) {
      for (const h of held) {
        const t = T[h.ti];
        const px = t.adj[i];
        if (!isNum(px)) continue;
        if (mode === "close") {
          const peak2 = px > h.peak ? px : h.peak;          // pico incluye HOY (lib)
          if (px <= peak2 * (1 - h.trailPct)) { stopped.add(h.ti); fills.set(h.ti, px); }
        } else {
          const { hi, lo } = bySym.get(t.sym);
          const dayH = hi[i], dayL = lo[i];
          if (mode === "pes") {
            const peak2 = isNum(dayH) && dayH > h.peak ? dayH : h.peak;   // máximo ANTES del mínimo
            const level = peak2 * (1 - h.trailPct);
            if (isNum(dayL) && dayL <= level) {
              stopped.add(h.ti);
              fills.set(h.ti, isNum(dayH) && level > dayH ? dayL : Math.max(dayL, level)); // gap → al mínimo
            }
          } else { // opt: mínimo contra el pico de AYER
            const level = h.peak * (1 - h.trailPct);
            if (isNum(dayL) && dayL <= level) {
              stopped.add(h.ti);
              const capHi = isNum(dayH) ? Math.min(level, dayH) : level;  // gap → min(nivel, máximo)
              fills.set(h.ti, Math.max(dayL, capHi));
            }
          }
        }
      }
    }

    // 2) retorno del día — MISMO orden de suma que el lib; el parado usa su fill
    let r = 0;
    if (held.length) {
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      for (const h of held) {
        const t = T[h.ti]; const b = t.adj[i - 1];
        const a = stopped.has(h.ti) ? fills.get(h.ti) : t.adj[i];
        if (isNum(a) && isNum(b) && b > 0) r += (a / b - 1) * (h.w / wsum);
      }
    }
    eq *= 1 + r; curve[i] = eq;

    // 3) ejecutar stops + salto (misma secuencia de costes que el lib)
    if (widthOf && held.length) {
      const heldSet = new Set(held.map((h) => h.ti));
      const wsum = held.reduce((s, h) => s + h.w, 0) || 1;
      const next = [];
      for (const h of held) {
        const t = T[h.ti];
        const px = t.adj[i];
        if (isNum(px)) {
          if (mode === "close") { if (px > h.peak) h.peak = px; }
          else {
            const { hi } = bySym.get(t.sym);
            if (isNum(hi[i]) && hi[i] > h.peak) h.peak = hi[i];
          }
          if (stopped.has(h.ti)) {
            closeTrade(h, fills.get(h.ti));
            trades++;
            eq *= 1 - COST_BPS * (h.w / wsum);
            heldSet.delete(h.ti);
            if (pickJump) {
              const rep = pickJump(i, heldSet);
              if (rep != null) {
                const f = T[rep].feat[i];
                const w0 = f ? widthOf(f, { gain: 0, peakGain: 0 }) : null;
                eq *= 1 - COST_BPS * (h.w / wsum);
                trades++; jumpCount++;
                const epx = T[rep].adj[i];
                next.push({ ti: rep, w: h.w, peak: epx, trailPct: isNum(w0) ? w0 : 0.30, entryPx: epx });
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

    // 4) revisión periódica — idéntica al lib (a cierres)
    const doReview = review == null ? i === FROM + 1 : (i - FROM) % review === 0;
    if (!doReview) continue;
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = score(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s || (b.f.m9 ?? 0) - (a.f.m9 ?? 0));
    const top = cands.slice(0, topN);
    const ws = weightsOf ? weightsOf(top, i) : top.map(() => 100 / Math.max(top.length, 1));
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
  return { curve, trades, jumpCount };
}

// ─── variantes (idénticas al estudio 7) ──────────────────────────────────────
const base = PRESET_C0(T);
const mkW = (lo, hi) => (top) => capNormalizeTarget(top.map((c) => Math.max(1, c.f.m9 ?? 1)), lo, hi, 100);
const VARIANTS = {
  C0:      { topN: 10, opts: base },
  T8_PROP: { topN: 8,  opts: { ...base, weightsOf: mkW(5, 25) } },
  T8_FIX:  { topN: 8,  opts: { ...base, weightsOf: mkW(4, 20) } },
};

// ─── VALIDACIÓN bit a bit del modo "close" ───────────────────────────────────
console.log("Validando simulateX(close) ≡ simulate(lib) bit a bit…");
for (const name of ["C0", "T8_PROP"]) {
  const v = VARIANTS[name];
  const a = simulate(T, D, { FROM: 260, review: 84, topN: v.topN, ...v.opts });
  const b = simulateX(T, D, { FROM: 260, review: 84, topN: v.topN, ...v.opts }, "close");
  let maxd = 0;
  for (let i = 260; i <= TO; i++) {
    const d = Math.abs((a.curve[i] ?? 0) - (b.curve[i] ?? 0));
    if (d > maxd) maxd = d;
  }
  if (maxd !== 0) throw new Error(`VALIDACIÓN FALLA en ${name}: max|Δcurva| = ${maxd} (debe ser exactamente 0)`);
  console.log(`  ${name}: max|Δcurva| = 0 exacto ✓`);
}

// ─── ensemble 10 fases × 2 convenciones intradía ─────────────────────────────
const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
function cellX(v, FROM, mode) {
  const r = simulateX(T, D, { FROM, review: 84, topN: v.topN, ...v.opts }, mode);
  return { train: segMetrics(r.curve, FROM, SPLIT), confirm: segMetrics(r.curve, SPLIT, TO), full: segMetrics(r.curve, FROM, TO) };
}
const out = { ranAt: new Date().toISOString(), costBps: COST_BPS * 1e4, modes: {} };
for (const mode of ["pes", "opt"]) {
  const ens = {};
  for (const [name, v] of Object.entries(VARIANTS)) ens[name] = PHASES10.map((F) => cellX(v, F, mode));
  const probes = {};
  for (const cand of ["T8_PROP", "T8_FIX"]) {
    const eC = PHASES10.map((_, k) => ens[cand][k].confirm.cagr - ens.C0[k].confirm.cagr);
    const eT = PHASES10.map((_, k) => ens[cand][k].train.cagr - ens.C0[k].train.cagr);
    probes[cand] = { winsConfirm: eC.filter((x) => x > 0).length, meanConfirm: mean(eC), meanTrain: mean(eT), edges: eC };
  }
  const c0canon = ens.C0[0];
  out.modes[mode] = { ensemble: ens, probes, c0canonFull: c0canon.full.cagr, c0canonConfirm: c0canon.confirm.cagr };
  console.log(`\n═══ MODO ${mode.toUpperCase()} — C0 canónica full ${f1(c0canon.full.cagr)} · confirm ${f1(c0canon.confirm.cagr)} ═══`);
  for (const [cand, p] of Object.entries(probes)) {
    console.log(`  ${cand.padEnd(8)} P1 ${p.winsConfirm}/10 · P2 media ${f1(p.meanConfirm)} ‖ train media ${f1(p.meanTrain)}`);
  }
}

// contexto: canónicas a cierres para medir el peaje intradía
const c0close = cellX(VARIANTS.C0, 260, "close");
out.c0closeFull = c0close.full.cagr; out.c0closeConfirm = c0close.confirm.cagr;
console.log(`\nPeaje intradía C0 canónica (full): cierres ${f1(c0close.full.cagr)} → PES ${f1(out.modes.pes.c0canonFull)} · OPT ${f1(out.modes.opt.c0canonFull)}`);

fs.writeFileSync("backtests/rally-top8-intradia.json", JSON.stringify(out, null, 1));
console.log("Guardado: backtests/rally-top8-intradia.json");
