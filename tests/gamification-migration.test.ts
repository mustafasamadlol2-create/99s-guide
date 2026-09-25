import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260925130000_gamification_rule_sets/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Gamification migration is additive and constrains rule-set status", () => {
  assert.match(migration, /CREATE TABLE "GamificationRuleSet"/u);
  assert.match(migration, /CHECK \("status" IN \('DRAFT', 'ACTIVE', 'RETIRED'\)\)/u);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/iu);
  assert.doesNotMatch(migration, /\bINSERT\s+INTO\b/iu);
});