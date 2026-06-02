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
  return Array.from({ length: 300 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000_000 + index * 1_000,
  }));
}

function countHistoricalOrSpreadCalls(calls) {
  return calls.filter((url) => url.includes("/api/eod/") || url.includes("/api/real-time/")).length;
}

function assertSinglePartial(payload) {
  assert.equal(payload.singleInvocation, true);
  assert.equal(payload.globalAggregationAvailable, false);
  assert.equal(payload.finalizationAvailable, false);
  assert.equal(payload.requiresPersistenceForGlobalFinal, true);
  assert.equal(payload.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(payload.isPartialResult, true);
  assert.equal(payload.isGlobalTop8Final, false);
  assert.equal(payload.fullUniverseExecutionAllowed, false);
}

async function assertPhase111EndpointBehavior() {
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

  const singleModule = await import(fileUrl("api/top8-batch-single.js"));
  const output = {};

  await singleModule.default({ method: "POST", query: { batch: "1" } }, makeResponse("method", output));
  assert.equal(output.method.statusCode, 405);
  assert.equal(output.method.payload.error, "METHOD_NOT_ALLOWED");

  await singleModule.default({ method: "GET", query: { batch: "1", runId: "blocked" } }, makeResponse("extraQuery", output));
  assert.equal(output.extraQuery.statusCode, 400);
  assert.equal(output.extraQuery.payload.error, "QUERY_NOT_ALLOWED");

  await singleModule.default({ method: "GET", query: { batch: "abc" } }, makeResponse("badBatch", output));
  assert.equal(output.badBatch.statusCode, 400);
  assert.equal(output.badBatch.payload.error, "BATCH_REQUIRED");
  assertSinglePartial(output.badBatch.payload);

  await singleModule.default({ method: "GET", query: { batch: "2" } }, makeResponse("batchTwo", output));
  assert.equal(output.batchTwo.statusCode, 400);
  assert.equal(output.batchTwo.payload.error, "BATCH_NOT_AUTHORIZED_PHASE_11_1");
  assertSinglePartial(output.batchTwo.payload);

  await singleModule.default(
    { method: "GET", query: { batch: "1", execute: "true" } },
    makeResponse("missingConfirm", output),
  );
  assert.equal(output.missingConfirm.statusCode, 400);
  assert.equal(output.missingConfirm.payload.error, "EXECUTION_CONFIRMATION_REQUIRED");
  assert.equal(output.missingConfirm.payload.providerCallsPlanned, 0);
  assertSinglePartial(output.missingConfirm.payload);
  assert.equal(fetchCalls.length, 0, "missing confirm must block before universe, historical or spread calls");

  await singleModule.default({ method: "GET", query: { batch: "1" } }, makeResponse("dryRun", output));
  assert.equal(output.dryRun.statusCode, 200);
  assert.equal(output.dryRun.payload.ok, true);
  assert.equal(output.dryRun.payload.dryRun, true);
  assert.equal(output.dryRun.payload.providerCallsPlanned, 0);
  assert.equal(output.dryRun.payload.selectedBatch.selectedAssets, 2);
  assertSinglePartial(output.dryRun.payload);
  assert.equal(countHistoricalOrSpreadCalls(fetchCalls), 0, "dry-run must not call historical or spread providers");

  await singleModule.default(
    { method: "GET", query: { batch: "1", execute: "true", confirm: executionConfirmation } },
    makeResponse("execute", output),
  );
  assert.equal(output.execute.statusCode, 200);
  assert.equal(output.execute.payload.ok, true);
  assert.equal(output.execute.payload.dryRun, false);
  assert.equal(output.execute.payload.providerCallsPlanned, 5);
  assert.equal(output.execute.payload.actualProviderCalls, 5);
  assertSinglePartial(output.execute.payload);
  assert.equal(output.execute.payload.runUpdate, undefined);
}

async function assertNoRunStoreOrAutomation() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase11-1"], "node scripts/validate-phase11-1.mjs");

  const endpointSource = await readFile(join(root, "api/top8-batch-single.js"), "utf8");
  assert.equal(endpointSource.includes("top8RunStore"), false, "single endpoint must not use top8RunStore");
  assert.equal(endpointSource.includes("runId"), false, "single endpoint must not accept or require runId");
  assert.equal(endpointSource.includes("buildUniverseResponse"), true);
  assert.equal(endpointSource.includes("runControlledTop8Pipeline"), true);

  for (const forbidden of ["setInterval(", "setTimeout(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase"]) {
    assert.equal(endpointSource.toLowerCase().includes(forbidden), false, `Forbidden automation/persistence marker found: ${forbidden}`);
  }
}

await assertPhase111EndpointBehavior();
await assertNoRunStoreOrAutomation();

console.log("Phase 11.1 validation OK: single-invocation dry-run, guarded execution, no run store and no automation checks passed.");
