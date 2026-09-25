/**
 * OPTIMAL SUPREME Intraday Engine — Señales semi-activas para maximizar rentabilidad
 *
 * Diseñado con los sweeps de jul-2026 (118 variantes, 603 tickers US+EU, 2016-2026,
 * 20 pb por lado), seleccionando sobre la MUESTRA COMPLETA (sin tramo fuera de muestra).
 * ⚠ Las cifras de entonces (52,2% / DD 26,9% / MAR 1,94) no se reproducen: la auditoría del
 * 25-sep-2026 midió 45,9% / DD 38,0% / MAR 1,21 (rango entre descargas ~39-51% / 27-38%).
 * Referencia vigente: OPTIMAL_SUPREME_CALIBRATION.backtest en api/_lib/optimal2026Engine.js.
 *
 * Base académica de partida (confirmada por el sweep): Barroso & Santa-Clara (2015)
 * vol-managed momentum; Fan-Li-Shi (2016) trailing stops; Antonacci (2014) dual momentum.
 * Las señales de este engine se aplican en tiempo real sobre los datos del scan.
 */

import type { Optimal2026Item, Optimal2026Result } from "./optimal2026Refresh";
import { getRegionalMarketStates } from "../utils/marketHours";

export type ActionRec = "HOLD" | "TIGHTEN" | "ROTATE" | "EXIT";
export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface PullbackFactor {
  name: string;
  weight: number;
  value: number;
  detail: string;
}

export interface Optimal2026Signal {
  pullbackRisk: number;           // 0-100: riesgo de pullback inminente
  riskLevel: RiskLevel;
  action: ActionRec;
  actionDetail: string;
  adjustedStopPct: number | null;
  adjustedStopPrice: number | null;
  rotationTarget: string | null;  // ticker rank-3 si justifica rotación
  factors: PullbackFactor[];
}

export type Optimal2026ItemWithSignal = Optimal2026Item & Optimal2026Signal;

// ── Pullback risk computation ─────────────────────────────────────────────────

export function computePullbackRisk(
  item: Optimal2026Item,
  allItems: Optimal2026Item[],
): { pullbackRisk: number; riskLevel: RiskLevel; factors: PullbackFactor[] } {
  // Los campos del item vienen del KV ya formateados:
  // riskAdjMom: ratio crudo (e.g., 2.34)
  // retLong, rsLong, vol63: en % (e.g., 28.5 = +28.5%)
  // align: 0-3

  const ram = item.riskAdjMom ?? 0;
  const retL = item.retLong ?? 0;      // % (e.g., 28.5)
  const rs = item.rsLong ?? 0;         // % vs SPY
  const vol = item.vol63 ?? 0;         // % anualizada
  const align = item.align ?? 3;
  const r2 = item.r2 ?? 1;

  // Factor 1 — riskAdjMom (señal primaria, 35% peso)
  // < 1.0: señal débil → alto riesgo; < 2.0: moderado; ≥ 2.5: sólido
  let f1 = 0;
  if (ram < 0.5) f1 = 1.00;
  else if (ram < 1.0) f1 = 0.80;
  else if (ram < 1.5) f1 = 0.55;
  else if (ram < 2.0) f1 = 0.28;
  else if (ram < 2.5) f1 = 0.10;
  const fac1: PullbackFactor = {
    name: "Momentum risk-adj", weight: 35, value: f1,
    detail: ram < 1.0 ? "Señal débil (<1.0)" : ram < 2.0 ? `Moderado (${ram.toFixed(2)})` : `Sólido (${ram.toFixed(2)})`,
  };

  // Factor 2 — retLong 9m (25% peso)
  // < 10%: momentum tenue; < 20%: normal; ≥ 35%: fuerte
  let f2 = 0;
  if (retL < 2) f2 = 1.00;
  else if (retL < 10) f2 = 0.70;
  else if (retL < 20) f2 = 0.30;
  else if (retL < 35) f2 = 0.10;
  const fac2: PullbackFactor = {
    name: "Retorno 9m", weight: 25, value: f2,
    detail: retL < 10 ? `Tenue (+${retL.toFixed(1)}%)` : retL < 25 ? `Normal (+${retL.toFixed(1)}%)` : `Fuerte (+${retL.toFixed(1)}%)`,
  };

  // Factor 3 — RS vs SPY (20% peso)
  // Negativo = underperformance vs mercado → mayor riesgo de salida del umbral
  let f3 = 0;
  if (rs < -15) f3 = 1.00;
  else if (rs < -8) f3 = 0.70;
  else if (rs < -3) f3 = 0.45;
  else if (rs < 0) f3 = 0.20;
  const fac3: PullbackFactor = {
    name: "RS vs SPY", weight: 20, value: f3,
    detail: rs < 0 ? `Perdiendo al SPY (${rs.toFixed(1)}%)` : `Batiendo al SPY (+${rs.toFixed(1)}%)`,
  };

  // Factor 4 — Volatilidad realizada (15% peso)
  // Vol alta = reversión más probable; Barroso & Santa-Clara (2015)
  let f4 = 0;
  if (vol > 65) f4 = 1.00;
  else if (vol > 50) f4 = 0.70;
  else if (vol > 38) f4 = 0.40;
  else if (vol > 28) f4 = 0.15;
  const fac4: PullbackFactor = {
    name: "Volatilidad 3m", weight: 15, value: f4,
    detail: vol > 50 ? `Alta (${vol.toFixed(0)}%)` : vol > 30 ? `Moderada (${vol.toFixed(0)}%)` : `Baja (${vol.toFixed(0)}%)`,
  };

  // Factor 5 — EMA alignment + R² (5% peso)
  const alignFactor = align <= 1 ? 1.0 : align === 2 ? 0.4 : 0.0;
  const r2Factor = r2 < 0.4 ? 0.8 : r2 < 0.6 ? 0.4 : 0.0;
  const f5 = (alignFactor * 0.6 + r2Factor * 0.4);
  const fac5: PullbackFactor = {
    name: "Estructura EMA/R²", weight: 5, value: f5,
    detail: align < 3 ? `EMA align ${align}/3, R² ${r2.toFixed(2)}` : `EMA align 3/3`,
  };

  const pullbackRisk = Math.min(100, Math.round(
    f1 * 35 + f2 * 25 + f3 * 20 + f4 * 15 + f5 * 5,
  ));

  const riskLevel: RiskLevel =
    pullbackRisk >= 78 ? "CRITICAL" :
    pullbackRisk >= 55 ? "HIGH" :
    pullbackRisk >= 35 ? "MODERATE" : "LOW";

  return { pullbackRisk, riskLevel, factors: [fac1, fac2, fac3, fac4, fac5] };
}

// ── Action recommendation ─────────────────────────────────────────────────────

export function computeActionRec(
  item: Optimal2026Item,
  allItems: Optimal2026Item[],
  pullbackRisk: number,
): Pick<Optimal2026Signal, "action" | "actionDetail" | "adjustedStopPct" | "adjustedStopPrice" | "rotationTarget"> {
  const baseStop = item.stopPct ?? 8;
  const price = item.price ?? 0;

  // Candidato de rotación: rank 3 o 4 con score >10% superior al tenido.
  // Umbral 1.10 = histéresis elegida en el sweep 4 de jul-2026 (en muestra; sus cifras no se
  // reproducen, ver cabecera). La señal se evalúa en cada scan; la revisión prevista es mensual.
  const rank3 = allItems.find(i => i.rank === 3 || i.rank === 4);
  const rotationTrigger = rank3 && item.score != null && rank3.score != null
    && rank3.score > item.score * 1.10;
  const rotationTarget = rotationTrigger ? rank3!.symbol.split(".")[0] : null;

  let action: ActionRec;
  let actionDetail: string;
  let stopMult = 1.0;

  if (pullbackRisk >= 78) {
    action = "EXIT";
    actionDetail = "Risk crítico — salir y mantener liquidez (stop muy ajustado)";
    stopMult = 0.55;
  } else if (pullbackRisk >= 58 && rotationTarget) {
    action = "ROTATE";
    actionDetail = `Rotar hacia ${rotationTarget} — supera a esta posición en >10% de score (histéresis; ejecutar máx ~1 vez/mes)`;
    stopMult = 0.68;
  } else if (pullbackRisk >= 38) {
    action = "TIGHTEN";
    actionDetail = "Ajustar trailing — proteger beneficios, riesgo moderado-alto";
    stopMult = 0.76;
  } else {
    action = "HOLD";
    actionDetail = pullbackRisk < 18
      ? "Señal sólida — mantener posición completa"
      : "Señal OK — vigilar si el score sigue bajando";
    stopMult = 1.0;
  }

  const adjustedStopPct = Math.round(baseStop * stopMult * 10) / 10;
  const adjustedStopPrice = price > 0
    ? Math.round(price * (1 - adjustedStopPct / 100) * 100) / 100
    : null;

  return { action, actionDetail, adjustedStopPct, adjustedStopPrice, rotationTarget };
}

// ── Main enrichment ───────────────────────────────────────────────────────────

export function enrichWithIntradaySignals(
  items: Optimal2026Item[],
): Optimal2026ItemWithSignal[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((item) => {
    const { pullbackRisk, riskLevel, factors } = computePullbackRisk(item, items);
    const action = computeActionRec(item, items, pullbackRisk);
    return { ...item, pullbackRisk, riskLevel, factors, ...action };
  });
}

// ── Derived display state (compartido entre Optimal2026Panel y PortfolioCard) ──
// Extraído tal cual (mismo cálculo, mismos inputs/outputs) para que el panel de
// señales y la tarjeta de Cartera IBK — ahora piezas separadas del layout tras la
// reordenación de módulos — nunca puedan divergir en "isPricesStale"/"deployPct".
export interface Optimal2026Derived {
  items: Optimal2026ItemWithSignal[];
  isLive: boolean;
  isPricesStale: boolean;
  /** null = sin dato de despliegue en el snapshot (nunca un 30% por defecto). */
  deployPct: number | null;
  /** Último refresco de precio en vivo de cualquier item (ms epoch), null si ninguno. */
  latestPriceRefreshMs: number | null;
}

export function deriveOptimal2026Display(data: Optimal2026Result): Optimal2026Derived {
  const rawItems = data.items ?? [];
  const items = enrichWithIntradaySignals(rawItems);
  const mkt = getRegionalMarketStates();
  const isLive = mkt.marketHours === "OPEN";

  // Staleness: mercado abierto pero precio sin actualizar >5min (~3 ciclos de
  // enriquecimiento de 90s) — misma regla que ya usaba Optimal2026Panel.
  const latestRefreshMs = rawItems.reduce((max, it) => {
    if (!it.priceRefreshedAt) return max;
    const t = new Date(it.priceRefreshedAt).getTime();
    return t > max ? t : max;
  }, 0);
  const STALE_MS = 5 * 60 * 1000;
  const isPricesStale = isLive && rawItems.length > 0
    && (latestRefreshMs === 0 || Date.now() - latestRefreshMs > STALE_MS);

  const deployPct = typeof data.deployPct === "number" && Number.isFinite(data.deployPct) ? data.deployPct : null;

  return { items, isLive, isPricesStale, deployPct, latestPriceRefreshMs: latestRefreshMs > 0 ? latestRefreshMs : null };
}

