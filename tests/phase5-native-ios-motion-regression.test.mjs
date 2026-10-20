import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("lecture picker uses a light iOS-style backdrop and spring sheet", async () => {
  const source = await read("src/features/focus/components/FocusLecturePicker.tsx");
  assert.match(source, /AnimatePresence/);
  assert.match(source, /type: "spring"/);
  assert.match(source, /bg-slate-700\/\[0\.16\]/);
  assert.doesNotMatch(source, /bg-slate-950\/55/);
  assert.match(source, /focus-visible:outline-none/);
});

test("Focus Hub and Group Focus expose the native motion contract", async () => {
  const focusCss = await read("src/features/focus/components/focus-hub-approved.css");
  const switcher = await read("src/features/focus/components/FocusModeSwitcher.tsx");
  const groupUi = await read("src/features/group-focus/ui/groupFocusUi.tsx");
  assert.match(focusCss, /focus-ios-surface-in/);
  assert.match(focusCss, /cubic-bezier\(\.22, 1, \.36, 1\)/);
  assert.match(switcher, /layoutId=/);
  assert.match(switcher, /whileTap=\{\{ scale: 0\.965 \}\}/);
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
