/**
 * RALLY — ESTUDIO 4b: RONDA 2 — HÍBRIDOS RECORRIDO-CONTINUO × ATR
 * ================================================================
 * La ronda 1 (rally-adaptive-stop-study.mjs) dejó:
 *   · REC A40/M30/B20 = mejor 1ª mitad (selección walk-forward honesta) y 7/9
 *   · ATR-k puro se satura en el techo con el top-10 actual (ATR 6-12%): sin dispersión
 *   · salud compuesta y k-por-ticker: NO baten (clasificador OOS ~0,16 y rho 0,02)
 * Esta ronda busca la política ADAPTATIVA con dispersión REAL por ticker que iguale
 * o supere la robustez de REC/fijo30: recorrido en versión CONTINUA (runwayScore
 * 0-100) combinado con el ATR de producción.
 *
 * Mismo protocolo: señales ajustadas, malla 9 celdas, salto mezcla, 20 pb, determinista.
 *
 * ⚠ NOTA DE HONESTIDAD (verificación adversarial 15-ago-2026): el CRITERIO DE
 * SELECCIÓN cambió entre rondas y el pivote queda documentado aquí. La ronda 1
 * ordenaba las elegibles por CAGR de la 2ª mitad (el criterio literal del mandato,
 * "máxima rentabilidad OOS"); con ese criterio habría ganado el FIJO 20% (2ª mitad
 * 48,3%) — pero elegir mirando la mitad de test es seleccionar sobre el test.
 * Esta ronda usa el criterio correcto: ELEGIR con la 1ª mitad, CONFIRMAR con la 2ª
 * (walk-forward). Bajo ese criterio gana H4 (1ª mitad 42,0% → 2ª 40,2%); el fijo
 * 20% queda retratado como frágil (1ª mitad 33,7%, mediana de malla 28,2%).
 * Salida: backtests/rally-adaptive-stop-round2.json
 */
import fs from "node:fs";
import {
  loadUniverse, simulate, evalCurve, scoreV4, runwayScore, runwayLevel,
  isNum, f1, clamp,
} from "./rally-study-lib.mjs";

console.log("Cargando universo (señales AJUSTADAS)…");
const { T, dates, D } = loadUniverse({ adjustedSignals: true, rich: true });
console.log(`Tickers: ${T.length} · ${dates[0]} → ${dates.at(-1)} (${D} sesiones)\n`);

const OUT = { ranAt: new Date().toISOString(), politicas: [], hoy: [] };
const TO = D - 1;
const atrOf = (f) => (isNum(f.atrProd) ? f.atrProd : isNum(f.atr) ? f.atr : 3);
const REC = { ALTO: 40, MEDIO: 30, BAJO: 20 };

// híbridos: base por recorrido (discreto o continuo) ± inclinación por ATR
const H = {
  "REC A40/M30/B20 @entrada (ref)": (f) => REC[runwayLevel(f)] / 100,
  "H1 REC + 1.5·(ATR−3) [15,48]": (f) => clamp(REC[runwayLevel(f)] + 1.5 * (atrOf(f) - 3), 15, 48) / 100,
  "H2 REC + 2·(ATR−3) [15,48]": (f) => clamp(REC[runwayLevel(f)] + 2 * (atrOf(f) - 3), 15, 48) / 100,
  "H3 REC × (0.8+0.4·ATR/6) [15,48]": (f) => clamp(REC[runwayLevel(f)] * (0.8 + 0.4 * Math.min(1, atrOf(f) / 6)), 15, 48) / 100,
  "H4 RWc: 12+0.35·runway [15,45]": (f) => clamp(12 + 0.35 * runwayScore(f), 15, 45) / 100,
  "H5 RWc+ATR: 10+0.30·rw+1.2·(ATR−3)": (f) => clamp(10 + 0.30 * runwayScore(f) + 1.2 * (atrOf(f) - 3), 15, 48) / 100,
  "H6 REC A45/M32/B20 @entrada": (f) => ({ ALTO: 45, MEDIO: 32, BAJO: 20 })[runwayLevel(f)] / 100,
  "fijo 30% (ref)": () => 0.30,
  "fijo 20% (ref)": () => 0.20,
};

function jumpMezcla(i, heldSet) {
  let bi = null, bv = -Infinity;
  for (let ti = 0; ti < T.length; ti++) {
    if (heldSet.has(ti)) continue;
    const t = T[ti], f = t.feat[i];
    if (!f || !isNum(t.adj[i])) continue;
    const s = scoreV4(f);
    if (s == null) continue;
    const v = 0.7 * s + 0.3 * runwayScore(f);
    if (v > bv) { bv = v; bi = ti; }
  }
  return bi;
}

const PHASES = [260, 280, 300], REVIEWS = [63, 84, 105];
console.log("Política".padEnd(36), "mín".padStart(7), "mediana".padStart(8), " ‖ ", "CAGR".padStart(7), "MaxDD".padStart(7), "MAR".padStart(5), "Sharpe".padStart(7), "1ª mit".padStart(8), "2ª mit".padStart(8), "ops/a".padStart(6), "win".padStart(5));
const results = [];
for (const [label, widthOf] of Object.entries(H)) {
  const cells = [];
  let canon = null;
  for (const FROM of PHASES) for (const review of REVIEWS) {
    const r = simulate(T, D, { FROM, review, conviction: true, widthOf, pickJump: jumpMezcla });
    const e = evalCurve(r.curve, FROM, D, r.dret);
    cells.push(e.worst);
    if (FROM === 260 && review === 84) {
      const years = (D - 1 - FROM) / 252;
      canon = { ...e, tradesYr: r.trades / years, winrate: (r.wins + r.openWins) / Math.max(1, r.closed + r.open) };
    }
  }
  const minC = Math.min(...cells), medC = [...cells].sort((a, b) => a - b)[4];
  results.push({ label, cells, minC, medC, canon });
  console.log(label.padEnd(36), f1(minC).padStart(7), f1(medC).padStart(8), " ‖ ",
    f1(canon.cagr).padStart(7), f1(canon.mdd).padStart(7), canon.mar.toFixed(2).padStart(5), (canon.sharpe ?? 0).toFixed(2).padStart(7),
    f1(canon.cagrA).padStart(8), f1(canon.cagrB).padStart(8), canon.tradesYr.toFixed(0).padStart(6), f1(canon.winrate, 0).padStart(5));
}

const fijo30 = results.find((r) => r.label === "fijo 30% (ref)");
console.log(`\nSuelo (fijo30): mín ${f1(fijo30.minC)} · mediana ${f1(fijo30.medC)}`);
console.log("Elegibles (mín ≥ fijo30), por 1ª mitad (selección walk-forward) y 2ª (confirmación):");
for (const r of results.filter((x) => x.minC >= fijo30.minC - 1e-9).sort((a, b) => b.canon.cagrA - a.canon.cagrA)) {
  console.log(`  ${r.label.padEnd(36)} 1ª ${f1(r.canon.cagrA).padStart(7)} → 2ª ${f1(r.canon.cagrB).padStart(7)} · CAGR ${f1(r.canon.cagr)} · MaxDD ${f1(r.canon.mdd)} · MAR ${r.canon.mar.toFixed(2)} · med ${f1(r.medC)}`);
}

// dispersión REAL de stops hoy con cada candidata
{
  const last = TO;
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti], f = t.feat[last];
    if (!f || !isNum(t.adj[last])) continue;
    const s = scoreV4(f);
    if (s != null) cands.push({ ti, s, f });
  }
  cands.sort((a, b) => b.s - a.s);
  const SHOW = ["REC A40/M30/B20 @entrada (ref)", "H1 REC + 1.5·(ATR−3) [15,48]", "H5 RWc+ATR: 10+0.30·rw+1.2·(ATR−3)", "H4 RWc: 12+0.35·runway [15,45]"];
  console.log("\nLOS 10 DE HOY — stop por ticker (dispersión):");
  console.log("Ticker".padEnd(12), "ATR%".padStart(6), "rwScore".padStart(8), "nivel".padStart(7), ...SHOW.map((s) => s.slice(0, 14).padStart(16)));
  for (const c of cands.slice(0, 10)) {
    const f = c.f;
    const row = { sym: T[c.ti].sym, atrProd: f.atrProd, runway: runwayScore(f), nivel: runwayLevel(f) };
    for (const s of SHOW) row[s] = H[s](f);
    OUT.hoy.push(row);
    console.log(row.sym.padEnd(12), (f.atrProd ?? 0).toFixed(1).padStart(6), String(row.runway).padStart(8), row.nivel.padStart(7),
      ...SHOW.map((s) => f1(row[s], 0).padStart(16)));
  }
}

OUT.politicas = results.map((r) => ({ label: r.label, cells: r.cells, minC: r.minC, medC: r.medC, canon: r.canon }));
fs.writeFileSync("backtests/rally-adaptive-stop-round2.json", JSON.stringify(OUT, null, 1));
console.log("\nGuardado: backtests/rally-adaptive-stop-round2.json");
