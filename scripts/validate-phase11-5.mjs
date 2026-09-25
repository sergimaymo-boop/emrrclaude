// Política de SPREAD (fase 11.5, revisada por los commits 5743776 y 373453a, jun-2026):
// un spread NO verificado bloquea EXEC pero NO el scoring — el activo puede entrar en el TOP 8
// como WATCH/STANDBY (acción diagnóstica), jamás como EXEC. Un spread verificado por encima del
// máximo (0,35 %) o inválido sí bloquea el score. Módulos puros, sin automatización ni persistencia.
// Reescrito 25-sep-2026: la versión anterior exigía la regla ANTIGUA (unverified → fuera del TOP 8).
import assert from "node:assert/strict";
import { buildEligibilityDiagnostics, buildOperationalTop8FromEvaluations, evaluateCandidate } from "../api/_lib/candidateEvaluationEngine.js";
import { validateUniverseEligibility } from "../api/_lib/eligibilityEngine.js";
import { SPREAD_POLICY_STATUS, classifySpreadPolicy } from "../api/_lib/spreadPolicy.js";
import { readRepoFile, syntheticBars } from "./validate-harness.mjs";

const unavailable = { ok: false, provider: "none", providerSymbol: "P115.AS", spreadPercent: null, blockedReason: "SPREAD_NOT_AVAILABLE" };

// ── Clasificación ──
for (const spreadStatus of [unavailable, null]) {
  const policy = classifySpreadPolicy({ spreadPercent: null, spreadStatus });
  assert.equal(policy.verificationStatus, SPREAD_POLICY_STATUS.NOT_VERIFIED);
  assert.equal(policy.diagnosticStatus, SPREAD_POLICY_STATUS.DIAGNOSTIC_ONLY);
  assert.equal(policy.executionPolicy, SPREAD_POLICY_STATUS.BLOCKS_EXEC);
  assert.equal(policy.blocksExecution, true, "sin spread verificado: EXEC bloqueado");
  assert.equal(policy.canGenerateExec, false);
  assert.equal(policy.blocksScore, false, "sin spread verificado: el score NO se bloquea");
  assert.equal(policy.canEnterGlobalTop8, true, "…y puede entrar en el TOP 8 como WATCH");
  assert.deepEqual(policy.allowedNonOperationalActions, ["BLOCKED", "STANDBY", "WATCH_DIAGNOSTIC_ONLY"]);
  assert.deepEqual(policy.prohibitedActions, ["EXEC"]);
  assert.equal(policy.spreadPercent, null);
}
assert.equal(classifySpreadPolicy({ spreadPercent: null, spreadStatus: unavailable }).status, SPREAD_POLICY_STATUS.NOT_AVAILABLE);

const verified = classifySpreadPolicy({ spreadPercent: 0.12, spreadStatus: { ok: true, spreadPercent: 0.12 } });
assert.equal(verified.status, SPREAD_POLICY_STATUS.VERIFIED);
assert.deepEqual([verified.blocksScore, verified.blocksExecution, verified.canEnterGlobalTop8, verified.canGenerateExec], [false, false, true, true]);

const wide = classifySpreadPolicy({ spreadPercent: 0.9, spreadStatus: { ok: true, spreadPercent: 0.9 } });
assert.equal(wide.status, SPREAD_POLICY_STATUS.ABOVE_MAXIMUM);
assert.deepEqual([wide.blocksScore, wide.blocksExecution, wide.canEnterGlobalTop8, wide.canGenerateExec], [true, true, false, false]);

const invalid = classifySpreadPolicy({ spreadPercent: Number.NaN, spreadStatus: null });
assert.equal(invalid.status, SPREAD_POLICY_STATUS.INVALID);
assert.equal(invalid.blocksScore, true);

// ── Elegibilidad ──
const asset = { ticker: "P115", providerSymbol: "P115.US", region: "USA", exchange: "NASDAQ", operabilityStatus: "OPERABLE", operabilityReasons: [] };
const technicalResult = { ok: true, validBars: 300, blockedReasons: [], technicals: { lastClose: 50, avgVolume20: 1_000_000, avgValue20: 50_000_000, atrPercent: 2.4 } };
const eligibility = (spreadPercent, spreadStatus) => validateUniverseEligibility({ asset, technicalResult, spreadPercent, spreadStatus, marketStatus: "OPEN", dataQuality: "GOOD" });

const unverifiedEligibility = eligibility(null, unavailable);
assert.equal(unverifiedEligibility.eligibleForScore, true, "sin spread verificado se puntúa");
assert.equal(unverifiedEligibility.eligibleForExecution, false, "…pero no se ejecuta");
assert.ok(unverifiedEligibility.executionBlockedReasons.includes("SPREAD_NOT_VERIFIED"));
assert.ok(!unverifiedEligibility.blockedReasons.includes("SPREAD_NOT_VERIFIED"));
assert.ok(unverifiedEligibility.warnings.includes("SPREAD_NOT_VERIFIED"));
assert.equal(eligibility(0.1, { ok: true, spreadPercent: 0.1 }).eligibleForExecution, true, "spread verificado + mercado abierto → ejecutable");
const wideEligibility = eligibility(0.9, { ok: true, spreadPercent: 0.9 });
assert.equal(wideEligibility.eligibleForScore, false);
assert.ok(wideEligibility.blockedReasons.includes("SPREAD_ABOVE_PHASE6_MAXIMUM"));

// ── Evaluación completa: WATCH sí, EXEC nunca ──
const evaluation = evaluateCandidate({
  asset, historicalBars: syntheticBars({ dailyPct: 0.3 }), benchmarkBars: syntheticBars({ start: 400, dailyPct: 0.05 }),
  spreadPercent: null, spreadStatus: unavailable, marketStatus: "OPEN", dataQuality: "GOOD",
});
assert.notEqual(evaluation.score, null, "el activo sin spread verificado tiene score");
assert.ok(["WATCH", "STANDBY"].includes(evaluation.action), `acción no operativa (${evaluation.action}), nunca EXEC`);
assert.equal(evaluation.eligibility.spreadPolicy.canGenerateExec, false);
assert.equal(buildOperationalTop8FromEvaluations([evaluation]).length, 1, "entra en el TOP 8 como WATCH");
const diagnostics = buildEligibilityDiagnostics([evaluation]);
assert.equal(diagnostics.passedEligibility, 1);
assert.equal(diagnostics.blocked, 0);

// ── Módulos de política puros ──
const combined = ["api/_lib/spreadPolicy.js", "api/_lib/eligibilityEngine.js", "api/_lib/candidateEvaluationEngine.js"].map(readRepoFile).join("\n").toLowerCase();
for (const forbidden of ["setinterval(", "cron", "worker", "socket", "sqlite", "redis", "supabase", "firebase", "fetch("]) {
  assert.equal(combined.includes(forbidden), false, `marcador de automatización/persistencia/red: ${forbidden}`);
}

console.log("Phase 11.5 validation OK: spread no verificado → WATCH permitido, EXEC bloqueado; spread ancho bloquea el score.");
