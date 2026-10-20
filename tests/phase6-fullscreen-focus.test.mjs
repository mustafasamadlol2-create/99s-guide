import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const immersive = read("src/features/focus/components/FocusImmersiveMode.tsx");
const css = read("src/features/focus/components/focus-immersive.css");
const active = read("src/features/focus/components/ActiveFocusScreen.tsx");
const translations = read("src/core/i18n/translations.ts");

test("Phase 6 fullscreen is a body-level viewport surface with native status-bar lifecycle", () => {
  assert.match(immersive, /createPortal\(/);
  assert.match(immersive, /document\.body/);
  assert.match(immersive, /NativeBridge\.hideStatusBar\(\)/);
  assert.match(immersive, /NativeBridge\.showStatusBar\(\)/);
  assert.match(immersive, /addAppLifecycleListener/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("Phase 6 fullscreen is opt-in and distraction-free", () => {
  assert.match(active, /const \[immersiveMode, setImmersiveMode\] = useState\(false\)/);
  assert.match(active, /focusImmersiveEnter/);
  assert.match(immersive, /onExit/);
  assert.doesNotMatch(immersive, /onPauseResume|onEnd|onToggleAudio|lectureTitle|roundText/);
  assert.match(css, /background:\s*#000/);
  assert.doesNotMatch(immersive, /framer-motion/);
});

test("Phase 6 fullscreen timer subscribes directly to canonical runtime ticks", () => {
  assert.match(immersive, /controller\.subscribe/);
  assert.match(immersive, /displayRemainingSeconds/);
  assert.match(immersive, /formatFocusClock/);
});

test("Phase 6 fullscreen has subtle native motion while respecting reduced motion", () => {
  assert.match(css, /focus-immersive-digit-in/);
  assert.match(css, /focus-immersive-breathe/);
  assert.match(css, /focus-immersive-clock-in/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Phase 6 keeps bilingual fullscreen entry label", () => {
  assert.match(translations, /focusImmersiveEnter: "Full Screen"/);
  assert.match(translations, /focusImmersiveEnter: "ملء الشاشة"/);
});
