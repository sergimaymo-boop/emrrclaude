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
}

// Umbrales y probabilidades reproducibles por scripts/backtest-vix-risk.mjs (VIX vs S&P500, 5 años):
// % = días con caída brusca del SPY (>3% a 5 sesiones). Calma 7% · medio 13% · estrés 29%.
function levelFromVix(vix: number): { level: RiskLevel; color: string; label: string; prob: number } {
  if (vix < 16) return { level: "BAJO", color: "#10b981", label: "Riesgo bajo — entorno favorable para entrar", prob: 7 };
  if (vix < 21) return { level: "MEDIO", color: "#eab308", label: "Riesgo medio — entrar con cautela y stop", prob: 13 };
  return { level: "ALTO", color: "#ef4444", label: "Riesgo alto — entorno peligroso, mejor esperar", prob: 29 };
}

export function initialMarketRisk(): MarketRisk {
  return { ok: true, level: "UNKNOWN", vix: null, vixChange: null, sharpDropProb: null, color: "#64748b", label: "Midiendo riesgo de mercado…", context: { move: null, hyg: null, vvix: null, hygChange: null } };
}

export async function fetchMarketRisk(): Promise<MarketRisk> {
  try {
    const res = await fetch("/api/master-indicators", { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return initialMarketRisk();
    const data = await res.json();
    const list: Array<{ symbol?: string; price?: number; changePercent?: number }> = Array.isArray(data?.indicators) ? data.indicators : [];
    const find = (sym: string) => list.find((i) => i.symbol === sym);
    const vix = find("VIX")?.price ?? null;
    if (!Number.isFinite(vix)) return initialMarketRisk();
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
    };
  } catch {
    return initialMarketRisk();
  }
}
