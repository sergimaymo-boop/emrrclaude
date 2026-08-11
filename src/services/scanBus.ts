/**
 * scanBus — bus de escaneo global del dashboard.
 *
 * Contrato (mandato Sergi 11-ago-2026): el botón grande SCAN EMRR debe actualizar
 * TODOS los módulos, los presentes y los futuros. Cada módulo registra aquí su
 * función de escaneo al montarse; el botón global ejecuta todas sin necesitar
 * conocerlas. Un módulo nuevo solo tiene que llamar a registerModuleScan() y queda
 * automáticamente incluido en el scan global — sin tocar DashboardPage.
 *
 * Los módulos siguen siendo independientes: cada scan corre aislado, un fallo en
 * uno NO tumba a los demás (allSettled), y los botones pequeños de cada panel
 * siguen escaneando solo su módulo.
 */

export interface ModuleScanResult {
  name: string;
  ok: boolean;
  error?: string;
}

type ScanFn = () => Promise<void>;

const registry = new Map<string, ScanFn>();

/** Registra el scan de un módulo. Devuelve la función para des-registrarse al desmontar. */
export function registerModuleScan(name: string, fn: ScanFn): () => void {
  registry.set(name, fn);
  return () => {
    // Solo borra si sigue siendo la misma función (evita que un remount viejo
    // des-registre el handler nuevo por la carrera montar→desmontar de React).
    if (registry.get(name) === fn) registry.delete(name);
  };
}

/** Nombres de los módulos registrados ahora mismo (para mostrar en la UI). */
export function registeredModules(): string[] {
  return [...registry.keys()];
}

/**
 * Ejecuta el scan de TODOS los módulos registrados, en paralelo y aislados.
 * Nunca lanza: devuelve el resultado por módulo para que el llamador informe.
 */
export async function runAllModuleScans(): Promise<ModuleScanResult[]> {
  const entries = [...registry.entries()];
  // Wrapper async: si un fn futuro lanzara SÍNCRONAMENTE (antes de devolver su
  // promesa), sin esto el .map() reventaría y ningún módulo completaría el ciclo.
  const settled = await Promise.allSettled(entries.map(async ([, fn]) => fn()));
  return settled.map((s, i) => ({
    name: entries[i][0],
    ok: s.status === "fulfilled",
    error: s.status === "rejected" ? String((s as PromiseRejectedResult).reason ?? "error") : undefined,
  }));
}
