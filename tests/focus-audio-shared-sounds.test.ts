import assert from "node:assert/strict";
import test from "node:test";
import { createFocusAudioEngine } from "../src/features/focus-audio/engine";
import type { FocusSharedSound } from "../src/features/focus-audio/types";
import { MockAudioElement } from "./helpers/focus-audio";

const sharedSound: FocusSharedSound = {
  id: "shared-rain",
  name: "Quiet Rain",
  playbackUrl: "https://r2.example.test/focus-sounds/rain.mp3?signature=1",
  mimeType: "audio/mpeg",
  sizeBytes: 1024,
  sortOrder: 0,
  isEnabled: true,
};

test("owner-managed shared sound can be selected from a signed HTTPS URL without treating it as a local file", async () => {
  const audio = new MockAudioElement();
  const engine = createFocusAudioEngine({
    audioFactory: () => audio as unknown as HTMLAudioElement,
  });

  assert.deepEqual(await engine.selectSharedAudio(sharedSound), { ok: true });
  assert.equal(engine.getSnapshot().sourceType, "AMBIENT");
  assert.equal(engine.getSnapshot().ambientTrackId, "shared-rain");
  assert.equal(engine.getSnapshot().sourceDisplayName, "Quiet Rain");
  assert.equal(engine.getSnapshot().userAudioDisplayName, undefined);
  assert.equal(audio.src, sharedSound.playbackUrl);
});

test("shared sounds honor the student's loop control instead of forcing ambient loop on", async () => {
  const audio = new MockAudioElement();
  const engine = createFocusAudioEngine({ audioFactory: () => audio as unknown as HTMLAudioElement });
  await engine.selectSharedAudio(sharedSound);
  assert.equal(audio.loop, false);
  engine.setLoop(true);
  assert.equal(audio.loop, true);
  assert.equal(engine.getSnapshot().loop, true);
  engine.setLoop(false);
  assert.equal(audio.loop, false);
});

test("arbitrary non-HTTPS shared sound URLs are rejected", async () => {
  const audio = new MockAudioElement();
  const engine = createFocusAudioEngine({ audioFactory: () => audio as unknown as HTMLAudioElement });
  const invalid = { ...sharedSound, playbackUrl: "http://evil.example.test/a.mp3" };
  assert.deepEqual(await engine.selectSharedAudio(invalid), { ok: false, errorCode: "SOURCE_MISSING" });
});
