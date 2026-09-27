import assert from "node:assert/strict";
import test from "node:test";
import { createFocusAudioLifecycle } from "../src/features/focus-audio/lifecycle";

test("lifecycle adapter forwards Capacitor/browser active-state changes and removes its listener", () => {
  const callbacks: ((isActive: boolean) => void)[] = [];
  let removeCount = 0;
  const lifecycle = createFocusAudioLifecycle({
    nativeBridge: {
      addAppLifecycleListener(onChange) {
        callbacks.push(onChange);
        return () => {
          callbacks.length = 0;
          removeCount += 1;
        };
      },
    },
  });
  const states: boolean[] = [];
  const unsubscribe = lifecycle.subscribe((isActive) => states.push(isActive));
  callbacks[0]?.(false);
  callbacks[0]?.(true);
  unsubscribe();

  assert.deepEqual(states, [false, true]);
  assert.equal(removeCount, 1);
  assert.equal(callbacks.length, 0);
});