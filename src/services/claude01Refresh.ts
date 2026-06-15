export interface Claude01Item {
  symbol: string;
  name: string;
  fable01Score: number;
  fable01Rank: number;
  currentPrice: number | null;
  pullbackPct: number | null;
  rsi14: number | null;
  ema50: number | null;
  ema200: number | null;
  inUptrend: boolean;
  inPullback: boolean;
  rsiSane: boolean;
  isOpportunity: boolean;
  entrySignal: "BREAKOUT" | "ESPERANDO" | "EXTENDIDO" | "SIN_DATOS";
  earningsDate: string | null;
  earningsDaysAway: number | null;
  earningsHour: "bmo" | "amc" | "dmh" | null;
  kellySize: number;
  hasCatalyst: boolean;
}

export interface Claude01Result {
  ok: boolean;
  regime: "A" | "B" | "C" | "D";
  label: string;
  color: string;
  description: string;
  actionBias: string;
  note: string;
  vix: number | null;
  hygHealth: "SANO" | "DÉBIL" | "NEUTRAL" | null;
  spyVsEma200: "SOBRE" | "BAJO" | "DESCONOCIDO" | null;
  opportunities: Claude01Item[];
  watching: Claude01Item[];
  totalAnalyzed: number;
  fromCache: boolean;
  timestampUtc: string | null;
  reason?: string;
  message?: string;
}

export function initialClaude01(): Claude01Result {
  return {
    ok: false,
    regime: "B",
    label: "—",
    color: "#64748b",
    description: "Cargando…",
    actionBias: "—",
    note: "—",
    vix: null,
    hygHealth: null,
    spyVsEma200: null,
    opportunities: [],
    watching: [],
    totalAnalyzed: 0,
    fromCache: false,
    timestampUtc: null,
  };
}

export async function fetchClaude01(forceRefresh = false): Promise<Claude01Result> {
  try {
    const resp = await fetch("/api/claude01-scan", {
      method: forceRefresh ? "POST" : "GET",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data as Claude01Result;
  } catch {
    return { ...initialClaude01(), ok: false, reason: "FETCH_ERROR" };
  }
}
