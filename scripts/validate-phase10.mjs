import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

function assertInformationalMetadata(payload) {
  assert.equal(payload.isInformationalOnly, true);
  assert.equal(payload.affectsScore, false);
  assert.equal(payload.affectsRanking, false);
  assert.equal(payload.affectsExec, false);
}

function assertTnxDiagnostic(payload, expectedStatus) {
  assertInformationalMetadata(payload);
  assert.equal(payload.diagnosticStatus, expectedStatus);
  assert.deepEqual(payload.providerSymbolsTried, {
    eodhd: "US10Y.GBOND",
    finnhub: "^TNX",
  });
}

function buildExchangeAssets(count) {
  return Array.from({ length: count }, (_, index) => ({
    Code: `AA${index}`,
    Name: `Alpha ${index}`,
    Type: "Common Stock",
    Exchange: index % 2 === 0 ? "NASDAQ" : "NYSE",
    Currency: "USD",
    Isin: `USAA${index}`,
  }));
}

async function assertTnxControlledDiagnostic() {
  process.env.ENABLE_REAL_API_CALLS = "true";
  process.env.EODHD_API_KEY = "test_key";
  process.env.FINNHUB_API_KEY = "test_key";

  const fetchCalls = [];
  global.fetch = async (url) => {
    const text = String(url);
    fetchCalls.push(text);

    if (text.includes("/exchange-symbol-list/US")) {
      return { ok: true, json: async () => buildExchangeAssets(120) };
    }

    if (text.includes("/exchange-symbol-list/")) {
      return { ok: true, json: async () => [] };
    }

    if (text.includes("US10Y.GBOND")) {
      return { ok: true, json: async () => ({}) };
    }

    if (text.includes("finnhub.io") && text.includes("%5ETNX")) {
      return { ok: true, json: async () => ({ c: 0, pc: 0 }) };
    }

    if (text.includes("eodhd.com/api/real-time/")) {
      return {
        ok: true,
        json: async () => ({
          close: 100,
          previousClose: 99,
          change_p: 1.0101,
        }),
      };
    }

    throw new Error(`Unexpected provider call during Phase 10 validation: ${text}`);
  };

  const quoteModule = await import(fileUrl("api/quote.js"));
  const masterModule = await import(fileUrl("api/master-indicators.js"));
  const top8Module = await import(fileUrl("api/top8.js"));
  const output = {};

  await quoteModule.default({ method: "GET", query: { symbol: "TNX" } }, makeResponse("tnxQuote", output));
  assert.equal(output.tnxQuote.statusCode, 200);
  assert.equal(output.tnxQuote.payload.ok, false);
  assert.equal(output.tnxQuote.payload.quote.symbol, "TNX");
  assert.equal(output.tnxQuote.payload.quote.price, null);
  assert.equal(output.tnxQuote.payload.quote.providerUsed, "none");
  assert.equal(Object.hasOwn(output.tnxQuote.payload.quote, "fallbackUsed"), false);
  assert.equal(output.tnxQuote.payload.quote.dataQuality, "NOT_AVAILABLE");
  assertTnxDiagnostic(output.tnxQuote.payload.quote, "TNX_PROVIDER_UNRESOLVED");

  await quoteModule.default({ method: "GET", query: { symbol: "SPY" } }, makeResponse("spyQuote", output));
  assert.equal(output.spyQuote.statusCode, 200);
  assert.equal(output.spyQuote.payload.ok, true);
  assertInformationalMetadata(output.spyQuote.payload.quote);

  await masterModule.default({ method: "GET", query: {} }, makeResponse("master", output));
  assert.equal(output.master.statusCode, 200);
  assert.equal(output.master.payload.symbols.length, 7);
  assert.deepEqual(output.master.payload.symbols, ["SPY", "LQD", "HYG", "VIX", "VVIX", "TNX", "MOVE"]);
  assert.equal(output.master.payload.indicators.length, 7);

  for (const indicator of output.master.payload.indicators) {
    assertInformationalMetadata(indicator);
  }

  const tnxIndicator = output.master.payload.indicators.find((indicator) => indicator.symbol === "TNX");
  assert.ok(tnxIndicator);
  assert.equal(tnxIndicator.dataQuality, "NOT_AVAILABLE");
  assertTnxDiagnostic(tnxIndicator, "TNX_PROVIDER_UNRESOLVED");

  const callsBeforeTop8 = fetchCalls.length;
  await top8Module.default({ method: "GET", query: {} }, makeResponse("top8", output));
  assert.equal(output.top8.statusCode, 409);
  assert.equal(output.top8.payload.error, "COST_GATE_REQUIRES_BATCHING_STRATEGY");
  assert.equal(output.top8.payload.fullUniverseExecutionAllowed, false);

  const top8Calls = fetchCalls.slice(callsBeforeTop8);
  assert.equal(top8Calls.some((url) => url.includes("US10Y.GBOND") || url.includes("%5ETNX")), false);
  assert.equal(top8Calls.some((url) => url.includes("/api/eod/") || url.includes("/api/real-time/")), false);
}

async function assertNoNewOperationalSurface() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:phase10"], "node scripts/validate-phase10.mjs");

  const files = [
    "api/quote.js",
    "api/master-indicators.js",
    "api/_lib/marketData.ts",
    "shared/types/api.ts",
    "README.md",
    "MASTER_CODEX_V1.md",
  ];

  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    assert.equal(source.includes("isInformationalOnly"), true, `${file} must document informational indicator metadata`);
    assert.equal(source.includes("affectsExec"), true, `${file} must document non-operational indicator metadata`);
  }

  const operationalFiles = await Promise.all(
    [
      "package.json",
      "api/quote.js",
      "api/master-indicators.js",
      "api/top8.js",
    ].map((path) => readFile(join(root, path), "utf8")),
  );
  const combined = operationalFiles.join("\n");
  assert.equal(combined.includes("setInterval("), false);
  assert.equal(combined.includes("cron"), false);
  assert.equal(combined.includes("new Worker("), false);
  assert.equal(combined.includes("sqlite"), false);
}

await assertTnxControlledDiagnostic();
await assertNoNewOperationalSurface();

console.log("Phase 10 validation OK: TNX diagnostic metadata, informational-only indicators and no-cost guardrails passed.");
