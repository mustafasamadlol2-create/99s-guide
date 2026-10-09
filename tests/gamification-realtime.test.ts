import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGamificationUpdate,
  readGamificationResource,
  resourcesForGamificationReconnect,
  setGamificationReadAccountScope,
} from "../src/features/gamification/realtime.ts";
import {
  createGamificationUpdateBroadcaster,
  type GamificationUpdatePayload,
} from "../server/features/gamification/realtime.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("matching Gamification reads share one in-flight request", async () => {
  setGamificationReadAccountScope("gamification-read-user");
  let loads = 0;
  const response = deferred<string>();
  const load = async () => {
    loads += 1;
    return response.promise;
  };

  const first = readGamificationResource("summary", "current", load);
  const second = readGamificationResource("summary", "current", load);
  await Promise.resolve();
  assert.equal(loads, 1);
  response.resolve("summary");
  assert.deepEqual(await Promise.all([first, second]), ["summary", "summary"]);
  setGamificationReadAccountScope(null);
});

test("repeated Gamification event IDs invalidate and dispatch only once", () => {
  const payload = {
    eventId: "gamification-duplicate-event",
    changedAt: "2026-10-09T00:00:00.000Z",
    resources: ["summary", "summary", "challenges", "unsupported"],
  };
  assert.deepEqual(acceptGamificationUpdate(payload)?.resources, [
    "summary",
    "challenges",
  ]);
  assert.equal(acceptGamificationUpdate(payload), null);
});

test("a response started before invalidation cannot win over the fresh read", async () => {
  setGamificationReadAccountScope("gamification-stale-user");
  const stale = deferred<string>();
  const fresh = deferred<string>();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads === 1 ? stale.promise : fresh.promise;
  };

  const oldCaller = readGamificationResource("summary", "current", load);
  await Promise.resolve();
  const invalidation = acceptGamificationUpdate({
    eventId: "gamification-stale-response-event",
    resources: ["summary"],
  });
  assert.ok(invalidation);
  const newCaller = readGamificationResource("summary", "current", load);
  await Promise.resolve();
  stale.resolve("stale");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  fresh.resolve("fresh");

  assert.deepEqual(await Promise.all([oldCaller, newCaller]), ["fresh", "fresh"]);
  assert.equal(loads, 2);
  setGamificationReadAccountScope(null);
});

test("socket reconnect refreshes private resources and the visible ranking view", () => {
  assert.deepEqual(resourcesForGamificationReconnect("challenges"), [
    "summary",
    "achievements",
    "challenges",
  ]);
  assert.deepEqual(resourcesForGamificationReconnect("overview"), [
    "summary",
    "achievements",
    "challenges",
    "rank",
  ]);
  assert.deepEqual(resourcesForGamificationReconnect("leaderboard"), [
    "summary",
    "achievements",
    "challenges",
    "leaderboard",
    "rank",
  ]);
  assert.deepEqual(resourcesForGamificationReconnect("challenges", {
    leaderboard: true,
    rank: false,
  }), [
    "summary",
    "achievements",
    "challenges",
    "leaderboard",
    "rank",
  ]);
});

test("the broadcaster sends private state to every user device and only ranking invalidations globally", () => {
  const userRooms = new Map<string, GamificationUpdatePayload[]>();
  const authenticatedClients = new Map<string, GamificationUpdatePayload[]>();
  const userRoomClients = new Map([
    ["user-a", ["tab-a", "phone-a"]],
    ["user-b", ["tab-b", "tablet-b"]],
  ]);
  const broadcaster = createGamificationUpdateBroadcaster(
    (userId, payload) => {
      for (const client of userRoomClients.get(userId) ?? []) {
        const events = userRooms.get(client) ?? [];
        events.push(payload);
        userRooms.set(client, events);
      }
    },
    (payload) => {
      for (const client of [...userRoomClients.values()].flat()) {
        const events = authenticatedClients.get(client) ?? [];
        events.push(payload);
        authenticatedClients.set(client, events);
      }
    },
  );

  broadcaster("user-a", [
    "summary",
    "achievements",
    "challenges",
    "leaderboard",
    "rank",
    "summary",
  ]);

  for (const client of ["tab-a", "phone-a"]) {
    assert.deepEqual(userRooms.get(client)?.[0].resources, [
      "summary",
      "achievements",
      "challenges",
      "leaderboard",
      "rank",
    ]);
  }
  for (const client of ["tab-b", "tablet-b"]) {
    assert.deepEqual(authenticatedClients.get(client)?.[0].resources, [
      "leaderboard",
      "rank",
    ]);
    assert.deepEqual(userRooms.get(client), undefined);
  }
});
