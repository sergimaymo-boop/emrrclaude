import { signalHistory, type SignalRecord } from "../services/signalHistory";
import { RSSparkline } from "./RSSparkline";

export function SignalHistoryPanel() {
  const history = signalHistory.getHistory();

  if (history.length === 0) {
    return (
      <section className="section-block">
        <div className="section-title-row" style={{ marginBottom: 8 }}>
          <h2>Histórico de Señales</h2>
          <span style={{ fontSize: 10, color: "#64748b" }}>Últimas 5 confluencias</span>
        </div>
        <div style={{ padding: "20px 0", textAlign: "center", color: "#475569", fontSize: 13 }}>
          Sin señales guardadas aún
        </div>
      </section>
    );
  }

  return (
    <section className="section-block">
      <div className="section-title-row" style={{ marginBottom: 8 }}>
        <h2>Histórico de Señales</h2>
        <span style={{ fontSize: 10, color: "#64748b" }}>{history.length} confluencia{history.length > 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {history.map((signal, idx) => (
          <SignalRow key={signal.id} signal={signal} rank={idx + 1} />
        ))}
      </div>
    </section>
  );
}

function SignalRow({ signal, rank }: { signal: SignalRecord; rank: number }) {
  const date = new Date(signal.timestamp);
  const dateStr = date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const isAlarm = signal.isAlarm;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "10px 12px",
      borderRadius: 10,
      background: "rgba(255,255,255,0.025)",
      border: `1px solid ${isAlarm ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
      gap: 10,
    }}>
      {/* Rank */}
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        background: isAlarm ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
        border: `1px solid ${isAlarm ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 800, color: isAlarm ? "#ef4444" : "#10b981",
        flexShrink: 0,
      }}>
        {rank}
      </div>

      {/* Ticker + Sector */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 900, color: isAlarm ? "#f87171" : "#ffffff",
          letterSpacing: "0.04em",
        }}>
          {signal.ticker}
        </div>
        <div style={{ fontSize: 9, color: "#475569", marginTop: 1 }}>
          {signal.sector}  ·  {dateStr} {timeStr}
        </div>
      </div>

      {/* Scores */}
      <div style={{
        display: "flex", gap: 8, alignItems: "center",
        fontSize: 10, fontWeight: 700, color: "#94a3b8",
        flexShrink: 0,
      }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#c9a227" }}>{signal.rallyScore}</div>
          <div style={{ fontSize: 8, color: "#475569" }}>Rally</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#10b981" }}>{signal.top8Score.toFixed(1)}</div>
          <div style={{ fontSize: 8, color: "#475569" }}>Score</div>
        </div>
      </div>

      {/* Status badge */}
      <div style={{
        fontSize: 8, fontWeight: 800, padding: "3px 7px",
        borderRadius: 4,
        background: signal.marketOpen ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)",
        color: signal.marketOpen ? "#10b981" : "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        flexShrink: 0,
      }}>
        {signal.marketOpen ? "LIVE" : "CLOSED"}
      </div>

      {/* Alert badge if bearish */}
      {isAlarm && (
        <div style={{
          fontSize: 8, fontWeight: 800, padding: "3px 7px",
          borderRadius: 4,
          background: "rgba(239,68,68,0.15)",
          color: "#ef4444",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          flexShrink: 0,
        }}>
          ⚠️ Bearish
        </div>
      )}
    </div>
  );
}
