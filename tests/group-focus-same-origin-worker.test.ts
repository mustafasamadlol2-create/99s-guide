import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GROUP_FOCUS_DEFAULT_WORKER_ORIGIN,
  GROUP_FOCUS_LEGACY_WORKER_ORIGIN,
  groupFocusWorkerOriginCandidates,
  resolveGroupFocusWorkerOrigin,
} from "../shared/group-focus-realtime/workerOrigin.js";

test("Group Focus realtime defaults to the primary app Worker", () => {
  assert.equal(
    GROUP_FOCUS_DEFAULT_WORKER_ORIGIN,
    "https://99s-guide.mustafasamadlol2.workers.dev",
  );
  assert.equal(
    resolveGroupFocusWorkerOrigin({ GROUP_FOCUS_WORKER_URL: GROUP_FOCUS_LEGACY_WORKER_ORIGIN }),
    GROUP_FOCUS_DEFAULT_WORKER_ORIGIN,
  );
  assert.equal(
    groupFocusWorkerOriginCandidates({
      preferred: GROUP_FOCUS_LEGACY_WORKER_ORIGIN,
      currentAppOrigin: GROUP_FOCUS_DEFAULT_WORKER_ORIGIN,
    })[0],
    GROUP_FOCUS_DEFAULT_WORKER_ORIGIN,
  );
});

test("primary Wrangler deployment owns the Group Focus Durable Object and route", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.main, "cloudflare-main-worker.ts");
  assert.equal(config.assets.binding, "ASSETS");
  assert.ok(config.assets.run_worker_first.includes("/group-focus/*"));
  assert.equal(config.durable_objects.bindings[0].name, "GROUP_FOCUS_ROOMS");
  assert.equal(config.durable_objects.bindings[0].class_name, "GroupFocusRoom");
  assert.equal(config.exports.GroupFocusRoom.type, "durable-object");
  assert.equal(config.exports.GroupFocusRoom.storage, "sqlite");
});
