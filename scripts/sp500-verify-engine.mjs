/**
 * VERIFICACIÓN DEL MOTOR SP500 — replica el motor de producción sesión a sesión
 * sobre 32 años reales y comprueba que reproduce las cifras del estudio.
 * Si esto se desvía, el panel estaría mostrando una estrategia distinta a la validada.
 */
import fs from "node:fs";
import { computeSp500Signal, buildSp500Order, SP500_PROFILES } from "../api/_lib/sp500Engine.js";

const DB = JSON.parse(fs.readFileSync("data/sp500-history.json", "utf8")).series;
const spy = DB.SPY;
// El motor recibe precio total-return (con dividendos), igual que el estudio.
const bars = spy.map((b) => ({ date: b.date, close: b.adj, high: b.high, low: b.low }));
const D = bars.length;
const irxMap = new Map((DB["^IRX"] || []).map((b) => [b.date, b.close / 100]));
let lastIrx = 0.04;

const COST = 5 / 1e4, FEE = 0.0009, LEV_SPREAD = 0.0040;
let fails = 0;

for (const profile of ["EQUILIBRADO", "PRUDENTE", "AMBICIOSO", "AGRESIVO"]) {
  const FROM = 260;
  let eq = 1, held = 0, orders = 0, switches = 0, daysIn = 0, prevSignal = null;
  let peak = 0, mdd = 0;
  for (let i = FROM + 1; i < D; i++) {
    const window = bars.slice(0, i);           // solo datos hasta ayer: sin mirar al futuro
    const isMonday = new Date(bars[i].date + "T00:00:00Z").getUTCDay() === 1;
    const sig = computeSp500Signal(window, { profile, previousSignal: prevSignal });
    if (!sig.ok) continue;
    // Revisión semanal + evaluación diaria del refuerzo en retroceso (como en el estudio)
    if (isMonday || sig.pullbackOpen) {
      const order = buildSp500Order(sig, { accountTotal: 1, currentInvested: held });
      if (order && order.action !== "MANTENER") {
        eq *= 1 - COST * Math.abs(order.delta);
        held = order.targetAmount;
        orders++;
        if ((order.targetAmount === 0) !== (order.currentAmount === 0)) switches++;
      }
    }
    prevSignal = sig;
    const rf = (irxMap.get(bars[i - 1].date) ?? lastIrx); lastIrx = rf;
    // Coste de financiar la parte que excede el 100% del capital (apalancamiento real).
    const borrow = Math.max(0, held - 1) * (rf + LEV_SPREAD) / 252;
    const r = held * (bars[i].close / bars[i - 1].close - 1)
            + Math.max(0, 1 - Math.min(held, 1)) * rf / 252
            - borrow - (held > 0 ? FEE / 252 : 0);
    eq *= 1 + r;
    peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
    if (held > 0) daysIn++;
  }
  const years = (D - 1 - FROM) / 252;
  const cagr = Math.pow(eq, 1 / years) - 1;
  const tag = profile.padEnd(12);
  console.log(`${tag} CAGR ${(cagr * 100).toFixed(1)}%  caída ${(mdd * 100).toFixed(1)}%  MAR ${(cagr / mdd).toFixed(2)}  órdenes/año ${(orders / years).toFixed(0)}  in/out ${(switches / years).toFixed(1)}  %dentro ${((daysIn / (D - 1 - FROM)) * 100).toFixed(0)}%`);
  // Cada perfil se contrasta contra las cifras que el propio motor publica al usuario.
  const exp = SP500_PROFILES[profile];
  const dC = Math.abs(cagr - exp.cagr) * 100, dD = Math.abs(mdd - exp.maxDD) * 100;
  const ok = dC < 2.0 && dD < 3.5;
  if (!ok) fails++;
  console.log(`  ↳ publicado: CAGR ${(exp.cagr * 100).toFixed(1)}% / caída ${(exp.maxDD * 100).toFixed(1)}%  →  desvío ${dC.toFixed(1)} pp / ${dD.toFixed(1)} pp  ${ok ? "✅ REPRODUCE" : "❌ NO REPRODUCE"}`);
}
console.log(`\nPeriodo ${bars[261].date} → ${bars.at(-1).date}`);
if (fails) { console.error(`\n❌ ${fails} perfil(es) no reproducen sus cifras publicadas.`); process.exit(1); }
console.log("✅ Los 4 perfiles reproducen las cifras que el panel muestra al usuario.");
