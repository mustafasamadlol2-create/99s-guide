import { AUDIO_PROGRESS_MIN_INTERVAL_MS, EMPTY_FOCUS_AUDIO_SNAPSHOT } from "./constants";
import { FOCUS_AMBIENT_CATALOG, isLocalBundledAudioSource } from "./ambientCatalog";
import { safeAudioErrorCode } from "./errors";
import { createFocusAudioLifecycle, type FocusAudioLifecycleSource } from "./lifecycle";
import { validateLocalAudioFile } from "./localFile";
import type {
  AmbientTrackId,
  FocusAmbientTrack,
  FocusAudioErrorCode,
  FocusAudioListener,
  FocusAudioPreferences,
  FocusAudioResult,
  FocusAudioSnapshot,
  FocusAudioSourceType,
} from "./types";

interface ActiveSource {
  readonly type: Exclude<FocusAudioSourceType, "NONE">;
  readonly url: string;
  readonly ambientTrackId?: AmbientTrackId;
  readonly displayName?: string;
  readonly loop: boolean;
}

type MediaListener = (event: Event) => void;

export interface FocusAudioEngineOptions {
  catalog?: readonly FocusAmbientTrack[];
  audioFactory?: () => HTMLAudioElement | null;
  createObjectURL?: (file: File) => string;
  revokeObjectURL?: (url: string) => void;
  lifecycle?: FocusAudioLifecycleSource;
  isVisible?: () => boolean;
  now?: () => number;
}

function defaultAudioFactory(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const audio = new Audio();
  audio.preload = "metadata";
  return audio;
}

function clampVolume(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export class FocusAudioEngine {
  private readonly catalog: readonly FocusAmbientTrack[];
  private readonly audioFactory: () => HTMLAudioElement | null;
  private readonly createObjectURL: (file: File) => string;
  private readonly revokeObjectURL: (url: string) => void;
  private readonly lifecycle: FocusAudioLifecycleSource;
  private readonly isVisible: () => boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<FocusAudioListener>();

  private snapshot: FocusAudioSnapshot = EMPTY_FOCUS_AUDIO_SNAPSHOT;
  private audio: HTMLAudioElement | null = null;
  private activeSource: ActiveSource | null = null;
  private objectUrl: string | null = null;
  private sourceGeneration = 0;
  private playRequest = 0;
  private mediaListeners: Array<[string, MediaListener]> = [];
  private removeLifecycleListener: (() => void) | null = null;
  private lastProgressAt = 0;
  private wasPlayingBeforeBackground = false;
  private userAudioLoop = false;
  private destroyed = false;

  constructor(options: FocusAudioEngineOptions = {}) {
    this.catalog = options.catalog ?? FOCUS_AMBIENT_CATALOG;
    this.audioFactory = options.audioFactory ?? defaultAudioFactory;
    this.createObjectURL = options.createObjectURL ?? ((file) => URL.createObjectURL(file));
    this.revokeObjectURL = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
    this.lifecycle = options.lifecycle ?? createFocusAudioLifecycle();
    this.isVisible = options.isVisible ?? (() =>
      typeof document === "undefined" || document.visibilityState === "visible");
    this.now = options.now ?? (() => Date.now());
  }

  getSnapshot = (): FocusAudioSnapshot => this.snapshot;

  subscribe = (listener: FocusAudioListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Attaches only lifecycle observation; no media element or playback is created here. */
  start(): void {
    this.destroyed = false;
    if (this.removeLifecycleListener) return;
    this.removeLifecycleListener = this.lifecycle.subscribe((isActive) => {
      this.reconcileAppActivity(isActive);
    });
  }

  async selectAmbient(trackId: AmbientTrackId): Promise<FocusAudioResult> {
    const track = this.catalog.find((candidate) => candidate.id === trackId);
    if (!track || !isLocalBundledAudioSource(track.source)) {
      return this.failAndClear("SOURCE_MISSING");
    }
    return this.loadSource({
      type: "AMBIENT",
      url: track.source,
      ambientTrackId: track.id,
      loop: true,
    });
  }

  async selectUserAudio(file: File): Promise<FocusAudioResult> {
    const validation = validateLocalAudioFile(file);
    if (validation.ok === false) return this.failAndClear(validation.errorCode);

    const audio = this.getAudio();
    if (!audio) return this.failAndClear("AUDIO_LOAD_FAILED");
    try {
      if (typeof audio.canPlayType === "function" && !audio.canPlayType(validation.mimeType)) {
        return this.failAndClear("UNSUPPORTED_AUDIO");
      }
      const url = this.createObjectURL(validation.file);
      return this.loadSource({
        type: "USER_AUDIO",
        url,
        displayName: validation.displayName,
        loop: this.userAudioLoop,
      }, url);
    } catch {
      return this.failAndClear("AUDIO_LOAD_FAILED");
    }
  }

  async play(): Promise<FocusAudioResult> {
    const audio = this.audio;
    if (!audio || !this.activeSource) return this.setError("SOURCE_MISSING");
    const sourceGeneration = this.sourceGeneration;
    const request = ++this.playRequest;
    this.update({
      state: this.snapshot.state === "LOADING" ? "LOADING" : "READY",
      errorCode: undefined,
    });

    try {
      await audio.play();
      if (request !== this.playRequest || sourceGeneration !== this.sourceGeneration) {
        return { ok: false, errorCode: "AUDIO_PLAY_FAILED" };
      }
      if (!audio.paused) this.update({ state: "PLAYING", errorCode: undefined });
      return { ok: true };
    } catch (error) {
      if (request !== this.playRequest || sourceGeneration !== this.sourceGeneration) {
        return { ok: false, errorCode: "AUDIO_PLAY_FAILED" };
      }
      const errorCode = safeAudioErrorCode(error);
      this.setError(errorCode);
      return { ok: false, errorCode };
    }
  }

  async resume(): Promise<FocusAudioResult> {
    if (
      this.snapshot.state !== "PAUSED" &&
      this.snapshot.state !== "INTERRUPTED" &&
      this.snapshot.state !== "READY" &&
      this.snapshot.state !== "ERROR"
    ) {
      return { ok: this.snapshot.state === "PLAYING" };
    }
    return this.play();
  }

  pause(): void {
    const audio = this.audio;
    if (!audio || !this.activeSource || this.snapshot.state === "PAUSED") return;
    ++this.playRequest;
    this.update({ state: "PAUSED", errorCode: undefined });
    try {
      audio.pause();
    } catch {
      // The engine state remains an intentional pause; no raw browser error is exposed.
    }
  }

  stop(): void {
    const audio = this.audio;
    if (!audio || !this.activeSource) {
      this.update({ state: "IDLE", sourceType: "NONE", currentTime: 0, duration: null });
      return;
    }
    ++this.playRequest;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Seeking can fail briefly while media metadata is unavailable.
    }
    this.update({
      state: "READY",
      currentTime: 0,
      errorCode: undefined,
    });
  }

  clear(): void {
    this.clearCurrentSource();
    this.update({
      ...EMPTY_FOCUS_AUDIO_SNAPSHOT,
      volume: this.snapshot.volume,
      loop: this.userAudioLoop,
    });
  }

  setVolume(value: number): void {
    const volume = clampVolume(value);
    if (volume === null) return;
    if (this.audio) this.audio.volume = volume;
    this.update({ volume });
  }

  setLoop(enabled: boolean): void {
    this.userAudioLoop = enabled;
    const loop = this.activeSource?.type === "AMBIENT" ? true : enabled;
    if (this.audio && this.activeSource) this.audio.loop = loop;
    this.update({ loop });
  }

  seek(seconds: number): void {
    const audio = this.audio;
    if (!audio || !this.activeSource || !Number.isFinite(seconds)) return;
    const duration = Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : null;
    const target = Math.max(0, duration === null ? seconds : Math.min(seconds, duration));
    try {
      audio.currentTime = target;
      this.update({ currentTime: target });
    } catch {
      // Seeking is unavailable until media metadata has loaded.
    }
  }

  /** Applies only local playback settings; it never restores or auto-plays a source. */
  restorePreferences(preferences: Pick<FocusAudioPreferences, "volume" | "userAudioLoop">): void {
    this.userAudioLoop = preferences.userAudioLoop;
    this.setVolume(preferences.volume);
    this.update({
      loop: this.activeSource?.type === "AMBIENT" ? true : this.userAudioLoop,
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.removeLifecycleListener?.();
    this.removeLifecycleListener = null;
    this.clearCurrentSource();
    this.audio = null;
    this.update({
      ...EMPTY_FOCUS_AUDIO_SNAPSHOT,
      volume: this.snapshot.volume,
      loop: this.userAudioLoop,
    });
  }

  private async loadSource(source: ActiveSource, ownedObjectUrl?: string): Promise<FocusAudioResult> {
    const audio = this.getAudio();
    if (!audio) {
      if (ownedObjectUrl) this.safeRevoke(ownedObjectUrl);
      return this.failAndClear("AUDIO_LOAD_FAILED");
    }

    this.clearCurrentSource();
    const generation = this.sourceGeneration;
    this.activeSource = source;
    this.objectUrl = ownedObjectUrl ?? null;
    this.update({
      state: "LOADING",
      sourceType: source.type,
      ambientTrackId: source.ambientTrackId,
      userAudioDisplayName: source.displayName,
      volume: this.snapshot.volume,
      loop: source.loop,
      currentTime: 0,
      duration: null,
      errorCode: undefined,
    });
    try {
      audio.src = source.url;
      audio.volume = this.snapshot.volume;
      audio.loop = source.loop;
      this.installMediaListeners(audio, generation, source.url, audio.src || source.url);
      audio.load();
      return { ok: true };
    } catch {
      this.setError("AUDIO_LOAD_FAILED");
      this.clearCurrentSource(false);
      return { ok: false, errorCode: "AUDIO_LOAD_FAILED" };
    }
  }

  private getAudio(): HTMLAudioElement | null {
    if (this.audio) return this.audio;
    try {
      this.audio = this.audioFactory();
      return this.audio;
    } catch {
      return null;
    }
  }

  private installMediaListeners(
    audio: HTMLAudioElement,
    generation: number,
    sourceUrl: string,
    expectedMediaUrl: string,
  ): void {
    const isCurrent = () =>
      !this.destroyed &&
      generation === this.sourceGeneration &&
      this.activeSource?.url === sourceUrl &&
      (!audio.currentSrc ||
        audio.currentSrc === expectedMediaUrl);

    const onLoadedMetadata: MediaListener = () => {
      if (!isCurrent()) return;
      const duration = Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : null;
      if (this.snapshot.state === "LOADING") this.update({ state: "READY" });
      this.update({
        currentTime: finiteNonNegative(audio.currentTime),
        duration,
      });
    };
    const onCanPlay: MediaListener = () => {
      if (isCurrent() && this.snapshot.state === "LOADING") {
        this.update({ state: "READY", errorCode: undefined });
      }
    };
    const onPlaying: MediaListener = () => {
      if (isCurrent() && !audio.paused) this.update({ state: "PLAYING", errorCode: undefined });
    };
    const onPause: MediaListener = () => {
      if (isCurrent() && this.snapshot.state === "PLAYING" && audio.paused) {
        this.wasPlayingBeforeBackground = true;
        this.update({ state: "INTERRUPTED" });
      }
    };
    const onEnded: MediaListener = () => {
      if (!isCurrent() || audio.loop) return;
      try {
        audio.currentTime = 0;
      } catch {
        // The ended position may not be seekable on all media implementations.
      }
      this.update({ state: "READY", currentTime: 0 });
    };
    const onError: MediaListener = () => {
      if (isCurrent()) this.setError("AUDIO_LOAD_FAILED");
    };
    const onProgress: MediaListener = () => {
      if (!isCurrent() || !this.isVisible()) return;
      const now = this.now();
      if (now - this.lastProgressAt < AUDIO_PROGRESS_MIN_INTERVAL_MS) return;
      this.lastProgressAt = now;
      this.update({
        currentTime: finiteNonNegative(audio.currentTime),
        duration: Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : null,
      });
    };

    this.mediaListeners = [
      ["loadedmetadata", onLoadedMetadata],
      ["canplay", onCanPlay],
      ["playing", onPlaying],
      ["pause", onPause],
      ["ended", onEnded],
      ["error", onError],
      ["stalled", () => undefined],
      ["waiting", () => undefined],
      ["timeupdate", onProgress],
    ];
    for (const [event, listener] of this.mediaListeners) {
      audio.addEventListener(event, listener);
    }
  }

  private removeMediaListeners(): void {
    if (this.audio) {
      for (const [event, listener] of this.mediaListeners) {
        this.audio.removeEventListener(event, listener);
      }
    }
    this.mediaListeners = [];
  }

  private reconcileAppActivity(isActive: boolean): void {
    const audio = this.audio;
    if (!audio || !this.activeSource) return;
    if (!isActive) {
      this.wasPlayingBeforeBackground =
        this.snapshot.state === "PLAYING" && !audio.paused;
      return;
    }
    if (!audio.paused) {
      this.wasPlayingBeforeBackground = false;
      this.update({ state: "PLAYING" });
      return;
    }
    if (this.wasPlayingBeforeBackground || this.snapshot.state === "PLAYING") {
      this.update({ state: "INTERRUPTED" });
    }
    this.wasPlayingBeforeBackground = false;
  }

  private setError(errorCode: FocusAudioErrorCode): FocusAudioResult {
    ++this.playRequest;
    if (this.audio && !this.audio.paused) {
      try {
        this.audio.pause();
      } catch {
        // Error state remains authoritative for this audio engine only.
      }
    }
    this.update({
      state: "ERROR",
      errorCode,
    });
    return { ok: false, errorCode };
  }

  private failAndClear(errorCode: FocusAudioErrorCode): FocusAudioResult {
    this.clearCurrentSource();
    this.update({
      ...EMPTY_FOCUS_AUDIO_SNAPSHOT,
      state: "ERROR",
      volume: this.snapshot.volume,
      loop: this.userAudioLoop,
      errorCode,
    });
    return { ok: false, errorCode };
  }

  private clearCurrentSource(resetSnapshot = true): void {
    ++this.sourceGeneration;
    ++this.playRequest;
    this.removeMediaListeners();
    const audio = this.audio;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // Continue releasing the source even if pause is unavailable.
      }
      try {
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // Clearing the source remains best effort across WebView implementations.
      }
    }
    this.activeSource = null;
    const oldObjectUrl = this.objectUrl;
    this.objectUrl = null;
    if (oldObjectUrl) this.safeRevoke(oldObjectUrl);
    this.wasPlayingBeforeBackground = false;
    if (resetSnapshot) {
      this.snapshot = {
        ...EMPTY_FOCUS_AUDIO_SNAPSHOT,
        volume: this.snapshot.volume,
        loop: this.userAudioLoop,
      };
    }
  }

  private safeRevoke(url: string): void {
    try {
      this.revokeObjectURL(url);
    } catch {
      // Resource cleanup is best effort; never leak a raw platform exception to UI.
    }
  }

  private update(patch: Partial<FocusAudioSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
}

export function createFocusAudioEngine(options: FocusAudioEngineOptions = {}): FocusAudioEngine {
  return new FocusAudioEngine(options);
}