import type { ColorToken } from "../types";

export const colorClassByToken: Record<ColorToken, string> = {
  GREEN_HARD: "token-green-hard",
  GREEN_SOFT: "token-green-soft",
  YELLOW: "token-yellow",
  ORANGE: "token-orange",
  RED: "token-red",
  DARK_GREY: "token-dark-grey",
  WHITE_GREY: "token-white-grey",
};

export function colorClass(token: ColorToken): string {
  return colorClassByToken[token];
}
