import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Group Focus backend availability is exposed through the authenticated study-feature hint", async () => {
  const source = await read("server/features/study-core/featureFlags.ts");
  assert.match(source, /CLIENT_VISIBLE_STUDY_FEATURE_FLAGS\s*=\s*\[[\s\S]*"GROUP_FOCUS_ENABLED"/u);
  assert.match(source, /GROUP_FOCUS_ENABLED:\s*flags\.GROUP_FOCUS_ENABLED/u);
  assert.match(source, /GROUP_FOCUS_ENABLED:\s*false/u);
});

test("Group Focus stays fail-closed in the client when feature discovery is unavailable", async () => {
  const source = await read("src/features/study-core/StudyFeatureFlagsProvider.tsx");
  assert.match(source, /GROUP_FOCUS_ENABLED:\s*boolean/u);
  assert.match(source, /RELEASE_DEFAULT_FLAGS[\s\S]*GROUP_FOCUS_ENABLED:\s*false/u);
  assert.match(source, /typeof flags\.GROUP_FOCUS_ENABLED !== "boolean"/u);
  assert.match(source, /GROUP_FOCUS_ENABLED:\s*flags\.GROUP_FOCUS_ENABLED/u);
});

test("Group Focus UI requires frontend build opt-in, server rollout approval, and a Worker URL", async () => {
  const source = await read("src/App.tsx");
  assert.match(source, /const groupFocusAvailable\s*=\s*[\s\S]*GROUP_FOCUS_FRONTEND_ENABLED[\s\S]*&& GROUP_FOCUS_ENABLED[\s\S]*&& GROUP_FOCUS_WORKER_URL\.length > 0/u);
  assert.match(source, /\{groupFocusAvailable && \(/u);
  assert.match(source, /\{groupFocusAvailable[\s\S]*&& groupFocusRoute !== null/u);
  assert.match(source, /!groupFocusAvailable \|\| groupFocusRoute === null \? "block" : "none"/u);
});
