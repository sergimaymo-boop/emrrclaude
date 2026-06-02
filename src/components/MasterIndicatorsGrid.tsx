import type { MasterIndicator } from "../types";

interface MasterIndicatorsGridProps {
  indicators: MasterIndicator[];
}

const barSeeds = [42, 58, 35, 71, 50, 65, 45, 80];

function getIndicatorColor(symbol: string, value: string, changePercent: number): string {
  const num = parseFloat(value);
  if (symbol === "VIX") {
    if (num < 15) return "indicator-change-positive";
    if (num < 20) return "indicator-change-neutral";
    return "indicator-change-negative";
  }
  if (symbol === "VVIX") {
    if (num < 80) return "indicator-change-positive";
    if (num < 110) return "indicator-change-neutral";
    return "indicator-change-negative";
  }
  if (symbol === "MOVE") {
    if (num < 80) return "indicator-change-positive";
    if (num < 100) return "indicator-change-neutral";
    return "indicator-change-negative";
  }
  if (symbol === "TNX") {
    if (num < 3.5) return "indicator-change-positive";
    if (num < 4.5) return "indicator-change-neutral";
    return "indicator-change-negative";
  }
  if (changePercent > 0.05) return "indicator-change-positive";
  if (changePercent < -0.05) return "indicator-change-negative";
  return "indicator-change-neutral";
}

function getBarColor(colorClass: string): string {
  if (colorClass === "indicator-change-positive") return "#10b981";
  if (colorClass === "indicator-change-negative") return "#ef4444";
  return "#f59e0b";
}

export function MasterIndicatorsGrid({ indicators }: MasterIndicatorsGridProps) {
  return (
    <section className="section-block">
      <div className="section-title-row" style={{marginBottom:12}}>
        <h2>Master Indicators</h2>
        <span style={{fontSize:10,color:"#6b7280"}}>Info only</span>
      </div>
      <div className="indicator-grid">
        {indicators.map((indicator, idx) => {
          const colorCls = getIndicatorColor(indicator.symbol, indicator.value, indicator.changePercent);
          const barColor = getBarColor(colorCls);
          const isAvailable = indicator.value !== "N/A";
          return (
            <article className="indicator-card" key={indicator.symbol} style={{padding:"12px",display:"grid",gap:"2px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <strong style={{fontSize:11,fontWeight:800,letterSpacing:"0.08em",color:"#9ca3af"}}>{indicator.symbol}</strong>
                <span style={{fontSize:9,color:indicator.dataMode==="REAL"?"#10b981":"#eab308",fontWeight:700}}>{indicator.dataMode==="REAL"?"LIVE":"CACHE"}</span>
              </div>
              <div className="indicator-value-large" style={{color:isAvailable?"#ffffff":"#4b5563"}}>
                {indicator.value}
              </div>
              <div className={colorCls}>
                {isAvailable && indicator.changePercent !== 0 ? (indicator.changePercent > 0 ? "▲ +" : "▼ ") + Math.abs(indicator.changePercent).toFixed(2) + "%" : "—"}
              </div>
              <div className="mini-bar-chart" style={{marginTop:6}}>
                {barSeeds.map((seed, i) => {
                  const h = Math.max(20, Math.min(100, seed + (idx * 7 + i * 3) % 30));
                  return <span key={i} style={{height:`${h}%`,background:barColor}} />;
                })}
              </div>
              <div style={{fontSize:9,color:"#4b5563",marginTop:4}}>{indicator.name}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
