/**
 * Market Risk — semáforo de RIESGO de mercado en tiempo real (módulo independiente).
 * Mide el estrés ACTUAL (VIX + crédito/bonos) y lo traduce a RIESGO: con qué frecuencia han
 * llegado caídas bruscas y de qué tamaño han sido tras entrar. NO predice dirección ni da
 * señales de entrada/espera: la evidencia no las respalda.
 *
 * Evidencia: scripts/backtest-vix-risk.mjs → backtests/vix-risk-2026-09-25.json
 * (S&P 500 ^GSPC, 1990-01-02 → 2026-07-31, 9.212 días, dataset local data/sp500-history.json):
 *   · caída >3% en algún momento de las 5 sesiones siguientes: VIX <16 ~5% · 16-21 ~13% · ≥21 ~31%
 *   · con VIX ≥21 la rentabilidad media posterior NO fue peor (20 sesiones: +1,2% vs +0,6% en calma;
 *     mediana +1,8% vs +1,0%; aguanta quitando cualquier episodio; excepción: 2000-2009) y esperar a
 *     que el VIX bajase de 21 dio mejor precio solo el 13,7% de las veces (7-22% según la década).
 * Auditoría 25-sep-2026: la versión anterior (muestra de 5 años) decía "mejor esperar" con VIX alto
 * y "favorable para entrar" en calma — llamadas de timing que los datos contradicen. Retiradas.
 */

export type RiskLevel = "BAJO" | "MEDIO" | "ALTO" | "UNKNOWN";

export interface MarketRisk {
  ok: boolean;
  level: RiskLevel;
  vix: number | null;
  vixChange: number | null;
  sharpDropProb: number | null; // % histórico de días con caída >3% (mínimo intradía) en las 5 sesiones siguientes
  dip20Typical: number | null;  // caída máxima típica (mediana, %) en las 20 sesiones siguientes a entrar
  dip20OneInTen: number | null; // la superada 1 de cada 10 veces (percentil 10, %)
  color: string;
  label: string;
  advice: string;               // lectura del nivel acorde con la evidencia (sin llamadas de timing); "" sin dato
  context: { move: number | null; hyg: number | null; vvix: number | null; hygChange: number | null };
  cachedAtUtc?: string;
  // Honestidad del dato: LOADING (aún sin respuesta), OK, UNAVAILABLE (nunca hubo dato bueno).
  loadState: "LOADING" | "OK" | "UNAVAILABLE";
  fetchedAtUtc: string | null;   // hora del último fetch CORRECTO
  refreshFailed: boolean;        // el último intento falló → se muestra el dato previo como SIN ACTUALIZAR
}

type ZoneLevel = Exclude<RiskLevel, "UNKNOWN">;
interface ZoneEvidence { sharpDropProb: number; dip20Typical: number; dip20OneInTen: number }

// Cifras por zona = bloque "panel" de backtests/vix-risk-2026-09-25.json. Si se re-ejecuta el estudio
// (node scripts/backtest-vix-risk.mjs --out=…) y cambian, actualizarlas AQUÍ. Umbrales 16/21: los
// terciles reales 1990-2026 son 15,2/20,8 y el riesgo crece de forma continua con el VIX → se mantienen.
export const VIX_RISK_EVIDENCE: { period: string; index: string; zones: Record<ZoneLevel, ZoneEvidence> } = {
  period: "1990-2026",
  index: "S&P 500",
  zones: {
    BAJO: { sharpDropProb: 5, dip20Typical: 1.5, dip20OneInTen: 4.8 },
    MEDIO: { sharpDropProb: 13, dip20Typical: 2.2, dip20OneInTen: 7.3 },
    ALTO: { sharpDropProb: 31, dip20Typical: 3.4, dip20OneInTen: 10.4 },
  },
};

// Textos: describen RIESGO, no dan momento de entrada. "1 de cada 7" = panel.ALTO.esperarVix21PctMejorPrecio (13,7%).
const ZONE_TEXT: Record<ZoneLevel, { color: string; label: string; advice: string }> = {
  BAJO: {
    color: "#10b981",
    label: "Calma: caídas bruscas poco frecuentes",
    advice: "Mide riesgo, no oportunidad: la rentabilidad media posterior no ha sido mejor que en otros niveles de VIX.",
  },
  MEDIO: {
    color: "#eab308",
    label: "Volatilidad habitual: caídas bruscas ocasionales",
    advice: "Riesgo y rentabilidad posterior cercanos a la media histórica.",
  },
  ALTO: {
    color: "#ef4444",
    label: "Estrés: caídas bruscas frecuentes — reduce tamaño",
    advice:
      "No es señal de esperar: la rentabilidad media posterior no ha sido peor que en calma (salvo en 2000-2009) " +
      "y esperar a que el VIX bajase de 21 dio mejor precio solo 1 de cada 7 veces. Si entras, con menos tamaño o por partes.",
  },
};

function levelFromVix(vix: number): { level: ZoneLevel; color: string; label: string; advice: string } & ZoneEvidence {
  const level: ZoneLevel = vix < 16 ? "BAJO" : vix < 21 ? "MEDIO" : "ALTO";
  return { level, ...ZONE_TEXT[level], ...VIX_RISK_EVIDENCE.zones[level] };
}

export function initialMarketRisk(): MarketRisk {
  return { ok: true, level: "UNKNOWN", vix: null, vixChange: null, sharpDropProb: null, dip20Typical: null, dip20OneInTen: null, color: "#64748b", label: "Midiendo riesgo de mercado…", advice: "", context: { move: null, hyg: null, vvix: null, hygChange: null }, loadState: "LOADING", fetchedAtUtc: null, refreshFailed: false };
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
      sharpDropProb: v.sharpDropProb,
      dip20Typical: v.dip20Typical,
      dip20OneInTen: v.dip20OneInTen,
      color: v.color,
      label: v.label,
      advice: v.advice,
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
