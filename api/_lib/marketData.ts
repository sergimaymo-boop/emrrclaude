import { getRuntimeEnv, isConfiguredSecret, isRealApiEnabled, type RuntimeEnv } from "./runtime";

export type ProviderName = "EODHD" | "Finnhub" | "none";
export type MasterIndicatorDiagnosticStatus = "TNX_PROVIDER_VALID" | "TNX_PROVIDER_UNRESOLVED";
export type DataQuality =
  | "CLEAN"
  | "GOOD"
  | "WARNING"
  | "STALE"
  | "INVALID"
  | "NOT_CONFIGURED"
  | "NOT_AVAILABLE";

export interface QuoteData {
  symbol: AllowedSymbol;
  name: string;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  currency: string;
  providerUsed: ProviderName;
  timestampUtc: string;
  dataQuality: DataQuality;
  marketStatus: "UNKNOWN";
  message?: string;
  isInformationalOnly: true;
  affectsScore: false;
  affectsRanking: false;
  affectsExec: false;
  diagnosticStatus?: MasterIndicatorDiagnosticStatus;
  providerSymbolsTried?: {
    eodhd: string;
    finnhub: string;
  };
}

export interface ProviderRuntimeState {
  eodhd: "configured" | "not_configured";
  finnhub: "configured" | "not_configured";
}

interface ProviderResult {
  ok: true;
  quote: QuoteData;
}

interface ProviderFailure {
  ok: false;
  reason: string;
  status?: number;
}

interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type RuntimeFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: unknown },
) => Promise<MinimalFetchResponse>;

const PROVIDER_TIMEOUT_MS = 8_000;

export const ALLOWED_SYMBOLS = ["SPY", "LQD", "HYG", "VIX", "VVIX", "TNX", "MOVE"] as const;

export type AllowedSymbol = (typeof ALLOWED_SYMBOLS)[number];

const SYMBOL_DETAILS: Record<
  AllowedSymbol,
  {
    name: string;
    eodhdSymbol: string;
    finnhubSymbol: string;
    currency: string;
  }
> = {
  SPY: { name: "S&P 500 ETF", eodhdSymbol: "SPY.US", finnhubSymbol: "SPY", currency: "USD" },
  LQD: { name: "Investment Grade Credit", eodhdSymbol: "LQD.US", finnhubSymbol: "LQD", currency: "USD" },
  HYG: { name: "High Yield Credit", eodhdSymbol: "HYG.US", finnhubSymbol: "HYG", currency: "USD" },
  VIX: { name: "Equity Volatility", eodhdSymbol: "VIX.INDX", finnhubSymbol: "^VIX", currency: "index" },
  VVIX: { name: "VIX Volatility", eodhdSymbol: "VVIX.INDX", finnhubSymbol: "^VVIX", currency: "index" },
  TNX: { name: "10Y Yield", eodhdSymbol: "US10Y.GBOND", finnhubSymbol: "^TNX", currency: "%" },
  MOVE: { name: "Treasury Volatility", eodhdSymbol: "MOVE.INDX", finnhubSymbol: "MOVE", currency: "index" },
};

function buildIndicatorMetadata(
  symbol: AllowedSymbol,
  details: (typeof SYMBOL_DETAILS)[AllowedSymbol],
  price: number | null,
): Pick<
  QuoteData,
  | "isInformationalOnly"
  | "affectsScore"
  | "affectsRanking"
  | "affectsExec"
  | "diagnosticStatus"
  | "providerSymbolsTried"
> {
  const metadata = {
    isInformationalOnly: true,
    affectsScore: false,
    affectsRanking: false,
    affectsExec: false,
  } as const;

  if (symbol !== "TNX") {
    return metadata;
  }

  return {
    ...metadata,
    diagnosticStatus: price === null ? "TNX_PROVIDER_UNRESOLVED" : "TNX_PROVIDER_VALID",
    providerSymbolsTried: {
      eodhd: details.eodhdSymbol,
      finnhub: details.finnhubSymbol,
    },
  };
}

export function getProviderRuntimeState(env: RuntimeEnv = getRuntimeEnv()): ProviderRuntimeState {
  return {
    eodhd: isConfiguredSecret(env.EODHD_API_KEY) ? "configured" : "not_configured",
    finnhub: isConfiguredSecret(env.FINNHUB_API_KEY) ? "configured" : "not_configured",
  };
}

export function parseAllowedSymbol(rawSymbol: string | string[] | undefined): AllowedSymbol | null {
  if (Array.isArray(rawSymbol)) return null;
  if (!rawSymbol) return null;

  const normalized = rawSymbol.trim().toUpperCase();
  return ALLOWED_SYMBOLS.includes(normalized as AllowedSymbol) ? (normalized as AllowedSymbol) : null;
}

export function hasMultiSymbolInput(rawSymbol: string | string[] | undefined) {
  if (Array.isArray(rawSymbol)) return true;
  return rawSymbol?.includes(",") ?? false;
}

export async function getControlledQuote(symbol: AllowedSymbol, env: RuntimeEnv = getRuntimeEnv()): Promise<QuoteData> {
  const details = SYMBOL_DETAILS[symbol];
  const timestampUtc = new Date().toISOString();

  if (!isRealApiEnabled(env)) {
    return createUnavailableQuote(
      symbol,
      "Real API calls are disabled. Set ENABLE_REAL_API_CALLS=true in Vercel only when Phase 5 real-data validation is authorized.",
      "NOT_CONFIGURED",
    );
  }

  if (!isConfiguredSecret(env.EODHD_API_KEY)) {
    return createUnavailableQuote(
      symbol,
      "EODHD_API_KEY is not configured. Provider substitutes are disabled by operational data policy.",
      "NOT_CONFIGURED",
    );
  }

  const eodhdResult = await fetchEodhdQuote(symbol, details, env);
  if (eodhdResult.ok) return eodhdResult.quote;

  return {
    symbol,
    name: details.name,
    price: null,
    previousClose: null,
    changePercent: null,
    currency: details.currency,
    providerUsed: "none",
    timestampUtc,
    dataQuality: "NOT_AVAILABLE",
    marketStatus: "UNKNOWN",
    message: `Primary provider returned no valid quote data. EODHD: ${eodhdResult.reason}. Provider substitutes are disabled.`,
    ...buildIndicatorMetadata(symbol, details, null),
  };
}

export function createUnavailableQuote(symbol: AllowedSymbol, message: string, quality: DataQuality): QuoteData {
  const details = SYMBOL_DETAILS[symbol];

  return {
    symbol,
    name: details.name,
    price: null,
    previousClose: null,
    changePercent: null,
    currency: details.currency,
    providerUsed: "none",
    timestampUtc: new Date().toISOString(),
    dataQuality: quality,
    marketStatus: "UNKNOWN",
    message,
    ...buildIndicatorMetadata(symbol, details, null),
  };
}

async function fetchEodhdQuote(
  symbol: AllowedSymbol,
  details: (typeof SYMBOL_DETAILS)[AllowedSymbol],
  env: RuntimeEnv,
): Promise<ProviderResult | ProviderFailure> {
  if (!isConfiguredSecret(env.EODHD_API_KEY)) {
    return { ok: false, reason: "EODHD_API_KEY is not configured." };
  }

  const token = encodeURIComponent(env.EODHD_API_KEY ?? "");
  const providerSymbol = encodeURIComponent(details.eodhdSymbol);
  const url = `https://eodhd.com/api/real-time/${providerSymbol}?api_token=${token}&fmt=json`;
  const response = await fetchJson(url);

  if (!response.ok) return response;

  const data = response.data as Record<string, unknown>;
  const price = firstNumber(data.close, data.price, data.last, data.c);
  const previousClose = firstNumber(data.previousClose, data.previous_close, data.pc, data.prev_close);
  const changePercent = firstNumber(data.change_p, data.changePercent, data.dp) ?? calculateChangePercent(price, previousClose);

  if (price === null) {
    return { ok: false, reason: "EODHD did not return a valid price." };
  }

  return {
    ok: true,
    quote: {
      symbol,
      name: details.name,
      price,
      previousClose,
      changePercent,
      currency: details.currency,
      providerUsed: "EODHD",
      timestampUtc: new Date().toISOString(),
      dataQuality: previousClose === null || changePercent === null ? "WARNING" : "GOOD",
      marketStatus: "UNKNOWN",
      ...buildIndicatorMetadata(symbol, details, price),
    },
  };
}

async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | ProviderFailure> {
  const runtime = globalThis as unknown as {
    fetch?: RuntimeFetch;
    AbortController?: new () => { signal: unknown; abort(): void };
    setTimeout?: (handler: () => void, timeoutMs: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };

  if (!runtime.fetch) {
    return { ok: false, reason: "Runtime fetch is not available." };
  }

  const abortController = runtime.AbortController ? new runtime.AbortController() : null;
  const timeout =
    abortController && runtime.setTimeout
      ? runtime.setTimeout(() => abortController.abort(), PROVIDER_TIMEOUT_MS)
      : null;

  try {
    const response = await runtime.fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "EMRR-2.0-Tendencias/phase-4",
      },
      signal: abortController?.signal,
    });

    if (!response.ok) {
      return { ok: false, status: response.status, reason: `Provider returned HTTP ${response.status}.` };
    }

    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, reason: "Provider request failed." };
  } finally {
    if (timeout && runtime.clearTimeout) runtime.clearTimeout(timeout);
  }
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function calculateChangePercent(price: number | null, previousClose: number | null) {
  if (price === null || previousClose === null || previousClose === 0) return null;
  return ((price - previousClose) / previousClose) * 100;
}
