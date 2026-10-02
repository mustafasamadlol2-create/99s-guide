import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FOCUS_AUDIO_ARTWORK,
  resolveFocusAudioArtworkUrl,
} from "../src/features/focus/components/focusAudioArtwork";

test("uses mountain artwork when no local cover is available", () => {
  assert.equal(
    resolveFocusAudioArtworkUrl(null, null),
    DEFAULT_FOCUS_AUDIO_ARTWORK,
  );
});

test("uses local artwork and falls back after the image fails", () => {
  assert.equal(
    resolveFocusAudioArtworkUrl("blob:local-cover", null),
    "blob:local-cover",
  );
  assert.equal(
    resolveFocusAudioArtworkUrl("blob:local-cover", "blob:local-cover"),
    DEFAULT_FOCUS_AUDIO_ARTWORK,
  );
});

test("a later local cover replaces a previously failed artwork URL", () => {
  assert.equal(
    resolveFocusAudioArtworkUrl("blob:new-cover", "blob:old-cover"),
    "blob:new-cover",
  );
});