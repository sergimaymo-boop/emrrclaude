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
  onContinueScan,
  onCopy,
  onBackup,
  isScanning,
  canContinueScan = false,
  continueLabel = "CONTINUE SCAN",
}: ActionButtonsProps) {
  return (
    <section className="action-panel">
      {canContinueScan && onContinueScan ? (
        <button className="secondary-button" type="button" onClick={onContinueScan} disabled={isScanning} style={{marginBottom:4}}>
          {continueLabel}
        </button>
      ) : null}
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
