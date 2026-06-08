import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** Nombre del área protegida (p.ej. "Rally Leaders") — se muestra en el fallback y en los logs. */
  label?: string;
  /** Si es true, el fallback es compacto (para envolver un panel individual en vez de toda la app). */
  inline?: boolean;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * ErrorBoundary — red de seguridad anti-pantalla-en-blanco.
 *
 * React, sin un boundary, DESMONTA todo el árbol cuando un componente lanza
 * una excepción durante el render → la app entera queda en blanco. Este
 * componente captura ese error, lo aísla y muestra un fallback con un botón de
 * recarga, en lugar de tumbar el dashboard completo.
 *
 * Uso:
 *   - Envolviendo toda la app (en App.tsx) → fallback a pantalla completa.
 *   - Envolviendo cada panel con `inline` → si un módulo falla, el resto del
 *     dashboard sigue funcionando.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message ?? "Error desconocido" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log para diagnóstico; no relanza, así el árbol hermano sobrevive.
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`, error, info?.componentStack);
  }

  private handleReload = () => {
    // Recarga limpia (sin caché) para recuperar el último bundle desplegado.
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { label, inline } = this.props;

    if (inline) {
      return (
        <section
          className="section-block"
          style={{
            marginTop: 16,
            border: "1px solid rgba(239,68,68,0.25)",
            background: "rgba(239,68,68,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#f87171" }}>
                {label ?? "Módulo"} no disponible
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                Este módulo tuvo un error y se aisló para no afectar al resto del dashboard.
              </div>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: "6px 14px", fontSize: 9, fontWeight: 800, letterSpacing: "0.05em",
                textTransform: "uppercase", cursor: "pointer", borderRadius: 8,
                border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#fca5a5",
              }}
            >
              Reintentar
            </button>
          </div>
        </section>
      );
    }

    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#0a0a12",
          color: "#f1f5f9",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.04em" }}>EMRR</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f87171" }}>
          La aplicación encontró un error inesperado
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", maxWidth: 420 }}>
          Hemos evitado que la pantalla quede en blanco. Pulsa recargar para volver a la última versión.
        </div>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 8, padding: "10px 22px", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em",
            textTransform: "uppercase", cursor: "pointer", borderRadius: 10,
            border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.15)", color: "#c7d2fe",
          }}
        >
          Recargar
        </button>
      </main>
    );
  }
}
