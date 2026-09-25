import assert from "node:assert/strict";
import test from "node:test";
import {
  createFocusLifecycle,
  type NativeFocusLifecycleBridge,
} from "../src/features/focus/runtime/lifecycle";

type Listener = (event: Event) => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeDocument extends FakeEventTarget {
  visibilityState: DocumentVisibilityState = "hidden";
}

class ManualTimers {
  private nextId = 0;
  callbacks = new Map<number, () => void>();

  setTimer = (callback: () => void, _delay: number): ReturnType<typeof setTimeout> => {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    this.callbacks.delete(timer as unknown as number);
  };

  fireAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

function nativeBridgeStub(): NativeFocusLifecycleBridge & {
  fireAppState(isActive: boolean): void;
  fireNetwork(isOnline: boolean): void;
  appListeners: Set<(isActive: boolean) => void>;
  networkListeners: Set<(isOnline: boolean) => void>;
} {
  const appListeners = new Set<(isActive: boolean) => void>();
  const networkListeners = new Set<(isOnline: boolean) => void>();
  return {
    appListeners,
    networkListeners,
    isNativePlatform: () => true,
    addAppLifecycleListener(callback) {
      appListeners.add(callback);
      return () => { appListeners.delete(callback); };
    },
    onNetworkChange(callback) {
      networkListeners.add(callback);
      callback(false);
      return () => { networkListeners.delete(callback); };
    },
    fireAppState(isActive) {
      appListeners.forEach((callback) => callback(isActive));
    },
    fireNetwork(isOnline) {
      networkListeners.forEach((callback) => callback(isOnline));
    },
  };
}

test("web visibility, pageshow, and online bursts coalesce to one foreground callback", () => {
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const timers = new ManualTimers();
  let reconciliations = 0;
  const lifecycle = createFocusLifecycle({
    windowTarget,
    documentTarget,
    nativeBridge: nativeBridgeStub(),
    debounceMs: 180,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const unsubscribe = lifecycle.subscribe(() => {
    reconciliations += 1;
  });

  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  windowTarget.dispatch("pageshow");
  windowTarget.dispatch("online");
  assert.equal(timers.callbacks.size, 1);
  timers.fireAll();

  assert.equal(reconciliations, 1);
  unsubscribe();
  assert.equal(windowTarget.count("pageshow"), 0);
  assert.equal(windowTarget.count("online"), 0);
  assert.equal(documentTarget.count("visibilitychange"), 0);
});

test("unsubscribing cancels a queued lifecycle reconciliation", () => {
  const windowTarget = new FakeEventTarget();
  const timers = new ManualTimers();
  let reconciliations = 0;
  const lifecycle = createFocusLifecycle({
    windowTarget,
    documentTarget: null,
    nativeBridge: {
      ...nativeBridgeStub(),
      isNativePlatform: () => false,
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const unsubscribe = lifecycle.subscribe(() => {
    reconciliations += 1;
  });

  windowTarget.dispatch("pageshow");
  assert.equal(timers.callbacks.size, 1);
  unsubscribe();
  timers.fireAll();

  assert.equal(reconciliations, 0);
  assert.equal(windowTarget.count("pageshow"), 0);
});

test("native inactive does nothing, foreground and reconnect coalesce, and listeners clean up", () => {
  const timers = new ManualTimers();
  const native = nativeBridgeStub();
  let reconciliations = 0;
  const lifecycle = createFocusLifecycle({
    windowTarget: null,
    documentTarget: null,
    nativeBridge: native,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const unsubscribe = lifecycle.subscribe(() => {
    reconciliations += 1;
  });

  native.fireAppState(false);
  assert.equal(timers.callbacks.size, 0);
  native.fireAppState(true);
  native.fireNetwork(true);
  assert.equal(timers.callbacks.size, 1);
  timers.fireAll();
  assert.equal(reconciliations, 1);

  unsubscribe();
  assert.equal(native.appListeners.size, 0);
  assert.equal(native.networkListeners.size, 0);
});