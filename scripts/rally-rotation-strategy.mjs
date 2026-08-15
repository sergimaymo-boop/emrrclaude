/**
 * RALLY — ESTUDIO 3: ROTACIÓN DE CAPITAL TRAS CADA VENTA POR TRAILING STOP
 * =========================================================================
 * Hipótesis de Sergi: partir de los mejores tickets del scanner regulados por sus
 * trailing stops; cada vez que salta una venta, el capital liberado se reinvierte
 * en el mejor título del momento según el scanner. ¿Cuál criterio de reinversión
 * es mejor: recorrido alcista, estado ideal, o ambos?
 *
 * Se prueba la matriz completa:
 *   · trailing: fijo 30% (ganador del estudio 2) y catástrofe ATR 25-35% (panel)
 *   · criterio de salto: mejor score / recorrido ALTO / estado IDEAL / AMBOS /
 *     mezcla score+recorrido / excluir recorrido BAJO / ALEATORIO top-30 (control,
 *     semilla fija) — todos con degradado si no hay candidatos que cumplan
 *   · modo: con revisión periódica (malla 63/84/105) o ROTACIÓN PURA (cartera
 *     inicial + solo saltos de stop, sin revisiones)
 *
 * Protocolo anti-sobreajuste de la casa: malla 3 fases × 3 cadencias, peor semestre
 * por celda; dominancia celda a celda contra el campeón v4 sin trailing.
 * Comparación contra buy&hold del SPY y del universo (con su sesgo de supervivencia).
 *
 * Salida: backtests/rally-rotation-strategy.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, evalCurve, buyHolds, scoreV4, runwayLevel, runwayScore,
  entryZone, trailCat, mulberry32, isNum, f1,
} from "./rally-study-lib.mjs";

console.log("Cargando universo…");
const { T, dates, D, spyClose } = loadUniverse();
console.log(`Tickers: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);

const OUT = { ranAt: new Date().toISOString(), configs: [], benchmarks: {} };

// ─── criterios de reinversión (con degradado explícito) ─────────────────────
function candidatesAt(i, heldSet) {
  const out = [];
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s != null) out.push({ ti, s, f });
  }
  return out;
}
const best = (arr) => arr.reduce((a, b) => (b.s > a.s ? b : a), arr[0]);

const JUMPS = {
  score: () => (i, heldSet) => {
    const c = candidatesAt(i, heldSet);
    return c.length ? best(c).ti : null;
  },
  alto: () => (i, heldSet) => {
    const c = candidatesAt(i, heldSet);
    if (!c.length) return null;
    const alto = c.filter((x) => runwayLevel(x.f) === "ALTO");
    return (alto.length ? best(alto) : best(c)).ti;
  },
  ideal: () => (i, heldSet) => {
    const c = candidatesAt(i, heldSet);
    if (!c.length) return null;
    const id = c.filter((x) => entryZone(x.f) === "IDEAL");
    return (id.length ? best(id) : best(c)).ti;
  },
  ambos: () => (i, heldSet) => {
    const c = candidatesAt(i, heldSet);
    if (!c.length) return null;
    const both = c.filter((x) => runwayLevel(x.f) === "ALTO" && entryZone(x.f) === "IDEAL");
    if (both.length) return best(both).ti;
    const alto = c.filter((x) => runwayLevel(x.f) === "ALTO");
    return (alto.length ? best(alto) : best(c)).ti;
  },
  mezcla: () => (i, heldSet) => {
    const c = candidatesAt(i, heldSet);
    if (!c.length) return null;
    let bi = null, bv = -Infinity;
    for (const x of c) { const v = 0.7 * x.s + 0.3 * runwayScore(x.f); if (v > bv) { bv = v; bi = x.ti; } }
    return bi;
  },
  noBajo: () => (i, heldSet) => {
    const c = candidatesAt(i, heldSet);
    if (!c.length) return null;
    const ok = c.filter((x) => runwayLevel(x.f) !== "BAJO");
    return (ok.length ? best(ok) : best(c)).ti;
  },
  aleatorio: () => {
    const rng = mulberry32(42); // control con semilla fija: azar dentro del top-30 por score
    return (i, heldSet) => {
      const c = candidatesAt(i, heldSet);
      if (!c.length) return null;
      c.sort((a, b) => b.s - a.s);
      const pool = c.slice(0, Math.min(30, c.length));
      return pool[Math.floor(rng() * pool.length)].ti;
    };
  },
};

const TRAILINGS = {
  "fijo30": () => 0.30,
  "catATR": (f) => trailCat(f.atr),
};

// ─── configuraciones ────────────────────────────────────────────────────────
const CONFIGS = [{ label: "CAMPEÓN v4 (sin trailing, revisión)", trailing: null, jump: null, review: "grid" }];
for (const [tn, widthOf] of Object.entries(TRAILINGS))
  for (const jn of ["score", "alto", "ideal", "ambos", "mezcla", "noBajo"])
    CONFIGS.push({ label: `${tn} → salto ${jn} (revisión)`, trailing: widthOf, jump: jn, review: "grid" });
CONFIGS.push({ label: "fijo30 → salto aleatorio30 (control)", trailing: TRAILINGS.fijo30, jump: "aleatorio", review: "grid" });
for (const jn of ["score", "alto", "ambos"])
  CONFIGS.push({ label: `ROTACIÓN PURA fijo30 → salto ${jn}`, trailing: TRAILINGS.fijo30, jump: jn, review: null });

const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];

function runCells(cfg) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) {
    const reviews = cfg.review === "grid" ? REVIEWS : [null];
    for (const review of reviews) {
      const r = simulate(T, D, {
        FROM, review, conviction: true,
        widthOf: cfg.trailing, pickJump: cfg.jump ? JUMPS[cfg.jump]() : null,
      });
      const e = evalCurve(r.curve, FROM, D, r.dret);
      cells.push(e.worst);
      const isCanon = FROM === 260 && (review === 84 || cfg.review === null);
      if (isCanon) {
        const years = (D - 1 - FROM) / 252;
        canon = { ...e, tradesYr: r.trades / years, jumps: r.jumpCount, winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open) };
      }
    }
  }
  const minC = Math.min(...cells), medC = [...cells].sort((a, b) => a - b)[Math.floor(cells.length / 2)];
  return { cells, minC, medC, canon };
}

console.log("═══ ROTACIÓN DE CAPITAL — malla (peor semestre por celda) + métricas canónicas ═══");
console.log("Config".padEnd(40), "mín".padStart(7), "mediana".padStart(8), " ‖ ", "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(5), "Sharpe".padStart(7), "1ª mitad".padStart(9), "2ª mitad".padStart(9), "ops/año".padStart(8), "saltos".padStart(7), "winrate".padStart(8));
const results = [];
for (const cfg of CONFIGS) {
  const r = runCells(cfg);
  results.push({ label: cfg.label, ...r });
  const c = r.canon;
  console.log(cfg.label.padEnd(40), f1(r.minC).padStart(7), f1(r.medC).padStart(8), " ‖ ",
    f1(c.cagr).padStart(7), f1(c.mdd).padStart(7), c.mar.toFixed(2).padStart(5), (c.sharpe ?? 0).toFixed(2).padStart(7),
    f1(c.cagrA).padStart(9), f1(c.cagrB).padStart(9), c.tradesYr.toFixed(0).padStart(8), String(c.jumps).padStart(7), f1(c.winrate, 0).padStart(8));
}

// ─── dominancia contra el campeón ───────────────────────────────────────────
const champ = results[0];
console.log("\n=== ¿Alguna rotación domina al campeón celda a celda? (solo configs con malla 9) ===");
for (const r of results.slice(1)) {
  if (r.cells.length !== champ.cells.length) { console.log(`  ${r.label.padEnd(40)} (malla distinta: ${r.cells.length} celdas · mín ${f1(r.minC)} · mediana ${f1(r.medC)})`); continue; }
  let wins = 0;
  for (let i = 0; i < r.cells.length; i++) if (r.cells[i] > champ.cells[i]) wins++;
  console.log(`  ${r.label.padEnd(40)} gana ${wins}/${r.cells.length}  ·  caída ${f1(r.canon.mdd)} vs ${f1(champ.canon.mdd)}  ${wins === r.cells.length ? "✅ DOMINA" : wins >= 5 ? "🟡 mixto" : "❌ pierde"}`);
}

// ─── benchmarks buy & hold ──────────────────────────────────────────────────
{
  const FROM = 260;
  const bh = buyHolds(T, D, spyClose, FROM);
  const eS = evalCurve(bh.spy.curve, FROM, D, bh.spy.dret);
  const eU = evalCurve(bh.universe.curve, FROM, D, bh.universe.dret);
  console.log(`\nBuy&hold SPY:              CAGR ${f1(eS.cagr)} · caída ${f1(eS.mdd)} · MAR ${eS.mar.toFixed(2)} · Sharpe ${(eS.sharpe ?? 0).toFixed(2)}`);
  console.log(`Buy&hold universo (⚠️ sesgo supervivencia): CAGR ${f1(eU.cagr)} · caída ${f1(eU.mdd)} · MAR ${eU.mar.toFixed(2)} · Sharpe ${(eU.sharpe ?? 0).toFixed(2)}`);
  OUT.benchmarks = { spy: eS, universo: eU };
}

// ─── elección walk-forward: mejor criterio en la 1ª mitad → ¿aguanta en la 2ª? ──
{
  console.log("\n=== Walk-forward del criterio de salto (elegido SOLO con la 1ª mitad, fijo30+revisión) ===");
  const rows = results.filter((r) => r.label.startsWith("fijo30 → "));
  const bestIS = [...rows].sort((a, b) => b.canon.cagrA - a.canon.cagrA)[0];
  const bestOOS = [...rows].sort((a, b) => b.canon.cagrB - a.canon.cagrB)[0];
  console.log(`  Mejor 1ª mitad: ${bestIS.label} (${f1(bestIS.canon.cagrA)}) → 2ª mitad ${f1(bestIS.canon.cagrB)}`);
  console.log(`  Mejor 2ª mitad: ${bestOOS.label} (${f1(bestOOS.canon.cagrB)})`);
  OUT.walkForward = { bestIS: bestIS.label, bestIScagrA: bestIS.canon.cagrA, bestIScagrB: bestIS.canon.cagrB, bestOOS: bestOOS.label };
}

OUT.configs = results;
fs.writeFileSync("backtests/rally-rotation-strategy.json", JSON.stringify(OUT, null, 1));
console.log("\nGuardado: backtests/rally-rotation-strategy.json");
