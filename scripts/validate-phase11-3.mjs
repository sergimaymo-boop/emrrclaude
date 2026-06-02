import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runControlledTop8Pipeline } from "../api/_lib/top8Pipeline.js";

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

function buildBenchmarkBars() {
  return Array.from({ length: 70 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    open: 400 + index,
    high: 405 + index,
    low: 398 + index,
    close: 402 + index,
    volume: 10_000_000 + index,
  }));
}

function buildCandidateAssets(count = 25) {
  return Array.from({ length: count }, (_, index) => ({
    canonicalId: `NASDAQ:PHASE113${index}:USD`,
    ticker: `P113${index}`,
    providerSymbol: `P113${index}.US`,
    name: `Phase 11.3 Diagnostic ${index}`,
    region: "USA",
    market: "Nasdaq/NYSE",
    providerExchange: "US",
    exchange: "NASDAQ",
    currency: "USD",
    isin: `USPHASE113${String(index).padStart(3, "0")}`,
    instrumentType: "Common Stock",
    operabilityStatus: "OPERABLE",
    operabilityReasons: ["OPERABLE_COMMON_EQUITY_METADATA"],
  }));
}

function countHistoricalOrSpreadCalls(calls) {
  return calls.filter((url) => url.includes("/api/eod/") || url.includes("/api/real-time/")).length;
}

async function assertPipelineAggregatesBlockingReasons() {
  const assets = buildCandidateAssets();
  const pipeline = await runControlledTop8Pipeline({
    assets,
    maxCandidatesPerRun: 25,
    marketStatus: "UNKNOWN",
    dataQuality: "GOOD",
    fetchHistoricalBars: async (providerSymbol) => {
      if (providerSymbol === "SPY.US") {
        return { ok: true, provider: "MOCK", providerSymbol, bars: buildBenchmarkBars(), barCount: 70 };
      }

      return {
        ok: false,
        provider: "MOCK",
        providerSymbol,
        bars: [],
        blockedReason: "PROVIDER_HISTORY_NO_VALID_BARS",
      };
    },
    fetchSpread: async (providerSymbol) => ({
      ok: false,
      provider: "MOCK",
      providerSymbol,
      spreadPercent: null,
      blockedReason: "SPREAD_NOT_AVAILABLE",
    }),
  });

  assert.equal(pipeline.ok, false);
  assert.equal(pipeline.error, "NO_ELIGIBLE_ASSETS_AFTER_VALIDATION");
  assert.equal(pipeline.providerCallsPlanned, 51);
  assert.equal(pipeline.summary.analyzed, 25);
  assert.equal(pipeline.summary.eligibleForScore, 0);
  assert.equal(pipeline.summary.blocked, 25);
  assert.equal(pipeline.assets.length, 0);

  const diagnostics = pipeline.eligibilityDiagnostics;
  assert.equal(diagnostics.eligibilityDiagnosticsAvailable, true);
  assert.equal(diagnostics.diagnosticMode, "PIPELINE_EVALUATION");
  assert.equal(diagnostics.requiresRealExecutionForPerAssetReasons, false);
  assert.equal(diagnostics.analyzed, 25);
  assert.equal(diagnostics.eligibleForScore, 0);
  assert.equal(diagnostics.blocked, 25);
  assert.equal(diagnostics.blockingReasonCounts.INSUFFICIENT_HISTORY, 25);
  assert.equal(diagnostics.blockingReasonCounts.SPREAD_NOT_VERIFIED, 25);
  assert.equal(diagnostics.providerReasonCounts.PROVIDER_HISTORY_NO_VALID_BARS, 25);
  assert.equal(diagnostics.providerReasonCounts.SPREAD_NOT_AVAILABLE, 25);
  assert.equal(diagnostics.perAssetBlockedReasons.length, 25);
  assert.equal(diagnostics.perAssetBlockedReasons[0].eligibleForScore, false);
  assert.equal(diagnostics.perAssetBlockedReasons[0].history.ok, false);
  assert.equal(diagnostics.perAssetBlockedReasons[0].spread.ok, false);
  assert.ok(diagnostics.rootCauseCandidates.length > 0);
}

async function assertSingleDryRunDocumentsDiagnosticLimits() {
  process.env.ENABLE_REAL_API_CALLS = "true";
  process.env.EODHD_API_KEY = "test_key";

  const fetchCalls = [];
  global.fetch = async (url) => {
    const text = String(url);
    fetchCalls.push(text);

    if (text.includes("/exchange-symbol-list/US")) {
      return {
        ok: true,
        json: async () =>
          buildCandidateAssets().map((asset) => ({
            Code: asset.ticker,
            Name: asset.name,
            Type: "Common Stock",
            Exchange: "NASDAQ",
            Currency: "USD",
            Isin: asset.isin,
          })),
      };
    }

    if (text.includes("/exchange-symbol-list/")) {
      return { ok: true, json: async () => [] };
    }

    throw new Error(`Unexpected provider call in dry-run: ${text}`);
  };

  const singleModule = await import(fileUrl("api/top8-batch-single.js"));
  const output = {};

  await singleModule.default({ method: "GET", query: { batch: "1" } }, makeResponse("dryRun", output));

  assert.equal(output.dryRun.statusCode, 200);
  assert.equal(output.dryRun.payload.ok, true);
  assert.equal(output.dryRun.payload.dryRun, true);
  assert.equal(output.dryRun.payload.providerCallsPlanned, 0);
  assert.equal(output.dryRun.payload.eligibilityDiagnosticsAvailable, false);
  assert.equal(output.dryRun.payload.diagnosticMode, "DRY_RUN_COST_METADATA_ONLY");
  assert.equal(output.dryRun.payload.requiresRealExecutionForPerAssetReasons, true);
  assert.equal(output.dryRun.payload.lastRealRunSummary.error, "NO_ELIGIBLE_ASSETS_AFTER_VALIDATION");
  assert.equal(output.dryRun.payload.lastRealRunSummary.evaluationSummary.blocked, 25);
  assert.equal(output.dryRun.payload.resultScope, "PARTIAL_BATCH_ONLY");
  assert.equal(output.dryRun.payload.isPartialResult, true);
  assert.equal(output.dryRun.payload.isGlobalTop8Final, false);
  assert.equal(output.dryRun.payload.fullUniverseExecutionAllowed, false);
  assert.equal(countHistoricalOrSpreadCalls(fetchCalls), 0, "dry-run must not call history or spread providers");
}

async function assertNoNewExecutionOrPersistenceSurface() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase11-3"], "node scripts/validate-phase11-3.mjs");

  const endpointSource = await readFile(join(root, "api/top8-batch-single.js"), "utf8");
  const pipelineSource = await readFile(join(root, "api/_lib/top8Pipeline.js"), "utf8");
  const diagnosticSource = await readFile(join(root, "api/_lib/candidateEvaluationEngine.js"), "utf8");

  assert.equal(endpointSource.includes("top8RunStore"), false, "single endpoint must not use run store");
  assert.equal(endpointSource.includes("lastRealRunSummary"), true);
  assert.equal(pipelineSource.includes("buildEligibilityDiagnostics"), true);
  assert.equal(diagnosticSource.includes("perAssetBlockedReasons"), true);

  const combinedSource = `${endpointSource}\n${pipelineSource}\n${diagnosticSource}`.toLowerCase();
  for (const forbidden of ["setinterval(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase"]) {
    assert.equal(combinedSource.includes(forbidden), false, `Forbidden automation/persistence marker found: ${forbidden}`);
  }
}

await assertPipelineAggregatesBlockingReasons();
await assertSingleDryRunDocumentsDiagnosticLimits();
await assertNoNewExecutionOrPersistenceSurface();

console.log("Phase 11.3 validation OK: eligibility diagnostics, dry-run limits and no new execution surface checks passed.");
