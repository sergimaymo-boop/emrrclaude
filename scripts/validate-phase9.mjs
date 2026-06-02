import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const executionConfirmation = "EXECUTE_BATCH";

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

function buildBars() {
  return Array.from({ length: 70 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000_000 + index * 1_000,
  }));
}

function countHistoryOrSpreadCalls(calls) {
  return calls.filter((url) => url.includes("/api/eod/") || url.includes("/api/real-time/")).length;
}

function assertPartialBatchMetadata(payload, mode) {
  assert.equal(payload.batchExecutionMode, mode);
  assert.equal(payload.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(payload.isPartialResult, true);
  assert.equal(payload.isGlobalTop8Final, false);
  assert.equal(typeof payload.executedBatchCount, "number");
  assert.ok(payload.remainingBatchCount === null || typeof payload.remainingBatchCount === "number");
  assert.ok(payload.actualProviderCalls === null || typeof payload.actualProviderCalls === "number");
}

async function assertPhase9PartialBatchTraceability() {
  process.env.ENABLE_REAL_API_CALLS = "true";
  process.env.EODHD_API_KEY = "test_key";

  const fetchCalls = [];
  global.fetch = async (url) => {
    const text = String(url);
    fetchCalls.push(text);

    if (text.includes("/exchange-symbol-list/US")) {
      return {
        ok: true,
        json: async () => [
          {
            Code: "AAA",
            Name: "Alpha",
            Type: "Common Stock",
            Exchange: "NASDAQ",
            Currency: "USD",
            Isin: "USAAA",
          },
          {
            Code: "BBB",
            Name: "Beta",
            Type: "Common Stock",
            Exchange: "NYSE",
            Currency: "USD",
            Isin: "USBBB",
          },
        ],
      };
    }

    if (text.includes("/exchange-symbol-list/")) {
      return { ok: true, json: async () => [] };
    }

    if (text.includes("/api/eod/")) {
      return { ok: true, json: async () => buildBars() };
    }

    if (text.includes("/api/real-time/")) {
      return { ok: true, json: async () => ({ bid: 99.9, ask: 100.1, close: 100 }) };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };

  const runModule = await import(fileUrl("api/top8-run.js"));
  const batchModule = await import(fileUrl("api/top8-batch.js"));
  const finalModule = await import(fileUrl("api/top8-final.js"));
  const top8Module = await import(fileUrl("api/top8.js"));
  const output = {};

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId: "fake-run" } },
    makeResponse("missingConfirm", output),
  );
  assert.equal(output.missingConfirm.statusCode, 400);
  assert.equal(output.missingConfirm.payload.error, "EXECUTION_CONFIRMATION_REQUIRED");
  assertPartialBatchMetadata(output.missingConfirm.payload, "MANUAL_EXECUTION");
  assert.equal(fetchCalls.length, 0, "missing confirm must not call providers or universe discovery");

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", confirm: executionConfirmation } },
    makeResponse("missingRunId", output),
  );
  assert.equal(output.missingRunId.statusCode, 400);
  assert.equal(output.missingRunId.payload.error, "RUN_ID_REQUIRED_FOR_EXECUTION");
  assertPartialBatchMetadata(output.missingRunId.payload, "MANUAL_EXECUTION");
  assert.equal(fetchCalls.length, 0, "missing runId must not call providers or universe discovery");

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId: "missing-run", confirm: executionConfirmation } },
    makeResponse("missingRun", output),
  );
  assert.equal(output.missingRun.statusCode, 404);
  assert.equal(output.missingRun.payload.error, "RUN_NOT_FOUND");
  assertPartialBatchMetadata(output.missingRun.payload, "MANUAL_EXECUTION");
  assert.equal(fetchCalls.length, 0, "missing run must not call providers or universe discovery");

  await batchModule.default({ method: "GET", query: { batch: "1" } }, makeResponse("dryRun", output));
  assert.equal(output.dryRun.statusCode, 200);
  assert.equal(output.dryRun.payload.providerCallsPlanned, 0);
  assertPartialBatchMetadata(output.dryRun.payload, "DRY_RUN");
  assert.equal(output.dryRun.payload.actualProviderCalls, null);
  assert.equal(countHistoryOrSpreadCalls(fetchCalls), 0, "dry run must not call historical or spread providers");

  await runModule.default({ method: "GET", query: { create: "true" } }, makeResponse("run", output));
  assert.equal(output.run.statusCode, 201);
  assert.equal(output.run.payload.ok, true);

  const runId = output.run.payload.run.runId;
  await finalModule.default({ method: "GET", query: { runId } }, makeResponse("earlyFinal", output));
  assert.equal(output.earlyFinal.statusCode, 409);
  assert.equal(output.earlyFinal.payload.error, "RUN_NOT_COMPLETE");
  assert.equal(output.earlyFinal.payload.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(output.earlyFinal.payload.isPartialResult, true);
  assert.equal(output.earlyFinal.payload.isGlobalTop8Final, false);

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId, confirm: executionConfirmation } },
    makeResponse("batch", output),
  );
  assert.equal(output.batch.statusCode, 200);
  assert.equal(output.batch.payload.ok, true);
  assertPartialBatchMetadata(output.batch.payload, "MANUAL_EXECUTION");
  assert.equal(output.batch.payload.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(output.batch.payload.isGlobalTop8Final, false);
  assert.equal(output.batch.payload.actualProviderCalls, 5);
  assert.equal(output.batch.payload.runUpdate.run.isGlobalTop8Final, true);

  const callsAfterFirstBatch = fetchCalls.length;
  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId, confirm: executionConfirmation } },
    makeResponse("duplicateBatch", output),
  );
  assert.equal(output.duplicateBatch.statusCode, 409);
  assert.equal(output.duplicateBatch.payload.error, "BATCH_ALREADY_ATTACHED");
  assertPartialBatchMetadata(output.duplicateBatch.payload, "MANUAL_EXECUTION");
  assert.equal(fetchCalls.length, callsAfterFirstBatch, "duplicate batch must not call providers");

  await finalModule.default({ method: "GET", query: { runId } }, makeResponse("final", output));
  assert.equal(output.final.statusCode, 200);
  assert.equal(output.final.payload.resultScope, "GLOBAL_TOP8_FINAL");
  assert.equal(output.final.payload.isPartialResult, false);
  assert.equal(output.final.payload.isGlobalTop8Final, true);

  await top8Module.default({ method: "GET", query: {} }, makeResponse("top8Small", output));
  assert.equal(output.top8Small.payload.fullUniverseExecutionAllowed, false);
}

async function assertNoNewOperationalSurface() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase9"], "node scripts/validate-phase9.mjs");

  const top8BatchSource = await readFile(join(root, "api/top8-batch.js"), "utf8");
  assert.equal(
    top8BatchSource.includes("buildPartialBatchResultMetadata"),
    true,
    "api/top8-batch.js must use the shared partial batch metadata helper",
  );
  assert.equal(
    top8BatchSource.includes("TOP8_BATCH_EXECUTION_MODE"),
    true,
    "api/top8-batch.js must mark dry-run and manual execution modes",
  );

  const files = [
    "api/top8-final.js",
    "api/_lib/top8ResultMetadata.js",
    "README.md",
    "MASTER_CODEX_V1.md",
  ];

  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    assert.equal(source.includes("PARTIAL_BATCH_ONLY"), true, `${file} must document partial batch scope`);
  }
}

await assertPhase9PartialBatchTraceability();
await assertNoNewOperationalSurface();

console.log("Phase 9 validation OK: partial batch traceability, finalization guardrails and no-cost local checks passed.");
