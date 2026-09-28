import assert from "node:assert/strict";
import test from "node:test";
import type {
  FocusCurrentSessionResult,
  FocusPlanDto,
  FocusSessionDto,
  FocusSessionMutationResult,
} from "../server/features/focus/types";
import type {
  AbandonFocusSessionInput,
  CompleteFocusSessionInput,
  CreateFocusPlanInput,
  FocusSessionTransitionInput,
  StartFocusSessionInput,
  UpdateFocusPlanInput,
} from "../server/features/focus/schemas";
import type { FocusApi } from "../src/features/focus/api/focusApi";
import { FocusApiError } from "../src/features/focus/api/focusApi";
import {
  createFocusRuntimeController,
  FocusRuntimeOperationError,
  type FocusLifecycle,
  type FocusRuntimeCache,
  type FocusRuntimeCacheEntry,
} from "../src/features/focus/runtime";
import {
  createFocusRuntimeCache,
  FOCUS_RUNTIME_CACHE_VERSION,
  NON_AUTHORITATIVE,
} from "../src/features/focus/runtime/cache";
import {
  createFocusTimerBaseline,
  estimateFocusDisplay,
} from "../src/features/focus/runtime/timer";
import {
  classifyFocusSource,
} from "../src/features/focus/runtime/source";
import {
  createFocusIdempotencyKey,
} from "../src/features/focus/runtime/idempotency";
import { createFocusClock } from "../src/features/focus/runtime/clock";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const LECTURE_ID = "44444444-4444-4444-8444-444444444444";
const SERVER_NOW = "2026-09-25T12:00:00.000Z";

function makeSession(
  overrides: Partial<FocusSessionDto> = {},
): FocusSessionDto {
  return {
    id: SESSION_ID,
    planId: PLAN_ID,
    planItemId: PLAN_ITEM_ID,
    lectureId: LECTURE_ID,
    status: "ACTIVE",
    startedAt: "2026-09-25T11:15:00.000Z",
    plannedEndAt: "2026-09-25T12:45:00.000Z",
    actualEndedAt: null,
    lastCheckpointAt: SERVER_NOW,
    activeSeconds: 900,
    pauseSeconds: 0,
    serverNow: SERVER_NOW,
    elapsedActiveSeconds: 2700,
    remainingSeconds: 2700,
    completionEligible: false,
    sessionNumber: 1,
    plannedSessionCount: 2,
    isLastPlannedSession: false,
    reconciliationRequired: false,
    completionReason: null,
    ...overrides,
  };
}

function mutation(
  session: FocusSessionDto,
  idempotency: FocusSessionMutationResult["idempotency"] = "FIRST_SEEN",
): FocusSessionMutationResult {
  return { session, idempotency };
}

function currentResult(
  session: FocusSessionDto | null,
  serverNow = session?.serverNow ?? SERVER_NOW,
): FocusCurrentSessionResult {
  return { session, serverNow };
}

function makeApi(overrides: Partial<FocusApi> = {}): FocusApi {
  const emptyPlan: FocusPlanDto = {
    id: PLAN_ID,
    title: "Plan",
    status: "ACTIVE",
    timezone: "Asia/Baghdad",
    planVersion: 1,
    createdAt: SERVER_NOW,
    updatedAt: SERVER_NOW,
    archivedAt: null,
    items: [],
  };
  return {
    getCurrentFocusSession: async () => currentResult(makeSession()),
    startFocusSession: async (_input: StartFocusSessionInput) => mutation(makeSession()),
    pauseFocusSession: async (_id: string, _input: FocusSessionTransitionInput) =>
      mutation(makeSession({ status: "PAUSED" })),
    resumeFocusSession: async (_id: string, _input: FocusSessionTransitionInput) =>
      mutation(makeSession()),
    completeFocusSession: async (_id: string, _input: CompleteFocusSessionInput) =>
      mutation(makeSession({ status: "COMPLETED" })),
    abandonFocusSession: async (_id: string, _input: AbandonFocusSessionInput) =>
      mutation(makeSession({ status: "ABANDONED" })),
    createFocusPlan: async (_input: CreateFocusPlanInput) => emptyPlan,
    listFocusPlans: async () => [emptyPlan],
    getFocusPlan: async (_id: string) => emptyPlan,
    updateFocusPlan: async (_id: string, _input: UpdateFocusPlanInput) => emptyPlan,
    archiveFocusPlan: async (_id: string) => emptyPlan,
    createQuickNote: async () => { throw new Error("unused"); },
    listQuickNotes: async () => [],
    getQuickNote: async () => { throw new Error("unused"); },
    updateQuickNote: async () => { throw new Error("unused"); },
    archiveQuickNote: async () => { throw new Error("unused"); },
    convertQuickNote: async () => { throw new Error("unused"); },
    getMetrics: async () => { throw new Error("unused"); },
    getPostFocusActionContext: async () => { throw new Error("unused"); },
    getSessionSummary: async () => { throw new Error("unused"); },
    listHistory: async () => ({ items: [], nextCursor: null, limit: 20 }),
    ...overrides,
  };
}

class ManualClock {
  value = 10_000;
  monotonicNow = () => this.value;
}

class ManualLifecycle implements FocusLifecycle {
  callback: (() => void | Promise<void>) | null = null;
  subscribeCalls = 0;
  unsubscribeCalls = 0;

  subscribe(callback: () => void | Promise<void>): () => void {
    this.subscribeCalls += 1;
    this.callback = callback;
    return () => {
      this.unsubscribeCalls += 1;
      this.callback = null;
    };
  }

  foreground(): void {
    void this.callback?.();
  }
}

class MemoryCache implements FocusRuntimeCache {
  entry: FocusRuntimeCacheEntry | null = null;
  writes = 0;

  read(): FocusRuntimeCacheEntry | null {
    return this.entry;
  }

  write(entry: FocusRuntimeCacheEntry): void {
    this.entry = structuredClone(entry);
    this.writes += 1;
  }

  clear(): void {
    this.entry = null;
  }
}

class ManualTimers {
  private sequence = 0;
  private callbacks = new Map<number, () => void>();

  setTimer = (callback: () => void, _delayMs: number): ReturnType<typeof setTimeout> => {
    const id = ++this.sequence;
    this.callbacks.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    this.callbacks.delete(timer as unknown as number);
  };

  fireNext(): void {
    const first = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!first) throw new Error("No scheduled timer.");
    this.callbacks.delete(first[0]);
    first[1]();
  }

  get size(): number {
    return this.callbacks.size;
  }
}

function makeCacheEntry(session: FocusSessionDto | null): FocusRuntimeCacheEntry {
  return {
    version: FOCUS_RUNTIME_CACHE_VERSION,
    authority: NON_AUTHORITATIVE,
    serverNow: session?.serverNow ?? SERVER_NOW,
    savedAt: session?.serverNow ?? SERVER_NOW,
    session,
  };
}

function makeController(options: {
  api?: FocusApi;
  clock?: ManualClock;
  cache?: FocusRuntimeCache | null;
  lifecycle?: ManualLifecycle | null;
  timers?: ManualTimers;
  keyFactory?: () => string;
} = {}) {
  const clock = options.clock ?? new ManualClock();
  const timers = options.timers ?? new ManualTimers();
  const controller = createFocusRuntimeController({
    api: options.api ?? makeApi(),
    clock,
    cache: options.cache ?? null,
    lifecycle: options.lifecycle === undefined ? new ManualLifecycle() : options.lifecycle,
    accountId: "account-test",
    source: () => "web",
    idempotencyKeyFactory: options.keyFactory ?? (() => "focus-test-key-0001"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    renderTickMs: 1_000,
  });
  return { controller, clock, timers };
}

test("ACTIVE display uses monotonic time and ignores a skewed device wall clock", () => {
  const clock = new ManualClock();
  const snapshot = makeSession({ remainingSeconds: 45 * 60 });
  const baseline = createFocusTimerBaseline(snapshot, SERVER_NOW, clock.value);
  const originalDateNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-25T17:00:00.000Z");
    clock.value += 10 * 60 * 1_000;

    const display = estimateFocusDisplay(snapshot, baseline, clock.value);
    assert.equal(display.displayRemainingSeconds, 35 * 60);
    assert.equal(display.displayMayBeComplete, false);
    assert.equal(display.estimatedServerNow, "2026-09-25T12:10:00.000Z");
  } finally {
    Date.now = originalDateNow;
  }
});

test("PAUSED display stays frozen after wall and monotonic time advance", () => {
  const clock = new ManualClock();
  const snapshot = makeSession({
    status: "PAUSED",
    remainingSeconds: 35 * 60,
  });
  const baseline = createFocusTimerBaseline(snapshot, SERVER_NOW, clock.value);
  const originalDateNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-25T16:00:00.000Z");
    clock.value += 4 * 60 * 60 * 1_000;

    const display = estimateFocusDisplay(snapshot, baseline, clock.value);
    assert.equal(display.displayRemainingSeconds, 35 * 60);
    assert.equal(display.displayMayBeComplete, false);
  } finally {
    Date.now = originalDateNow;
  }
});

test("wall-clock fallback rejects backward jumps and clamps large forward jumps", () => {
  let wall = 10_000;
  const fallback = createFocusClock({ wallNow: () => wall });
  assert.equal(fallback.monotonicNow(), 0);
  wall += 60_000;
  assert.equal(fallback.monotonicNow(), 2_000);
  wall -= 90_000;
  assert.equal(fallback.monotonicNow(), 2_000);
  wall += 500;
  assert.equal(fallback.monotonicNow(), 2_500);
});

test("timer clamps at zero and marks display eligibility only; it never calls complete", async () => {
  const clock = new ManualClock();
  const completeCalls = { value: 0 };
  const api = makeApi({
    getCurrentFocusSession: async () =>
      currentResult(makeSession({ remainingSeconds: 1 })),
    completeFocusSession: async () => {
      completeCalls.value += 1;
      return mutation(makeSession({ status: "COMPLETED" }));
    },
  });
  const { controller } = makeController({ api, clock });
  await controller.initialize();
  clock.value += 3_000;
  const state = controller.refreshDisplay();

  assert.equal(state.displayRemainingSeconds, 0);
  assert.equal(state.displayMayBeComplete, true);
  assert.equal(completeCalls.value, 0);
  controller.dispose();
});

test("malformed server timestamps fail safely", () => {
  const snapshot = makeSession();
  assert.throws(
    () => createFocusTimerBaseline(snapshot, "not-a-date", 10),
    /invalid server timestamp/i,
  );
});

test("canonical reconciliation resets the display baseline", async () => {
  const clock = new ManualClock();
  const api = makeApi({
    getCurrentFocusSession: async () =>
      currentResult(makeSession({ remainingSeconds: 30 * 60 })),
  });
  const { controller } = makeController({ api, clock });
  await controller.initialize();
  clock.value += 20 * 60 * 1_000;
  assert.equal(controller.refreshDisplay().displayRemainingSeconds, 10 * 60);

  api.getCurrentFocusSession = async () =>
    currentResult(makeSession({
      remainingSeconds: 10 * 60,
      serverNow: "2026-09-25T12:20:00.000Z",
    }), "2026-09-25T12:20:00.000Z");
  await controller.reconcile();
  assert.equal(controller.getState().displayRemainingSeconds, 10 * 60);
  controller.dispose();
});

test("a new controller reloads canonical session state without prior memory", async () => {
  const api = makeApi({
    getCurrentFocusSession: async () =>
      currentResult(makeSession({ remainingSeconds: 24 * 60 })),
  });
  const first = makeController({ api });
  await first.controller.initialize();
  first.controller.dispose();

  const reloaded = makeController({ api });
  const state = await reloaded.controller.initialize();
  assert.equal(state.runtimeStatus, "READY");
  assert.equal(state.session?.id, SESSION_ID);
  assert.equal(state.displayRemainingSeconds, 24 * 60);
  assert.equal(state.sessionAuthority, "CANONICAL");
  reloaded.controller.dispose();
});

test("returned snapshots cannot mutate the runtime's canonical session object", async () => {
  const { controller } = makeController({
    api: makeApi({ getCurrentFocusSession: async () => currentResult(makeSession()) }),
  });
  await controller.initialize();
  const exposed = controller.getState();

  if (exposed.session) {
    exposed.session.status = "PAUSED";
    exposed.session.remainingSeconds = 0;
  }

  assert.equal(controller.getState().session?.status, "ACTIVE");
  assert.equal(controller.getState().session?.remainingSeconds, 2_700);
  controller.dispose();
});

test("foreground recovery replaces the local baseline with the canonical snapshot", async () => {
  const clock = new ManualClock();
  const lifecycle = new ManualLifecycle();
  let currentCalls = 0;
  const api = makeApi({
    getCurrentFocusSession: async () => {
      currentCalls += 1;
      return currentCalls === 1
        ? currentResult(makeSession({ remainingSeconds: 30 * 60 }))
        : currentResult(makeSession({
            remainingSeconds: 10 * 60,
            serverNow: "2026-09-25T12:20:00.000Z",
          }), "2026-09-25T12:20:00.000Z");
    },
  });
  const { controller } = makeController({ api, clock, lifecycle });
  await controller.initialize();
  clock.value += 20 * 60 * 1_000; // No render callbacks are needed while backgrounded.
  lifecycle.foreground();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(currentCalls, 2);
  assert.equal(controller.getState().displayRemainingSeconds, 10 * 60);
  controller.dispose();
});

test("offline cache is non-authoritative, blocks mutations, and canonical state wins", async () => {
  const cache = new MemoryCache();
  cache.entry = makeCacheEntry(makeSession({ remainingSeconds: 600 }));
  let failCurrent = true;
  let starts = 0;
  const api = makeApi({
    getCurrentFocusSession: async () => {
      if (failCurrent) throw new FocusApiError("transport", "offline", "TRANSPORT_ERROR");
      return currentResult(null, "2026-09-25T12:30:00.000Z");
    },
    startFocusSession: async () => {
      starts += 1;
      return mutation(makeSession());
    },
  });
  const { controller } = makeController({ api, cache });

  const staleState = await controller.initialize();
  assert.equal(staleState.runtimeStatus, "OFFLINE_STALE");
  assert.equal(staleState.sessionAuthority, "NON_AUTHORITATIVE");
  assert.equal(staleState.displayRemainingSeconds, 600);
  await assert.rejects(
    controller.start({ planId: PLAN_ID, planItemId: PLAN_ITEM_ID }),
    (error: unknown) =>
      error instanceof FocusRuntimeOperationError &&
      error.code === "OFFLINE_MUTATION_UNAVAILABLE",
  );
  assert.equal(starts, 0);

  failCurrent = false;
  const canonical = await controller.reconcile();
  assert.equal(canonical.runtimeStatus, "IDLE");
  assert.equal(canonical.session, null);
  assert.equal(canonical.sessionAuthority, "CANONICAL");
  assert.equal(cache.entry?.session, null);
  controller.dispose();
});

test("offline startup without a cache reports unavailable and does not mutate", async () => {
  let starts = 0;
  const api = makeApi({
    getCurrentFocusSession: async () => {
      throw new FocusApiError("transport", "network unavailable", "TRANSPORT_ERROR");
    },
    startFocusSession: async () => {
      starts += 1;
      return mutation(makeSession());
    },
  });
  const { controller } = makeController({ api, cache: null });
  const state = await controller.initialize();

  assert.equal(state.runtimeStatus, "ERROR");
  assert.equal(state.error?.code, "OFFLINE_UNAVAILABLE");
  assert.equal(state.sessionAuthority, null);
  await assert.rejects(
    controller.start({ planId: PLAN_ID, planItemId: PLAN_ITEM_ID }),
    (error: unknown) =>
      error instanceof FocusRuntimeOperationError &&
      error.code === "RECONCILIATION_REQUIRED",
  );
  assert.equal(starts, 0);
  controller.dispose();
});

test("a canonical terminal session overrides and clears a stale cached ACTIVE session", async () => {
  const cache = new MemoryCache();
  cache.entry = makeCacheEntry(makeSession());
  const api = makeApi({
    getCurrentFocusSession: async () =>
      currentResult(makeSession({
        status: "EXPIRED",
        remainingSeconds: 0,
        completionEligible: false,
      })),
  });
  const { controller } = makeController({ api, cache });
  const state = await controller.initialize();

  assert.equal(state.runtimeStatus, "IDLE");
  assert.equal(state.session, null);
  assert.equal(state.sessionAuthority, "CANONICAL");
  assert.equal(cache.entry?.session, null);
  controller.dispose();
});

test("cache records are versioned and isolated by account", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const accountOne = createFocusRuntimeCache("account-one", storage);
  const accountTwo = createFocusRuntimeCache("account-two", storage);
  accountOne.write(makeCacheEntry(makeSession()));

  assert.equal(accountOne.read()?.authority, "NON_AUTHORITATIVE");
  assert.equal(accountTwo.read(), null);
  assert.equal([...values.keys()].some((key) => key.includes("focus_runtime_cache_v1")), true);
});

test("simultaneous reconciliation triggers share one current-session request", async () => {
  let calls = 0;
  let resolveRequest!: (value: FocusCurrentSessionResult) => void;
  const api = makeApi({
    getCurrentFocusSession: () => {
      calls += 1;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  const { controller } = makeController({ api });

  const first = controller.reconcile();
  const second = controller.reconcile();
  const third = controller.reconcile();
  assert.equal(first, second);
  assert.equal(second, third);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveRequest(currentResult(makeSession()));
  await first;
  controller.dispose();
});

test("a retry after an ambiguous pause failure reuses its original idempotency key", async () => {
  const seenKeys: string[] = [];
  let attempt = 0;
  const api = makeApi({
    pauseFocusSession: async (_id, input) => {
      seenKeys.push(input.idempotencyKey);
      attempt += 1;
      if (attempt === 1) {
        throw new FocusApiError("transport", "response lost", "TRANSPORT_ERROR");
      }
      return mutation(makeSession({ status: "PAUSED" }), "REPLAY_SAME_PAYLOAD");
    },
  });
  const { controller } = makeController({ api });
  await controller.initialize();
  await assert.rejects(controller.pause(), /response lost/);
  assert.equal(controller.getState().pendingOperation?.retryAvailable, true);
  await controller.pause();

  assert.equal(seenKeys.length, 2);
  assert.equal(seenKeys[0], seenKeys[1]);
  assert.equal(controller.getState().session?.status, "PAUSED");
  controller.dispose();
});

test("double pause calls share one mutation request", async () => {
  let calls = 0;
  let resolvePause!: (value: FocusSessionMutationResult) => void;
  const keys: string[] = [];
  const api = makeApi({
    pauseFocusSession: (_id, input) => {
      calls += 1;
      keys.push(input.idempotencyKey);
      return new Promise((resolve) => { resolvePause = resolve; });
    },
  });
  const { controller } = makeController({ api });
  await controller.initialize();

  const first = controller.pause();
  const second = controller.pause();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(keys.length, 1);
  resolvePause(mutation(makeSession({ status: "PAUSED" })));
  await Promise.all([first, second]);
  controller.dispose();
});

test("double start, resume, complete, and abandon calls each use one mutation identity", async () => {
  const cases: Array<{
    operation: "start" | "resume" | "complete" | "abandon";
    status: FocusSessionDto["status"] | null;
  }> = [
    { operation: "start", status: null },
    { operation: "resume", status: "PAUSED" },
    { operation: "complete", status: "ACTIVE" },
    { operation: "abandon", status: "ACTIVE" },
  ];

  for (const item of cases) {
    let calls = 0;
    let generatedKeys = 0;
    let resolveMutation!: (value: FocusSessionMutationResult) => void;
    const keys: string[] = [];
    const deferredResult = () => new Promise<FocusSessionMutationResult>((resolve) => {
      resolveMutation = resolve;
    });
    const apiOverrides: Partial<FocusApi> = {
      getCurrentFocusSession: async () =>
        currentResult(item.status ? makeSession({ status: item.status }) : null),
    };
    if (item.operation === "start") {
      apiOverrides.startFocusSession = async (input) => {
        calls += 1;
        keys.push(input.idempotencyKey);
        return deferredResult();
      };
    } else if (item.operation === "resume") {
      apiOverrides.resumeFocusSession = async (_id, input) => {
        calls += 1;
        keys.push(input.idempotencyKey);
        return deferredResult();
      };
    } else if (item.operation === "complete") {
      apiOverrides.completeFocusSession = async (_id, input) => {
        calls += 1;
        keys.push(input.idempotencyKey);
        return deferredResult();
      };
    } else {
      apiOverrides.abandonFocusSession = async (_id, input) => {
        calls += 1;
        keys.push(input.idempotencyKey);
        return deferredResult();
      };
    }

    const { controller } = makeController({
      api: makeApi(apiOverrides),
      keyFactory: () => `focus-double-${++generatedKeys}`,
    });
    await controller.initialize();
    const invoke = () => {
      if (item.operation === "start") {
        return controller.start({ planId: PLAN_ID, planItemId: PLAN_ITEM_ID });
      }
      if (item.operation === "resume") return controller.resume();
      if (item.operation === "complete") return controller.complete();
      return controller.abandon();
    };

    const first = invoke();
    const second = invoke();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1, `${item.operation} should issue one request`);
    assert.equal(generatedKeys, 1, `${item.operation} should create one idempotency key`);
    assert.equal(keys[0], "focus-double-1");

    const status = item.operation === "complete"
      ? "COMPLETED"
      : item.operation === "abandon"
        ? "ABANDONED"
        : item.operation === "resume" || item.operation === "start"
          ? "ACTIVE"
          : "PAUSED";
    resolveMutation(mutation(makeSession({ status })));
    await Promise.all([first, second]);
    controller.dispose();
  }
});

test("SESSION_READY_TO_COMPLETE preserves ACTIVE and does not complete automatically", async () => {
  let completeCalls = 0;
  let currentCalls = 0;
  const api = makeApi({
    getCurrentFocusSession: async () => {
      currentCalls += 1;
      return currentResult(makeSession({ remainingSeconds: 0 }));
    },
    pauseFocusSession: async () => {
      throw new FocusApiError(
        "http",
        "SESSION_READY_TO_COMPLETE",
        "SESSION_READY_TO_COMPLETE",
        409,
      );
    },
    completeFocusSession: async () => {
      completeCalls += 1;
      return mutation(makeSession({ status: "COMPLETED" }));
    },
  });
  const { controller } = makeController({ api });
  await controller.initialize();
  await assert.rejects(controller.pause(), /SESSION_READY_TO_COMPLETE/);

  assert.equal(controller.getState().session?.status, "ACTIVE");
  assert.equal(controller.getState().semanticResult?.code, "SESSION_READY_TO_COMPLETE");
  assert.equal(controller.getState().pendingOperation, null);
  assert.equal(currentCalls, 2);
  assert.equal(completeCalls, 0);
  controller.dispose();
});

test("completion while PAUSED is rejected locally without an HTTP call", async () => {
  let completeCalls = 0;
  const api = makeApi({
    getCurrentFocusSession: async () =>
      currentResult(makeSession({ status: "PAUSED", remainingSeconds: 600 })),
    completeFocusSession: async () => {
      completeCalls += 1;
      return mutation(makeSession({ status: "COMPLETED" }));
    },
  });
  const { controller } = makeController({ api });
  await controller.initialize();
  await assert.rejects(
    controller.complete(),
    (error: unknown) =>
      error instanceof FocusRuntimeOperationError &&
      error.code === "INVALID_SESSION_STATE",
  );
  assert.equal(completeCalls, 0);
  assert.equal(controller.getState().session?.status, "PAUSED");
  controller.dispose();
});

test("render ticks make no network or persistent writes", async () => {
  const timers = new ManualTimers();
  const cache = new MemoryCache();
  let currentCalls = 0;
  let mutationCalls = 0;
  const api = makeApi({
    getCurrentFocusSession: async () => {
      currentCalls += 1;
      return currentResult(makeSession());
    },
    pauseFocusSession: async () => {
      mutationCalls += 1;
      return mutation(makeSession({ status: "PAUSED" }));
    },
  });
  const { controller, clock } = makeController({ api, cache, timers });
  await controller.initialize();
  const unsubscribe = controller.subscribe(() => {});
  const writesAfterSync = cache.writes;
  for (let index = 0; index < 60; index += 1) {
    clock.value += 1_000;
    timers.fireNext();
  }

  assert.equal(controller.getState().displayRemainingSeconds, 2_640);
  assert.equal(currentCalls, 1);
  assert.equal(mutationCalls, 0);
  assert.equal(cache.writes, writesAfterSync);
  unsubscribe();
  controller.dispose();
});

test("stale current-session responses cannot overwrite a newer mutation response", async () => {
  let resolveOldFetch!: (value: FocusCurrentSessionResult) => void;
  let getCalls = 0;
  const api = makeApi({
    getCurrentFocusSession: () => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve(currentResult(makeSession()));
      return new Promise((resolve) => { resolveOldFetch = resolve; });
    },
    pauseFocusSession: async () =>
      mutation(makeSession({ status: "PAUSED", remainingSeconds: 1_200 })),
  });
  const { controller } = makeController({ api });
  await controller.initialize();
  const staleReconcile = controller.reconcile();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.pause();
  resolveOldFetch(currentResult(makeSession({ status: "ACTIVE", remainingSeconds: 2_400 })));
  await staleReconcile;

  assert.equal(controller.getState().session?.status, "PAUSED");
  assert.equal(controller.getState().displayRemainingSeconds, 1_200);
  controller.dispose();
});

test("a newer reconciliation response wins over an older in-flight current fetch", async () => {
  let getCalls = 0;
  let resolveOld!: (value: FocusCurrentSessionResult) => void;
  let resolveNew!: (value: FocusCurrentSessionResult) => void;
  const api = makeApi({
    getCurrentFocusSession: () => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve(currentResult(makeSession()));
      if (getCalls === 2) return new Promise((resolve) => { resolveOld = resolve; });
      return new Promise((resolve) => { resolveNew = resolve; });
    },
    pauseFocusSession: async () =>
      mutation(makeSession({ status: "PAUSED", remainingSeconds: 1_800 })),
  });
  const { controller } = makeController({ api });
  await controller.initialize();

  const oldReconcile = controller.reconcile();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.pause();
  const newReconcile = controller.reconcile();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getCalls, 3);

  resolveNew(currentResult(makeSession({
    status: "PAUSED",
    remainingSeconds: 1_800,
    serverNow: "2026-09-25T12:01:00.000Z",
  }), "2026-09-25T12:01:00.000Z"));
  await newReconcile;
  resolveOld(currentResult(makeSession({ status: "ACTIVE", remainingSeconds: 2_700 })));
  await oldReconcile;

  assert.equal(controller.getState().session?.status, "PAUSED");
  assert.equal(controller.getState().displayRemainingSeconds, 1_800);
  controller.dispose();
});

test("a start mutation wins over an older empty-current response", async () => {
  let getCalls = 0;
  let resolveOldEmpty!: (value: FocusCurrentSessionResult) => void;
  const api = makeApi({
    getCurrentFocusSession: () => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve(currentResult(null));
      return new Promise((resolve) => { resolveOldEmpty = resolve; });
    },
    startFocusSession: async () =>
      mutation(makeSession({ status: "ACTIVE", remainingSeconds: 2_500 })),
  });
  const { controller } = makeController({ api });
  await controller.initialize();

  const oldReconcile = controller.reconcile();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.start({ planId: PLAN_ID, planItemId: PLAN_ITEM_ID });
  resolveOldEmpty(currentResult(null, "2026-09-25T12:01:00.000Z"));
  await oldReconcile;

  assert.equal(controller.getState().session?.id, SESSION_ID);
  assert.equal(controller.getState().sessionAuthority, "CANONICAL");
  controller.dispose();
});

test("terminal mutation result is retained without claiming a current session", async () => {
  const api = makeApi({
    completeFocusSession: async () =>
      mutation(makeSession({ status: "COMPLETED", actualEndedAt: SERVER_NOW })),
  });
  const { controller } = makeController({ api });
  await controller.initialize();
  const result = await controller.complete();

  assert.equal(result.session.status, "COMPLETED");
  assert.equal(controller.getState().runtimeStatus, "IDLE");
  assert.equal(controller.getState().session, null);
  assert.equal(controller.getState().lastMutationResult?.session.status, "COMPLETED");
  controller.dispose();
});

test("source classification permits only supported platform values", () => {
  assert.equal(classifyFocusSource({
    isNative: true,
    platformName: "ios",
    isStandalone: false,
  }), "ios");
  assert.equal(classifyFocusSource({
    isNative: true,
    platformName: "android",
    isStandalone: true,
  }), "android");
  assert.equal(classifyFocusSource({
    isNative: false,
    platformName: "web",
    isStandalone: true,
  }), "pwa");
  assert.equal(classifyFocusSource({
    isNative: false,
    platformName: "web",
    isStandalone: false,
  }), "web");
});

test("idempotency keys require secure randomness and remain bounded", () => {
  const source = {
    randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };
  const key = createFocusIdempotencyKey(source);
  assert.match(key, /^focus-/);
  assert.ok(key.length >= 8 && key.length <= 160);
  assert.throws(() => createFocusIdempotencyKey({}), /secure random generation/i);
});