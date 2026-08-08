/**
 * SP500 — handler servido vía /api/market-data?source=sp500 (rewrite: /api/sp500).
 *
 * NO añade ninguna Serverless Function: las 12 del plan Vercel ya están ocupadas,
 * así que se engancha al dispatcher existente igual que optimal2026.
 *
 * INDEPENDENCIA: clave KV propia (`sp500_signal_v1`), motor propio (sp500Engine.js)
 * y ningún acceso al estado de OPTIMAL SUPREME. Calcula bajo demanda a partir del
 * histórico del índice — no depende de que se haya lanzado el scan de Amplitud.
 */

import { kvGet, kvSet } from "./kvStorage.js";
import { cascadeHistory } from "./providerCascade.js";
import { computeSp500Signal, SP500_PROFILES } from "./sp500Engine.js";

const APP_NAME = "EMRR 2.0 / SP500";
const SP500_KEY = "sp500_signal_v1";
const CACHE_TTL_SECONDS = 6 * 3600;      // se recalcula como mucho cada 6 h
const FRESH_MS = 3 * 3600 * 1000;        // se sirve de caché si tiene menos de 3 h
const LOOKBACK_DAYS = 500;               // ≈ 345 sesiones: cubre los 252 del momento

function getEnv() {
  return globalThis.process?.env ?? {};
}

export async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED", app: APP_NAME });
  }

  const q = req.query ?? {};
  const profile = SP500_PROFILES[q.profile] ? q.profile : "EQUILIBRADO";
  const force = q.force === "1" || q.force === "true";

  // 1) caché reciente
  if (!force) {
    try {
      const cached = await kvGet(SP500_KEY);
      const age = cached?.computedAtUtc ? Date.now() - Date.parse(cached.computedAtUtc) : Infinity;
      if (cached?.ok && age < FRESH_MS && cached.profile === profile) {
        return res.status(200).json({ ...cached, app: APP_NAME, servedFrom: "cache", ageMinutes: Math.round(age / 60000), retrievedAtUtc: new Date().toISOString() });
      }
    } catch {
      // una caché ilegible nunca debe tumbar el módulo: se sigue y se recalcula
    }
  }

  // 2) histórico del índice por la cascada de proveedores ya existente
  let history;
  try {
    history = await cascadeHistory("SPY.US", LOOKBACK_DAYS, getEnv());
  } catch (e) {
    return res.status(502).json({ ok: false, app: APP_NAME, error: "HISTORY_FETCH_FAILED", message: e?.message ?? "Fallo al pedir el histórico", timestampUtc: new Date().toISOString() });
  }
  if (!history?.ok || !Array.isArray(history.bars) || !history.bars.length) {
    return res.status(502).json({
      ok: false, app: APP_NAME, error: "NO_HISTORY",
      message: "Ningún proveedor devolvió histórico del S&P 500.",
      triedProviders: history?.triedProviders ?? [],
      timestampUtc: new Date().toISOString(),
    });
  }

  // 3) señal
  const previous = force ? null : await kvGet(SP500_KEY).catch(() => null);
  const signal = computeSp500Signal(history.bars, { profile, previousSignal: previous?.ok ? previous : null });

  if (!signal.ok) {
    return res.status(422).json({
      ...signal, app: APP_NAME,
      dataProvider: history.provider ?? null,
      timestampUtc: new Date().toISOString(),
    });
  }

  const payload = { ...signal, dataProvider: history.provider ?? null, servedFrom: "computed" };
  try {
    await kvSet(SP500_KEY, payload, CACHE_TTL_SECONDS);
  } catch {
    // si KV falla, la respuesta sigue siendo válida — solo se pierde la caché
  }

  return res.status(200).json({ ...payload, app: APP_NAME, retrievedAtUtc: new Date().toISOString() });
}
