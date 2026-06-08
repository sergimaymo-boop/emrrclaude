import { useEffect, useState } from "react";

/**
 * useIsNarrow — true cuando el viewport es más estrecho que `breakpoint` px.
 *
 * Permite que los componentes con estilos inline (sin media queries CSS)
 * cambien entre un layout denso horizontal (desktop) y uno apilado vertical
 * (móvil) sin que las columnas se solapen — el patrón de terminal financiera
 * que debe verse bien en cualquier ancho.
 */
export function useIsNarrow(breakpoint = 480): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsNarrow(window.innerWidth < breakpoint);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isNarrow;
}
