/**
 * Market Risk — semáforo de RIESGO en tiempo real (módulo independiente).
 * Responde "¿es un momento seguro para entrar HOY?" midiendo el estrés ACTUAL del mercado
 * (VIX + crédito/bonos), NO prediciendo dirección. Validado por scripts/backtest-vix-risk.mjs:
 * en calma (VIX bajo) solo el ~7% de los días sufre una caída brusca a 5d; en estrés, el ~29%.
 * Es un filtro de RIESGO (1 ventana 2021-2026; reproducible).
 */

export type RiskLevel = "BAJO" | "MEDIO" | "ALTO" | "UNKNOWN";

export interface MarketRisk {
  ok: boolean;
  level: RiskLevel;
  vix: number | null;
  vixChange: number | null;
  sharpDropProb: number | null; // % histórico de días con caída >3% a 5d (validado)
  color: string;
  label: string;
  context: { move: number | null; hyg: number | null; vvix: number | null; hygChange: number | null };
  cachedAtUtc?: string;
  // Honestidad del dato: LOADING (aún sin respuesta), OK, UNAVAILABLE (nunca hubo dato bueno).
  loadState: "LOADING" | "OK" | "UNAVAILABLE";
  fetchedAtUtc: string | null;   // hora del último fetch CORRECTO
  refreshFailed: boolean;        // el último intento falló → se muestra el dato previo como SIN ACTUALIZAR
}

// Umbrales y probabilidades reproducibles por scripts/backtest-vix-risk.mjs (VIX vs S&P500, 5 años):
// % = días con caída brusca del SPY (>3% a 5 sesiones). Calma 7% · medio 13% · estrés 29%.
function levelFromVix(vix: number): { level: RiskLevel; color: string; label: string; prob: number } {
  if (vix < 16) return { level: "BAJO", color: "#10b981", label: "Riesgo bajo — entorno favorable para entrar", prob: 7 };
  if (vix < 21) return { level: "MEDIO", color: "#eab308", label: "Riesgo medio — entrar con cautela y stop", prob: 13 };
  return { level: "ALTO", color: "#ef4444", label: "Riesgo alto — entorno peligroso, mejor esperar", prob: 29 };
}

export function initialMarketRisk(): MarketRisk {
  return { ok: true, level: "UNKNOWN", vix: null, vixChange: null, sharpDropProb: null, color: "#64748b", label: "Midiendo riesgo de mercado…", context: { move: null, hyg: null, vvix: null, hygChange: null }, loadState: "LOADING", fetchedAtUtc: null, refreshFailed: false };
}

function unavailableMarketRisk(): MarketRisk {
  return { ...initialMarketRisk(), ok: false, label: "No disponible (fallo de la fuente)", loadState: "UNAVAILABLE", refreshFailed: true };
}

// Tras un fallo: conserva el último dato bueno marcado SIN ACTUALIZAR; si nunca lo hubo, "No disponible".
export function markMarketRiskFailed(prev: MarketRisk): MarketRisk {
  return prev.loadState === "OK" ? { ...prev, refreshFailed: true } : unavailableMarketRisk();
}

// Lanza ante cualquier fallo (red, timeout, HTTP, VIX ausente): el llamante decide con markMarketRiskFailed.
export async function fetchMarketRisk(): Promise<MarketRisk> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("/api/master-indicators", { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`MARKET_RISK_HTTP_${res.status}`);
    const data = await res.json();
    const list: Array<{ symbol?: string; price?: number; changePercent?: number }> = Array.isArray(data?.indicators) ? data.indicators : [];
    const find = (sym: string) => list.find((i) => i.symbol === sym);
    const vix = find("VIX")?.price ?? null;
    if (!Number.isFinite(vix)) throw new Error("MARKET_RISK_VIX_UNAVAILABLE");
    const v = levelFromVix(vix as number);
    return {
      ok: true,
      level: v.level,
      vix: vix as number,
      vixChange: find("VIX")?.changePercent ?? null,
      sharpDropProb: v.prob,
      color: v.color,
      label: v.label,
      context: {
        move: find("MOVE")?.price ?? null,
        hyg: find("HYG")?.price ?? null,
        vvix: find("VVIX")?.price ?? null,
        hygChange: find("HYG")?.changePercent ?? null,
      },
      cachedAtUtc: data?.cachedAtUtc,
      loadState: "OK",
      fetchedAtUtc: new Date().toISOString(),
      refreshFailed: false,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
