import type { Top8Asset } from "../types";
import type { MarketRegime, RallyState } from "../services/rallyRefresh";
import type { IntraDayFlowsState } from "./IntraDayFlowsPanel";

// ─── Sector mapping: stock → sector key (same keys as SCAN FLOWS) ─────────────
const STOCK_SECTOR: Record<string, string> = {
  // Consumo Básico
  KO:"staples", PG:"staples", PEP:"staples", COST:"staples", WMT:"staples", CL:"staples",
  // Utilities
  NEE:"utilities", SO:"utilities", DUK:"utilities", AEP:"utilities", SRE:"utilities", EXC:"utilities",
  // Defensa
  LMT:"defense", RTX:"defense", NOC:"defense", GD:"defense", LHX:"defense", HII:"defense",
  // Oro/Metales
  NEM:"gold", GOLD:"gold", FCX:"gold", AEM:"gold", WPM:"gold", FNV:"gold",
  // Salud
  UNH:"healthcare", LLY:"healthcare", JNJ:"healthcare", ABBV:"healthcare", MRK:"healthcare", TMO:"healthcare",
  // Semiconductores
  NVDA:"semis", AMD:"semis", INTC:"semis", QCOM:"semis", AVGO:"semis", TXN:"semis",
  // Software / IA
  MSFT:"software", ORCL:"software", CRM:"software", NOW:"software", INTU:"software", ADBE:"software",
  // Bancos
  JPM:"banks", BAC:"banks", WFC:"banks", C:"banks", GS:"banks", MS:"banks",
  // Energía
  XOM:"energy", CVX:"energy", COP:"energy", EOG:"energy", SLB:"energy", MPC:"energy",
  // Tecnología
  AAPL:"tech", ACN:"tech", AVGO:"tech",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilterResult {
  pass: boolean | null; // null = pending (scan not run yet)
  label: string;
  detail: string;
  pending?: boolean;
}

interface OptimalSignal {
  alarma: boolean;        // market bearish → red alarm
  filter1: FilterResult;  // Regime
  filter2: FilterResult;  // Flows sector
  filter3: FilterResult;  // Rally in sector
  filter4: FilterResult;  // TOP 8 validated
  allPass: boolean;
  ticker: string | null;
  sectorName: string | null;
  rallyScore: number | null;
  top8Score: number | null;
  trailingTight: string | null;
  trailingMedium: string | null;
  needsScans: string[];   // which scans still need to run
}

// ─── Signal evaluation (pure client-side, no API calls) ───────────────────────

export function evaluateOptimalSignal(
  marketRegime: MarketRegime,
  flowsState: IntraDayFlowsState,
  rallyState: RallyState,
  top8: Top8Asset[],
): OptimalSignal {
  const needsScans: string[] = [];

  // ── Filter 1: Market regime ────────────────────────────────────────────────
  const regimeBullish  = marketRegime === "BULLISH";
  const regimeUnknown  = marketRegime === "UNKNOWN";
  const alarma = marketRegime === "BEARISH";

  const f1: FilterResult = {
    pass:    regimeUnknown ? null : regimeBullish,
    pending: regimeUnknown,
    label:   "Régimen de mercado",
    detail:  regimeUnknown ? "Calculando…" : regimeBullish ? "ALCISTA ✓" : "BAJISTA — No operar",
  };

  // ── Filter 2: Sector with strongest inflow ─────────────────────────────────
  const flowsDone = flowsState.status === "DONE";
  if (!flowsDone) needsScans.push("SCAN FLOWS");

  const winningSector = flowsDone
    ? (flowsState.sectors ?? []).find(s => s.intradayChange > 0.3 && s.relativeVolume >= 1.2)
    : null;

  const f2: FilterResult = {
    pass:    !flowsDone ? null : !!winningSector,
    pending: !flowsDone,
    label:   "Sector con flujo institucional",
    detail:  !flowsDone
      ? "Ejecuta SCAN FLOWS"
      : winningSector
        ? `${winningSector.name}  +${winningSector.intradayChange.toFixed(2)}%  Vol ${winningSector.relativeVolume.toFixed(1)}x`
        : "Sin sector claro hoy",
  };

  // ── Filter 3: Rally Leader inside winning sector ───────────────────────────
  const rallyDone = rallyState.status === "RALLY_FINAL" || rallyState.status === "RALLY_PARTIAL_DIAGNOSTIC";
  if (!rallyDone) needsScans.push("SCAN RALLY");

  const rallyInSector = (rallyDone && winningSector)
    ? (rallyState.top10 ?? []).filter(r => {
        const sector = STOCK_SECTOR[r.ticker.toUpperCase()];
        return sector === winningSector.key;
      })
    : [];
  const topRally = rallyInSector[0] ?? null;

  const f3: FilterResult = {
    pass:    !rallyDone ? null : !!topRally,
    pending: !rallyDone,
    label:   "Rally Leader en el sector",
    detail:  !rallyDone
      ? "Ejecuta SCAN RALLY"
      : topRally
        ? `${topRally.ticker}  Rally Score ${topRally.rallyScore}`
        : winningSector
          ? `Sin Rally Leader en ${winningSector.name}`
          : "Esperando sector",
  };

  // ── Filter 4: Same stock in TOP 8 ─────────────────────────────────────────
  const fullDone = top8.length > 0;
  if (!fullDone) needsScans.push("SCAN FULL");

  const top8Match = (fullDone && topRally)
    ? top8.find(a => a.ticker === topRally.ticker)
    : null;

  const scoreNum = top8Match ? parseFloat(String(top8Match.score ?? 0)) : 0;
  const scoreOk  = scoreNum >= 80;

  const f4: FilterResult = {
    pass:    !fullDone ? null : (!!top8Match && scoreOk),
    pending: !fullDone,
    label:   "Validado en TOP 8 (score ≥ 80)",
    detail:  !fullDone
      ? "Ejecuta SCAN FULL"
      : top8Match && scoreOk
        ? `Score ${scoreNum.toFixed(1)}  ·  ${top8Match.risk ?? "—"}  ·  Conviction ${top8Match.conviction}`
        : top8Match
          ? `Score ${scoreNum.toFixed(1)} — insuficiente (< 80)`
          : topRally
            ? `${topRally.ticker} no está en el TOP 8`
            : "Esperando coincidencia",
  };

  // ── Final result ───────────────────────────────────────────────────────────
  const allPass = !alarma &&
    f1.pass === true && f2.pass === true && f3.pass === true && f4.pass === true;

  return {
    alarma,
    filter1: f1,
    filter2: f2,
    filter3: f3,
    filter4: f4,
    allPass,
    ticker:         allPass ? topRally!.ticker : null,
    sectorName:     winningSector?.name ?? null,
    rallyScore:     topRally?.rallyScore ?? null,
    top8Score:      allPass ? scoreNum : null,
    trailingTight:  allPass && top8Match ? String(top8Match.trailingAdjusted ?? "—") : null,
    trailingMedium: allPass && top8Match ? String(top8Match.trailingMedium ?? "—") : null,
    needsScans,
  };
}

// ─── Filter row ───────────────────────────────────────────────────────────────

function FilterRow({ index, filter, alarma }: { index: number; filter: FilterResult; alarma: boolean }) {
  const { pass, label, detail, pending } = filter;

  const icon = pending || pass === null
    ? <span style={{ fontSize: 14, color: "#475569" }}>○</span>
    : pass
      ? <span style={{ fontSize: 14, color: "#10b981" }}>✓</span>
      : <span style={{ fontSize: 14, color: "#ef4444" }}>✗</span>;

  const detailColor = pending || pass === null
    ? "#475569"
    : pass
      ? "#34d399"
      : alarma && index === 0 ? "#ef4444" : "#f87171";

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "7px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ width: 20, flexShrink: 0, paddingTop: 1 }}>{icon}</div>
      <div style={{ minWidth: 24, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>{index}</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>{label}</div>
        <div style={{ fontSize: 10, fontWeight: 600, color: detailColor, marginTop: 1 }}>{detail}</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  marketRegime: MarketRegime;
  flowsState: IntraDayFlowsState;
  rallyState: RallyState;
  top8: Top8Asset[];
}

export function OptimalSignalPanel({ marketRegime, flowsState, rallyState, top8 }: Props) {
  const s = evaluateOptimalSignal(marketRegime, flowsState, rallyState, top8);

  return (
    <section style={{
      marginBottom: 14,
      borderRadius: 12,
      overflow: "hidden",
      border: s.alarma
        ? "2px solid rgba(239,68,68,0.6)"
        : s.allPass
          ? "2px solid rgba(16,185,129,0.5)"
          : "1px solid rgba(255,255,255,0.08)",
      background: s.alarma
        ? "rgba(239,68,68,0.06)"
        : s.allPass
          ? "rgba(16,185,129,0.06)"
          : "rgba(255,255,255,0.02)",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
        background: s.alarma
          ? "rgba(239,68,68,0.12)"
          : s.allPass
            ? "rgba(16,185,129,0.12)"
            : "rgba(255,255,255,0.03)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{
          fontSize: 11, fontWeight: 900, letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: s.alarma ? "#ef4444" : s.allPass ? "#10b981" : "#64748b",
        }}>
          🎯 Señal Óptima
        </span>

        {/* ALARM */}
        {s.alarma && (
          <span style={{
            fontSize: 11, fontWeight: 900, color: "#ef4444",
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 999, padding: "3px 10px",
            animation: "pulse 1.5s infinite",
            letterSpacing: "0.06em",
          }}>
            🚨 MERCADO BAJISTA — NO OPERAR
          </span>
        )}

        {/* PENDING scans */}
        {!s.alarma && !s.allPass && s.needsScans.length > 0 && (
          <span style={{ fontSize: 9, color: "#475569" }}>
            Pendiente: {s.needsScans.join(" · ")}
          </span>
        )}

        {/* ALL PASS */}
        {s.allPass && (
          <span style={{
            fontSize: 10, fontWeight: 800, color: "#10b981",
            background: "rgba(16,185,129,0.12)",
            border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: 999, padding: "3px 10px",
          }}>
            ✓ TODOS LOS FILTROS
          </span>
        )}
      </div>

      {/* ── Filters ── */}
      <div style={{ padding: "4px 14px 8px" }}>
        <FilterRow index={1} filter={s.filter1} alarma={s.alarma} />
        <FilterRow index={2} filter={s.filter2} alarma={s.alarma} />
        <FilterRow index={3} filter={s.filter3} alarma={s.alarma} />
        <FilterRow index={4} filter={s.filter4} alarma={s.alarma} />
      </div>

      {/* ── PERFECT TICKET ── */}
      {s.allPass && s.ticker && (
        <div style={{
          margin: "0 12px 12px",
          padding: "14px 16px",
          borderRadius: 10,
          background: "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.08) 100%)",
          border: "1px solid rgba(16,185,129,0.35)",
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#10b981", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            Ticket perfecto · Comprar en Interactive Brokers
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

            {/* Ticker */}
            <div>
              <div style={{ fontSize: 36, fontWeight: 900, color: "#ffffff", letterSpacing: "-1px", lineHeight: 1 }}>
                {s.ticker}
              </div>
              <div style={{ fontSize: 10, color: "#34d399", marginTop: 3 }}>
                {s.sectorName}  ·  Rally {s.rallyScore}  ·  Score {s.top8Score?.toFixed(1)}
              </div>
            </div>

            {/* Trailing stops */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Trailing Stop (pon en IB)
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#10b981" }}>{s.trailingTight}</div>
                  <div style={{ fontSize: 8, color: "#475569" }}>TIGHT</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#34d399" }}>{s.trailingMedium}</div>
                  <div style={{ fontSize: 8, color: "#475569" }}>MEDIUM</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Not ready state ── */}
      {!s.allPass && !s.alarma && s.needsScans.length === 0 && (
        <div style={{ padding: "10px 14px 14px", textAlign: "center", fontSize: 10, color: "#334155" }}>
          Filtros activos — sin confluencia perfecta hoy
        </div>
      )}
    </section>
  );
}
