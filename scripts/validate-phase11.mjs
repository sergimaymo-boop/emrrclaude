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
    date: `2026-02-${String(index + 1).padStart(2, "0")}`,
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

function assertPartialBatch(payload) {
  assert.equal(payload.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(payload.isPartialResult, true);
  assert.equal(payload.isGlobalTop8Final, false);
}

async function assertPhase11SingleBatchGuardrails() {
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
    { method: "GET", query: { batch: "1", execute: "true", runId: "missing-run", confirm: executionConfirmation } },
    makeResponse("missingRun", output),
  );
  assert.equal(output.missingRun.statusCode, 404);
  assert.equal(output.missingRun.payload.error, "RUN_NOT_FOUND");
  assert.equal(output.missingRun.payload.providerCallsPlanned, 0);
  assert.equal(output.missingRun.payload.actualProviderCalls, null);
  assertPartialBatch(output.missingRun.payload);
  assert.equal(fetchCalls.length, 0, "missing run must block before universe, historical or spread calls");

  await batchModule.default({ method: "GET", query: { batch: "1" } }, makeResponse("dryRun", output));
  assert.equal(output.dryRun.statusCode, 200);
  assert.equal(output.dryRun.payload.providerCallsPlanned, 0);
  assert.equal(output.dryRun.payload.fullUniverseExecutionAllowed, false);
  assertPartialBatch(output.dryRun.payload);
  assert.equal(countHistoricalOrSpreadCalls(fetchCalls), 0, "dry-run must not call historical or spread providers");

  await runModule.default({ method: "GET", query: { create: "true" } }, makeResponse("run", output));
  assert.equal(output.run.statusCode, 201);
  assert.equal(output.run.payload.ok, true);
  assert.equal(output.run.payload.run.isGlobalTop8Final, false);

  const runId = output.run.payload.run.runId;
  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId, confirm: executionConfirmation } },
    makeResponse("singleBatch", output),
  );
  assert.equal(output.singleBatch.statusCode, 200);
  assert.equal(output.singleBatch.payload.ok, true);
  assertPartialBatch(output.singleBatch.payload);
  assert.equal(output.singleBatch.payload.actualProviderCalls, 5);

  const callsAfterSingleBatch = fetchCalls.length;
  await batchModule.default(
    { method: "GET", query: { batch: "1", execute: "true", runId, confirm: executionConfirmation } },
    makeResponse("duplicateBatch", output),
  );
  assert.equal(output.duplicateBatch.statusCode, 409);
  assert.equal(output.duplicateBatch.payload.error, "BATCH_ALREADY_ATTACHED");
  assert.equal(fetchCalls.length, callsAfterSingleBatch, "duplicate batch must not spend provider calls");

  await finalModule.default({ method: "GET", query: { runId: "missing-run" } }, makeResponse("missingFinal", output));
  assert.equal(output.missingFinal.statusCode, 404);
  assert.equal(output.missingFinal.payload.error, "RUN_NOT_FOUND");
  assert.equal(output.missingFinal.payload.actualProviderCalls, 0);
}

async function assertPhase11DocsAndNoAutomation() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase11"], "node scripts/validate-phase11.mjs");

  const files = [
    "api/_lib/top8RunStore.js",
    "api/top8-batch.js",
    "api/top8-final.js",
    "README.md",
    "MASTER_CODEX_V1.md",
  ];

  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    assert.equal(source.includes("Vercel") || file.includes("top8-batch") || file.includes("top8-final"), true, `${file} must preserve Vercel/run context`);
  }

  const combinedSource = await Promise.all([
    readFile(join(root, "api/top8-batch.js"), "utf8"),
    readFile(join(root, "api/top8-run.js"), "utf8"),
    readFile(join(root, "api/top8-final.js"), "utf8"),
  ]).then((parts) => parts.join("\n"));

  for (const forbidden of ["setInterval(", "setTimeout(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase"]) {
    assert.equal(combinedSource.toLowerCase().includes(forbidden), false, `Forbidden automation/persistence marker found: ${forbidden}`);
  }
}

await assertPhase11SingleBatchGuardrails();
await assertPhase11DocsAndNoAutomation();

console.log("Phase 11 validation OK: single-batch guardrails, duplicate blocking, dry-run safety and no automation checks passed.");
