import assert from "node:assert/strict";
import { isEligibleForUniverse, mapUniverseAsset } from "../api/_lib/universeEngine.js";

const usExchange = { region: "USA", market: "Nasdaq/NYSE", providerExchange: "US" };

assert.equal(
  isEligibleForUniverse({ Code: "MSFT", Name: "Microsoft", Type: "Common Stock", Exchange: "NASDAQ", Currency: "USD" }, usExchange),
  true,
);
assert.equal(
  isEligibleForUniverse({ Code: "SPY", Name: "SPDR S&P 500 ETF", Type: "ETF", Exchange: "NYSE", Currency: "USD" }, usExchange),
  false,
);
assert.equal(
  isEligibleForUniverse({ Code: "ABC-W", Name: "ABC Warrant", Type: "Common Stock", Exchange: "NASDAQ", Currency: "USD" }, usExchange),
  false,
);
assert.equal(
  isEligibleForUniverse({ Code: "XYZ", Name: "XYZ", Type: "Warrant", Exchange: "NASDAQ", Currency: "USD" }, usExchange),
  false,
);
assert.equal(
  isEligibleForUniverse({ Code: "OTC1", Name: "OTC", Type: "Common Stock", Exchange: "OTC", Currency: "USD" }, usExchange),
  false,
);
assert.equal(
  isEligibleForUniverse({ Code: "OLD", Name: "Old", Type: "Common Stock", Exchange: "NYSE", Currency: "USD", Status: "Delisted" }, usExchange),
  false,
);

const mapped = mapUniverseAsset(
  { Code: "MSFT", Name: "Microsoft", Type: "Common Stock", Exchange: "NASDAQ", Currency: "USD", MarketCapitalization: "1000" },
  usExchange,
);
assert.equal(mapped.operabilityStatus, "OPERABLE");
assert.equal(mapped.marketCapitalization, 1000);

console.log("Universe pre-scan filter validation OK.");
