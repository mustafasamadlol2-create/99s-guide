import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("native motion has no external animation dependency", async () => {
  const picker = await read("src/features/focus/components/FocusLecturePicker.tsx");
  const switcher = await read("src/features/focus/components/FocusModeSwitcher.tsx");
  assert.doesNotMatch(picker, /framer-motion|AnimatePresence|motion\./);
  assert.doesNotMatch(switcher, /framer-motion|motion\./);
  assert.match(picker, /focus-lecture-picker-overlay/);
  assert.match(switcher, /focus-mode-tab/);
});

test("lecture picker uses light iOS backdrop and dependency-free spring-like sheet motion", async () => {
  const source = await read("src/features/focus/components/FocusLecturePicker.tsx");
  const css = await read("src/features/focus/components/focus-hub-approved.css");
  assert.match(source, /bg-slate-700\/\[0\.28\]/);
  assert.doesNotMatch(source, /bg-slate-950\/55/);
  assert.match(source, /focus-visible:outline-none/);
  assert.match(css, /focus-lecture-picker-sheet/);
  assert.match(css, /cubic-bezier\(\.22, 1, \.36, 1\)/);
});

test("Focus Hub and Group Focus expose native motion without new packages", async () => {
  const focusCss = await read("src/features/focus/components/focus-hub-approved.css");
  const switcher = await read("src/features/focus/components/FocusModeSwitcher.tsx");
  const groupUi = await read("src/features/group-focus/ui/groupFocusUi.tsx");
  assert.match(focusCss, /focus-ios-surface-in/);
  assert.match(focusCss, /focus-mode-selection-in/);
  assert.match(switcher, /aria-selected=\{selected\}/);
  assert.match(groupUi, /gf-ios-surface-in/);
  assert.match(groupUi, /transform: scale\(\.965\)/);
});

test("Study Engagement and Leaderboard keep green palette while using native motion", async () => {
  const engagement = await read("src/features/gamification/gamification.css");
  const leaderboard = await read("src/features/gamification/leaderboard-view.css");
  assert.match(engagement, /--g-accent: #397a70/);
  assert.match(engagement, /--g-ios-ease/);
  assert.match(engagement, /g-ios-panel-in/);
  assert.match(engagement, /backdrop-filter:blur\(18px\)/);
  assert.match(leaderboard, /lv-board-in/);
  assert.match(leaderboard, /transform:scale\(\.985\)/);
});
