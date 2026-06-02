import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  TOP8_COST_POLICY_STATUS,
  buildTop8CostPolicy,
  classifyTop8FullRunCost,
} from "../api/_lib/top8CostPolicy.js";

const root = process.cwd();

function fileUrl(path) {
  return pathToFileURL(join(root, path)).href;
}

function makeResponse(label, sink) {
  let statusCode = 200;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      sink[label] = { statusCode, payload };
    },
    setHeader() {},
  };
}

function makePlan({ totalBatches, totalOperableCandidates, perBatchCalls, fullRunCalls }) {
  return {
    strategy: "MANUAL_BATCHES_OVER_DYNAMIC_UNIVERSE",
    batchSize: 50,
    totalOperableCandidates,
    totalBatches,
    estimatedProviderCallsPerFullBatch: perBatchCalls,
    estimatedProviderCallsForAllBatches: fullRunCalls,
  };
}

function assertCostPolicyClassification() {
  const smallPlan = makePlan({
    totalBatches: 1,
    totalOperableCandidates: 50,
    perBatchCalls: 101,
    fullRunCalls: 101,
  });
  const largePlan = makePlan({
    totalBatches: 3,
    totalOperableCandidates: 120,
    perBatchCalls: 101,
    fullRunCalls: 243,
  });
  const excessivePlan = makePlan({
    totalBatches: 428,
    totalOperableCandidates: 21369,
    perBatchCalls: 101,
    fullRunCalls: 43166,
  });

  assert.equal(classifyTop8FullRunCost(smallPlan), TOP8_COST_POLICY_STATUS.MANUAL_APPROVAL_REQUIRED);
  assert.equal(classifyTop8FullRunCost(largePlan), TOP8_COST_POLICY_STATUS.NOT_OPERATIONAL_FULL_RUN);
  assert.equal(classifyTop8FullRunCost(excessivePlan), TOP8_COST_POLICY_STATUS.COST_TOO_HIGH);

  const dryRunPolicy = buildTop8CostPolicy({
    batchPlan: largePlan,
    selectedBatch: {
      batchNumber: 1,
      selectedAssets: 50,
      estimatedProviderCalls: 101,
    },
    dryRun: true,
    providerCallsPlanned: 0,
  });
  assert.equal(dryRunPolicy.status, TOP8_COST_POLICY_STATUS.SAFE_DRY_RUN);
  assert.equal(dryRunPolicy.fullRunStatus, TOP8_COST_POLICY_STATUS.NOT_OPERATIONAL_FULL_RUN);
  assert.equal(dryRunPolicy.estimatedProviderCalls, 101);
  assert.equal(dryRunPolicy.estimatedFullRunProviderCalls, 243);
  assert.equal(dryRunPolicy.fullUniverseExecutionAllowed, false);
  assert.equal(dryRunPolicy.manualApprovalRequired, true);

  const fullRunPolicy = buildTop8CostPolicy({
    batchPlan: excessivePlan,
    dryRun: false,
    fullUniverseRequested: true,
    providerCallsPlanned: 0,
  });
  assert.equal(fullRunPolicy.status, TOP8_COST_POLICY_STATUS.COST_TOO_HIGH);
  assert.equal(fullRunPolicy.fullUniverseExecutionAllowed, false);
}

function countHistoryOrSpreadCalls(calls) {
  return calls.filter((url) => url.includes("/api/eod/") || url.includes("/api/real-time/")).length;
}

async function assertEndpointCostMetadata() {
  process.env.ENABLE_REAL_API_CALLS = "true";
  process.env.EODHD_API_KEY = "test_key";

  const fetchCalls = [];
  let usAssetCount = 2;
  global.fetch = async (url) => {
    const text = String(url);
    fetchCalls.push(text);

    if (text.includes("/exchange-symbol-list/US")) {
      return {
        ok: true,
        json: async () =>
          Array.from({ length: usAssetCount }, (_, index) => ({
            Code: `AA${index}`,
            Name: `Alpha ${index}`,
            Type: "Common Stock",
            Exchange: index % 2 === 0 ? "NASDAQ" : "NYSE",
            Currency: "USD",
            Isin: `USAA${index}`,
          })),
      };
    }

    if (text.includes("/exchange-symbol-list/")) {
      return { ok: true, json: async () => [] };
    }

    throw new Error(`Unexpected provider call during Phase 8 validation: ${text}`);
  };

  const runModule = await import(fileUrl("api/top8-run.js"));
  const batchModule = await import(fileUrl("api/top8-batch.js"));
  const top8Module = await import(fileUrl("api/top8.js"));
  const output = {};

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId: "fake-run" } },
    makeResponse("missingConfirm", output),
  );
  assert.equal(output.missingConfirm.statusCode, 400);
  assert.equal(output.missingConfirm.payload.error, "EXECUTION_CONFIRMATION_REQUIRED");
  assert.equal(output.missingConfirm.payload.providerCallsPlanned, 0);
  assert.equal(output.missingConfirm.payload.costPolicy.status, TOP8_COST_POLICY_STATUS.MANUAL_APPROVAL_REQUIRED);
  assert.equal(fetchCalls.length, 0, "missing confirm must not discover universe or call providers");

  await batchModule.default({ method: "GET", query: { batch: "1" } }, makeResponse("dryBatch", output));
  assert.equal(output.dryBatch.statusCode, 200);
  assert.equal(output.dryBatch.payload.providerCallsPlanned, 0);
  assert.equal(output.dryBatch.payload.costPolicy.status, TOP8_COST_POLICY_STATUS.SAFE_DRY_RUN);
  assert.equal(output.dryBatch.payload.costPolicy.fullUniverseExecutionAllowed, false);
  assert.equal(output.dryBatch.payload.manualApprovalRequired, true);
  assert.equal(output.dryBatch.payload.estimatedProviderCalls, 5);
  assert.equal(output.dryBatch.payload.estimatedFullRunProviderCalls, 5);
  assert.equal(countHistoryOrSpreadCalls(fetchCalls), 0, "dry-run batch must not call historical or spread providers");

  await runModule.default({ method: "GET", query: { create: "true" } }, makeResponse("run", output));
  assert.equal(output.run.statusCode, 201);
  assert.equal(output.run.payload.providerCallsPlanned, 0);
  assert.equal(output.run.payload.costPolicy.status, TOP8_COST_POLICY_STATUS.SAFE_DRY_RUN);
  assert.equal(output.run.payload.fullUniverseExecutionAllowed, false);
  assert.equal(countHistoryOrSpreadCalls(fetchCalls), 0, "run creation must not call historical or spread providers");

  usAssetCount = 120;
  await top8Module.default({ method: "GET", query: {} }, makeResponse("top8Blocked", output));
  assert.equal(output.top8Blocked.statusCode, 409);
  assert.equal(output.top8Blocked.payload.error, "COST_GATE_REQUIRES_BATCHING_STRATEGY");
  assert.equal(output.top8Blocked.payload.costPolicy.status, TOP8_COST_POLICY_STATUS.NOT_OPERATIONAL_FULL_RUN);
  assert.equal(output.top8Blocked.payload.fullUniverseExecutionAllowed, false);
  assert.equal(output.top8Blocked.payload.estimatedFullRunProviderCalls, 242);
  assert.equal(countHistoryOrSpreadCalls(fetchCalls), 0, "blocked TOP 8 must not call historical or spread providers");
}

async function assertNoNewOperationalSurface() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase8"], "node scripts/validate-phase8.mjs");

  const batchSource = await readFile(join(root, "api/top8-batch.js"), "utf8");
  assert.equal(batchSource.includes("confirm=EXECUTE_BATCH"), true);
  assert.equal(batchSource.includes("EXECUTION_CONFIRMATION_REQUIRED"), true);

  const policySource = await readFile(join(root, "api/_lib/top8CostPolicy.js"), "utf8");
  assert.equal(policySource.includes("fullUniverseExecutionAllowed: false"), true);
  assert.equal(policySource.includes("SAFE_DRY_RUN"), true);
  assert.equal(policySource.includes("COST_TOO_HIGH"), true);
}

assertCostPolicyClassification();
await assertEndpointCostMetadata();
await assertNoNewOperationalSurface();

console.log("Phase 8 validation OK: cost policy, safe metadata, dry-run behavior and no-cost guardrails passed.");
