import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schemas = read('server/features/focus/schemas.ts');
const service = read('server/features/focus/service.ts');
const api = read('src/features/focus/api/focusApi.ts');
const startup = read('scripts/start-production.cjs');
const pkg = JSON.parse(read('package.json'));

test('lecture IDs use bounded opaque DB identifiers instead of a UUID-only gate', () => {
  assert.match(schemas, /const opaqueDatabaseId = z\.string\(\)/u);
  assert.match(schemas, /lectureId:\s*opaqueDatabaseId,/u);
  assert.doesNotMatch(schemas, /lectureId:\s*uuid,/u);
  assert.match(api, /opaqueIdentifierField\(item\.lectureId, "lecture ID"\)/u);
});

test('Focus plan canonical write is not rolled back by a D1 projection enqueue failure', () => {
  assert.match(service, /enqueuePlanProjectionBestEffort/u);
  assert.match(service, /D1 is a projection\/cache/u);
  assert.doesNotMatch(service, /await enqueuePlanProjection\(tx, created\)/u);
  assert.doesNotMatch(service, /await enqueuePlanProjection\(tx, result\)/u);
  assert.doesNotMatch(service, /await enqueuePlanProjection\(tx, updated\)/u);
  assert.match(service, /await enqueuePlanProjectionBestEffort\(repository\.database, plan\)/u);
  assert.match(service, /await enqueuePlanProjectionBestEffort\(repository\.database, updated\)/u);
  assert.match(service, /await enqueuePlanProjectionBestEffort\(repository\.database, archived\)/u);
});

test('production regenerates Prisma Client before migration/start and full builds regenerate it too', () => {
  assert.match(startup, /Generating Prisma Client from the deployed schema/u);
  assert.match(startup, /\[prismaCli, 'generate'\]/u);
  assert.equal(pkg.scripts.prebuild, 'prisma generate');
});

test('legacy/non-UUID academic identifiers are accepted throughout Focus response parsing', () => {
  assert.match(api, /opaqueIdentifierField\(lecture\.id, "lecture\.id"\)/u);
  assert.match(api, /opaqueIdentifierField\(entry\.resourceId, "resourceId"\)/u);
  assert.match(api, /opaqueIdentifierField\(nextAction\.lectureId, "nextAction\.lectureId"\)/u);
});
