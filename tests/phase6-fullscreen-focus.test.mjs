import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const immersive = read("src/features/focus/components/FocusImmersiveMode.tsx");
const css = read("src/features/focus/components/focus-immersive.css");
const active = read("src/features/focus/components/ActiveFocusScreen.tsx");
const translations = read("src/core/i18n/translations.ts");

test("Phase 6 immersive Focus is a body-level viewport surface with native status-bar lifecycle", () => {
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

test("Phase 6 keeps only the minimal on-demand Focus controls", () => {
  assert.match(immersive, /onPauseResume/);
  assert.match(immersive, /onEnd/);
  assert.match(immersive, /onToggleAudio/);
  assert.match(immersive, /onExit/);
  assert.match(immersive, /CONTROL_HIDE_DELAY_MS/);
  assert.match(immersive, /is-controls-hidden/);
  assert.match(immersive, /audioAvailable/);
  assert.doesNotMatch(immersive, /framer-motion/);
});

test("Phase 6 reuses canonical Focus runtime mutations and returns to workspace at timer completion", () => {
  assert.match(active, /const \[immersiveMode, setImmersiveMode\] = useState\(true\)/);
  assert.match(active, /runtime\.completionEligible === true/);
  assert.match(active, /setImmersiveMode\(false\)/);
  assert.match(active, /onPauseResume=\{isPaused \? handleResume : handlePause\}/);
  assert.match(active, /onEnd=\{\(\) => setConfirmType\("end"\)\}/);
  assert.match(active, /handleImmersiveAudioToggle/);
  assert.match(active, /focusImmersiveEnter/);
});

test("Phase 6 supports light/dark, phone/tablet landscape and reduced motion", () => {
  assert.match(css, /\.dark \.focus-immersive-layer/);
  assert.match(css, /@media \(orientation: landscape\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Phase 6 adds bilingual fullscreen Focus labels", () => {
  assert.match(translations, /focusImmersiveEnter: "Full Screen"/);
  assert.match(translations, /focusImmersiveExit: "Exit Full Screen"/);
  assert.match(translations, /focusImmersiveSound: "Sound"/);
  assert.match(translations, /focusImmersiveEnter: "ملء الشاشة"/);
  assert.match(translations, /focusImmersiveExit: "الخروج من ملء الشاشة"/);
});
