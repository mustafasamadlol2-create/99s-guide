import type { AmbientTrackId, FocusAmbientTrack } from "./types";

/**
 * No redistributable ambient audio is currently present in the repository.
 * Keep the local catalog contract ready without fabricating or downloading tracks.
 */
export const FOCUS_AMBIENT_CATALOG: readonly FocusAmbientTrack[] = Object.freeze([]);

export function findFocusAmbientTrack(
  trackId: AmbientTrackId,
  catalog: readonly FocusAmbientTrack[] = FOCUS_AMBIENT_CATALOG,
): FocusAmbientTrack | undefined {
  return catalog.find((track) => track.id === trackId);
}

export function isLocalBundledAudioSource(source: string): boolean {
  return (source.startsWith("/") && !source.startsWith("//")) ||
    source.startsWith("./") ||
    source.startsWith("../");
}