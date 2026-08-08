/**
 * SP500 — servicio de frontend, TOTALMENTE INDEPENDIENTE de optimal2026Refresh.
 *
 * Mandato de Sergi (8-ago-2026): los dos módulos no pueden cruzar datos. Por eso:
 *  · endpoint propio  → /api/sp500
 *  · claves propias   → sp500_*  (SUPREME usa optimal2026_*)
 *  · tipos propios    → nada se importa del otro módulo
 * Un fallo aquí nunca debe afectar al resto del dashboard: todo devuelve estado seguro.
 */

export type Sp500Profile = "PRUDENTE" | "EQUILIBRADO" | "AMBICIOSO" | "AGRESIVO";

export interface Sp500Vehicle {
  ticker: string;
  isin: string;
  exchange: string;
  currency: string;
  ter: number;
  type: string;
  note: string;
}

export interface Sp500Signal {
  ok: boolean;
  module?: "SP500";
  calibrationVersion?: string;
  asOf?: string;
  computedAtUtc?: string;
  profile?: Sp500Profile;
  profileLabel?: string;

  price?: number;
  regime?: "DENTRO" | "FUERA";
  regimeConfirmed?: boolean;
  regimeReason?: string;

  momentum12mPct?: number | null;
  realizedVolPct?: number;
  sma200?: number | null;
  rsi2?: number | null;
  vix?: number | null;

  exposurePct?: number;
  volTargetPct?: number;
  volCapPct?: number;
  usesLeverage?: boolean;
  profileAllowsLeverage?: boolean;
  pullbackOpen?: boolean;
  pullbackReason?: string | null;

  exitLevel?: number;
  distanceToExitPct?: number | null;
  distanceToTrendPct?: number | null;
  nextReview?: string;

  profiles?: Record<string, { label: string; cagr: number; maxDD: number; leveraged?: boolean }>;
  vehicles?: Sp500Vehicle[];
  backtest?: {
    period: string;
    buyHold: { cagr: number; maxDD: number; mar: number };
    core: { cagr: number; maxDD: number; mar: number; ordersPerYear: number };
  };
  barsUsed?: number;
  dataProvider?: string | null;
  servedFrom?: "cache" | "computed";
  ageMinutes?: number;

  error?: string;
  message?: string;
}

export const SP500_KEYS = {
  signal: "sp500_signal_v1",
  settings: "sp500_settings_v1",
} as const;

export const initialSp500Signal: Sp500Signal = { ok: false };

/** Lee la señal del backend. Nunca lanza: en caso de fallo devuelve ok:false con motivo. */
export async function fetchSp500Signal(profile: Sp500Profile = "EQUILIBRADO", force = false): Promise<Sp500Signal> {
  try {
    const params = new URLSearchParams({ profile });
    if (force) params.set("force", "1");
    const res = await fetch(`/api/sp500?${params.toString()}`, { headers: { Accept: "application/json" } });
    const json = (await res.json()) as Sp500Signal;
    if (!res.ok) return { ok: false, error: json?.error ?? `HTTP_${res.status}`, message: json?.message ?? "El módulo SP500 no pudo calcular la señal." };
    return json;
  } catch (e) {
    return { ok: false, error: "NETWORK", message: e instanceof Error ? e.message : "Fallo de red al consultar /api/sp500" };
  }
}

// ── Ajustes locales del módulo (capital y perfil) — aislados en su propia clave ──

export interface Sp500Settings {
  profile: Sp500Profile;
  /** Capital total que Sergi destina EN EXCLUSIVA al S&P 500 (independiente del otro módulo). */
  capital: number | null;
  /** Importe ya invertido hoy en el vehículo del S&P 500. */
  invested: number | null;
  vehicle: string;
}

export const defaultSp500Settings: Sp500Settings = {
  profile: "EQUILIBRADO",
  capital: null,
  invested: null,
  vehicle: "SXR8",
};

export function loadSp500Settings(): Sp500Settings {
  try {
    const raw = localStorage.getItem(SP500_KEYS.settings);
    if (!raw) return defaultSp500Settings;
    const parsed = JSON.parse(raw) as Partial<Sp500Settings>;
    return {
      profile: (["PRUDENTE", "EQUILIBRADO", "AMBICIOSO", "AGRESIVO"] as const).includes(parsed.profile as Sp500Profile)
        ? (parsed.profile as Sp500Profile) : defaultSp500Settings.profile,
      capital: typeof parsed.capital === "number" && Number.isFinite(parsed.capital) && parsed.capital > 0 ? parsed.capital : null,
      invested: typeof parsed.invested === "number" && Number.isFinite(parsed.invested) && parsed.invested >= 0 ? parsed.invested : null,
      vehicle: typeof parsed.vehicle === "string" && parsed.vehicle ? parsed.vehicle : defaultSp500Settings.vehicle,
    };
  } catch {
    return defaultSp500Settings;
  }
}

export function saveSp500Settings(s: Sp500Settings): void {
  try {
    localStorage.setItem(SP500_KEYS.settings, JSON.stringify(s));
  } catch {
    // modo privado del navegador: perder el ajuste no puede romper el módulo
  }
}

export function clearSp500Settings(): void {
  try {
    localStorage.removeItem(SP500_KEYS.settings);
    localStorage.removeItem(SP500_KEYS.signal);
  } catch {
    // sin efecto si el almacenamiento no está disponible
  }
}

export interface Sp500Order {
  action: "COMPRAR" | "VENDER" | "MANTENER";
  targetAmount: number;
  currentAmount: number;
  delta: number;
  reason: string;
}

/** Misma regla que el backend (banda muerta del 10%), para poder mostrarla sin otra llamada. */
export function buildSp500Order(signal: Sp500Signal, capital: number | null, invested: number | null): Sp500Order | null {
  if (!signal.ok || typeof signal.exposurePct !== "number") return null;
  if (typeof capital !== "number" || !Number.isFinite(capital) || capital <= 0) return null;
  const held = typeof invested === "number" && Number.isFinite(invested) ? invested : 0;
  const targetAmount = (signal.exposurePct / 100) * capital;
  const delta = targetAmount - held;
  const deltaPct = Math.abs(delta) / capital;
  if (deltaPct < 0.10) {
    return { action: "MANTENER", targetAmount, currentAmount: held, delta: 0,
      reason: `La diferencia (${(deltaPct * 100).toFixed(0)} pp) no llega a la banda del 10%: operar ahora solo suma comisiones.` };
  }
  return {
    action: delta > 0 ? "COMPRAR" : "VENDER",
    targetAmount, currentAmount: held, delta,
    reason: delta > 0
      ? `Subir la exposición hasta el ${signal.exposurePct.toFixed(0)}% del capital del módulo.`
      : `Bajar la exposición hasta el ${signal.exposurePct.toFixed(0)}% del capital del módulo.`,
  };
}
