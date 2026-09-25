// Un SCAN actualiza el dashboard con datos REALES (DashboardPage.tsx):
//   · estados de "SCAN FULL running…" / "CONTINUE SCAN running…" con isScanning;
//   · el resultado del scan (start/continue) construye el TOP 8 (buildDashboardTop8FromScanSnapshot),
//     el universo/cobertura (mergeScanSnapshotUniverseStatus) y, en paralelo, refresca los
//     Master Indicators; aplica System Status, indicadores, TOP 8 y lastRealDataUpdate;
//   · el panel Fear & Greed se refresca solo (su propio fetch periódico) — ya no depende del scan;
//   · estado vacío por defecto: TOP 8 = [] (nunca una lista de ejemplo); sin rutas mock.
// Reescrito 25-sep-2026: antes exigía setFearGreed({…}) y setSectors(unavailableSectors), cableado
// retirado (F&G se autocarga desde 26b278c y Sector Leaders se eliminó).
import assert from "node:assert/strict";
import { readRepoFile } from "./validate-harness.mjs";

const dashboard = readRepoFile("src/pages/DashboardPage.tsx");
const expectations = [
  [/label: "SCAN FULL running\.\.\.", isScanning: true/, "estado visible mientras corre el SCAN FULL"],
  [/label: "CONTINUE SCAN running\.\.\.", isScanning: true/, "estado visible mientras continúa un scan pausado"],
  [/let snapshot = await startScanSnapshot\(\)/, "arranca el scan real"],
  [/continueScanSnapshot\(snapshot\.snapshotToken/, "continúa el scan real"],
  [/Promise\.allSettled\(\[\s*snapshotResult,\s*fetchMasterIndicators\(\),?\s*\]/, "cada resultado de scan refresca también los indicadores"],
  [/nextTop8 = buildDashboardTop8FromScanSnapshot\(snapshot\)/, "TOP 8 desde el snapshot"],
  [/statusBase = mergeScanSnapshotUniverseStatus\(statusBase, snapshot\)/, "universo y cobertura desde el snapshot"],
  [/coveragePercent: snapshot\.coveragePercent/, "cobertura del snapshot"],
  [/setSystemStatus\(nextSystemStatus\)/, "aplica System Status"],
  [/setMasterIndicators\(nextIndicators\)/, "aplica indicadores"],
  [/setTop8\(nextTop8\)/, "aplica TOP 8"],
  [/lastRealDataUpdate,\s*\n?\s*lastScanClicked: startedAt/, "registra la hora del último dato real"],
];
for (const [pattern, why] of expectations) assert.match(dashboard, pattern, why);
assert.doesNotMatch(dashboard, /runMockScan|refreshed\.top8|refreshed\.fearGreed|lastMockRefresh|MOCK_SCAN|MIXED_REFRESH/);

const fearGreedPanel = readRepoFile("src/components/FearGreedPanel.tsx");
assert.match(fearGreedPanel, /fetch\("\/api\/fear-greed"/, "Fear & Greed se carga de su endpoint real");
assert.match(fearGreedPanel, /setInterval\(load, 4 \* 60_000\)/, "…y se refresca cada 4 min");

assert.match(readRepoFile("src/data/emptyDashboardData.ts"), /unavailableTop8: Top8Asset\[\] = \[\]/, "TOP 8 vacío por defecto");

console.log("Scan updates dashboard validation OK: el scan aplica TOP 8, universo, indicadores y marcas reales.");
