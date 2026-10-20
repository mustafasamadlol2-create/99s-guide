import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const active = fs.readFileSync("src/features/focus/components/ActiveFocusScreen.tsx", "utf8");
const immersive = fs.readFileSync("src/features/focus/components/FocusImmersiveMode.tsx", "utf8");
const css = fs.readFileSync("src/features/focus/components/focus-immersive.css", "utf8");

test("fullscreen is opt-in instead of automatic on focus start", () => {
  assert.match(active, /useState\(false\)/);
  assert.doesNotMatch(active, /useState\(true\);\s*\/\/.*immersive/i);
});

test("immersive clock subscribes directly to runtime display ticks", () => {
  assert.match(immersive, /controller\.subscribe/);
  assert.match(immersive, /displayRemainingSeconds/);
  assert.match(immersive, /formatFocusClock/);
});

test("immersive surface stays black and distraction free", () => {
  assert.match(css, /background:\s*#000/);
  assert.doesNotMatch(immersive, /Pause|Resume|End Focus|Sound|lectureTitle|roundText/);
});

test("immersive timer has dependency-free native motion", () => {
  assert.match(css, /focus-immersive-digit-in/);
  assert.match(css, /focus-immersive-breathe/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(immersive, /framer-motion/);
});
