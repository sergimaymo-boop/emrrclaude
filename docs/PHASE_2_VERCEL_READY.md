# Fase 2 - Arquitectura Vercel-ready

## Objetivo

Consolidar EMRR 2.0 / Tendencias para Vercel sin avanzar a Fase 3. La app sigue siendo visual/mock-only y no incorpora datos reales ni logica financiera real.

## Cambios realizados

- Se simplifico `vite.config.ts` para usar configuracion Vite estandar sin puertos fijos ni `strictPort`.
- Se creo `vercel.json` con framework Vite, build command y output directory explicitos.
- Se creo `.env.example` solo con placeholders de variables futuras.
- Se consolidaron carpetas documentales y futuras: `audits`, `exports`, `backups` y `src/styles`.
- Se actualizo `README.md` para reflejar Fase 2.
- Se mantuvo intacta la UI mock-only de Fase 1.

## Comandos locales

```bash
npm install
npm run build
npm run dev
npm run preview
```

Resultado esperado:

- `npm install` instala dependencias.
- `npm run build` ejecuta TypeScript y Vite, generando `dist`.
- `npm run dev` abre servidor local Vite.
- `npm run preview` sirve el build local.

## Configuracion Vercel

- Framework Preset: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`
- Variables de entorno necesarias en Fase 2: ninguna

## Checklist Vercel

1. Crear o usar repositorio GitHub.
2. Subir el proyecto actualizado desde `/Users/sergimaymo/Desktop/Bolsa Codex/Tendencias`.
3. Entrar en Vercel.
4. Importar el proyecto.
5. Confirmar Framework Preset: `Vite`.
6. Confirmar Install Command: `npm install`.
7. Confirmar Build Command: `npm run build`.
8. Confirmar Output Directory: `dist`.
9. Confirmar variables de entorno: ninguna para Fase 2.
10. Ejecutar Deploy.
11. Abrir Preview URL.
12. Probar desktop.
13. Probar iPhone/responsive.
14. Confirmar que no hay pantalla en blanco.
15. Confirmar que no hay errores de build.
16. Confirmar que no hay errores de rutas.
17. Confirmar que no hay dependencia de Replit.


## Uso actual y futuro multiplataforma

Decision actual:

- El programa se construye primero para uso personal.
- Supabase/Auth/usuarios/clientes no se implementan ahora.
- Supabase u otra solucion de usuarios se evaluara solo cuando exista necesidad real de acceso para clientes.
- La UI debe seguir siendo web responsive y preparada para uso futuro en dispositivos Apple y Android mediante navegador, PWA o wrapper autorizado en fases futuras.
- La comprobacion visual movil debe priorizar iPhone 16 Pro Max y smartphones Android generalistas, evitando solapes, texto cortado y scroll horizontal roto.
- No se implementa app nativa Apple/Android en Fase 2.

## Requisito futuro de fecha, hora y zona horaria

- La aplicacion debe detectar automaticamente fecha, hora y zona horaria del dispositivo/navegador cuando sea posible.
- Debe permitir override manual futuro si el usuario viaja o el navegador detecta mal la ubicacion.
- Los timestamps visibles deben poder mostrarse en la zona horaria del usuario.
- El estado real de mercado debe calcularse por zona horaria del exchange, no solo por la zona del usuario.
- Ejemplos base: `Atlantic/Canary`, `Europe/Madrid`, `Europe/Rome`, `Europe/London`, `America/New_York`.
- Este requisito queda diferido a fases futuras del `marketHoursEngine` / `timezoneEngine`, sin APIs reales ni polling financiero en Fase 2.

## Variables futuras documentadas

Estas variables estan documentadas en `.env.example`, pero no son necesarias en Fase 2:

```text
VITE_APP_ENV
EODHD_API_KEY
FINNHUB_API_KEY
APP_PASSWORD
SUPABASE_URL (solo futuro clientes)
SUPABASE_ANON_KEY (solo futuro clientes)
AUTH_SECRET (solo futura autenticacion real)
AUTH_PROVIDER (solo futura autenticacion real)
```

Reglas:

- no usar valores reales en `.env.example`,
- no crear `.env` con secrets,
- no exponer API keys en frontend,
- no exigir variables para Fase 2.

## Que NO se implemento

- APIs reales.
- EODHD real.
- Finnhub real.
- CNN real.
- Scanner real.
- Scoring real.
- Trailing real operativo.
- Base de datos real.
- Supabase real.
- Auth real.
- Usuarios reales.
- Pagos.
- Polling.
- Auto-refresh.
- Cron jobs.
- Background jobs.

## Siguiente fase recomendada

No iniciar Fase 3 hasta que Fase 2 quede aprobada con build local y check/preview Vercel correcto.
