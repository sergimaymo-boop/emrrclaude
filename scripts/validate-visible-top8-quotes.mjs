import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import handler from "../api/visible-top8-quotes.js";

const endpointSource = await readFile("api/visible-top8-quotes.js", "utf8");

assert.doesNotMatch(endpointSource, /const VISIBLE_TOP8_ASSETS = \[/);
assert.match(endpointSource, /mode:\s*"PRICE_ENRICHMENT_ONLY"/);
assert.match(endpointSource, /maxAssets:\s*8/);
assert.match(endpointSource, /rankingSource:\s*false/);
assert.match(endpointSource, /operationalDataStatus/);
assert.match(endpointSource, /PRICE_ENRICHMENT_ONLY_NOT_RANKING_SOURCE/);
assert.match(endpointSource, /acceptsExternalSymbols:\s*false/);
assert.match(endpointSource, /universeExecutionAllowed:\s*false/);
assert.match(endpointSource, /fullRunAllowed:\s*false/);
assert.match(endpointSource, /QUERY_NOT_ALLOWED/);
assert.match(endpointSource, /NO_SUBSTITUTE_DATA_USED/);
assert.match(endpointSource, /selectedAssets/);
assert.match(endpointSource, /PROVIDER_SYMBOL_NOT_ALLOWED/);
assert.doesNotMatch(endpointSource, /async function getFinnhubQuote/);
assert.doesNotMatch(endpointSource, /FALLBACK_USED/);
assert.doesNotMatch(endpointSource, /buildQuoteAsset\(asset, cached\.quote, "STALE"\)/);
assert.doesNotMatch(endpointSource, /top8-batch-single|top8Pipeline|universeEngine|execute=true/);

function invoke(query = {}, method = "GET", body) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };

    handler({ method, query, body }, response);
  });
}

const originalEnv = { ...process.env };
process.env.ENABLE_REAL_API_CALLS = "false";

const blocked = await invoke({ symbol: "AAPL" });
assert.equal(blocked.statusCode, 400);
assert.equal(blocked.body.error, "QUERY_NOT_ALLOWED");

const safeGet = await invoke();
assert.equal(safeGet.statusCode, 200);
assert.equal(safeGet.body.assets.length, 0);
assert.equal(safeGet.body.maxAssets, 8);
assert.equal(safeGet.body.acceptsExternalSymbols, false);
assert.equal(safeGet.body.fullRunAllowed, false);
assert.equal(safeGet.body.universeExecutionAllowed, false);
assert.equal(safeGet.body.rankingSource, false);

const postAllowed = await invoke({}, "POST", { selectedTickers: ["META", "AMD", "ASML"] });
assert.equal(postAllowed.statusCode, 400);
assert.equal(postAllowed.body.error, "SELECTED_SNAPSHOT_ASSETS_REQUIRED");

const postSelectedAssets = await invoke({}, "POST", {
  scanId: "scan-test",
  selectedAssets: [
    { ticker: "META", name: "Meta", exchange: "NASDAQ", currency: "USD", providerSymbol: "META.US" },
    { ticker: "AMD", name: "AMD", exchange: "NASDAQ", currency: "USD", providerSymbol: "AMD.US" },
    { ticker: "ASML", name: "ASML", exchange: "EURONEXT", currency: "EUR", providerSymbol: "ASML.AS" },
  ],
});
assert.equal(postSelectedAssets.statusCode, 200);
assert.deepEqual(postSelectedAssets.body.selectedTickers, ["META", "AMD", "ASML"]);
assert.equal(postSelectedAssets.body.scanId, "scan-test");
assert.equal(postSelectedAssets.body.assets.length, 3);
assert.ok(postSelectedAssets.body.assets.every((asset) => asset.provider === "none"));
assert.ok(postSelectedAssets.body.assets.every((asset) => asset.price === null));
assert.ok(postSelectedAssets.body.assets.every((asset) => asset.operationalDataStatus === "DATA_UNAVAILABLE"));
assert.ok(postSelectedAssets.body.assets.every((asset) => asset.operationalDecisionAllowed === false));
assert.ok(postSelectedAssets.body.assets.every((asset) => asset.operationalBlockReasons.includes("NO_SUBSTITUTE_DATA_USED")));

const postBlocked = await invoke({}, "POST", {
  selectedAssets: [{ ticker: "TSLA", providerSymbol: "TSLA/US" }],
});
assert.equal(postBlocked.statusCode, 400);
assert.equal(postBlocked.body.error, "PROVIDER_SYMBOL_NOT_ALLOWED");

process.env.ENABLE_REAL_API_CALLS = originalEnv.ENABLE_REAL_API_CALLS;

console.log("Visible TOP 8 quotes endpoint validation OK.");
