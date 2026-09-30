const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PROJECT_ROOT || process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('gamification auth is route-scoped and cannot intercept public OAuth', () => {
  const src = read('server/routes/gamification.ts');
  assert.doesNotMatch(src, /router\.use\(dependencies\.requireUser\)/);
  assert.match(src, /router\.get\("\/me\/gamification",\s*dependencies\.requireUser/);
  assert.match(src, /router\.get\("\/users\/:userId\/gamification",\s*dependencies\.requireUser/);
});

test('leaderboard auth is route-scoped and cannot intercept public OAuth', () => {
  const src = read('server/routes/leaderboards.ts');
  const publicRouter = src.slice(0, src.indexOf('export function createAdminLeaderboardRouter'));
  assert.doesNotMatch(publicRouter, /router\.use\(dependencies\.requireUser\)/);
  assert.match(publicRouter, /router\.get\("\/leaderboards\/:scope",\s*dependencies\.requireUser/);
  assert.match(publicRouter, /router\.get\("\/me\/leaderboard-rank",\s*dependencies\.requireUser/);
});

test('outbox schema preserves legacy trigger columns without blocking new writers', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /dedupeKey\s+String\?\s+@unique/);
  assert.match(schema, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(schema, /revision\s+BigInt\s+@default\(1\)/);
});

test('private D1 mirror trigger is fail-open and uses the current monotonic outbox contract', () => {
  const sql = read('prisma/migrations/20261001010000_private_d1_auth_compat/migration.sql');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.private_d1_enqueue_mirror\(\)/);
  assert.match(sql, /EXCEPTION WHEN OTHERS/);
  assert.match(sql, /canonical PostgreSQL is authoritative/i);
  assert.match(sql, /pg_get_serial_sequence\('public\."PrivateD1SyncOutbox"', 'id'\)/);
  assert.match(sql, /allocated_revision/);
});

test('OAuth polling never retries a terminal 502\/503 with the same one-time provider code', () => {
  const src = read('src/features/auth/components/AuthScreen.tsx');
  assert.doesNotMatch(src, /\[404, 429, 502, 503\]/);
  assert.match(src, /\[404, 429\]/);
  assert.match(src, /authorization code is single-use/i);
});
