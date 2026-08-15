/**
 * RALLY — ESTUDIO 2: TRAILING STOP DINÁMICO CORRELACIONADO CON RECORRIDO Y ESTADO
 * ================================================================================
 * Hipótesis de Sergi: la anchura del trailing debería depender del RECORRIDO
 * (ALTO/MEDIO/BAJO) y/o del ESTADO (IDEAL/LEJOS/EN_MAXIMOS): recorrido bajo o en
 * máximos → stop muy ceñido (salir del pullback perdiendo lo mínimo); tendencia
 * sana con recorrido alto → stop ancho (dejar correr).
 *
 * Parte A (predictiva): ¿qué señal anticipa mejor el pullback inmediato tras una
 * entrada del top-10 — el recorrido, el estado, o ambos? Se mide el retroceso desde
 * el pico en las 21 y 63 sesiones siguientes, con partición train/test.
 *
 * Parte B (política): backtest de cartera v4 completo (convicción, salto al mejor
 * score al saltar el stop) con la anchura por celda recorrido×estado. Protocolo
 * anti-sobreajuste de la casa: malla 3 fases × 3 cadencias, peor semestre por celda;
 * un retador solo vale si domina al campeón celda a celda.
 *
 * Salida: backtests/rally-dynamic-trailing.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, evalCurve, scoreV4, runwayLevel, entryZone, trailCat,
  isNum, mean, f1,
} from "./rally-study-lib.mjs";

console.log("Cargando universo…");
const { T, dates, D, spyClose } = loadUniverse();
console.log(`Tickers: ${T.length} · calendario ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);

const OUT = { ranAt: new Date().toISOString(), predictivo: {}, politicas: [] };
const TO = D - 1;

// ═══ PARTE A — ¿QUÉ PREDICE EL PULLBACK INMEDIATO? ══════════════════════════
// ddpk21/ddpk63: máximo retroceso desde el PICO (lo que de verdad hace saltar un
// trailing) en las 21/63 sesiones tras la entrada. hit10: ¿hubo retroceso ≥10% en 63?
{
  const episodes = [];
  for (let i = 280; i <= TO - 63; i += 21) {
    const cands = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], f = t.feat[i];
      if (!f || !isNum(t.adj[i])) continue;
      const s = scoreV4(f);
      if (s != null) cands.push({ ti, s, f });
    }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands.slice(0, 10)) {
      const t = T[c.ti];
      const entry = t.adj[i];
      let peak = entry, dd21 = 0, dd63 = 0;
      for (let j = i + 1; j <= Math.min(i + 63, TO); j++) {
        const px = t.adj[j]; if (!isNum(px)) continue;
        if (px > peak) peak = px;
        const dd = 1 - px / peak;
        if (j <= i + 21) dd21 = Math.max(dd21, dd);
        dd63 = Math.max(dd63, dd);
      }
      episodes.push({ i, rw: runwayLevel(c.f), zn: entryZone(c.f), dd21, dd63, hit10: dd63 >= 0.10 ? 1 : 0 });
    }
  }
  const SPLIT = 280 + Math.floor((TO - 280) / 2);
  const train = episodes.filter((e) => e.i < SPLIT), test = episodes.filter((e) => e.i >= SPLIT);
  const agg = (eps) => ({ n: eps.length, dd21: mean(eps.map((e) => e.dd21)), dd63: mean(eps.map((e) => e.dd63)), hit10: mean(eps.map((e) => e.hit10)) });

  console.log(`═══ A) PREDICCIÓN DEL PULLBACK — ${episodes.length} episodios (train ${train.length} / test ${test.length}) ═══`);
  const tables = {};
  for (const [name, keyOf, keys] of [
    ["RECORRIDO", (e) => e.rw, ["ALTO", "MEDIO", "BAJO"]],
    ["ESTADO", (e) => e.zn, ["IDEAL", "LEJOS", "EN_MAXIMOS"]],
  ]) {
    console.log(`\n${name}                 train: dd-pico21  dd-pico63  P(dd≥10%)  n   ‖  test: dd-pico21  dd-pico63  P(dd≥10%)  n`);
    tables[name] = {};
    for (const k of keys) {
      const a = agg(train.filter((e) => keyOf(e) === k)), z = agg(test.filter((e) => keyOf(e) === k));
      tables[name][k] = { train: a, test: z };
      console.log(`  ${k.padEnd(12)}       ${f1(a.dd21).padStart(9)} ${f1(a.dd63).padStart(10)} ${f1(a.hit10, 0).padStart(9)} ${String(a.n).padStart(5)}  ‖ ${f1(z.dd21).padStart(11)} ${f1(z.dd63).padStart(10)} ${f1(z.hit10, 0).padStart(9)} ${String(z.n).padStart(5)}`);
    }
  }
  console.log("\nMATRIZ recorrido×estado (dd-pico63 train ‖ test · n):");
  tables.MATRIZ = {};
  for (const rw of ["ALTO", "MEDIO", "BAJO"]) {
    const row = [];
    tables.MATRIZ[rw] = {};
    for (const zn of ["IDEAL", "LEJOS", "EN_MAXIMOS"]) {
      const a = agg(train.filter((e) => e.rw === rw && e.zn === zn));
      const z = agg(test.filter((e) => e.rw === rw && e.zn === zn));
      tables.MATRIZ[rw][zn] = { train: a, test: z };
      row.push(`${zn.slice(0, 6)}: ${f1(a.dd63)}‖${f1(z.dd63)} (${a.n}/${z.n})`);
    }
    console.log(`  ${rw.padEnd(6)} ${row.join("   ")}`);
  }
  OUT.predictivo = tables;
}

// ═══ PARTE B — POLÍTICAS DE ANCHURA POR CELDA, BACKTEST DE CARTERA ══════════
// Todas las variantes con salto al MEJOR SCORE al saltar el stop (criterio neutro;
// el criterio de rotación es el estudio 3) y pesos por convicción.
const W_RW = (m) => (f) => m[runwayLevel(f)] / 100;
const W_ZN = (m) => (f) => m[entryZone(f)] / 100;
const W_MIN = (mr, mz) => (f) => Math.min(mr[runwayLevel(f)], mz[entryZone(f)]) / 100;
const W_MATRIX = (base, mod, floor = 8) => (f) => Math.max(floor, base[runwayLevel(f)] + mod[entryZone(f)]) / 100;

const CONFIGS = [
  { label: "CAMPEÓN v4 (sin trailing)", widthOf: null },
  { label: "fijo 30%", widthOf: () => 0.30 },
  { label: "fijo 20%", widthOf: () => 0.20 },
  { label: "fijo 10%", widthOf: () => 0.10 },
  { label: "fijo 35%", widthOf: () => 0.35 },
  { label: "fijo 40%", widthOf: () => 0.40 },
  { label: "catástrofe ATR 25-35% (panel)", widthOf: (f) => trailCat(f.atr) },
  { label: "REC A30/M20/B10 @entrada", widthOf: W_RW({ ALTO: 30, MEDIO: 20, BAJO: 10 }) },
  { label: "REC A35/M25/B15 @entrada", widthOf: W_RW({ ALTO: 35, MEDIO: 25, BAJO: 15 }) },
  { label: "REC A40/M30/B20 @entrada", widthOf: W_RW({ ALTO: 40, MEDIO: 30, BAJO: 20 }) },
  { label: "REC INVERSO A10/M20/B30 (control)", widthOf: W_RW({ ALTO: 10, MEDIO: 20, BAJO: 30 }) },
  { label: "EST I30/L20/X10 @entrada", widthOf: W_ZN({ IDEAL: 30, LEJOS: 20, EN_MAXIMOS: 10 }) },
  { label: "EST I35/L25/X12 @entrada", widthOf: W_ZN({ IDEAL: 35, LEJOS: 25, EN_MAXIMOS: 12 }) },
  { label: "EST-DATOS I35/L20/X35 (parte A)", widthOf: W_ZN({ IDEAL: 35, LEJOS: 20, EN_MAXIMOS: 35 }) },
  { label: "EST-DATOS I30/L18/X30 (parte A)", widthOf: W_ZN({ IDEAL: 30, LEJOS: 18, EN_MAXIMOS: 30 }) },
  { label: "AMBOS min(REC,EST) 30/20/10", widthOf: W_MIN({ ALTO: 30, MEDIO: 20, BAJO: 10 }, { IDEAL: 30, LEJOS: 20, EN_MAXIMOS: 10 }) },
  { label: "MATRIZ base A35/M25/B15 −X10/L5", widthOf: W_MATRIX({ ALTO: 35, MEDIO: 25, BAJO: 15 }, { IDEAL: 0, LEJOS: -5, EN_MAXIMOS: -10 }) },
  { label: "REC A30/M20/B10 DIARIO", widthOf: W_RW({ ALTO: 30, MEDIO: 20, BAJO: 10 }), dailyWidth: true },
  { label: "REC A30/M20/B10 DIARIO ceñir-solo", widthOf: W_RW({ ALTO: 30, MEDIO: 20, BAJO: 10 }), dailyWidth: true, ratchet: true },
  { label: "REC A40/M30/B20 DIARIO", widthOf: W_RW({ ALTO: 40, MEDIO: 30, BAJO: 20 }), dailyWidth: true },
];

function mkJumpBest(i, heldSet) {
  let best = null, bs = -Infinity;
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s != null && s > bs) { bs = s; best = ti; }
  }
  return best;
}

const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
console.log("\n═══ B) POLÍTICAS — malla 9 celdas (peor semestre) + métricas canónicas 260·84 ═══");
console.log("Política".padEnd(36), "mín".padStart(7), "mediana".padStart(8), " ‖ ", "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(5), "Sharpe".padStart(7), "ops/año".padStart(8), "winrate".padStart(8));
const results = [];
for (const cfg of CONFIGS) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const r = simulate(T, D, {
      FROM, review, conviction: true,
      widthOf: cfg.widthOf, dailyWidth: cfg.dailyWidth ?? false, ratchet: cfg.ratchet ?? false,
      pickJump: cfg.widthOf ? mkJumpBest : null,
    });
    const e = evalCurve(r.curve, FROM, D, r.dret);
    cells.push(e.worst);
    if (FROM === 260 && review === 84) {
      const years = (D - 1 - FROM) / 252;
      canon = { ...e, tradesYr: r.trades / years, jumps: r.jumpCount, winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open) };
    }
  }
  const minC = Math.min(...cells), medC = [...cells].sort((a, b) => a - b)[4];
  results.push({ label: cfg.label, cells, minC, medC, canon });
  console.log(cfg.label.padEnd(36), f1(minC).padStart(7), f1(medC).padStart(8), " ‖ ",
    f1(canon.cagr).padStart(7), f1(canon.mdd).padStart(7), canon.mar.toFixed(2).padStart(5),
    (canon.sharpe ?? 0).toFixed(2).padStart(7), canon.tradesYr.toFixed(0).padStart(8), f1(canon.winrate, 0).padStart(8));
}

const champ = results[0];
console.log("\n=== ¿Domina alguna política al campeón (sin trailing) celda a celda? ===");
for (const r of results.slice(1)) {
  let wins = 0;
  for (let i = 0; i < 9; i++) if (r.cells[i] > champ.cells[i]) wins++;
  console.log(`  ${r.label.padEnd(36)} gana ${wins}/9 celdas  ·  caída canónica ${f1(r.canon.mdd)} vs ${f1(champ.canon.mdd)}  ${wins === 9 ? "✅ DOMINA" : wins >= 5 ? "🟡 mixto" : "❌ pierde"}`);
}

// mejor política DEFENSIVA: entre las que recortan la caída canónica ≥3 puntos,
// la de mejor mediana de peor-semestre (para quien opere con stops sí o sí)
const defensive = results.slice(1).filter((r) => r.canon.mdd < champ.canon.mdd - 0.03);
defensive.sort((a, b) => b.medC - a.medC);
if (defensive.length) {
  const d = defensive[0];
  console.log(`\nMejor política DEFENSIVA (recorta caída ≥3 pp): ${d.label} · mediana peor-semestre ${f1(d.medC)} · CAGR ${f1(d.canon.cagr)} · caída ${f1(d.canon.mdd)}`);
  OUT.mejorDefensiva = d.label;
}

OUT.politicas = results.map((r) => ({ label: r.label, cells: r.cells, minC: r.minC, medC: r.medC, canon: r.canon }));
fs.writeFileSync("backtests/rally-dynamic-trailing.json", JSON.stringify(OUT, null, 1));
console.log("\nGuardado: backtests/rally-dynamic-trailing.json");
