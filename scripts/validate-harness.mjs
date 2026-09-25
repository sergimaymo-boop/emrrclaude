// Arnés compartido de los validadores de comportamiento (25-sep-2026).
//
// POR QUÉ EXISTE: la mitad de la suite validate-*.mjs se pudrió porque comprobaba TEXTO de
// ficheros que ya no existen (api/top8.js, api/rally-scan/start.js, SectorLeaders.tsx…) y
// otra parte "pasaba" probando código MUERTO (buildSnapshotPlan/processNextSnapshotBatch de
// scanSnapshot.js, que el endpoint vivo ya no llama). Este arnés permite probar el código
// VIVO por su comportamiento: se invoca el handler real de api/ con req/res simulados y se
// sustituyen SOLO sus fronteras con el exterior (proveedores de datos y Redis).
//
// GARANTÍAS (las comprueba este mismo fichero cuando se ejecuta como validador):
//   · Cero red: `isolateFromProduction()` reemplaza fetch por uno que LANZA ante cualquier
//     URL que el validador no haya respondido explícitamente.
//   · Cero Redis de producción: borra KV_REST_API_URL/TOKEN (y claves de proveedores) del
//     entorno del proceso; además kvStorage se sustituye por un doble en memoria.
//   · Los dobles se enganchan en la frontera de MÓDULO (registerHooks de node:module), no en
//     el formato HTTP de Yahoo/Finnhub: los cambios en providerCascade.js no rompen estos
//     validadores mientras las funciones exportadas mantengan su contrato.
//
// USO: importar las utilidades desde otro validate-*.mjs. Ejecutarlo directamente
// (`node scripts/validate-harness.mjs`) corre su autocomprobación.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoPath = (relativePath) => join(ROOT, relativePath);
export const repoUrl = (relativePath) => pathToFileURL(repoPath(relativePath)).href;
export const readRepoFile = (relativePath) => readFileSync(repoPath(relativePath), "utf8");

// ─── 1. Aislamiento: ni red ni Redis de producción ───────────────────────────
const SECRET_ENV_KEYS = [
  "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN", "KV_URL",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "REDIS_URL",
  "FINNHUB_API_KEY", "EODHD_API_KEY", "TWELVE_DATA_API_KEY", "FMP_API_KEY", "FRED_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "CRON_SECRET", "SCAN_SNAPSHOT_SIGNING_SECRET",
];

let fetchResponder = null;
export const blockedFetches = [];

export function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

export function isolateFromProduction() {
  for (const key of SECRET_ENV_KEYS) delete process.env[key];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (fetchResponder) {
      const answer = await fetchResponder(url, init);
      if (answer !== undefined) return answer;
    }
    blockedFetches.push(url);
    throw new Error(`NETWORK_BLOCKED_IN_VALIDATOR: ${url}`);
  };
}

// Responde a las URLs que el validador quiera simular; devolver undefined = bloquear.
export function setFetchResponder(fn) {
  fetchResponder = fn;
}

// ─── 2. Dobles en la frontera de módulo ──────────────────────────────────────
const STUBS = (globalThis.__EMRR_VALIDATOR_STUBS__ ??= {});
const redirects = new Map(); // URL real del módulo → URL data: del doble
let hooksInstalled = false;

function buildStubSource(realUrl, realModule) {
  const lines = [`import * as real from ${JSON.stringify(`${realUrl}?validator-real`)};`];
  lines.push(`const S = globalThis.__EMRR_VALIDATOR_STUBS__;`);
  lines.push(`const K = ${JSON.stringify(realUrl)};`);
  for (const name of Object.keys(realModule)) {
    if (name === "default") continue;
    if (typeof realModule[name] === "function") {
      lines.push(`export function ${name}(...args) { const o = S[K]?.${name}; return (o ?? real.${name}).apply(this, args); }`);
    } else {
      lines.push(`export const ${name} = real.${name};`);
    }
  }
  if ("default" in realModule) {
    lines.push(`export default function (...args) { const o = S[K]?.default; return (o ?? real.default).apply(this, args); }`);
  }
  return lines.join("\n");
}

function installHooksOnce() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      const target = redirects.get(result.url);
      return target ? { url: target, format: "module", shortCircuit: true } : result;
    },
  });
}

/**
 * Sustituye funciones exportadas de módulos del repo. `specs` = { "api/_lib/kvStorage.js":
 * { saveLastScanSnapshot: async () => true } }. Lo no sustituido delega en la implementación
 * real. DEBE llamarse ANTES del primer import del módulo que se quiere probar.
 */
export async function stubModules(specs) {
  for (const [relativePath, overrides] of Object.entries(specs)) {
    const realUrl = repoUrl(relativePath);
    if (!redirects.has(realUrl)) {
      const realModule = await import(`${realUrl}?validator-real`);
      const source = buildStubSource(realUrl, realModule);
      redirects.set(realUrl, `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    }
    STUBS[realUrl] = { ...(STUBS[realUrl] ?? {}), ...overrides };
  }
  installHooksOnce();
}

export function setStub(relativePath, name, fn) {
  const realUrl = repoUrl(relativePath);
  assert.ok(redirects.has(realUrl), `setStub: ${relativePath} no fue preparado con stubModules()`);
  STUBS[realUrl] = { ...(STUBS[realUrl] ?? {}), [name]: fn };
}

export function clearStub(relativePath, name) {
  const realUrl = repoUrl(relativePath);
  if (STUBS[realUrl]) delete STUBS[realUrl][name];
}

// Redis en memoria con registro de escrituras por clave lógica (kvStorage.js).
export function createMemoryKv() {
  const store = new Map();
  const writes = [];
  const saver = (key) => async (value) => { writes.push({ key, value }); store.set(key, value); return true; };
  const loader = (key) => async () => store.get(key) ?? null;
  return {
    store,
    writes,
    writesTo: (key) => writes.filter((w) => w.key === key),
    stubs: {
      saveLastScanSnapshot: saver("last_scan_snapshot"),
      loadLastScanSnapshot: loader("last_scan_snapshot"),
      saveLastRallySnapshot: saver("last_rally_snapshot"),
      loadLastRallySnapshot: loader("last_rally_snapshot"),
      saveLastRallyTestSnapshot: saver("last_rally_test_snapshot"),
      loadLastRallyTestSnapshot: loader("last_rally_test_snapshot"),
      saveBenchmarkBars: async () => true,
      loadBenchmarkBars: async () => null,
      saveRallyNews: async () => true,
      loadRallyNews: async () => null,
      saveLastIBKPortfolio: saver("last_ibk_portfolio"),
      loadLastIBKPortfolio: loader("last_ibk_portfolio"),
      kvGet: async (key) => store.get(key) ?? null,
      kvSet: async (key, value) => { writes.push({ key, value }); store.set(key, value); return true; },
      kvSetNx: async () => true,
      kvDel: async (key) => { store.delete(key); return true; },
    },
  };
}

// ─── 3. Invocación de handlers con req/res simulados ─────────────────────────
export async function invoke(handler, { method = "GET", query = {}, body, url } = {}) {
  const captured = { status: 200, body: undefined, headers: {} };
  const res = {
    status(code) { captured.status = code; return res; },
    json(payload) { captured.body = payload; return res; },
    send(payload) { captured.body = payload; return res; },
    setHeader(name, value) { captured.headers[String(name).toLowerCase()] = value; return res; },
    getHeader(name) { return captured.headers[String(name).toLowerCase()]; },
    end(payload) { if (payload !== undefined && captured.body === undefined) captured.body = payload; return res; },
  };
  await handler({ method, query, body, url, headers: {} }, res);
  return captured;
}

export function assertEnvelope(response, context) {
  const body = response.body ?? {};
  assert.equal(typeof body.ok, "boolean", `${context}: falta ok:boolean en el envelope`);
  assert.equal(typeof body.app, "string", `${context}: falta app en el envelope`);
  assert.equal(typeof body.endpoint, "string", `${context}: falta endpoint en el envelope`);
  assert.ok(!Number.isNaN(Date.parse(body.timestampUtc)), `${context}: falta timestampUtc ISO en el envelope`);
}

// ─── 4. Reloj congelado (horario de mercado determinista) ────────────────────
export async function withFrozenNow(iso, fn) {
  const RealDate = globalThis.Date;
  const fixed = RealDate.parse(iso);
  assert.ok(Number.isFinite(fixed), `withFrozenNow: fecha inválida ${iso}`);
  class FrozenDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  globalThis.Date = FrozenDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

// ─── 5. Barras sintéticas (días laborables, tendencia configurable) ──────────
export function syntheticBars({ count = 300, start = 50, dailyPct = 0.25, volume = 2_000_000, endDate = "2026-06-05" } = {}) {
  const dates = [];
  const cursor = new Date(`${endDate}T00:00:00.000Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.map((date, index) => {
    const close = start * (1 + dailyPct / 100) ** index;
    return { date, open: close * 0.998, high: close * 1.01, low: close * 0.99, close, volume };
  });
}

// ─── 6. Import de TS/TSX del frontend (bundle esbuild en node_modules/.cache) ─
/**
 * Empaqueta con esbuild un conjunto de módulos de src/ y devuelve sus exports:
 * `await importFrontend({ refresh: "src/services/realDataRefresh.ts" })` → { refresh: {...} }.
 * React queda como dependencia externa (misma instancia que react-dom/server).
 */
export async function importFrontend(entries, { exposePrivate = {} } = {}) {
  const { build } = await import("esbuild");
  // exposePrivate = { "src/pages/DashboardPage.tsx": ["storeScanState", …] }: añade un
  // `export { … }` SOLO a la copia empaquetada para probar funciones internas del módulo
  // por su comportamiento, sin tocar el código de producción.
  const exposeByPath = new Map(Object.entries(exposePrivate).map(([path, names]) => [repoPath(path), names]));
  const plugins = exposeByPath.size === 0 ? [] : [{
    name: "expose-private-for-validators",
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
        const names = exposeByPath.get(args.path);
        if (!names) return undefined;
        const source = readFileSync(args.path, "utf8");
        return { contents: `${source}\nexport { ${names.join(", ")} };\n`, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
      });
    },
  }];
  const names = Object.keys(entries);
  const contents = names
    .map((name) => `export * as ${name} from ${JSON.stringify(`./${entries[name]}`)};`)
    .join("\n");
  const outDir = repoPath("node_modules/.cache/emrr-validators");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `bundle-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await build({
    stdin: { contents, resolveDir: ROOT, loader: "ts", sourcefile: "validator-entry.ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    jsx: "automatic",
    outfile,
    logLevel: "silent",
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/server", "tesseract.js"],
    loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
    plugins,
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    try { unlinkSync(outfile); } catch { /* ya borrado */ }
  }
}

export async function renderMarkup(element) {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(element);
}

// Los servicios del frontend usan window.setTimeout: en Node basta con window = globalThis.
export function ensureBrowserGlobals() {
  if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
}

// localStorage en memoria para probar la persistencia del navegador (DashboardPage).
export function installMemoryLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => store.clear(),
  };
  return store;
}

// Captura las peticiones que hace un servicio del frontend y responde con `reply(url, init)`.
export function captureFetch(reply) {
  const requests = [];
  setFetchResponder(async (url, init) => {
    requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    return reply ? reply(url, init) : jsonResponse({ ok: true });
  });
  return requests;
}

// ─── 7. Fixtures de scan: handlers VIVOS de TOP 8 y Rally con datos sintéticos ─
// Tendencia diaria determinista por símbolo (0,02 %…0,42 % por sesión): el ranking que
// salga depende SOLO de los datos, nunca del nombre del ticker.
export function symbolTrend(providerSymbol, seed = 0) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const char of String(providerSymbol)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 0.02 + (hash % 100000) / 250000;
}

/**
 * Sustituye SOLO las fronteras externas de los scans (histórico, spread, SPY de referencia y
 * Redis) y deja vivo todo lo demás: universo estático, motores de score, planificación de
 * batches, tokens y persistencia final. Devuelve un objeto mutable para variar los datos.
 */
export async function prepareScanFixtures({ kv = createMemoryKv() } = {}) {
  isolateFromProduction();
  process.env.ENABLE_REAL_API_CALLS = "true";
  const fixture = {
    kv,
    seed: 0,
    failSymbols: new Set(),
    barsFor: null,
    historyCalls: [],
    spyBars: syntheticBars({ start: 400, dailyPct: 0.05, volume: 60_000_000 }),
  };
  await stubModules({
    "api/_lib/kvStorage.js": kv.stubs,
    "api/_lib/historicalDataProvider.js": {
      fetchEodhdHistoricalBars: async (providerSymbol) => {
        fixture.historyCalls.push(providerSymbol);
        if (fixture.failSymbols.has(providerSymbol)) {
          return { ok: false, provider: "none", providerSymbol, bars: [], blockedReason: "ALL_PROVIDERS_FAILED" };
        }
        const bars = fixture.barsFor
          ? fixture.barsFor(providerSymbol)
          : syntheticBars({ dailyPct: symbolTrend(providerSymbol, fixture.seed) });
        return { ok: true, provider: "VALIDATOR_FIXTURE", providerSymbol, bars, barCount: bars.length, gapDates: [], lastBarForming: false };
      },
    },
    "api/_lib/spreadDataProvider.js": {
      // Como en producción desde la cancelación de EODHD: sin bid/ask verificable.
      fetchEodhdSpread: async (providerSymbol) => ({ ok: false, provider: "none", providerSymbol, spreadPercent: null, blockedReason: "SPREAD_NOT_AVAILABLE" }),
    },
    "api/_lib/providerCascade.js": {
      raceBenchmarkHistory: async () => ({ ok: true, provider: "VALIDATOR_FIXTURE", bars: fixture.spyBars }),
    },
  });
  return fixture;
}

export async function loadOperableUniverse() {
  const { buildUniverseResponse } = await import(repoUrl("api/_lib/universeResponse.js"));
  const universe = await buildUniverseResponse({ includeFullAssets: true });
  return (universe.assets ?? []).filter((asset) => asset?.operabilityStatus === "OPERABLE");
}

// SCAN FULL completo por el handler vivo: start + continue… hasta que no haya token.
export async function runScanSnapshot(handler, { batchSize = 50, maxCalls = 60 } = {}) {
  const responses = [await invoke(handler, { method: "POST", query: { action: "start" }, body: { batchSize } })];
  while (responses.at(-1).body?.snapshotToken && responses.length < maxCalls) {
    const snapshotToken = responses.at(-1).body.snapshotToken;
    responses.push(await invoke(handler, { method: "POST", query: { action: "continue" }, body: { snapshotToken } }));
  }
  return responses;
}

// Scan de Rally Leaders (o de Rally-Test con test:true) completo por el handler vivo.
export async function runRallyScan(handler, { test = false, maxCalls = 60 } = {}) {
  const [startAction, continueAction] = test ? ["test-start", "test-continue"] : ["start", "continue"];
  const responses = [await invoke(handler, { method: "POST", query: { action: startAction }, body: {} })];
  while (responses.at(-1).body?.rallyToken && responses.length < maxCalls) {
    const rallyToken = responses.at(-1).body.rallyToken;
    responses.push(await invoke(handler, { method: "POST", query: { action: continueAction }, body: { rallyToken } }));
  }
  return responses;
}

// Candidato de scan con los 9 inputs del score presentes (spread verificado incluido) y la
// respuesta final (100 %) que lo contiene — base para probar las guardas de EXEC del frontend.
export function sampleScanCandidate(overrides = {}) {
  return {
    ticker: "QUAL", providerSymbol: "QUAL.US", name: "Qualifying Asset", market: "USA", exchange: "NASDAQ",
    currency: "USD", score: 82, conviction: 75, risk: "LOW", action: "WATCH", dataQuality: "GOOD",
    trailing: { trailing_adjusted: 1.3, trailing_medium: 2, trailing_wide: 2.9 },
    spreadStatus: { ok: true, spreadPercent: 0.05, blockedReason: null },
    technicalResult: {
      ok: true, dataQuality: "GOOD", validBars: 300,
      technicals: {
        ema20: 101, ema50: 98, ema20SlopePercent: 0.8, atr: 2, atrPercent: 2, rvol: 1.2, momentum5: 1,
        momentum20: 4, rs20: 2, rs60: 5, avgVolume20: 2_000_000, avgValue20: 200_000_000,
        maxDrawdown20: 3, lastClose: 102, lastDate: "2026-06-02",
      },
    },
    ...overrides,
  };
}

export function sampleFinalSnapshot(candidates = [sampleScanCandidate()]) {
  return {
    ok: true, mode: "CONTINUABLE_FULL_UNIVERSE_SCAN_SNAPSHOT", status: "GLOBAL_TOP8_FINAL",
    scanId: "scan-validator", scanStartedAtUtc: "2026-06-03T14:00:00.000Z", scanCompletedAtUtc: "2026-06-03T14:02:00.000Z",
    lastBatchCompletedAtUtc: "2026-06-03T14:02:00.000Z", universeHash: "validator", activeMarkets: ["USA"],
    universeDiscovered: 593, universeAfterFilters: 593, batchesTotal: 12, batchesCompleted: 12, nextBatchIndex: null,
    coveragePercent: 100, estimatedProviderCalls: 101, actualProviderCalls: 1200, resultScope: "GLOBAL_TOP8_FINAL",
    isGlobalTop8Final: true, isPartialResult: false, snapshotToken: null, recommendedNextAction: "GLOBAL_TOP8_FINAL_AVAILABLE",
    topCandidates: candidates, assets: candidates,
  };
}

// Cotización visible (api/visible-top8-quotes.js) para un activo del TOP 8.
export function sampleVisibleQuotes(assets, quote = {}) {
  return {
    ok: true, endpoint: "VISIBLE_TOP8_QUOTES", realApiCallsEnabled: true, maxAssets: 12, acceptsExternalSymbols: false,
    universeExecutionAllowed: false, fullRunAllowed: false, rankingSource: false,
    selectedTickers: assets.map((asset) => asset.ticker),
    assets: assets.map((asset) => ({
      ticker: asset.ticker, name: asset.name, exchange: asset.market, currency: "USD", providerSymbol: asset.providerSymbol,
      provider: "Finnhub", price: 102.5, previousClose: 100, changePercent: 2.5, timestampUtc: new Date().toISOString(),
      dataQuality: "CLEAN", cacheStatus: "MISS", dataMode: "REAL", operationalDataStatus: "REAL",
      operationalDecisionAllowed: false, operationalBlockReasons: ["PRICE_ENRICHMENT_ONLY_NOT_RANKING_SOURCE"], error: null,
      ...quote,
    })),
  };
}

// Instantes de referencia para el horario de mercado (junio 2026, horario de verano).
export const US_OPEN_UTC = "2026-06-03T15:00:00.000Z"; // miércoles, NYSE abierta
export const ALL_CLOSED_UTC = "2026-06-06T15:00:00.000Z"; // sábado

// Momento a 9 meses (189 sesiones) calculado de forma INDEPENDIENTE del motor.
export function referenceMom9m(bars) {
  const closes = bars.map((bar) => bar.close);
  const last = closes.at(-1);
  const base = closes.at(-1 - 189);
  return (last / base - 1) * 100;
}

// Quita comentarios // y /* */ para que los chequeos estáticos no salten por texto explicativo.
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// ─── Autocomprobación del arnés ──────────────────────────────────────────────
async function selfTest() {
  isolateFromProduction();
  for (const key of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "FINNHUB_API_KEY"]) {
    assert.equal(process.env[key], undefined, `el arnés debe borrar ${key} del entorno`);
  }
  await assert.rejects(() => fetch("https://example.com/"), /NETWORK_BLOCKED_IN_VALIDATOR/, "la red real debe quedar bloqueada");

  setFetchResponder((url) => (url.startsWith("https://stub.test/") ? jsonResponse({ ok: true }) : undefined));
  assert.deepEqual(await (await fetch("https://stub.test/a")).json(), { ok: true });
  await assert.rejects(() => fetch("https://query1.finance.yahoo.com/x"), /NETWORK_BLOCKED/);
  setFetchResponder(null);

  const kv = createMemoryKv();
  await stubModules({ "api/_lib/kvStorage.js": kv.stubs });
  const kvModule = await import(repoUrl("api/_lib/kvStorage.js"));
  await kvModule.saveLastScanSnapshot({ scanId: "harness" });
  assert.equal(kv.writesTo("last_scan_snapshot").length, 1, "el doble de kvStorage debe interceptar las escrituras");
  assert.equal(typeof kvModule.kvGet, "function", "el doble debe exponer TODOS los exports del módulo real");

  const handler = (await import(repoUrl("api/scan-snapshot.js"))).default;
  const wrongMethod = await invoke(handler, { method: "GET", query: { action: "start" } });
  assert.equal(wrongMethod.status, 405, "invoke() debe capturar el status del handler real");

  await withFrozenNow("2026-06-07T12:00:00.000Z", () => {
    assert.equal(new Date().toISOString(), "2026-06-07T12:00:00.000Z");
    assert.equal(Date.now(), Date.parse("2026-06-07T12:00:00.000Z"));
  });
  assert.notEqual(new Date().toISOString(), "2026-06-07T12:00:00.000Z", "el reloj debe restaurarse");

  const bars = syntheticBars({ count: 30 });
  assert.equal(bars.length, 30);
  assert.ok(bars.every((bar) => ![0, 6].includes(new Date(`${bar.date}T00:00:00Z`).getUTCDay())), "solo días laborables");

  const { policy } = await importFrontend({ policy: "src/utils/operationalDataPolicy.ts" });
  assert.equal(typeof policy.deriveOperationalDataPolicy, "function", "el bundle TS debe exponer los exports del módulo");

  assert.equal(blockedFetches.filter((url) => !url.includes("example.com") && !url.includes("yahoo.com/x")).length, 0,
    `ninguna llamada de red inesperada: ${blockedFetches.join(", ")}`);
  console.log("Validator harness OK: sin red, sin Redis de producción, dobles de módulo y bundle TS operativos.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await selfTest();
}
