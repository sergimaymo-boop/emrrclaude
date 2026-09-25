import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");
const emptyDataSource = await readFile("src/data/emptyDashboardData.ts", "utf8");
const panelSource = await readFile("src/components/FearGreedPanel.tsx", "utf8");

assert.match(emptyDataSource, /unavailableFearGreed/);
assert.match(emptyDataSource, /dataMode:\s*"ERROR"/);
assert.match(emptyDataSource, /source:\s*"none"/);
assert.match(emptyDataSource, /affectsScore:\s*false/);
assert.match(emptyDataSource, /affectsRanking:\s*false/);
assert.match(emptyDataSource, /affectsExec:\s*false/);
assert.match(emptyDataSource, /operationalDataStatus:\s*"DATA_UNAVAILABLE"/);
assert.match(emptyDataSource, /NO_APPROVED_REAL_FEAR_GREED_SOURCE/);
assert.doesNotMatch(dashboardSource, /refreshFearGreed|MOCK/);
// 25-sep-2026: el panel dice "No disponible" (y "fallo de la fuente" si falló la petición) — nunca un 50 inventado.
assert.match(panelSource, /No disponible \(fallo de la fuente\)/);
assert.doesNotMatch(panelSource, /MOCK/);

console.log("Fear & Greed refresh validation OK.");
