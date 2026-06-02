import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const executionConfirmation = "EXECUTE_BATCH";
const pilotTickers = [
  "NVDA.US",
  "MSFT.US",
  "AVGO.US",
  "META.US",
  "GOOGL.US",
  "AMZN.US",
  "LLY.US",
  "JPM.US",
  "ASML.AS",
  "SAP.XETRA",
  "AIR.PA",
  "REL.LSE",
  "PHASE_6_PILOT_ONLY",
];

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

async function assertNoPilotUniverse() {
  const files = [
    "api/_lib/universeEngine.js",
    "api/top8.js",
    "api/top8-batch.js",
    "api/top8-run.js",
    "api/top8-final.js",
    "README.md",
    "MASTER_CODEX_V1.md",
  ];

  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    for (const ticker of pilotTickers) {
      assert.equal(source.includes(ticker), false, `${file} contains forbidden pilot ticker ${ticker}`);
    }
  }
}

async function assertNoAccidentalExecutionSurface() {
  const source = await readFile(join(root, "api/top8-batch.js"), "utf8");
  assert.equal(source.includes("EXECUTION_CONFIRMATION_REQUIRED"), true);
  assert.equal(source.includes(`confirm=${executionConfirmation}`), true);
  assert.equal(source.includes("confirm").valueOf(), true);
}

async function assertPhase7BatchHardening() {
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
  const output = {};

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId: "fake-run" } },
    makeResponse("missingConfirm", output),
  );
  assert.equal(output.missingConfirm.statusCode, 400);
  assert.equal(output.missingConfirm.payload.error, "EXECUTION_CONFIRMATION_REQUIRED");
  assert.equal(output.missingConfirm.payload.providerCallsPlanned, 0);
  assert.equal(fetchCalls.length, 0, "missing confirm must not call providers or universe discovery");

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", confirm: executionConfirmation } },
    makeResponse("missingRunId", output),
  );
  assert.equal(output.missingRunId.statusCode, 400);
  assert.equal(output.missingRunId.payload.error, "RUN_ID_REQUIRED_FOR_EXECUTION");
  assert.equal(fetchCalls.length, 0, "missing runId must not call providers or universe discovery");

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId: "missing-run", confirm: executionConfirmation } },
    makeResponse("missingRun", output),
  );
  assert.equal(output.missingRun.statusCode, 404);
  assert.equal(output.missingRun.payload.error, "RUN_NOT_FOUND");
  assert.equal(fetchCalls.length, 0, "missing run must not call providers or universe discovery");

  await batchModule.default({ method: "GET", query: { batch: "1" } }, makeResponse("dryRun", output));
  assert.equal(output.dryRun.statusCode, 200);
  assert.equal(output.dryRun.payload.dryRun, true);
  assert.equal(output.dryRun.payload.providerCallsPlanned, 0);
  assert.equal(countHistoryOrSpreadCalls(fetchCalls), 0, "dry run must not call historical or spread providers");

  await runModule.default({ method: "GET", query: { create: "true" } }, makeResponse("run", output));
  assert.equal(output.run.statusCode, 201);
  assert.equal(output.run.payload.ok, true);

  const runId = output.run.payload.run.runId;
  await finalModule.default({ method: "GET", query: { runId } }, makeResponse("earlyFinal", output));
  assert.equal(output.earlyFinal.statusCode, 409);
  assert.equal(output.earlyFinal.payload.error, "RUN_NOT_COMPLETE");

  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId, confirm: executionConfirmation } },
    makeResponse("batch", output),
  );
  assert.equal(output.batch.statusCode, 200);
  assert.equal(output.batch.payload.ok, true);
  assert.equal(output.batch.payload.assets.length, 2);
  assert.equal(output.batch.payload.runUpdate.ok, true);

  const callsAfterFirstBatch = fetchCalls.length;
  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId, confirm: executionConfirmation } },
    makeResponse("duplicateBatch", output),
  );
  assert.equal(output.duplicateBatch.statusCode, 409);
  assert.equal(output.duplicateBatch.payload.error, "BATCH_ALREADY_ATTACHED");
  assert.equal(fetchCalls.length, callsAfterFirstBatch, "duplicate batch must not call providers");

  await finalModule.default({ method: "GET", query: { runId } }, makeResponse("final", output));
  assert.equal(output.final.statusCode, 200);
  assert.equal(output.final.payload.ok, true);
  assert.equal(output.final.payload.run.isGlobalTop8Final, true);

  await finalModule.default(
    { method: "GET", query: { runId, symbol: "AAPL" } },
    makeResponse("badFinalQuery", output),
  );
  assert.equal(output.badFinalQuery.statusCode, 400);
  assert.equal(output.badFinalQuery.payload.error, "QUERY_NOT_ALLOWED");
}

await assertNoPilotUniverse();
await assertNoAccidentalExecutionSurface();
await assertPhase7BatchHardening();

console.log("Phase 7 validation OK: execution confirmation, dry-run safety, run finalization and guardrails passed.");
