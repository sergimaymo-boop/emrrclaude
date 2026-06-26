import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domainSource = await readFile("shared/types/domain.ts", "utf8");
const panelSource = await readFile("src/components/ScanStatusPanel.tsx", "utf8");
const dashboardSource = await readFile("src/pages/DashboardPage.tsx", "utf8");

assert.match(domainSource, /coveragePercent/);
assert.match(domainSource, /estimatedProviderCalls/);
assert.match(domainSource, /actualProviderCalls/);
// El panel deriva la cobertura de scanState.coveragePercent en la variable local `coverage`
// y la renderiza como "Coverage {coverage}%" (refactor equivalente al inline antiguo). El test
// verifica AMBAS cosas: que el % proviene de scanState.coveragePercent y que se muestra.
assert.match(panelSource, /const coverage =[^\n]*scanState\.coveragePercent/);
assert.match(panelSource, /Coverage \{coverage\}%/);
assert.match(panelSource, /Calls \{scanState\.actualProviderCalls\}\/\{scanState\.estimatedProviderCalls/);
assert.match(dashboardSource, /recommendedNextAction/);

console.log("Cost and progress visible validation OK.");
