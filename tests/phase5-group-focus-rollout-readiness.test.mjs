import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Group Focus backend availability and runtime readiness are exposed through the study-feature hint", async () => {
  const flags = await read("server/features/study-core/featureFlags.ts");
  const route = await read("server/routes/studyFeatureFlags.ts");
  assert.match(flags, /CLIENT_VISIBLE_STUDY_FEATURE_FLAGS\s*=\s*\[[\s\S]*"GROUP_FOCUS_ENABLED"/u);
  assert.match(flags, /GROUP_FOCUS_ENABLED:\s*flags\.GROUP_FOCUS_ENABLED/u);
  assert.match(flags, /GROUP_FOCUS_ENABLED:\s*false/u);
  assert.match(route, /GROUP_FOCUS_RUNTIME_READY:\s*isGroupFocusRuntimeReady\(\)/u);
});

test("Group Focus stays fail-closed in the client when feature discovery is unavailable", async () => {
  const source = await read("src/features/study-core/StudyFeatureFlagsProvider.tsx");
  assert.match(source, /GROUP_FOCUS_ENABLED:\s*boolean/u);
  assert.match(source, /GROUP_FOCUS_RUNTIME_READY:\s*boolean/u);
  assert.match(source, /RELEASE_DEFAULT_FLAGS[\s\S]*GROUP_FOCUS_ENABLED:\s*false[\s\S]*GROUP_FOCUS_RUNTIME_READY:\s*false/u);
  assert.match(source, /typeof flags\.GROUP_FOCUS_ENABLED !== "boolean"/u);
  assert.match(source, /typeof flags\.GROUP_FOCUS_RUNTIME_READY !== "boolean"/u);
  assert.match(source, /GROUP_FOCUS_ENABLED:\s*flags\.GROUP_FOCUS_ENABLED/u);
  assert.match(source, /GROUP_FOCUS_RUNTIME_READY:\s*flags\.GROUP_FOCUS_RUNTIME_READY/u);
});

test("Group Focus UI requires frontend opt-in, backend approval, runtime readiness, and a Worker URL", async () => {
  const source = await read("src/App.tsx");
  assert.match(source, /const groupFocusAvailable\s*=\s*[\s\S]*GROUP_FOCUS_FRONTEND_ENABLED[\s\S]*&& GROUP_FOCUS_ENABLED[\s\S]*&& GROUP_FOCUS_RUNTIME_READY[\s\S]*&& GROUP_FOCUS_WORKER_URL\.length > 0/u);
  assert.match(source, /\{groupFocusAvailable && \(/u);
  assert.match(source, /\{groupFocusAvailable[\s\S]*&& groupFocusRoute !== null/u);
  assert.match(source, /!groupFocusAvailable \|\| groupFocusRoute === null \? "block" : "none"/u);
  assert.match(source, /const groupRouteRequested =[\s\S]*parts\[1\] === "group"[\s\S]*studyFeatureFlagsStatus === "loading"/u);
  assert.match(source, /studyFeatureFlagsStatus === "ready"[\s\S]*!groupFocusAvailable[\s\S]*setGroupFocusRoute\(null\)/u);
});
