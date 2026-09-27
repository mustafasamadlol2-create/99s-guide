import assert from "node:assert/strict";
import test from "node:test";
import { createFocusAudioSessionBridge } from "../src/features/focus-audio/focusBridge";
import type { FocusAudioEngine } from "../src/features/focus-audio/engine";

function fakeEngine(initialState: string = "PLAYING") {
  const calls: string[] = [];
  let state = initialState;
  const engine = {
    getSnapshot: () => ({ state }),
    pause: () => {
      calls.push("pause");
      state = "PAUSED";
    },
    resume: async () => {
      calls.push("resume");
      state = "PLAYING";
      return { ok: true as const };
    },
  } as unknown as FocusAudioEngine;
  return { engine, calls };
}

test("Focus start and pause do not control audio by default; completion and abandon pause only audio", () => {
  const { engine, calls } = fakeEngine();
  const bridge = createFocusAudioSessionBridge(engine);

  bridge.onFocusStarted();
  bridge.onFocusPaused();
  assert.deepEqual(calls, []);
  bridge.onFocusCompleted();
  bridge.onFocusAbandoned();
  assert.deepEqual(calls, ["pause"]);
});

test("optional caller policy only resumes audio that the bridge itself paused", async () => {
  const { engine, calls } = fakeEngine();
  const bridge = createFocusAudioSessionBridge(engine, {
    pauseAudioOnFocusPause: true,
    resumeAudioOnFocusResume: true,
  });

  bridge.onFocusPaused();
  await bridge.onFocusResumed();
  await bridge.onFocusResumed();
  assert.deepEqual(calls, ["pause", "resume"]);
});

test("Focus end preference can keep playback unchanged", () => {
  const { engine, calls } = fakeEngine();
  const bridge = createFocusAudioSessionBridge(engine, {
    shouldPauseOnFocusEnd: () => false,
  });
  bridge.onFocusCompleted();
  bridge.onFocusAbandoned();
  assert.deepEqual(calls, []);
});