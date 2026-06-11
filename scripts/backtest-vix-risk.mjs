/**
 * BACKTEST del SEMÁFORO DE RIESGO (VIX) — análisis OFFLINE, reproducible.
 * Valida los umbrales y probabilidades cableados en src/services/marketRiskRefresh.ts:
 * bin cada día por nivel de VIX (<16 / 16-21 / >=21) y mide P(caída brusca del SPY a 5d).
 * "Caída brusca" = mínimo intradía a 5 sesiones < -3% respecto al cierre del día.
 * Datos: Yahoo ^VIX + ^GSPC (S&P 500), 5 años. Reutiliza /tmp/emrr-bars-5y.json para el SPY si existe.
 */
import fs from "node:fs";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
async function bars(sym){const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`,{headers:{"User-Agent":UA}});const d=await r.json();const x=d?.chart?.result?.[0];if(!x?.timestamp)return null;const q=x.indicators.quote[0];return x.timestamp.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),close:q.close[i],high:q.high[i],low:q.low[i]})).filter(b=>Number.isFinite(b.close)&&Number.isFinite(b.low));}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
// SPY (índice) — usa ^GSPC para coherencia con el VIX (mismo subyacente)
const spx = await bars("^GSPC");
const spxByDate = new Map(spx.map((b,i)=>[b.date,i]));
const vix = await bars("^VIX");
console.log(`VIX ${vix.length} barras · S&P500 ${spx.length} barras · ${spx[0].date}→${spx.at(-1).date}\n`);
const H=5;
const rows=[];
for(const v of vix){
  const i=spxByDate.get(v.date); if(i===undefined||i+H>=spx.length) continue;
  const p0=spx[i].close;
  const win=spx.slice(i+1,i+1+H);
  const minLow=Math.min(...win.map(b=>b.low));
  rows.push({vix:v.close, dd:(minLow/p0-1)*100, ret:(spx[i+H].close/p0-1)*100});
}
rows.sort((a,b)=>a.vix-b.vix);
const t=Math.floor(rows.length/3);
const cut1=rows[t].vix, cut2=rows[2*t].vix;
const buckets=[["VIX BAJO (calma)",rows.filter(r=>r.vix<16)],["VIX MEDIO",rows.filter(r=>r.vix>=16&&r.vix<21)],["VIX ALTO (estrés)",rows.filter(r=>r.vix>=21)]];
console.log(`Cortes de tercil reales: ${cut1.toFixed(1)} / ${cut2.toFixed(1)} (los desplegados usan 16/21)\n`);
console.log("Estado (umbral fijo)  | n     | % días con caída >3% en 5d | caída máx media | retorno 5d");
for(const [name,b] of buckets){
  if(!b.length) continue;
  const big=b.filter(r=>r.dd<-3).length/b.length*100;
  console.log(`${name.padEnd(21)} | ${String(b.length).padStart(4)} | ${big.toFixed(0).padStart(24)}% | ${mean(b.map(r=>r.dd)).toFixed(2).padStart(13)}% | ${mean(b.map(r=>r.ret)).toFixed(2)}%`);
}
console.log("\n→ Estos % son los que muestra el semáforo (marketRiskRefresh.ts). Si difieren, actualizar allí.");
