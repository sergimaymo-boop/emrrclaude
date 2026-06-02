import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SPREAD_VERIFICATION_POLICY,
  SPREAD_VERIFICATION_STATUS,
  evaluateBidAskSpreadVerification,
  getSpreadVerificationPolicy,
} from "../api/_lib/spreadVerificationPolicy.js";

const root = process.cwd();

function basePayload(overrides = {}) {
  return {
    bid: 99.9,
    ask: 100.1,
    provider: "EODHD",
    providerSymbol: "PHASE117.AS",
    timestampUtc: "2026-06-01T11:45:00.000Z",
    isMock: false,
    isProxySpread: false,
    substituteUsed: false,
    ...overrides,
  };
}

function assertPolicyShape() {
  const policy = getSpreadVerificationPolicy();

  assert.equal(policy.version, "PHASE_11_7_SPREAD_VERIFICATION_POLICY_V1");
  assert.equal(policy.spreadVerificationMode, "PUNCTUAL_MANUAL_BID_ASK_DESIGN_ONLY");
  assert.equal(policy.verificationResultScope, "DIAGNOSTIC_ONLY");
  assert.equal(policy.requiresRealBidAsk, true);
  assert.equal(policy.execAllowed, false);
  assert.equal(policy.globalTop8Allowed, false);
  assert.equal(policy.allowedProviderChecks, "EXISTING_CONFIGURED_SOURCES_ONLY");
  assert.equal(policy.configurationChangeAllowed, false);
  assert.equal(policy.persistenceAllowed, false);
  assert.equal(policy.newProviderAllowed, false);
  assert.equal(policy.proxySpreadAllowed, false);
  assert.equal(policy.mockDataAllowed, false);
  assert.deepEqual(policy, { ...SPREAD_VERIFICATION_POLICY });
}

function assertValidBidAskStaysDiagnosticOnly() {
  const result = evaluateBidAskSpreadVerification(basePayload());

  assert.equal(result.verificationStatus, SPREAD_VERIFICATION_STATUS.DIAGNOSTIC_ONLY);
  assert.equal(result.verificationResultScope, "DIAGNOSTIC_ONLY");
  assert.equal(result.requiresRealBidAsk, true);
  assert.equal(result.execAllowed, false);
  assert.equal(result.globalTop8Allowed, false);
  assert.equal(result.executionPolicy, SPREAD_VERIFICATION_STATUS.BLOCKS_EXEC);
  assert.equal(result.spreadPercent, 0.2);
  assert.deepEqual(result.blockedReasons, []);
}

function assertBlocked(payloadOverrides, reason) {
  const result = evaluateBidAskSpreadVerification(basePayload(payloadOverrides));

  assert.equal(result.verificationStatus, SPREAD_VERIFICATION_STATUS.NOT_VERIFIED);
  assert.equal(result.execAllowed, false);
  assert.equal(result.globalTop8Allowed, false);
  assert.equal(result.executionPolicy, SPREAD_VERIFICATION_STATUS.BLOCKS_EXEC);
  assert.equal(result.blockedReasons.includes(reason), true, `${reason} missing in ${JSON.stringify(result.blockedReasons)}`);
}

function assertInvalidInputsBlock() {
  assertBlocked({ bid: null }, "BID_REQUIRED");
  assertBlocked({ ask: null }, "ASK_REQUIRED");
  assertBlocked({ bid: 100, ask: 100 }, "ASK_MUST_BE_GREATER_THAN_BID");
  assertBlocked({ bid: 101, ask: 100 }, "ASK_MUST_BE_GREATER_THAN_BID");
  assertBlocked({ bid: 0 }, "BID_MUST_BE_POSITIVE");
  assertBlocked({ provider: "" }, "PROVIDER_REQUIRED");
  assertBlocked({ providerSymbol: "" }, "PROVIDER_SYMBOL_REQUIRED");
  assertBlocked({ timestampUtc: "", dataContext: "" }, "DATA_CONTEXT_REQUIRED");
  assertBlocked({ isMock: true }, "MOCK_DATA_NOT_ALLOWED");
  assertBlocked({ isProxySpread: true }, "SPREAD_PROXY_NOT_ALLOWED");
  assertBlocked({ substituteUsed: true }, "SUBSTITUTE_DATA_NOT_ALLOWED_FOR_VERIFICATION");
}

async function assertNoEndpointOrExecutionSurfaceAdded() {
  const files = [
    "api/_lib/spreadVerificationPolicy.js",
    "api/_lib/spreadPolicy.js",
    "api/top8-batch-single.js",
  ];
  const combined = (await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))).join("\n").toLowerCase();

  for (const forbidden of ["setinterval(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase"]) {
    assert.equal(combined.includes(forbidden), false, `Forbidden automation/persistence marker found: ${forbidden}`);
  }

  const helper = await readFile(join(root, "api/_lib/spreadVerificationPolicy.js"), "utf8");
  assert.equal(helper.includes("fetch("), false, "Phase 11.7 helper must not call providers directly.");
  assert.equal(helper.includes("execute=true"), false, "Phase 11.7 helper must not introduce execute=true.");

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase11-7"], "node scripts/validate-phase11-7.mjs");
}

assertPolicyShape();
assertValidBidAskStaysDiagnosticOnly();
assertInvalidInputsBlock();
await assertNoEndpointOrExecutionSurfaceAdded();

console.log("Phase 11.7 validation OK: bid/ask verification is diagnostic-only and adds no EXEC/full-run/automation.");
