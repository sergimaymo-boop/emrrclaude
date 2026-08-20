/**
 * TICKER NEWS — "¿por qué se ha movido hoy este ticker?" en UNA sola línea.
 *
 * Uso EXCLUSIVO del módulo Rally Leaders (nota informativa en el desplegable de cada
 * ticker). NO participa en ningún cálculo: ni score, ni pesos, ni stops, ni selección.
 * Si la noticia falla o no existe, el módulo funciona exactamente igual.
 *
 * Fuente: buscador de Yahoo Finance (sin clave de API). Devuelve titulares recientes;
 * el trabajo real está en ELEGIR UNO — el catalizador de verdad, no el enésimo
 * "Dow Jones Futures: S&P 500 Rises…" que menciona el ticker de pasada.
 *
 * Heurística de selección (documentada porque es lo único opinable del archivo):
 *   +  el titular nombra a la empresa o su símbolo
 *   +  contiene una palabra CATALIZADORA (resultados, FDA, fusión, subida de precio
 *      objetivo, demanda judicial…) — ponderada por importancia
 *   −  es un resumen genérico de mercado o un titular-cebo ("here's why", "3 things")
 *   +  cuanto más cerca del cierre de la sesión analizada, mejor
 * Si nada supera el listón mínimo, se devuelve null y la interfaz dice "sin motivo
 * identificado" — preferimos admitir que no lo sabemos a inventar una explicación.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const TIMEOUT_MS = 4500;
const MAX_HEADLINE = 150;

/** Palabras que suelen SER el motivo del movimiento, con su peso. */
const CATALIZADORES = [
  [/\b(phase\s*3|phase\s*iii|fase\s*3)\b/i, 6],
  [/\b(fda|ema|approval|approved|aprobaci[oó]n|autoriza)\b/i, 6],
  [/\b(trial|ensayo|study results|topline|breakthrough|hito)\b/i, 5],
  [/\b(earnings|results|resultados|revenue|beats?|misses?|guidance|previsiones|outlook)\b/i, 5],
  [/\b(merger|acquisition|acquire|takeover|buyout|fusi[oó]n|adquisici[oó]n|opa)\b/i, 6],
  [/\b(upgrade|downgrade|price target|precio objetivo|initiated coverage|raises?|cuts?)\b/i, 4],
  [/\b(contract|deal|partnership|acuerdo|contrato|adjudica)\b/i, 3],
  [/\b(lawsuit|recall|investigation|probe|demanda|fraude|bankruptcy|concurso)\b/i, 5],
  [/\b(dividend|buyback|split|recompra|dividendo)\b/i, 3],
  [/\b(ceo|cfo|resigns?|steps down|layoffs?|despidos)\b/i, 3],
  [/\b(guidance cut|profit warning|warns?)\b/i, 5],
];

/**
 * Titulares que NO explican un movimiento aunque hablen de la empresa:
 * convocatorias y agenda ("Dell celebrará conferencia el 1 de septiembre para
 * comentar resultados" — visto en producción el 20-ago-2026, colaba porque
 * contiene "results"), y opiniones de terceros.
 */
const AGENDA_U_OPINION = [
  /\b(to hold|will hold|to report|will report|to announce|to present|to participate)\b/i,
  /\b(conference call|webcast|investor day|save the date|schedule[ds]?|invites?)\b/i,
  /\b(says?|comments?|predicts?|sees|expects|thinks|opinion)\b/i,
];

/** Titulares que NO explican nada de este ticker en particular. */
const GENERICOS = [
  /\b(dow jones futures|stock market today|market wrap|futures (rise|fall|climb|slip|tick))\b/i,
  /\b(stocks? (to watch|in focus)|premarket|pre-market|after hours|movers)\b/i,
  /\b(here'?s why|3 (things|reasons)|\d+ stocks?|why did|what to know)\b/i,
  /\b(zacks|motley fool|should you buy|is it too late)\b/i,
  /\b(market outlook|sector report|industry report|market size|cagr)\b/i,
];

function limpiar(t) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > MAX_HEADLINE ? `${s.slice(0, MAX_HEADLINE - 1).trimEnd()}…` : s;
}

const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ¿El titular habla REALMENTE de esta empresa? Requisito INNEGOCIABLE.
 * El buscador de Yahoo devuelve con frecuencia noticias de otra compañía (probado
 * 20-ago-2026: para STMPA.PA y SPM.MI devolvía titulares de ATRenew, y para LRCX de
 * Jack Henry). Enseñar el motivo equivocado es peor que no enseñar ninguno.
 */
export function mencionaEmpresa(titular, { nombre, ticker }) {
  const t = String(titular || "");
  if (!t) return false;
  if (ticker && new RegExp(`\\b${escapar(ticker)}\\b`).test(t)) return true;
  const nombreCorto = String(nombre || "").split(/[\s,.]/)[0];
  return nombreCorto.length >= 3 && new RegExp(`\\b${escapar(nombreCorto)}`, "i").test(t);
}

/**
 * Puntúa un titular en DOS dimensiones que no deben mezclarse:
 *   catalizador — ¿describe un HECHO que mueve el precio? (resultados, FDA, opa…)
 *   total       — para ordenar entre varios candidatos válidos
 * Un titular puede nombrar a la empresa y ser reciente sin explicar nada ("Dell
 * amplía su patrocinio de eSports" — probado 20-ago-2026, colaba con nota alta).
 * Por eso el catalizador se exige aparte y no se compensa con recencia ni con
 * nombrar mucho a la empresa.
 */
export function puntuarTitular(titular, { nombre, ticker, horasDesde }) {
  const t = String(titular || "");
  if (!t) return { total: -Infinity, catalizador: 0 };
  if (!mencionaEmpresa(t, { nombre, ticker })) return { total: -Infinity, catalizador: 0 };
  let catalizador = 0;
  for (const [re, w] of CATALIZADORES) if (re.test(t)) catalizador = Math.max(catalizador, w);
  let p = catalizador;
  const nombreCorto = String(nombre || "").split(/[\s,.]/)[0];
  if (nombreCorto.length >= 3 && new RegExp(`\\b${escapar(nombreCorto)}`, "i").test(t)) p += 4;
  if (ticker && new RegExp(`\\b${escapar(ticker)}\\b`).test(t)) p += 2;
  for (const re of GENERICOS) if (re.test(t)) p -= 6;
  for (const re of AGENDA_U_OPINION) if (re.test(t)) { p -= 5; catalizador = Math.min(catalizador, 3); }
  if (Number.isFinite(horasDesde)) p += Math.abs(horasDesde) <= 24 ? 3 : Math.abs(horasDesde) <= 48 ? 1 : -2;
  if (t.length > 140) p -= 2;
  return { total: p, catalizador };
}

// Un titular solo se publica como MOTIVO si describe un catalizador de peso ≥ 4
// (resultados, aprobación regulatoria, fusión, cambio de recomendación…). Un
// patrocinio o una opinión de tertuliano NO son un motivo. Sin catalizador →
// "sin motivo identificado", que es la verdad.
const CATALIZADOR_MINIMO = 4;
// Además del catalizador, el titular tiene que ser específico de ESTA empresa: los
// recopilatorios ("Zacks Earnings Trends: Nvidia, Micron and Alphabet") traen la
// palabra catalizadora pero no explican el movimiento de nadie en concreto — la
// penalización de fuente genérica los deja por debajo de este listón.
const TOTAL_MINIMO = 8;

async function buscarYahoo(symbolYahoo) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbolYahoo)}&quotesCount=0&newsCount=20`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.news) ? data.news : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}


// ─── traducción al español (NORMA de Sergi, 20-ago-2026: las notas SIEMPRE en español) ───
// Se traduce con MyMemory (API gratuita, sin clave) y se corrige después con un glosario
// financiero propio: los traductores automáticos destrozan la jerga de bolsa
// ("upgrades" → "actualiza", "outperform" → "rendimiento superior"). El resultado se
// cachea 30 min con el resto de la respuesta, así que son ~10 llamadas por scan.
const GLOSARIO_ES = [
  // recomendaciones de analista — lo que peor traducen los motores automáticos
  [/\bactualiza (la calificación de |el rating de )?/gi, "mejora la recomendación de "],
  [/\bmejora de categoría\b/gi, "mejora de recomendación"],
  [/\bdegrada\b/gi, "recorta la recomendación de"],
  [/\bcalificación de rendimiento superior\b/gi, "recomendación de sobreponderar"],
  [/\bcalificación de rendimiento inferior\b/gi, "recomendación de infraponderar"],
  [/\brendimiento superior\b/gi, "recomendación de sobreponderar"],
  [/\brendimiento inferior\b/gi, "recomendación de infraponderar"],
  [/\bcalificación de espera\b/gi, "recomendación de mantener"],
  [/\bcalificación de compra\b/gi, "recomendación de comprar"],
  [/\bcalificación de venta\b/gi, "recomendación de vender"],
  [/\bcalificación neutral\b/gi, "recomendación neutral"],
  [/\bsobrepeso\b/gi, "sobreponderar"],
  // vocabulario de mercado
  [/\bprecio de destino\b/gi, "precio objetivo"],
  [/\bobjetivo de precio\b/gi, "precio objetivo"],
  [/\bprecio Target\b/g, "precio objetivo"],
  [/\borientación\b/gi, "previsiones"],
  [/\bganancias por acción\b/gi, "beneficio por acción"],
  [/\blas ganancias\b/gi, "los resultados"],
  [/\brepunte\b/gi, "subida"],
  [/\bmitin\b/gi, "subida"],
  [/\bavance de la vacuna\b/gi, "hito de la vacuna"],
  // formato: "$ 550" → "550 $", sin arrastrar la puntuación siguiente
  [/\$\s*(\d[\d.,]*)/g, (_m, n) => {
    const limpio = String(n).replace(/[.,]+$/, "");
    const cola = String(n).slice(limpio.length);      // conserva la coma o el punto que seguía
    return `${limpio} $${cola}`;
  }],
  [/\bprecio objetivo en\b/gi, "precio objetivo de"],
  [/\s+([,.;])/g, "$1"],
  [/\bDesde\b/g, "desde"],
];

function pulirEspanol(t) {
  let s = String(t || "");
  for (const [re, rep] of GLOSARIO_ES) s = s.replace(re, rep);
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Traduce protegiendo los NOMBRES PROPIOS: sin esto, "Target" se convierte en "el
 * objetivo" y "Micron" en "micrón" (visto el 20-ago-2026). Cada nombre a proteger se
 * sustituye por un testigo que ningún traductor toca, y se restaura al volver.
 */
async function traducirAlEspanol(texto, proteger = []) {
  let q = String(texto || "").slice(0, 480);
  if (!q) return null;
  const testigos = [];
  for (const nombre of proteger) {
    const n = String(nombre || "").trim();
    if (n.length < 3) continue;
    // (?<!price ) evita que proteger la empresa "Target" destroce "price target"
    const re = new RegExp(`(?<!price\\s)\\b${escapar(n)}\\b`, "gi");
    if (!re.test(q)) continue;
    const testigo = `QZX${testigos.length}ZQ`;
    testigos.push([testigo, n]);
    q = q.replace(re, testigo);
  }
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en%7Ces`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return null;
    const d = await res.json();
    const t = d?.responseData?.translatedText;
    if (typeof t !== "string" || !t.trim()) return null;
    // MyMemory devuelve a veces el aviso de cuota como si fuera la traducción
    if (/MYMEMORY WARNING|QUOTA/i.test(t)) return null;
    let out = t;
    for (const [testigo, nombre] of testigos) out = out.replace(new RegExp(`${testigo}`, "gi"), nombre);
    return pulirEspanol(out);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devuelve el motivo más probable del movimiento de UN ticker, o null si no lo hay.
 * @returns {Promise<{headline:string, publisher:string, url:string, publishedAtUtc:string, score:number}|null>}
 */
export async function motivoDelMovimiento({ symbolYahoo, ticker, nombre, refDate = null }) {
  // SIEMPRE se consultan las dos vías —símbolo y nombre— y se fusionan. Yahoo devuelve
  // un conjunto ROTATORIO: probado el 20-ago-2026, la nota de Evercore sobre Dell
  // estaba en la lista a una hora y había desaparecido media hora después. Con las dos
  // consultas la cobertura sube bastante, y la caché de 30 min fija el motivo una vez
  // encontrado para que no baile en pantalla.
  const [porSimbolo, porNombre] = await Promise.all([
    buscarYahoo(symbolYahoo),
    nombre ? buscarYahoo(nombre) : Promise.resolve([]),
  ]);
  const vistos = new Set();
  const items = [...porSimbolo, ...porNombre].filter((it) => {
    const k = String(it?.title || "").toLowerCase();
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  if (!items.length) return null;
  const ref = refDate ? new Date(refDate).getTime() : Date.now();
  let mejor = null;
  for (const it of items) {
    const ts = Number(it?.providerPublishTime) * 1000;
    if (!Number.isFinite(ts)) continue;
    const horasDesde = (ref - ts) / 3_600_000;
    // Ventana: hasta 4 días ANTES del scan y hasta 2 días DESPUÉS. Lo de después
    // importa porque la reacción de los analistas al movimiento llega a la mañana
    // siguiente y suele ser el mejor resumen de lo ocurrido (caso real 20-ago-2026:
    // la nota de BofA sobre Moderna se publicó 12 h después del scan y con la
    // ventana anterior, de −12 h, se quedaba fuera por dos minutos).
    if (horasDesde < -48 || horasDesde > 96) continue;
    const { total, catalizador } = puntuarTitular(it.title, { nombre, ticker, horasDesde });
    if (catalizador < CATALIZADOR_MINIMO) continue;
    if (!mejor || total > mejor.score) {
      mejor = {
        headline: limpiar(it.title),
        publisher: String(it.publisher || "").slice(0, 40),
        url: typeof it.link === "string" ? it.link : "",
        publishedAtUtc: new Date(ts).toISOString(),
        score: total,
      };
    }
  }
  if (!mejor || mejor.score < TOTAL_MINIMO) return null;
  // NORMA: la nota se entrega SIEMPRE en español. Si la traducción falla se conserva
  // el titular original (mejor eso que quedarnos sin motivo), y `idioma` lo delata.
  const es = await traducirAlEspanol(mejor.headline, [nombre, ticker]);
  return { ...mejor, headlineOriginal: mejor.headline, headline: es ?? mejor.headline, idioma: es ? "es" : "en" };
}

/** Varios tickers en paralelo, tolerante a fallos: lo que falle sale como null. */
export async function motivosDelMovimiento(assets, { refDate = null } = {}) {
  const out = {};
  await Promise.all(
    assets.map(async (a) => {
      try {
        out[a.providerSymbol] = await motivoDelMovimiento({
          symbolYahoo: a.symbolYahoo, ticker: a.ticker, nombre: a.nombre, refDate,
        });
      } catch {
        out[a.providerSymbol] = null;
      }
    }),
  );
  return out;
}
