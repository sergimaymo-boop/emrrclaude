/**
 * VERIFICACIÓN DE ROBUSTEZ (lente adversarial) del veredicto FINAL del estudio
 * conjunto (backtests/rally-joint-study.json → CERTIFICAR_ACTUAL, C0 intacto).
 * ============================================================================
 * El gate mecánico lo pasó solo la familia CAD_63 y verify-joint-cadence.mjs la
 * refutó (P1 6/10, P2 +1,9 pp < 2 pp a 20 pb y +1,5 a 50 pb). Aquí se estresa
 * lo que queda: la CERTEZA de certificar C0 sin cambios.
 *
 *  A) SUB-MITADES de la confirmación (2022-01→2024-01 y 2024-01→2026-08) sobre
 *     un ensemble de 10 fases (260..350): C0 vs los mejores no-passers por eje
 *     (ST_FIJO35, N8_PROP, ROT_RECALC, ROT_MIX90) y CAD_63. ¿Algún retador gana
 *     una mitad de forma consistente?
 *  B) SENSIBILIDAD ±1 UNIDAD de cada parámetro de C0 (fases 260/280/300):
 *     topN ±1 · revisión ±1 sesión y ±5 · pendiente stop ±0,05 · base stop ±1 ·
 *     clamp stop ±1 pp (cada extremo) · mezcla salto ±0,1 · caps pesos ±1 pp
 *     (cada extremo). ¿C0 está en MESETA (vecinos a ±3 pp, ~½ sd de celdas) o
 *     en PICO (sospechoso de sobreajuste)?
 *  C) ORDEN DE VARIANTES estable: ranking de {C0 + retadores} por fase (10
 *     fases, rev 84) y por cadencia (63/84/105, fase 260) — Spearman contra el
 *     orden de la fase canónica. Un orden que se reordena con la fecha de
 *     inicio es ruido; uno estable es señal.
 *  D) CERTEZA DEL GATE: para cada retador, edge medio de confirmación vs C0 en
 *     el ensemble, fases ganadas, mitades, y distancia a la barra material de
 *     +2 pp. CANDIDATO FUTURO pre-definido como: edge medio ≥ +1 pp Y gana
 *     ≥7/10 fases Y ambas mitades ≥ 0 Y edge medio de train ≥ −3 pp (los
 *     mismos umbrales P1-P5 del verificador de cadencia, aplicados a todos).
 *  E) CAD_63 no se re-adjudica: se re-computa su ensemble (control de
 *     consistencia con la sonda) y se leen las sondas 20/50 pb ya guardadas.
 *
 * CONTROL DE REGRESIÓN previo: la celda canónica C0 de esta maquinaria debe
 * coincidir <1e-9 con c0.canon de backtests/rally-joint-study.json.
 *
 * Determinista, sin lookahead, señales ajustadas (convención del estudio).
 * Uso: node scripts/verify-joint-stress.mjs
 * Salida: backtests/rally-joint-stress.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, scoreV4, runwayScore, isNum, clamp, f1, mean, sd, spearman,
} from "./rally-study-lib.mjs";

const t0 = Date.now();
console.log("Cargando universo (señales AJUSTADAS, rasgos rich)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
const TO = D - 1;
const SPLIT = dates.findIndex((d) => d >= "2022-01-01");
const MID = dates.findIndex((d) => d >= "2024-01-01");
console.log(`Tickers ${T.length} · ${dates[0]} → ${dates[TO]} · SPLIT ${dates[SPLIT]} · MID ${dates[MID]}\n`);

// ─── réplica exacta de C0 con parámetros abiertos ────────────────────────────
// capNormalize EXACTO (bit a bit el del estudio conjunto) + factor t
function capNormalizeT(raw, lo = 4, hi = 20) {
  const n = raw.length;
  if (!n) return { ws: [], t: null };
  const w = raw.map((v) => (isNum(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return { ws: w.map((v) => Math.min(hi, Math.max(lo, v * t))), t };
}
// mezcla del salto con PESOS LITERALES (0,7/0,3 debe ser bit-idéntico; 1−0,7
// en coma flotante NO es 0,3 — por eso ambos pesos van explícitos)
function makeJump(wS, wR) {
  return (i, heldSet) => {
    let bi = null, bv = -Infinity;
    for (let ti = 0; ti < T.length; ti++) {
      if (heldSet.has(ti)) continue;
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s == null) continue;
      const v = wS * s + wR * runwayScore(f);
      if (v > bv) { bv = v; bi = ti; }
    }
    return bi;
  };
}
const DEF = { base: 12, slope: 0.35, stopLo: 15, stopHi: 45, topN: 10, capLo: 4, capHi: 20, mix: [0.7, 0.3], recalc: false, review: 84 };
function runSim(cfg0, FROM) {
  const cfg = { ...DEF, ...cfg0 };
  const stopFn = cfg.stopFn ?? ((f) => clamp(cfg.base + cfg.slope * runwayScore(f), cfg.stopLo, cfg.stopHi) / 100);
  let lastT = null;
  const weightsOf = (top) => {
    const { ws, t } = capNormalizeT(top.map((c) => Math.max(1, c.f.m9 ?? 1)), cfg.capLo, cfg.capHi);
    lastT = t;
    const sum = ws.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 1e-6) throw new Error(`pesos no suman 100 (${sum})`);
    return ws;
  };
  const jumpWeightOf = cfg.recalc
    ? (rep, i, h) => {
        const f = T[rep].feat[i];
        if (!isNum(lastT) || !f) return h.w;
        return clamp(Math.max(1, f.m9 ?? 1) * lastT, cfg.capLo, cfg.capHi);
      }
    : null;
  return simulate(T, D, {
    FROM, review: cfg.review, topN: cfg.topN, conviction: true,
    widthOf: stopFn, pickJump: makeJump(cfg.mix[0], cfg.mix[1]), weightsOf, jumpWeightOf,
  });
}
function segMetrics(curve, a, b) {
  const y = (b - a) / 252;
  const cagr = isNum(curve[a]) && curve[a] > 0 && isNum(curve[b]) ? Math.pow(curve[b] / curve[a], 1 / y) - 1 : null;
  let peak = 0, mdd = 0;
  for (let i = a; i <= b; i++) { const v = curve[i]; if (v == null) continue; if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > mdd) mdd = dd; }
  return { cagr, mdd, mar: mdd > 0 && cagr != null ? cagr / mdd : 0 };
}
const cellOf = (cfg, FROM) => {
  const r = runSim(cfg, FROM);
  return {
    FROM,
    train: segMetrics(r.curve, FROM, SPLIT).cagr,
    confirm: segMetrics(r.curve, SPLIT, TO).cagr,
    confirmMdd: segMetrics(r.curve, SPLIT, TO).mdd,
    confirmA: segMetrics(r.curve, SPLIT, MID).cagr,
    confirmB: segMetrics(r.curve, MID, TO).cagr,
  };
};

// ─── control de regresión: canónica C0 ≡ rally-joint-study.json <1e-9 ───────
const REF = JSON.parse(fs.readFileSync("backtests/rally-joint-study.json", "utf8"));
{
  const r = runSim({}, 260);
  const tr = segMetrics(r.curve, 260, SPLIT), cf = segMetrics(r.curve, SPLIT, TO), fu = segMetrics(r.curve, 260, TO);
  const close = (a, b, w) => { if (Math.abs(a - b) > 1e-9) throw new Error(`REGRESIÓN ${w}: ${a} ≠ ${b}`); };
  close(cf.cagr, REF.c0.canon.confirm.cagr, "confirm CAGR");
  close(cf.mdd, REF.c0.canon.confirm.mdd, "confirm MaxDD");
  close(tr.cagr, REF.c0.canon.train.cagr, "train CAGR");
  close(fu.cagr, REF.c0.canon.full.cagr, "full CAGR");
  console.log("CONTROL DE REGRESIÓN: canónica C0 ≡ backtests/rally-joint-study.json (<1e-9). OK\n");
}
if (REF.veredictoFinal?.verdict !== "CERTIFICAR_ACTUAL") {
  throw new Error(`el JSON del estudio no dice CERTIFICAR_ACTUAL (${REF.veredictoFinal?.verdict}) — este estrés presupone ese veredicto`);
}

const OUT = {
  ranAt: new Date().toISOString(),
  objeto: "estrés de la CERTEZA del veredicto CERTIFICAR_ACTUAL del estudio conjunto (C0 sin cambios)",
  umbralesCandidatoFuturo: "edge medio confirm ≥ +1 pp Y gana ≥7/10 fases Y ambas mitades ≥0 Y edge medio train ≥ −3 pp (pre-definidos aquí, mismos P1/P3/P5 del verificador de cadencia con barra material a mitad)",
};

// ─── A) ensemble 10 fases: C0 y retadores, con sub-mitades ───────────────────
const PHASES10 = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350];
const CHALLENGERS = {
  C0: {},
  ST_FIJO35: { stopFn: () => 0.35 },
  N8_PROP: { topN: 8, capLo: 5, capHi: 25 },
  ROT_RECALC: { recalc: true },
  ROT_MIX90: { mix: [0.9, 0.1] },
  CAD_63: { review: 63 },
};
console.log("═══ A) ENSEMBLE 10 fases (260..350) — C0 vs mejores no-passers por eje + CAD_63 ═══");
const ens = {};
for (const [name, cfg] of Object.entries(CHALLENGERS)) {
  ens[name] = PHASES10.map((FROM) => cellOf(cfg, FROM));
  const cf = ens[name].map((c) => c.confirm), tr = ens[name].map((c) => c.train);
  console.log(`  ${name.padEnd(11)} cf medio ${f1(mean(cf))} · mín ${f1(Math.min(...cf))} · máx ${f1(Math.max(...cf))} · sd ${f1(sd(cf))} ‖ tr medio ${f1(mean(tr))} · 22-23 ${f1(mean(ens[name].map((c) => c.confirmA)))} · 24-26 ${f1(mean(ens[name].map((c) => c.confirmB)))}`);
}
OUT.ensemble = { fases: PHASES10, celdas: ens };

// consistencia con la sonda de cadencia ya guardada (mismas celdas C0/CAD_63)
{
  const probe = JSON.parse(fs.readFileSync("backtests/rally-joint-cadence-probe-20bp.json", "utf8"));
  const d1 = Math.abs(probe.ensemble.grid["84"][0].confirm - ens.C0[0].confirm);
  const d2 = Math.abs(probe.ensemble.grid["63"][0].confirm - ens.CAD_63[0].confirm);
  if (d1 > 1e-9 || d2 > 1e-9) throw new Error(`inconsistencia con la sonda de cadencia (Δ ${d1}, ${d2})`);
  console.log("  Consistencia con rally-joint-cadence-probe-20bp.json (celdas C0@84 y CAD_63@63, fase 260): OK");
}

// ─── B) sensibilidad ±1 unidad por parámetro (fases 260/280/300) ─────────────
console.log("\n═══ B) SENSIBILIDAD ±1 UNIDAD de C0 (media y mín de cfCAGR sobre fases 260/280/300; Δ vs C0 mismas fases) ═══");
const PH3 = [260, 280, 300];
const PERTS = [
  { name: "N9", grupo: "topN", unidad: "−1 nombre", cfg: { topN: 9, capLo: 40 / 9, capHi: 200 / 9 } },
  { name: "N11", grupo: "topN", unidad: "+1 nombre", cfg: { topN: 11, capLo: 40 / 11, capHi: 200 / 11 } },
  { name: "REV83", grupo: "revision", unidad: "−1 sesión", cfg: { review: 83 } },
  { name: "REV85", grupo: "revision", unidad: "+1 sesión", cfg: { review: 85 } },
  { name: "REV79", grupo: "revision", unidad: "−5 sesiones (paso jitter)", cfg: { review: 79 } },
  { name: "REV89", grupo: "revision", unidad: "+5 sesiones (paso jitter)", cfg: { review: 89 } },
  { name: "SLOPE030", grupo: "stopPendiente", unidad: "−0,05", cfg: { slope: 0.30 } },
  { name: "SLOPE040", grupo: "stopPendiente", unidad: "+0,05", cfg: { slope: 0.40 } },
  { name: "BASE11", grupo: "stopBase", unidad: "−1 pp", cfg: { base: 11 } },
  { name: "BASE13", grupo: "stopBase", unidad: "+1 pp", cfg: { base: 13 } },
  { name: "STOPLO14", grupo: "stopClampLo", unidad: "−1 pp", cfg: { stopLo: 14 } },
  { name: "STOPLO16", grupo: "stopClampLo", unidad: "+1 pp", cfg: { stopLo: 16 } },
  { name: "STOPHI44", grupo: "stopClampHi", unidad: "−1 pp", cfg: { stopHi: 44 } },
  { name: "STOPHI46", grupo: "stopClampHi", unidad: "+1 pp", cfg: { stopHi: 46 } },
  { name: "MIX60", grupo: "mezclaSalto", unidad: "−0,1 score", cfg: { mix: [0.6, 0.4] } },
  { name: "MIX80", grupo: "mezclaSalto", unidad: "+0,1 score", cfg: { mix: [0.8, 0.2] } },
  { name: "CAPLO3", grupo: "capPesoLo", unidad: "−1 pp", cfg: { capLo: 3 } },
  { name: "CAPLO5", grupo: "capPesoLo", unidad: "+1 pp", cfg: { capLo: 5 } },
  { name: "CAPHI19", grupo: "capPesoHi", unidad: "−1 pp", cfg: { capHi: 19 } },
  { name: "CAPHI21", grupo: "capPesoHi", unidad: "+1 pp", cfg: { capHi: 21 } },
];
const c0ph3 = PH3.map((FROM) => ens.C0[PHASES10.indexOf(FROM)]);
const c0Mean = mean(c0ph3.map((c) => c.confirm)), c0Min = Math.min(...c0ph3.map((c) => c.confirm));
console.log(`  C0 mismas fases: cf medio ${f1(c0Mean)} · mín ${f1(c0Min)}`);
console.log(["  Vecino".padEnd(12), "grupo".padEnd(14), "unidad".padEnd(26), "cfMedio".padStart(8), "ΔvsC0".padStart(7), "cfMín".padStart(8), "ΔtrMedio".padStart(9)].join(" "));
OUT.sensibilidad = [];
for (const p of PERTS) {
  const cells = PH3.map((FROM) => cellOf(p.cfg, FROM));
  const m = mean(cells.map((c) => c.confirm)), mn = Math.min(...cells.map((c) => c.confirm));
  const dTr = mean(cells.map((c) => c.train)) - mean(c0ph3.map((c) => c.train));
  const row = { ...p, cfMean: m, cfMin: mn, dCfMean: m - c0Mean, dCfMin: mn - c0Min, dTrMean: dTr };
  OUT.sensibilidad.push(row);
  console.log(["  " + p.name.padEnd(10), p.grupo.padEnd(14), p.unidad.padEnd(26), f1(m).padStart(8), f1(m - c0Mean).padStart(7), f1(mn).padStart(8), f1(dTr).padStart(9)].join(" "));
}
// veredicto meseta/pico por grupo: pico si TODOS los vecinos del grupo caen >3 pp
const grupos = [...new Set(PERTS.map((p) => p.grupo))];
OUT.mesetaPorGrupo = {};
let picos = [];
for (const g of grupos) {
  const ds = OUT.sensibilidad.filter((r) => r.grupo === g).map((r) => r.dCfMean);
  const pico = ds.every((d) => d < -0.03);
  const encima = ds.some((d) => d > 0.03);
  OUT.mesetaPorGrupo[g] = { deltas: ds, lectura: pico ? "PICO" : encima ? "vecino >3 pp POR ENCIMA" : "meseta" };
  if (pico) picos.push(g);
}
console.log(`  Lectura: ${picos.length ? `PICO en ${picos.join(", ")} — sospechoso` : "MESETA en todos los grupos (ningún parámetro es un pico aislado)"}`);
for (const g of grupos) if (OUT.mesetaPorGrupo[g].lectura.includes("ENCIMA")) console.log(`  · nota: ${g} tiene vecino >3 pp por encima (C0 no es el máximo local de ese eje — ver bloque D para si es señal)`);

// ─── C) estabilidad del ORDEN ante fase y cadencia ───────────────────────────
console.log("\n═══ C) ORDEN DE VARIANTES: por fase (rev 84) y por cadencia (fase 260) ═══");
const NAMES = Object.keys(CHALLENGERS).filter((n) => n !== "CAD_63"); // cadencia aparte
{
  const rankPhase = (k) => NAMES.slice().sort((a, b) => ens[b][k].confirm - ens[a][k].confirm);
  const base = rankPhase(0);
  const rhos = [], firsts = {};
  for (let k = 0; k < PHASES10.length; k++) {
    const rk = rankPhase(k);
    firsts[rk[0]] = (firsts[rk[0]] ?? 0) + 1;
    if (k > 0) rhos.push(spearman(NAMES.map((n) => base.indexOf(n)), NAMES.map((n) => rk.indexOf(n))));
  }
  const c0Pos = PHASES10.map((_, k) => rankPhase(k).indexOf("C0") + 1);
  OUT.ordenPorFase = { ordenFase260: base, rhoVsFase260: rhos, rhoMedio: mean(rhos), lideresPorFase: firsts, posC0PorFase: c0Pos };
  console.log(`  Orden fase 260 (cf): ${base.join(" > ")}`);
  console.log(`  Spearman vs fase 260 en las otras 9 fases: medio ${mean(rhos).toFixed(2)} · mín ${Math.min(...rhos).toFixed(2)}`);
  console.log(`  Líder por fase: ${Object.entries(firsts).map(([n, c]) => `${n} ${c}/10`).join(" · ")} · posición de C0: ${c0Pos.join(",")}`);
}
{
  const revs = [63, 84, 105];
  const tab = {};
  for (const rev of revs) {
    tab[rev] = {};
    for (const n of NAMES) tab[rev][n] = rev === 84 ? ens[n][0].confirm : cellOf({ ...CHALLENGERS[n], review: rev }, 260).confirm;
  }
  const rankOf = (rev) => NAMES.slice().sort((a, b) => tab[rev][b] - tab[rev][a]);
  const r84 = rankOf(84);
  const rho63 = spearman(NAMES.map((n) => r84.indexOf(n)), NAMES.map((n) => rankOf(63).indexOf(n)));
  const rho105 = spearman(NAMES.map((n) => r84.indexOf(n)), NAMES.map((n) => rankOf(105).indexOf(n)));
  OUT.ordenPorCadencia = { cfCagr: tab, orden: Object.fromEntries(revs.map((r) => [r, rankOf(r)])), spearman: { rev63vs84: rho63, rev105vs84: rho105 } };
  console.log(`  Orden por cadencia (fase 260): 63→${rankOf(63).join(">")} · 84→${r84.join(">")} · 105→${rankOf(105).join(">")}`);
  console.log(`  Spearman rev63 vs 84: ${rho63?.toFixed(2)} · rev105 vs 84: ${rho105?.toFixed(2)}`);
}

// ─── D) certeza del gate: ¿algún retador consistentemente a <1 pp? ───────────
console.log("\n═══ D) CERTEZA — edges vs C0 en el ensemble (umbral candidato futuro pre-definido) ═══");
console.log(["  Retador".padEnd(13), "edge medio".padStart(11), "mín".padStart(7), "gana".padStart(6), "22-23".padStart(8), "24-26".padStart(8), "ΔtrMedio".padStart(9), "→ veredicto".padEnd(20)].join(" "));
OUT.certeza = [];
for (const name of Object.keys(CHALLENGERS)) {
  if (name === "C0") continue;
  const e = PHASES10.map((_, k) => ens[name][k].confirm - ens.C0[k].confirm);
  const eA = PHASES10.map((_, k) => ens[name][k].confirmA - ens.C0[k].confirmA);
  const eB = PHASES10.map((_, k) => ens[name][k].confirmB - ens.C0[k].confirmB);
  const eTr = PHASES10.map((_, k) => ens[name][k].train - ens.C0[k].train);
  const wins = e.filter((x) => x > 0).length;
  const cand = mean(e) >= 0.01 && wins >= 7 && mean(eA) >= 0 && mean(eB) >= 0 && mean(eTr) >= -0.03;
  const row = {
    retador: name, edgeMedio: mean(e), edgeMin: Math.min(...e), edgeMax: Math.max(...e), ganaFases: `${wins}/10`,
    mitadA: mean(eA), mitadB: mean(eB), edgeTrainMedio: mean(eTr), edgePorFase: Object.fromEntries(PHASES10.map((p, k) => [p, e[k]])),
    candidatoFuturo: cand,
  };
  OUT.certeza.push(row);
  console.log(["  " + name.padEnd(11), f1(mean(e)).padStart(11), f1(Math.min(...e)).padStart(7), `${wins}/10`.padStart(6), f1(mean(eA)).padStart(8), f1(mean(eB)).padStart(8), f1(mean(eTr)).padStart(9), (cand ? "CANDIDATO FUTURO" : "no").padEnd(20)].join(" "));
}
const candidatos = OUT.certeza.filter((r) => r.candidatoFuturo).map((r) => r.retador);

// ─── D2) adjudicación de candidatos: ¿dominancia en TODAS las construcciones? ─
// El gate original suspendió a N8_PROP por peor-celda en la malla 3 fases × 3
// cadencias. Aquí se amplía esa malla a 10 fases × 3 cadencias (30 celdas) para
// ver si aquel suspenso era ruido de 3 fases o debilidad real fuera de rev 84.
console.log("\n═══ D2) ADJUDICACIÓN de candidatos — malla 10 fases × cadencias 63/84/105 vs C0 ═══");
OUT.adjudicacion = [];
for (const name of candidatos) {
  const porCadencia = {};
  let allDominant = true;
  for (const rev of [63, 84, 105]) {
    const cand = rev === 84 ? ens[name] : PHASES10.map((FROM) => cellOf({ ...CHALLENGERS[name], review: rev }, FROM));
    const base = rev === 84 ? ens.C0 : PHASES10.map((FROM) => cellOf({ review: rev }, FROM));
    const e = PHASES10.map((_, k) => cand[k].confirm - base[k].confirm);
    const eTr = PHASES10.map((_, k) => cand[k].train - base[k].train);
    const wins = e.filter((x) => x > 0).length;
    const worstCand = Math.min(...cand.map((c) => c.confirm)), worstBase = Math.min(...base.map((c) => c.confirm));
    const wTrCand = Math.min(...cand.map((c) => c.train)), wTrBase = Math.min(...base.map((c) => c.train));
    const mddCand = Math.max(...cand.map((c) => c.confirmMdd)), mddBase = Math.max(...base.map((c) => c.confirmMdd));
    porCadencia[rev] = {
      edgeMedio: mean(e), wins: `${wins}/10`, edgeTrainMedio: mean(eTr),
      peorFase: { cand: worstCand, c0: worstBase, delta: worstCand - worstBase },
      peorFaseTrain: { cand: wTrCand, c0: wTrBase, delta: wTrCand - wTrBase },
      peorMddConfirm: { cand: mddCand, c0: mddBase, delta: mddCand - mddBase },
    };
    if (!(wins >= 8 && worstCand > worstBase && mean(e) >= 0.02)) allDominant = false;
    console.log(`  ${name} @rev${rev}: edge medio ${f1(mean(e))} · gana ${wins}/10 · Δpeor-fase ${f1(worstCand - worstBase)} · ΔpeorTr ${f1(wTrCand - wTrBase)} · ΔpeorMdd ${f1(mddCand - mddBase)}`);
  }
  OUT.adjudicacion.push({ retador: name, porCadencia, dominanciaTotal: allDominant });
  console.log(`  → ${name}: ${allDominant ? "DOMINANCIA en las 3 construcciones (el suspenso de peor-celda del estudio era ruido de 3 fases)" : "dominancia DEPENDIENTE de construcción — candidato futuro, no refutación"}`);
}

// ─── E) sondas de cadencia guardadas (CAD_63 ya adjudicada — no re-litigar) ──
{
  const p20 = JSON.parse(fs.readFileSync("backtests/rally-joint-cadence-probe-20bp.json", "utf8"));
  const p50 = JSON.parse(fs.readFileSync("backtests/rally-joint-cadence-probe-50bp.json", "utf8"));
  OUT.sondasCadencia = {
    bp20: { edgeMedio: p20.edges63vs84.confirmMedio, wins: p20.edges63vs84.winsConfirm, resultado: p20.resultado },
    bp50: { edgeMedio: p50.edges63vs84.confirmMedio, resultado: p50.resultado },
    nota: "CAD_63 fue refutada por P1 (6/10) y P2 (<2 pp) — aquí solo se verifica consistencia y se reusa",
  };
  console.log(`\nE) Sondas cadencia guardadas: 20 pb edge ${f1(p20.edges63vs84.confirmMedio)} (${p20.edges63vs84.winsConfirm}/10) · 50 pb edge ${f1(p50.edges63vs84.confirmMedio)} — refutación en pie`);
}

// ─── veredicto ───────────────────────────────────────────────────────────────
// REFUTA solo si (a) C0 es un PICO de sensibilidad (sobreajuste del propio C0),
// o (b) un candidato muestra DOMINANCIA TOTAL (≥8/10 fases, edge ≥2 pp y mejor
// peor-fase en LAS TRES construcciones de cadencia): eso probaría que el
// suspenso del gate original fue un artefacto y la certificación no se sostiene.
// MATIZA si hay candidatos futuros consistentes pero dependientes de
// construcción (la certificación sigue en pie bajo su gate pre-registrado).
const dominantes = OUT.adjudicacion.filter((a) => a.dominanciaTotal).map((a) => a.retador);
const veredicto =
  picos.length || dominantes.length ? "REFUTA" :
  candidatos.length ? "MATIZA" : "CONFIRMA";
OUT.veredicto = {
  veredicto,
  mesetaOPico: picos.length ? `PICO en ${picos.join(", ")}` : "meseta en los 9 grupos de parámetros",
  candidatosFuturos: candidatos,
  dominanciaTotal: dominantes,
  lectura: veredicto === "CONFIRMA"
    ? "CERTIFICAR_ACTUAL aguanta el estrés: C0 en meseta, orden estable, ningún retador consistente cerca del gate"
    : veredicto === "MATIZA"
      ? `certificación EN PIE bajo su gate pre-registrado, pero con matiz: candidato(s) futuro(s) consistente(s): ${candidatos.join(", ")} — merecen estudio propio pre-registrado antes de tocar nada`
      : picos.length
        ? `C0 es un PICO de sensibilidad en ${picos.join(", ")} — sobreajuste`
        : `dominancia total de ${dominantes.join(", ")} en las 3 construcciones — el suspenso del gate original era ruido; la certificación no se sostiene`,
};
console.log(`\nVEREDICTO DEL ESTRÉS: ${veredicto} — ${OUT.veredicto.lectura}`);

fs.writeFileSync("backtests/rally-joint-stress.json", JSON.stringify(OUT, null, 1));
console.log(`\nGuardado: backtests/rally-joint-stress.json · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
