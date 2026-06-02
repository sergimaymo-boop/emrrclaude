import type { Top8Asset } from "../types";
import { formatTop8ForExport } from "../utils/export";

export function createMockTop8Output(top8: Top8Asset[]): string {
  return formatTop8ForExport(top8);
}
