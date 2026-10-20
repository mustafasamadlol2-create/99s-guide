import { apiClient } from "../../core/api/apiClient";
import type { FocusSharedSound } from "./types";

async function parseSounds(response: Response): Promise<FocusSharedSound[]> {
  const body = await response.json() as { sounds?: unknown };
  if (!Array.isArray(body.sounds)) return [];
  return body.sounds.filter((value): value is FocusSharedSound => {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<FocusSharedSound>;
    return typeof item.id === "string"
      && typeof item.name === "string"
      && typeof item.playbackUrl === "string"
      && typeof item.mimeType === "string"
      && typeof item.sizeBytes === "number"
      && typeof item.sortOrder === "number"
      && typeof item.isEnabled === "boolean";
  });
}

export async function listFocusSharedSounds(options: { bypassCache?: boolean } = {}): Promise<FocusSharedSound[]> {
  const response = await apiClient("/api/focus-sounds", {
    bypassCache: options.bypassCache,
    ttl: 60_000,
    retries: 1,
    requestKey: "focus-sounds-library",
  });
  return parseSounds(response);
}
