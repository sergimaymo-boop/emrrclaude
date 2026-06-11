/**
 * RECALIBRACIÓN de TOP 8 y Rally (offline). Mismo método que Amplitud: extrae los COMPONENTES de
 * cada motor walk-forward, ajusta sus pesos = IC (Spearman) medio de cada componente con el retorno
 * forward en TRAIN, valida OOS en TEST. "Loop" = barrido de horizontes, mejor por IC. Compara el
 * motor ORIGINAL vs el RECALIBRADO. Honesto: si el edge sigue siendo nulo, lo dice.
 */
import fs from "node:fs";
import { calculateTechnicals } from "../api/_lib/technicalEngine.js";
import { calculateScore } from "../api/_lib/scoreEngine.js";
import { calculateRallyScore } from "../api/_lib/rallyScoreEngine.js";

const HORIZONS = [20, 40, 60];
const STEP = 7, WINDOW = 290, TOPN = 8, CACHE = "/tmp/emrr-bars-5y.json";
const TOP8C = ["trend", "momentum", "relativeStrength", "liquidity", "volatility", "drawdown"];
const RALLYC = ["sRS", "sMom", "sTrend", "sProx52w", "sRvol", "sAtr", "sLiq"];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
function rk(arr) { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; }
function spearman(x, y) { if (x.length < 3) return 0; const rx = rk(x), ry = rk(y); const mx = mean(rx), my = mean(ry); return mean(rx.map((v, i) => (v - mx) * (ry[i] - my))) / (std(rx) * std(ry)); }

if (!fs.existsSync(CACHE)) { console.error("Falta cache /tmp/emrr-bars-5y.json — corre antes backtest-engines.mjs"); process.exit(1); }
const { fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const spyDates = spy.map((b) => b.date);
for (const f of fetched) f.byDate = new Map(f.bars.map((b, i) => [b.date, i]));
console.log(`Cache: ${fetched.length} tickers, ${spyDates[0]}→${spyDates.at(-1)}\n`);

// Walk-forward: componentes + score original + forward returns
const days = [];
for (let d = 230; d < spyDates.length - Math.max(...HORIZONS) - 1; d += STEP) {
  const dt = spyDates[d];
  const spySub = spy.slice(Math.max(0, d - WINDOW), d + 1);
  const recs = [];
  for (const f of fetched) {
    const hi = f.byDate.get(dt); if (hi === undefined || hi < 230) continue;
    const bars = f.bars.slice(Math.max(0, hi - WINDOW), hi + 1); if (bars.length < 130) continue;
    const fwd = {}; let ok = true;
    for (const H of HORIZONS) { const j = hi + H; if (j >= f.bars.length) { ok = false; break; } fwd[H] = (f.bars[j].close / f.bars[hi].close - 1) * 100; }
    if (!ok) continue;
    const tech = calculateTechnicals(bars, spySub);
    const s8 = tech.ok ? calculateScore({ technicals: tech.technicals, eligibleForScore: true, operabilityStatus: "OPERABLE", dataQuality: tech.dataQuality }) : null;
    const ry = calculateRallyScore({ bars, spyBars: spySub, region: f.region });
    recs.push({
      fwd,
      top8: (s8 && s8.score !== null) ? s8.score : null,
      top8c: (s8 && s8.scoreBreakdown) ? s8.scoreBreakdown : null,
      rally: ry.ok ? ry.rallyScore : null,
      rallyc: (ry.ok && ry.metrics?.components) ? ry.metrics.components : null,
    });
  }
  if (recs.length >= 40) days.push({ dt, recs });
}
console.log(`Fechas: ${days.length} (${days[0]?.dt}→${days.at(-1)?.dt})\n`);
const cut = Math.floor(days.length * 0.7);
const train = days.slice(0, cut), test = days.slice(cut);

function zCS(vals) { const m = mean(vals), s = std(vals); return vals.map((v) => (v - s ? (v - m) / s : 0)); }

function recalibrate(engine, comps, origKey, compKey) {
  console.log(`════════ ${engine} ════════`);
  for (const H of HORIZONS) {
    // filtra recs válidas
    const valid = (day) => day.recs.filter((r) => r[origKey] !== null && r[compKey] && comps.every((c) => Number.isFinite(r[compKey][c])));
    // pesos = IC medio por componente en TRAIN
    const w = {};
    for (const c of comps) {
      const ics = train.map((day) => { const rs = valid(day); return rs.length >= 20 ? spearman(rs.map((r) => r[compKey][c]), rs.map((r) => r.fwd[H])) : null; }).filter((v) => v !== null);
      w[c] = mean(ics);
    }
    const wAbs = Object.values(w).reduce((a, b) => a + Math.abs(b), 0) || 1;
    const wN = {}; for (const c of comps) wN[c] = w[c] / wAbs;
    const combined = (r) => comps.reduce((s, c) => s + wN[c] * r._z[c], 0);

    // OOS en TEST: IC original vs recalibrado + alpha top-8
    let icOrig = [], icReca = [], pickOrig = [], pickReca = [], uni = [];
    for (const day of test) {
      const rs = valid(day); if (rs.length < 20) continue;
      for (const c of comps) { const zs = zCS(rs.map((r) => r[compKey][c])); rs.forEach((r, i) => { r._z = r._z || {}; r._z[c] = zs[i]; }); }
      const fwds = rs.map((r) => r.fwd[H]); const dayMean = mean(fwds);
      icOrig.push(spearman(rs.map((r) => r[origKey]), fwds));
      icReca.push(spearman(rs.map((r) => combined(r)), fwds));
      rs.forEach((r) => uni.push(r.fwd[H]));
      rs.slice().sort((a, b) => b[origKey] - a[origKey]).slice(0, TOPN).forEach((r) => pickOrig.push(r.fwd[H] - dayMean));
      rs.slice().sort((a, b) => combined(b) - combined(a)).slice(0, TOPN).forEach((r) => pickReca.push(r.fwd[H] - dayMean));
    }
    const flips = comps.filter((c) => wN[c] < 0).join(",");
    console.log(`  H=${H}: IC orig ${mean(icOrig).toFixed(3)} → recalibrado ${mean(icReca).toFixed(3)} | alpha top8 orig ${mean(pickOrig).toFixed(2)}pp → recal ${mean(pickReca).toFixed(2)}pp`);
    console.log(`        pesos recal: ${comps.map((c) => c + ":" + wN[c].toFixed(2)).join("  ")}`);
    console.log(`        componentes con peso NEGATIVO (contrarios): ${flips || "ninguno"}`);
  }
  console.log("");
}

recalibrate("TOP 8 (scoreEngine)", TOP8C, "top8", "top8c");
recalibrate("RALLY (rallyScoreEngine)", RALLYC, "rally", "rallyc");
