interface ActionButtonsProps {
  onScan: () => void;
  onContinueScan?: () => void;
  onCopy: () => void;
  onBackup: () => void;
  isScanning: boolean;
  canContinueScan?: boolean;
  continueLabel?: string;
}

export function ActionButtons({
  onScan,
  onContinueScan,
  onCopy,
  onBackup,
  isScanning,
  canContinueScan = false,
  continueLabel = "CONTINUE",
}: ActionButtonsProps) {
  return (
    <section className="action-panel">
      {/* Primary action — full width */}
      <button className="primary-button" type="button" onClick={onScan} disabled={isScanning}>
        {isScanning ? "SCANNING…" : "SCAN FULL"}
      </button>

      {/* Continue scan if available */}
      {canContinueScan && onContinueScan ? (
        <button className="secondary-button" type="button" onClick={onContinueScan} disabled={isScanning}>
          {continueLabel}
        </button>
      ) : null}

      {/* Export actions — side by side */}
      <div className="action-panel-row">
        <button className="secondary-button" type="button" onClick={onCopy}>
          EXPORT RESULTS
        </button>
        <button className="secondary-button" type="button" onClick={onBackup}>
          EXPORT CODE
        </button>
      </div>
    </section>
  );
}
