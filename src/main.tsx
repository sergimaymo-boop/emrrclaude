import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

// Manejadores globales: registran (sin tumbar la app) errores y promesas
// rechazadas no capturadas — diagnóstico + no perder excepciones asíncronas
// que un Error Boundary de React no puede capturar.
window.addEventListener("error", (event) => {
  console.error("[global error]", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled rejection]", event.reason);
});

const rootElement = document.getElementById("root")!;

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Montaje exitoso: marca el #root (el fallback de index.html lo respeta) y
// limpia el flag de auto-recarga, para que un futuro fallo de carga de bundle
// pueda volver a auto-recuperarse una vez.
rootElement.setAttribute("data-mounted", "true");
try {
  sessionStorage.removeItem("emrr-chunk-reloaded");
} catch {
  /* sessionStorage no disponible (modo privado) — ignorar */
}
