// Endpoint de cotizaciones visibles (api/visible-top8-quotes.js): SOLO enriquece con precio los
// activos que ya rankeó un scan — nunca propone una lista propia ni autoriza EXEC.
//   · sin query; GET no expone lista sustituta; POST exige selectedAssets del snapshot;
//     símbolos con formato inválido → PROVIDER_SYMBOL_NOT_ALLOWED; tope de activos declarado y aplicado;
//   · sin API real: DATA_UNAVAILABLE, precio null, provider none, sin datos sustitutos;
//   · con API real: precio real del proveedor o DATA_UNAVAILABLE si falla (nunca un relleno);
//     ningún activo sale operativo desde aquí.
// Reescrito 25-sep-2026: el tope pasó de 8 a 12 (top-10 de FABLE) y el error a
// MAX_VISIBLE_QUOTES_EXCEEDED; la versión anterior fijaba maxAssets: 8 por texto.
import assert from "node:assert/strict";
import { assertEnvelope, invoke, isolateFromProduction, repoUrl, stubModules } from "./validate-harness.mjs";

isolateFromProduction();
const cascadeCalls = [];
await stubModules({
  "api/_lib/providerCascade.js": {
    cascadeQuote: async (symbol) => {
      cascadeCalls.push(symbol);
      return symbol === "META.US"
        ? { ok: true, provider: "Finnhub", price: 612.5, previousClose: 600, changePercent: 2.08 }
        : { ok: false, reason: "ALL_PROVIDERS_FAILED", triedProviders: [] };
    },
  },
});
const handler = (await import(repoUrl("api/visible-top8-quotes.js"))).default;
const post = (body) => invoke(handler, { method: "POST", query: {}, body });
const asset = (ticker, providerSymbol, exchange = "NASDAQ") => ({ ticker, name: ticker, exchange, currency: "USD", providerSymbol });
const selected = [asset("META", "META.US"), asset("AMD", "AMD.US"), asset("ASML", "ASML.AS", "EURONEXT")];

// ── Contrato con la API real apagada ──
delete process.env.ENABLE_REAL_API_CALLS;
const withQuery = await invoke(handler, { method: "GET", query: { symbol: "AAPL" } });
assert.equal(withQuery.status, 400);
assert.equal(withQuery.body.error, "QUERY_NOT_ALLOWED");

const safeGet = await invoke(handler, { method: "GET", query: {} });
assertEnvelope(safeGet, "GET");
assert.equal(safeGet.status, 200);
assert.deepEqual(safeGet.body.assets, [], "GET no expone ninguna lista sustituta");
assert.equal(safeGet.body.mode, "PRICE_ENRICHMENT_ONLY");
assert.equal(safeGet.body.rankingSource, false);
assert.equal(safeGet.body.acceptsExternalSymbols, false);
assert.equal(safeGet.body.fullRunAllowed, false);
assert.equal(safeGet.body.universeExecutionAllowed, false);
const maxAssets = safeGet.body.maxAssets;
assert.ok(Number.isInteger(maxAssets) && maxAssets >= 8 && maxAssets <= 12, `tope declarado razonable (${maxAssets})`);

assert.equal((await invoke(handler, { method: "PUT", query: {} })).status, 405);
const tickersOnly = await post({ selectedTickers: ["META", "AMD"] });
assert.equal(tickersOnly.status, 400);
assert.equal(tickersOnly.body.error, "SELECTED_SNAPSHOT_ASSETS_REQUIRED");
for (const bad of ["TSLA/US", "TSLA", "TSLA.US,AAPL.US", "TSLA.US?x=1"]) {
  const response = await post({ selectedAssets: [asset("TSLA", bad)] });
  assert.equal(response.status, 400, `${bad} → 400`);
  assert.equal(response.body.error, "PROVIDER_SYMBOL_NOT_ALLOWED");
}
const tooMany = await post({ selectedAssets: Array.from({ length: maxAssets + 1 }, (_, index) => asset(`T${index}`, `T${index}.US`)) });
assert.equal(tooMany.status, 400);
assert.equal(tooMany.body.error, "MAX_VISIBLE_QUOTES_EXCEEDED", "el tope declarado se aplica");

const disabled = await post({ scanId: "scan-test", selectedAssets: selected });
assert.equal(disabled.status, 200);
assert.equal(disabled.body.scanId, "scan-test");
assert.deepEqual(disabled.body.selectedTickers, ["META", "AMD", "ASML"]);
for (const item of disabled.body.assets) {
  assert.equal(item.provider, "none");
  assert.equal(item.price, null, "sin API real no hay precio");
  assert.equal(item.operationalDataStatus, "DATA_UNAVAILABLE");
  assert.equal(item.operationalDecisionAllowed, false);
  assert.ok(item.operationalBlockReasons.includes("NO_SUBSTITUTE_DATA_USED"));
}
assert.equal(cascadeCalls.length, 0, "sin API real no se llama a proveedores");

// ── Con API real ──
process.env.ENABLE_REAL_API_CALLS = "true";
const live = await post({ scanId: "scan-test", selectedAssets: selected });
const byTicker = Object.fromEntries(live.body.assets.map((item) => [item.ticker, item]));
assert.equal(byTicker.META.price, 612.5);
assert.equal(byTicker.META.dataMode, "REAL");
assert.equal(byTicker.META.provider, "Finnhub");
assert.equal(byTicker.META.operationalDecisionAllowed, false, "una cotización nunca autoriza EXEC por sí sola");
assert.ok(byTicker.META.operationalBlockReasons.includes("PRICE_ENRICHMENT_ONLY_NOT_RANKING_SOURCE"));
assert.equal(byTicker.AMD.price, null, "proveedor caído → sin precio de relleno");
assert.equal(byTicker.AMD.operationalDataStatus, "DATA_UNAVAILABLE");
assert.equal((await post({ selectedAssets: [selected[0]] })).body.assets[0].cacheStatus, "HIT", "caché de 60 s por ticker");

console.log("Visible TOP 8 quotes endpoint validation OK: solo enriquecimiento de precio, sin sustitutos ni EXEC.");
