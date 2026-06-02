import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildEligibilityDiagnostics, buildOperationalTop8FromEvaluations, evaluateCandidate } from "../api/_lib/candidateEvaluationEngine.js";
import { validateUniverseEligibility } from "../api/_lib/eligibilityEngine.js";
import { SPREAD_POLICY_STATUS, classifySpreadPolicy } from "../api/_lib/spreadPolicy.js";

const root = process.cwd();

function buildBars() {
  return Array.from({ length: 70 }, (_, index) => ({
    date: `2026-04-${String(index + 1).padStart(2, "0")}`,
    open: 100 + index,
    high: 103 + index,
    low: 99 + index,
    close: 102 + index,
    volume: 1_000_000 + index * 2_000,
  }));
}

function buildAsset() {
  return {
    canonicalId: "EURONEXT:PHASE115:EUR",
    ticker: "P115.AS",
    providerSymbol: "P115.AS",
    name: "Phase 11.5 Spread Policy",
    region: "Europe",
    market: "Euronext",
    providerExchange: "AS",
    exchange: "EURONEXT",
    currency: "EUR",
    isin: "NL0011500000",
    instrumentType: "Common Stock",
    operabilityStatus: "OPERABLE",
    operabilityReasons: ["OPERABLE_COMMON_EQUITY_METADATA"],
  };
}

function assertUnverifiedSpreadPolicy() {
  const policy = classifySpreadPolicy({
    spreadPercent: null,
    spreadStatus: {
      ok: false,
      provider: "MOCK",
      providerSymbol: "P115.AS",
      spreadPercent: null,
      blockedReason: "SPREAD_NOT_AVAILABLE",
    },
  });

  assert.equal(policy.status, SPREAD_POLICY_STATUS.NOT_AVAILABLE);
  assert.equal(policy.verificationStatus, SPREAD_POLICY_STATUS.NOT_VERIFIED);
  assert.equal(policy.diagnosticStatus, SPREAD_POLICY_STATUS.DIAGNOSTIC_ONLY);
  assert.equal(policy.executionPolicy, SPREAD_POLICY_STATUS.BLOCKS_EXEC);
  assert.equal(policy.blocksExecution, true);
  assert.equal(policy.canEnterGlobalTop8, false);
  assert.equal(policy.canGenerateExec, false);
  assert.deepEqual(policy.allowedNonOperationalActions, ["BLOCKED", "STANDBY", "WATCH_DIAGNOSTIC_ONLY"]);
  assert.deepEqual(policy.prohibitedActions, ["EXEC"]);
  assert.equal(policy.spreadPercent, null);
}

function assertVerifiedSpreadPolicy() {
  const policy = classifySpreadPolicy({
    spreadPercent: 0.12,
    spreadStatus: {
      ok: true,
      provider: "MOCK",
      providerSymbol: "P115.AS",
      spreadPercent: 0.12,
    },
  });

  assert.equal(policy.status, SPREAD_POLICY_STATUS.VERIFIED);
  assert.equal(policy.blocksExecution, false);
  assert.equal(policy.canEnterGlobalTop8, true);
  assert.equal(policy.canGenerateExec, true);
}

function assertAboveMaximumSpreadPolicy() {
  const policy = classifySpreadPolicy({
    spreadPercent: 0.9,
    spreadStatus: {
      ok: true,
      provider: "MOCK",
      providerSymbol: "P115.AS",
      spreadPercent: 0.9,
    },
  });

  assert.equal(policy.status, SPREAD_POLICY_STATUS.ABOVE_MAXIMUM);
  assert.equal(policy.verificationStatus, SPREAD_POLICY_STATUS.VERIFIED);
  assert.equal(policy.executionPolicy, SPREAD_POLICY_STATUS.BLOCKS_EXEC);
  assert.equal(policy.blocksExecution, true);
  assert.equal(policy.canEnterGlobalTop8, false);
  assert.equal(policy.canGenerateExec, false);
}

function assertEligibilityBlocksExecWithoutSpread() {
  const eligibility = validateUniverseEligibility({
    asset: buildAsset(),
    technicalResult: {
      ok: true,
      blockedReasons: [],
      technicals: {
        avgValue20: 25_000_000,
        atrPercent: 2.4,
      },
    },
    spreadPercent: null,
    spreadStatus: {
      ok: false,
      provider: "MOCK",
      providerSymbol: "P115.AS",
      blockedReason: "SPREAD_NOT_AVAILABLE",
      spreadPercent: null,
    },
    marketStatus: "OPEN",
    dataQuality: "GOOD",
  });

  assert.equal(eligibility.eligibleForScore, false);
  assert.equal(eligibility.eligibleForExecution, false);
  assert.equal(eligibility.blockedReasons.includes("SPREAD_NOT_VERIFIED"), true);
  assert.equal(eligibility.warnings.includes("SPREAD_NOT_VERIFIED"), true);
  assert.equal(eligibility.spreadPolicy.status, SPREAD_POLICY_STATUS.NOT_AVAILABLE);
  assert.equal(eligibility.spreadPolicy.diagnosticStatus, SPREAD_POLICY_STATUS.DIAGNOSTIC_ONLY);
  assert.equal(eligibility.spreadPolicy.executionPolicy, SPREAD_POLICY_STATUS.BLOCKS_EXEC);
}

function assertUnverifiedSpreadNeverRanksOperationally() {
  const evaluation = evaluateCandidate({
    asset: buildAsset(),
    historicalBars: buildBars(),
    benchmarkBars: buildBars(),
    spreadPercent: null,
    spreadStatus: {
      ok: false,
      provider: "MOCK",
      providerSymbol: "P115.AS",
      blockedReason: "SPREAD_NOT_AVAILABLE",
      spreadPercent: null,
    },
    marketStatus: "OPEN",
    dataQuality: "GOOD",
  });

  assert.equal(evaluation.technicalResult.ok, true);
  assert.equal(evaluation.eligibility.eligibleForScore, false);
  assert.equal(evaluation.eligibility.eligibleForExecution, false);
  assert.equal(evaluation.action, "BLOCKED");
  assert.equal(evaluation.blockedReasons.includes("SPREAD_NOT_VERIFIED"), true);
  assert.equal(evaluation.eligibility.spreadPolicy.canEnterGlobalTop8, false);
  assert.equal(evaluation.eligibility.spreadPolicy.canGenerateExec, false);

  const top8 = buildOperationalTop8FromEvaluations([evaluation]);
  assert.equal(top8.length, 0);

  const diagnostics = buildEligibilityDiagnostics([evaluation]);
  assert.equal(diagnostics.blockingReasonCounts.SPREAD_NOT_VERIFIED, 1);
  assert.equal(diagnostics.providerReasonCounts.SPREAD_NOT_AVAILABLE, 1);
  assert.equal(diagnostics.spreadPolicyCounts.SPREAD_NOT_AVAILABLE, 1);
  assert.equal(diagnostics.spreadPolicyCounts.SPREAD_DIAGNOSTIC_ONLY, 1);
  assert.equal(diagnostics.spreadPolicyCounts.SPREAD_BLOCKS_EXEC, 1);
  assert.equal(diagnostics.perAssetBlockedReasons[0].spread.policy.canGenerateExec, false);
}

async function assertNoAutomationOrPersistenceAdded() {
  const files = [
    "api/_lib/spreadPolicy.js",
    "api/_lib/eligibilityEngine.js",
    "api/_lib/candidateEvaluationEngine.js",
  ];

  const combined = (await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))).join("\n").toLowerCase();
  for (const forbidden of ["setinterval(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase"]) {
    assert.equal(combined.includes(forbidden), false, `Forbidden automation/persistence marker found: ${forbidden}`);
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase11-5"], "node scripts/validate-phase11-5.mjs");
}

assertUnverifiedSpreadPolicy();
assertVerifiedSpreadPolicy();
assertAboveMaximumSpreadPolicy();
assertEligibilityBlocksExecWithoutSpread();
assertUnverifiedSpreadNeverRanksOperationally();
await assertNoAutomationOrPersistenceAdded();

console.log("Phase 11.5 validation OK: controlled spread policy blocks EXEC, stays diagnostic-only and adds no automation.");
