import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Group Focus production API requests use the shared authenticated API client", () => {
  const api = read("src/features/group-focus/api/groupFocusApi.ts");
  assert.match(api, /import \{ apiClient \} from "\.\.\/\.\.\/\.\.\/core\/api\/apiClient\.js"/);
  assert.match(api, /defaultGroupFocusFetcher[\s\S]*apiClient\(input,[\s\S]*bypassCache: true/);
  assert.doesNotMatch(api, /Fetcher\s*=\s*fetch\b/);
  assert.match(api, /\/api\/group-focus\/rooms\/mine/);
  assert.match(api, /\/api\/group-focus\/rooms\/public/);
});

test("Phase 5 supports canonical multi-lecture plans with per-lecture study resources", () => {
  const contract = read("shared/group-focus-study-plan/contract.ts");
  const schema = read("server/features/group-focus/schemas.ts");
  const service = read("server/features/group-focus/service.ts");
  const prisma = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20261020161000_group_focus_multi_lecture_plans/migration.sql");
  const route = read("server/routes/groupFocus.ts");

  assert.match(contract, /GroupFocusStudyPlanItem/);
  assert.match(contract, /resources:/);
  assert.match(schema, /sharedStudyPlan: groupFocusStudyPlanSchema\.optional\(\)/);
  assert.match(schema, /hostStudyPlan: groupFocusStudyPlanSchema\.optional\(\)/);
  assert.match(schema, /studyPlan: groupFocusStudyPlanSchema/);
  assert.match(service, /validateStudyPlan/);
  assert.match(service, /updateMyStudyPlan/);
  assert.match(prisma, /sharedStudyPlan\s+Json\?/);
  assert.match(prisma, /studyPlan\s+Json\?/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "sharedStudyPlan" JSONB/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "studyPlan" JSONB/);
  assert.match(route, /router\.put\("\/rooms\/:roomId\/me\/study-plan"/);
});

test("Group Focus setup uses the Focus lecture picker and native-style steppers instead of browser controls", () => {
  const createJoin = read("src/features/group-focus/ui/GroupFocusCreateJoin.tsx");
  const editor = read("src/features/group-focus/ui/GroupFocusStudyPlanEditor.tsx");

  assert.match(createJoin, /function NativeStepper/);
  assert.match(createJoin, /<Minus/);
  assert.match(createJoin, /<Plus/);
  assert.doesNotMatch(createJoin, /type="number"/);
  assert.doesNotMatch(createJoin, /<select\b/);
  assert.match(createJoin, /GroupFocusStudyPlanEditor/);
  assert.match(editor, /FocusLecturePicker/);
  assert.match(editor, /focusResourcesForLecture/);
  assert.match(editor, /Select all|selectAll/);
});

test("Solo and Group Focus share the Focus Hub header language instead of a detached top navigation row", () => {
  const app = read("src/App.tsx");
  const focusHub = read("src/features/focus/components/FocusHub.tsx");
  const switcher = read("src/features/focus/components/FocusModeSwitcher.tsx");

  assert.match(app, /headerAction=\{groupFocusAvailable/);
  assert.match(app, /<FocusHubRouteHeader/);
  assert.match(app, /<FocusModeSwitcher/);
  assert.match(focusHub, /focus-hub-mode-switcher-slot/);
  assert.match(focusHub, /md:absolute md:right-6 md:top-5/);
  assert.match(switcher, /Solo Focus/);
  assert.match(switcher, /Group Focus/);
});

test("Group Focus surfaces use the approved blue Focus Hub visual family and no legacy green webpage shell", () => {
  const shell = read("src/features/group-focus/ui/groupFocusUi.tsx");
  const home = read("src/features/group-focus/ui/GroupFocusHome.tsx");
  const room = read("src/features/group-focus/ui/GroupFocusRoom.tsx");

  assert.match(shell, /bg-transparent/);
  assert.match(home, /from-white\/88 via-sky-50\/50 to-indigo-50\/55/);
  assert.match(home, /backdrop-blur-xl/);
  assert.match(room, /bg-\[#eef6ff\]/);
  assert.doesNotMatch(`${shell}\n${home}\n${room}`, /#f3f5f1|#2f4a43/);
});

test("Room plan displays the saved per-lecture resources, not only a single lecture", () => {
  const room = read("src/features/group-focus/ui/GroupFocusRoom.tsx");
  assert.match(room, /visibleStudyPlan\.map/);
  assert.match(room, /item\.resources\.map/);
  assert.match(room, /studyResourceLabel/);
  assert.match(room, /StudyResourceIcon/);
});
