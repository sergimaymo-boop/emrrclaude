// Orden del ranking sectorial EOD (GET /api/sector-leaders-data sin mode; handler vivo): primero
// por estado LEADING → ACCELERATING → WEAKENING → FALLING y, dentro de cada estado, por
// rendimiento descendente. Un sector sin datos se omite (no se inventa su rendimiento).
// Prueba de comportamiento con las series de Yahoo simuladas en la frontera de red.
// Reescrito 25-sep-2026: el panel SectorLeaders.tsx se retiró del dashboard (8e498c8); la regla
// de orden vive ahora solo en el endpoint (que sigue desplegado y usa backtest-sector-flows.mjs).
import assert from "node:assert/strict";
import { invoke, isolateFromProduction, jsonResponse, repoUrl, setFetchResponder } from "./validate-harness.mjs";

isolateFromProduction();
// Rendimiento a 5 sesiones deseado por ETF (null = el proveedor no devuelve datos).
const performance = { XLK: 1.5, XLF: -3, XLV: 4.2, XLE: 0.2, XLI: 2.5, XLY: -1.2, XLP: -0.4, XLC: -2.5, XLRE: null };
setFetchResponder((url) => {
  const match = url.match(/\/v8\/finance\/chart\/([A-Z]+)\?interval=1d&range=5d/);
  if (!match) return undefined;
  const perf = performance[match[1]];
  if (perf === null || perf === undefined) return jsonResponse({ chart: { result: null } });
  return jsonResponse({ chart: { result: [{ indicators: { quote: [{ close: [100, 100.5, 101, 100.8, 100 * (1 + perf / 100)] }] } }] } });
});

const handler = (await import(repoUrl("api/sector-leaders-data.js"))).default;
const response = await invoke(handler, { method: "GET", query: {} });
assert.equal(response.status, 200);
assert.equal(response.body.ok, true);
const sectors = response.body.sectors;
assert.deepEqual(
  sectors.map((sector) => [sector.symbol, sector.state]),
  [
    ["XLV", "LEADING"], ["XLI", "LEADING"],
    ["XLK", "ACCELERATING"], ["XLE", "ACCELERATING"],
    ["XLP", "WEAKENING"], ["XLY", "WEAKENING"],
    ["XLC", "FALLING"], ["XLF", "FALLING"],
  ],
  "estado primero (LEADING→FALLING) y rendimiento descendente dentro de cada estado",
);
assert.ok(!sectors.some((sector) => sector.symbol === "XLRE"), "sin datos del proveedor el sector se omite");
assert.ok(Math.abs(sectors[0].performance5d - 4.2) < 1e-6, "rendimiento calculado de la serie real");

console.log("Leading sectors order validation OK: estado → rendimiento, sin sectores inventados.");
