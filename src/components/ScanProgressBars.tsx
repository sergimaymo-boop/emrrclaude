import { useEffect, useRef, useState } from "react";
import type { ScanState } from "../types";
import type { RallyState } from "../services/rallyRefresh";
import type { IntraDayFlowsState } from "./IntraDayFlowsPanel";

interface Props {
  scanState: ScanState;
  rallyState: RallyState;
  flowsState: IntraDayFlowsState;
}

interface BarState {
  visible: boolean;
  pct: number;        // 0-100
  done: boolean;
}

const HIDE_DELAY_MS = 5000;
const GOLD_COLOR  = "#c9a227";
const DONE_COLOR  = "#10b981";
const TRACK_COLOR = "rgba(255,255,255,0.07)";

// Animated fill bar
function Bar({
  label, sublabel, pct, scanning, done,
}: {
  label: string; sublabel: string;
  pct: number; scanning: boolean; done: boolean;
}) {
  const color = done ? DONE_COLOR : GOLD_COLOR;
  const textColor = done ? "#34d399" : "#c9a227";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {/* Labels */}
      <div style={{ width: 90, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: textColor, letterSpacing: "0.06em" }}>
          {label}
        </div>
        <div style={{ fontSize: 8, fontWeight: 600, color: "#475569", letterSpacing: "0.04em" }}>
          {sublabel}
        </div>
      </div>

      {/* Track + fill */}
      <div style={{
        flex: 1, height: 8, background: TRACK_COLOR,
        borderRadius: 4, overflow: "hidden", position: "relative",
      }}>
        <div style={{
          position: "absolute", left: 0, top: 0,
          width: `${pct}%`, height: "100%",
          background: done
            ? DONE_COLOR
            : `linear-gradient(90deg, #9a7510, ${GOLD_COLOR}, #e8c347)`,
          borderRadius: 4,
          transition: done ? "width 300ms ease" : "width 600ms ease",
          // Shimmer animation while scanning
          backgroundSize: scanning ? "200% 100%" : "100% 100%",
          animation: scanning && !done ? "shimmer 1.8s infinite linear" : "none",
        }} />
      </div>

      {/* Percentage */}
      <div style={{
        width: 36, textAlign: "right", flexShrink: 0,
        fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums",
        color: textColor,
      }}>
        {pct}%
      </div>

      {/* Status badge */}
      <div style={{ width: 18, flexShrink: 0, textAlign: "center" }}>
        {done ? (
          <span style={{ fontSize: 12, color: DONE_COLOR }}>✓</span>
        ) : scanning ? (
          <span style={{
            display: "inline-block", width: 7, height: 7, borderRadius: "50%",
            background: GOLD_COLOR, animation: "pulse 1s infinite",
          }} />
        ) : null}
      </div>
    </div>
  );
}

export function ScanProgressBars({ scanState, rallyState, flowsState }: Props) {
  // Each bar tracks: is it visible? (visible during scan + 5s after 100%)
  const [full,  setFull]  = useState<BarState>({ visible: false, pct: 0, done: false });
  const [rally, setRally] = useState<BarState>({ visible: false, pct: 0, done: false });
  const [flows, setFlows] = useState<BarState>({ visible: false, pct: 0, done: false });

  // Fake animated progress for flows (single-shot scan, no real pct)
  const [flowsFakePct, setFlowsFakePct] = useState(0);
  const flowsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fullHideRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rallyHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowsHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SCAN FULL ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const pct = scanState.coveragePercent ?? 0;
    const scanning = scanState.isScanning;

    if (scanning) {
      if (fullHideRef.current) clearTimeout(fullHideRef.current);
      setFull({ visible: true, pct, done: false });
    } else if (pct === 100 && full.visible) {
      setFull({ visible: true, pct: 100, done: true });
      fullHideRef.current = setTimeout(() => setFull({ visible: false, pct: 0, done: false }), HIDE_DELAY_MS);
    } else if (!scanning && pct > 0 && pct < 100 && full.visible) {
      // Paused mid-scan — keep visible, show current pct
      setFull(prev => ({ ...prev, pct }));
    }
  }, [scanState.isScanning, scanState.coveragePercent]);

  // ── SCAN RALLY ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const pct = rallyState.coveragePercent ?? 0;
    const scanning = rallyState.isScanning;

    if (scanning) {
      if (rallyHideRef.current) clearTimeout(rallyHideRef.current);
      setRally({ visible: true, pct, done: false });
    } else if (pct === 100 && rally.visible) {
      setRally({ visible: true, pct: 100, done: true });
      rallyHideRef.current = setTimeout(() => setRally({ visible: false, pct: 0, done: false }), HIDE_DELAY_MS);
    }
  }, [rallyState.isScanning, rallyState.coveragePercent]);

  // ── SCAN FLOWS (fake animated progress) ───────────────────────────────────
  useEffect(() => {
    if (flowsState.status === "SCANNING") {
      if (flowsHideRef.current) clearTimeout(flowsHideRef.current);
      setFlows({ visible: true, pct: 0, done: false });
      setFlowsFakePct(0);

      // Animate 0 → 90 over ~3s while scanning
      let current = 0;
      flowsTimerRef.current = setInterval(() => {
        current = Math.min(current + Math.random() * 8 + 4, 90);
        setFlowsFakePct(Math.round(current));
        if (current >= 90 && flowsTimerRef.current) {
          clearInterval(flowsTimerRef.current);
        }
      }, 200);

    } else if (flowsState.status === "DONE") {
      if (flowsTimerRef.current) clearInterval(flowsTimerRef.current);
      setFlowsFakePct(100);
      setFlows({ visible: true, pct: 100, done: true });
      flowsHideRef.current = setTimeout(() => {
        setFlows({ visible: false, pct: 0, done: false });
        setFlowsFakePct(0);
      }, HIDE_DELAY_MS);

    } else if (flowsState.status === "ERROR") {
      if (flowsTimerRef.current) clearInterval(flowsTimerRef.current);
      setFlows({ visible: false, pct: 0, done: false });
      setFlowsFakePct(0);
    }

    return () => {
      if (flowsTimerRef.current) clearInterval(flowsTimerRef.current);
    };
  }, [flowsState.status]);

  // Sync fake pct into flows bar state
  useEffect(() => {
    if (flows.visible && !flows.done) {
      setFlows(prev => ({ ...prev, pct: flowsFakePct }));
    }
  }, [flowsFakePct]);

  const anyVisible = full.visible || rally.visible || flows.visible;
  if (!anyVisible) return null;

  return (
    <>
      {/* Shimmer CSS */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div style={{
        margin: "0 0 10px",
        padding: "10px 14px 12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(201,162,39,0.18)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {full.visible  && (
          <Bar label="SCAN FULL"  sublabel="TOP 8 INSTITUCIONAL"
               pct={full.pct}   scanning={scanState.isScanning}  done={full.done} />
        )}
        {rally.visible && (
          <Bar label="SCAN RALLY" sublabel="LÍDERES DE RALLY"
               pct={rally.pct}  scanning={rallyState.isScanning} done={rally.done} />
        )}
        {flows.visible && (
          <Bar label="SCAN FLOWS" sublabel="FLUJOS DE CAPITAL"
               pct={flows.pct}  scanning={flowsState.status === "SCANNING"} done={flows.done} />
        )}
      </div>
    </>
  );
}
