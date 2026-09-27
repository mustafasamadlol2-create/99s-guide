import { FOCUS_AMBIENT_CATALOG } from "./ambientCatalog";
import {
  DEFAULT_FOCUS_AUDIO_PREFERENCES,
} from "./constants";
import { createFocusAudioEngine, type FocusAudioEngine, type FocusAudioEngineOptions } from "./engine";
import { createFocusAudioSessionBridge, type FocusAudioSessionBridge } from "./focusBridge";
import {
  createFocusAudioPreferenceRepository,
  type FocusAudioPreferenceStorage,
} from "./preferences";
import type {
  AmbientTrackId,
  FocusAudioListener,
  FocusAudioPreferences,
  FocusAudioResult,
  FocusAudioSnapshot,
  FocusAudioStoreSnapshot,
} from "./types";

export interface FocusAudioStoreOptions {
  engine?: FocusAudioEngine;
  engineOptions?: FocusAudioEngineOptions;
  preferenceStorage?: FocusAudioPreferenceStorage;
}

export class FocusAudioStore {
  readonly engine: FocusAudioEngine;
  readonly focusBridge: FocusAudioSessionBridge;

  private readonly repository;
  private readonly listeners = new Set<FocusAudioListener>();
  private engineUnsubscribe: (() => void) | null = null;
  private preferences: FocusAudioPreferences = DEFAULT_FOCUS_AUDIO_PREFERENCES;
  private snapshot: FocusAudioStoreSnapshot;
  private initializeGeneration = 0;

  constructor(options: FocusAudioStoreOptions = {}) {
    this.engine = options.engine ?? createFocusAudioEngine(options.engineOptions);
    this.repository = createFocusAudioPreferenceRepository({
      storage: options.preferenceStorage,
      validAmbientTrackIds: new Set(
        (options.engineOptions?.catalog ?? FOCUS_AMBIENT_CATALOG).map((track) => track.id),
      ),
    });
    this.snapshot = Object.freeze({
      audio: this.engine.getSnapshot(),
      preferences: this.preferences,
      initialized: false,
    });
    this.ensureEngineSubscription();
    this.focusBridge = createFocusAudioSessionBridge(this.engine, {
      shouldPauseOnFocusEnd: () => this.preferences.pauseOnFocusEnd,
    });
  }

  getSnapshot = (): FocusAudioStoreSnapshot => this.snapshot;

  subscribe = (listener: FocusAudioListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async initialize(): Promise<void> {
    const generation = ++this.initializeGeneration;
    this.ensureEngineSubscription();
    this.engine.start();
    const preferences = await this.repository.load();
    if (generation !== this.initializeGeneration) return;
    this.preferences = preferences;
    this.engine.restorePreferences(preferences);
    this.publish(true);
  }

  async selectAmbient(trackId: AmbientTrackId): Promise<FocusAudioResult> {
    const result = await this.engine.selectAmbient(trackId);
    if (!result.ok) return result;
    this.preferences = {
      ...this.preferences,
      ambientTrackId: trackId,
      lastSourceType: "AMBIENT",
    };
    this.persistAndPublish();
    return result;
  }

  async selectUserAudio(file: File): Promise<FocusAudioResult> {
    const result = await this.engine.selectUserAudio(file);
    if (!result.ok) return result;
    this.preferences = {
      ...this.preferences,
      lastSourceType: "USER_AUDIO",
    };
    this.persistAndPublish();
    return result;
  }

  play(): Promise<FocusAudioResult> {
    return this.engine.play();
  }

  pause(): void {
    this.engine.pause();
  }

  resume(): Promise<FocusAudioResult> {
    return this.engine.resume();
  }

  stop(): void {
    this.engine.stop();
  }

  clear(): void {
    this.engine.clear();
    this.preferences = { ...this.preferences, lastSourceType: "NONE" };
    this.persistAndPublish();
  }

  setVolume(value: number): void {
    this.engine.setVolume(value);
    const volume = this.engine.getSnapshot().volume;
    this.preferences = { ...this.preferences, volume };
    this.persistAndPublish();
  }

  setLoop(enabled: boolean): void {
    this.engine.setLoop(enabled);
    this.preferences = {
      ...this.preferences,
      userAudioLoop: this.engine.getSnapshot().loop &&
        this.engine.getSnapshot().sourceType !== "AMBIENT"
        ? true
        : enabled,
    };
    this.persistAndPublish();
  }

  setPauseAudioOnFocusEnd(enabled: boolean): void {
    this.preferences = { ...this.preferences, pauseOnFocusEnd: enabled };
    this.persistAndPublish();
  }

  setPauseOnFocusEnd(enabled: boolean): void {
    this.setPauseAudioOnFocusEnd(enabled);
  }

  destroy(): void {
    ++this.initializeGeneration;
    this.engine.destroy();
    this.engineUnsubscribe?.();
    this.engineUnsubscribe = null;
    this.publish();
  }

  private persistAndPublish(): void {
    this.publish();
    void this.repository.save(this.preferences);
  }

  private ensureEngineSubscription(): void {
    if (this.engineUnsubscribe) return;
    this.engineUnsubscribe = this.engine.subscribe(() => this.publish());
  }

  private publish(initialized = this.snapshot.initialized): void {
    const audio: FocusAudioSnapshot = this.engine.getSnapshot();
    this.snapshot = Object.freeze({
      audio,
      preferences: this.preferences,
      initialized,
    });
    for (const listener of this.listeners) listener();
  }
}

export function createFocusAudioStore(options: FocusAudioStoreOptions = {}): FocusAudioStore {
  return new FocusAudioStore(options);
}