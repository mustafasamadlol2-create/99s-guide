import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/features/profile/components/ProfileView.tsx", "utf8");

test("premium streak badge is attached to the avatar opposite the edit control", () => {
  assert.match(source, /relative inline-flex items-center justify-center/);
  assert.match(source, /absolute -bottom-2 -left-8 z-20/);
  assert.match(source, /from-amber-400 via-orange-500 to-orange-600/);
});

test("badge preserves the requested icon-plus-number-only presentation", () => {
  assert.match(source, /<Flame/);
  assert.match(source, /Intl\.NumberFormat/);
  assert.doesNotMatch(source, />\s*Study streak\s*</i);
  assert.doesNotMatch(source, />\s*day streak\s*</i);
});
