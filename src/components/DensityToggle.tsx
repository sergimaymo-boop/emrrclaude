export type Density = "compact" | "detail";

/**
 * SegmentedControl — versión genérica del DensityToggle.
 * Mismos estilos, mismos colores, misma pill-container.
 * Úsalo en cualquier módulo que necesite un desplegable o un conmutador.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Opciones",
}: {
  options: { key: T; label: string; icon?: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        flexShrink: 0,
        gap: 3,
        padding: 3,
        borderRadius: 10,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            style={{
              minWidth: 96,
              padding: "6px 12px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
              lineHeight: 1,
              cursor: "pointer",
              borderRadius: 7,
              border: "none",
              background: active ? "#6366f1" : "transparent",
              color: active ? "#ffffff" : "#94a3b8",
              boxShadow: active ? "0 1px 6px rgba(99,102,241,0.45)" : "none",
              transition: "background 120ms, color 120ms",
            }}
          >
            {o.icon && <span style={{ fontSize: 12, lineHeight: 1 }}>{o.icon}</span>}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * DensityToggle — conmutador COMPACTO / DETALLE.
 *
 * Dos botones EXACTAMENTE iguales (mismo ancho mínimo, mismo padding, texto
 * centrado y sin recortar) con un estado activo de alto contraste. Reutilizado
 * por Top 8 y Rally Leaders para que ambos módulos se vean idénticos.
 *
 * `flexShrink: 0` en el contenedor garantiza que nunca se aplaste/recorte
 * dentro de una cabecera estrecha (el bug anterior: "DET…" cortado).
 */
export function DensityToggle({
  value,
  onChange,
}: {
  value: Density;
  onChange: (next: Density) => void;
}) {
  const options: { key: Density; label: string; icon: string }[] = [
    { key: "compact", label: "COMPACTO", icon: "▤" },
    { key: "detail", label: "DETALLE", icon: "☰" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Densidad de la tabla"
      style={{
        display: "inline-flex",
        flexShrink: 0,
        gap: 3,
        padding: 3,
        borderRadius: 10,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            style={{
              minWidth: 96,
              padding: "6px 12px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
              lineHeight: 1,
              cursor: "pointer",
              borderRadius: 7,
              border: "none",
              background: active ? "#6366f1" : "transparent",
              color: active ? "#ffffff" : "#94a3b8",
              boxShadow: active ? "0 1px 6px rgba(99,102,241,0.45)" : "none",
              transition: "background 120ms, color 120ms",
            }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>{o.icon}</span>
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
