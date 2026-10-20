import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const picker = fs.readFileSync("src/features/focus/components/FocusLecturePicker.tsx", "utf8");
const css = fs.readFileSync("src/features/focus/components/focus-hub-approved.css", "utf8");

test("lecture picker is portaled to document.body so underlying Group Focus controls cannot paint above it", () => {
  assert.match(picker, /import \{ createPortal \} from "react-dom"/);
  assert.match(picker, /return createPortal\(/);
  assert.match(picker, /document\.body/);
});

test("lecture picker owns a top-level isolated stacking layer", () => {
  assert.match(css, /\.focus-lecture-picker-overlay\s*\{[\s\S]*?z-index:\s*2147483000\s*!important/);
  assert.match(css, /\.focus-lecture-picker-overlay\s*\{[\s\S]*?isolation:\s*isolate/);
  assert.match(css, /\.focus-lecture-picker-sheet\s*\{[\s\S]*?z-index:\s*1/);
});

test("overlay sufficiently suppresses the steppers underneath the sheet", () => {
  assert.match(picker, /bg-slate-700\/\[0\.28\]/);
  assert.match(picker, /backdrop-blur-\[7px\]/);
});
