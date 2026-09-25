/**
 * VERIFY-COHERENCE — sanidad de data/universe-10y.json · v2 (25-sep-2026).
 *
 * POR QUÉ v2: la v1 (17-ago-2026) muestreaba 11 de 604 tickers (cada 60º) y se le
 * escaparon los errores que destapó la auditoría del 25-sep-2026:
 *   · MNST — barras mezcladas ajustadas/sin ajustar por su split 2:1 del 11-ago-2026
 *     (vaivén ~47↔~93 el 20/23/31-jul y 3/6/7-ago, y −50% permanente el 11-ago);
 *   · AVB  — desde el 22-may-2026 la serie venía re-expresada en unidades VMRK
 *     (÷2,793, fusión con EQR) → −64% ficticio;
 *   · STLAP — 1.135 cierres planos de relleno antes de la fusión Stellantis y +95%
 *     el 18-ene-2021;
 *   · y otros que solo se ven mirando TODO (ajustes de dividendo corruptos en
 *     SOLB/ALTR/UNI, cambio de divisa de CPG, escisión de Amrize sin ajustar en HOLN).
 * v2 revisa TODOS los tickers, en ~1,5 s. La reparación del 25-sep queda anotada en
 * el propio JSON (campo `repairs`) y los eventos reales revisados, en LISTA_BLANCA.
 *
 * ERRORES DUROS (exit 1):
 *   SIN_BENCHMARK       falta SPY.US (calendario maestro de todos los estudios)
 *   SERIE_VACIA         ticker sin barras
 *   PRECIO_INVALIDO     c, a, h o l no finito o ≤ 0
 *   FECHA_INVALIDA      d no es YYYY-MM-DD
 *   FECHA_DESORDENADA   fecha duplicada o no creciente
 *   FECHA_FUTURA        barra posterior al día de la descarga (fetchedAt)
 * AVISOS (exit 0; con --strict también exit 1):
 *   SALTO_50            |retorno diario del cierre AJUSTADO| > 50%
 *   VAIVEN              salto ≥20% revertido en ≤3 sesiones por otro de tamaño parecido
 *                       (neto < 35% del menor) — la firma de barras mezcladas
 *   HUECO               >10 días naturales entre barras con ≥3 sesiones de su bolsa entremedias
 *   FIN_PREMATURO       la serie acaba ≥3 sesiones antes que su bolsa (deslistado / descarga fallida)
 *   PLANO               ≥10 cierres ajustados idénticos seguidos (relleno de Yahoo / suspensión)
 *   AJUSTE_SOSPECHOSO   el paso del ratio ajustado/cierre implica un dividendo >3% y el retorno
 *                       ajustado se separa >5 pp de la mediana de su bolsa ese día (así se
 *                       destaparon los dividendos corruptos de SOLB/ALTR/UNI)
 *   BARRA_EN_CURSO      última barra del mismo día que la descarga, bajada antes del cierre
 *   H_MENOR_L           h < l
 *   C_FUERA_HL          ticker con ≥5 barras cuyo cierre cae fuera de [l, h] por más de 0,5%
 *                       (h/l poco fiables: ojo con ATR y réplicas de stops intradía)
 * INFO (no cuentan): saltos 30-50% no listados (--verbose los enseña), cierre fuera de
 *   [l,h] esporádico (<5 barras: casi siempre el cierre repetido del día anterior con h/l
 *   del día real → el retorno llega un día tarde) o ≤0,5%, velas planas de volumen 0, barras
 *   fuera del calendario del SPY (loadUniverse las ignora), series < 300 barras
 *   (loadUniverse las descarta) e inicios tardíos (IPOs y recortes de la reparación).
 *
 * Uso: node scripts/verify-coherence-data-sanity.mjs [ruta.json] [--strict] [--verbose]
 * Solo lee. No modifica nada.
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const VERBOSE = args.includes("--verbose");
const PATH = args.find((a) => !a.startsWith("--")) ?? "data/universe-10y.json";

// ─── LISTA BLANCA: eventos REALES revisados (o conservados a sabiendas) ─────────
// clave: regla|ticker|fecha (fecha = barra del salto, inicio del vaivén o de la racha plana;
// para FIN_PREMATURO, la última barra). Cada entrada lleva su motivo; si una regla salta en
// una fecha NO listada, es un aviso nuevo que hay que investigar antes de fiarse de un backtest.
const LISTA_BLANCA = {
  // SALTO_50 — movimientos reales verificados
  "SALTO_50|MRNA.US|2026-08-19": "+177%: Fase 3 melanoma INTerpath-001 (Moderna/Merck), verificado en CNBC/Axios/Forbes (§10f)",
  "SALTO_50|ARGX.BR|2017-12-11": "+56%: resultados positivos Fase 2 de efgartigimod en miastenia gravis (comunicado 11-dic-2017)",
  "SALTO_50|OXY.US|2020-03-09": "−52%: guerra de precios del petróleo (lunes negro del crudo)",
  "SALTO_50|PCG.US|2019-01-14": "−52%: PG&E anuncia que se declarará en quiebra por los incendios",
  "SALTO_50|PCG.US|2019-01-24": "+75%: Cal Fire exonera a PG&E del incendio Tubbs",
  "SALTO_50|BMPS.MI|2017-10-25": "−70%: reapertura tras 10 meses de suspensión y la recapitalización precautoria",
  "SALTO_50|SPM.MI|2022-06-28": "+70%: ampliación de capital 95×1 de Saipem (Consob avisó de volatilidad extrema, 23-jun-2022); se conserva",
  // VAIVEN — whipsaws reales (crash COVID, incendios de PG&E, aducanumab)
  "VAIVEN|AMP.US|2020-03-13": "crash COVID", "VAIVEN|BPE.MI|2020-03-12": "crash COVID",
  "VAIVEN|HCA.US|2020-03-16": "crash COVID", "VAIVEN|MNG.LSE|2020-03-16": "crash COVID",
  "VAIVEN|OKE.US|2020-03-18": "crash COVID", "VAIVEN|ON.US|2020-03-16": "crash COVID",
  "VAIVEN|RCL.US|2020-04-01": "crash COVID", "VAIVEN|SPG.US|2020-03-18": "crash COVID",
  "VAIVEN|STT.US|2020-03-13": "crash COVID", "VAIVEN|TDG.US|2020-03-16": "crash COVID",
  "VAIVEN|TDG.US|2020-03-18": "crash COVID", "VAIVEN|UBER.US|2020-03-18": "crash COVID",
  "VAIVEN|WELL.US|2020-03-16": "crash COVID",
  "VAIVEN|BIIB.US|2020-11-04": "aducanumab: informe FDA favorable (+44%) y panel negativo (−28%)",
  "VAIVEN|PCG.US|2018-11-14": "Camp Fire", "VAIVEN|PCG.US|2018-11-15": "Camp Fire",
  "VAIVEN|PCG.US|2019-10-25": "Kincade Fire / cortes preventivos", "VAIVEN|PCG.US|2019-10-28": "Kincade Fire / cortes preventivos",
  // PLANO — suspensiones reales o relleno conservado a sabiendas
  "PLANO|BMPS.MI|2016-12-22": "suspensión real de cotización 22-dic-2016 → 25-oct-2017",
  "PLANO|MT.PA|2016-08-08": "serie muerta (Yahoo la sirve como 'MUTUALFUND' a precio constante hasta 2018-05-07): inerte, score 50 plano, nunca seleccionable",
  "PLANO|MT.PA|2017-05-18": "serie muerta (ver arriba)",
  "PLANO|SRG.MI|2017-02-10": "relleno de Yahoo sin negociación; el retorno total a través del hueco se conserva",
  "PLANO|SRG.MI|2017-03-17": "relleno de Yahoo sin negociación; el retorno total a través del hueco se conserva",
  // HUECO / FIN_PREMATURO — deslistados y recortes de la reparación del 25-sep
  "HUECO|EA.US|2026-08-04": "hueco de Yahoo 17-jul → 4-ago-2026 en plena OPA; hoy Yahoo ya no sirve EA (no se puede rellenar)",
  "FIN_PREMATURO|EA.US|2026-08-10": "excluida de bolsa tras la compra por PIF/Silver Lake (última barra real 4-ago; relleno plano v=0 después)",
  "FIN_PREMATURO|EQR.US|2026-08-21": "fusión con AVB → Vivmark (VMRK) el 17-ago-2026 (relleno plano v=0 del 18 al 21)",
  "FIN_PREMATURO|AVB.US|2026-05-21": "reparación 25-sep: recortada donde Yahoo empezó a servirla en unidades VMRK (÷2,793)",
  "FIN_PREMATURO|CPG.LSE|2026-03-31": "reparación 25-sep: recortada en el cambio de divisa de cotización GBp→USD (1-abr-2026)",
  "FIN_PREMATURO|HOLN.SW|2025-06-13": "reparación 25-sep: recortada antes de la escisión de Amrize (Yahoo no la ajusta)",
  "FIN_PREMATURO|MT.PA|2018-05-07": "serie muerta (ver PLANO)",
  "FIN_PREMATURO|APH.US|2026-08-21": "descargas fallidas 24-ago→1-sep-2026; NO se rellena a propósito: la re-descarga re-escala todo el histórico (split 2:1 de sep-2026, redondeo float32) y rompe las anclas 1e-12 de lab-day-core. OJO: la actualización incremental de 3 meses de rally-fetch-universe.mjs metería un −50% ficticio (mismo mecanismo que MNST) → rellenar solo con re-descarga COMPLETA",
  // C_FUERA_HL (por ticker, fecha "*")
  "C_FUERA_HL|CCEP.LSE|*": "línea LSE poco negociada: máximos/mínimos de Yahoo que no casan con el cierre (421 barras); no afecta a estudios sobre cierres, sí a réplicas intradía",
  // AJUSTE_SOSPECHOSO — revisados uno a uno el 25-sep-2026 y conservados
  "AJUSTE_SOSPECHOSO|OXY.US|2020-03-09": "crash real del crudo coincidiendo con el ex-dividendo",
  "AJUSTE_SOSPECHOSO|DIE.BR|2024-12-10": "dividendo extraordinario REAL de 74 €/acción: el ajuste de Yahoo cuadra con él (+27% de rentabilidad total según los precios registrados)",
  "AJUSTE_SOSPECHOSO|BKR.US|2017-07-05": "dividendo especial de 17,50 $ de la fusión con GE Oil & Gas",
  "AJUSTE_SOSPECHOSO|VNA.XETRA|2022-05-02": "DUDOSO: salto de nivel +11% en el ex-dividendo que Yahoo sigue sirviendo; sin fuente para corregirlo, se conserva",
  "AJUSTE_SOSPECHOSO|ALTR.LS|2022-05-17": "dividendo real de 0,25 € (stockanalysis) bien ajustado; la subida de +9,9% del día la corroboran máximo/mínimo y volumen doble",
  "AJUSTE_SOSPECHOSO|AGN.AS|2017-05-22": "dividendo real (3%); el pico de precio del día tiene máximos/mínimos coherentes — se conserva",
  "AJUSTE_SOSPECHOSO|SAN.PA|2020-05-04": "ex-dividendo real (3,7%) en un día de caída general; plausible",
  "AJUSTE_SOSPECHOSO|ACA.PA|2018-05-22": "ex-dividendo real (0,63 €) — plausible",
  "AJUSTE_SOSPECHOSO|DHL.XETRA|2022-05-09": "ex-dividendo real (1,80 €) con cierre repetido del día anterior; efecto menor",
  "AJUSTE_SOSPECHOSO|IHG.LSE|2019-01-14": "dividendo especial + contrasplit de enero-2019; efecto menor",
  "AJUSTE_SOSPECHOSO|AGS.BR|2022-10-26": "ex-dividendo real; efecto menor",
};
// Rachas planas de la línea previa a la cotización de Amcor en NYSE (11-jun-2019): casi sin
// negociación pero precios reales → se aceptan todas las anteriores a esa fecha.
const PLANO_ANTES_DE = { "AMCR.US": "2019-06-11" };

// ─── carga ───────────────────────────────────────────────────────────────────
const t0 = Date.now();
const raw = JSON.parse(fs.readFileSync(PATH, "utf8"));
const S = raw.series ?? {};
const syms = Object.keys(S).sort();
const hard = [], warn = [], info = {}, whitelisted = [];
const addInfo = (k, msg) => { (info[k] ??= []).push(msg); };
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const DAY = 86400e3;
const fetched = raw.fetchedAt ? new Date(raw.fetchedAt) : null;
const fetchedDay = fetched && !Number.isNaN(fetched.getTime()) ? fetched.toISOString().slice(0, 10) : null;
const fetchedMin = fetchedDay ? fetched.getUTCHours() * 60 + fetched.getUTCMinutes() : null;
// cierre de la sesión en minutos UTC (+15 de margen para subastas), con horario de verano:
// EE.UU. 16:00 ET (DST 2º domingo de marzo → 1er domingo de noviembre); Europa 17:30 CET /
// 16:30 Londres-Lisboa = 15:30Z en verano (último domingo de marzo → último de octubre), 16:30Z en invierno
const domingoN = (y, m, n) => ((7 - new Date(Date.UTC(y, m, 1)).getUTCDay()) % 7) + 1 + 7 * (n - 1);
const ultimoDomingo = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
function CIERRE_UTC_MIN(ex, dia) {
  const [y, mo, da] = dia.split("-").map(Number), md = mo * 100 + da;
  if (ex === "US") return (md >= 300 + domingoN(y, 2, 2) && md < 1100 + domingoN(y, 10, 1) ? 20 * 60 : 21 * 60) + 15;
  return (md >= 300 + ultimoDomingo(y, 2) && md < 1000 + ultimoDomingo(y, 9) ? 15 * 60 + 30 : 16 * 60 + 30) + 15;
}

function flag(regla, sym, d, detalle) {
  const k = `${regla}|${sym}|${d}`;
  if (LISTA_BLANCA[k]) { whitelisted.push({ k, motivo: LISTA_BLANCA[k] }); return; }
  if (regla === "PLANO" && PLANO_ANTES_DE[sym] && d < PLANO_ANTES_DE[sym]) { whitelisted.push({ k, motivo: `línea previa a la cotización (${PLANO_ANTES_DE[sym]})` }); return; }
  warn.push({ regla, sym, d, detalle });
}

if (!S["SPY.US"]?.bars?.length) hard.push({ regla: "SIN_BENCHMARK", sym: "SPY.US", d: "-", detalle: "falta SPY.US: todos los estudios usan su calendario" });
const spyLast = S["SPY.US"]?.bars?.at(-1)?.d ?? null;
const spyDates = new Set((S["SPY.US"]?.bars ?? []).map((b) => b.d));

// ─── calendario por bolsa: un día es sesión si tiene barra ≥50% de sus tickers vivos ─
const porBolsa = {};
for (const sym of syms) {
  const s = S[sym], b = s.bars ?? [];
  if (!b.length) continue;
  const ex = s.exchange ?? "?";
  porBolsa[ex] ??= { cuenta: new Map(), vidas: [] };
  porBolsa[ex].vidas.push([b[0].d, b.at(-1).d]);
  for (const x of b) porBolsa[ex].cuenta.set(x.d, (porBolsa[ex].cuenta.get(x.d) ?? 0) + 1);
}
const sesiones = {};
for (const [ex, { cuenta, vidas }] of Object.entries(porBolsa)) {
  sesiones[ex] = [...cuenta.keys()].sort().filter((d) => cuenta.get(d) >= 0.5 * vidas.filter(([a, z]) => a <= d && d <= z).length);
}
const idxSesion = Object.fromEntries(Object.entries(sesiones).map(([ex, L]) => [ex, new Map(L.map((d, i) => [d, i]))]));

// mediana del retorno ajustado por bolsa y día (para AJUSTE_SOSPECHOSO)
const retsDia = {};
for (const sym of syms) {
  const s = S[sym], b = s.bars ?? [];
  const m = (retsDia[s.exchange] ??= new Map());
  for (let i = 1; i < b.length; i++) {
    if (!(isNum(b[i].a) && isNum(b[i - 1].a) && b[i - 1].a > 0)) continue;
    const arr = m.get(b[i].d); const r = b[i].a / b[i - 1].a - 1;
    if (arr) arr.push(r); else m.set(b[i].d, [r]);
  }
}
const mediana = {};
for (const [ex, m] of Object.entries(retsDia)) {
  mediana[ex] = new Map();
  for (const [d, arr] of m) { arr.sort((x, y) => x - y); mediana[ex].set(d, arr[Math.floor(arr.length / 2)]); }
}

// ─── revisión ticker a ticker ────────────────────────────────────────────────
let totalBarras = 0;
for (const sym of syms) {
  const s = S[sym], b = s.bars ?? [], ex = s.exchange ?? "?";
  if (!b.length) { hard.push({ regla: "SERIE_VACIA", sym, d: "-", detalle: "sin barras" }); continue; }
  totalBarras += b.length;
  if (b.length < 300) addInfo("SERIE_CORTA", `${sym} (${b.length} barras: loadUniverse la descarta)`);
  const ses = sesiones[ex] ?? [], idx = idxSesion[ex] ?? new Map();
  if (ses.length && b[0].d > ses[0]) addInfo("INICIO_TARDIO", `${sym} desde ${b[0].d}`);
  let v0planas = 0, fueraSpy = 0, racha = 1, cFuera = 0, cFueraPeor = 0, cFueraDia = null;
  const L = new Array(b.length).fill(0);
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    if (typeof x.d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.d)) { hard.push({ regla: "FECHA_INVALIDA", sym, d: String(x.d), detalle: "" }); continue; }
    for (const k of ["c", "a", "h", "l"]) if (!isNum(x[k]) || x[k] <= 0) hard.push({ regla: "PRECIO_INVALIDO", sym, d: x.d, detalle: `${k}=${x[k]}` });
    if (fetchedDay && x.d > fetchedDay) hard.push({ regla: "FECHA_FUTURA", sym, d: x.d, detalle: `posterior a la descarga (${raw.fetchedAt})` });
    if (spyLast && !spyDates.has(x.d)) fueraSpy++;
    if (isNum(x.h) && isNum(x.l) && x.h < x.l) flag("H_MENOR_L", sym, x.d, `h=${x.h} l=${x.l}`);
    if (isNum(x.h) && isNum(x.l) && isNum(x.c) && (x.c > x.h || x.c < x.l)) {
      const fuera = x.c > x.h ? x.c / x.h - 1 : x.l / x.c - 1;
      if (fuera > 0.005) { cFuera++; if (fuera > cFueraPeor) { cFueraPeor = fuera; cFueraDia = x.d; } }
      else addInfo("C_FUERA_HL_LEVE", `${sym} ${x.d}`);
    }
    if (i === 0) continue;
    const p = b[i - 1];
    if (!(x.d > p.d)) { hard.push({ regla: "FECHA_DESORDENADA", sym, d: x.d, detalle: `anterior ${p.d}` }); continue; }
    if (x.v === 0 && x.c === p.c) v0planas++;
    // hueco con la bolsa abierta
    const dias = (Date.parse(x.d) - Date.parse(p.d)) / DAY;
    if (dias > 10) {
      const i0 = idx.get(p.d), i1 = idx.get(x.d);
      const perdidas = i0 != null && i1 != null ? i1 - i0 - 1 : ses.filter((d) => d > p.d && d < x.d).length;
      if (perdidas >= 3) flag("HUECO", sym, x.d, `${dias} días naturales desde ${p.d}, ${perdidas} sesiones de ${ex} sin barra`);
    }
    if (!(isNum(x.a) && isNum(p.a) && p.a > 0 && x.a > 0)) continue;
    const ra = x.a / p.a - 1, rc = isNum(x.c) && isNum(p.c) && p.c > 0 ? x.c / p.c - 1 : NaN;
    L[i] = Math.log(x.a / p.a);
    if (Math.abs(ra) > 0.5) flag("SALTO_50", sym, x.d, `ajustado ${p.a.toFixed(4)}→${x.a.toFixed(4)} (${(ra * 100).toFixed(1)}%)`);
    else if (Math.abs(ra) > 0.3) addInfo("SALTO_30_50", `${sym} ${x.d} ${(ra * 100).toFixed(1)}%`);
    if (isNum(rc)) {
      const y = (1 + ra) / (1 + rc) - 1;
      const med = mediana[ex]?.get(x.d) ?? 0;
      if (Math.abs(y) > 0.03 && Math.abs(ra - med) > 0.05) flag("AJUSTE_SOSPECHOSO", sym, x.d, `dividendo implícito ${(y * 100).toFixed(1)}% · cierre ${(rc * 100).toFixed(1)}% · ajustado ${(ra * 100).toFixed(1)}% · mediana ${ex} ${(med * 100).toFixed(1)}%`);
    }
    // racha plana (cierres ajustados idénticos)
    if (x.a === p.a) racha++;
    if (x.a !== p.a || i === b.length - 1) {
      const fin = x.a !== p.a ? i - 1 : i;
      if (racha >= 10) flag("PLANO", sym, b[fin - racha + 1].d, `${racha} cierres idénticos hasta ${b[fin].d}`);
      if (x.a !== p.a) racha = 1;
    }
  }
  // vaivén: salto ≥20% revertido en ≤3 sesiones por otro de tamaño parecido
  const UMB = Math.log(1.2);
  for (let i = 1; i < b.length; i++) {
    if (Math.abs(L[i]) < UMB) continue;
    for (let j = i + 1; j <= Math.min(i + 3, b.length - 1); j++) {
      if (Math.abs(L[j]) < UMB || Math.sign(L[j]) === Math.sign(L[i])) continue;
      if (Math.abs(L[i] + L[j]) < 0.35 * Math.min(Math.abs(L[i]), Math.abs(L[j]))) {
        flag("VAIVEN", sym, b[i].d, `${b[i].d} ${((Math.exp(L[i]) - 1) * 100).toFixed(1)}% y ${b[j].d} ${((Math.exp(L[j]) - 1) * 100).toFixed(1)}%`);
        break;
      }
    }
  }
  // final prematuro y barra en curso
  const ult = b.at(-1).d;
  if (ses.length) {
    const tras = ses.length - 1 - (idx.get(ult) ?? ses.filter((d) => d <= ult).length - 1);
    if (tras >= 3) flag("FIN_PREMATURO", sym, ult, `última barra ${ult}; ${ex} sigue ${tras} sesiones más (hasta ${ses.at(-1)})`);
  }
  if (fetchedDay && ult === fetchedDay && fetchedMin < CIERRE_UTC_MIN(ex, ult)) flag("BARRA_EN_CURSO", sym, ult, `descargada a las ${raw.fetchedAt.slice(11, 16)}Z, antes del cierre de ${ex}`);
  // cierre fuera de [l,h] >0,5%: sistemático (≥5 barras) = aviso; esporádico = info (suelen ser
  // cierres repetidos del día anterior con h/l ya del día real → el retorno llega un día tarde)
  if (cFuera >= 5) flag("C_FUERA_HL", sym, "*", `${cFuera} barras con el cierre fuera de [l,h] >0,5% (peor ${(cFueraPeor * 100).toFixed(1)}% el ${cFueraDia})`);
  else if (cFuera) addInfo("C_FUERA_HL_ESPORADICO", `${sym}: ${cFuera} (peor ${(cFueraPeor * 100).toFixed(1)}% el ${cFueraDia})`);
  if (v0planas) addInfo("VELA_PLANA_V0", `${sym}: ${v0planas}`);
  if (fueraSpy) addInfo("FUERA_CALENDARIO_SPY", `${sym}: ${fueraSpy}`);
}

// ─── informe ─────────────────────────────────────────────────────────────────
const first = syms.map((s) => S[s].bars?.[0]?.d).filter(Boolean).sort()[0];
const last = syms.map((s) => S[s].bars?.at(-1)?.d).filter(Boolean).sort().at(-1);
console.log(`SANIDAD ${PATH}`);
console.log(`universo: ${syms.length} series (${syms.length - 1} tickers + SPY) · ${totalBarras} barras · ${first} → ${last} · SPY hasta ${spyLast} · descarga ${raw.fetchedAt ?? "?"}`);
if (raw.repairs) console.log(`reparación ${raw.repairs.at}: ${raw.repairs.replacedFromFreshYahoo?.length ?? 0} series re-descargadas · ${raw.repairs.truncated?.length ?? 0} recortadas (${(raw.repairs.truncated ?? []).map((t) => t.sym).join(", ")}) · ${raw.repairs.droppedInProgressBars ?? 0} barras en curso eliminadas`);
const cuenta = (arr) => arr.reduce((m, x) => ((m[x.regla] = (m[x.regla] ?? 0) + 1), m), {});
console.log(`\nERRORES DUROS: ${hard.length}`, hard.length ? cuenta(hard) : "");
for (const h of hard.slice(0, 40)) console.log(`  ✗ ${h.regla.padEnd(18)} ${h.sym.padEnd(12)} ${h.d}  ${h.detalle}`);
if (hard.length > 40) console.log(`  … y ${hard.length - 40} más`);
console.log(`\nAVISOS: ${warn.length}`, warn.length ? cuenta(warn) : "", `· en lista blanca (revisados): ${whitelisted.length}`);
const porRegla = {};
for (const w of warn) (porRegla[w.regla] ??= []).push(w);
for (const [regla, L] of Object.entries(porRegla)) {
  for (const w of L.slice(0, VERBOSE ? L.length : 25)) console.log(`  ⚠ ${regla.padEnd(18)} ${w.sym.padEnd(12)} ${w.d}  ${w.detalle}`);
  if (!VERBOSE && L.length > 25) console.log(`  … y ${L.length - 25} ${regla} más (--verbose)`);
}
console.log(`\nINFO: ${Object.entries(info).map(([k, v]) => `${k} ${v.length}`).join(" · ") || "—"}`);
if (VERBOSE) {
  for (const [k, v] of Object.entries(info)) console.log(`  ${k}: ${v.join(" · ")}`);
  console.log(`\nLISTA BLANCA aplicada (${whitelisted.length}):`);
  for (const w of whitelisted) console.log(`  ✓ ${w.k} — ${w.motivo}`);
}
const ms = Date.now() - t0;
if (hard.length) { console.log(`\n✗ SANIDAD FALLA: ${hard.length} errores duros (${ms} ms)`); process.exit(1); }
if (warn.length) { console.log(`\n⚠ SANIDAD CON AVISOS: ${warn.length} sin revisar — investigar antes de fiarse de un backtest (${ms} ms)`); process.exit(STRICT ? 1 : 0); }
console.log(`\n✓ SANIDAD OK: 0 errores duros · 0 avisos sin revisar · ${whitelisted.length} eventos reales en lista blanca (${ms} ms)`);
