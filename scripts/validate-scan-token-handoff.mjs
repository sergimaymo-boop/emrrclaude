// INV-06: los tokens de continuación van firmados con HMAC y se verifican antes de continuar.
// Prueba el camino VIVO (signStateToken/verifyStateToken, usado por api/scan-snapshot.js y
// api/rally-scan.js) — reescrito 25-sep-2026: antes probaba encode/decodeScanSnapshotToken,
// helpers legacy que ningún endpoint usa ya.
//   · Con SCAN_SNAPSHOT_SIGNING_SECRET: firma obligatoria; firma alterada, payload alterado,
//     token sin firma o firmado con otro secreto → 400 sin procesar ningún batch.
//   · Sin el secreto: modo compat declarado (tokenSigning UNSIGNED_FALLBACK + aviso), nunca silencioso.
//   · Rally: un token de Rally-Test nunca vale en producción ni al revés (versión de token).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { invoke, prepareScanFixtures, repoUrl } from "./validate-harness.mjs";

const fixture = await prepareScanFixtures();
const scanHandler = (await import(repoUrl("api/scan-snapshot.js"))).default;
const rallyHandler = (await import(repoUrl("api/rally-scan.js"))).default;
const { verifyStateToken } = await import(repoUrl("api/_lib/scanSnapshot.js"));

const post = (handler, action, body) => invoke(handler, { method: "POST", query: { action }, body });
const reencode = (payloadB64, mutate) => {
  const state = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  mutate(state);
  return Buffer.from(JSON.stringify(state)).toString("base64url");
};

// ── Con secreto configurado: firma exigida ──
process.env.SCAN_SNAPSHOT_SIGNING_SECRET = "validator-signing-secret";
const start = await post(scanHandler, "start", { batchSize: 50 });
assert.equal(start.status, 206);
assert.equal(start.body.tokenSigning, "SIGNED");
const token = start.body.snapshotToken;
const dot = token.lastIndexOf(".");
assert.ok(dot > 0, "token firmado = payload.firma");
const payloadB64 = token.slice(0, dot);
const signature = token.slice(dot + 1);
assert.equal(verifyStateToken(token).ok, true);
assert.equal(verifyStateToken(token).verified, true);

// Se altera un carácter CENTRAL: el último de un HMAC base64url de 43 caracteres lleva bits
// de relleno y cambiarlo puede decodificar a los mismos bytes (falso positivo intermitente).
const forgedSignature = `${payloadB64}.${signature.slice(0, 10)}${signature[10] === "A" ? "Q" : "A"}${signature.slice(11)}`;
const forgedPayload = `${reencode(payloadB64, (state) => { state.nextBatchIndex = state.batchesTotal - 1; state.batchesCompleted = state.batchesTotal - 1; })}.${signature}`;
const unsigned = payloadB64;
const otherSecret = `${payloadB64}.${createHmac("sha256", "attacker-secret").update(payloadB64).digest("base64url")}`;

const callsBefore = fixture.historyCalls.length;
for (const [label, badToken, expectedError] of [
  ["firma alterada", forgedSignature, "TOKEN_INVALID_SIGNATURE"],
  ["payload alterado con la firma original", forgedPayload, "TOKEN_INVALID_SIGNATURE"],
  ["token sin firma", unsigned, "TOKEN_UNSIGNED"],
  ["firmado con otro secreto", otherSecret, "TOKEN_INVALID_SIGNATURE"],
]) {
  const response = await post(scanHandler, "continue", { snapshotToken: badToken });
  assert.equal(response.status, 400, `${label} → 400`);
  assert.equal(response.body.ok, false, `${label} → ok:false`);
  assert.equal(response.body.error, expectedError, `${label} → ${expectedError}`);
}
assert.equal(fixture.historyCalls.length, callsBefore, "un token rechazado no procesa ningún batch");

const genuine = await post(scanHandler, "continue", { snapshotToken: token });
assert.equal(genuine.status, 206, "el token legítimo continúa");
assert.equal(genuine.body.batchesCompleted, 2);
assert.equal(genuine.body.tokenSigning, "SIGNED");

// Rally: firma exigida también, y la versión del token separa producción de laboratorio.
const rallyStart = await post(rallyHandler, "start", {});
const testStart = await post(rallyHandler, "test-start", {});
assert.equal(rallyStart.body.tokenSigning, "SIGNED");
assert.equal(testStart.body.tokenSigning, "SIGNED");
const rallyToken = rallyStart.body.rallyToken;
const tamperedRally = `${rallyToken.slice(0, rallyToken.lastIndexOf("."))}.${"A".repeat(43)}`;
assert.equal((await post(rallyHandler, "continue", { rallyToken: tamperedRally })).status, 400, "token de Rally alterado → 400");
const crossToLab = await post(rallyHandler, "test-continue", { rallyToken });
assert.equal(crossToLab.status, 400);
assert.equal(crossToLab.body.error, "INVALID_TOKEN_VERSION", "un token de producción no continúa un scan de Rally-Test");
const crossToProd = await post(rallyHandler, "continue", { rallyToken: testStart.body.rallyToken });
assert.equal(crossToProd.status, 400);
assert.equal(crossToProd.body.error, "INVALID_TOKEN_VERSION", "un token de Rally-Test no continúa un scan de producción");

// ── Sin secreto: modo compat EXPLÍCITO ──
delete process.env.SCAN_SNAPSHOT_SIGNING_SECRET;
const fallback = await post(scanHandler, "start", { batchSize: 50 });
assert.equal(fallback.body.tokenSigning, "UNSIGNED_FALLBACK");
assert.match(fallback.body.signingWarning ?? "", /SCAN_SNAPSHOT_SIGNING_SECRET/, "el modo sin firma debe avisarse en la respuesta");
const fallbackContinue = await post(scanHandler, "continue", { snapshotToken: fallback.body.snapshotToken });
assert.equal(fallbackContinue.body.tokenSigning, "UNSIGNED_FALLBACK");

console.log("Scan token handoff validation OK: HMAC exigido con secreto, forjas rechazadas y fallback declarado.");
