import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptFocusInvalidation,
  getFocusClientInstanceId,
  invalidateFocusResources,
  isFocusInvalidationFromCurrentClient,
  readFocusResource,
  resourcesForFocusMutation,
  setFocusReadAccountScope,
} from "../src/features/focus/api/focusSync.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("same Focus resource and query share one simultaneous read", async () => {
  const result = deferred<string>();
  let loads = 0;
  const load = () => {
    loads += 1;
    return result.promise;
  };

  const first = readFocusResource("history", "page:first", load);
  const second = readFocusResource("history", "page:first", load);
  await Promise.resolve();
  assert.equal(loads, 1);

  result.resolve("shared");
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
});

test("account and query variants never share a Focus read or request key", async () => {
  const accountKeys: string[] = [];
  const accountA = deferred<string>();
  const accountB = deferred<string>();
  setFocusReadAccountScope("focus-account-a");
  const first = readFocusResource("current-session", "current", (key) => {
    accountKeys.push(key);
    return accountA.promise;
  });
  setFocusReadAccountScope("focus-account-b");
  const second = readFocusResource("current-session", "current", (key) => {
    accountKeys.push(key);
    return accountB.promise;
  });
  await Promise.resolve();
  assert.equal(accountKeys.length, 2);
  assert.notEqual(accountKeys[0], accountKeys[1]);
  accountA.resolve("account-a");
  accountB.resolve("account-b");
  assert.deepEqual(await Promise.all([first, second]), ["account-a", "account-b"]);
  setFocusReadAccountScope(null);

  const queryKeys: string[] = [];
  await Promise.all([
    readFocusResource("plans", "", async (key) => {
      queryKeys.push(key);
      return "default";
    }),
    readFocusResource("plans", "?canonical=1", async (key) => {
      queryKeys.push(key);
      return "canonical";
    }),
  ]);
  assert.equal(queryKeys.length, 2);
  assert.notEqual(queryKeys[0], queryKeys[1]);
});

test("a pending read retries after invalidation instead of returning stale data", async () => {
  const oldResult = deferred<string>();
  const freshResult = deferred<string>();
  let loads = 0;
  const load = () => {
    loads += 1;
    return loads === 1 ? oldResult.promise : freshResult.promise;
  };

  const startedBeforeInvalidation = readFocusResource(
    "current-session",
    "current",
    load,
  );
  await Promise.resolve();
  assert.equal(loads, 1);

  invalidateFocusResources({ resources: ["current-session"] });
  const startedAfterInvalidation = readFocusResource(
    "current-session",
    "current",
    load,
  );
  await Promise.resolve();
  assert.equal(loads, 2);

  oldResult.resolve("stale");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(loads, 2);
  freshResult.resolve("fresh");
  assert.deepEqual(
    await Promise.all([startedBeforeInvalidation, startedAfterInvalidation]),
    ["fresh", "fresh"],
  );
  assert.equal(loads, 2);
});

test("duplicate socket invalidation IDs are applied only once", () => {
  const event = {
    eventId: `focus-test-${Date.now()}-${Math.random()}`,
    resources: ["break", "current-session"],
    sessionId: "session-1",
  };

  assert.deepEqual(acceptFocusInvalidation(event), {
    ...event,
  });
  assert.equal(acceptFocusInvalidation(event), null);
});

test("same-tab socket echoes are ignored while remote client events remain distinct", () => {
  const clientId = getFocusClientInstanceId();
  assert.equal(
    isFocusInvalidationFromCurrentClient({ originClientId: clientId }),
    true,
  );
  assert.equal(
    isFocusInvalidationFromCurrentClient({ originClientId: "another-tab-id" }),
    false,
  );
  assert.equal(isFocusInvalidationFromCurrentClient({}), false);
});

test("mutation invalidation scopes follow the resources reported by each response", () => {
  const sessionId = "focus-session-1";
  assert.deepEqual(
    resourcesForFocusMutation("/api/focus/sessions/x/complete", {
      idempotency: "FIRST_SEEN",
      session: { id: sessionId, status: "COMPLETED" },
    }),
    {
      resources: [
        "current-session",
        "history",
        "metrics",
        "summary",
        "post-actions",
      ],
      sessionId,
    },
  );
  assert.deepEqual(
    resourcesForFocusMutation(`/api/focus/sessions/${sessionId}/interruptions`, {
      sessionId,
      metricUpdated: false,
    }),
    { resources: [], sessionId },
  );
  assert.deepEqual(
    resourcesForFocusMutation("/api/focus/plans", {
      plan: { id: "focus-plan-1" },
    }),
    { resources: ["plans"], planId: "focus-plan-1" },
  );
});
