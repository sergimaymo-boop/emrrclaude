---
name: verify
description: Receta de verificación runtime de EMRR/OPTIMAL SUPREME — build, superficie web y sondas de cartera
---

# Verificación runtime de EMRR

## Superficies
- **Producción (preferida — tiene datos reales)**: https://emrrclaude.vercel.app
- **Dev**: `preview_start {name: "emrr-dev"}` (config en .claude/launch.json, puerto 5173) — SIN datos de scan (KV vacío): sembrar localStorage para ver el panel de cartera.

## Entrar al dashboard
La home es un login ficticio: clicar el botón "ENTER DASHBOARD" (via javascript:
`[...document.querySelectorAll("button")].find(x => /ENTER/i.test(x.textContent)).click()`).
OJO: leer `document.body.innerText` en el MISMO eval del click devuelve el estado pre-render — leer en una llamada separada.

## Datos del panel SUPREME
- API: `curl https://emrrclaude.vercel.app/api/optimal2026` — ok:true + items + cachedAtUtc. TTL del KV = 26h: tras un fin de semana sin scans puede estar VACÍO (404 NO_DATA) — no es bug.
- Para regenerarlo end-to-end: clicar "⟳ Scan O26" (tarda ~1-2 min, barra de progreso visible, 12 batches en servidor). Verifica el pipeline completo runBreadthScan → persist → panel.

## Sembrar cartera IBK (localStorage, key `optimal2026_ibk_portfolio_v1`)
```js
localStorage.setItem("optimal2026_ibk_portfolio_v1", JSON.stringify({
  positions: [{ symbol: "WDC", name: "…", quantity: 6, avgCost: null, currentPrice: 541.61, marketValue: 3251, unrealizedPnL: -12, currency: "USD" }],
  loadedAt: new Date().toISOString(), source: "IBK_PHOTO",
  cashBalance: 15100, accountTotal: 21873,
})); location.reload();
```
Histórico: key `optimal2026_ibk_history_v1`.

## Sondas que valen la pena
- **✎ editar efectivo**: debe abrir el editor aunque accountTotal venga de la foto.
- **Limpiar**: debe borrar AMBAS keys de localStorage y volver al prompt de subida.
- **accountTotal corrupto** (< suma de posiciones, p.ej. dígito perdido del OCR): debe descartarse — sin "% inv." >100 ni órdenes "Reducir" falsas; degrada a pedir efectivo manual.
- **Parser OCR** (sin foto real): tests unitarios en el scratchpad de sesión no persisten; verificar como mínimo que el modo cabecera existe: `grep detectColumnMap src/services/optimal2026Refresh.ts`.

## Gotchas
- Los textos con `text-transform: uppercase` aparecen en MAYÚSCULAS en innerText ("Plan sistemático" → "PLAN SISTEMÁTICO") — buscar en mayúsculas.
- El viewport móvil (375px) es donde vivían los bugs de layout — verificar ahí (resize_window preset mobile).
- El scan manual y el auto-15:00 comparten mutex (o26ScanActiveRef): no lanzar dos a la vez.
- Al terminar, limpiar el localStorage sembrado (producción es la app real del usuario).
