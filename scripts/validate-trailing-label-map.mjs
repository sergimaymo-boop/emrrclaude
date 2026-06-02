import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const master = await readFile("MASTER_CODEX_V1.md", "utf8");
const trailingSource = await readFile("src/engines/trailingEngine.ts", "utf8");
const top8Source = await readFile("src/components/Top8Grid.tsx", "utf8");

assert.match(master, /Tight = trailing_adjusted = ATR% x 0\.65/);
assert.match(master, /Medium = trailing_medium = ATR% x 1\.00/);
assert.match(master, /Wide = trailing_wide = ATR% x 1\.45/);
assert.match(trailingSource, /TRAILING_ADJUSTED_MULTIPLIER = 0\.65/);
assert.match(trailingSource, /TRAILING_MEDIUM_MULTIPLIER = 1/);
assert.match(trailingSource, /TRAILING_WIDE_MULTIPLIER = 1\.45/);
assert.match(top8Source, /Tight <b>\{asset\.trailingAdjusted\}/);
assert.match(top8Source, /Medium <b>\{asset\.trailingMedium\}/);
assert.match(top8Source, /Wide <b>\{asset\.trailingWide\}/);

console.log("Trailing label map validation OK.");
