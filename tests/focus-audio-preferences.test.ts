import assert from "node:assert/strict";
import test from "node:test";
import { FOCUS_AUDIO_ENABLED } from "../src/config/featureFlags";
import {
  DEFAULT_FOCUS_AUDIO_PREFERENCES,
  FOCUS_AUDIO_PREFERENCES_KEY,
} from "../src/features/focus-audio/constants";
import {
  createFocusAudioPreferenceRepository,
  parseFocusAudioPreferences,
  type FocusAudioPreferenceStorage,
} from "../src/features/focus-audio/preferences";
import type { FocusAudioPreferences } from "../src/features/focus-audio/types";

class MemoryStorage implements FocusAudioPreferenceStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("feature flag defaults off", () => {
  assert.equal(FOCUS_AUDIO_ENABLED, false);
});

test("corrupt or mismatched preferences safely return defaults", () => {
  assert.deepEqual(parseFocusAudioPreferences(null), DEFAULT_FOCUS_AUDIO_PREFERENCES);
  assert.deepEqual(parseFocusAudioPreferences("{"), DEFAULT_FOCUS_AUDIO_PREFERENCES);
  assert.deepEqual(
    parseFocusAudioPreferences(JSON.stringify({ ...DEFAULT_FOCUS_AUDIO_PREFERENCES, version: "future" })),
    DEFAULT_FOCUS_AUDIO_PREFERENCES,
  );
});

test("validates ambient IDs and clamps the normalized volume", () => {
  const value = {
    ...DEFAULT_FOCUS_AUDIO_PREFERENCES,
    volume: 2,
    ambientTrackId: "rain",
    lastSourceType: "AMBIENT",
  };
  const parsed = parseFocusAudioPreferences(JSON.stringify(value), new Set(["rain"]));
  assert.equal(parsed.volume, 1);
  assert.equal(parsed.ambientTrackId, "rain");

  const unknownTrack = parseFocusAudioPreferences(JSON.stringify({
    ...value,
    volume: -1,
    ambientTrackId: "not-in-catalog",
  }), new Set(["rain"]));
  assert.equal(unknownTrack.volume, 0);
  assert.equal(unknownTrack.ambientTrackId, null);
});

test("preference repository persists tiny local settings only, never a selected file name or bytes", async () => {
  const storage = new MemoryStorage();
  const repository = createFocusAudioPreferenceRepository({ storage, validAmbientTrackIds: new Set(["rain"]) });
  const preferences: FocusAudioPreferences = {
    ...DEFAULT_FOCUS_AUDIO_PREFERENCES,
    volume: 0.25,
    ambientTrackId: "rain",
    lastSourceType: "USER_AUDIO",
    userAudioLoop: true,
  };

  assert.equal(await repository.save(preferences), true);
  assert.deepEqual(await repository.load(), preferences);
  const stored = storage.values.get(FOCUS_AUDIO_PREFERENCES_KEY) ?? "";
  assert.equal(stored.includes("focus-track.mp3"), false);
  assert.equal(stored.includes("blob:"), false);
  assert.equal(stored.includes("base64"), false);
  assert.ok(stored.length < 1024);
});