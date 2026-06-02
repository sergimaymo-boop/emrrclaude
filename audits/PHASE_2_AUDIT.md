# Auditoria tecnica - Fase 2

## Estado

Fase 2 consolida el proyecto para Vercel manteniendo la aplicacion en modo visual/mock-only.

## 1. Compatibilidad Vercel

- Stack: React + TypeScript + Vite.
- `vercel.json` declara framework `vite`, install command, build command y output directory.
- `vite.config.ts` queda sin puertos fijos ni `strictPort`.
- No hay backend requerido para Fase 2.

## 2. Restos Replit

- No existe `.replit`.
- No existe `replit.nix`.
- No hay scripts Replit.
- Las menciones a Replit quedan solo como documentacion historica/auditoria en `MASTER_CODEX_V1.md`.

## 3. Scripts package.json

Scripts disponibles:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview"
}
```

## 4. Build local

Bloqueo de entorno actual:

- `npm` no esta disponible en el PATH de esta sesion Codex.
- Por ese motivo no se pudo ejecutar `npm install` ni `npm run build` aqui.
- El proyecto queda preparado para ejecutarlos en un entorno con Node/npm completo.

## 5. Estructura de carpetas

Estructura consolidada:

```text
src/
  components/
  engines/
  mocks/
  pages/
  styles/
  types/
  utils/
shared/
  types/
docs/
audits/
exports/
backups/
data/
server/
  engines/
  routes/
```

`server/` permanece solo como stub/documentacion, sin API real.

## 6. Rutas

- App Vite de una sola entrada (`index.html` + `src/main.tsx`).
- Sin rutas rotas conocidas.
- Sin dependencia de rutas absolutas del Mac en runtime.

## 7. Dependencias

- Sin dependencias nuevas innecesarias.
- No se agrego Supabase, Auth.js, Clerk, bases de datos ni SDKs financieros.

## 8. Variables de entorno

- Fase 2 no requiere variables.
- `.env.example` contiene placeholders futuros sin secretos reales.
- `.gitignore` excluye `.env` y `.env.*`.

## 9. Seguridad

- No hay secrets en codigo.
- No hay API keys reales.
- Login sigue siendo DEV ONLY mock.

## 10. Ausencias confirmadas

- NO APIs reales.
- NO EODHD real.
- NO Finnhub real.
- NO CNN real.
- NO scanner real.
- NO scoring real.
- NO trailing real operativo.
- NO base de datos real.
- NO Supabase/Auth real.
- NO usuarios reales.
- NO pagos.
- NO polling.
- NO auto-refresh.

## 11. Responsive y UI Fase 1

- La UI de Fase 1 se mantiene.
- Header tecnico, System Status, botones, Estado Scan, Fear & Greed, Master Indicators, Sectores lideres y TOP 8 siguen presentes.

## 12. Riesgos antes de Fase 3

- Build/deploy Vercel ya validado tras correccion de zona horaria `Atlantic/Canary`.
- Mantener APIs bloqueadas hasta autorizacion explicita.
- Decidir proveedor de persistencia compatible con Vercel antes de guardar datos reales.
- Disenar `timezoneEngine` y `marketHoursEngine` para detectar fecha/hora/zona del dispositivo o navegador, permitir override manual futuro y calcular apertura por exchange real.

## 13. Recomendacion

Fase 2 queda tecnicamente preparada para uso personal, pero la aprobacion final debe esperar a que `npm install`, `npm run build` y preview Vercel se ejecuten correctamente en un entorno con npm disponible.

## 14. Decision de alcance comercial y dispositivos

- Uso actual: personal.
- Supabase/Auth/usuarios/clientes quedan diferidos hasta que exista necesidad real de clientes.
- La base web responsive debe conservar compatibilidad futura con Apple y Android, pero no se implementa app nativa ni PWA en Fase 2.
- Esta decision reduce coste, complejidad y superficie de seguridad antes de validar el producto.
- La fecha/hora del usuario debe ser automatica en fases futuras sin provocar scans automaticos ni llamadas a APIs financieras.
