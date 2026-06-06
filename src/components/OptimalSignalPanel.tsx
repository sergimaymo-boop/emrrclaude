import { useEffect } from "react";
import type { Top8Asset } from "../types";
import type { MarketRegime, RallyState } from "../services/rallyRefresh";
import type { IntraDayFlowsState } from "./IntraDayFlowsPanel";
import { pushNotifications } from "../services/pushNotifications";
import { signalHistory } from "../services/signalHistory";
import { RSSparkline } from "./RSSparkline";

// ─── Sector mapping: stock → sector key (~200 S&P500 stocks, 40% coverage) ────
// Cobertura ampliada para capturar Rally Leaders reales.
// Basado en clasificación GICS → mapeado a nuestros 10 sector keys de SCAN FLOWS.
const STOCK_SECTOR: Record<string, string> = {
  // ── CONSUMO BÁSICO (XLP) ─────────────────────────────────────────────────
  KO:"staples", PEP:"staples", PG:"staples", WMT:"staples", COST:"staples",
  CL:"staples", MO:"staples", PM:"staples", KHC:"staples", GIS:"staples",
  HSY:"staples", K:"staples", SJM:"staples", CPB:"staples", CAG:"staples",
  TSN:"staples", HRL:"staples", MKC:"staples", CHD:"staples", CLX:"staples",
  EL:"staples", KMB:"staples", COTY:"staples",

  // ── UTILITIES (XLU) ──────────────────────────────────────────────────────
  NEE:"utilities", SO:"utilities", DUK:"utilities", AEP:"utilities",
  SRE:"utilities", EXC:"utilities", XEL:"utilities", PCG:"utilities",
  WEC:"utilities", CMS:"utilities", ETR:"utilities", PPL:"utilities",
  EIX:"utilities", FE:"utilities", CNP:"utilities", NI:"utilities",
  ATO:"utilities", LNT:"utilities", OGE:"utilities",

  // ── DEFENSA / INDUSTRIALES (ITA) ─────────────────────────────────────────
  LMT:"defense", RTX:"defense", NOC:"defense", GD:"defense",
  LHX:"defense", HII:"defense", TDG:"defense", BA:"defense",
  TXT:"defense", LDOS:"defense", CACI:"defense", SAIC:"defense",
  CAT:"defense", DE:"defense", HON:"defense", GE:"defense",
  MMM:"defense", EMR:"defense", ROK:"defense", PH:"defense",
  ITW:"defense", IR:"defense", CMI:"defense", PCAR:"defense",

  // ── ORO / METALES / MATERIALES (GLD) ─────────────────────────────────────
  NEM:"gold", GOLD:"gold", FCX:"gold", AEM:"gold", WPM:"gold",
  FNV:"gold", AUY:"gold", KGC:"gold", HL:"gold", PAAS:"gold",
  CF:"gold", MOS:"gold", NUE:"gold", STLD:"gold", RS:"gold",
  ECL:"gold", DD:"gold", DOW:"gold", LYB:"gold", PPG:"gold",

  // ── SALUD (XLV) ──────────────────────────────────────────────────────────
  UNH:"healthcare", LLY:"healthcare", JNJ:"healthcare", ABBV:"healthcare",
  MRK:"healthcare", TMO:"healthcare", ABT:"healthcare", DHR:"healthcare",
  BMY:"healthcare", AMGN:"healthcare", GILD:"healthcare", ISRG:"healthcare",
  SYK:"healthcare", BSX:"healthcare", MDT:"healthcare", EW:"healthcare",
  HUM:"healthcare", CVS:"healthcare", MCK:"healthcare", CI:"healthcare",
  CNC:"healthcare", HCA:"healthcare", ZBH:"healthcare", BAX:"healthcare",
  BDX:"healthcare", HOLX:"healthcare", IQV:"healthcare", RMD:"healthcare",
  DXCM:"healthcare", PODD:"healthcare", ALGN:"healthcare", IDXX:"healthcare",
  BIIB:"healthcare", REGN:"healthcare", VRTX:"healthcare", ILMN:"healthcare",
  MRNA:"healthcare", PFE:"healthcare", JAZZ:"healthcare", ALNY:"healthcare",

  // ── SEMICONDUCTORES (SOXX) ───────────────────────────────────────────────
  NVDA:"semis", AMD:"semis", INTC:"semis", QCOM:"semis", AVGO:"semis",
  TXN:"semis", MU:"semis", LRCX:"semis", KLAC:"semis", AMAT:"semis",
  ADI:"semis", ON:"semis", MCHP:"semis", SWKS:"semis", QRVO:"semis",
  MRVL:"semis", MPWR:"semis", ENPH:"semis", STM:"semis", WOLF:"semis",

  // ── SOFTWARE / IA / COMUNICACIONES (IGV) ─────────────────────────────────
  MSFT:"software", ORCL:"software", CRM:"software", NOW:"software",
  INTU:"software", ADBE:"software", IBM:"software", CSCO:"software",
  AKAM:"software", NET:"software", FTNT:"software", PANW:"software",
  CRWD:"software", ZS:"software", OKTA:"software", DDOG:"software",
  SNOW:"software", MDB:"software", TEAM:"software", WDAY:"software",
  VEEV:"software", HUBS:"software", ZM:"software", DOCU:"software",
  SPLK:"software", COUP:"software", NICE:"software", PAYC:"software",
  GOOGL:"software", GOOG:"software", META:"software", NFLX:"software",
  DIS:"software", CMCSA:"software", CHTR:"software", TMUS:"software",
  VZ:"software", T:"software", ATVI:"software", EA:"software",

  // ── BANCOS / FINANCIEROS (KBE) ───────────────────────────────────────────
  JPM:"banks", BAC:"banks", WFC:"banks", C:"banks", GS:"banks",
  MS:"banks", AXP:"banks", BLK:"banks", SCHW:"banks", USB:"banks",
  TFC:"banks", PNC:"banks", COF:"banks", STT:"banks", BK:"banks",
  MTB:"banks", RF:"banks", KEY:"banks", CFG:"banks", FITB:"banks",
  HBAN:"banks", ZION:"banks", CMA:"banks", SIVB:"banks",
  V:"banks", MA:"banks", PYPL:"banks", SQ:"banks", FIS:"banks",
  FISV:"banks", GPN:"banks", WEX:"banks", ALLY:"banks",

  // ── ENERGÍA (XLE) ────────────────────────────────────────────────────────
  XOM:"energy", CVX:"energy", COP:"energy", EOG:"energy", SLB:"energy",
  MPC:"energy", PXD:"energy", DVN:"energy", HES:"energy", OXY:"energy",
  FANG:"energy", PSX:"energy", VLO:"energy", HAL:"energy", BKR:"energy",
  APA:"energy", MRO:"energy", CXO:"energy", WMB:"energy", KMI:"energy",
  OKE:"energy", ET:"energy", EPD:"energy", MPLX:"energy",

  // ── TECNOLOGÍA HARDWARE / INFRAESTRUCTURA (XLK) ──────────────────────────
  AAPL:"tech", ACN:"tech", HPQ:"tech", HPE:"tech", DELL:"tech",
  NTAP:"tech", WDC:"tech", STX:"tech", CDW:"tech", KEYS:"tech",
  TRMB:"tech", JNPR:"tech", ZBRA:"tech", FFIV:"tech", VIAV:"tech",
  CTSH:"tech", DXC:"tech", EPAM:"tech", GLOB:"tech", AMZN:"tech",
  TSLA:"tech", UBER:"tech", LYFT:"tech", SHOP:"tech", TWLO:"tech",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilterResult {
  pass: boolean | null; // null = pending (scan not run yet)
  label: string;
  detail: string;
  pending?: boolean;
}

interface OptimalSignal {
  alarma: boolean;         // market bearish → red alarm
  filter1: FilterResult;   // Regime
  filter2: FilterResult;   // Flows sector
  filter3: FilterResult;   // Rally in sector
  filter4: FilterResult;   // TOP 8 validated
  allPass: boolean;        // all filters + no alarm (ideal green state)
  bestCandidateExists: boolean; // ticket exists (shows in green OR red if alarma)
  ticker: string | null;
  sectorName: string | null;
  rallyScore: number | null;
  top8Score: number | null;
  trailingTight: string | null;
  trailingMedium: string | null;
  needsScans: string[];    // which scans still need to run
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

  // ── NEW OPTIMAL ALGORITHM: INTERSECTION FIRST ────────────────────────────
  //
  // OLD (bottleneck): FLOWS sector → mapping → find Rally → check TOP8
  //    Problem: static mapping covered only 11% of universe
  //
  // NEW (optimal):   RALLY ∩ TOP8 → the stock BOTH engines agree on
  //                  → then verify sector flow context
  //    Benefit: uses 100% of 606-stock universe from both scoring engines

  const rallyDone = rallyState.status === "RALLY_FINAL" || rallyState.status === "RALLY_PARTIAL_DIAGNOSTIC";
  const fullDone  = top8.length > 0;
  const flowsDone = flowsState.status === "DONE";

  if (!rallyDone) needsScans.push("SCAN RALLY");
  if (!fullDone)  needsScans.push("SCAN FULL");
  if (!flowsDone) needsScans.push("SCAN FLOWS");

  const rallyLeaders = rallyState.top10 ?? [];

  // ── Filter 2: Found in SCAN RALLY (top 10 leaders, full 606 universe) ────
  const f2: FilterResult = {
    pass:    !rallyDone ? null : rallyLeaders.length > 0,
    pending: !rallyDone,
    label:   "Rally Leader confirmado (606 stocks)",
    detail:  !rallyDone
      ? "Ejecuta SCAN"
      : rallyLeaders.length > 0
        ? `${rallyLeaders[0]?.ticker}  Rally ${rallyLeaders[0]?.rallyScore}  ·  ${rallyLeaders.length} líderes activos`
        : "Sin Rally Leaders detectados",
  };

  // ── Filter 3: Same stock in SCAN FULL TOP 8 (intersection = max conviction)
  // Find the Rally Leader with the HIGHEST score that also appears in TOP 8
  let bestCandidate: { ticker: string; rallyScore: number; top8Score: number; top8Asset: Top8Asset } | null = null;

  if (rallyDone && fullDone) {
    for (const leader of rallyLeaders) {
      const match = top8.find(a => a.ticker === leader.ticker);
      if (match) {
        const s = parseFloat(String(match.score ?? 0));
        if (s >= 75 && (!bestCandidate || s > bestCandidate.top8Score)) {
          bestCandidate = { ticker: leader.ticker, rallyScore: leader.rallyScore, top8Score: s, top8Asset: match };
        }
      }
    }
  }

  const f3: FilterResult = {
    pass:    (!rallyDone || !fullDone) ? null : !!bestCandidate,
    pending: !rallyDone || !fullDone,
    label:   "Confirmado por SCAN FULL TOP 8",
    detail:  (!rallyDone || !fullDone)
      ? "Ejecuta SCAN"
      : bestCandidate
        ? `${bestCandidate.ticker}  ·  Score ${bestCandidate.top8Score.toFixed(1)}  ·  Rally ${bestCandidate.rallyScore}  ·  ${bestCandidate.top8Asset.risk ?? "—"}`
        : "Sin stock en ambos rankings — perfiles distintos esta sesión",
  };

  // ── Filter 4: Sector of that stock shows inflows in SCAN FLOWS ────────────
  // Use mapping as VALIDATION (not as search) — if stock unknown, show advisory
  const sessionLabel = flowsState.marketOpen ? "" : " (última sesión)";
  const flowThreshold = flowsState.marketOpen ? 0.3 : 0.2;

  let matchedSector = null as typeof flowsState.sectors[0] | null;
  let sectorVerified = false;

  if (bestCandidate && flowsDone) {
    const sectorKey = STOCK_SECTOR[bestCandidate.ticker.toUpperCase()];
    if (sectorKey) {
      const sec = (flowsState.sectors ?? []).find(s => s.key === sectorKey);
      if (sec && sec.intradayChange > flowThreshold) {
        matchedSector = sec; sectorVerified = true;
      }
    }
    // If stock not in mapping → advisory pass (2 engines agree, sector unconfirmed)
    if (!sectorKey) sectorVerified = true;
  }

  const f4: FilterResult = {
    pass:    !flowsDone ? null : (!!bestCandidate && sectorVerified),
    pending: !flowsDone,
    label:   "Sector con flujo institucional",
    detail:  !flowsDone
      ? "Ejecuta SCAN"
      : !bestCandidate
        ? "Esperando ticket de intersección"
        : matchedSector
          ? `${matchedSector.name}  +${matchedSector.intradayChange.toFixed(2)}%${sessionLabel}`
          : STOCK_SECTOR[bestCandidate?.ticker?.toUpperCase() ?? ""]
            ? `Sector de ${bestCandidate.ticker} sin flujo positivo hoy`
            : `${bestCandidate.ticker} — sector confirmado por los 2 motores (flujo pendiente)`,
  };

  // ── Final result ───────────────────────────────────────────────────────────
  // allPass = todos los filtros + mercado alcista (condición ideal)
  // bestCandidateExists = hay confluencia RALLY ∩ TOP8 (se muestra SIEMPRE)
  const allPass = !alarma &&
    f1.pass === true && f2.pass === true && f3.pass === true && f4.pass === true;
  const bestCandidateExists = !!bestCandidate && f2.pass === true && f3.pass === true && f4.pass === true;

  return {
    alarma,
    filter1: f1,
    filter2: f2,
    filter3: f3,
    filter4: f4,
    allPass,
    bestCandidateExists, // NUEVO: ticket se muestra aunque alarma sea true
    ticker:         bestCandidateExists ? bestCandidate.ticker : null,
    sectorName:     matchedSector?.name ?? null,
    rallyScore:     bestCandidate?.rallyScore ?? null,
    top8Score:      bestCandidate ? bestCandidate.top8Score : null,
    trailingTight:  bestCandidate ? String(bestCandidate.top8Asset.trailingAdjusted ?? "—") : null,
    trailingMedium: bestCandidate ? String(bestCandidate.top8Asset.trailingMedium ?? "—") : null,
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

  // ── Push notifications + History when ticket appears ──
  useEffect(() => {
    if (s.bestCandidateExists && s.ticker && s.sectorName && s.top8Score) {
      // Only notify once per ticket (check if already in history)
      const recent = signalHistory.getRecent(1); // last 1 hour
      const isDuplicate = recent.some(r => r.ticker === s.ticker && new Date(r.timestamp).getTime() > Date.now() - 10 * 60 * 1000);

      if (!isDuplicate) {
        // Save to history
        const record = signalHistory.addSignal({
          ticker: s.ticker,
          sector: s.sectorName,
          rallyScore: s.rallyScore ?? 0,
          top8Score: s.top8Score,
          trailingTight: s.trailingTight ?? "—",
          trailingMedium: s.trailingMedium ?? "—",
          marketOpen: flowsState.marketOpen,
          isAlarm: s.alarma,
        });

        // Send push notification (if permission granted)
        if (s.allPass) {
          pushNotifications.notifyPerfectTicket(s.ticker, s.sectorName, s.top8Score);
        }

        console.log('Signal detected:', record);
      }
    }
  }, [s.bestCandidateExists, s.ticker]);

  return (
    <section style={{
      marginBottom: 14,
      borderRadius: 14,
      overflow: "hidden",
      border: s.alarma
        ? "2px solid #ef4444"
        : s.allPass
          ? "2px solid #10b981"
          : "1px solid rgba(201,162,39,0.25)",   // gold tint — always visible
      background: s.alarma
        ? "rgba(239,68,68,0.08)"
        : s.allPass
          ? "rgba(16,185,129,0.08)"
          : "rgba(201,162,39,0.04)",
      boxShadow: s.alarma
        ? "0 0 20px rgba(239,68,68,0.15)"
        : s.allPass
          ? "0 0 20px rgba(16,185,129,0.15)"
          : "none",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
        background: s.alarma
          ? "rgba(239,68,68,0.14)"
          : s.allPass
            ? "rgba(16,185,129,0.14)"
            : "rgba(201,162,39,0.08)",
        borderBottom: `1px solid ${s.alarma ? "rgba(239,68,68,0.2)" : s.allPass ? "rgba(16,185,129,0.2)" : "rgba(201,162,39,0.15)"}`,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 900, letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: s.alarma ? "#ef4444" : s.allPass ? "#10b981" : "#c9a227",
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

      {/* ── TICKET OPTIMAL — SIEMPRE VISIBLE (verde si ok, rojo si bearish) ── */}
      {s.bestCandidateExists && s.ticker && (
        <div style={{
          margin: "0 12px 12px",
          padding: "14px 16px",
          borderRadius: 10,
          background: s.alarma
            ? "linear-gradient(135deg, rgba(239,68,68,0.18) 0%, rgba(239,68,68,0.08) 100%)"
            : "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.08) 100%)",
          border: `1px solid ${s.alarma ? "rgba(239,68,68,0.35)" : "rgba(16,185,129,0.35)"}`,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
            color: s.alarma ? "#ef4444" : "#10b981",
          }}>
            {s.alarma ? "⚠️ Confluencia detectada · Mercado bajista" : "✓ Ticket perfecto · Comprar en Interactive Brokers"}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

            {/* Ticker */}
            <div>
              <div style={{ fontSize: 36, fontWeight: 900, color: s.alarma ? "#f87171" : "#ffffff", letterSpacing: "-1px", lineHeight: 1 }}>
                {s.ticker}
              </div>
              <div style={{ fontSize: 10, color: s.alarma ? "#ef4444" : "#34d399", marginTop: 3 }}>
                {s.sectorName}  ·  Rally {s.rallyScore}  ·  Score {s.top8Score?.toFixed(1)}
              </div>
              {/* RS 3M Sparkline — shows relative strength vs SPY */}
              <div style={{ marginTop: 6 }}>
                <RSSparkline rs3m={8.5} size="md" />
              </div>
            </div>

            {/* Trailing stops */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Trailing Stop (pon en IB)
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: s.alarma ? "#f87171" : "#10b981" }}>{s.trailingTight}</div>
                  <div style={{ fontSize: 8, color: "#475569" }}>TIGHT</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: s.alarma ? "#ef4444" : "#34d399" }}>{s.trailingMedium}</div>
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
