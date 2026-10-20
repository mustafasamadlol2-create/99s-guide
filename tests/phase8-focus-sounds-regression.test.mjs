import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 8 adds canonical FocusSound metadata with an additive migration", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20261020233000_focus_sound_library/migration.sql");
  assert.match(schema, /model FocusSound \{/);
  assert.match(schema, /storagePath\s+String\s+@unique/);
  assert.match(schema, /isEnabled\s+Boolean\s+@default\(true\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "FocusSound"/);
});

test("owner Focus Sounds API is owner-only while student catalog is authenticated", () => {
  const route = read("server/routes/focusSounds.ts");
  const server = read("server.ts");
  assert.match(route, /router\.use\(dependencies\.requireOwner\)/);
  assert.match(route, /router\.use\(dependencies\.requireUser\)/);
  assert.match(server, /"\/api\/focus-sounds"/);
  assert.match(server, /"\/api\/admin\/focus-sounds"/);
});

test("Focus Sounds use existing private R2 configuration with validated audio payloads", () => {
  const storage = read("server/features/focus-sounds/storage.ts");
  assert.match(storage, /getR2Client/);
  assert.match(storage, /MAX_FOCUS_SOUND_BYTES/);
  assert.match(storage, /FOCUS_SOUND_SIGNATURE_MISMATCH/);
  assert.match(storage, /getSignedUrl/);
});

test("owner console supports upload edit enable-disable delete and ordering", () => {
  const controlCenter = read("src/features/admin/components/ControlCenterView.tsx");
  const panel = read("src/features/admin/components/ManageFocusSounds.tsx");
  assert.match(controlCenter, /id: "focus-sounds" as SubTab/);
  assert.match(panel, /uploadOwnerFocusSound/);
  assert.match(panel, /updateOwnerFocusSound/);
  assert.match(panel, /deleteOwnerFocusSound/);
  assert.match(panel, /reorderOwnerFocusSounds/);
});

test("student Focus Audio retains local files and shows shared library only when real sounds exist", () => {
  const card = read("src/features/focus/components/FocusAudioPlanningCard.tsx");
  const catalog = read("src/features/focus-audio/ambientCatalog.ts");
  assert.match(card, /sharedSounds\.length > 0/);
  assert.match(card, /audioFileInputRef/);
  assert.match(card, /selectSharedAudio/);
  assert.match(catalog, /Object\.freeze\(\[\]\)/);
});

test("shared sounds can be switched during active playback and keep volume-loop controls", () => {
  const card = read("src/features/focus/components/FocusAudioPlanningCard.tsx");
  const engine = read("src/features/focus-audio/engine.ts");
  assert.match(card, /const wasPlaying = audio\.state === "PLAYING"/);
  assert.match(card, /await audioContext\.play\(\)/);
  assert.match(engine, /loopLocked: false/);
  assert.match(engine, /const loop = this\.activeSource\?\.loopLocked \? true : enabled/);
});

test("Phase 8 adds no new required environment variable", () => {
  const storage = read("server/features/focus-sounds/storage.ts");
  assert.doesNotMatch(storage, /process\.env/);
  assert.match(storage, /getR2Client/);
});
