#!/usr/bin/env python3
"""
AVISO DE PATRIMONIO — "avísame cuando la cuenta supere los 23.500 €" (mandato Sergi 9-sep-2026)
===============================================================================================
Vigila el NAV total de la cuenta de IBK (posiciones + efectivo) y avisa por EMAIL
(Mail.app, la misma vía que rally_weekly_report.py y cartera_ibk_export.py — sin
credenciales nuevas) y por iMessage/SMS (Messages.app, best-effort) en cuanto
cruza el umbral.

⚠️ LÍMITE HONESTO — ESTO ES UNA RECONSTRUCCIÓN, NO EL DATO DEL BRÓKER.
No hay conexión con Interactive Brokers: el NAV se RECALCULA a partir de las
posiciones conocidas (foto del 8-sep-2026) valoradas con precios de Yahoo, más el
efectivo de esa misma foto. Diverge del número real de IBK por: comisiones y
dividendos posteriores, intereses del efectivo, FX intradía, y CUALQUIER operación
que Sergi haga sin actualizar `posiciones.json`. Se avisa con margen y el email lo
dice explícitamente: el número que manda es el de la app de IBK.

GUARDAS:
  · CARTERA OBSOLETA: si algún ticker cae por debajo de su trailing estimado (el
    script sigue el máximo desde el 8-sep, igual que el TRAIL de IBK), la posición
    probablemente se vendió → el NAV reconstruido deja de ser fiable: se avisa de
    ello UNA vez y se marca el estado como "requiere foto nueva".
  · TRAMOS (26-sep-2026): cuando el NAV supera en 1.000 € la marca de agua (base
    23.500 €), email con el reparto del tramo según el top-5 de Rally-Test; la
    marca sube al NAV del aviso. Prueba: --dry-run --force-tramo.
  · ANTIRREBOTE: se avisa una sola vez al cruzar. Solo se re-arma si el NAV vuelve
    a caer por debajo de RESET (23.200 €), para no repetir el email si oscila.
  · Si Mail.app falla NO se marca el estado → se reintenta en la siguiente pasada.

Uso:  python3 nav_alert.py [--status] [--dry-run] [--force]
Estado y logs: ~/Library/Application Support/NavAlert/
"""
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

UMBRAL_EUR = 23500.0          # aviso cuando el NAV lo SUPERA
RESET_EUR = 23200.0           # por debajo de esto se re-arma el aviso
MAIL_FROM_ACCOUNT = "sergimaymo@gmail.com"
MAIL_TO = "sergimaymo@gmail.com"
SMS_TO = "+34648423777"

PROBLEMAS_DATOS: list = []   # incidencias de las fuentes en esta pasada

STATE_DIR = os.path.expanduser("~/Library/Application Support/NavAlert")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
POS_FILE = os.path.join(STATE_DIR, "posiciones.json")
LOG_FILE = os.path.join(STATE_DIR, "nav_alert.log")

# Cartera de referencia (foto IBK 8-sep-2026 15:48). Editable en posiciones.json:
# si Sergi opera, hay que actualizar ese fichero o el NAV reconstruido miente.
POSICIONES_DEFECTO = {
    "fecha_foto": "2026-09-08",
    "efectivo_eur": 9580.00,      # "EUR Efectivo" de la app
    "efectivo_usd": 5115.00,      # "USD Efectivo" de la app
    "nav_foto_eur": 22374.0,      # NAV que mostraba IBK ese día (para calibrar el sesgo)
    "posiciones": [
        {"ticker": "MRNA", "uds": 13.81, "divisa": "USD", "stop_pct": 45, "ancla": 145.10},
        {"ticker": "MU",   "uds": 1.97,  "divisa": "USD", "stop_pct": 45, "ancla": 1024.00},
        {"ticker": "DELL", "uds": 3.78,  "divisa": "USD", "stop_pct": 45, "ancla": 533.88},
        {"ticker": "WDC",  "uds": 4.09,  "divisa": "USD", "stop_pct": 45, "ancla": 479.05},
        {"ticker": "INTC", "uds": 17.87, "divisa": "USD", "stop_pct": 45, "ancla": 105.46},
    ],
}


def log(msg: str) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    linea = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(linea)
    try:
        with open(LOG_FILE, "a") as fh:
            fh.write(linea + "\n")
    except Exception:
        pass


def cargar_json(path, defecto):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return defecto


def guardar_json(path, obj):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(obj, fh, indent=1, ensure_ascii=False)


def precio(sym: str):
    """Último precio y máximo del día desde Yahoo, CON VALIDACIONES.
    Devuelve (precio, maximo). En caso de dato no fiable devuelve (None, None) y
    deja el motivo en PROBLEMAS_DATOS — que dispara un email de aviso a Sergi
    (mandato 9-sep-2026: "avísame cuando las bases de datos no den bien el dato").
    ⛔ NUNCA se lee meta.chartPreviousClose: su valor depende del rango pedido y
    el 9-sep-2026 produjo una variación diaria falsa (ver scripts/precios.mjs)."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
           "?range=5d&interval=1d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            j = json.load(r)
        res = j["chart"]["result"][0]
        meta = res.get("meta", {})
        px = meta.get("regularMarketPrice")
        q = res["indicators"]["quote"][0]
        highs = [h for h in q.get("high", []) if h is not None]
        hi = max(highs) if highs else None
        if px is None:
            closes = [c for c in q.get("close", []) if c is not None]
            px = closes[-1] if closes else None
        if px is None:
            PROBLEMAS_DATOS.append(f"{sym}: la fuente no devuelve precio")
            return (None, None)
        px = float(px)
        if not (px > 0):
            PROBLEMAS_DATOS.append(f"{sym}: precio no válido ({px})")
            return (None, None)
        # frescura: un precio de hace más de 5 días es rancio (¿ticker suspendido?)
        t = meta.get("regularMarketTime")
        if t:
            edad = (datetime.now(timezone.utc) - datetime.fromtimestamp(t, timezone.utc)).days
            if edad > 5:
                PROBLEMAS_DATOS.append(f"{sym}: último precio de hace {edad} días (¿suspendido?)")
        # coherencia con el último cierre de la SERIE (no con chartPreviousClose)
        closes = [c for c in q.get("close", []) if c is not None]
        if len(closes) >= 2:
            ref = float(closes[-2] if abs(closes[-1] - px) < 1e-9 else closes[-1])
            if ref > 0 and abs(px / ref - 1) > 0.35:
                PROBLEMAS_DATOS.append(
                    f"{sym}: salto de {(px / ref - 1) * 100:+.0f}% frente al cierre previo ({ref:.2f} → {px:.2f}) — dato sospechoso")
                return (None, None)
        return (px, float(hi) if hi is not None else None)
    except Exception as e:
        PROBLEMAS_DATOS.append(f"{sym}: fallo de la fuente ({e})")
        log(f"AVISO: Yahoo falló para {sym} ({e})")
        return (None, None)


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


def enviar_email(asunto: str, cuerpo: str) -> bool:
    script = f'''
    tell application "Mail"
        set newMsg to make new outgoing message with properties {{subject:"{_esc(asunto)}", content:"{_esc(cuerpo)}\n", visible:false}}
        tell newMsg
            set sender to "{_esc(MAIL_FROM_ACCOUNT)}"
            make new to recipient at end of to recipients with properties {{address:"{_esc(MAIL_TO)}"}}
        end tell
        send newMsg
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], timeout=40,
                           capture_output=True, text=True)
        if r.returncode != 0:
            log(f"AVISO: email falló ({r.stderr.strip()[:200]})")
            return False
        return True
    except Exception as e:
        log(f"AVISO: email falló ({e})")
        return False


def _llavero(servicio: str):
    """Lee un secreto del llavero de macOS (nunca del repo ni del chat)."""
    try:
        r = subprocess.run(["security", "find-generic-password", "-s", servicio, "-w"],
                           timeout=10, capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
    except Exception:
        return None


def enviar_telegram(texto: str) -> bool:
    """Telegram con el MISMO bot del aviso diario (TELEGRAM_BOT_TOKEN/CHAT_ID de
    Vercel), guardado en el llavero como emrr-telegram-token / emrr-telegram-chat.
    Best-effort: sin credenciales o con error, el email sigue siendo el canal principal."""
    token, chat = _llavero("emrr-telegram-token"), _llavero("emrr-telegram-chat")
    if not token or not chat:
        log("NOTA: Telegram sin configurar (faltan emrr-telegram-token/chat en el llavero)")
        return False
    try:
        datos = json.dumps({"chat_id": chat, "text": texto}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=datos,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = bool(json.load(r).get("ok"))
        if not ok:
            log("NOTA: Telegram respondió sin ok")
        return ok
    except Exception as e:
        log(f"NOTA: Telegram no enviado ({str(e)[:160]})")
        return False


def enviar_mensaje(texto: str) -> bool:
    """Canales móviles: Telegram + iMessage/SMS (Messages.app). Best-effort: si
    fallan, el email sigue siendo el canal principal."""
    enviar_telegram(texto)
    script = f'''
    tell application "Messages"
        set svc to 1st account whose service type = iMessage
        send "{_esc(texto)}" to participant "{SMS_TO}" of svc
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], timeout=30,
                           capture_output=True, text=True)
        if r.returncode != 0:
            log(f"NOTA: iMessage no enviado ({r.stderr.strip()[:160]})")
            return False
        return True
    except Exception as e:
        log(f"NOTA: iMessage no enviado ({e})")
        return False


def calcular():
    pos = cargar_json(POS_FILE, POSICIONES_DEFECTO)
    fx, _ = precio("EURUSD=X")
    if not fx:
        return None, "sin tipo de cambio EUR/USD"
    filas, invertido_usd, sospechas = [], 0.0, []
    estado = cargar_json(STATE_FILE, {})
    anclas = dict(estado.get("anclas", {}))
    for p in pos["posiciones"]:
        px, hi = precio(p["ticker"])
        if px is None:
            return None, f"sin dato fiable de {p['ticker']}"
        # el trailing persigue el máximo: se actualiza el ancla como hace IBK
        ancla = max(float(anclas.get(p["ticker"], p["ancla"])), p["ancla"], hi or px)
        anclas[p["ticker"]] = ancla
        nivel = ancla * (1 - p["stop_pct"] / 100.0)
        if px <= nivel:
            sospechas.append(f"{p['ticker']} ({px:.2f} ≤ stop {nivel:.2f})")
        valor = p["uds"] * px
        invertido_usd += valor
        filas.append({"t": p["ticker"], "uds": p["uds"], "px": px,
                      "valor_eur": valor / fx, "nivel": nivel, "ancla": ancla})
    invertido_eur = invertido_usd / fx
    efectivo_eur = pos["efectivo_eur"] + pos["efectivo_usd"] / fx
    nav = invertido_eur + efectivo_eur
    return {"nav": nav, "invertido": invertido_eur, "efectivo": efectivo_eur,
            "fx": fx, "filas": filas, "sospechas": sospechas,
            "fecha_foto": pos["fecha_foto"], "nav_foto": pos.get("nav_foto_eur"),
            "anclas": anclas}, None


def main() -> int:
    dry = "--dry-run" in sys.argv
    force = "--force" in sys.argv
    solo_estado = "--status" in sys.argv
    os.makedirs(STATE_DIR, exist_ok=True)
    if not os.path.exists(POS_FILE):
        guardar_json(POS_FILE, POSICIONES_DEFECTO)
        log(f"posiciones.json creado desde la foto del {POSICIONES_DEFECTO['fecha_foto']}")

    d, err = calcular()
    if err:
        log(f"sin dato ({err}) — se reintenta en la próxima pasada")
        return 0

    estado = cargar_json(STATE_FILE, {})
    estado["anclas"] = d["anclas"]
    estado["ultimo_nav"] = round(d["nav"], 2)
    estado["ultima_comprobacion"] = datetime.now(timezone.utc).isoformat()

    linea = (f"NAV reconstruido {d['nav']:,.0f} € "
             f"(invertido {d['invertido']:,.0f} + efectivo {d['efectivo']:,.0f}) "
             f"· umbral {UMBRAL_EUR:,.0f} € · faltan {UMBRAL_EUR - d['nav']:,.0f} €"
             if d["nav"] < UMBRAL_EUR else
             f"NAV reconstruido {d['nav']:,.0f} € — UMBRAL {UMBRAL_EUR:,.0f} € SUPERADO")
    log(linea.replace(",", "."))
    if solo_estado:
        for f in d["filas"]:
            print(f"  {f['t']:<5} {f['uds']:>6} uds × {f['px']:>9.2f} = {f['valor_eur']:>8.0f} € · trailing en {f['nivel']:.2f}")
        print(f"  EUR/USD {d['fx']:.4f} · foto de cartera del {d['fecha_foto']}")
        if d["sospechas"]:
            print("  ⚠ posible stop saltado: " + ", ".join(d["sospechas"]))
        guardar_json(STATE_FILE, estado)
        return 0

    # ── guarda: cartera probablemente desactualizada ───────────────────────────
    if d["sospechas"] and not estado.get("aviso_stop_enviado"):
        cuerpo = ("Un valor de la cartera ha caído por debajo de su trailing stop estimado:\n  "
                  + "\n  ".join(d["sospechas"])
                  + "\n\nSi el stop saltó de verdad, la cartera ya no es la de la foto del "
                  + f"{d['fecha_foto']} y el NAV que calculo deja de ser fiable.\n"
                  + "Pásame una foto nueva de la cartera para reajustar el vigilante.\n\n"
                  + "(Aviso automático de EMRR · NavAlert)")
        if not dry and enviar_email("EMRR · posible stop saltado — la cartera vigilada puede estar desactualizada", cuerpo):
            estado["aviso_stop_enviado"] = True
            enviar_mensaje("EMRR: posible stop saltado. Revisa IBK y pásame foto nueva de la cartera.")
            log("aviso de posible stop ENVIADO")

    # ── AVISO DE CALIDAD DEL DATO (mandato Sergi 9-sep-2026) ───────────────────
    # Si las fuentes fallan, Sergi debe ENTERARSE: un vigilante mudo que no puede
    # leer precios es peor que ninguno. Antirrebote: como mucho un email al día.
    hoy_txt = datetime.now().strftime("%Y-%m-%d")
    if PROBLEMAS_DATOS and estado.get("aviso_datos_dia") != hoy_txt:
        cuerpo = ("El vigilante no ha podido leer bien los datos de mercado:\n  "
                  + "\n  ".join(PROBLEMAS_DATOS)
                  + "\n\nMientras esto ocurra, el NAV que calculo puede no ser fiable "
                  + "y el aviso de los 23.500 € podría llegar tarde o no llegar.\n"
                  + "El dato que manda siempre es el de la app de IBK.\n\n"
                  + "(Aviso automático de EMRR · NavAlert)")
        if not dry and enviar_email("EMRR · las fuentes de datos no responden bien", cuerpo):
            estado["aviso_datos_dia"] = hoy_txt
            log(f"aviso de CALIDAD DE DATO enviado ({len(PROBLEMAS_DATOS)} incidencias)")
        enviar_mensaje("EMRR: las fuentes de datos fallan; el vigilante del patrimonio puede no ser fiable hoy.")
    elif not PROBLEMAS_DATOS and estado.get("aviso_datos_dia"):
        estado.pop("aviso_datos_dia", None)   # se resolvió: re-armado para el futuro

    # ── aviso principal de umbral ──────────────────────────────────────────────
    ya = bool(estado.get("aviso_umbral_enviado"))
    if ya and d["nav"] < RESET_EUR:
        estado["aviso_umbral_enviado"] = False
        ya = False
        log(f"NAV por debajo de {RESET_EUR:,.0f} € — aviso re-armado".replace(",", "."))

    if (d["nav"] > UMBRAL_EUR and not ya) or force:
        detalle = "\n".join(
            f"  {f['t']:<5} {f['uds']:>6} uds × {f['px']:>9.2f} USD = {f['valor_eur']:>8,.0f} €".replace(",", ".")
            for f in d["filas"])
        cuerpo = (
            f"La cuenta ha superado los {UMBRAL_EUR:,.0f} €.\n\n".replace(",", ".")
            + f"NAV reconstruido: {d['nav']:,.0f} €\n".replace(",", ".")
            + f"  · invertido: {d['invertido']:,.0f} €\n".replace(",", ".")
            + f"  · efectivo:  {d['efectivo']:,.0f} €\n".replace(",", ".")
            + f"  · EUR/USD:   {d['fx']:.4f}\n\n"
            + "Posiciones valoradas:\n" + detalle + "\n\n"
            + "⚠ Cifra RECONSTRUIDA a partir de la foto de cartera del "
            + f"{d['fecha_foto']} y precios de Yahoo. No es el dato oficial del bróker:\n"
            + "  el número que manda es el de la app de IBK. Ábrela para confirmarlo.\n\n"
            + "(Aviso automático de EMRR · NavAlert)")
        if dry:
            log("DRY-RUN: no se envía nada. Cuerpo del aviso:\n" + cuerpo)
        else:
            if enviar_email(f"EMRR · la cuenta supera los {UMBRAL_EUR:,.0f} €".replace(",", "."), cuerpo):
                estado["aviso_umbral_enviado"] = True
                estado["enviado_en"] = datetime.now(timezone.utc).isoformat()
                estado["nav_al_avisar"] = round(d["nav"], 2)
                log(f"AVISO DE UMBRAL ENVIADO por email (NAV {d['nav']:,.0f} €)".replace(",", "."))
                enviar_mensaje(
                    f"EMRR: la cuenta supera los {UMBRAL_EUR:,.0f} EUR "
                    f"(NAV estimado {d['nav']:,.0f} EUR). Confirma en la app de IBK.".replace(",", "."))
            else:
                log("email NO enviado — el estado no se marca, se reintenta.")

    # ── TRAMO DE CARGA CON GANANCIAS (regla de Sergi, 26-sep-2026) ─────────────
    aviso_tramo(d, estado, dry, force="--force-tramo" in sys.argv)
    guardar_json(STATE_FILE, estado)
    return 0


# Regla de Sergi (26-sep-2026): el capital inicial (23.500 €) no se arriesga más;
# solo se invierte lo GANADO por encima de una marca de agua, en tramos de 1.000 €,
# repartido según el top-5 del último scan de Rally-Test.
CAPITAL_BASE_EUR = 23500.0
TRAMO_EUR = 1000.0
RALLY_TEST_LAST_URL = "https://emrrclaude.vercel.app/api/rally-test/last"


def top5_rally_test():
    """Top-5 invertido (peso > 0) del último scan COMPLETO de Rally-Test."""
    try:
        req = urllib.request.Request(RALLY_TEST_LAST_URL, headers={"User-Agent": "EMRR-NavAlert"})
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.load(r)
    except Exception as e:
        PROBLEMAS_DATOS.append(f"scan de Rally-Test no disponible ({e})")
        return None, None
    if not j.get("ok") or not j.get("isRallyFinal") or j.get("coveragePercent") != 100:
        PROBLEMAS_DATOS.append("el último scan de Rally-Test no está completo al 100%")
        return None, None
    top = [a for a in j.get("top10", []) if (a.get("suggestedWeightPct") or 0) > 0]
    if not top or abs(sum(a["suggestedWeightPct"] for a in top) - 100) > 0.5:
        PROBLEMAS_DATOS.append("los pesos del scan de Rally-Test no suman 100%")
        return None, None
    return top, j.get("scanCompletedAtUtc")


def aviso_tramo(d, estado, dry, force=False):
    """Avisa cuando NAV − marca de agua ≥ TRAMO_EUR, con las compras por ticker.
    La marca sube al NAV del aviso (se da por hecho que Sergi invierte el tramo):
    una ganancia ya avisada no se vuelve a contar."""
    marca = float(estado.get("marca_agua_eur", CAPITAL_BASE_EUR))
    estado.setdefault("marca_agua_eur", marca)
    exceso = d["nav"] - marca
    if exceso < TRAMO_EUR and not force:
        return
    importe = min(exceso, d["efectivo"])
    if importe < TRAMO_EUR * 0.5 and not force:
        log(f"tramo disponible {exceso:,.0f} € pero solo quedan {d['efectivo']:,.0f} € de efectivo".replace(",", "."))
        return
    top, cuando = top5_rally_test()
    if not top:
        log("tramo pendiente: sin scan fiable de Rally-Test — se reintenta")
        return
    filas, manuales = [], []
    for a in top:
        eur = importe * a["suggestedWeightPct"] / 100.0
        px, _ = precio(a["ticker"] if a.get("currency") == "USD" else a.get("providerSymbol", a["ticker"]))
        if px is None or a.get("currency") not in ("USD", "EUR"):
            manuales.append(f"  {a['ticker']:<5} {a['suggestedWeightPct']:>5.1f}% → {eur:>6,.0f} € (calcular las acciones en IBK)".replace(",", "."))
            continue
        px_eur = px / d["fx"] if a["currency"] == "USD" else px
        uds = eur / px_eur
        filas.append(f"  {a['ticker']:<5} {a['suggestedWeightPct']:>5.1f}% → {eur:>6,.0f} € ≈ {uds:.2f} acciones a {px:.2f} {a['currency']}".replace(",", "."))
    try:
        fecha_scan = datetime.fromisoformat(cuando.replace("Z", "+00:00"))
        edad = (datetime.now(timezone.utc) - fecha_scan).days
        txt_scan = fecha_scan.strftime("%d-%m-%Y %H:%M UTC") + (
            f"  ⚠ tiene {edad} días: pulsa SCAN en el panel antes de comprar" if edad >= 3 else "")
    except Exception:
        txt_scan = str(cuando)
    cuerpo = (
        f"La cuenta ha ganado {exceso:,.0f} € por encima de tu marca de {marca:,.0f} €.\n".replace(",", ".")
        + "Según tu regla, toca invertir un tramo de " + f"{importe:,.0f}".replace(",", ".") + " € del efectivo.\n\n"
        + f"Reparto según el top-5 de Rally-Test (scan del {txt_scan}):\n"
        + "\n".join(filas + manuales) + "\n\n"
        + "Recuerda:\n"
        + "  · añadir la cantidad nueva a la orden TRAIL 45% de cada ticker (una sola orden por ticker con la posición entera)\n"
        + "  · si entra un ticker nuevo, ponerle su TRAIL 45% GTC\n"
        + "  · subir la foto de IBK al dashboard para que el seguimiento cuadre\n\n"
        + f"Nueva marca: {d['nav']:,.0f} €. El próximo aviso llegará cuando la cuenta la supere en {TRAMO_EUR:,.0f} €.\n".replace(",", ".")
        + f"NAV reconstruido con precios de Yahoo (EUR/USD {d['fx']:.4f}); el dato que manda es el de la app de IBK.\n"
        + "Parte de la ganancia puede venir del cambio euro/dólar, no solo de las acciones.\n\n"
        + "(Aviso automático de EMRR · NavAlert)")
    if dry:
        log("DRY-RUN tramo: no se envía nada. Cuerpo:\n" + cuerpo)
        return
    if enviar_email(f"EMRR · toca invertir un tramo de {importe:,.0f} € (ganancias)".replace(",", "."), cuerpo):
        estado["marca_agua_eur"] = round(d["nav"], 2)
        estado.setdefault("tramos", []).append(
            {"fecha": datetime.now(timezone.utc).isoformat(), "importe": round(importe, 2),
             "marca_anterior": marca, "nav": round(d["nav"], 2)})
        log(f"AVISO DE TRAMO enviado: {importe:,.0f} € (marca {marca:,.0f} → {d['nav']:,.0f})".replace(",", "."))
        enviar_mensaje(f"EMRR: la cuenta ha ganado {exceso:,.0f} EUR sobre tu marca. ".replace(",", ".")
                       + f"Toca invertir un tramo de {importe:,.0f} EUR del efectivo:\n".replace(",", ".")
                       + "\n".join(filas + manuales) + "\nDetalle en tu Gmail.")
    else:
        log("email del tramo NO enviado — la marca no se mueve, se reintenta.")


if __name__ == "__main__":
    sys.exit(main())
