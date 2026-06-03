const DEFAULT_MAX_SPREAD_PERCENT = 0.35;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export const SPREAD_POLICY_STATUS = Object.freeze({
  VERIFIED: "SPREAD_VERIFIED",
  NOT_AVAILABLE: "SPREAD_NOT_AVAILABLE",
  NOT_VERIFIED: "SPREAD_NOT_VERIFIED",
  DIAGNOSTIC_ONLY: "SPREAD_DIAGNOSTIC_ONLY",
  BLOCKS_EXEC: "SPREAD_BLOCKS_EXEC",
  INVALID: "INVALID_SPREAD",
  ABOVE_MAXIMUM: "SPREAD_ABOVE_PHASE6_MAXIMUM",
});

export const SPREAD_POLICY_ACTIONS = Object.freeze({
  allowedWhenUnverified: ["BLOCKED", "STANDBY", "WATCH_DIAGNOSTIC_ONLY"],
  prohibitedWhenUnverified: ["EXEC"],
});

export const SPREAD_CONTINUATION_POLICY = Object.freeze({
  version: "PHASE_11_6_SPREAD_CONTINUATION_POLICY_V1",
  spreadContinuationPolicy: "EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK",
  currentEuropeEuronextMode: "DIAGNOSTIC_ONLY",
  unverifiedSpreadExecAllowed: false,
  unverifiedSpreadGlobalTop8Allowed: false,
  requiresVerifiedBidAsk: true,
  productionProviderChecksAllowed: "PUNCTUAL_MANUAL_ONLY",
  productionProviderCheckScope: "EXISTING_CONFIGURED_SOURCES_ONLY",
  configurationChangeAllowed: false,
  providerChangeAllowed: false,
  persistenceAllowed: false,
  spreadProxyOperationalAllowed: false,
  futureProcedureStatus: "DOCUMENTED_NOT_OPERATIONAL",
});

export function getSpreadContinuationPolicy() {
  return { ...SPREAD_CONTINUATION_POLICY };
}

function withContinuationPolicy(policy) {
  return {
    ...policy,
    spreadContinuationPolicy: SPREAD_CONTINUATION_POLICY.spreadContinuationPolicy,
    unverifiedSpreadExecAllowed: SPREAD_CONTINUATION_POLICY.unverifiedSpreadExecAllowed,
    unverifiedSpreadGlobalTop8Allowed: SPREAD_CONTINUATION_POLICY.unverifiedSpreadGlobalTop8Allowed,
    requiresVerifiedBidAsk: SPREAD_CONTINUATION_POLICY.requiresVerifiedBidAsk,
    productionProviderChecksAllowed: SPREAD_CONTINUATION_POLICY.productionProviderChecksAllowed,
    configurationChangeAllowed: SPREAD_CONTINUATION_POLICY.configurationChangeAllowed,
  };
}

export function classifySpreadPolicy({ spreadPercent = null, spreadStatus = null, maxSpreadPercent = DEFAULT_MAX_SPREAD_PERCENT } = {}) {
  const providerBlockedReason = spreadStatus?.blockedReason ?? null;
  const providerOk = spreadStatus?.ok === true;

  if (isFiniteNumber(spreadPercent) && spreadPercent >= 0) {
    if (spreadPercent > maxSpreadPercent) {
      return withContinuationPolicy({
        status: SPREAD_POLICY_STATUS.ABOVE_MAXIMUM,
        providerStatus: providerBlockedReason,
        verificationStatus: SPREAD_POLICY_STATUS.VERIFIED,
        diagnosticStatus: null,
        executionPolicy: SPREAD_POLICY_STATUS.BLOCKS_EXEC,
        spreadPercent,
        maxSpreadPercent,
        blocksScore: true,
        blocksExecution: true,
        canEnterGlobalTop8: false,
        canGenerateExec: false,
        allowedNonOperationalActions: ["BLOCKED"],
        prohibitedActions: ["EXEC"],
        reason: "Spread is verified but above the approved Phase 6 maximum.",
      });
    }

    return withContinuationPolicy({
      status: SPREAD_POLICY_STATUS.VERIFIED,
      providerStatus: providerBlockedReason,
      verificationStatus: SPREAD_POLICY_STATUS.VERIFIED,
      diagnosticStatus: null,
      executionPolicy: SPREAD_POLICY_STATUS.VERIFIED,
      spreadPercent,
      maxSpreadPercent,
      blocksScore: false,
      blocksExecution: false,
      canEnterGlobalTop8: true,
      canGenerateExec: true,
      allowedNonOperationalActions: [],
      prohibitedActions: [],
      reason: "Spread is verified and inside the approved maximum.",
    });
  }

  if (spreadPercent !== null && !isFiniteNumber(spreadPercent)) {
    return withContinuationPolicy({
      status: SPREAD_POLICY_STATUS.INVALID,
      providerStatus: providerBlockedReason,
      verificationStatus: SPREAD_POLICY_STATUS.NOT_VERIFIED,
      diagnosticStatus: SPREAD_POLICY_STATUS.DIAGNOSTIC_ONLY,
      executionPolicy: SPREAD_POLICY_STATUS.BLOCKS_EXEC,
      spreadPercent: null,
      maxSpreadPercent,
      blocksScore: true,
      blocksExecution: true,
      canEnterGlobalTop8: false,
      canGenerateExec: false,
      allowedNonOperationalActions: ["BLOCKED"],
      prohibitedActions: ["EXEC"],
      reason: "Spread value is invalid and cannot be used operationally.",
    });
  }

  const status = providerBlockedReason === SPREAD_POLICY_STATUS.NOT_AVAILABLE || providerOk === false
    ? SPREAD_POLICY_STATUS.NOT_AVAILABLE
    : SPREAD_POLICY_STATUS.NOT_VERIFIED;

  return withContinuationPolicy({
    status,
    providerStatus: providerBlockedReason,
    verificationStatus: SPREAD_POLICY_STATUS.NOT_VERIFIED,
    diagnosticStatus: SPREAD_POLICY_STATUS.DIAGNOSTIC_ONLY,
    executionPolicy: SPREAD_POLICY_STATUS.BLOCKS_EXEC,
    spreadPercent: null,
    maxSpreadPercent,
    blocksScore: false,        // CAN be scored → appears as WATCH/BLOCKED, not EXEC
    blocksExecution: true,     // CANNOT generate EXEC without verified spread
    canEnterGlobalTop8: true,  // CAN appear in TOP 8 as WATCH_DIAGNOSTIC_ONLY
    canGenerateExec: false,    // CANNOT generate EXEC
    allowedNonOperationalActions: SPREAD_POLICY_ACTIONS.allowedWhenUnverified,
    prohibitedActions: SPREAD_POLICY_ACTIONS.prohibitedWhenUnverified,
    reason: "Spread is not verified; asset scored as WATCH/BLOCKED only, EXEC prohibited.",
  });
}
