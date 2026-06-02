import type { ColorToken } from "../types";
import { colorClass } from "../utils/colors";

interface BadgeProps {
  children: string | number;
  token?: ColorToken;
}

export function Badge({ children, token = "WHITE_GREY" }: BadgeProps) {
  return <span className={`badge ${colorClass(token)}`}>{children}</span>;
}
