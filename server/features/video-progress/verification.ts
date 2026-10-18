export const VERIFIED_VIDEO_COMPLETION_RATIO = 0.8;
export const VERIFIED_VIDEO_MIN_DURATION_SECONDS = 60;
export const VERIFIED_VIDEO_MAX_DURATION_SECONDS = 6 * 60 * 60;
export const VERIFIED_VIDEO_HEARTBEAT_INTERVAL_SECONDS = 5;

export const VIDEO_PLAYER_STATES = [
  "UNSTARTED",
  "CUED",
  "PLAYING",
  "PAUSED",
  "BUFFERING",
  "ENDED",
] as const;
export type VideoPlayerState = (typeof VIDEO_PLAYER_STATES)[number];

export const VERIFIED_VIDEO_MAX_HEARTBEAT_GAP_MS = 15_000;
export const VERIFIED_VIDEO_HEARTBEAT_GRACE_MS = 1_500;
export const VERIFIED_VIDEO_MAX_PLAYBACK_RATE = 2;

export function clampVideoNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizedVideoPlaybackRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return clampVideoNumber(parsed, 0.25, VERIFIED_VIDEO_MAX_PLAYBACK_RATE);
}

export function calculateVerifiedPlaybackCredit(input: {
  elapsedMilliseconds: number;
  positionDeltaSeconds: number;
  previousPlayerState: string;
  playerState: VideoPlayerState;
  previousPlaybackRate: unknown;
  playbackRate: unknown;
}): {
  creditedMilliseconds: number;
  appearsToBeSeek: boolean;
  playbackRate: number;
} {
  const elapsedMilliseconds = clampVideoNumber(
    Number.isFinite(input.elapsedMilliseconds) ? input.elapsedMilliseconds : 0,
    0,
    VERIFIED_VIDEO_MAX_HEARTBEAT_GAP_MS,
  );
  const playbackRate = normalizedVideoPlaybackRate(input.playbackRate);
  const priorRate = normalizedVideoPlaybackRate(input.previousPlaybackRate);
  const positionDeltaSeconds = Number.isFinite(input.positionDeltaSeconds)
    ? input.positionDeltaSeconds
    : 0;
  const allowedByWallClockMs = Math.max(
    0,
    Math.floor(
      elapsedMilliseconds * Math.max(priorRate, playbackRate) * 1.25
      + VERIFIED_VIDEO_HEARTBEAT_GRACE_MS,
    ),
  );
  const reportedForwardMs = Math.max(0, Math.floor(positionDeltaSeconds * 1000));
  const appearsToBeSeek = reportedForwardMs > allowedByWallClockMs + 3_000;
  const canCredit = input.previousPlayerState === "PLAYING"
    && ["PLAYING", "PAUSED", "BUFFERING", "ENDED"].includes(input.playerState)
    && elapsedMilliseconds > 0
    && positionDeltaSeconds > 0
    && !appearsToBeSeek;
  return {
    creditedMilliseconds: canCredit
      ? Math.min(reportedForwardMs, allowedByWallClockMs)
      : 0,
    appearsToBeSeek,
    playbackRate,
  };
}
