import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { apiClient, clearApiCache } from "../src/core/api/apiClient";
import { setActiveAccountId } from "../src/core/storage/accountData";
import { SecureStorage } from "../src/core/utils/secureStorage";

test("protected GETs do not reuse another session's cache or in-flight response", async () => {
  const restoreFetch = globalThis.fetch;
  const restoreStorage = SecureStorage.get;
  const url = "https://fixture.invalid/api/notifications";
  let fetches = 0;
  let release!: (response: Response) => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const firstReply = new Promise<Response>((resolve) => { release = resolve; });
  const read = () => apiClient(url, { method: "GET", silent: true, retries: 0 });
  SecureStorage.get = async () => null;
  globalThis.fetch = async () => {
    fetches++;
    if (fetches === 1) {
      started();
      return firstReply;
    }
    return Response.json({ scope: fetches === 2 ? "second" : "new-group" });
  };
  try {
    clearApiCache();
    setActiveAccountId("phase10-first");
    const old = read();
    const rejected = assert.rejects(old, { name: "AbortError" });
    await firstStarted;
    setActiveAccountId("phase10-second");
    const second = read();
    release(Response.json({ scope: "first" }));
    assert.deepEqual(await (await second).json(), { scope: "second" });
    await rejected;
    await nextTurn();
    assert.deepEqual(await (await read()).json(), { scope: "second" });
    assert.equal(fetches, 2);

    clearApiCache();
    assert.deepEqual(await (await read()).json(), { scope: "new-group" });
    assert.equal(fetches, 3);
  } finally {
    globalThis.fetch = restoreFetch;
    SecureStorage.get = restoreStorage;
    setActiveAccountId(null);
    clearApiCache();
  }
});

test("identical protected GETs share one request inside the same active scope", async () => {
  const restoreFetch = globalThis.fetch;
  const restoreStorage = SecureStorage.get;
  let fetches = 0;
  SecureStorage.get = async () => null;
  globalThis.fetch = async () => {
    fetches++;
    return Response.json({ scope: "same" });
  };
  try {
    setActiveAccountId("phase10-same");
    const url = "https://fixture.invalid/api/qa/same-account";
    const responses = await Promise.all([apiClient(url), apiClient(url)]);
    assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
      { scope: "same" }, { scope: "same" },
    ]);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = restoreFetch;
    SecureStorage.get = restoreStorage;
    setActiveAccountId(null);
    clearApiCache();
  }
});
