import type { ScanState } from "../types";

interface ScanStatusPanelProps {
  scanState: ScanState;
}

export function ScanStatusPanel({ scanState }: ScanStatusPanelProps) {
  return (
    <section className={`scan-status ${scanState.isScanning ? "scan-active" : ""}`}>
      <div>
        <p className="eyebrow">Scan status</p>
        <h2>{scanState.label}</h2>
      </div>
      <div className="scan-meta">
        <span>{scanState.scanExecutionMode} #{scanState.refreshedCount}</span>
        {typeof scanState.coveragePercent === "number" ? <span>Coverage {scanState.coveragePercent}%</span> : null}
        {typeof scanState.batchesCompleted === "number" && typeof scanState.batchesTotal === "number" ? (
          <span>Batches {scanState.batchesCompleted}/{scanState.batchesTotal}</span>
        ) : null}
        {typeof scanState.actualProviderCalls === "number" ? (
          <span>Calls {scanState.actualProviderCalls}/{scanState.estimatedProviderCalls ?? "?"}</span>
        ) : null}
        {scanState.scanId ? <span>Scan {scanState.scanId.slice(0, 8)}</span> : null}
        {scanState.recommendedNextAction ? <span>{scanState.recommendedNextAction}</span> : null}
        <span>Last real {scanState.lastRealDataUpdate?.local ?? "none"}</span>
        <strong>{scanState.lastRun.local}</strong>
      </div>
    </section>
  );
}
