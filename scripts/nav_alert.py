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
        {"ticker": "MRNA", "uds": 13.81, "divisa": "USD", "stop_pct": 45, "ancla": 144.71},
        {"ticker": "MU",   "uds": 1.97,  "divisa": "USD", "stop_pct": 45, "ancla": 1022.40},
        {"ticker": "DELL", "uds": 3.78,  "divisa": "USD", "stop_pct": 45, "ancla": 527.59},
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
    """Último precio y máximo del día desde Yahoo (sin clave). None si falla."""
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
        return (float(px) if px is not None else None,
                float(hi) if hi is not None else None)
    except Exception as e:
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


def enviar_mensaje(texto: str) -> bool:
    """iMessage/SMS a través de Messages.app. Best-effort: si el Mac no tiene
    Messages configurado (o el reenvío de SMS del iPhone está apagado), falla en
    silencio y el email sigue siendo el canal principal."""
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
            return None, f"sin precio de {p['ticker']}"
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
    guardar_json(STATE_FILE, estado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
