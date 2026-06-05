import type { ScanState } from "../types";

interface ScanStatusPanelProps {
  scanState: ScanState;
}

export function ScanStatusPanel({ scanState }: ScanStatusPanelProps) {
  const coverage = typeof scanState.coveragePercent === "number" ? scanState.coveragePercent : 0;
  const isComplete = coverage === 100;

  return (
    <section className={`scan-status ${scanState.isScanning ? "scan-active" : ""}`} style={{padding:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <p style={{margin:0,fontSize:10,fontWeight:800,letterSpacing:"0.1em",color:"#6b7280",textTransform:"uppercase"}}>Scan Status</p>
          <h2 style={{margin:"4px 0 0",fontSize:14,fontWeight:800,color:"#f0ece0"}}>{scanState.label}</h2>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:24,fontWeight:900,color:isComplete?"#10b981":"#f59e0b",lineHeight:1}}>{coverage}%</div>
          <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>COVERAGE</div>
        </div>
      </div>
      <div className="scan-coverage-bar">
        <div
          className={`scan-coverage-fill ${isComplete ? "scan-coverage-fill-complete" : ""}`}
          style={{width:`${coverage}%`}}
        />
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:8,flexWrap:"wrap",gap:4}}>
        <span style={{fontSize:10,color:"#6b7280"}}>Coverage {scanState.coveragePercent}%</span>
        {typeof scanState.batchesCompleted === "number" && typeof scanState.batchesTotal === "number" && (
          <span style={{fontSize:10,color:"#6b7280"}}>Batches {scanState.batchesCompleted}/{scanState.batchesTotal}</span>
        )}
        {typeof scanState.actualProviderCalls === "number" && (
          <span style={{fontSize:10,color:"#6b7280"}}>Calls {scanState.actualProviderCalls}/{scanState.estimatedProviderCalls}</span>
        )}
        <span style={{fontSize:10,color:"#6b7280"}}>{scanState.scanExecutionMode}</span>
        <span style={{fontSize:10,color:"#6b7280"}}>{scanState.lastRun.local}</span>
      </div>
    </section>
  );
}
