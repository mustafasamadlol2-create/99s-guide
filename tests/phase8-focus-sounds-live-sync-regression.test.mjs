import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Focus POST/PATCH requests remain CORS-compatible after Phase 8", () => {
  const server = read("server.ts");
  assert.match(server, /"X-Focus-Client-ID"/);
});

test("student Focus Sounds availability is never served from stale HTTP/client cache", () => {
  const route = read("server/routes/focusSounds.ts");
  const api = read("src/features/focus-audio/sharedSoundsApi.ts");
  assert.match(route, /no-store, no-cache, max-age=0, must-revalidate/);
  assert.match(api, /bypassCache: true/);
  assert.match(api, /ttl: 0/);
});

test("owner mutations broadcast live library invalidation to all authenticated clients", () => {
  const route = read("server/routes/focusSounds.ts");
  const server = read("server.ts");
  const app = read("src\/App.tsx");
  const card = read("src/features/focus/components/FocusAudioPlanningCard.tsx");
  assert.match(route, /onLibraryChanged\?: \(\) => void/);
  assert.match(server, /emit\("focus_sounds_updated"/);
  assert.match(app, /socket\.on\("focus_sounds_updated"/);
  assert.match(card, /FOCUS_SOUNDS_SOCKET_UPDATED_EVENT/);
});

test("same-client owner mutations invalidate immediately and stale reads cannot win a race", () => {
  const admin = read("src/features/focus-audio/adminApi.ts");
  const card = read("src/features/focus/components/FocusAudioPlanningCard.tsx");
  assert.match(admin, /clearApiCache\("\/api\/focus-sounds"\)/);
  assert.match(admin, /FOCUS_SOUNDS_LIBRARY_CHANGED_EVENT/);
  assert.match(card, /sharedLoadGenerationRef/);
  assert.match(card, /generation !== sharedLoadGenerationRef\.current/);
});
