import assert from "node:assert/strict";
import test from "node:test";
import { createFocusAudioEngine } from "../src/features/focus-audio/engine";
import type { FocusAmbientTrack } from "../src/features/focus-audio/types";
import {
  makeAudioFile,
  makeAudioFileWithArtwork,
  MockAudioElement,
  MockLifecycleSource,
} from "./helpers/focus-audio";

const ambientTracks: readonly FocusAmbientTrack[] = [{
  id: "rain",
  labelKey: "focusAudio.ambient.rain",
  source: "/assets/focus-audio/rain.mp3",
  loop: true,
}];

function setup() {
  const audio = new MockAudioElement();
  const lifecycle = new MockLifecycleSource();
  const revoked: string[] = [];
  let audioInstances = 0;
  const engine = createFocusAudioEngine({
    catalog: ambientTracks,
    audioFactory: () => {
      audioInstances += 1;
      return audio as unknown as HTMLAudioElement;
    },
    createObjectURL: (file) => `blob:local/${file.name}`,
    createArtworkObjectURL: (artwork) => `blob:artwork/${artwork.type}`,
    revokeObjectURL: (url) => revoked.push(url),
    lifecycle,
    isVisible: () => true,
    now: () => 1000,
  });
  return { engine, audio, lifecycle, revoked, get audioInstances() { return audioInstances; } };
}

test("one engine reuses one media element and applies the required ambient/user loop defaults", async () => {
  const fixture = setup();
  await fixture.engine.selectAmbient("rain");
  assert.equal(fixture.audio.loop, true);
  fixture.audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(fixture.engine.getSnapshot().state, "READY");
  assert.deepEqual(await fixture.engine.play(), { ok: true });
  assert.equal(fixture.engine.getSnapshot().state, "PLAYING");

  await fixture.engine.selectUserAudio(makeAudioFile());
  assert.equal(fixture.audio.loop, false);
  assert.deepEqual(fixture.revoked, []);
  assert.equal(fixture.audioInstances, 1);
  assert.equal(fixture.engine.getSnapshot().userAudioDisplayName, "focus-track.mp3");
  fixture.engine.destroy();
  assert.deepEqual(fixture.revoked, ["blob:local/focus-track.mp3"]);
});

test("embedded cover art stays local and its object URL is released with the selected file", async () => {
  const fixture = setup();
  await fixture.engine.selectUserAudio(makeAudioFileWithArtwork());

  for (let attempt = 0; attempt < 10 && !fixture.engine.getSnapshot().userAudioArtworkUrl; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(
    fixture.engine.getSnapshot().userAudioArtworkUrl,
    "blob:artwork/image/jpeg",
  );
  assert.deepEqual(fixture.revoked, []);

  fixture.engine.clear();
  assert.equal(fixture.engine.getSnapshot().userAudioArtworkUrl, undefined);
  assert.deepEqual(fixture.revoked, [
    "blob:local/focus-with-cover.mp3",
    "blob:artwork/image/jpeg",
  ]);
});

test("user audio loads without relying on canPlayType's advisory result", async () => {
  const fixture = setup();
  fixture.audio.supportedMimeTypes.clear();

  const result = await fixture.engine.selectUserAudio(makeAudioFile());

  assert.deepEqual(result, { ok: true });
  assert.equal(fixture.engine.getSnapshot().sourceType, "USER_AUDIO");
  assert.equal(fixture.engine.getSnapshot().userAudioDisplayName, "focus-track.mp3");
  assert.equal(fixture.audio.src, "blob:local/focus-track.mp3");
  fixture.engine.destroy();
});

test("selected filename and media source are available before optional artwork parsing finishes", async () => {
  const fixture = setup();
  let resolveHeader!: (buffer: ArrayBuffer) => void;
  const file = {
    name: "slow-cover.mp3",
    type: "audio/mpeg",
    size: 10,
    slice: () => ({
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => {
        resolveHeader = resolve;
      }),
    }),
  } as unknown as File;

  const selection = fixture.engine.selectUserAudio(file);
  await Promise.resolve();

  assert.equal(fixture.engine.getSnapshot().state, "LOADING");
  assert.equal(fixture.engine.getSnapshot().userAudioDisplayName, "slow-cover.mp3");
  assert.equal(fixture.audio.src, "blob:local/slow-cover.mp3");

  resolveHeader(new ArrayBuffer(10));
  assert.deepEqual(await selection, { ok: true });
  fixture.engine.destroy();
});

test("late cover art from a replaced file cannot overwrite the current selection", async () => {
  const fixture = setup();
  const artFile = makeAudioFileWithArtwork("replaced-with-cover.mp3");
  const header = await artFile.slice(0, 10).arrayBuffer();
  const fullTag = await artFile.arrayBuffer();
  let resolveTag!: (buffer: ArrayBuffer) => void;
  const delayedFile = {
    name: artFile.name,
    type: artFile.type,
    size: artFile.size,
    slice: (_start?: number, end?: number) => ({
      arrayBuffer: () => end === 10
        ? Promise.resolve(header)
        : new Promise<ArrayBuffer>((resolve) => {
          resolveTag = resolve;
        }),
    }),
  } as unknown as File;

  await fixture.engine.selectUserAudio(delayedFile);
  for (let attempt = 0; attempt < 10 && !resolveTag; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof resolveTag, "function");

  await fixture.engine.selectUserAudio(makeAudioFile("current.mp3"));
  resolveTag(fullTag);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fixture.engine.getSnapshot().userAudioDisplayName, "current.mp3");
  assert.equal(fixture.engine.getSnapshot().userAudioArtworkUrl, undefined);
  assert.equal(fixture.revoked.some((url) => url.startsWith("blob:artwork/")), false);
  fixture.engine.destroy();
});

test("switching sources stops the prior source, revokes its URL, and never overlaps playback", async () => {
  const fixture = setup();
  await fixture.engine.selectUserAudio(makeAudioFile());
  fixture.audio.dispatchEvent(new Event("loadedmetadata"));
  await fixture.engine.play();
  assert.equal(fixture.audio.paused, false);

  await fixture.engine.selectAmbient("rain");
  assert.equal(fixture.audio.paused, true);
  assert.deepEqual(fixture.revoked, ["blob:local/focus-track.mp3"]);
  assert.equal(fixture.engine.getSnapshot().sourceType, "AMBIENT");
  assert.equal(fixture.engine.getSnapshot().state, "LOADING");
  assert.equal(fixture.audioInstances, 1);
});

test("remote ambient sources are rejected and missing catalog entries do not create a player", async () => {
  let playerCreated = false;
  const remoteTrack: FocusAmbientTrack = {
    id: "remote",
    labelKey: "focusAudio.ambient.remote",
    source: "https://example.com/song.mp3",
    loop: true,
  };
  const engine = createFocusAudioEngine({
    catalog: [remoteTrack],
    audioFactory: () => {
      playerCreated = true;
      return new MockAudioElement() as unknown as HTMLAudioElement;
    },
  });

  assert.deepEqual(await engine.selectAmbient("remote"), { ok: false, errorCode: "SOURCE_MISSING" });
  assert.equal(engine.getSnapshot().state, "ERROR");
  assert.equal(playerCreated, false);
  assert.deepEqual(await engine.selectAmbient("unknown"), { ok: false, errorCode: "SOURCE_MISSING" });
});

test("autoplay rejection becomes a safe error and can be retried without an unhandled rejection", async () => {
  const fixture = setup();
  await fixture.engine.selectAmbient("rain");
  fixture.audio.playImplementation = async () => {
    throw new DOMException("Blocked", "NotAllowedError");
  };

  assert.deepEqual(await fixture.engine.play(), { ok: false, errorCode: "AUTOPLAY_BLOCKED" });
  assert.equal(fixture.engine.getSnapshot().state, "ERROR");
  assert.equal(fixture.engine.getSnapshot().errorCode, "AUTOPLAY_BLOCKED");

  fixture.audio.playImplementation = null;
  assert.deepEqual(await fixture.engine.resume(), { ok: true });
  assert.equal(fixture.engine.getSnapshot().state, "PLAYING");
});

test("corrupt media fails with a stable code and exposes no browser exception", async () => {
  const fixture = setup();
  await fixture.engine.selectUserAudio(makeAudioFile("renamed.mp3", "audio/mpeg", "not really mp3"));
  fixture.audio.dispatchEvent(new Event("error"));
  assert.equal(fixture.engine.getSnapshot().state, "ERROR");
  assert.equal(fixture.engine.getSnapshot().errorCode, "AUDIO_LOAD_FAILED");
  assert.equal("message" in fixture.engine.getSnapshot(), false);
});

test("non-looping audio ends at READY with its playback position reset", async () => {
  const fixture = setup();
  await fixture.engine.selectUserAudio(makeAudioFile());
  fixture.audio.dispatchEvent(new Event("loadedmetadata"));
  await fixture.engine.play();
  fixture.audio.currentTime = fixture.audio.duration;
  fixture.audio.dispatchEvent(new Event("ended"));

  assert.equal(fixture.engine.getSnapshot().state, "READY");
  assert.equal(fixture.engine.getSnapshot().currentTime, 0);
});

test("stop, clear, volume clamping, loop controls, and destroy are safe and release object URLs", async () => {
  const fixture = setup();
  fixture.engine.stop();
  fixture.engine.clear();
  assert.equal(fixture.engine.getSnapshot().state, "IDLE");

  fixture.engine.setVolume(-1);
  assert.equal(fixture.engine.getSnapshot().volume, 0);
  fixture.engine.setVolume(2);
  assert.equal(fixture.engine.getSnapshot().volume, 1);
  fixture.engine.setVolume(Number.NaN);
  assert.equal(fixture.engine.getSnapshot().volume, 1);

  await fixture.engine.selectUserAudio(makeAudioFile());
  fixture.engine.setLoop(true);
  assert.equal(fixture.audio.loop, true);
  fixture.engine.stop();
  assert.equal(fixture.engine.getSnapshot().state, "READY");
  assert.equal(fixture.engine.getSnapshot().currentTime, 0);
  fixture.engine.clear();
  fixture.engine.clear();
  fixture.engine.destroy();
  assert.deepEqual(fixture.revoked, ["blob:local/focus-track.mp3"]);
});

test("100 successive local files revoke replaced URLs and stale media events cannot win", async () => {
  const fixture = setup();
  for (let index = 0; index < 100; index += 1) {
    await fixture.engine.selectUserAudio(makeAudioFile(`track-${index}.mp3`));
    assert.equal(fixture.engine.getSnapshot().state, "LOADING");
  }

  assert.equal(fixture.revoked.length, 99);
  fixture.audio.currentSrc = "blob:local/track-98.mp3";
  fixture.audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(fixture.engine.getSnapshot().state, "LOADING");

  fixture.audio.currentSrc = "blob:local/track-99.mp3";
  fixture.audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(fixture.engine.getSnapshot().state, "READY");
  fixture.engine.destroy();
  assert.equal(fixture.revoked.length, 100);
  assert.equal(new Set(fixture.revoked).size, 100);
});

test("rapid play/pause calls leave an explicit pause authoritative", async () => {
  const fixture = setup();
  await fixture.engine.selectAmbient("rain");
  let settlePlay!: () => void;
  fixture.audio.playImplementation = () => new Promise<void>((resolve) => {
    settlePlay = resolve;
  });
  const pendingPlay = fixture.engine.play();
  fixture.engine.pause();
  settlePlay();
  await pendingPlay;

  assert.equal(fixture.engine.getSnapshot().state, "PAUSED");
  assert.equal(fixture.audio.paused, true);
});

test("app interruption is represented separately and never auto-resumes", async () => {
  const fixture = setup();
  fixture.engine.start();
  await fixture.engine.selectAmbient("rain");
  await fixture.engine.play();
  fixture.lifecycle.emit(false);
  fixture.audio.pause();
  assert.equal(fixture.engine.getSnapshot().state, "INTERRUPTED");

  fixture.lifecycle.emit(true);
  assert.equal(fixture.engine.getSnapshot().state, "INTERRUPTED");
  assert.equal(fixture.audio.paused, true);
  assert.equal(fixture.audio.playCount, 1);
  fixture.engine.destroy();
  assert.equal(fixture.lifecycle.unsubscribeCount, 1);
});