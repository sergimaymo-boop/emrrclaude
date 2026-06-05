import type { Top8Asset, DataMode } from "../types";
// OperationalData types used in Top8Asset fields

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
