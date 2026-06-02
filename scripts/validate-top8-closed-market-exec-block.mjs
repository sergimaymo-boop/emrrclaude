import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const systemStatusSource = await readFile("src/utils/systemStatus.ts", "utf8");
const refreshSource = await readFile("src/services/realDataRefresh.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");

assert.match(systemStatusSource, /isMarketOpen\(asset\.market\)/);
assert.match(systemStatusSource, /marketStatus !== "OPEN" && asset\.action === "EXEC"/);
assert.match(systemStatusSource, /action:\s*"CLOSED_CONTEXT"/);
assert.match(refreshSource, /asset\.marketStatus !== "OPEN" && asset\.action === "EXEC"/);
assert.match(top8Source, /if \(action === "CLOSED_CONTEXT"\) return "CLOSED"/);
assert.match(top8Source, /asset\.marketStatus === "OPEN" \? "GREEN_SOFT" : "WHITE_GREY"/);

console.log("Closed-market EXEC block validation OK.");
