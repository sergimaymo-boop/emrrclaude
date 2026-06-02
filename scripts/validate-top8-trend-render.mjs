import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");
const cssSource = await readFile("src/styles.css", "utf8");

const trendCssMatch = cssSource.match(/\.trend-line strong\s*\{[\s\S]*?\}/);
assert.ok(trendCssMatch, "trend-line strong CSS block missing");
const trendCss = trendCssMatch[0];

assert.match(top8Source, /label:\s*asset\.action === "EXEC" \? "Bull Strong" : "Bullish"/);
assert.match(top8Source, /label:\s*"EMA20 > EMA50"/);
assert.match(top8Source, /title=\{trendDisplay\.title\}/);
assert.doesNotMatch(top8Source, />\{displayTrend\(asset\)\}</);

assert.match(trendCss, /overflow:\s*visible/);
assert.match(trendCss, /text-overflow:\s*clip/);
assert.match(trendCss, /white-space:\s*normal/);
assert.doesNotMatch(trendCss, /text-overflow:\s*ellipsis/);

console.log("TOP 8 trend render validation OK.");
