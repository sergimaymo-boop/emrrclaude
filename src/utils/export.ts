import type { Top8Asset, DataMode } from "../types";
import type { RallyAsset } from "../services/rallyRefresh";
import type { RankTicker, MarketBreadthResult } from "../services/marketBreadthRefresh";
import type { MarketRisk } from "../services/marketRiskRefresh";
// OperationalData types used in Top8Asset fields

const nfmt = (v: number | null | undefined, d = 2, suf = "") => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(d)}${suf}` : "N/A");
const pfmt = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "N/A");

/**
 * EXPORTACIÓN COMPLETA — los 28 tickers de los 3 motores de selección (TOP 8 + Rally + Watchlist
 * de amplitud), con TODOS sus datos y la TEMPORALIDAD de cada uno, estructurado para un segundo
 * análisis (ChatGPT/Claude). NO incluye Flujos. Datos del último scan.
 */
export function formatFullExport(
  top8: Top8Asset[], rally: RallyAsset[], watch: RankTicker[],
  breadth: MarketBreadthResult | null, risk: MarketRisk | null,
): string {
  const now = new Date().toLocaleString("es-ES", { timeZone: "Atlantic/Canary" });
  const H = line("═");
  const out: string[] = [
    H,
    "  EMRR — EXPORTACIÓN COMPLETA DE SELECCIÓN (3 motores)",
    `  Exportado: ${now} (Canarias) · Datos del último scan`,
    H, "",
    "  CONTEXTO DE MERCADO",
    breadth ? row("Amplitud (contraria ~40d)", `${breadth.verdict ?? "—"} ${breadth.score ?? "—"}/100 — ${breadth.label ?? ""}`) : "",
    risk ? row("Riesgo HOY (VIX)", `${risk.level} — ${risk.label} (VIX ${nfmt(risk.vix, 1)})`) : "",
    "",
    "  LEYENDA DE MOTORES (validación honesta)",
    "  · TOP 8 = momentum/calidad (comprar fuerza). Edge a corto débil; mejor a 6-12 meses.",
    "  · RALLY = momentum/breakout (líderes cerca de máximos). Bate al mercado ~60% a 9-12m (confianza baja).",
    "  · WATCHLIST = contrario/sobreventa (rebote ~1-2 meses). Edge MUY débil (IC≈0.01). Ideas, no señal.",
    "",
  ];

  // ── MOTOR 1: TOP 8 ──
  out.push(line("━"), "  MOTOR 1 · TOP 8 — momentum / calidad", line("━"), "");
  const t8 = (top8 ?? []).filter((a) => a?.ticker && a.ticker !== "UNKNOWN");
  if (t8.length === 0) out.push("  (sin datos — ejecuta SCAN con mercados abiertos)", "");
  t8.slice(0, 8).forEach((a) => {
    out.push(
      `  #${a.rank}  ${a.ticker} — ${a.name}`,
      `  ${a.market} · ${a.currency} · ${a.marketStatus}`,
      row("Precio", `${a.price} (cierre ant. ${a.previousClose ?? "N/A"}, var ${a.priceChangePercent >= 0 ? "+" : ""}${a.priceChangePercent.toFixed(2)}%)`),
      row("Score / Conviction", `${a.score}/100 · ${a.conviction}/100`),
      row("Riesgo / Acción", `${a.risk} · ${actionLabel(a.action)}`),
      row("EMA20 (20 sesiones)", `${a.ema20}`),
      row("EMA50 (50 sesiones)", `${a.ema50}`),
      row("Pendiente EMA20", `${a.slope}`),
      row("RS vs SPY (60 días)", `${a.rs}`),
      row("Momentum (20 días)", `${a.momentum}`),
      row("RVOL (vol 20d/20d prev)", `${a.rvol}`),
      row("ATR% (14 días)", `${a.atrPercent}`),
      row("Trailing stops", `ajustado ${a.trailingAdjusted} · medio ${a.trailingMedium} · amplio ${a.trailingWide}`),
      row("Calidad / Fuente", `${a.dataQuality} · ${a.provider}`),
      "",
    );
  });

  // ── MOTOR 2: RALLY ──
  out.push(line("━"), "  MOTOR 2 · RALLY LEADERS — momentum / breakout", line("━"), "");
  const rl = rally ?? [];
  if (rl.length === 0) out.push("  (sin datos — ejecuta SCAN con mercados abiertos)", "");
  rl.slice(0, 10).forEach((a) => {
    const m = a.metrics as (RallyAsset["metrics"] & { ema5?: number; rs5d?: number; high52w?: number; proximity52w?: number; components?: Record<string, number> }) | null;
    out.push(
      `  #${a.rank}  ${a.ticker} — ${a.name}`,
      `  ${a.market} · ${a.exchange} · ${a.currency} · ${a.providerSymbol}`,
      row("RallyScore", `${a.rallyScore}/100 — ${a.rallyLabel}`),
      row("Precio", nfmt(m?.lastClose)),
      row("EMA 5/20/50", `${nfmt(m?.ema5)} / ${nfmt(m?.ema20)} / ${nfmt(m?.ema50)}`),
      row("Pendiente EMA20/50", `${nfmt(m?.ema20Slope, 2, "%")} / ${nfmt(m?.ema50Slope, 2, "%")}`),
      row("RS vs SPY 3m / 6m / 5d", `${pfmt(m?.rs3m)} / ${pfmt(m?.rs6m)} / ${pfmt(m?.rs5d)}`),
      row("Momentum 1m / 3m / 6m", `${pfmt(m?.mom1m)} / ${pfmt(m?.mom3m)} / ${pfmt(m?.mom6m)}`),
      row("Proximidad máx 52 sem.", `${m?.proximity52w != null ? (m.proximity52w * 100).toFixed(0) + "%" : "N/A"} (máx ${nfmt(m?.high52w)})`),
      row("RVOL / ATR%", `${nfmt(m?.rvol)} / ${nfmt(m?.atrPercent, 2, "%")}`),
      row("Liquidez (valor medio 20d)", m?.avgValue20 != null ? `${(m.avgValue20 / 1e6).toFixed(0)}M` : "N/A"),
      m?.components ? row("Comp. (RS/Mom/Trend/Prox/RVOL/ATR/Liq)", `${nfmt(m.components.sRS, 0)}/${nfmt(m.components.sMom, 0)}/${nfmt(m.components.sTrend, 0)}/${nfmt(m.components.sProx52w, 0)}/${nfmt(m.components.sRvol, 0)}/${nfmt(m.components.sAtr, 0)}/${nfmt(m.components.sLiq, 0)}`) : "",
      row("Trailing stop", nfmt(a.trailingStop, 1, "%")),
      "",
    );
  });

  // ── MOTOR 3: WATCHLIST (amplitud contraria) ──
  out.push(line("━"), "  MOTOR 3 · WATCHLIST AMPLITUD — contrario / sobreventa", line("━"), "");
  const wl = watch ?? [];
  if (wl.length === 0) out.push("  (sin datos — recalcula amplitud)", "");
  wl.slice(0, 10).forEach((t, i) => {
    const f = t.features;
    const tr = t.trailing;
    const trStr = (lvl: { pct: number | null; price: number | null } | null | undefined) => lvl ? `-${nfmt(lvl.pct)}% (${nfmt(lvl.price)})` : "N/A";
    out.push(
      `  #${i + 1}  ${t.symbol} — ${t.name}`,
      row("Prob. subida ~60d", `${t.probUp}% (base ${breadth?.rankBaseUp ?? 58}%) · score ${nfmt(t.score, 2)}`),
      row("Precio", `${nfmt(t.price)} (var día ${pfmt(t.pctChange)})`),
      row("RSI (14 días)", nfmt(f.rsi14, 0)),
      row("vs MA50 / MA200", `${pfmt(f.distMA50)} / ${pfmt(f.distMA200)}`),
      row("Retorno 20 días / 60 días", `${pfmt(f.ret20)} / ${pfmt(f.ret60)}`),
      row("Desde máx / mín 52 sem.", `${pfmt(f.dist52H)} / ${pfmt(f.dist52L)}`),
      row("ATR diario (14d) / RVOL", `${pfmt(f.atrPct)} / ${nfmt(f.rvol)}`),
      row("Tendencia fondo (MA200)", f.aboveMA200 ? "Alcista" : "Bajista"),
      row("Trailing stops (ATR)", `mín ${trStr(tr?.min)} · medio ${trStr(tr?.med)} · amplio ${trStr(tr?.wide)}`),
      "",
    );
  });

  out.push(H, "  EMRR · emrrclaude.vercel.app · 28 tickers · TOP8 + Rally + Watchlist", "  Temporalidades indicadas junto a cada dato. Sin Flujos.", H);
  return out.filter((s) => s !== "").join("\n");
}

export async function shareFullExport(
  top8: Top8Asset[], rally: RallyAsset[], watch: RankTicker[],
  breadth: MarketBreadthResult | null, risk: MarketRisk | null,
  onFallback: (text: string) => void,
): Promise<"shared" | "copied" | "displayed"> {
  const text = formatFullExport(top8, rally, watch, breadth, risk);
  const title = "EMRR — Selección completa (28 tickers)";
  const filename = `emrr-seleccion-${new Date().toISOString().slice(0, 10)}.txt`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      if (navigator.canShare) {
        const file = new File([text], filename, { type: "text/plain" });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ title, files: [file] }); return "shared"; }
      }
      await navigator.share({ title, text });
      return "shared";
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return "shared";
    }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; }
  catch { onFallback(text); return "displayed"; }
}

function line(char = "─", len = 52): string {
  return char.repeat(len);
}

function row(label: string, value: string, pad = 22): string {
  return `  ${label.padEnd(pad)} ${value}`;
}

function scoreBar(score: number, max = 100): string {
  const filled = Math.round((score / max) * 12);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, 12 - filled)) + `  ${score.toFixed(1)}`;
}

function riskLabel(risk: string): string {
  if (risk === "LOW") return "▼ LOW";
  if (risk === "MEDIUM") return "◆ MEDIUM";
  return "▲ HIGH";
}

function actionLabel(action: string): string {
  if (action === "EXEC") return "EXEC — Operacional";
  if (action === "WATCH") return "WATCH — Vigilar";
  if (action === "CLOSED_CONTEXT") return "MERCADO CERRADO";
  if (action === "BLOCKED") return "BLOCKED";
  return action;
}

export function formatTop8ForExport(top8: Top8Asset[]): string {
  const now = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const hasData = top8.length > 0 && top8[0]?.ticker !== "UNKNOWN";

  const header = [
    line("═"),
    "  EMRR — INSTITUTIONAL TREND RANKING",
    `  Exportado: ${now}`,
    line("═"),
    "",
  ].join("\n");

  if (!hasData) {
    return header + "  Sin datos disponibles. Ejecuta SCAN FULL con mercados abiertos.\n";
  }

  const assets = top8.slice(0, 8).map((a) => {
    const sections: string[] = [
      `  #${a.rank}  ${a.ticker}  —  ${a.name}`,
      `  ${a.market}  ·  ${a.currency}  ·  ${a.marketStatus}`,
      line("─"),
      "",
      "  PRECIO",
      row("Precio actual", a.price),
      row("Cierre anterior", a.previousClose ?? "N/A"),
      row("Variacion", `${a.priceChangePercent >= 0 ? "+" : ""}${a.priceChangePercent.toFixed(2)}%`),
      "",
      "  PUNTUACION",
      row("Score", scoreBar(a.score)),
      row("Conviction", scoreBar(a.conviction)),
      row("Riesgo", riskLabel(a.risk)),
      row("Accion", actionLabel(a.action)),
      "",
      "  TECNICO",
      row("EMA 20", a.ema20),
      row("EMA 50", a.ema50),
      row("Slope EMA20", a.slope),
      row("RS (60d)", a.rs),
      row("RVOL", a.rvol),
      row("ATR%", a.atrPercent),
      row("Momentum 20d", a.momentum),
      "",
      "  TRAILING STOPS",
      row("Ajustado", a.trailingAdjusted),
      row("Medio", a.trailingMedium),
      row("Amplio", a.trailingWide),
      "",
      "  DATOS",
      row("Calidad", a.dataQuality),
      row("Fuente", a.provider),
      row("Timestamp", a.priceTimestamp.local),
      row("Cobertura", a.resultScope),
      a.scanCompletedAtUtc
        ? row("Scan completado", new Date(a.scanCompletedAtUtc).toLocaleString("es-ES"))
        : "",
      "",
    ];

    return sections.filter((s) => s !== "").join("\n");
  });

  const footer = [
    line("═"),
    "  EMRR · emrrclaude.vercel.app",
    "  Datos: EODHD · Analisis institucional",
    line("═"),
  ].join("\n");

  const blocks = assets.map((a, i) => (i > 0 ? "\n" + line() + "\n\n" + a : a));
  return [header, ...blocks, "\n" + footer].join("\n");
}

export async function shareTop8(
  top8: Top8Asset[],
  onFallback: (text: string) => void,
): Promise<"shared" | "copied" | "displayed"> {
  const text = formatTop8ForExport(top8);
  const title = "EMRR — TOP 8 Institucional";
  const filename = `emrr-top8-${new Date().toISOString().slice(0, 10)}.txt`;

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      if (navigator.canShare) {
        const file = new File([text], filename, { type: "text/plain" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title, files: [file] });
          return "shared";
        }
      }
      await navigator.share({ title, text });
      return "shared";
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return "shared";
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    onFallback(text);
    return "displayed";
  }
}
