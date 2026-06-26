import type { MarketHoursStatus } from "../types";

type MarketGroup = "UNITED_STATES" | "EUROPE_AGGREGATE" | "CONTINENTAL_EUROPE" | "LSE" | "UNKNOWN";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function normalizeExchange(exchange: string): string {
  return exchange.trim().toUpperCase();
}

function nthSundayOfMonthUtc(year: number, monthIndex: number, occurrence: number): Date {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const firstSundayOffset = (7 - firstDay.getUTCDay()) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + firstSundayOffset + (occurrence - 1) * 7));
}

function isUsDaylightSavingTime(date: Date): boolean {
  const year = date.getUTCFullYear();
  const dstStart = new Date(nthSundayOfMonthUtc(year, 2, 2).getTime() + 7 * 60 * MINUTE);
  const dstEnd = new Date(nthSundayOfMonthUtc(year, 10, 1).getTime() + 6 * 60 * MINUTE);
  return date >= dstStart && date < dstEnd;
}

function minutesUtc(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function isWeekendUtc(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// ── Calendario de festivos bursátiles ────────────────────────────────────────
// Evita reportar OPEN (y por tanto re-habilitar EXEC) en días no hábiles. Cierres mayores por
// grupo, COMPUTADOS (no tabla anual): festivos fijos con observancia, n-ésimo día de semana y
// fechas relativas a Pascua. Auto-mantenible año a año. Verificado contra el calendario 2026.
function ymdUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Domingo de Pascua (Gregoriano, algoritmo "Anonymous Gregorian"), en UTC.
function easterSundayUtc(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nthWeekdayUtc(year: number, monthIndex: number, weekday: number, occurrence: number): Date {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (7 + weekday - first.getUTCDay()) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + offset + (occurrence - 1) * 7));
}

function lastWeekdayUtc(year: number, monthIndex: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (7 + last.getUTCDay() - weekday) % 7;
  return new Date(Date.UTC(year, monthIndex, last.getUTCDate() - offset));
}

// Festivo fijo con observancia US: sábado → viernes previo, domingo → lunes siguiente.
function observedUsUtc(year: number, monthIndex: number, day: number): string {
  const d = new Date(Date.UTC(year, monthIndex, day));
  const wd = d.getUTCDay();
  if (wd === 6) return ymdUtc(new Date(Date.UTC(year, monthIndex, day - 1)));
  if (wd === 0) return ymdUtc(new Date(Date.UTC(year, monthIndex, day + 1)));
  return ymdUtc(d);
}

function isUnitedStatesHoliday(date: Date): boolean {
  const y = date.getUTCFullYear();
  const easter = easterSundayUtc(y);
  const set = new Set<string>([
    observedUsUtc(y, 0, 1),    // Año Nuevo
    observedUsUtc(y, 5, 19),   // Juneteenth
    observedUsUtc(y, 6, 4),    // Independencia
    observedUsUtc(y, 11, 25),  // Navidad
    ymdUtc(nthWeekdayUtc(y, 0, 1, 3)),   // MLK (3.º lunes enero)
    ymdUtc(nthWeekdayUtc(y, 1, 1, 3)),   // Presidents (3.º lunes febrero)
    ymdUtc(lastWeekdayUtc(y, 4, 1)),     // Memorial (último lunes mayo)
    ymdUtc(nthWeekdayUtc(y, 8, 1, 1)),   // Labor (1.º lunes septiembre)
    ymdUtc(nthWeekdayUtc(y, 10, 4, 4)),  // Thanksgiving (4.º jueves noviembre)
    ymdUtc(new Date(easter.getTime() - 2 * DAY)), // Viernes Santo (NYSE cerrado)
  ]);
  return set.has(ymdUtc(date));
}

function isContinentalEuropeHoliday(date: Date): boolean {
  const y = date.getUTCFullYear();
  const easter = easterSundayUtc(y);
  const set = new Set<string>([
    ymdUtc(new Date(Date.UTC(y, 0, 1))),    // Año Nuevo
    ymdUtc(new Date(Date.UTC(y, 4, 1))),    // Día del Trabajo (1 mayo)
    ymdUtc(new Date(Date.UTC(y, 11, 25))),  // Navidad
    ymdUtc(new Date(Date.UTC(y, 11, 26))),  // San Esteban
    ymdUtc(new Date(easter.getTime() - 2 * DAY)), // Viernes Santo
    ymdUtc(new Date(easter.getTime() + 1 * DAY)), // Lunes de Pascua
  ]);
  return set.has(ymdUtc(date));
}

function isLseHoliday(date: Date): boolean {
  const y = date.getUTCFullYear();
  const easter = easterSundayUtc(y);
  const set = new Set<string>([
    ymdUtc(nthWeekdayUtc(y, 4, 1, 1)),   // Early May bank (1.º lunes mayo)
    ymdUtc(lastWeekdayUtc(y, 4, 1)),     // Spring bank (último lunes mayo)
    ymdUtc(lastWeekdayUtc(y, 7, 1)),     // Summer bank (último lunes agosto)
    ymdUtc(new Date(easter.getTime() - 2 * DAY)), // Viernes Santo
    ymdUtc(new Date(easter.getTime() + 1 * DAY)), // Lunes de Pascua
  ]);
  // Año Nuevo, Navidad y Boxing Day con sustitución UK (sáb/dom → siguiente día hábil).
  const ukSubstitute = (monthIndex: number, day: number) => {
    const d = new Date(Date.UTC(y, monthIndex, day));
    const wd = d.getUTCDay();
    const shift = wd === 6 ? 2 : wd === 0 ? 1 : 0;
    return ymdUtc(new Date(Date.UTC(y, monthIndex, day + shift)));
  };
  set.add(ukSubstitute(0, 1));    // Año Nuevo
  set.add(ukSubstitute(11, 25));  // Navidad
  set.add(ukSubstitute(11, 26));  // Boxing Day
  return set.has(ymdUtc(date));
}

function betweenMinutes(value: number, start: number, end: number): boolean {
  return value >= start && value < end;
}

function marketGroup(exchange: string): MarketGroup {
  const normalized = normalizeExchange(exchange);

  if (["NYSE", "NASDAQ", "NAS", "US", "USA", "UNITED STATES"].includes(normalized)) return "UNITED_STATES";
  if (["LSE", "LONDON"].includes(normalized)) return "LSE";
  if (normalized === "EUROPE") return "EUROPE_AGGREGATE";
  if (
    [
      "XETRA",
      "EURONEXT",
      "BORSA ITALIANA",
      "BORSA_ITALIANA",
      "SIX",
      "MILAN",
      "PARIS",
      "AMSTERDAM",
      "BRUSSELS",
      "LISBON",
    ].includes(normalized)
  ) {
    return "CONTINENTAL_EUROPE";
  }

  return "UNKNOWN";
}

function isUnitedStatesOpen(date: Date): MarketHoursStatus {
  if (isWeekendUtc(date) || isUnitedStatesHoliday(date)) return "CLOSED";
  const openMinute = isUsDaylightSavingTime(date) ? 13 * 60 + 30 : 14 * 60 + 30;
  const closeMinute = isUsDaylightSavingTime(date) ? 20 * 60 : 21 * 60;
  return betweenMinutes(minutesUtc(date), openMinute, closeMinute) ? "OPEN" : "CLOSED";
}

function isContinentalEuropeOpen(date: Date): MarketHoursStatus {
  if (isWeekendUtc(date) || isContinentalEuropeHoliday(date)) return "CLOSED";
  return betweenMinutes(minutesUtc(date), 7 * 60, 15 * 60 + 30) ? "OPEN" : "CLOSED";
}

function isLseOpen(date: Date): MarketHoursStatus {
  if (isWeekendUtc(date) || isLseHoliday(date)) return "CLOSED";
  return betweenMinutes(minutesUtc(date), 8 * 60, 16 * 60 + 30) ? "OPEN" : "CLOSED";
}

export function isMarketOpen(exchange: string, date = new Date()): MarketHoursStatus {
  const group = marketGroup(exchange);

  if (group === "UNITED_STATES") return isUnitedStatesOpen(date);
  if (group === "LSE") return isLseOpen(date);
  if (group === "CONTINENTAL_EUROPE") return isContinentalEuropeOpen(date);
  if (group === "EUROPE_AGGREGATE") {
    return isContinentalEuropeOpen(date) === "OPEN" || isLseOpen(date) === "OPEN" ? "OPEN" : "CLOSED";
  }

  return "CLOSED";
}

export function getRegionalMarketStates(date = new Date()) {
  const europe = isMarketOpen("Europe", date);
  const unitedStates = isMarketOpen("United States", date);

  return {
    europe,
    unitedStates,
    marketHours: europe === "OPEN" || unitedStates === "OPEN" ? "OPEN" : "CLOSED",
    marketMode:
      europe === "OPEN" && unitedStates === "OPEN"
        ? "BOTH_OPEN"
        : europe === "OPEN"
          ? "EU_OPEN"
          : unitedStates === "OPEN"
            ? "US_OPEN"
            : "CLOSED",
  } as const;
}
