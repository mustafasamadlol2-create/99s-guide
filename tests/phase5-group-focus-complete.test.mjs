import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 5 fails closed unless Group Focus server runtime signing is ready", async () => {
  const readiness = await read("server/features/group-focus/readiness.ts");
  const publicRoutes = await read("server/routes/groupFocus.ts");
  const internalRoutes = await read("server/routes/groupFocusRuntimeInternal.ts");
  const flagsRoute = await read("server/routes/studyFeatureFlags.ts");
  const provider = await read("src/features/study-core/StudyFeatureFlagsProvider.tsx");
  const app = await read("src/App.tsx");
  assert.match(readiness, /getActiveGroupFocusCapabilityKey/u);
  assert.match(readiness, /parseGroupFocusReconciliationKeyring/u);
  assert.match(readiness, /ready:\s*capabilityReady && reconciliationReady/u);
  assert.match(publicRoutes, /RUNTIME_NOT_READY/u);
  assert.match(internalRoutes, /RUNTIME_NOT_READY/u);
  assert.match(flagsRoute, /GROUP_FOCUS_RUNTIME_READY:\s*isGroupFocusRuntimeReady\(\)/u);
  assert.match(provider, /GROUP_FOCUS_RUNTIME_READY:\s*boolean/u);
  assert.match(app, /&& GROUP_FOCUS_RUNTIME_READY[\s\S]*&& GROUP_FOCUS_WORKER_URL\.length > 0/u);
});

test("Phase 5 supports immediate canonical membership reconciliation and authorization refresh", async () => {
  const protocol = await read("shared/group-focus-realtime/protocol.ts");
  const runtime = await read("src/features/group-focus/runtime/groupFocusRealtime.ts");
  const worker = await read("cloudflare-group-focus-worker/src/GroupFocusRoom.ts");
  const frontend = await read("src/features/group-focus/GroupFocusFrontend.tsx");
  assert.match(protocol, /CANONICAL_SYNC_REQUEST/u);
  assert.match(runtime, /syncCanonical\(\): void[\s\S]*CANONICAL_SYNC_REQUEST/u);
  assert.match(runtime, /async refreshAuthorization\(\): Promise<void>/u);
  assert.match(worker, /message\.type === "CANONICAL_SYNC_REQUEST"[\s\S]*syncCanonicalRoom/u);
  assert.match(worker, /participantCapabilityIsCanonicallyCurrent/u);
  assert.match(worker, /connectionState === "CANONICALLY_INVALIDATED"[\s\S]*connectionState === "DISCONNECTED"/u);
  assert.match(worker, /message\.type === "CANONICAL_SYNC_REQUEST"[\s\S]*attachment\.role !== "HOST"[\s\S]*HOST_ONLY_ACTION/u);
  assert.match(frontend, /removeGroupFocusMember/u);
  assert.match(frontend, /runtimeEntry\.runtime\.syncCanonical\(\)/u);
  assert.match(frontend, /await runtimeEntry\.runtime\.refreshAuthorization\(\)/u);
});

test("Phase 5 host controls have a canonical close fallback and Worker deployment readiness", async () => {
  const frontend = await read("src/features/group-focus/GroupFocusFrontend.tsx");
  const roomUi = await read("src/features/group-focus/ui/GroupFocusRoom.tsx");
  const workerIndex = await read("cloudflare-group-focus-worker/src/index.ts");
  const wrangler = await read("cloudflare-group-focus-worker/wrangler.jsonc");
  const releaseGates = await read("server/observability/releaseGates.ts");
  assert.match(frontend, /closeGroupFocusRoom/u);
  assert.match(frontend, /runtimeEntry\.runtime\.closeRoom\(\)[\s\S]*closeGroupFocusRoom/u);
  assert.match(roomUi, /memberManagementAllowed/u);
  assert.match(roomUi, /onRemoveMember/u);
  assert.match(workerIndex, /url\.pathname === "\/ready"/u);
  assert.match(workerIndex, /runtimeReady \? 200 : 503/u);
  assert.match(workerIndex, /!groupFocusWorkerRuntimeReady\(environment\)[\s\S]*WORKER_RUNTIME_NOT_READY/u);
  assert.match(wrangler, /"workers_dev": true/u);
  assert.match(releaseGates, /valid capability and reconciliation signing configuration/u);
});
