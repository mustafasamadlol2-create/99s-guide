import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261018220000_focus_plan_resource_selections/migration.sql');
const focusSchemas = read('server/features/focus/schemas.ts');
const focusService = read('server/features/focus/service.ts');
const projection = read('server/features/study-core/projection.ts');
const model = read('src/features/focus/focusHubModel.ts');
const hub = read('src/features/focus/components/FocusHub.tsx');
const api = read('src/features/focus/api/focusApi.ts');

const checks = [
  ['database stores exact resource selections as JSON', () => {
    assert.match(schema, /resourceSelections\s+Json\s+@default\("\[\]"\)/u);
    assert.match(migration, /ADD COLUMN "resourceSelections" JSONB NOT NULL DEFAULT '\[\]'::jsonb/u);
  }],
  ['API contract supports all Phase 4 resource types', () => {
    for (const type of ['PDF', 'NOTE', 'MCQ_SET', 'FLASHCARD_SET', 'VIDEO']) {
      assert.match(focusSchemas, new RegExp(`"${type}"`, 'u'));
    }
    assert.match(focusSchemas, /resources:\s*focusPlanResources\.optional\(\)/u);
  }],
  ['planner derives real material IDs and lecture-backed set IDs', () => {
    assert.match(model, /resourceId:\s*material\.id/u);
    assert.match(model, /resourceType:\s*"MCQ_SET"[\s\S]*resourceId:\s*lecture\.id/u);
    assert.match(model, /resourceType:\s*"FLASHCARD_SET"[\s\S]*resourceId:\s*lecture\.id/u);
  }],
  ['notes aliases are normalized for legacy NOTE and NOTES material rows', () => {
    assert.match(model, /type === "NOTES" \? "NOTE" : type/u);
    assert.match(focusService, /materialType === "NOTE" \|\| materialType === "NOTES"/u);
  }],
  ['backend validates material ownership and type before saving', () => {
    assert.match(focusService, /material\.lectureId !== resource\.lectureId/u);
    assert.match(focusService, /RESOURCE_NOT_FOUND/u);
  }],
  ['backend validates MCQ and Flashcard set availability', () => {
    assert.match(focusService, /tx\.mcq\.findMany/u);
    assert.match(focusService, /tx\.flashcard\.findMany/u);
    assert.match(focusService, /selected MCQ set is unavailable/u);
    assert.match(focusService, /selected Flashcard set is unavailable/u);
  }],
  ['backend validates saved selections again when a session starts', () => {
    assert.match(focusService, /selectedResources = normalizePlanResourceSelections\(item\.resourceSelections\)/u);
    assert.match(focusService, /validatePlanResourceSelections\(tx, \[\{/u);
  }],
  ['D1 Focus plan projection carries resource selections', () => {
    assert.match(projection, /resources:\s*Array\.isArray\(item\.resources\)/u);
    assert.match(projection, /resourceId:\s*requiredString\(resource\.resourceId/u);
  }],
  ['client API sends and validates resource selections', () => {
    assert.match(api, /item\.resources = item\.resources\.map\(planResource\)/u);
    assert.match(api, /resources:\s*item\.resources \?\? \[\]/u);
  }],
  ['planner UI supports per-lecture select all, clear, and individual toggles', () => {
    assert.match(hub, /focusHubSelectAllResources/u);
    assert.match(hub, /focusHubClearResources/u);
    assert.match(hub, /toggleLectureResource/u);
    assert.match(hub, /availableResources\.map\(\(resource\)/u);
  }],
  ['planner persists selected resources and derives legacy compatibility flags', () => {
    assert.match(model, /resources,\n\s*\};/u);
    assert.match(model, /deriveLegacyFocusResourceFlags/u);
    assert.match(model, /resources\.some\(\(resource\) => resource\.resourceType === "VIDEO"\)/u);
  }],

  ['legacy imported Material IDs remain valid Focus resource identifiers', () => {
    assert.match(focusSchemas, /const opaqueResourceId = z\.string\(\)/u);
    assert.match(focusSchemas, /resourceId:\s*opaqueResourceId/u);
    assert.doesNotMatch(focusSchemas, /resourceId:\s*uuid,/u);
    assert.match(api, /opaqueIdentifierField\(item\.resourceId, "plan resource ID"\)/u);
  }],
  ['editing a historical active plan forks a fresh plan instead of failing save', () => {
    assert.match(hub, /getApiErrorCode\(error\) !== "PLAN_ITEM_HAS_HISTORY"/u);
    assert.match(hub, /archiveFocusPlan\(latest\.id\)/u);
    assert.match(hub, /createFocusPlan\(\{[\s\S]*focusPlanItemsFromDraft\(draft, false\)/u);
  }],
  ['planner refuses to start a lecture with no selected study resources', () => {
    assert.match(model, /item\.resources\.length > 0/u);
    assert.match(hub, /focusHubChooseAtLeastOneResource/u);
  }],
];

for (const [name, fn] of checks) test(name, fn);
