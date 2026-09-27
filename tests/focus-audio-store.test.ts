import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FOCUS_AUDIO_PREFERENCES, FOCUS_AUDIO_PREFERENCES_KEY } from "../src/features/focus-audio/constants";
import { FocusAudioStore } from "../src/features/focus-audio/store";
import type { FocusAudioPreferenceStorage } from "../src/features/focus-audio/preferences";
import type { FocusAmbientTrack } from "../src/features/focus-audio/types";
import { makeAudioFile, MockAudioElement, MockLifecycleSource } from "./helpers/focus-audio";

class MemoryStorage implements FocusAudioPreferenceStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const tracks: readonly FocusAmbientTrack[] = [{
  id: "rain",
  labelKey: "focusAudio.ambient.rain",
  source: "/assets/rain.mp3",
  loop: true,
}];

test("store restores only local preferences, not a source or automatic playback", async () => {
  const storage = new MemoryStorage();
  storage.values.set(FOCUS_AUDIO_PREFERENCES_KEY, JSON.stringify({
    ...DEFAULT_FOCUS_AUDIO_PREFERENCES,
    ambientTrackId: "rain",
    lastSourceType: "AMBIENT",
    volume: 0.3,
  }));
  let audioInstances = 0;
  const store = new FocusAudioStore({
    preferenceStorage: storage,
    engineOptions: {
      catalog: tracks,
      audioFactory: () => {
        audioInstances += 1;
        return new MockAudioElement() as unknown as HTMLAudioElement;
      },
    },
  });

  await store.initialize();
  assert.equal(store.getSnapshot().initialized, true);
  assert.equal(store.getSnapshot().preferences.ambientTrackId, "rain");
  assert.equal(store.getSnapshot().audio.state, "IDLE");
  assert.equal(store.getSnapshot().audio.sourceType, "NONE");
  assert.equal(store.getSnapshot().audio.volume, 0.3);
  assert.equal(audioInstances, 0);
  store.destroy();
});

test("store serializes local settings and keeps user audio names and bytes out of preferences", async () => {
  const storage = new MemoryStorage();
  const lifecycle = new MockLifecycleSource();
  const audio = new MockAudioElement();
  const revoked: string[] = [];
  const store = new FocusAudioStore({
    preferenceStorage: storage,
    engineOptions: {
      catalog: tracks,
      audioFactory: () => audio as unknown as HTMLAudioElement,
      createObjectURL: (file) => `blob:local/${file.name}`,
      revokeObjectURL: (url) => revoked.push(url),
      lifecycle,
    },
  });
  await store.initialize();
  store.setVolume(0.75);
  store.setLoop(true);
  store.setPauseOnFocusEnd(false);
  await store.selectUserAudio(makeAudioFile("private-name.mp3"));

  const saved = storage.values.get(FOCUS_AUDIO_PREFERENCES_KEY) ?? "";
  assert.equal(saved.includes("private-name.mp3"), false);
  assert.equal(saved.includes("blob:"), false);
  assert.equal(saved.includes("base64"), false);
  assert.equal(store.getSnapshot().preferences.volume, 0.75);
  assert.equal(store.getSnapshot().preferences.userAudioLoop, true);
  assert.equal(store.getSnapshot().preferences.pauseOnFocusEnd, false);
  assert.equal(store.getSnapshot().preferences.lastSourceType, "USER_AUDIO");
  assert.equal(store.getSnapshot().audio.userAudioDisplayName, "private-name.mp3");
  store.destroy();
  assert.deepEqual(revoked, ["blob:local/private-name.mp3"]);
});

test("start/destroy can repeat safely under React StrictMode effect replay", async () => {
  const lifecycle = new MockLifecycleSource();
  const store = new FocusAudioStore({
    preferenceStorage: new MemoryStorage(),
    engineOptions: { lifecycle },
  });

  await store.initialize();
  store.destroy();
  await store.initialize();
  assert.equal(lifecycle.subscribeCount, 2);
  assert.equal(lifecycle.unsubscribeCount, 1);
  store.destroy();
  assert.equal(lifecycle.unsubscribeCount, 2);
});