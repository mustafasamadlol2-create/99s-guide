export const DEFAULT_FOCUS_AUDIO_ARTWORK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 280 300'%3E%3Cdefs%3E%3ClinearGradient id='s' x2='0' y2='1'%3E%3Cstop stop-color='%23f4f9ff'/%3E%3Cstop offset='1' stop-color='%23b9d2ef'/%3E%3C/linearGradient%3E%3ClinearGradient id='m' x2='0' y2='1'%3E%3Cstop stop-color='%2395b6db'/%3E%3Cstop offset='1' stop-color='%23dbeafa'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='280' height='300' fill='url(%23s)'/%3E%3Ccircle cx='205' cy='57' r='27' fill='%23fff' fill-opacity='.68'/%3E%3Cpath d='M0 169 58 120l35 32 54-64 68 80 31-26 34 31v127H0Z' fill='url(%23m)'/%3E%3Cpath d='m93 152 54-64 35 41-18-9-16 11-15-8-19 12-14-1Z' fill='%23f8fbff' fill-opacity='.9'/%3E%3Cpath d='M0 204c45-22 80 7 122-5s89-14 158 4v97H0Z' fill='%23e8f2fd' fill-opacity='.84'/%3E%3Cpath d='M0 235c42-16 85 13 127 0s92-12 153 5v60H0Z' fill='%23c2d9f1' fill-opacity='.74'/%3E%3C/svg%3E";

export function resolveFocusAudioArtworkUrl(
  artworkUrl: string | null | undefined,
  failedArtworkUrl: string | null | undefined,
): string {
  return artworkUrl && artworkUrl !== failedArtworkUrl
    ? artworkUrl
    : DEFAULT_FOCUS_AUDIO_ARTWORK;
}