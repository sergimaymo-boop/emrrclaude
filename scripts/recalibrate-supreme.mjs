/**
 * RECALIBRACIÓN TRIMESTRAL DE OPTIMAL SUPREME (protocolo anti-sobreajuste).
 * ==========================================================================
 * El "aprendizaje" correcto de un sistema de trading NO es re-optimizar continuamente
 * (eso persigue ruido y muere por sobreajuste — demostrado en nuestros sweeps), sino
 * RE-VALIDAR periódicamente con datos frescos si el campeón sigue siéndolo.
 *
 * USO (cada ~3 meses, o si el monitor en vivo dispara alerta):
 *   node scripts/recalibrate-supreme.mjs            # usa caché si existe
 *   FRESH=1 node scripts/recalibrate-supreme.mjs    # fuerza re-descarga de datos
 *
 * REGLA DE CAMBIO (anti winner's-curse): un retador solo destrona al campeón si
 *   (a) su MAR lo supera en > 0.10 (más que el ruido inter-harness medido ~0.08), Y
 *   (b) le gana en ≥ 2 de 3 subperíodos.
 * Si no, el veredicto es MANTENER — cambiar por menos es perseguir ruido.
 *
 * Este script NUNCA modifica el engine: imprime el veredicto y guarda el informe en
 * backtests/ (durable, no /tmp). El cambio de calibración, si procede, se aplica a mano
 * (o pidiéndoselo a Claude) revisando el informe.
 */
import fs from "node:fs";
import path from "node:path";
import { STATIC_ASSETS_BY_EXCHANGE } from "../api/_lib/staticUniverse.js";
import { toYahooSymbol } from "../api/_lib/providerCascade.js";

const CACHE = "/tmp/emrr-bars-10y.json";
const OUT_DIR = path.join(process.cwd(), "backtests");
const N_POS = 2;
const LB_LONG = 189, LB_SKIP = 42, VOL_W = 63;
const COST = 20 / 1e4;

// Campeón vigente (debe coincidir con OPTIMAL_SUPREME_CALIBRATION) + retadores fuertes
// de los sweeps 1-4. Grid deliberadamente PEQUEÑO: re-validar, no re-explorar.
const CHAMPION_KEY = "b200_r21_h1.1";
const GRID = [
  { key: "b200_r21_h1.1", rebal: 21, hyst: 1.10, regime: "b200" }, // ⭐ CAMPEÓN
  { key: "b200_r21_h1.0", rebal: 21, hyst: 1.00, regime: "b200" },
  { key: "b200_r21_h1.25", rebal: 21, hyst: 1.25, regime: "b200" },
  { key: "b100_r21_h1.1", rebal: 21, hyst: 1.10, regime: "b100" },
  { key: "graded_r21_h1.1", rebal: 21, hyst: 1.10, regime: "graded" },
  { key: "b200_r10_h1.1", rebal: 10, hyst: 1.10, regime: "b200" },
  { key: "b200_r42_h1.1", rebal: 42, hyst: 1.10, regime: "b200" }, // bimestral (no probado antes)
];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
async function fetchBars(sym, range = "10y") {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json(); const r = d?.chart?.result?.[0]; if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const bars = r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), high: q.high?.[i], low: q.low?.[i], close: q.close?.[i] }))
      .filter((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.high) && Number.isFinite(b.low));
    return bars.length >= 260 ? bars : null;
  } catch { return null; }
}
async function pool(items, worker, c = 6) { const out = []; let i = 0; await Promise.all(Array.from({ length: c }, async () => { while (i < items.length) { const k = i++; out[k] = await worker(items[k]); } })); return out; }

let fetched, spy;
if (!process.env.FRESH && fs.existsSync(CACHE)) {
  console.log("Cargando caché 10y…");
  ({ fetched, spy } = JSON.parse(fs.readFileSync(CACHE, "utf8")));
} else {
  const all = [];
  for (const [ex, assets] of Object.entries(STATIC_ASSETS_BY_EXCHANGE))
    for (const a of assets) { const y = toYahooSymbol(`${a.Code}.${ex}`); if (y) all.push({ sym: `${a.Code}.${ex}`, yahoo: y }); }
  console.log(`Descargando ${all.length} símbolos (10y) + SPY…`);
  spy = await fetchBars("SPY");
  let done = 0;
  fetched = (await pool(all, async (s) => {
    const b = await fetchBars(s.yahoo);
    if (++done % 100 === 0) console.log(`  ${done}/${all.length}`);
    return b ? { sym: s.sym, bars: b } : null;
  })).filter(Boolean);
  fs.writeFileSync(CACHE, JSON.stringify({ fetched, spy }));
  console.log(`Cacheados ${fetched.length} tickers.`);
}

const spyDates = spy.map((b) => b.date), spyClose = spy.map((b) => b.close);
const D = spyDates.length;
const dateIdx = new Map(spyDates.map((d, i) => [d, i]));
function emaSeries(vals, p) { const k = 2 / (p + 1); const out = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out[i] = e; } return out; }
const spyEMA200 = emaSeries(spyClose, 200);
const spyEMA100 = emaSeries(spyClose, 100);
const spyRetLong = new Array(D).fill(0); for (let i = LB_LONG; i < D; i++) spyRetLong[i] = spyClose[i - LB_LONG] > 0 ? spyClose[i] / spyClose[i - LB_LONG] - 1 : 0;

function r2Log(closes, a, b) {
  const n = b - a; if (n < 10) return 0;
  let sx = 0, sy = 0; for (let i = a; i < b; i++) { sy += Math.log(closes[i]); sx += i - a; }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = a; i < b; i++) { const xx = (i - a) - mx, yy = Math.log(closes[i]) - my; sxy += xx * yy; sxx += xx * xx; syy += yy * yy; }
  if (sxx === 0 || syy === 0) return 0; return (sxy * sxy) / (sxx * syy);
}

console.log("Precomputando features…");
const T = [];
for (const f of fetched) {
  const bars = f.bars, n = bars.length;
  if (n < 240) continue;
  const closes = bars.map((b) => b.close), highs = bars.map((b) => b.high), lows = bars.map((b) => b.low);
  const e20 = emaSeries(closes, 20), e50 = emaSeries(closes, 50), e200 = emaSeries(closes, 200);
  const atrPct = new Array(n).fill(null); { let trSum = 0; const trs = [];
    for (let i = 1; i < n; i++) { const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])); trs.push(tr); trSum += tr; if (trs.length > 14) trSum -= trs.shift(); if (trs.length === 14 && closes[i] > 0) atrPct[i] = (trSum / 14) / closes[i]; } }
  const lr = new Array(n).fill(0); for (let i = 1; i < n; i++) lr[i] = Math.log(closes[i] / closes[i - 1]);
  const mClose = new Array(D).fill(null), mHigh = new Array(D).fill(null), mLow = new Array(D).fill(null);
  const mRaw = new Array(D).fill(null), mAtr = new Array(D).fill(null), mR2 = new Array(D).fill(null);
  for (let bi = 0; bi < n; bi++) {
    const mi = dateIdx.get(bars[bi].date); if (mi === undefined) continue;
    mClose[mi] = closes[bi]; mHigh[mi] = highs[bi]; mLow[mi] = lows[bi]; mAtr[mi] = atrPct[bi];
    if (bi < 230 || atrPct[bi] == null) continue;
    const r5 = [closes[bi - 5], closes[bi - 4], closes[bi - 3], closes[bi - 2], closes[bi - 1]].slice().sort((a, b) => a - b);
    const med = r5[2]; if (med > 0 && Math.abs(closes[bi] / med - 1) > 0.40) continue;
    const last = closes[bi];
    const retLong = closes[bi - LB_LONG] > 0 ? last / closes[bi - LB_LONG] - 1 : 0;
    const retSkip = closes[bi - LB_SKIP] > 0 ? last / closes[bi - LB_SKIP] - 1 : 0;
    let s2 = 0; for (let k = bi - VOL_W + 1; k <= bi; k++) s2 += lr[k] * lr[k];
    const vol63 = Math.sqrt((s2 / VOL_W) * 252);
    const align = (last > e20[bi] ? 1 : 0) + (e20[bi] > e50[bi] ? 1 : 0) + (e50[bi] > e200[bi] ? 1 : 0);
    if (!(retLong > 0 && align >= 2 && vol63 > 0.02 && vol63 < 2.5)) continue;
    const riskAdjMom = (retLong - retSkip) / vol63;
    const rsLong = clamp(retLong - spyRetLong[mi], -0.5, 0.5);
    const raw = riskAdjMom * (1 + 0.5 * rsLong) * (0.85 + 0.05 * align);
    if (!(raw > 0)) continue;
    mRaw[mi] = raw; mR2[mi] = r2Log(closes, bi - 59, bi + 1);
  }
  T.push({ sym: f.sym, close: mClose, high: mHigh, low: mLow, raw: mRaw, atr: mAtr, r2: mR2 });
}
console.log(`Tickers: ${T.length}\n`);

function bandMult(atrPct, r2) {
  if (atrPct < 0.025 && r2 > 0.70) return 2.5;
  if (atrPct > 0.045 || r2 < 0.40) return 4.0;
  return 3.0;
}
function candidatesAt(i) {
  const cands = [];
  for (let ti = 0; ti < T.length; ti++) {
    const tk = T[ti];
    if (tk.raw[i] == null || tk.close[i] == null || tk.atr[i] == null) continue;
    cands.push({ ti, raw: tk.raw[i] });
  }
  cands.sort((a, b) => b.raw - a.raw);
  return cands;
}
function exposureAt(i, regimeType) {
  const c = spyClose[i], e200 = spyEMA200[i], e100 = spyEMA100[i];
  if (regimeType === "b100") return c >= e100 ? 1.0 : 0.30;
  if (regimeType === "graded") {
    if (c >= e200 && c >= e100) return 1.0;
    if (c >= e200) return 0.65;
    return 0.30;
  }
  return c >= e200 ? 1.0 : 0.30;
}

function simulate({ rebal, hyst, regime }) {
  const FROM = 240, TO = D - 1;
  let equity = 1;
  const curve = new Array(TO + 1).fill(null); curve[FROM] = 1;
  const dailyPort = [];
  let slots = [];
  let trades = 0;
  let nextRebal = FROM;

  for (let i = FROM + 1; i <= TO; i++) {
    let expo = exposureAt(i - 1, regime);
    if (dailyPort.length >= 10 && expo > 0) {
      const recent = dailyPort.slice(-10);
      const mu = mean(recent), sd = Math.sqrt(mean(recent.map((r) => (r - mu) ** 2)));
      const realized = sd * Math.sqrt(252);
      if (realized > 0.30) expo = expo * (0.30 / realized);
    }
    let dayRet = 0;
    for (let s = 0; s < slots.length; s++) {
      const h = slots[s]; if (!h) continue;
      const tk = T[h.ti]; const c0 = tk.close[i - 1], c1 = tk.close[i], hi = tk.high[i], lo = tk.low[i];
      if (c1 == null || c0 == null) continue;
      if (hi != null && hi > h.peak) h.peak = hi;
      const stopLevel = h.peak * (1 - h.stopDist);
      if (lo != null && lo <= stopLevel) {
        dayRet += h.w * (stopLevel / c0 - 1);
        equity *= (1 - COST * h.w);
        trades++; slots[s] = null;
        continue;
      }
      dayRet += h.w * (c1 / c0 - 1);
    }
    slots = slots.filter(Boolean);
    equity *= (1 + dayRet);
    curve[i] = equity;
    dailyPort.push(dayRet);

    if (slots.length < N_POS && expo > 0.02) {
      const held = new Set(slots.map((h) => h.ti));
      const cands = candidatesAt(i).filter((c) => !held.has(c.ti));
      const wPer = expo / N_POS;
      let ci = 0;
      while (slots.length < N_POS && ci < cands.length) {
        const { ti } = cands[ci++];
        const tk = T[ti];
        slots.push({ ti, peak: tk.close[i], stopDist: bandMult(tk.atr[i], tk.r2[i] ?? 0.5) * tk.atr[i], w: wPer });
        equity *= (1 - COST * wPer); trades++;
      }
    }

    if (i >= nextRebal) {
      nextRebal = i + rebal;
      if (expo > 0.02) {
        const cands = candidatesAt(i);
        const heldSet = new Set(slots.map((h) => h.ti));
        const avail = cands.filter((c) => !heldSet.has(c.ti));
        let ai = 0;
        for (let s = 0; s < slots.length; s++) {
          const h = slots[s];
          const heldRaw = T[h.ti].raw[i];
          const best = avail[ai];
          const mustRotate = heldRaw == null || (best && best.raw > (heldRaw ?? 0) * hyst);
          if (mustRotate && best) {
            equity *= (1 - COST * h.w); trades++;
            const tk = T[best.ti];
            slots[s] = { ti: best.ti, peak: tk.close[i], stopDist: bandMult(tk.atr[i], tk.r2[i] ?? 0.5) * tk.atr[i], w: h.w };
            equity *= (1 - COST * h.w); trades++;
            ai++;
          }
        }
        const raws = slots.map((h) => Math.max(0.0001, T[h.ti].raw[i] ?? 0.0001));
        const rSum = raws.reduce((a, b) => a + b, 0) || 1;
        for (let s = 0; s < slots.length; s++) {
          const wT = expo * raws[s] / rSum;
          const dw = Math.abs(wT - slots[s].w);
          if (dw > 0.01) equity *= (1 - COST * dw);
          slots[s].w = wT;
        }
      }
    }
  }

  const eq = []; for (let i = FROM; i <= TO; i++) if (curve[i] != null) eq.push(curve[i]);
  const years = eq.length / 252;
  const cagr = Math.pow(eq.at(-1) / eq[0], 1 / years) - 1;
  let peak = eq[0], maxDD = 0; for (const v of eq) { if (v > peak) peak = v; const dd = 1 - v / peak; if (dd > maxDD) maxDD = dd; }
  const dRets = []; for (let k = 1; k < eq.length; k++) dRets.push(eq[k] / eq[k - 1] - 1);
  const mu = mean(dRets), sd = Math.sqrt(mean(dRets.map((r) => (r - mu) ** 2))) || 1;
  const third = Math.floor(eq.length / 3);
  const sub = [0, 1, 2].map((t) => {
    const a = eq[t * third], b = eq[t === 2 ? eq.length - 1 : (t + 1) * third];
    const yrs = (t === 2 ? eq.length - 1 - t * third : third) / 252;
    return +(100 * (Math.pow(b / a, 1 / yrs) - 1)).toFixed(1);
  });
  return {
    cagr: +(cagr * 100).toFixed(1), maxDD: +(maxDD * 100).toFixed(1),
    mar: +(cagr / maxDD).toFixed(2), sharpe: +((mu / sd) * Math.sqrt(252)).toFixed(2),
    tradesYr: +(trades / years).toFixed(0), sub,
  };
}

console.log("Re-validación del campeón vs retadores…\n");
const results = {};
for (const cfg of GRID) {
  results[cfg.key] = simulate(cfg);
  const r = results[cfg.key];
  const star = cfg.key === CHAMPION_KEY ? "⭐" : "  ";
  console.log(`${star} ${cfg.key.padEnd(18)} CAGR ${String(r.cagr).padStart(5)}% | DD ${String(r.maxDD).padStart(5)}% | MAR ${String(r.mar).padStart(5)} | sub [${r.sub}]`);
}

// ── Veredicto anti-sobreajuste ────────────────────────────────────────────────
const champ = results[CHAMPION_KEY];
let verdict = { decision: "MANTENER", champion: CHAMPION_KEY, challenger: null, reason: "" };
for (const [key, r] of Object.entries(results)) {
  if (key === CHAMPION_KEY) continue;
  const marEdge = r.mar - champ.mar;
  const subWins = r.sub.filter((s, i) => s > champ.sub[i]).length;
  if (marEdge > 0.10 && subWins >= 2) {
    if (!verdict.challenger || r.mar > results[verdict.challenger].mar) {
      verdict = {
        decision: "RETADOR SUPERA AL CAMPEÓN",
        champion: CHAMPION_KEY,
        challenger: key,
        reason: `MAR ${r.mar} vs ${champ.mar} (+${marEdge.toFixed(2)} > 0.10) y gana ${subWins}/3 subperíodos`,
      };
    }
  }
}
if (verdict.decision === "MANTENER") {
  verdict.reason = "Ningún retador supera el umbral anti-ruido (MAR +0.10 Y ≥2/3 subperíodos). Cambiar sería perseguir ruido.";
}

// ── Regla de PERSISTENCIA (añadida 3-ago tras el primer uso real) ─────────────
// La varianza ENTRE descargas de datos es enorme (el mismo campeón midió MAR 1.94 en
// jul-2026 y 1.46 en ago-2026 con pulls distintos de Yahoo). Un retador solo merece el
// trono si su ventaja PERSISTE: debe superar el umbral en DOS recalibraciones
// CONSECUTIVAS (dos muestras independientes, la una justo antes de la otra en el
// tiempo). Una sola victoria = "EN OBSERVACIÓN".
//
// ⚠️ BUG REAL detectado y corregido el 23-ago-2026: ordenar los ficheros por NOMBRE
// (`recalibracion-<fecha>.json`, orden alfabético) asume que el único fichero ausente
// es "el de hoy". Pero si una recalibración intermedia se ejecutó y su informe NO se
// guardó en `backtests/` (pasó de verdad: la del 19-ago se guardó aposta en un
// scratchpad para no tocar el repo sin permiso), el sort por nombre salta hacia atrás
// hasta el último fichero que SÍ está — aquí el del 3-ago, 20 días antes — y comparó
// contra ESE en vez de contra el 19-ago. Como el retador del 3-ago (`b100_r21_h1.1`)
// coincidió por azar con el del 23-ago, el veredicto salió "CONFIRMADO — CAMBIO
// RECOMENDADO" cuando en realidad el retador líder había ido cambiando entre medias
// (3-ago `b100_r21_h1.1` → 19-ago `b200_r21_h1.25` → 23-ago `b100_r21_h1.1`) — el
// patrón de ruido exacto que esta regla existe para descartar, no para confirmar.
// Fix: ordenar por `generatedAt` (el propio timestamp del informe), no por nombre de
// fichero — así un hueco en la serie no hace saltar la comparación a un informe viejo
// sin que quede evidencia de que se saltó nada.
if (verdict.challenger) {
  let prevChallenger = null;
  try {
    const prevFiles = fs.readdirSync(OUT_DIR)
      .filter((f) => f.startsWith("recalibracion-") && f.endsWith(".json"))
      .map((f) => {
        const full = path.join(OUT_DIR, f);
        const generatedAt = JSON.parse(fs.readFileSync(full, "utf8"))?.generatedAt ?? null;
        return { f, generatedAt };
      })
      .filter((x) => x.generatedAt)
      .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));
    // ⚠️ La comparación es SIEMPRE contra la ÚLTIMA ejecución real anterior (la penúltima
    // de la serie por generatedAt), NUNCA saltándose informes intermedios. Historia de
    // los dos bugs previos de esta misma regla, para que no vuelvan:
    //   · 23-ago (fix 3c7fdd4): ordenaba por NOMBRE de fichero, no por fecha → saltaba a
    //     un informe viejo cuando faltaba uno intermedio.
    //   · 23-ago (fix 439924a): al filtrar por edad ≥72h, DESCARTABA el informe joven en
    //     vez de abstenerse → volvía a comparar contra uno viejo saltándose el de en medio
    //     (bug encontrado por la 2ª auditoría adversarial: A@96h retador X, B@48h MANTENER,
    //     hoy X → confirmaba contra A ignorando que B rompió la racha).
    // Regla correcta: mirar SOLO el inmediatamente anterior. Si ese anterior es de la misma
    // tanda de datos (< MIN_HORAS_ENTRE_MUESTRAS), NO se puede adjudicar persistencia
    // todavía — se ABSTIENE ("muestras demasiado juntas"), no se salta a uno más viejo.
    const MIN_HORAS_ENTRE_MUESTRAS = 72;
    const ahora = Date.now();
    const anteriores = prevFiles.filter((x) => new Date(x.generatedAt).getTime() < ahora - 1000); // excluye el que se acaba de escribir
    const inmediato = anteriores.length > 0 ? anteriores[anteriores.length - 1] : null;
    let anteriorDemasiadoJoven = false;
    let comparadorReconstruido = false;
    if (inmediato) {
      const horas = (ahora - new Date(inmediato.generatedAt).getTime()) / 3_600_000;
      if (horas < MIN_HORAS_ENTRE_MUESTRAS) {
        anteriorDemasiadoJoven = true;
      } else {
        const prev = JSON.parse(fs.readFileSync(path.join(OUT_DIR, inmediato.f), "utf8"));
        prevChallenger = prev?.verdict?.challenger ?? null;
        comparadorReconstruido = prev?.reconstructed === true;   // ver 2ª auditoría, Q4
      }
    }
  } catch { /* sin informe previo */ }
  if (anteriorDemasiadoJoven) {
    verdict.decision = "RETADOR EN OBSERVACIÓN (muestra anterior demasiado reciente — misma tanda de datos)";
    verdict.reason += " · Regla de persistencia: la ejecución previa es de hace <72h; hace falta una recalibración con datos frescos independientes antes de poder confirmar.";
  } else if (prevChallenger !== verdict.challenger) {
    verdict.decision = "RETADOR EN OBSERVACIÓN (1ª victoria — se requiere confirmación)";
    verdict.reason += " · Regla de persistencia: debe repetir victoria en la PRÓXIMA recalibración para destronar (varianza entre pulls de datos > ventaja medida).";
  } else if (comparadorReconstruido) {
    // La carga de la prueba para CAMBIAR el campeón es más alta que para mantenerlo: un
    // informe reconstruido a mano (sin cadena de custodia de datos) sirve para ROMPER una
    // racha, no para ser una de las dos victorias que recomiendan el cambio.
    verdict.decision = "RETADOR EN OBSERVACIÓN (comparador reconstruido — requiere 2ª muestra ejecutada)";
    verdict.reason += " · Regla de persistencia: la muestra anterior está marcada reconstructed:true (números por memoria, sin datos verificables); no basta para recomendar cambio.";
  } else {
    verdict.decision = "RETADOR CONFIRMADO EN 2 RECALIBRACIONES — CAMBIO RECOMENDADO";
  }
}

console.log(`\n🏛 VEREDICTO: ${verdict.decision}`);
console.log(`   ${verdict.reason}`);
if (verdict.challenger) {
  console.log(`   ⚠ Revisar el informe y, si el retador está CONFIRMADO, actualizar OPTIMAL_SUPREME_CALIBRATION a ${verdict.challenger}.`);
}

// ── Informe durable (repo, no /tmp) ───────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outFile = path.join(OUT_DIR, `recalibracion-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  generatedAt: new Date().toISOString(),
  universe: T.length,
  sessions: D,
  range: `${spyDates[0]} → ${spyDates.at(-1)}`,
  championKey: CHAMPION_KEY,
  results,
  verdict,
}, null, 2));
console.log(`\nInforme → ${outFile}`);
