#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CarteraIBK — seguimiento de la cartera REAL que replica el top-5 de Rally-Test.

Decisión de Sergi (25-sep-2026): el plan se alinea con RALLY-TEST (su estrategia real
desde el 8-sep) y SOLO propone operar cuando lo manda el protocolo backtesteado:
  · REVISIÓN trimestral (63 sesiones de NYSE desde el último rebalanceo; la fecha la
    calcula el servidor en /api/rally-test/last → review), o
  · SALTO DE UN STOP (una posición desaparece de la foto de IBK, o su cierre rompe el
    trailing del 45%): re-escanear y reinvertir TODO según los pesos nuevos (RESCAN2,
    sin reiniciar el reloj de la revisión).
El resto de días envía, tras el cierre de EE. UU., una VALORACIÓN sin operaciones con las
tres capas de la norma suprema: rentabilidad sobre el capital invertido, movimiento de
los trailings y SUELO GARANTIZADO. Pérdidas SIEMPRE en % (nunca en euros).

Datos:
  · Foto IBK (/api/rally-scan/ibk-portfolio): SOLO unidades, NAV y efectivo. Los precios
    leídos por OCR NO se usan (el OCR confundía la columna de PyG con el precio: MU
    "217,28", INTC "407,23"…). Precios: Yahoo, serie diaria FECHADA, cierre crudo (el
    precio real al que opera IBK), marcando la vela EN CURSO y los huecos; nunca
    chartPreviousClose. EUR/USD: Yahoo EURUSD=X.
  · Rally-Test (/api/rally-test/last): top-5, pesos, trailing y calendario de revisión.

Se ejecuta vía launchd cada 5 min (el script que corre vive en Application Support por
TCC: tras editar este, `bash scripts/sync-cartera-agent.sh`).
Uso manual:  python3 scripts/cartera_ibk_export.py [--force] [--dry-run]
"""

import json
import math
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

BASE_URL = "https://emrrclaude.vercel.app"
RALLY_TEST_URL = f"{BASE_URL}/api/rally-test/last"
PORTFOLIO_URL = f"{BASE_URL}/api/rally-scan/ibk-portfolio"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval=1d&includePrePost=false"

MAIL_FROM_ACCOUNT = "sergimaymo@gmail.com"
MAIL_TO = "sergimaymo@gmail.com"

OUT_DIR_PREFERIDO = os.path.expanduser("~/Desktop/CarteraIBK")
OUT_DIR_ALTERNATIVO = os.path.expanduser("~/Library/Application Support/CarteraIBK/salidas")


def _resolver_out_dir() -> str:
    # El Escritorio está protegido por TCC y sincronizado con iCloud (lleno): si el
    # sistema impide escribir, se cae a Application Support. El email es la entrega real.
    for d in (OUT_DIR_PREFERIDO, OUT_DIR_ALTERNATIVO):
        try:
            os.makedirs(d, exist_ok=True)
            testigo = os.path.join(d, ".escritura")
            with open(testigo, "w") as fh:
                fh.write("ok")
            os.remove(testigo)
            return d
        except OSError:
            continue
    return OUT_DIR_ALTERNATIVO


OUT_DIR = _resolver_out_dir()
STATE_DIR = os.path.expanduser("~/Library/Application Support/CarteraIBK")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
LOG_FILE = os.path.join(STATE_DIR, "generator.log")
TZ = ZoneInfo("Atlantic/Canary")

TRAIL = 0.45
# Registro de la cartera REAL desde el rebalanceo del 8-sep-2026 (memoria del proyecto:
# cierres del 8-sep = línea base del seguimiento; coste = precio medio real de compra).
# ⚠ Tras cada rebalanceo trimestral hay que actualizar ENTRY_DATE, BASE_FX y este registro
# (y RALLY_TEST_LAST_REBALANCE en api/_lib/rallyScoreEngineTest.js).
ENTRY_DATE = "2026-09-08"
BASE_FX = 1.1627   # EUR/USD del 8-sep (valor base 8.383 €)
REGISTRO = {
    "MRNA": {"units": 13.81, "cost": 131.61, "base": 140.33, "currency": "USD"},
    "MU":   {"units": 1.97,  "cost": 971.06, "base": 1000.26, "currency": "USD"},
    "DELL": {"units": 3.78,  "cost": 453.08, "base": 533.88, "currency": "USD"},
    "WDC":  {"units": 4.09,  "cost": 471.28, "base": 477.30, "currency": "USD"},
    "INTC": {"units": 17.87, "cost": 97.84,  "base": 104.47, "currency": "USD"},
}
YAHOO_SUFFIX = {"US": "", "PA": ".PA", "AS": ".AS", "XETRA": ".DE", "MI": ".MI", "MC": ".MC",
                "BR": ".BR", "LSE": ".L", "SW": ".SW", "LS": ".LS", "HE": ".HE", "CO": ".CO",
                "ST": ".ST", "OL": ".OL", "VI": ".VI", "IR": ".IR"}

NAV_DRIFT_TOL = 0.40      # NAV nuevo dentro de ±40% del último bueno
NAV_IDENTITY_TOL = 0.10   # NAV ≈ valMdo + efectivo (±10%)
UNITS_VALUE_TOL = 0.30    # Σ uds × precio de hoy ≈ valMdo de la foto (±30%: la foto puede ser de días atrás)

# ── infra ────────────────────────────────────────────────────────────────────

def log(msg):
    os.makedirs(STATE_DIR, exist_ok=True)
    line = f"[{datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def fetch_json(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CarteraIBK/2.0)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def notify(title, body):
    try:
        subprocess.run(["osascript", "-e", f'display notification "{_as_str(body)}" with title "{_as_str(title)}"'],
                       timeout=10, capture_output=True)
    except Exception:
        pass


def _as_str(s):
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


def send_email(subject, body, attachments, dry_run=False):
    if dry_run:
        print("=" * 72 + f"\nASUNTO: {subject}\n" + "-" * 72 + f"\n{body}\n" + "=" * 72)
        if attachments:
            print("ADJUNTOS:", ", ".join(attachments))
        return True
    attach_lines = "\n".join(
        f'    make new attachment with properties {{file name:(POSIX file "{_as_str(p)}")}} at after the last paragraph'
        for p in attachments
    )
    script = f'''
    tell application "Mail"
        set newMsg to make new outgoing message with properties {{subject:"{_as_str(subject)}", content:"{_as_str(body)}\n", visible:false}}
        tell newMsg
            set sender to "{_as_str(MAIL_FROM_ACCOUNT)}"
            make new to recipient at end of to recipients with properties {{address:"{_as_str(MAIL_TO)}"}}
{attach_lines}
        end tell
        send newMsg
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], timeout=40, capture_output=True, text=True)
        if r.returncode != 0:
            log(f"AVISO: envío de email falló ({r.stderr.strip()[:200]})")
            return False
        return True
    except Exception as e:
        log(f"AVISO: envío de email falló ({e})")
        return False


def base_symbol(sym):
    return (sym or "").split(".")[0].strip().upper()


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def pct(x, dec=1):
    """Porcentaje con signo y coma decimal: +6,3% / −4,1%."""
    s = f"{abs(x) * 100:.{dec}f}".replace(".", ",")
    return ("+" if x >= 0 else "−") + s + "%"


def eur(x):
    return f"{x:,.0f} €".replace(",", ".")


def eur_si_ganancia(x):
    """Norma de Sergi: las pérdidas NUNCA en euros (solo %). Las ganancias sí."""
    return f" ({'+' + eur(x)})" if x > 0 else ""


def fecha_larga(iso):
    if not iso:
        return "—"
    d = datetime.strptime(iso[:10], "%Y-%m-%d")
    dias = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
    meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
    return f"{dias[d.weekday()]} {d.day}-{meses[d.month - 1]}-{d.year}"


def fecha_corta(iso):
    if not iso:
        return "—"
    return f"{iso[8:10]}/{iso[5:7]}"

# ── precios validados (mismas reglas que scripts/precios.mjs) ───────────────

def yahoo_symbol(provider_symbol):
    parts = (provider_symbol or "").split(".")
    base, suf = parts[0], (parts[1] if len(parts) > 1 else "US")
    return base + YAHOO_SUFFIX.get(suf, "." + suf)


def serie_diaria(ysym, rng="3mo"):
    """Serie diaria FECHADA con cierre CRUDO y máximo intradía; marca huecos (fecha con
    cierre nulo) y si la última vela es de una sesión AÚN ABIERTA (precio en curso)."""
    data = fetch_json(YAHOO_CHART.format(sym=urllib.request.quote(ysym), rng=rng))
    res = data["chart"]["result"][0]
    ts = res.get("timestamp") or []
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    closes, highs = q.get("close") or [], q.get("high") or []
    bars, gaps = [], []
    for i, t in enumerate(ts):
        d = datetime.fromtimestamp(t, timezone.utc).date().isoformat()
        c = closes[i] if i < len(closes) else None
        h = highs[i] if i < len(highs) else None
        if finite(c) and c > 0:
            bars.append({"t": t, "d": d, "c": float(c), "h": float(h) if finite(h) and h > 0 else float(c)})
        else:
            gaps.append(d)
    reg = (res.get("meta", {}).get("currentTradingPeriod") or {}).get("regular") or {}
    forming = bool(bars) and finite(reg.get("start")) and finite(reg.get("end")) \
        and bars[-1]["t"] >= reg["start"] and datetime.now(timezone.utc).timestamp() < reg["end"]
    return {"bars": bars, "gaps": gaps, "forming": forming, "regEnd": reg.get("end")}


def cotizar(ysym, desde=ENTRY_DATE):
    """Precio actual, fecha, si es cierre, cierre anterior VÁLIDO (sin saltar huecos),
    máximos desde `desde` (cierre e intradía) y avisos de calidad."""
    avisos = []
    s = serie_diaria(ysym, "3mo")
    bars = s["bars"]
    if not bars:
        raise RuntimeError(f"{ysym}: sin barras")
    last = bars[-1]
    prev = bars[-2] if len(bars) > 1 else None
    gap_between = prev is not None and any(prev["d"] < g < last["d"] for g in s["gaps"])
    if gap_between:
        avisos.append(f"{ysym}: hueco de la fuente entre {prev['d']} y {last['d']} — sin variación diaria")
    faltan = [g for g in s["gaps"] if g > last["d"]]
    if faltan:
        avisos.append(f"{ysym}: la fuente no tiene aún la sesión {', '.join(faltan)}")
    # Contraste con OTRO rango: el último cierre completado debe coincidir (regla G3a de precios.mjs).
    try:
        s2 = serie_diaria(ysym, "5d")
        ref = [b for b in s2["bars"] if b["d"] == (prev["d"] if s["forming"] and prev else last["d"])]
        mine = prev if s["forming"] and prev else last
        if ref and abs(ref[0]["c"] / mine["c"] - 1) > 0.002:
            avisos.append(f"{ysym}: el cierre del {mine['d']} difiere entre rangos ({mine['c']:.2f} vs {ref[0]['c']:.2f})")
    except Exception as e:
        avisos.append(f"{ysym}: no se pudo contrastar con otro rango ({e})")
    en_periodo = [b for b in bars if b["d"] >= desde]
    cerrados = en_periodo[:-1] if s["forming"] else en_periodo
    return {
        "sym": ysym,
        "precio": last["c"],
        "fecha": last["d"],
        "esCierre": not s["forming"],
        "cierreAnterior": None if gap_between or prev is None else prev["c"],
        "maxCierre": max((b["c"] for b in cerrados), default=None),
        "maxIntradia": max((b["h"] for b in en_periodo), default=None),
        "regEnd": s["regEnd"],
        "avisos": avisos,
    }

# ── lectura de fuentes ───────────────────────────────────────────────────────

def leer_rally_test():
    r = fetch_json(RALLY_TEST_URL)
    if not r.get("ok") or not r.get("top10"):
        raise RuntimeError("Rally-Test sin scan disponible")
    return r


def leer_foto():
    r = fetch_json(PORTFOLIO_URL)
    if not r.get("ok") or not r.get("portfolio"):
        return None
    return r["portfolio"]


def foto_plausible(foto, last_good_nav):
    nav, val, cash = foto.get("navEur"), foto.get("valMdoEur"), foto.get("cashEur")
    if not (finite(nav) and nav > 0):
        return False, "NAV ausente o no positivo"
    if finite(last_good_nav) and last_good_nav > 0 and not (last_good_nav * (1 - NAV_DRIFT_TOL) <= nav <= last_good_nav * (1 + NAV_DRIFT_TOL)):
        return False, f"NAV {eur(nav)} fuera de ±{NAV_DRIFT_TOL:.0%} del último conocido ({eur(last_good_nav)})"
    if finite(val) and finite(cash) and val >= 0 and cash >= 0 and abs(val + cash - nav) > NAV_IDENTITY_TOL * nav:
        return False, f"identidad rota: NAV {eur(nav)} ≠ invertido + efectivo {eur(val + cash)}"
    for p in foto.get("positions") or []:
        q = p.get("quantity")
        if not (finite(q) and q > 0):
            return False, f"unidades ilegibles en {p.get('symbol', '?')}"
    return True, "ok"

# ── núcleo ───────────────────────────────────────────────────────────────────

def valorar(unidades, eurusd, calidad, precios_cache):
    """unidades: {TICKER: uds}. Devuelve filas con precio validado, valor € y capas."""
    filas = []
    for t, uds in sorted(unidades.items()):
        reg = REGISTRO.get(t, {})
        cur = reg.get("currency", "USD")
        try:
            q = precios_cache.get(t) or cotizar(yahoo_symbol(t if "." in t else t + ".US"))
            precios_cache[t] = q
        except Exception as e:
            calidad.append(f"⚠ {t}: sin dato fiable de precio ({e}) — no se valora")
            filas.append({"ticker": t, "uds": uds, "sin_dato": True})
            continue
        calidad.extend(q["avisos"])
        fx = eurusd if cur == "USD" else 1.0
        valor = uds * q["precio"] / fx
        stop_ibk = q["maxIntradia"] * (1 - TRAIL) if q["maxIntradia"] else None
        stop_modelo = q["maxCierre"] * (1 - TRAIL) if q["maxCierre"] else None
        filas.append({
            "ticker": t, "uds": uds, "cur": cur, "q": q, "valor": valor,
            "base": reg.get("base"), "coste": reg.get("cost"),
            "desde_base": (q["precio"] / reg["base"] - 1) if reg.get("base") else None,
            "sobre_coste": (q["precio"] / reg["cost"] - 1) if reg.get("cost") else None,
            "dia": (q["precio"] / q["cierreAnterior"] - 1) if q["cierreAnterior"] else None,
            "stop_ibk": stop_ibk, "stop_modelo": stop_modelo,
            "suelo": (stop_ibk / reg["cost"] - 1) if stop_ibk and reg.get("cost") else None,
            "roto_modelo": bool(stop_modelo) and q["esCierre"] and q["precio"] <= stop_modelo,
        })
    return filas


def detectar_eventos(unidades_foto, registro_vivo, filas):
    eventos = []
    for t, info in registro_vivo.items():
        antes = info["units"]
        ahora = unidades_foto.get(t, 0.0)
        if ahora < antes * 0.95:
            eventos.append(("STOP", f"{t}: {antes:g} → {ahora:g} uds en la foto de IBK (¿saltó su trailing o hubo venta?)"))
    for f in filas:
        if f.get("roto_modelo"):
            eventos.append(("STOP", f"{f['ticker']}: cierre {f['q']['precio']:.2f} por debajo del trailing del 45% "
                                    f"({f['stop_modelo']:.2f}) — la orden TRAIL de IBK debería haber saltado: revísala"))
    nuevos = [t for t in unidades_foto if t not in registro_vivo]
    if nuevos:
        eventos.append(("CAMBIO", f"posiciones nuevas en la foto: {', '.join(nuevos)} — actualiza el registro de la cartera"))
    return eventos


def plan_rebalanceo(rally, capital_eur, unidades, eurusd, precios_cache, calidad):
    """Reparte el CAPITAL DEL MÓDULO (no el NAV) según los pesos del top-5 de Rally-Test."""
    top = [a for a in rally["top10"] if (a.get("suggestedWeightPct") or 0) > 0]
    filas, vistos = [], set()
    for a in sorted(top, key=lambda x: x.get("rank") or 99):
        t = base_symbol(a.get("ticker") or a.get("providerSymbol"))
        vistos.add(t)
        cur = (a.get("currency") or "USD").upper()
        try:
            q = precios_cache.get(t) or cotizar(yahoo_symbol(a.get("providerSymbol") or t))
            precios_cache[t] = q
        except Exception as e:
            calidad.append(f"⚠ {t}: sin precio fiable ({e}) — plan incompleto")
            continue
        calidad.extend(q["avisos"])
        fx = eurusd if cur == "USD" else 1.0
        precio_eur = q["precio"] / fx
        w = float(a["suggestedWeightPct"]) / 100.0
        objetivo_eur = w * capital_eur
        obj_uds = objetivo_eur / precio_eur if precio_eur > 0 else 0.0
        act_uds = unidades.get(t, 0.0)
        delta = obj_uds - act_uds
        delta = round(delta, 2) if cur == "USD" else float(round(delta))
        obj_r = round(obj_uds, 2) if cur == "USD" else float(round(obj_uds))
        if act_uds == 0:
            accion = "COMPRAR (nueva)"
        elif abs(delta * precio_eur) < 0.01 * capital_eur:
            accion = "MANTENER"
        elif delta > 0:
            accion = "COMPRAR (ampliar)"
        else:
            accion = "REDUCIR"
        filas.append({"rank": a.get("rank"), "ticker": t, "name": a.get("name", ""), "action": accion,
                      "delta_qty": delta, "cur_qty": round(act_uds, 4), "target_qty": obj_r, "stop": 45,
                      "weight_pct": w, "cur_val": act_uds * precio_eur, "target_eur": objetivo_eur,
                      "price_native": q["precio"], "currency": cur, "price_eur": precio_eur})
    for t, uds in sorted(unidades.items()):
        if t in vistos or uds <= 0:
            continue
        q = precios_cache.get(t)
        precio = q["precio"] if q else None
        fx = eurusd if REGISTRO.get(t, {}).get("currency", "USD") == "USD" else 1.0
        filas.append({"rank": None, "ticker": t, "name": "(fuera del top-5)", "action": "VENDER TODO",
                      "delta_qty": -round(uds, 4), "cur_qty": round(uds, 4), "target_qty": 0.0, "stop": None,
                      "weight_pct": 0.0, "cur_val": (uds * precio / fx) if precio else 0.0, "target_eur": 0.0,
                      "price_native": precio or 0.0, "currency": "USD", "price_eur": (precio / fx) if precio else 0.0})
    return filas

# ── informe (texto del email) ────────────────────────────────────────────────

def informe_valoracion(filas, review, eurusd, foto, estado_prev, calidad, cabecera):
    ok = [f for f in filas if not f.get("sin_dato")]
    valor = sum(f["valor"] for f in ok)
    base_eur = sum(f["uds"] * f["base"] / BASE_FX for f in ok if f.get("base"))
    # Coste en € al cambio de la COMPRA (BASE_FX): lo que de verdad salió de la cuenta.
    coste_eur = sum(f["uds"] * f["coste"] / (BASE_FX if f["cur"] == "USD" else 1.0) for f in ok if f.get("coste"))
    suelo_eur = sum(f["uds"] * f["stop_ibk"] / (eurusd if f["cur"] == "USD" else 1.0) for f in ok if f.get("stop_ibk"))
    todas_cierre = all(f["q"]["esCierre"] for f in ok)
    fechas = sorted({f["q"]["fecha"] for f in ok})
    L = [cabecera, ""]
    estado_precio = "cierre" if todas_cierre else "EN CURSO (intradía, no es cierre)"
    L.append(f"Cartera Rally-Test: {eur(valor)} · {len(ok)} posiciones · precios {estado_precio} {', '.join(fecha_corta(d) for d in fechas)}")
    if foto:
        L.append(f"Cuenta IBK (foto subida el {fecha_corta((foto.get('loadedAt') or '')[:10])}): NAV {eur(foto['navEur'])} · efectivo {eur(foto.get('cashEur') or 0)}")
    if review and review.get("nextReviewDate"):
        L.append(f"Próxima revisión: {fecha_larga(review['nextReviewDate'])} · faltan {review.get('sessionsRemaining')} sesiones "
                 f"— hasta entonces SOLO se opera si salta un stop.")
    L += ["", "① RENTABILIDAD SOBRE EL CAPITAL INVERTIDO"]
    if base_eur > 0:
        r = valor / base_eur - 1
        L.append(f"   Desde la base del 8-sep ({eur(base_eur)}): {pct(r)}{eur_si_ganancia(valor - base_eur)}")
    if coste_eur > 0:
        r = valor / coste_eur - 1
        L.append(f"   Sobre lo que pagaste ({eur(coste_eur)}): {pct(r)}{eur_si_ganancia(valor - coste_eur)}")
    L.append("   Por ticker (en dólares, sin efecto divisa):")
    for f in ok:
        dia = f"día {pct(f['dia'])}" if f.get("dia") is not None else "día —"
        db = pct(f["desde_base"]) if f.get("desde_base") is not None else "—"
        sc = pct(f["sobre_coste"]) if f.get("sobre_coste") is not None else "—"
        L.append(f"   {f['ticker']:<5} {f['q']['precio']:>9.2f} $ · {dia} · desde 8-sep {db} · sobre coste {sc}")
    L += ["", "② TRAILING STOPS (45%; la orden TRAIL de IBK ancla al MÁXIMO INTRADÍA)"]
    prev_stops = (estado_prev or {}).get("lastStops") or {}
    for f in ok:
        if not f.get("stop_ibk"):
            continue
        antes = prev_stops.get(f["ticker"])
        mov = f" · {pct(f['stop_ibk'] / antes - 1)} desde el último informe" if finite(antes) and antes > 0 else ""
        dist = f["q"]["precio"] / f["stop_ibk"] - 1
        L.append(f"   {f['ticker']:<5} stop ≈ {f['stop_ibk']:.2f} $ (máx. intradía {f['q']['maxIntradia']:.2f} desde el 8-sep) · el precio está {pct(dist)} por encima{mov}")
    L += ["", "③ SUELO GARANTIZADO (si saltaran hoy todos los stops, sobre lo que pagaste)"]
    if coste_eur > 0 and suelo_eur > 0:
        r = suelo_eur / coste_eur - 1
        L.append(f"   Cartera: {pct(r)}{eur_si_ganancia(suelo_eur - coste_eur)}")
    for f in ok:
        if f.get("suelo") is None:
            continue
        falta = f["coste"] / (1 - TRAIL) / f["q"]["maxIntradia"] - 1 if f["q"]["maxIntradia"] else None
        extra = f" · le falta {pct(falta, 0)} de subida para no poder perder" if falta and falta > 0 else " · ya no puede cerrar en pérdida"
        L.append(f"   {f['ticker']:<5} {pct(f['suelo'])}{extra}")
    L.append("   (El suelo es por tenencia: si un stop salta y se recompra, el nuevo suelo se re-ancla más abajo.)")
    L += ["", "④ CALIDAD DEL DATO"]
    L.append(f"   Precios: Yahoo, serie diaria fechada y contrastada · EUR/USD {eurusd:.4f} · los precios de la foto de IBK NO se usan (solo unidades).")
    if calidad:
        L += [f"   {c}" for c in dict.fromkeys(calidad)]
    else:
        L.append("   Sin incidencias.")
    L += ["", "Automático, solo lectura. Rentabilidad pasada no garantiza la futura."]
    return "\n".join(L), valor, {f["ticker"]: round(f["stop_ibk"], 4) for f in ok if f.get("stop_ibk")}

# ── Excel / PDF del PLAN (solo cuando hay que operar) ────────────────────────

def write_xlsx(plan, path):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    NAVY, VIOLET = "0D1B2A", "7C3AED"
    GREEN_TX, RED_TX, GRAY_TX = "047857", "B91C1C", "6B7280"
    GREEN_BG, RED_BG, AMBER_BG = "D1FAE5", "FEE2E2", "FEF3C7"
    HEAD_BG, ZEBRA = "1B263B", "F3F6FA"

    def F(**kw):
        return Font(name="Arial", **kw)

    wb = Workbook()
    ws = wb.active
    ws.title = "PLAN RALLY-TEST"
    ws.sheet_view.showGridLines = False
    ws.merge_cells("B2:M2")
    c = ws["B2"]
    c.value = f"PLAN DE REBALANCEO · CARTERA IBK → RALLY-TEST · {plan['motivo']}"
    c.font, c.fill = F(bold=True, size=15, color="FFFFFF"), PatternFill("solid", fgColor=NAVY)
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 30
    ws.merge_cells("B3:M3")
    c = ws["B3"]
    c.value = (f"Scan Rally-Test {plan['scan_local'].strftime('%d/%m/%Y %H:%M')} (hora Canarias) · "
               f"capital del módulo {round(plan['capital'])} € · precios Yahoo validados · solo lectura")
    c.font, c.fill = F(size=10, color="FFFFFF"), PatternFill("solid", fgColor=NAVY)
    c.alignment = Alignment(horizontal="center", vertical="center")
    kpis = [("CAPITAL MÓDULO", round(plan["capital"]), "#,##0 €"), ("NAV CUENTA", round(plan["nav"]) if plan["nav"] else 0, "#,##0 €"),
            ("EFECTIVO CUENTA", round(plan["cash"]) if plan["cash"] else 0, "#,##0 €"), ("EUR/USD", plan["eurusd"], "0.0000")]
    for i, (label, val, fmt) in enumerate(kpis):
        col = 2 + i * 3
        ws.merge_cells(start_row=5, start_column=col, end_row=5, end_column=col + 2)
        ws.merge_cells(start_row=6, start_column=col, end_row=6, end_column=col + 2)
        lc, vc = ws.cell(row=5, column=col), ws.cell(row=6, column=col)
        lc.value, lc.font, lc.alignment = label, F(size=9, bold=True, color=GRAY_TX), Alignment(horizontal="center")
        vc.value, vc.number_format = val, fmt
        vc.font, vc.alignment = F(size=13, bold=True, color=NAVY), Alignment(horizontal="center")
    headers = ["#", "TICKER", "NOMBRE", "ACCIÓN", "± POSICIONES", "TRAILING STOP", "POSIC. ACTUALES",
               "POSIC. OBJETIVO", "PESO OBJETIVO", "VALOR ACTUAL €", "VALOR OBJETIVO €", "PRECIO"]
    HR = 8
    thin = Side(style="thin", color="D1D5DB")
    for j, h in enumerate(headers):
        c = ws.cell(row=HR, column=2 + j, value=h)
        c.font, c.fill = F(bold=True, size=9, color="FFFFFF"), PatternFill("solid", fgColor=HEAD_BG)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[HR].height = 26
    r = HR + 1
    for i, row in enumerate(plan["rows"]):
        d = row["delta_qty"]
        vals = [row["rank"] or "—", row["ticker"], row["name"], row["action"], (f"+{d:g}" if d > 0 else f"{d:g}"),
                (f"{row['stop']:.0f}%" if row["stop"] else "—"), row["cur_qty"], row["target_qty"], row["weight_pct"],
                round(row["cur_val"]), round(row["target_eur"]), f"{row['price_native']:,.2f} {row['currency']}"]
        for j, v in enumerate(vals):
            c = ws.cell(row=r, column=2 + j, value=v)
            c.font, c.border = F(size=10), Border(bottom=thin)
            c.alignment = Alignment(horizontal="left" if j == 2 else "center", vertical="center")
            if i % 2 == 1:
                c.fill = PatternFill("solid", fgColor=ZEBRA)
        ws.cell(row=r, column=3).font = F(size=10, bold=True)
        ws.cell(row=r, column=10).number_format = "0.0%"
        ws.cell(row=r, column=11).number_format = "#,##0 €"
        ws.cell(row=r, column=12).number_format = "#,##0 €"
        act = row["action"]
        if act.startswith("COMPRAR"):
            fill, color = PatternFill("solid", fgColor=GREEN_BG), GREEN_TX
        elif act in ("REDUCIR", "VENDER TODO"):
            fill, color = PatternFill("solid", fgColor=RED_BG), RED_TX
        else:
            fill, color = PatternFill("solid", fgColor=AMBER_BG), GRAY_TX
        for cell in (ws.cell(row=r, column=5), ws.cell(row=r, column=6)):
            cell.fill = fill
            cell.font = F(size=10, bold=True, color=color)
        ws.cell(row=r, column=7).font = F(size=10, bold=True, color=VIOLET)
        r += 1
    notes = [
        f"MOTIVO: {plan['motivo_largo']}",
        "CÓMO USARLO EN IBK: ± POSICIONES = acciones a comprar (+) o vender (−). Después, orden TRAIL 45% (GTC) sobre la",
        "posición COMPLETA de cada ticker. Objetivo = peso del top-5 de Rally-Test × capital del módulo (no el NAV de la cuenta).",
        "Precios: Yahoo validados (los de la foto de IBK no se usan). USD en fracciones de 2 decimales.",
    ] + ([f"AVISO: {a}" for a in plan["avisos"]])
    for i, t in enumerate(notes):
        nr = r + 1 + i
        ws.merge_cells(start_row=nr, start_column=2, end_row=nr, end_column=13)
        c = ws.cell(row=nr, column=2, value=t)
        c.font = F(size=9, bold=True, color=RED_TX) if t.startswith(("AVISO", "MOTIVO")) else F(size=8, italic=True, color=GRAY_TX)
    for i, w in enumerate([3, 5, 9, 24, 17, 13, 13, 13, 13, 12, 14, 15, 14]):
        ws.column_dimensions[get_column_letter(1 + i)].width = w
    ws.freeze_panes = f"B{HR + 1}"
    wb.save(path)


def write_pdf(plan, path):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdfcanvas
    W, H = A4
    BG, PANEL = (0.05, 0.07, 0.10), (0.09, 0.12, 0.17)
    FG, DIM = (0.92, 0.94, 0.96), (0.55, 0.60, 0.67)
    VIOLET, GREEN, RED = (0.66, 0.33, 0.97), (0.06, 0.72, 0.51), (0.94, 0.27, 0.27)
    c = pdfcanvas.Canvas(path, pagesize=A4)
    c.setFillColorRGB(*BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    def text(x, y, s, size=9, color=FG, font="Helvetica", right=False, center=False):
        c.setFont(font, size)
        c.setFillColorRGB(*color)
        (c.drawRightString if right else c.drawCentredString if center else c.drawString)(x, y, s)

    M = 14 * mm
    y = H - 18 * mm
    text(M, y, f"CARTERA IBK → RALLY-TEST · {plan['motivo']}", 15, VIOLET, "Helvetica-Bold")
    text(W - M, y, plan["scan_local"].strftime("SCAN %d/%m/%Y · %H:%M"), 10, FG, "Helvetica-Bold", right=True)
    y -= 5.2 * mm
    text(M, y, plan["motivo_largo"][:120], 8, DIM)
    y -= 12 * mm
    kpis = [("CAPITAL MÓDULO", f"{plan['capital']:,.0f} €", VIOLET), ("NAV CUENTA", f"{(plan['nav'] or 0):,.0f} €", FG),
            ("EFECTIVO", f"{(plan['cash'] or 0):,.0f} €", GREEN), ("EUR/USD", f"{plan['eurusd']:.4f}", FG)]
    bw = (W - 2 * M - 9 * mm) / 4
    for i, (label, val, col) in enumerate(kpis):
        x = M + i * (bw + 3 * mm)
        c.setFillColorRGB(*PANEL)
        c.roundRect(x, y - 6 * mm, bw, 13 * mm, 2 * mm, stroke=0, fill=1)
        text(x + bw / 2, y + 2.4 * mm, label, 6.5, DIM, "Helvetica-Bold", center=True)
        text(x + bw / 2, y - 3 * mm, val, 10.5, col, "Helvetica-Bold", center=True)
    y -= 18 * mm
    cols = [("#", 8 * mm), ("TICKER", 20 * mm), ("ACCIÓN", 34 * mm), ("± POSICIONES", 27 * mm), ("STOP", 15 * mm),
            ("PESO OBJ.", 19 * mm), ("ACTUAL €", 22 * mm), ("OBJETIVO €", 22 * mm), ("PRECIO", 26 * mm)]
    x = M
    for label, wd in cols:
        text(x + wd / 2, y, label, 7, DIM, "Helvetica-Bold", center=True)
        x += wd
    y -= 2.5 * mm
    c.setStrokeColorRGB(*DIM)
    c.setLineWidth(0.4)
    c.line(M, y, W - M, y)
    for row in plan["rows"]:
        y -= 8.6 * mm
        d, act = row["delta_qty"], row["action"]
        col = GREEN if act.startswith("COMPRAR") else (RED if d < 0 else DIM)
        vals = [(str(row["rank"] or "—"), FG, "Helvetica"), (row["ticker"], FG, "Helvetica-Bold"), (act, col, "Helvetica-Bold"),
                ((f"+{d:g}" if d > 0 else f"{d:g}"), col, "Helvetica-Bold"), ((f"{row['stop']:.0f}%" if row["stop"] else "—"), VIOLET, "Helvetica-Bold"),
                (f"{100 * row['weight_pct']:.1f}%", FG, "Helvetica"), (f"{row['cur_val']:,.0f}", FG, "Helvetica"),
                (f"{row['target_eur']:,.0f}", FG, "Helvetica"), (f"{row['price_native']:,.2f} {row['currency']}", DIM, "Helvetica")]
        x = M
        for (s, cc, font), (_, wd) in zip(vals, cols):
            text(x + wd / 2, y + 2.6 * mm, s, 9.5 if font == "Helvetica-Bold" and s and s[0] in "+-" else 8, cc, font, center=True)
            x += wd
        c.setStrokeColorRGB(0.16, 0.20, 0.26)
        c.line(M, y, W - M, y)
    y -= 9 * mm
    for a in plan["avisos"]:
        text(M, y, f"AVISO: {a}"[:130], 7.5, RED, "Helvetica-Bold")
        y -= 4.2 * mm
    text(M, y, "± POSICIONES: acciones a comprar (+) o vender (−). Después: TRAIL 45% GTC sobre la posición completa.", 7.5, FG)
    y -= 4 * mm
    text(M, y, "Objetivo = peso del top-5 de Rally-Test × capital del módulo · precios Yahoo validados (no los de la foto).", 7.5, FG)
    c.showPage()
    c.save()


def generar_salidas(plan, stamp):
    destinos = list(dict.fromkeys((OUT_DIR, OUT_DIR_ALTERNATIVO)))
    for i, destino in enumerate(destinos):
        xlsx_path = os.path.join(destino, f"Cartera_RallyTest_{stamp}.xlsx")
        pdf_path = os.path.join(destino, f"Cartera_RallyTest_{stamp}.pdf")
        try:
            os.makedirs(destino, exist_ok=True)
            write_xlsx(plan, xlsx_path)
            write_pdf(plan, pdf_path)
            return xlsx_path, pdf_path
        except OSError as exc:
            for parcial in (xlsx_path, pdf_path):
                try:
                    os.remove(parcial)
                except OSError:
                    pass
            if i == len(destinos) - 1:
                raise
            log(f"Aviso: no se pudo escribir en {destino} ({exc}) — reintento en {destinos[i + 1]}")

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    force = "--force" in sys.argv
    dry = "--dry-run" in sys.argv
    state = load_state()
    if state.get("version") != 2:
        # Estado del generador antiguo (Rally Leaders): se conserva solo el NAV bueno.
        state = {"version": 2, "lastGoodNav": state.get("lastGoodNav")}
    calidad = []

    try:
        rally = leer_rally_test()
    except Exception as e:
        log(f"ERROR al leer Rally-Test: {e}")
        return 1
    review = rally.get("review") or {}

    try:
        foto = leer_foto()
    except Exception as e:
        foto = None
        calidad.append(f"⚠ No se pudo leer la foto de IBK del servidor ({e}) — se usa el último registro de unidades.")

    registro_vivo = state.get("registro") or {t: {"units": v["units"]} for t, v in REGISTRO.items()}
    unidades = {t: v["units"] for t, v in registro_vivo.items()}
    foto_nueva = False
    if foto:
        ok, motivo = foto_plausible(foto, state.get("lastGoodNav"))
        if ok:
            unidades_foto = {}
            for p in foto.get("positions") or []:
                unidades_foto[base_symbol(p.get("symbol"))] = unidades_foto.get(base_symbol(p.get("symbol")), 0.0) + float(p["quantity"])
            foto_nueva = foto.get("loadedAt") != state.get("lastFotoAt")
        else:
            unidades_foto = None
            calidad.append(f"⚠ Foto de IBK descartada ({motivo}) — se usa el último registro de unidades.")
    else:
        unidades_foto = None

    try:
        eurusd = cotizar("EURUSD=X")["precio"]
    except Exception as e:
        log(f"ERROR: sin EUR/USD fiable ({e}) — no se genera informe")
        return 1

    cache = {}
    filas = valorar(unidades_foto if unidades_foto else unidades, eurusd, calidad, cache)

    # Contraste de las UNIDADES leídas: Σ uds × precio de hoy ≈ valor de mercado de la foto
    # (±30%: la foto puede ser de días atrás). Caza una unidad mal leída (×10), no el día a día.
    if unidades_foto and finite(foto.get("valMdoEur")) and foto["valMdoEur"] > 0:
        v_hoy = sum(f["valor"] for f in filas if not f.get("sin_dato"))
        if v_hoy > 0 and abs(v_hoy / foto["valMdoEur"] - 1) > UNITS_VALUE_TOL:
            calidad.append(f"⚠ Las unidades de la foto no cuadran con su valor de mercado ({eur(v_hoy)} hoy vs {eur(foto['valMdoEur'])} en la foto): revisa la foto.")

    eventos = detectar_eventos(unidades_foto or {}, registro_vivo, filas) if unidades_foto else \
        detectar_eventos({}, {}, filas)
    stop_eventos = [e for e in eventos if e[0] == "STOP"]
    for e in eventos:
        if e[0] == "CAMBIO":
            calidad.append(f"⚠ {e[1]}")

    ahora_utc = datetime.now(timezone.utc)
    hoy = ahora_utc.date().isoformat()
    scan_utc = datetime.fromisoformat(rally["scanCompletedAtUtc"].replace("Z", "+00:00"))
    scan_local = scan_utc.astimezone(TZ)

    # ── 1) EVENTO: stop o revisión → PLAN con Excel/PDF ─────────────────────
    motivo = None
    if stop_eventos:
        motivo, motivo_largo = "STOP", "Salto de trailing: protocolo RESCAN2 — re-escanear y reinvertir TODO según los pesos nuevos (el reloj de la revisión NO se reinicia). " + " | ".join(e[1] for e in stop_eventos)
        clave_evento = "STOP|" + "|".join(sorted(e[1] for e in stop_eventos))
    elif review.get("due"):
        motivo, motivo_largo = "REVISIÓN", f"Revisión trimestral: {review.get('sessionsTotal', 63)} sesiones desde el rebalanceo del {fecha_larga(review.get('lastRebalance'))}."
        clave_evento = f"REVISION|{review.get('nextReviewDate')}"

    if motivo and (force or state.get("lastEventKey") != clave_evento):
        avisos = []
        if scan_utc.date().isoformat() < hoy and (motivo == "STOP" or scan_utc.date().isoformat() < (review.get("nextReviewDate") or hoy)):
            avisos.append(f"El último scan de Rally-Test es del {scan_local.strftime('%d/%m %H:%M')}: pulsa 'Escanear universo' en Rally-Test y este plan se rehará con el top-5 de hoy.")
        vendido_eur = 0.0
        for t, info in registro_vivo.items():
            falta = info["units"] - ((unidades_foto or {}).get(t, info["units"]))
            if falta > 0 and cache.get(t):
                stop = cache[t]["maxIntradia"] * (1 - TRAIL) if cache[t]["maxIntradia"] else cache[t]["precio"]
                vendido_eur += falta * stop / eurusd
        capital = sum(f["valor"] for f in filas if not f.get("sin_dato")) + vendido_eur
        rows = plan_rebalanceo(rally, capital, unidades_foto or unidades, eurusd, cache, calidad)
        plan = {"rows": rows, "capital": capital, "nav": (foto or {}).get("navEur"), "cash": (foto or {}).get("cashEur"),
                "eurusd": eurusd, "scan_local": scan_local, "motivo": motivo, "motivo_largo": motivo_largo,
                "avisos": avisos + [c for c in calidad if c.startswith("⚠")]}
        stamp = datetime.now(TZ).strftime("%Y-%m-%d_%H-%M")
        adjuntos = list(generar_salidas(plan, stamp)) if not dry else []
        compras = sum(1 for r in rows if r["action"].startswith("COMPRAR"))
        ventas = sum(1 for r in rows if r["action"] in ("REDUCIR", "VENDER TODO"))
        cuerpo = "\n".join([
            f"⚠ {motivo}: toca operar según el protocolo de Rally-Test.", "", motivo_largo, "",
            f"Capital del módulo a repartir: {eur(capital)} (no el NAV de la cuenta).",
            f"{compras} compras/ampliaciones y {ventas} reducciones/ventas — detalle en el Excel/PDF adjunto.",
            "Después de operar: orden TRAIL 45% (GTC) sobre la posición COMPLETA de cada ticker,",
            "y avisa a Claude para registrar el nuevo rebalanceo (fecha, unidades y coste).", "",
        ] + [f"AVISO: {a}" for a in plan["avisos"]] + ["", "Automático, solo lectura."])
        enviado = send_email(f"CarteraIBK · Rally-Test · {motivo} — toca operar", cuerpo, adjuntos, dry)
        log(f"Plan {motivo} {'(simulación)' if dry else 'enviado' if enviado else 'NO enviado'} ({compras} compras, {ventas} ventas, capital {eur(capital)})")
        if enviado and not dry:
            state["lastEventKey"] = clave_evento
            notify("CarteraIBK · Rally-Test", f"{motivo}: toca operar — plan enviado por email")

    # ── 2) VALORACIÓN diaria tras el cierre de EE. UU. (o al subir una foto nueva) ──
    ok_filas = [f for f in filas if not f.get("sin_dato")]
    todas_cerradas = bool(ok_filas) and all(f["q"]["esCierre"] and f["q"]["fecha"] == hoy for f in ok_filas)
    reg_end = max((f["q"].get("regEnd") or 0) for f in ok_filas) if ok_filas else 0
    tras_cierre = todas_cerradas and ahora_utc.timestamp() >= reg_end + 15 * 60
    toca_diaria = tras_cierre and state.get("lastValuationDate") != hoy
    if force or toca_diaria or foto_nueva:
        motivo_v = "valoración al cierre" if todas_cerradas else ("foto nueva de IBK" if foto_nueva else "valoración")
        cab = f"CarteraIBK · Rally-Test · {datetime.now(TZ).strftime('%d/%m %H:%M')} · {motivo_v} — sin operaciones"
        if stop_eventos or review.get("due"):
            cab = cab.replace("sin operaciones", "HAY OPERACIONES PENDIENTES (ver plan)")
        cuerpo, valor, stops = informe_valoracion(filas, review, eurusd, foto, state, calidad, cab)
        asunto = f"CarteraIBK · Rally-Test {datetime.now(TZ).strftime('%d/%m')} · {motivo_v}"
        enviado = send_email(asunto, cuerpo, [], dry)
        log(f"Valoración {'(simulación)' if dry else 'enviada' if enviado else 'NO enviada'} ({motivo_v}, cartera {eur(valor)})")
        if enviado and not dry:
            if todas_cerradas:
                state["lastValuationDate"] = hoy
                state["lastStops"] = stops
            if foto_nueva:
                state["lastFotoAt"] = foto.get("loadedAt")

    if unidades_foto and not dry:
        state["lastGoodNav"] = foto.get("navEur")
        # Tras un salto/venta la foto manda: el registro vivo sigue a las unidades reales.
        state["registro"] = {t: {"units": u} for t, u in unidades_foto.items()}
    if not dry:
        state["lastRunUtc"] = ahora_utc.isoformat()
        save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
