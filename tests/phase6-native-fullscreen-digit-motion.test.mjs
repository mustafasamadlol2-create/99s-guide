import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const active = fs.readFileSync("src/features/focus/components/ActiveFocusScreen.tsx", "utf8");
const immersive = fs.readFileSync("src/features/focus/components/FocusImmersiveMode.tsx", "utf8");
const css = fs.readFileSync("src/features/focus/components/focus-immersive.css", "utf8");

test("fullscreen remains explicitly opt-in for each session", () => {
  assert.match(active, /useState\(false\)/);
  assert.match(active, /setImmersiveMode\(false\);\s*\}\, \[sessionRouteId\]\)/);
  assert.match(active, /onClick=\{\(\) => setImmersiveMode\(true\)\}/);
});

test("fullscreen timer remains live from FocusRuntimeController", () => {
  assert.match(immersive, /controller\.subscribe/);
  assert.match(immersive, /displayRemainingSeconds/);
  assert.match(immersive, /formatFocusClock/);
});

test("changed timer digits use native-style rolling transitions", () => {
  assert.match(immersive, /function RollingDigit/);
  assert.match(immersive, /focus-immersive-digit--incoming/);
  assert.match(immersive, /focus-immersive-digit--outgoing/);
  assert.match(css, /@keyframes focus-immersive-digit-in/);
  assert.match(css, /@keyframes focus-immersive-digit-out/);
  assert.match(css, /-apple-system/);
  assert.match(css, /SF Pro Display/);
  assert.match(css, /font-variant-numeric: tabular-nums lining-nums/);
});
