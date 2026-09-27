import type { FocusAudioEngine } from "./engine";
import type { FocusAudioResult } from "./types";

export interface FocusAudioSessionBridgeOptions {
  /** Caller policy; defaults off so pausing Focus does not unexpectedly pause audio. */
  pauseAudioOnFocusPause?: boolean;
  /** Caller policy; defaults off, even when this bridge previously paused audio. */
  resumeAudioOnFocusResume?: boolean;
  /** Normally read from the local pauseOnFocusEnd preference. */
  shouldPauseOnFocusEnd?: () => boolean;
}

/**
 * One-way adapter for explicit Focus UI/session commands.
 * Audio state never calls back into, or mutates, canonical Focus state.
 */
export class FocusAudioSessionBridge {
  private readonly pauseAudioOnFocusPause: boolean;
  private readonly resumeAudioOnFocusResume: boolean;
  private readonly shouldPauseOnFocusEnd: () => boolean;
  private audioPausedByBridge = false;

  constructor(
    private readonly engine: FocusAudioEngine,
    options: FocusAudioSessionBridgeOptions = {},
  ) {
    this.pauseAudioOnFocusPause = options.pauseAudioOnFocusPause ?? false;
    this.resumeAudioOnFocusResume = options.resumeAudioOnFocusResume ?? false;
    this.shouldPauseOnFocusEnd = options.shouldPauseOnFocusEnd ?? (() => true);
  }

  onFocusStarted(): void {
    this.audioPausedByBridge = false;
  }

  onFocusPaused(): void {
    if (!this.pauseAudioOnFocusPause || this.engine.getSnapshot().state !== "PLAYING") return;
    this.audioPausedByBridge = true;
    this.engine.pause();
  }

  async onFocusResumed(): Promise<FocusAudioResult | void> {
    if (!this.audioPausedByBridge || !this.resumeAudioOnFocusResume) return;
    this.audioPausedByBridge = false;
    return this.engine.resume();
  }

  onFocusCompleted(): void {
    this.pauseForFocusEnd();
  }

  onFocusAbandoned(): void {
    this.pauseForFocusEnd();
  }

  private pauseForFocusEnd(): void {
    this.audioPausedByBridge = false;
    if (!this.shouldPauseOnFocusEnd()) return;
    const state = this.engine.getSnapshot().state;
    if (state === "PLAYING" || state === "LOADING" || state === "INTERRUPTED") {
      this.engine.pause();
    }
  }
}

export function createFocusAudioSessionBridge(
  engine: FocusAudioEngine,
  options: FocusAudioSessionBridgeOptions = {},
): FocusAudioSessionBridge {
  return new FocusAudioSessionBridge(engine, options);
}