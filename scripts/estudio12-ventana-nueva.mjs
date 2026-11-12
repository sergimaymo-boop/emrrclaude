/**
 * ESTUDIO 12 — VENTANA NUEVA 2-sep → 11-nov-2026 (descriptivo, sin gate; pre-anunciado en la
 * cabecera de estudio12-regimen.mjs). Datos que NINGÚN estudio había visto: incluyen la caída
 * de semiconductores de octubre y los saltos de INTC, DELL y WDC de la cartera real.
 * Se ejecuta con el dataset EXTENDIDO sin tocar el canon: desde un directorio temporal donde
 * data/universe-10y.json enlaza a data/universe-10y-ext-<fin>.json y backtests/ al del repo.
 * Las anclas del núcleo deben seguir saliendo BIT A BIT (prueba de que el pasado no cambió).
 * Son ~50 sesiones: sirve para ver cómo se portó el modelo, NO para decidir nada.
 */
import fs from "node:fs";
import { simular, PHASES10, dates, D, T, TO, COST_BPS, scoreDia, sigM189s10, pesosDe, spyClose, mean, isNum } from "./lab-day-core.mjs";
import { ESTADOS, SERIES } from "./estudio12-estados.mjs";

const FIN = dates[TO], iCanon = dates.indexOf("2026-09-01"), i0 = dates.indexOf("2026-09-08");
if (FIN <= "2026-09-01" || iCanon < 0 || i0 < 0) throw new Error(`ABORTO: este script necesita el dataset extendido (fin ${FIN})`);
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0 };
const f = (x, d = 1) => (isNum(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%` : "—");
const dd = (c, a, b) => { let p = 0, m = 0; for (let i = a; i <= b; i++) { if (c[i] > p) p = c[i]; m = Math.max(m, 1 - c[i] / p); } return m; };
const top5 = (i) => { const s = scoreDia(i, sigM189s10, "M189s10").slice(0, 5), w = pesosDe(s, i, { modo: "SCORE" }); return s.map((c, k) => `${T[c.ti].sym.replace(".US", "")} ${w[k].toFixed(0)}%`).join(" · "); };
const out = { fin: FIN, costBps: COST_BPS * 1e4 };

console.log(`VENTANA NUEVA ${dates[iCanon]} → ${FIN} (${TO - iCanon} sesiones) · ${(COST_BPS * 1e4).toFixed(0)} pb · SPY ${f(spyClose[TO] / spyClose[iCanon] - 1)}`);
// 1) v1.1 en las 10 fases (cada fase llega a septiembre con su propia cartera)
const fases = PHASES10.map((FROM) => { const reg = []; const s = simular({ ...BASE, scfg: { tipo: "FIJO", w: 0.45 }, FROM, registro: reg }); return { FROM, r: s.curve[TO] / s.curve[iCanon] - 1, dd: dd(s.curve, iCanon, TO), saltos: reg.filter((e) => e.i > iCanon).map((e) => `${T[e.ti].sym.replace(".US", "")} ${dates[e.i]}`) }; });
out.v11Fases = fases;
console.log(`\n1) v1.1 en la ventana, 10 fases: media ${f(mean(fases.map((x) => x.r)))} · peor ${f(Math.min(...fases.map((x) => x.r)))} · mejor ${f(Math.max(...fases.map((x) => x.r)))} · caída máx. media ${f(-mean(fases.map((x) => x.dd)))}`);
for (const x of fases) console.log(`   fase ${x.FROM}: ${f(x.r).padStart(7)} · caída ${f(-x.dd)} · saltos: ${x.saltos.join(", ") || "ninguno"}`);

// 2) el protocolo arrancando el 8-sep (el día de la cartera real)
console.log(`\n2) ARRANQUE EL ${dates[i0]} — top-5 del modelo ese cierre: ${top5(i0)}`);
const variantes = [
  ["v1.1: trailing 45% + re-scan al saltar", { scfg: { tipo: "FIJO", w: 0.45 } }],
  ["sin actuar (comprar y mantener, sin stops)", { scfg: { tipo: "NONE" } }],
  ["trailing fijo 35%", { scfg: { tipo: "FIJO", w: 0.35 } }],
  ["trailing fijo 25%", { scfg: { tipo: "FIJO", w: 0.25 } }],
  ["trailing fijo 15%", { scfg: { tipo: "FIJO", w: 0.15 } }],
  ["trailing fijo 25% + veto 21 ses.", { scfg: { tipo: "FIJO", w: 0.25 }, cooldown: 21 }],
  ["trailing 15% solo con CODICIA + veto", { scfg: { tipo: "REGIMEN", w: 0.45, wTight: 0.15, on: (i) => ESTADOS.G1.on[i] === true, reancla: false }, cooldown: 21 }],
  ["trailing 25% solo con SPY<EMA200", { scfg: { tipo: "REGIMEN", w: 0.45, wTight: 0.25, on: (i) => ESTADOS.R1.on[i] === true, reancla: false } }],
];
out.arranque8sep = [];
for (const [nombre, extra] of variantes) {
  const reg = []; const s = simular({ ...BASE, ...extra, FROM: i0, registro: reg });
  const r = s.curve[TO] - 1, m = dd(s.curve, i0, TO);
  out.arranque8sep.push({ nombre, r, dd: m, saltos: reg.map((e) => ({ fecha: dates[e.i], ticker: T[e.ti].sym, vsEntrada: e.exitPx / e.entryPx - 1, vsPico: e.exitPx / e.peak - 1 })) });
  console.log(`   ${nombre.padEnd(44)} ${f(r).padStart(7)} · caída máx. ${f(-m).padStart(7)} · saltos ${reg.length}`);
  if (nombre.startsWith("v1.1")) for (const e of reg) console.log(`      ↳ ${dates[e.i]} salta ${T[e.ti].sym.replace(".US", "")} (${f(e.exitPx / e.entryPx - 1)} vs entrada, ${f(e.exitPx / e.peak - 1)} vs pico) → re-scan: ${top5(e.i)}`);
}

// 3) estados de régimen al último cierre
const k = SERIES.K[TO], S = SERIES;
console.log(`\n3) ESTADOS AL CIERRE DEL ${FIN}`);
console.log(`   SPY vs EMA200 ${f(S.spy[k] / S.e200[k] - 1)} · vs EMA50 ${f(S.spy[k] / S.e50[k] - 1)} · SMA50 vs SMA200 ${f(S.s50[k] / S.s200[k] - 1)} · a ${f(-S.spyDD[k])} de su máximo de 252 · RSI14 ${S.rsiSpy[k].toFixed(0)}`);
console.log(`   VIX ${S.vix[k].toFixed(1)} (percentil ${(S.vixPct[k] * 100).toFixed(0)}%) · F&G interno 5 ses. ${S.fg5[k]?.toFixed(0)} (percentil ${(S.fgPct[k] * 100).toFixed(0)}%) · HYG vs EMA200 ${f(S.hyg[k] / S.hygE200[k] - 1)}`);
console.log(`   top-5 del scan: ${top5(TO)} · estiramiento medio sobre EMA50 ${f(S.top5Ext[TO])} (percentil ${(S.top5ExtPct[TO] * 100).toFixed(0)}%) · RSI medio ${S.top5Rsi[TO].toFixed(0)}`);
out.estadosHoy = Object.fromEntries(Object.entries(ESTADOS).map(([c, e]) => [c, { nombre: e.nombre, on: e.on[TO] === true }]));
console.log("   ON: " + (Object.entries(ESTADOS).filter(([, e]) => e.on[TO]).map(([c, e]) => `${c} ${e.nombre}`).join(" · ") || "ninguno"));
// los estados en la ventana (cuántos días ON)
console.log("   días ON en la ventana: " + ["R1", "R3", "R5", "G1", "G2", "F1", "F2", "F4", "F5", "K1", "K2", "K4"].map((c) => `${c} ${ESTADOS[c].on.slice(iCanon + 1, TO + 1).filter(Boolean).length}`).join(" · "));
out.valoresHoy = { spyVsEma200: S.spy[k] / S.e200[k] - 1, spyDD: S.spyDD[k], rsiSpy: S.rsiSpy[k], vix: S.vix[k], vixPct: S.vixPct[k], fg5: S.fg5[k], fgPct: S.fgPct[k], top5Ext: S.top5Ext[TO], top5ExtPct: S.top5ExtPct[TO], top5Rsi: S.top5Rsi[TO] };
if (process.env.E12_OUT) fs.writeFileSync(process.env.E12_OUT, JSON.stringify(out, null, 1));
