import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOperationalTop8FromEvaluations, evaluateCandidate } from "../api/_lib/candidateEvaluationEngine.js";
import {
  SPREAD_CONTINUATION_POLICY,
  SPREAD_POLICY_STATUS,
  classifySpreadPolicy,
  getSpreadContinuationPolicy,
} from "../api/_lib/spreadPolicy.js";

const root = process.cwd();

function buildBars() {
  return Array.from({ length: 70 }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    open: 100 + index,
    high: 103 + index,
    low: 99 + index,
    close: 102 + index,
    volume: 1_200_000 + index * 2_500,
  }));
}

function buildEuropeAsset() {
  return {
    canonicalId: "EURONEXT:PHASE116:EUR",
    ticker: "P116.AS",
    providerSymbol: "P116.AS",
    name: "Phase 11.6 Europe Spread Continuation",
    region: "Europe",
    market: "Euronext",
    providerExchange: "AS",
    exchange: "EURONEXT",
    currency: "EUR",
    isin: "NL0011600000",
    instrumentType: "Common Stock",
    operabilityStatus: "OPERABLE",
    operabilityReasons: ["OPERABLE_COMMON_EQUITY_METADATA"],
  };
}

function assertContinuationPolicyDecision() {
  const policy = getSpreadContinuationPolicy();

  assert.equal(policy.version, "PHASE_11_6_SPREAD_CONTINUATION_POLICY_V1");
  assert.equal(policy.spreadContinuationPolicy, "EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK");
  assert.equal(policy.currentEuropeEuronextMode, "DIAGNOSTIC_ONLY");
  assert.equal(policy.unverifiedSpreadExecAllowed, false);
  assert.equal(policy.unverifiedSpreadGlobalTop8Allowed, false);
  assert.equal(policy.requiresVerifiedBidAsk, true);
  assert.equal(policy.productionProviderChecksAllowed, "PUNCTUAL_MANUAL_ONLY");
  assert.equal(policy.productionProviderCheckScope, "EXISTING_CONFIGURED_SOURCES_ONLY");
  assert.equal(policy.configurationChangeAllowed, false);
  assert.equal(policy.providerChangeAllowed, false);
  assert.equal(policy.persistenceAllowed, false);
  assert.equal(policy.spreadProxyOperationalAllowed, false);
  assert.deepEqual(policy, { ...SPREAD_CONTINUATION_POLICY });
}

function assertUnverifiedSpreadRemainsNonOperational() {
  const policy = classifySpreadPolicy({
    spreadPercent: null,
    spreadStatus: {
      ok: false,
      provider: "MOCK_EXISTING_PROVIDER",
      providerSymbol: "P116.AS",
      blockedReason: "SPREAD_NOT_AVAILABLE",
      spreadPercent: null,
    },
  });

  assert.equal(policy.status, SPREAD_POLICY_STATUS.NOT_AVAILABLE);
  assert.equal(policy.diagnosticStatus, SPREAD_POLICY_STATUS.DIAGNOSTIC_ONLY);
  assert.equal(policy.executionPolicy, SPREAD_POLICY_STATUS.BLOCKS_EXEC);
  assert.equal(policy.canGenerateExec, false);
  assert.equal(policy.canEnterGlobalTop8, false);
  assert.equal(policy.unverifiedSpreadExecAllowed, false);
  assert.equal(policy.unverifiedSpreadGlobalTop8Allowed, false);
  assert.equal(policy.requiresVerifiedBidAsk, true);
  assert.equal(policy.productionProviderChecksAllowed, "PUNCTUAL_MANUAL_ONLY");
  assert.equal(policy.configurationChangeAllowed, false);
}

function assertEuropeWithoutVerifiedSpreadDoesNotRank() {
  const evaluation = evaluateCandidate({
    asset: buildEuropeAsset(),
    historicalBars: buildBars(),
    benchmarkBars: buildBars(),
    spreadPercent: null,
    spreadStatus: {
      ok: false,
      provider: "MOCK_EXISTING_PROVIDER",
      providerSymbol: "P116.AS",
      blockedReason: "SPREAD_NOT_AVAILABLE",
      spreadPercent: null,
    },
    marketStatus: "OPEN",
    dataQuality: "GOOD",
  });

  assert.equal(evaluation.technicalResult.ok, true);
  assert.equal(evaluation.action, "BLOCKED");
  assert.equal(evaluation.eligibility.eligibleForScore, false);
  assert.equal(evaluation.eligibility.eligibleForExecution, false);
  assert.equal(evaluation.blockedReasons.includes("SPREAD_NOT_VERIFIED"), true);
  assert.equal(evaluation.eligibility.spreadPolicy.spreadContinuationPolicy, "EUROPE_DIAGNOSTIC_ONLY_UNTIL_VERIFIABLE_BID_ASK");
  assert.equal(evaluation.eligibility.spreadPolicy.canGenerateExec, false);
  assert.equal(evaluation.eligibility.spreadPolicy.canEnterGlobalTop8, false);

  const top8 = buildOperationalTop8FromEvaluations([evaluation]);
  assert.equal(top8.length, 0);
}

async function assertEndpointDryRunExposesDecisionWithoutRunStore() {
  const endpoint = await readFile(join(root, "api/top8-batch-single.js"), "utf8");

  assert.equal(endpoint.includes("getSpreadContinuationPolicy"), true);
  assert.equal(endpoint.includes("spreadContinuationDecision"), true);
  assert.equal(endpoint.includes("top8RunStore"), false);
  assert.equal(endpoint.includes("execute=true&confirm=EXECUTE_BATCH&batch=2"), false);
}

async function assertNoAutomationOrPersistenceAdded() {
  const files = [
    "api/_lib/spreadPolicy.js",
    "api/_lib/eligibilityEngine.js",
    "api/_lib/candidateEvaluationEngine.js",
    "api/top8-batch-single.js",
  ];

  const combined = (await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))).join("\n").toLowerCase();
  for (const forbidden of ["setinterval(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase"]) {
    assert.equal(combined.includes(forbidden), false, `Forbidden automation/persistence marker found: ${forbidden}`);
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase11-6"], "node scripts/validate-phase11-6.mjs");
}

assertContinuationPolicyDecision();
assertUnverifiedSpreadRemainsNonOperational();
assertEuropeWithoutVerifiedSpreadDoesNotRank();
await assertEndpointDryRunExposesDecisionWithoutRunStore();
await assertNoAutomationOrPersistenceAdded();

console.log("Phase 11.6 validation OK: Europe/Euronext stays diagnostic-only until verifiable bid/ask, with no EXEC/full-run/automation.");
