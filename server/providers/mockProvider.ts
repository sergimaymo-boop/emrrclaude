import type { ApiProviderPublicState } from "../../shared/types";

const PLACEHOLDER_MARKERS = ["your_", "_here", "placeholder"];

export function resolveProviderState(apiKey: string | undefined): ApiProviderPublicState {
  if (!apiKey) return "not_configured";

  const normalized = apiKey.trim().toLowerCase();
  if (!normalized) return "not_configured";

  const isPlaceholder = PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
  return isPlaceholder ? "not_configured" : "configured";
}
