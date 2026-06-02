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
  if (isWeekendUtc(date)) return "CLOSED";
  const openMinute = isUsDaylightSavingTime(date) ? 13 * 60 + 30 : 14 * 60 + 30;
  const closeMinute = isUsDaylightSavingTime(date) ? 20 * 60 : 21 * 60;
  return betweenMinutes(minutesUtc(date), openMinute, closeMinute) ? "OPEN" : "CLOSED";
}

function isContinentalEuropeOpen(date: Date): MarketHoursStatus {
  if (isWeekendUtc(date)) return "CLOSED";
  return betweenMinutes(minutesUtc(date), 7 * 60, 15 * 60 + 30) ? "OPEN" : "CLOSED";
}

function isLseOpen(date: Date): MarketHoursStatus {
  if (isWeekendUtc(date)) return "CLOSED";
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
