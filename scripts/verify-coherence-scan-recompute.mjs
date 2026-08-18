/**
 * VERIFY-COHERENCE — auditoría producción↔especificación (17-ago-2026).
 *
 * Parte A (consistencia INTERNA del scan servido, sin depender de datos locales):
 *   con los propios metrics que sirve /api/rally-scan/last comprueba que cada campo
 *   derivado sale EXACTAMENTE de las fórmulas validadas:
 *     · rallyScore        = round(clamp(50 + 50·tanh(mom9m/75)))
 *     · trailingStop      = round(clamp(12 + 0,35·runway.score, 15, 45))
 *     · suggestedWeightPct= capNormalize(max(1, mom9m_i), [4,20], Σ=100) → round 0,1
 *     · runway.level      = ALTO≥75 / MEDIO≥55 / BAJO
 *     · entryTiming.zone  = IDEAL [0,96, 0,997] / EN_MAXIMOS >0,997 / LEJOS (prox 2dec)
 *     · components sRS/sMom/sTrend/sProx52w/sRvol/sAtr/sLiq desde los metrics servidos
 *   (los inputs servidos van redondeados a 2 decimales → tolerancias pequeñas).
 *
 * Parte B (recomputación INDEPENDIENTE con data/universe-10y.json, señales ajustadas
 *   = convención de producción): para los 10 tickers del scan recalcula m9, score,
 *   runway, stop y pesos M9_RAW en la ÚLTIMA fecha local, y el top-10 local completo.
 *   OJO: el universo local llega hasta 2026-08-07 y el scan usa datos hasta ~14-ago →
 *   las diferencias de nivel se documentan, no son incoherencia de fórmula.
 *
 * Solo lee. No modifica nada.
 */
import fs from "node:fs";
import { loadUniverse, runwayScore, scoreV4, clamp, isNum } from "./rally-study-lib.mjs";

const SCAN_PATH = process.argv[2] ?? "/private/tmp/claude-501/-Users-sergimaymo-Desktop-Bolsa-Codex/94df227a-26bb-46ac-8ff3-cb53bfbeec87/scratchpad/rally-scan-last.json";
const scan = JSON.parse(fs.readFileSync(SCAN_PATH, "utf8"));
const top10 = scan.top10;

const round0 = (x) => Math.round(x);
const round1 = (x) => Math.round(x * 10) / 10;

// ─── réplicas exactas de api/_lib/rallyScoreEngine.js ────────────────────────
const suggestedStopPct = (rw) => (isNum(rw) ? Math.round(clamp(12 + 0.35 * rw, 15, 45)) : 30);
const rotationRank = (s, r) => Math.round((0.7 * (isNum(s) ? s : 0) + 0.3 * (isNum(r) ? r : 50)) * 10) / 10;

function capNormalizeWeights(raw, lo = 4, hi = 20) {
  const w = raw.map((v) => (Number.isFinite(v) && v > 0 ? v : 1e-6));
  const f = (t) => w.reduce((s, v) => s + Math.min(hi, Math.max(lo, v * t)), 0);
  let a = 1e-9, b = 1e9;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(a * b); (f(m) < 100 ? (a = m) : (b = m)); }
  const t = Math.sqrt(a * b);
  return w.map((v) => Math.min(hi, Math.max(lo, v * t)));
}
function assignWeights(m9s) {
  const n = m9s.length;
  const base = m9s.map((m9) => (Number.isFinite(m9) ? Math.max(1, m9) : 1));
  if (n * 20 < 100) return base.map(() => 100 / n);
  if (base.every((v) => v === base[0])) return base.map(() => 100 / n);
  return capNormalizeWeights(base, 4, 20).map(round1);
}
const normRS = (x) => (isNum(x) ? clamp(50 + 50 * Math.tanh(x / 40)) : 20);
const scoreRS = (rs3, rs6) => normRS(rs3 ?? 0) * 0.7 + normRS(rs6 ?? 0) * 0.3;
const normLin = (v, lo, hi) => (isNum(v) ? clamp(((v - lo) / (hi - lo)) * 100) : 0);
const scoreMom = (m1, m3, m6) => normLin(m1 ?? 0, -10, 20) * 0.1 + normLin(m3 ?? 0, -15, 45) * 0.6 + normLin(m6 ?? 0, -20, 65) * 0.3;
function scoreTrend(p, e20, e50, s20, s50) {
  let s = 0;
  if (isNum(p) && isNum(e20) && p > e20) s += 25;
  if (isNum(e20) && isNum(e50) && e20 > e50) s += 25;
  if (isNum(s20) && s20 > 0) s += 25;
  if (isNum(s50) && s50 > 0) s += 25;
  if (isNum(p) && isNum(e50) && p > e50) s = Math.min(100, s + 10);
  return clamp(s);
}
const scoreProx = (px) => (px >= 1 ? 100 : px >= 0.95 ? 90 : px >= 0.85 ? 70 : px >= 0.75 ? 40 : 10);
function scoreRvol(rvol, p, e5) {
  if (!isNum(rvol)) return 30;
  const mult = isNum(p) && isNum(e5) && p >= e5 ? 1 : 0.25;
  const b = rvol >= 1.5 ? 100 : rvol >= 1.2 ? 75 : rvol >= 1.0 ? 50 : rvol >= 0.8 ? 30 : 10;
  return clamp(b * mult);
}
const scoreAtr = (a) => { if (!isNum(a)) return 30; const x = Math.abs(a); return x >= 1 && x <= 2.5 ? 100 : x >= 0.5 && x < 1 ? 60 : x > 2.5 && x <= 4 ? 70 : x < 0.5 ? 20 : 30; };
function scoreLiq(av, region) { let s = 100; const min = region === "USA" ? 10e6 : 5e6; if (isNum(av) && av < min) s -= 50; return clamp(s); }
const zoneOf = (px) => (!isNum(px) ? "SIN_DATOS" : px >= 0.96 && px <= 0.997 ? "IDEAL" : px > 0.997 ? "EN_MAXIMOS" : "LEJOS");
const levelOf = (s) => (s >= 75 ? "ALTO" : s >= 55 ? "MEDIO" : "BAJO");

// ─── PARTE A ─────────────────────────────────────────────────────────────────
console.log("═══ PARTE A — consistencia interna del scan servido", scan.scanId, "═══");
let issues = 0;
const flag = (t, msg) => { issues++; console.log(`  ✗ [${t}] ${msg}`); };

const recomputedW = assignWeights(top10.map((a) => a.metrics.mom9m));
for (let i = 0; i < top10.length; i++) {
  const a = top10[i], m = a.metrics, tk = a.ticker;
  // score = f(mom9m)  (mom9m servido con 2 dec → tolera ±1 en el borde)
  const sc = round0(clamp(50 + 50 * Math.tanh(m.mom9m / 75)));
  if (sc !== a.rallyScore) flag(tk, `rallyScore servido ${a.rallyScore} ≠ recalculado ${sc} desde mom9m=${m.mom9m}`);
  // stop = f(runway)
  const st = suggestedStopPct(a.runway?.score);
  if (st !== a.trailingStop) flag(tk, `trailingStop servido ${a.trailingStop} ≠ clamp(12+0,35·${a.runway?.score})=${st}`);
  if (m.trailingStop !== a.trailingStop) flag(tk, `metrics.trailingStop ${m.trailingStop} ≠ top-level ${a.trailingStop}`);
  // pesos M9_RAW
  if (Math.abs(recomputedW[i] - a.suggestedWeightPct) > 0.1001)
    flag(tk, `suggestedWeightPct servido ${a.suggestedWeightPct} ≠ recalculado ${recomputedW[i]} (M9_RAW [4,20])`);
  // niveles/zonas
  if (levelOf(a.runway.score) !== a.runway.level) flag(tk, `runway.level ${a.runway.level} ≠ ${levelOf(a.runway.score)} (score ${a.runway.score})`);
  const z = zoneOf(m.proximity52w);
  if (z !== a.entryTiming.zone && !(m.proximity52w >= 0.99 && m.proximity52w <= 1.0))
    flag(tk, `entryTiming.zone ${a.entryTiming.zone} ≠ ${z} (prox 2dec ${m.proximity52w})`);
  // components (inputs redondeados a 2 dec → tolerancia 0,6 pt)
  const c = m.components;
  const checks = [
    ["sRS", scoreRS(m.rs3m, m.rs6m), c.sRS, 0.6],
    ["sMom", scoreMom(m.mom1m, m.mom3m, m.mom6m), c.sMom, 0.6],
    ["sTrend", scoreTrend(m.lastClose, m.ema20, m.ema50, m.ema20Slope, m.ema50Slope), c.sTrend, 0.001],
    ["sProx52w", scoreProx(m.proximity52w), c.sProx52w, 0.001],
    ["sRvol", scoreRvol(m.rvol, m.lastClose, m.ema5), c.sRvol, 0.001],
    ["sAtr", scoreAtr(m.atrPercent), c.sAtr, 0.001],
    ["sLiq", scoreLiq(m.avgValue20, a.exchange === "NASDAQ" || a.exchange === "NYSE" ? "USA" : "EU"), c.sLiq, 0.001],
  ];
  for (const [nm, mine, srv, tol] of checks)
    if (Math.abs(mine - srv) > tol) flag(tk, `${nm} servido ${srv} ≠ recalculado ${mine.toFixed(3)}`);
  // stop coherente con la banda [15,45]
  if (a.trailingStop < 15 || a.trailingStop > 45) flag(tk, `trailingStop ${a.trailingStop} fuera de [15,45]`);
}
const wsum = top10.reduce((s, a) => s + a.suggestedWeightPct, 0);
if (Math.abs(wsum - 100) > 0.5) flag("Σ", `suma de pesos ${wsum.toFixed(2)} ≠ 100 (más allá del redondeo 0,1)`);
else console.log(`  ✓ Σ pesos = ${wsum.toFixed(2)} (redondeo 0,1 por posición)`);
console.log(issues === 0 ? "  ✓ PARTE A: 0 incoherencias internas" : `  ✗ PARTE A: ${issues} incoherencias`);

// ─── PARTE B — recomputación independiente con universo local ────────────────
console.log("\n═══ PARTE B — recomputación con data/universe-10y.json (señales AJUSTADAS, réplica producción) ═══");
const { T, dates, D } = loadUniverse({ adjustedSignals: true });
const i = D - 1;
console.log(`  última fecha local: ${dates[i]}  (scan de producción: datos hasta ~2 sesiones antes de ${scan.scanCompletedAtUtc?.slice(0, 10)})`);

const bySym = new Map(T.map((t, ti) => [t.sym, ti]));
console.log("\n  ticker      | prod mom9m → score stop  w%   | local(", dates[i], ") mom9m → score stop  w%");
const localRows = [];
for (const a of top10) {
  const ti = bySym.get(a.providerSymbol);
  if (ti == null) { console.log(`  ${a.ticker}: NO está en el universo local`); continue; }
  const f = T[ti].feat[i];
  const m9 = f?.m9 ?? null;
  const s0 = f ? scoreV4(f) : null;                      // scoreV4 puede ser null (sin m9): Math.round(null)=0 mentiría
  const sc = s0 == null ? null : Math.round(s0);
  const rw = f ? runwayScore(f) : null;
  localRows.push({ sym: a.providerSymbol, m9 });
  console.log(
    `  ${a.ticker.padEnd(6)} prod: m9 ${String(a.metrics.mom9m).padStart(7)} → ${String(a.rallyScore).padStart(3)}  ${String(a.trailingStop).padStart(2)}  ${String(a.suggestedWeightPct).padStart(5)}` +
    `   local: m9 ${m9 == null ? "  null" : m9.toFixed(2).padStart(7)} → ${sc == null ? " —" : String(sc).padStart(3)}  ${rw == null ? "—" : suggestedStopPct(rw)}  Δm9=${m9 == null ? "—" : (a.metrics.mom9m - m9).toFixed(1)}`
  );
}
const wLocal = assignWeights(localRows.map((r) => r.m9));
console.log("  pesos M9_RAW con m9 LOCAL de esos 10:", localRows.map((r, j) => `${r.sym.split(".")[0]}=${wLocal[j]}`).join(" "));

// top-10 local completo (ranking independiente sobre los ~600)
const cands = [];
for (let ti = 0; ti < T.length; ti++) {
  const f = T[ti].feat[i];
  if (!f || !isNum(T[ti].adj[i])) continue;
  const s = scoreV4(f);
  if (s != null) cands.push({ sym: T[ti].sym, s, m9: f.m9 ?? 0 });
}
cands.sort((a, b) => b.s - a.s || b.m9 - a.m9);
console.log("\n  top-10 LOCAL a", dates[i] + ":", cands.slice(0, 10).map((c) => c.sym.split(".")[0]).join(", "));
console.log("  top-10 PROD  a", scan.scanCompletedAtUtc?.slice(0, 10) + ":", top10.map((a) => a.ticker).join(", "));
const prodSet = new Set(top10.map((a) => a.providerSymbol));
const overlap = cands.slice(0, 10).filter((c) => prodSet.has(c.sym)).length;
console.log(`  solapamiento: ${overlap}/10 (las diferencias de nivel vienen del hueco de fechas del universo local, no de la fórmula)`);

// cross-check contra el "hoy" del estudio de ponderación (misma base local)
try {
  const ws = JSON.parse(fs.readFileSync("backtests/rally-weighting-study.json", "utf8"));
  const hoy = ws.hoy ?? [];
  let hits = 0, tot = 0;
  for (const h of hoy) {
    const ti = bySym.get(h.sym);
    if (ti == null) continue;
    const f = T[ti].feat[i];
    if (!f || !isNum(f.m9)) continue;
    tot++;
    if (Math.abs(f.m9 - h.m9) < 1e-6 && runwayScore(f) === h.runway) hits++;
  }
  console.log(`\n  cross-check vs backtests/rally-weighting-study.json «hoy»: ${hits}/${tot} tickers con m9 y runway EXACTOS`);
} catch { /* opcional */ }

console.log("\nHecho. Este script no modifica nada.");
