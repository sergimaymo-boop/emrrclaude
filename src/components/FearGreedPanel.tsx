import { useEffect, useState } from "react";
import type { FearGreed, MasterIndicator } from "../types";
import { IndicatorRow, type IndicatorFeedStatus } from "./MasterIndicatorsGrid";
import { SegmentedControl } from "./DensityToggle";
import { formatShortTime } from "../services/realDataRefresh";

interface FearGreedData {
  ok: boolean;
  score: number;
  rating: string;
  label: string;
  source?: string;
  sourceLabel?: string;
  cnnAsOfUtc?: string | null;
  components?: Record<string, number | null>;
  componentsAvailable?: number;
}

type FgLoadState = "LOADING" | "OK" | "NOT_AVAILABLE" | "FAILED";

// Same 6 indicators shown in "Master Indicators" (SPY excluded), in the exact
// top-to-bottom order requested: HYG, MOVE, VIX, VVIX, TNX, LQD.
// Reusing the SAME `masterIndicators` data + the SAME `IndicatorRow` renderer
// guarantees byte-identical values, colors and status labels.
const FG_INDICATOR_ORDER: MasterIndicator["symbol"][] = ["HYG", "MOVE", "VIX", "VVIX", "TNX", "LQD"];
const FG_TIMEOUT_MS = 8000;
const RETURN_REFRESH_MS = 60_000;

function isInternalSource(d: FearGreedData): boolean {
  return d.source !== "CNN_BUSINESS";
}

function internalComponentsCount(d: FearGreedData): number {
  if (typeof d.componentsAvailable === "number") return d.componentsAvailable;
  return Object.values(d.components ?? {}).filter((v) => typeof v === "number").length;
}

export function FearGreedPanel({ masterIndicators, indicatorsFeed }: {
  fearGreed?: FearGreed;
  masterIndicators?: MasterIndicator[];
  indicatorsFeed?: IndicatorFeedStatus;
}) {
  const [fgData, setFgData] = useState<FearGreedData | null>(null);
  const [fgFetchedAtUtc, setFgFetchedAtUtc] = useState<string | null>(null);
  const [fgState, setFgState] = useState<FgLoadState>("LOADING");
  const [fgReason, setFgReason] = useState<string | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);

  useEffect(() => {
    // Refresco cada 4 min + al volver a la app tras >60 s oculta. Un fallo NUNCA se traga:
    // se conserva el último dato bueno marcado "SIN ACTUALIZAR", o "No disponible" si no hubo.
    let cancelled = false;
    let inFlight: AbortController | null = null;
    async function load() {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), FG_TIMEOUT_MS);
      try {
        const r = await fetch("/api/fear-greed", { headers: { accept: "application/json" }, signal: controller.signal });
        const d = (await r.json().catch(() => null)) as (FearGreedData & { status?: string; reason?: string; error?: string }) | null;
        if (cancelled) return;
        if (!r.ok && !(d && d.ok === false && d.status === "NOT_AVAILABLE")) throw new Error(`HTTP_${r.status}`);
        if (!d || d.ok !== true || typeof d.score !== "number" || !Number.isFinite(d.score)) {
          setFgData(null);
          setFgState("NOT_AVAILABLE");
          setFgReason(d?.reason ?? d?.error ?? null);
          return;
        }
        setFgData(d);
        setFgFetchedAtUtc(new Date().toISOString());
        setFgState("OK");
        setFgReason(null);
      } catch {
        if (cancelled || controller !== inFlight) return;
        setFgState("FAILED");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    load();
    const timer = window.setInterval(load, 4 * 60_000);
    let hiddenAt: number | null = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (hiddenAt !== null && Date.now() - hiddenAt > RETURN_REFRESH_MS) load();
      hiddenAt = null;
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      inFlight?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Gauge color strictly by score range (matches the CNN Fear & Greed scale,
  // which is the live primary source — see sourceLabel/source below):
  //   0-25   Extreme Fear   → red
  //   26-45  Fear           → orange
  //   46-55  Neutral        → strong grey
  //   56-75  Greed          → soft green
  //   76-100 Extreme Greed  → very strong green
  const getColor = (score: number) => {
    if (score <= 25) return "#ef4444"; // 0-25: red
    if (score <= 45) return "#f97316"; // 26-45: orange
    if (score <= 55) return "#64748b"; // 46-55: strong grey
    if (score <= 75) return "#4ade80"; // 56-75: soft green
    return "#15803d";                  // 76-100: very strong green
  };

  const feedBanner = indicatorsFeed?.lastFetchFailed ? (
    <div style={{ fontSize: 9, fontWeight: 700, color: "#eab308", margin: "0 0 6px" }}>
      {indicatorsFeed.lastSuccessUtc
        ? `⚠ Indicadores SIN ACTUALIZAR · último dato ${formatShortTime(indicatorsFeed.lastSuccessUtc)}`
        : masterIndicators?.some((ind) => ind.status === "CACHE")
          ? "⚠ Indicadores SIN ACTUALIZAR · se muestran datos de caché (ver fecha)"
          : "⚠ Indicadores no disponibles (fallo de la fuente)"}
    </div>
  ) : null;

  if (!fgData) {
    // Sin dato válido de F&G: nunca se inventa un 50. No usado en Score, Ranking ni EXEC.
    const unavailable = fgState !== "LOADING";
    return (
      <section className="section-block priority-block" style={{ marginBottom: 14 }}>
        <div className="section-title-row">
          <h2>Fear &amp; Greed</h2>
        </div>
        <div className="fear-greed-layout">
          <div className="fear-score">—</div>
          <div>
            <p className="metric-label">Sentimiento</p>
            <strong style={{ color: unavailable ? "#ef4444" : undefined }}>
              {!unavailable ? "Cargando…" : fgState === "FAILED" ? "No disponible (fallo de la fuente)" : "No disponible"}
            </strong>
            {unavailable && fgReason && <span className="muted-line">{fgReason}</span>}
            <span className="muted-line">No se usa en Score, Ranking ni EXEC</span>
          </div>
        </div>
        {masterIndicators && masterIndicators.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {feedBanner}
            {FG_INDICATOR_ORDER
              .map((symbol) => masterIndicators.find((ind) => ind.symbol === symbol))
              .filter((ind): ind is MasterIndicator => Boolean(ind))
              .map((ind) => <IndicatorRow key={ind.symbol} ind={ind} feed={indicatorsFeed} />)}
          </div>
        )}
      </section>
    );
  }

  // Color por la ETIQUETA de CNN (25-sep-2026): CNN clasifica el valor sin redondear y el
  // panel coloreaba el redondeado — 46 días entre 2021 y 2026 el color contradecía la etiqueta.
  const RATING_COLOR: Record<string, string> = {
    EXTREME_FEAR: "#ef4444", FEAR: "#f97316", NEUTRAL: "#64748b", GREED: "#4ade80", EXTREME_GREED: "#15803d",
  };
  const color = RATING_COLOR[fgData.rating] ?? getColor(fgData.score);
  // Lectura validada por backtest (scripts/backtest-fear-greed.mjs, backtests/fear-greed-2026-09-25.json).
  const interno = isInternalSource(fgData);
  const lectura = interno
    ? "Escala ≈ VIX: más miedo = más riesgo de caída a 20 ses. (34% vs 8% en los extremos); no anticipa el retorno."
    : fgData.rating === "EXTREME_FEAR"
      ? "Hist. 2021-26: tras miedo extremo, SPY +6,1% de media a 60 sesiones (media +3,5%) · más volátil."
      : fgData.rating === "EXTREME_GREED"
        ? "Hist. 2021-26: caídas >5% en 20 sesiones raras (2,5% vs 16%) · retorno sin ventaja."
        : "Hist. 2021-26: sin ventaja — lo que siguió fue similar a la media.";
  const validacion = interno
    ? "Validación: composite interno 2007-04→2026-09 (4.889 ses.); coincide con CNN el 30% de los días."
    : "Validación: CNN 2021-01→2026-09 (1.424 ses.). Solo el miedo extremo mostró ventaja; no es señal de compra/venta.";
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference * (1 - fgData.score / 100);

  return (
    <section className="section-block" style={{ marginBottom: 14 }}>
      <div className="section-title-row" style={{ marginBottom: 12 }}>
        <h2>Fear &amp; Greed</h2>
        <span style={{ fontSize: 10, color: isInternalSource(fgData) ? "#eab308" : "#64748b" }}>
          {isInternalSource(fgData)
            ? `Índice interno (CNN no disponible) · ${internalComponentsCount(fgData)}/7 · escala propia, no comparable con CNN`
            : fgData.sourceLabel ?? "Fuente: CNN Business"}
        </span>
      </div>
      {fgState === "FAILED" && (
        <div style={{ fontSize: 9, fontWeight: 700, color: "#eab308", marginBottom: 8 }}>
          ⚠ SIN ACTUALIZAR · dato de {formatShortTime(fgFetchedAtUtc)} — la última consulta falló
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Gauge */}
        <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="10"
            />
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 1s ease" }}
            />
          </svg>
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{fgData.score}</span>
            <span style={{ fontSize: 8, color: "#64748b", fontWeight: 700 }}>/ 100</span>
          </div>
        </div>
        {/* Label + component SCORES (not raw values) */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color, marginBottom: 2 }}>
            {fgData.label ?? fgData.rating}
          </div>
          {fgData.cnnAsOfUtc && (
            <div style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
              Cierre de referencia: {new Date(fgData.cnnAsOfUtc).toLocaleString("es-ES", {
                day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </div>
          )}
          <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.35, marginBottom: 3 }}>{lectura}</div>
          <div style={{ fontSize: 8.5, color: "#64748b", lineHeight: 1.3 }}>{validacion}</div>
        </div>
      </div>
      {/* Indicadores de mercado — desplegables con SegmentedControl */}
      {masterIndicators && masterIndicators.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <SegmentedControl
            ariaLabel="Indicadores de mercado"
            options={[
              { key: "show", label: "INDICADORES", icon: "☰" },
              { key: "hide", label: "OCULTAR",      icon: "▤" },
            ]}
            value={showIndicators ? "show" : "hide"}
            onChange={(v) => setShowIndicators(v === "show")}
          />
          <div
            style={{
              overflow: "hidden",
              maxHeight: showIndicators ? "400px" : "0px",
              transition: "max-height 0.25s ease",
              marginTop: showIndicators ? 10 : 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {feedBanner}
              {FG_INDICATOR_ORDER
                .map((symbol) => masterIndicators.find((ind) => ind.symbol === symbol))
                .filter((ind): ind is MasterIndicator => Boolean(ind))
                .map((ind) => <IndicatorRow key={ind.symbol} ind={ind} feed={indicatorsFeed} />)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
