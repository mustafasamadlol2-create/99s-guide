import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const focusService = read('server/features/focus/service.ts');
const focusApi = read('src/features/focus/api/focusApi.ts');
const achievementRead = read('server/features/gamification/achievementRead.ts');
const gamificationRead = read('server/features/gamification/gamificationRead.ts');
const levelTypes = read('server/features/gamification/levelTypes.ts');

test('Focus plan save/start reads only the stable FocusPlanItem core contract', () => {
  assert.match(focusService, /const FOCUS_PLAN_ITEM_CORE_SELECT = \{/u);
  const coreSelect = focusService.match(/const FOCUS_PLAN_ITEM_CORE_SELECT = \{([\s\S]*?)\} as const;/u)?.[1] ?? '';
  assert.doesNotMatch(coreSelect, /resourceSelections/u);
  assert.match(focusService, /resourceSelections\?: Prisma\.JsonValue/u);
  assert.doesNotMatch(focusService, /include: \{ planItem: true \}/u);
  assert.doesNotMatch(
    focusService,
    /include: \{ items: \{ orderBy: \[\{ sequence: "asc" \}, \{ id: "asc" \}\] \} \}/u,
  );
});

test('Focus planner keeps exact resources outside the critical plan-create payload', () => {
  assert.match(
    focusApi,
    /createFocusPlan: \(input\) => call\([\s\S]*?planBody\(input, false, false\)/u,
  );
  assert.match(
    focusService,
    /\.\.\.\(item\.resources !== undefined[\s\S]*?resourceSelections/u,
  );
});

test('Achievement reads isolate optional metric/history failures instead of failing Engagement', () => {
  assert.match(achievementRead, /metricValueOverrides\?: ReadonlyMap<string, number \| boolean>/u);
  assert.match(achievementRead, /await Promise\.all\(metricIds\.map/u);
  assert.match(achievementRead, /options\?\.metricValueOverrides\?\.get\(metricId\)/u);
  assert.match(achievementRead, /userAchievement\.findMany\([\s\S]*?\.catch\(\(error\) =>/u);
  assert.match(achievementRead, /continuing without history/u);
});

test('Overview reuses its Points read and degrades only the achievement section when needed', () => {
  assert.match(gamificationRead, /metricValueOverrides: pointMetricOverrides\(points\)/u);
  assert.match(gamificationRead, /Achievement section degraded during Overview read/u);
  assert.match(gamificationRead, /legacyLedgerPoints: points\.legacyLedgerPoints/u);
  assert.match(levelTypes, /legacyLedgerPoints: number/u);
});
