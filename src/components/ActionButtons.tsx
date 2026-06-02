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
  continueLabel = "CONTINUE SCAN",
}: ActionButtonsProps) {
  return (
    <section className="action-panel">
      <button className="primary-button" type="button" onClick={onScan} disabled={isScanning}>
        {isScanning ? "SCAN RUNNING" : "SCAN FULL"}
      </button>
      {canContinueScan && onContinueScan ? (
        <button className="secondary-button" type="button" onClick={onContinueScan} disabled={isScanning}>
          {continueLabel}
        </button>
      ) : null}
      <button className="secondary-button" type="button" onClick={onCopy}>
        exportar resultados
      </button>
      <button className="secondary-button" type="button" onClick={onBackup}>
        exportar código
      </button>
    </section>
  );
}
