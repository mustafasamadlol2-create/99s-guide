import { apiClient, clearApiCache } from "../../core/api/apiClient";
import { FOCUS_SOUNDS_LIBRARY_CHANGED_EVENT } from "./sharedSoundsApi";
import type { FocusSharedSound } from "./types";

function announceFocusSoundsChanged(): void {
  clearApiCache("/api/focus-sounds");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_SOUNDS_LIBRARY_CHANGED_EVENT));
  }
}

async function parseOne(response: Response): Promise<FocusSharedSound> {
  const body = await response.json() as { sound?: FocusSharedSound };
  if (!body.sound) throw new Error("Focus sound response is invalid.");
  return body.sound;
}

export async function listOwnerFocusSounds(): Promise<FocusSharedSound[]> {
  const response = await apiClient("/api/admin/focus-sounds", {
    bypassCache: true,
    retries: 1,
    requestKey: "owner-focus-sounds",
  });
  const body = await response.json() as { sounds?: FocusSharedSound[] };
  return Array.isArray(body.sounds) ? body.sounds : [];
}

export async function uploadOwnerFocusSound(input: { name: string; file: File }): Promise<FocusSharedSound> {
  const form = new FormData();
  form.set("name", input.name);
  form.set("file", input.file);
  const response = await apiClient("/api/admin/focus-sounds", {
    method: "POST",
    body: form,
    timeoutMs: 120_000,
  });
  const sound = await parseOne(response);
  announceFocusSoundsChanged();
  return sound;
}

export async function updateOwnerFocusSound(
  id: string,
  patch: { name?: string; isEnabled?: boolean; sortOrder?: number },
): Promise<FocusSharedSound> {
  const response = await apiClient(`/api/admin/focus-sounds/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const sound = await parseOne(response);
  announceFocusSoundsChanged();
  return sound;
}

export async function reorderOwnerFocusSounds(ids: string[]): Promise<void> {
  await apiClient("/api/admin/focus-sounds/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  announceFocusSoundsChanged();
}

export async function deleteOwnerFocusSound(id: string): Promise<void> {
  await apiClient(`/api/admin/focus-sounds/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  announceFocusSoundsChanged();
}
