import type { MarketHoursStatus } from "../types";
import { isMarketOpen } from "../utils/marketHours";

export function getMockMarketStatus(exchange = "United States", date = new Date()): MarketHoursStatus {
  return isMarketOpen(exchange, date);
}
