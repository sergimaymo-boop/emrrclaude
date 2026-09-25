// Mapa de trailings del TOP 8 (MASTER_CODEX_V1.md): Tight = trailing_adjusted = ATR% × 0,65 ·
// Medium = trailing_medium = ATR% × 1,00 · Wide = trailing_wide = ATR% × 1,45.
//   · el motor vivo (api/_lib/scoreEngine.js, calculateDynamicTrailing) aplica esos
//     multiplicadores y bloquea con ATR% inválido;
//   · el dashboard (realDataRefresh.ts) mapea adjusted→trailingAdjusted, medium→trailingMedium,
//     wide→trailingWide sin cruzarlos.
// Reescrito 25-sep-2026: antes comprobaba src/engines/trailingEngine.ts y Top8Grid.tsx, código
// que ya no carga el dashboard (TOP 8 UI desactivada en la consolidación del 24-jul-2026).
import assert from "node:assert/strict";
import { ensureBrowserGlobals, importFrontend, isolateFromProduction, readRepoFile, repoUrl, sampleFinalSnapshot, sampleScanCandidate } from "./validate-harness.mjs";

const master = readRepoFile("MASTER_CODEX_V1.md");
assert.match(master, /Tight = trailing_adjusted = ATR% x 0\.65/);
assert.match(master, /Medium = trailing_medium = ATR% x 1\.00/);
assert.match(master, /Wide = trailing_wide = ATR% x 1\.45/);

const { calculateDynamicTrailing } = await import(repoUrl("api/_lib/scoreEngine.js"));
for (const atrPercent of [1, 2.4, 10]) {
  const trailing = calculateDynamicTrailing(atrPercent);
  assert.ok(Math.abs(trailing.trailing_adjusted - atrPercent * 0.65) < 1e-4, `Tight = ATR% × 0,65 (ATR ${atrPercent})`);
  assert.ok(Math.abs(trailing.trailing_medium - atrPercent * 1.0) < 1e-4, `Medium = ATR% × 1,00 (ATR ${atrPercent})`);
  assert.ok(Math.abs(trailing.trailing_wide - atrPercent * 1.45) < 1e-4, `Wide = ATR% × 1,45 (ATR ${atrPercent})`);
  assert.deepEqual(trailing.blockedReasons, []);
}
for (const invalid of [0, -1, Number.NaN, null]) {
  const trailing = calculateDynamicTrailing(invalid);
  assert.equal(trailing.trailing_adjusted, null);
  assert.deepEqual(trailing.blockedReasons, ["INVALID_ATR_PERCENT"], `ATR% inválido (${invalid}) → sin trailing`);
}

isolateFromProduction();
ensureBrowserGlobals();
const { refresh } = await importFrontend({ refresh: "src/services/realDataRefresh.ts" });
const [asset] = refresh.buildDashboardTop8FromScanSnapshot(sampleFinalSnapshot([
  sampleScanCandidate({ trailing: { trailing_adjusted: 1.3, trailing_medium: 2, trailing_wide: 2.9 } }),
]));
assert.deepEqual([asset.trailingAdjusted, asset.trailingMedium, asset.trailingWide], ["1.30%", "2.00%", "2.90%"], "adjusted/medium/wide sin cruzar");

console.log("Trailing label map validation OK: multiplicadores 0,65/1,00/1,45 y mapeo del dashboard.");
