// DIAGNÓSTICO POST-HOC (no es un gate): desglose por episodio de MIEDO y estado de hoy.
import { simular, PHASES10, TO, dates, D, spyClose, isNum, mean } from "./lab-day-core.mjs";
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync("/private/tmp/claude-501/estudio10-vix.json", "utf8")).chart.result[0];
const m = new Map(); j.timestamp.forEach((t, i) => { const c = j.indicators.quote[0].close[i]; if (isNum(c)) m.set(new Date(t * 1000).toISOString().slice(0, 10), c); });
const VIX = []; let last = null; for (let i = 0; i < D; i++) { if (m.has(dates[i])) last = m.get(dates[i]); VIX.push(last); }
const vp = (i) => { let le = 0, n = 0; for (let q = i - 251; q <= i; q++) if (isNum(VIX[q])) { n++; if (VIX[q] <= VIX[i]) le++; } return le / n; };
const dd = (i) => { let mx = 0; for (let q = i - 251; q <= i; q++) mx = Math.max(mx, spyClose[q]); return 1 - spyClose[i] / mx; };
const MIEDO = dates.map((_, i) => i >= 251 && isNum(VIX[i]) && (vp(i) >= 0.90 || dd(i) >= 0.10));
const BASE = { R: 63, K: 5, wcfg: { modo: "SCORE" }, modoStop: "RESCAN2", cooldown: 0, scfg: { tipo: "FIJO", w: 0.45 } };
const FROMS = [260, 300, 350]; const H = 63;
const ep = new Array(D).fill(-1); let id = -1, lastI = -999; for (let i = 0; i < D; i++) if (MIEDO[i]) { if (i - lastI > 60) id++; ep[i] = id; lastI = i; }
const rows = [];
const allByPhase = FROMS.map((F) => { const s = simular({ ...BASE, FROM: F }); const a = []; for (let i = F + 252; i + H <= TO; i++) a.push(s.curve[i + H] / s.curve[i] - 1); return { F, s, mAll: mean(a) }; });
for (let e = 0; e <= id; e++) {
  const idx = []; for (let i = 0; i < D; i++) if (ep[i] === e) idx.push(i);
  const exc = [], worst = [];
  for (const { F, s, mAll } of allByPhase) {
    const r = idx.filter((i) => i >= F + 252 && i + H <= TO).map((i) => ({ r: s.curve[i + H] / s.curve[i] - 1, mn: Math.min(...Array.from({ length: H }, (_, k) => s.curve[i + k + 1] / s.curve[i] - 1)) }));
    if (r.length) { exc.push(mean(r.map((x) => x.r)) - mAll); worst.push(mean(r.map((x) => x.mn))); }
  }
  rows.push({ e, desde: dates[idx[0]], hasta: dates[idx.at(-1)], dias: idx.length, exceso63: mean(exc), peorBacheMedio: mean(worst) });
}
console.log("episodio  desde       hasta       días  exceso 63s   peor bache dentro de los 63s");
for (const r of rows) console.log(`${String(r.e).padStart(4)}  ${r.desde}  ${r.hasta}  ${String(r.dias).padStart(4)}   ${(r.exceso63 * 100).toFixed(1).padStart(6)}%     ${(r.peorBacheMedio * 100).toFixed(1).padStart(6)}%`);
const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=1y&interval=1d", { headers: { "User-Agent": "Mozilla/5.0" } });
const sp = (await res.json()).chart.result[0].indicators.quote[0].close.filter(isNum);
const vx = j.indicators.quote[0].close.filter(isNum);
const spxNow = sp.at(-1), spxMax = Math.max(...sp.slice(-252)), v = vx.at(-1);
const vNow = (vx.slice(-252).filter((x) => x <= v).length) / 252;
console.log(`\nHOY: SPY ${spxNow.toFixed(2)} · desde máx. 52s −${((1 - spxNow / spxMax) * 100).toFixed(1)}% · VIX ${v.toFixed(2)} (percentil 1 año ${(vNow * 100).toFixed(0)}%) → MIEDO(def. del estudio) = ${vNow >= 0.9 || 1 - spxNow / spxMax >= 0.1}`);
