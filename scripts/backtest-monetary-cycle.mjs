#!/usr/bin/env node
/**
 * BACKTEST — CICLO MONETARIO (módulo informativo, nunca backtesteado hasta el 25-sep-2026)
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Qué se valida: `classifyMonetaryCycle()` de `api/_lib/monetaryCycleEngine.js` (IMPORTADA tal
 * cual — es una función pura sin dependencias), que sirve GET /api/monetary-cycle
 * (api/_lib/monetaryCycleHandler.js) y cuyos textos viven en:
 *   · src/components/OptimalSignalPanel.tsx  (Filtro 5 "Ciclo monetario" + banner
 *     "⚠ ENTRAR CON CAUTELA — CICLO RESTRICTIVO")
 *   · src/components/ConvergenceSignalBanner.tsx (badges "↗ EXPANSIVO" / "⚠ RESTRICTIVO")
 *   ⚠ Ninguno de los dos componentes está montado en DashboardPage desde la consolidación del
 *   24-jul-2026 y fetchMonetaryCycle() no se llama: hoy el ciclo NO se ve en el dashboard,
 *   aunque el endpoint sigue vivo.
 *
 * Entradas del motor (como el handler): % del día del yield 10Y (^TNX), % del día de HYG,
 * nivel del VIX y nivel del MOVE, al cierre de t. Fase EASING / NEUTRAL / TIGHTENING y score.
 *
 * Preguntas: (1) ¿un régimen "restrictivo" precede peores retornos / más caídas del SPY?
 * (2) ¿"expansivo" = "entorno favorable para momentum" (MTUM vs SPY)? (3) ¿"riesgo whipsaw"
 * (vol. realizada futura)? (4) ¿es un CICLO (persistencia) y coincide con el ciclo monetario
 * REAL (dirección de la letra a 3 meses ^IRX en 126 sesiones)?
 *
 * Uso:
 *   node scripts/backtest-monetary-cycle.mjs [--end 2026-09-24] [--cache DIR] [--offline] [--refresh]
 *                                            [--out backtests/monetary-cycle-2026-09-25.json]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyMonetaryCycle } from "../api/_lib/monetaryCycleEngine.js";
import {
  ROOT, parseArgs, sha256, loadYahoo, seriesQuality, asOfLevel, asOfChange, forwardPanel,
  bucketTable, decileRows, icTable, printTable, pct, nwDiff, vixControlled,
} from "./backtest-fear-greed.mjs";

const PHASES = ["EASING", "NEUTRAL", "TIGHTENING"];
const POLICY = ["CUTTING", "HOLD", "HIKING"];
const r2 = (x, k = 2) => (x === null || !Number.isFinite(x) ? null : +x.toFixed(k));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

async function main() {
  const opts = parseArgs(process.argv.slice(2), {
    end: "2026-09-24", cache: path.join(os.tmpdir(), "emrr-backtest-cache"), offline: false, refresh: false,
    out: path.join(ROOT, "backtests/monetary-cycle-2026-09-25.json"),
  });
  const engineSrc = fs.readFileSync(path.join(ROOT, "api/_lib/monetaryCycleEngine.js"), "utf8");
  console.log(`BACKTEST CICLO MONETARIO · fin ${opts.end} · motor sha256 ${sha256(engineSrc).slice(0, 16)}…`);

  const SYMS = ["SPY", "^TNX", "HYG", "^VIX", "^MOVE", "^IRX", "MTUM"];
  const S = {};
  for (const s of SYMS) S[s] = await loadYahoo(s, opts);
  const quality = SYMS.map((s) => seriesQuality(S[s]));
  for (const q of quality) console.log(`  ${q.symbol.padEnd(6)} ${q.first}→${q.last} barras ${q.bars} huecos ${q.nullCloses}`);

  const panel = forwardPanel(S.SPY);

  // ── Clasificación diaria con la función de PRODUCCIÓN ──
  const rows = [];
  let partial = 0;
  for (let i = 0; i < panel.n; i++) {
    const d = panel.dates[i];
    const sig = { tnxChangePercent: asOfChange(S["^TNX"], d), hygChangePercent: asOfChange(S.HYG, d), vixLevel: asOfLevel(S["^VIX"], d), moveLevel: asOfLevel(S["^MOVE"], d) };
    const nOk = Object.values(sig).filter((v) => v !== null).length;
    if (nOk < 4) { if (d >= "2007-04-12" && nOk > 0) partial++; continue; }
    const c = classifyMonetaryCycle(sig);
    rows.push({ i, date: d, key: c.phase, score: c.score, sig, vix: sig.vixLevel });
  }
  const from = rows[0].date, to = rows.at(-1).date;
  console.log(`\nMuestra 4/4 señales: ${rows.length} días ${from}→${to} (${partial} días con señales parciales excluidos)`);

  // ── (4a) Persistencia: ¿es un "ciclo"? ──
  const runs = []; let cur = null;
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (cur && r.key === cur.key && r.i === rows[k - 1].i + 1) cur.len++;
    else { cur = { key: r.key, len: 1, from: r.date }; runs.push(cur); }
  }
  const years = (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000);
  const persistence = {};
  for (const p of PHASES) {
    const L = runs.filter((x) => x.key === p).map((x) => x.len);
    persistence[p] = { runs: L.length, meanDays: r2(mean(L), 2), medianDays: median(L), maxDays: Math.max(...L), pctRunsOf1Day: r2((L.filter((x) => x === 1).length / L.length) * 100, 1) };
  }
  let flips = 0; for (let k = 1; k < rows.length; k++) if (rows[k].key !== rows[k - 1].key) flips++;
  persistence.phaseChangesPerYear = r2(flips / years, 1);
  persistence.pctDaysPhaseDiffersFromPrevDay = r2((flips / (rows.length - 1)) * 100, 1);
  console.log("Persistencia:", JSON.stringify(persistence));

  // ── (1) Retornos futuros del SPY por fase ──
  const PERIODS = [["P1_2007-2012", "2007-01-01", "2012-12-31"], ["P2_2013-2019", "2013-01-01", "2019-12-31"], ["P3_2020-2026", "2020-01-01", "2026-12-31"]];
  const byPhase = bucketTable(panel, rows, PHASES);
  printTable("CICLO MONETARIO — por fase (muestra completa)", byPhase, PHASES);
  const bySubperiod = {};
  for (const [name, a, b] of PERIODS) { bySubperiod[name] = bucketTable(panel, rows.filter((r) => r.date >= a && r.date <= b), PHASES, { withRobust: false }); printTable(`  subperiodo ${name}`, bySubperiod[name], PHASES); }
  const byPhaseLag1 = bucketTable(panel, rows, PHASES, { lag1: true, withRobust: false });
  // Score (el que enseña el texto "Score X/100"): quintiles por valor y extremos
  const dec = decileRows(rows, (r) => r.score);
  const scoreDeciles = { cuts: dec.cuts, table: bucketTable(panel, dec.rows, ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"], { withRobust: false }) };
  printTable(`CICLO MONETARIO — deciles de score (cortes ${dec.cuts.join("/")})`, scoreDeciles.table, ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);
  const ic = icTable(panel, rows, (r) => r.score, PERIODS);
  const icVixOnly = icTable(panel, rows, (r) => -r.sig.vixLevel, PERIODS);
  console.log("IC Spearman score:", JSON.stringify(ic));
  console.log("IC Spearman −VIX solo:", JSON.stringify(icVixOnly));
  // ¿Aporta algo más allá del VIX? (el VIX es 20 de los ~100 puntos del motor)
  const vixCtl = {
    TIGHTENING_vs_rest: vixControlled(panel, rows, (r) => r.key === "TIGHTENING", [[0, 15, "VIX<15"], [15, 20, "VIX 15-20"], [20, 30, "VIX 20-30"], [30, 1e9, "VIX>=30"]]),
    EASING_vs_rest: vixControlled(panel, rows, (r) => r.key === "EASING", [[0, 15, "VIX<15"], [15, 20, "VIX 15-20"], [20, 30, "VIX 20-30"], [30, 1e9, "VIX>=30"]]),
  };
  console.log("Control por VIX:", JSON.stringify(vixCtl));

  // ── (2) "Entorno favorable para momentum": MTUM − SPY a 20/60 sesiones por fase ──
  const mtumAdj = new Map(S.MTUM.bars.filter((b) => b.adj !== null).map((b) => [b.date, b.adj]));
  const mtumFwd = (i, h) => { const d0 = panel.dates[i], d1 = panel.dates[i + h]; if (!d1 || !mtumAdj.has(d0) || !mtumAdj.has(d1)) return null; return mtumAdj.get(d1) / mtumAdj.get(d0) - 1; };
  const momentum = { note: "MTUM (iShares MSCI USA Momentum) desde 2013-04; exceso = retorno MTUM − retorno SPY en la misma ventana", byPhase: {} };
  const momRows = rows.filter((r) => mtumAdj.has(r.date));
  for (const k of ["__ALL__", ...PHASES]) {
    const g = k === "__ALL__" ? momRows : momRows.filter((r) => r.key === k);
    const o = { n: g.length };
    for (const h of [20, 60]) {
      const ex = g.map((r) => { const m = mtumFwd(r.i, h), s = panel.fwd[h][r.i]; return m === null || s === null ? null : m - s; }).filter((x) => x !== null);
      o[`excess${h}`] = { n: ex.length, mean: pct(mean(ex)), median: pct(median(ex)), pctPos: ex.length ? r2((ex.filter((x) => x > 0).length / ex.length) * 100, 1) : null };
    }
    momentum.byPhase[k] = o;
  }
  for (const h of [20, 60]) {
    const sub = momRows.map((r) => ({ r, m: mtumFwd(r.i, h), s: panel.fwd[h][r.i] })).filter((x) => x.m !== null && x.s !== null);
    for (const p of ["EASING", "TIGHTENING"]) { const nw = nwDiff(sub.map((x) => x.m - x.s), sub.map((x) => x.r.key === p), h); momentum.byPhase[p][`nwVsRest${h}`] = nw ? { diffPp: pct(nw.diff), t: r2(nw.t) } : null; }
  }
  console.log("\nMomentum (MTUM−SPY):", JSON.stringify(momentum.byPhase));

  // ── (4b) ¿Coincide con el ciclo monetario REAL? ^IRX (letra 3m ≈ fed funds), cambio en 126 sesiones ──
  const irxAt = (d) => asOfLevel(S["^IRX"], d);
  const policyOf = (i) => { if (i < 126) return null; const a = irxAt(panel.dates[i - 126]), b = irxAt(panel.dates[i]); if (a === null || b === null) return null; const ch = b - a; return ch > 0.5 ? "HIKING" : ch < -0.5 ? "CUTTING" : "HOLD"; };
  const concord = { definition: "HIKING si la letra a 3 meses (^IRX) sube >0,50 pp en las 126 sesiones previas; CUTTING si baja >0,50 pp; HOLD en otro caso (solo pasado, sin lookahead)", crossTabPctOfPolicyDays: {}, policyDays: {} };
  const withPolicy = rows.map((r) => ({ ...r, policy: policyOf(r.i) })).filter((r) => r.policy);
  for (const pol of POLICY) {
    const g = withPolicy.filter((r) => r.policy === pol);
    concord.policyDays[pol] = g.length;
    concord.crossTabPctOfPolicyDays[pol] = Object.fromEntries(PHASES.map((p) => [p, r2((g.filter((r) => r.key === p).length / g.length) * 100, 1)]));
  }
  // Ejemplos de años de subidas/bajadas reales
  const yearTab = {};
  for (const y of ["2008", "2019", "2020", "2022", "2023", "2024", "2025"]) {
    const g = rows.filter((r) => r.date.startsWith(y));
    if (g.length) yearTab[y] = Object.fromEntries(PHASES.map((p) => [p, r2((g.filter((r) => r.key === p).length / g.length) * 100, 1)]));
  }
  concord.phaseMixByYear = yearTab;
  concord.realPolicyRegimeForwardSPY_contextOnly = bucketTable(panel, withPolicy.map((r) => ({ i: r.i, key: r.policy })), POLICY, { withRobust: false });
  console.log("\nConcordancia con el ciclo real (% de días de cada régimen real):", JSON.stringify(concord.crossTabPctOfPolicyDays));
  console.log("Mezcla de fases por año:", JSON.stringify(yearTab));
  printTable("CONTEXTO — régimen REAL (^IRX 126s) → SPY futuro", concord.realPolicyRegimeForwardSPY_contextOnly, POLICY);

  // ── Qué empuja la fase: contribución de cada señal (frecuencia de puntos) ──
  const drivers = {};
  for (const p of ["EASING", "TIGHTENING"]) {
    const g = rows.filter((r) => r.key === p);
    drivers[p] = {
      n: g.length,
      pctDaysVixBelow15: r2((g.filter((r) => r.sig.vixLevel < 15).length / g.length) * 100, 1),
      pctDaysVixAbove22: r2((g.filter((r) => r.sig.vixLevel > 22).length / g.length) * 100, 1),
      pctDaysTnxAbs04: r2((g.filter((r) => Math.abs(r.sig.tnxChangePercent) >= 0.4).length / g.length) * 100, 1),
    };
  }
  // Tamaño de un "Yields subiendo" típico en PUNTOS BÁSICOS: el umbral es % del NIVEL del yield,
  // así que su significado deriva con el nivel (0,4% de 0,7% = 0,3 pb en 2020; de 4,4% = 1,8 pb en 2026).
  const tnxLvl = (d) => asOfLevel(S["^TNX"], d);
  const bp = rows.filter((r) => r.sig.tnxChangePercent >= 0.4 && r.sig.tnxChangePercent < 1.5).map((r) => (tnxLvl(r.date) * r.sig.tnxChangePercent) / (100 + r.sig.tnxChangePercent) * 100);
  drivers.tnxMildTighteningMedianMoveBp = r2(median(bp), 1);
  const byYear = {};
  for (const r of rows) {
    const y = r.date.slice(0, 4); const o = (byYear[y] ??= { n: 0, strong: 0, any: 0, lv: [] });
    o.n++; if (Math.abs(r.sig.tnxChangePercent) >= 1.5) o.strong++; if (Math.abs(r.sig.tnxChangePercent) >= 0.4) o.any++; o.lv.push(tnxLvl(r.date));
  }
  drivers.tnxThresholdDriftByYear = Object.fromEntries(Object.entries(byYear).map(([y, o]) => {
    const lv = [...o.lv].sort((a, b) => a - b)[o.lv.length >> 1];
    return [y, { medianYield: r2(lv, 2), bpFor0_4pct: r2(lv * 0.4, 1), bpFor1_5pct: r2(lv * 1.5, 1), pctDaysAbsGe0_4: r2((o.any / o.n) * 100, 0), pctDaysAbsGe1_5: r2((o.strong / o.n) * 100, 0) }];
  }));

  // ── Veredicto y textos propuestos (cifras TEMPLADAS desde esta ejecución) ──
  const es = (x, k = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(k).replace(".", ","));
  const B = byPhase.__BASE__, T = byPhase.TIGHTENING, E = byPhase.EASING;
  const subsT = Object.values(bySubperiod);
  const tDDabove = subsT.filter((t) => t.TIGHTENING.dd20.pDrop5 > t.__BASE__.dd20.pDrop5 + 2).length;
  const tRetWorse = subsT.filter((t) => t.TIGHTENING.fwd60.mean < t.__BASE__.fwd60.mean).length;
  const tVixHigh = r2((rows.filter((r) => r.key === "TIGHTENING" && r.sig.vixLevel > 22).length / T.n) * 100, 0);
  const vb = vixCtl.TIGHTENING_vs_rest["VIX 15-20"];
  const cc = concord.crossTabPctOfPolicyDays;
  const mE = momentum.byPhase.EASING, mA = momentum.byPhase.__ALL__;
  const drift = drivers.tnxThresholdDriftByYear;
  const yLast = to.slice(0, 4);
  const verdict = {
    notACycle: `No es un ciclo: cambia de fase ${es(persistence.phaseChangesPerYear, 0)} veces al año (el ${es(persistence.pctDaysPhaseDiffersFromPrevDay, 0)}% de los días distinta a la víspera); duración mediana de cualquier fase = ${persistence.TIGHTENING.medianDays} día; la fase "restrictiva" más larga duró ${persistence.TIGHTENING.maxDays} sesiones.`,
    notTheRealCycle: `No sigue el ciclo monetario real: marca RESTRICTIVO el ${es(cc.HIKING.TIGHTENING, 0)}% de los días de subidas reales (^IRX +0,5 pp/126 ses.) y el ${es(cc.CUTTING.TIGHTENING, 0)}% de los de bajadas; EXPANSIVO el ${es(cc.CUTTING.EASING, 0)}% de los días de bajadas y el ${es(cc.HIKING.EASING, 0)}% de los de subidas. En 2022 (subidas más rápidas en 40 años) dijo restrictivo el ${es(concord.phaseMixByYear["2022"]?.TIGHTENING, 0)}% de los días.`,
    restrictiveReturns: `"Restrictivo" NO precede peores retornos: SPY +${es(T.fwd60.mean)}% a 60 ses. vs +${es(B.fwd60.mean)}% (t ${es(T.nwVsRest.fwd60.t, 2)}; peor que la media en ${tRetWorse}/${subsT.length} subperiodos).`,
    restrictiveRisk: `Sí precede MÁS VOLATILIDAD: vol. realizada 20 ses. ${es(T.fwdVol20)}% vs ${es(B.fwdVol20)}%, P(caída>5%/20s) ${es(T.dd20.pDrop5)}% vs ${es(B.dd20.pDrop5)}% (LOEO ${es(T.leaveOneEpisodeOut?.pDrop5Range?.[0])}–${es(T.leaveOneEpisodeOut?.pDrop5Range?.[1])}%; > media en ${tDDabove}/${subsT.length} subperiodos) — pero es el VIX: el ${es(tVixHigh, 0)}% de los días restrictivos tienen VIX>22 y, a igual VIX (15-20), P(caída) ${es(vb.group.pDrop5)}% vs ${es(vb.rest.pDrop5)}%. IC del score ${es(ic.full.dd20, 3)} vs VIX solo ${es(icVixOnly.full.dd20, 3)}.`,
    easingMomentum: `"Entorno favorable para momentum" NO se sostiene: exceso MTUM−SPY a 60 ses. +${es(mE.excess60.mean, 2)} pp en expansivo vs +${es(mA.excess60.mean, 2)} pp todos los días (t ${es(mE.nwVsRest60?.t, 2)}); SPY tras expansivo +${es(E.fwd60.mean)}% vs +${es(B.fwd60.mean)}%.`,
    thresholdFlaw: `Umbral TNX en % del NIVEL del yield: "Yields subiendo" (≥0,4%) = ${es(drift["2020"]?.bpFor0_4pct)} pb en 2020 y ${es(drift[yLast]?.bpFor0_4pct)} pb en ${yLast}; "fuerte" (≥1,5%) saltó el ${es(drift["2020"]?.pctDaysAbsGe1_5, 0)}% de los días de 2020 y el ${es(drift[yLast]?.pctDaysAbsGe1_5, 0)}% de ${yLast}. Mediana de un "Yields subiendo": ${es(drivers.tnxMildTighteningMedianMoveBp)} pb.`,
    illustrativeCases: ["2020-03-16", "2025-04-08", "2022-06-13"].map((d) => {
      const r = rows.find((x) => x.date === d); if (!r) return `${d}: sin dato`;
      const spyChg = asOfChange(S.SPY, d);
      return `${d}: SPY ${es(spyChg)}%, VIX ${es(r.sig.vixLevel)}, Δ TNX ${es(r.sig.tnxChangePercent)}% → ${r.key} (score ${r.score})`;
    }),
    deadCode: "Hoy no se ve: OptimalSignalPanel/ConvergenceSignalBanner no están montados y rallyScoreAdjustment (−8/+3) no se aplica en ningún sitio. El endpoint /api/monetary-cycle sigue sirviendo las etiquetas 'Ciclo Restrictivo/Expansivo'.",
    recommendation: "No volver a montarlo como 'ciclo monetario'. Si se conserva, renombrar a lo que mide (tensión diaria de tipos y crédito, ≈ VIX) y quitar 'favorable para momentum' y 'entrar con cautela'. Cambiar umbrales (p.ej. TNX en pb) exigiría estudio propio: aquí NO se propone ninguno.",
  };
  const proposedUiTexts = {
    note: "Solo tienen efecto visible si se vuelve a montar el componente; las etiquetas del motor sí salen hoy por /api/monetary-cycle. Líneas referidas a HEAD del 25-sep-2026.",
    "api/_lib/monetaryCycleEngine.js": {
      "L4-8 (cabecera)": "EASING/NEUTRAL/TIGHTENING = tensión DIARIA de tipos y crédito (Δ% TNX, Δ% HYG, nivel VIX y MOVE). NO es el ciclo de la Fed ni anticipa retornos; 'TIGHTENING' ≈ VIX alto → más volatilidad a 20 sesiones (backtest 2007-2026, scripts/backtest-monetary-cycle.mjs).",
      "L120-124 (label)": { EASING: "Distensión diaria (tipos/crédito)", TIGHTENING: "Tensión diaria (tipos/crédito)", NEUTRAL: "Sin tensión (tipos/crédito)" },
    },
    "src/components/OptimalSignalPanel.tsx": {
      "L251 (label)": "Tipos y crédito (diario)",
      "L255 (EASING)": "✓ ${label} — sin ventaja histórica para momentum (Score ${score}/100)",
      "L257 (TIGHTENING)": `⚠ \${label} — más volatilidad a 20 ses. (${es(T.fwdVol20)}% vs ${es(B.fwdVol20)}%); retorno medio no peor (Score \${score}/100)`,
      "L258 (NEUTRAL)": "${label} — informativo (Score ${score}/100)",
      "L450 (banner)": "⚠ TENSIÓN TIPOS/CRÉDITO HOY — MÁS VOLATILIDAD",
      "nueva línea 'validación' bajo el filtro 5": `Validación ${from.slice(0, 4)}-${to.slice(2, 4)} (${rows.length} ses.): cambia de fase ${es(persistence.phaseChangesPerYear, 0)} veces/año; no sigue el ciclo real de la Fed ni anticipa retornos.`,
    },
    "src/components/ConvergenceSignalBanner.tsx": {
      "L141-143 y L305 (badges)": { EASING: "↗ DISTENSIÓN", TIGHTENING: "⚠ TENSIÓN", NEUTRAL: "● NEUTRAL (sin cambio)" },
    },
  };
  console.log("\nVEREDICTO:", JSON.stringify(verdict, null, 1));
  console.log("\nTEXTOS PROPUESTOS:", JSON.stringify(proposedUiTexts, null, 1));

  const result = {
    study: "backtest-monetary-cycle", generatedAt: new Date().toISOString(), asOfEnd: opts.end,
    scope: {
      engine: "api/_lib/monetaryCycleEngine.js::classifyMonetaryCycle (importada, sin réplica)",
      endpoint: "GET /api/monetary-cycle → api/market-data.js?source=monetary-cycle → api/_lib/monetaryCycleHandler.js (caché Redis 1 h)",
      displayedIn: ["src/components/OptimalSignalPanel.tsx (Filtro 5 + banner)", "src/components/ConvergenceSignalBanner.tsx (badges)"],
      mountedInDashboard: false,
      mountedNote: "Ni OptimalSignalPanel ni ConvergenceSignalBanner se importan en DashboardPage (consolidación 24-jul-2026) y fetchMonetaryCycle() no tiene llamadas: el ciclo no se ve hoy. rallyScoreAdjustment (−8/+3) tampoco se aplica en ningún sitio (api/rally-scan.js lo declara explícitamente).",
      engineSha256: sha256(engineSrc),
    },
    methodology: {
      signal: "Día t = sesión del SPY. tnxChangePercent/hygChangePercent = cierre bruto última sesión ≤ t vs sesión previa (null si hueco); vixLevel/moveLevel = cierre ≤ t (≤5 días naturales). Se exige 4/4 señales.",
      forward: "Igual que backtest-fear-greed.mjs: retorno total SPY 5/20/60 sesiones, P(caída>5%/20s), vol. realizada 20s; control lag-1.",
      inference: "t Newey-West (L=h) de la diferencia fase−resto, episodios (>20 sesiones de separación), leave-one-episode-out: indicativos (§10c).",
      noFitting: "Umbrales del motor evaluados tal cual; nada se optimiza.",
    },
    data: { yahoo: quality },
    sample: { from, to, days: rows.length, daysPartialSignalsExcluded: partial },
    phaseDistributionPct: Object.fromEntries(PHASES.map((p) => [p, r2((rows.filter((r) => r.key === p).length / rows.length) * 100, 1)])),
    persistence,
    byPhase, byPhaseLag1, bySubperiod, scoreDeciles, ic, icVixOnly, vixControlled: vixCtl,
    momentumClaim_MTUMminusSPY: momentum,
    realCycleConcordance: concord,
    drivers,
    verdict,
    proposedUiTexts,
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(result, null, 1));
  console.log(`\n→ ${path.relative(ROOT, opts.out)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
