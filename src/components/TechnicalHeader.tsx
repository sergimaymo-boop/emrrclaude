import type { SystemStatus } from "../types";

interface TechnicalHeaderProps {
  systemStatus: SystemStatus;
  onLogout: () => void;
}

function dataModeDot(mode: string): string {
  if (mode === "REAL") return "#10b981";
  if (mode === "ERROR" || mode === "DATA_UNAVAILABLE") return "#ef4444";
  return "#eab308";
}

export function TechnicalHeader({ systemStatus, onLogout }: TechnicalHeaderProps) {
  const u = systemStatus.technical.universeStats;
  const dotColor = dataModeDot(systemStatus.dashboardDataMode);

  return (
    <header style={{
      display: "grid",
      gridTemplateColumns: "1fr auto",
      alignItems: "center",
      gap: 12,
      padding: "20px 0 16px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      marginBottom: 16,
    }}>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <h1 style={{margin:0,fontSize:28,fontWeight:900,letterSpacing:"-0.5px",color:"#ffffff",lineHeight:1}}>
            EMRR
          </h1>
          <span style={{
            fontSize:10,fontWeight:800,letterSpacing:"0.12em",
            color:"#f59e0b",textTransform:"uppercase",
            padding:"3px 8px",border:"1px solid rgba(245,158,11,0.3)",
            borderRadius:4,
          }}>
            INSTITUTIONAL
          </span>
          <span style={{
            width:8,height:8,borderRadius:"50%",
            background:dotColor,
            boxShadow:`0 0 8px ${dotColor}`,
          }} />
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"#6b7280",fontWeight:600}}>
            {systemStatus.dashboardDataMode}
          </span>
          <span style={{fontSize:11,color:"#6b7280"}}>
            Operational {systemStatus.operationalDataStatus}
          </span>
          {u.universeDiscovered > 0 && (
            <span style={{fontSize:11,color:"#6b7280"}}>
              Universe <strong style={{color:"#9ca3af"}}>{u.universeDiscovered.toLocaleString()}</strong>
            </span>
          )}
          {u.finalTop8Count > 0 && (
            <span style={{fontSize:11,color:"#6b7280"}}>
              TOP 8 <strong style={{color:"#f59e0b"}}>{u.finalTop8Count}</strong>
            </span>
          )}
          <span style={{fontSize:11,color:"#4b5563"}}>
            {systemStatus.updatedAt.local}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        style={{
          padding:"8px 16px",
          background:"transparent",
          border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:6,
          color:"#6b7280",
          fontSize:11,
          fontWeight:700,
          letterSpacing:"0.06em",
          textTransform:"uppercase",
          cursor:"pointer",
        }}
      >
        Logout
      </button>
    </header>
  );
}
