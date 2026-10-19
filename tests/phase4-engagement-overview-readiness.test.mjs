import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../prisma/migrations/20261019170000_bootstrap_gamification_v1_ruleset/migration.sql', import.meta.url),
  'utf8',
);
const originalRuleSetMigration = fs.readFileSync(
  new URL('../prisma/migrations/20260925130000_gamification_rule_sets/migration.sql', import.meta.url),
  'utf8',
);

test('root cause is covered: the original registry migration never seeded an ACTIVE ruleset', () => {
  assert.match(originalRuleSetMigration, /CREATE TABLE "GamificationRuleSet"/u);
  assert.doesNotMatch(originalRuleSetMigration, /INSERT INTO "GamificationRuleSet"/u);
});

test('production migration bootstraps the exact current gamification-v1 bundle', () => {
  assert.match(migration, /'gamification-v1'/u);
  assert.match(migration, /'ACTIVE'/u);
  assert.match(migration, /388058fb779059f6f9f43defd37389deef1787e74d71eaea4aeba223b159af24/u);
  assert.match(migration, /5bbf8eb146b70cb4de45eeb6ca2adf22bd2e801f205b76034cbf35718dd611e2/u);
  assert.match(migration, /18fb5e8859a5e17706115a0a65e1406c3edc51289786099ca7e4539bac095838/u);
  assert.match(migration, /stored immutable definition checksums do not match/u);
});

test('startup performs the idempotent ruleset bootstrap before accepting traffic', () => {
  assert.match(server, /bootstrapCurrentGamificationRuleSet/u);
  assert.match(server, /await verifyDatabaseHealth\(\);/u);
  assert.match(server, /const bootstrap = await bootstrapCurrentGamificationRuleSet\(client\);/u);
  assert.doesNotMatch(server, /verifyDatabaseHealth\(\)\.then/u);
});
