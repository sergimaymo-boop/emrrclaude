export function simulateBackupCode(shouldFail = false) {
  return { ok: !shouldFail, mode: "LOCAL_TECHNICAL_EXPORT_ONLY" };
}
