#!/usr/bin/env python3
"""
INFORME SEMANAL DE RALLY LEADERS — evolución de los 10 tickers, por email.

Mandato de Sergi (28-ago-2026): "ok cada semana". Replica el análisis manual que se
hizo en la sesión del 28-ago: rentabilidad de la semana por ticker y de la cartera
ponderada, comparación contra índices, cambios de composición (quién entró y quién
salió) y proximidad al trailing stop.

QUÉ NO HACE (deliberado):
  · No toca producción: solo hace GET al scan público y a Yahoo. Cero escrituras.
  · No es una recomendación: describe lo que pasó, no dice qué comprar o vender.
  · No cambia ningún parámetro de estrategia (§10c) — es display/reporting puro.

Envío: Mail.app vía osascript, la misma vía que cartera_ibk_export.py (sin
credenciales nuevas). Estado y logs en ~/Library/Application Support/RallyWeekly/.

Uso:  python3 rally_weekly_report.py            (respeta el dedupe semanal)
      python3 rally_weekly_report.py --force    (reenvía aunque ya se enviara)
      python3 rally_weekly_report.py --dry-run  (imprime, NO envía ni guarda estado)
"""
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

SCAN_URL = "https://emrrclaude.vercel.app/api/rally-scan/last"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1mo&interval=1d"
MAIL_FROM_ACCOUNT = "sergimaymo@gmail.com"
MAIL_TO = "sergimaymo@gmail.com"

STATE_DIR = os.path.expanduser("~/Library/Application Support/RallyWeekly")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
LOG_FILE = os.path.join(STATE_DIR, "informe.log")

# Sufijos EODHD → Yahoo (copia de api/_lib/providerCascade.js: EODHD_TO_YAHOO_SUFFIX).
YAHOO_SUFFIX = {"US": "", "XETRA": ".DE", "PA": ".PA", "AS": ".AS", "BR": ".BR",
                "LS": ".LS", "MI": ".MI", "SW": ".SW", "LSE": ".L", "L": ".L"}
BENCH = [("S&P 500", "SPY"), ("Nasdaq 100", "QQQ"), ("Semiconductores", "SOXX")]
SESIONES = 5  # una semana bursátil


def log(msg: str) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def to_yahoo(provider_symbol: str):
    parts = (provider_symbol or "").split(".")
    if len(parts) < 2:
        return None
    suf = YAHOO_SUFFIX.get(".".join(parts[1:]))
    return None if suf is None else parts[0] + suf


def get_json(url: str, intentos: int = 3):
    ctx = ssl.create_default_context()
    for i in range(1, intentos + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
                return json.load(r)
        except Exception as e:  # red intermitente: el portátil duerme, hay cortes
            if i == intentos:
                log(f"AVISO: no se pudo leer {url.split('?')[0]} ({e})")
                return None
            time.sleep(0.8 * i)
    return None


def barras(yahoo_sym: str):
    """Cierres AJUSTADOS (dividendos/splits) de ~1 mes. La rentabilidad de la semana
    se mide sobre ajustado: si un ticker paga dividendo, el cierre crudo cae y sin
    ajustar parecería una pérdida que no existe."""
    d = get_json(YAHOO.format(sym=urllib.parse.quote(yahoo_sym)))
    try:
        r = d["chart"]["result"][0]
        ts = r["timestamp"]
        q = r["indicators"]["quote"][0]
        adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose")
    except (KeyError, IndexError, TypeError):
        return None
    out = []
    for i, t in enumerate(ts):
        c = q.get("close", [None] * len(ts))[i]
        if c is None:
            continue
        a = adj[i] if adj and adj[i] is not None else c
        out.append({"d": datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"),
                    "c": c, "a": a})
    return out or None


def semana(bars):
    """Rentabilidad de las últimas SESIONES sesiones + contexto de la ventana."""
    if not bars or len(bars) < SESIONES + 1:
        return None
    win = bars[-(SESIONES + 1):]
    ult, prev = win[-1], win[0]
    if not prev["a"]:
        return None
    adjs = [b["a"] for b in win]
    dias = [(win[i + 1]["a"] / win[i]["a"] - 1) * 100 for i in range(len(win) - 1)
            if win[i]["a"]]
    return {
        "desde": prev["d"], "hasta": ult["d"],
        "ret": (ult["a"] / prev["a"] - 1) * 100,
        "desde_max": (ult["a"] / max(adjs) - 1) * 100,
        "verdes": sum(1 for x in dias if x > 0), "n": len(dias),
        "dias": dias, "precio": ult["c"],
    }


def fmt(x, dec=2, signo=True):
    if x is None:
        return "—"
    s = f"{x:+.{dec}f}" if signo else f"{x:.{dec}f}"
    return s


def construir_informe(scan, filas, benches, prev_top):
    ok = [f for f in filas if f["s"]]
    if not ok:
        return None, None
    v = ok[0]["s"]
    wsum = sum(f["w"] for f in ok) or 1
    port = sum(f["s"]["ret"] * f["w"] for f in ok) / wsum
    eq = sum(f["s"]["ret"] for f in ok) / len(ok)

    L = []
    L.append(f"RALLY LEADERS · evolución {v['desde']} → {v['hasta']} ({SESIONES} sesiones)")
    L.append("")
    L.append(f"CARTERA (ponderada por tus pesos): {fmt(port)}%")
    L.append(f"  equiponderada: {fmt(eq)}%")
    for nom, b in benches:
        if b:
            L.append(f"  {nom}: {fmt(b['ret'])}%")
    L.append("")
    L.append("POR TICKER")
    L.append(f"{'tick':<7}{'peso':>7}{'semana':>10}{'desde máx':>12}   días verdes")
    L.append("-" * 52)
    for f in sorted(filas, key=lambda x: -(x["s"]["ret"] if x["s"] else -999)):
        if not f["s"]:
            L.append(f"{f['t']:<7}{f['w']:>6.1f}%   (sin datos de mercado)")
            continue
        s = f["s"]
        dm = "en máximos" if s["desde_max"] > -0.05 else f"{s['desde_max']:.1f}%"
        L.append(f"{f['t']:<7}{f['w']:>6.1f}%{fmt(s['ret']):>9}%{dm:>12}   {s['verdes']}/{s['n']}")

    # Cambios de composición: qué entró y qué salió respecto al informe anterior.
    if prev_top:
        hoy = {f["t"] for f in filas}
        antes = set(prev_top)
        entran, salen = sorted(hoy - antes), sorted(antes - hoy)
        if entran or salen:
            L.append("")
            L.append("CAMBIOS EN EL TOP-10 desde el informe anterior")
            if entran:
                L.append(f"  ENTRA: {', '.join(entran)}")
            if salen:
                L.append(f"  SALE:  {', '.join(salen)}")
        else:
            L.append("")
            L.append("CAMBIOS EN EL TOP-10: ninguno (mismos 10 que la semana pasada)")

    # Proximidad al stop. Aproximación conservadora y declarada como tal.
    L.append("")
    L.append("PROXIMIDAD AL TRAILING STOP")
    riesgo = []
    for f in filas:
        st, prox = f["stop"], f["prox"]
        if st is None or prox is None:
            continue
        caida = (1 - prox) * 100
        margen = st - caida
        marca = "  <-- VIGILAR" if margen < 8 else ""
        L.append(f"  {f['t']:<7} stop {st:>3}%   caído {caida:>5.1f}% de su máx. 52s"
                 f"   margen {margen:>5.1f} pp{marca}")
        if margen < 8:
            riesgo.append(f["t"])
    L.append("")
    L.append("  NOTA: el margen usa el máximo de 52 SEMANAS como pico de referencia. El")
    L.append("  stop real trailea desde el máximo DESDE TU ENTRADA, que puede ser más")
    L.append("  bajo — así que este cálculo es el escenario más conservador: el margen")
    L.append("  real es igual o mayor. Sirve para saber a quién vigilar, no como cuenta")
    L.append("  atrás exacta.")

    avisos = [(f["t"], f["flags"]) for f in filas if f["flags"]]
    if avisos:
        L.append("")
        L.append("AVISOS DEL MOTOR")
        for t, fl in avisos:
            for x in fl:
                L.append(f"  {t}: {x}")

    L.append("")
    L.append(f"Scan de referencia: {scan.get('scanCompletedAtUtc', '?')} (UTC)")
    L.append("Rentabilidades sobre cierres AJUSTADOS por dividendos y splits.")
    L.append("Informe descriptivo, no es una recomendación de compra o venta.")
    L.append("Rentabilidad pasada; no garantiza la futura.")

    asunto = (f"Rally Leaders · semana {v['hasta']} · cartera {fmt(port)}% "
              f"vs S&P {fmt(benches[0][1]['ret']) if benches[0][1] else '—'}%")
    if riesgo:
        asunto += f" · vigilar {'/'.join(riesgo)}"
    return asunto, "\n".join(L)


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


def enviar(asunto: str, cuerpo: str) -> bool:
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
            log(f"AVISO: envío falló ({r.stderr.strip()[:200]})")
            return False
        return True
    except Exception as e:
        log(f"AVISO: envío falló ({e})")
        return False


def main() -> int:
    force = "--force" in sys.argv
    dry = "--dry-run" in sys.argv
    os.makedirs(STATE_DIR, exist_ok=True)

    try:
        with open(STATE_FILE) as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        state = {}

    # Dedupe por semana ISO: el agente puede dispararse varias veces (reintentos de
    # launchd si el Mac dormía); solo debe salir UN informe por semana.
    semana_iso = datetime.now().strftime("%G-W%V")
    if not force and not dry and state.get("ultimaSemana") == semana_iso:
        log(f"Ya se envió el informe de {semana_iso}; nada que hacer.")
        return 0

    scan = get_json(SCAN_URL)
    if not scan or not scan.get("ok") or not scan.get("top10"):
        log("ERROR: el scan de Rally Leaders no está disponible — se reintentará.")
        return 1

    filas = []
    for a in scan["top10"]:
        y = to_yahoo(a.get("providerSymbol", ""))
        m = a.get("metrics") or {}
        filas.append({
            "t": a.get("ticker", "?"),
            "w": a.get("suggestedWeightPct") or 0,
            "stop": a.get("trailingStop"),
            "prox": m.get("proximity52w"),
            "flags": [f.get("label", "") for f in (a.get("warningFlags") or [])],
            "s": semana(barras(y)) if y else None,
        })
        time.sleep(0.25)  # cortesía con Yahoo

    benches = []
    for nom, sym in BENCH:
        benches.append((nom, semana(barras(sym))))
        time.sleep(0.25)

    asunto, cuerpo = construir_informe(scan, filas, benches, state.get("top10"))
    if not cuerpo:
        log("ERROR: sin datos de mercado suficientes para el informe.")
        return 1

    if dry:
        print("\n" + "=" * 70)
        print("ASUNTO:", asunto)
        print("=" * 70)
        print(cuerpo)
        return 0

    if enviar(asunto, cuerpo):
        log(f"Informe enviado a {MAIL_TO} · {asunto}")
    else:
        log("Informe NO enviado (fallo de Mail.app) — el estado NO se marca, se reintentará.")
        return 1

    state.update({"ultimaSemana": semana_iso,
                  "top10": [f["t"] for f in filas],
                  "enviadoAt": datetime.now(timezone.utc).isoformat()})
    with open(STATE_FILE, "w") as fh:
        json.dump(state, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
