// Integración de Rally Leaders (y del laboratorio Rally-Test) en el dashboard:
//   · DashboardPage renderiza <RallyPanel/> y <RallyTestPanel/>; ambos se registran en el bus
//     de scan y el botón grande SCAN EMRR los ejecuta todos (runAllModuleScans), aislando
//     fallos (un módulo que falla no tumba a los demás) — comportamiento probado con el bus real;
//   · los paneles solo aceptan el scan como terminado con isRallyFinal (bucle start → continue);
//   · cada panel habla con SUS endpoints: Rally → /api/rally-scan/*, Rally-Test → /api/rally-test/*;
//   · Rally-Test nunca avisa a los consumidores de producción (RALLY_SCAN_UPDATED_EVENT → banda de
//     alineación y export CarteraIBK), CLAUDE.md §10e.
// Reescrito 25-sep-2026: antes buscaba RallyLeadersPanel.tsx, handleScanRally y un botón
// "SCAN RALLY" que ya no existen (el scan pasa por el bus desde el 11-ago-2026).
import assert from "node:assert/strict";
import { captureFetch, ensureBrowserGlobals, importFrontend, isolateFromProduction, jsonResponse, readRepoFile } from "./validate-harness.mjs";

isolateFromProduction();
ensureBrowserGlobals();

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
assert.match(dashboard, /<RallyPanel\s*\/>/, "el dashboard renderiza Rally Leaders");
assert.match(dashboard, /<RallyTestPanel\s*\/>/, "el dashboard renderiza Rally-Test");
assert.match(dashboard, /await runAllModuleScans\(\)/, "SCAN EMRR ejecuta todos los módulos registrados");

const rallyPanel = readRepoFile("src/components/RallyPanel.tsx");
const testPanel = readRepoFile("src/components/RallyTestPanel.tsx");
assert.match(rallyPanel, /registerModuleScan\("Rally",/, "Rally Leaders se registra en el bus de scan");
assert.match(testPanel, /registerModuleScan\("Rally-Test",/, "Rally-Test se registra en el bus de scan");
for (const [name, source] of [["RallyPanel", rallyPanel], ["RallyTestPanel", testPanel]]) {
  assert.match(source, /while \(mounted\.current && !res\.isRallyFinal && res\.rallyToken\)/, `${name}: continúa hasta isRallyFinal`);
}
assert.match(rallyPanel, /dispatchEvent\(new Event\(RALLY_SCAN_UPDATED_EVENT\)\)/, "Rally Leaders avisa de un scan nuevo");
assert.doesNotMatch(testPanel, /RALLY_SCAN_UPDATED_EVENT/, "Rally-Test NO avisa a la banda de alineación ni al export CarteraIBK");

// ── Bus de scan real: todos los módulos, fallos aislados ──
const { bus, rally, lab } = await importFrontend({
  bus: "src/services/scanBus.ts",
  rally: "src/services/rallyRefresh.ts",
  lab: "src/services/rallyTestRefresh.ts",
});
const ran = [];
const unregisterOk = bus.registerModuleScan("ModOk", async () => { ran.push("ModOk"); });
bus.registerModuleScan("ModFail", async () => { ran.push("ModFail"); throw new Error("boom"); });
bus.registerModuleScan("ModSyncThrow", () => { throw new Error("sync"); });
const results = await bus.runAllModuleScans();
assert.deepEqual(ran.sort(), ["ModFail", "ModOk"]);
assert.deepEqual(results.map(({ name, ok }) => [name, ok]), [["ModOk", true], ["ModFail", false], ["ModSyncThrow", false]], "cada módulo informa su resultado sin tumbar a los demás");
unregisterOk();
assert.ok(!bus.registeredModules().includes("ModOk"), "desmontar des-registra el módulo");

// ── Cada panel con sus endpoints ──
const requests = captureFetch((url) => jsonResponse(url.endsWith("/last") ? { ok: true, top10: [] } : { ok: true, isRallyFinal: true, top10: [] }));
await rally.startRallyScan();
await rally.continueRallyScan("tok-prod");
await rally.fetchLastRallyScan();
await lab.startRallyTestScan();
await lab.continueRallyTestScan("tok-lab");
const routes = requests.map(({ method, url }) => `${method} ${url}`);
assert.deepEqual(routes.slice(0, 3), ["POST /api/rally-scan/start", "POST /api/rally-scan/continue", "GET /api/rally-scan/last"]);
assert.equal(requests[1].body.rallyToken, "tok-prod");
assert.deepEqual(routes.slice(3), ["POST /api/rally-test/start", "POST /api/rally-test/continue"], "Rally-Test usa solo /api/rally-test/*");

console.log("Rally Leaders dashboard panel validation OK: paneles, bus de scan, endpoints propios y aislamiento del laboratorio.");
