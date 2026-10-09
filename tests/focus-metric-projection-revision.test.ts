import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20261009100000_focus_metric_projection_revision/migration.sql", import.meta.url),
  "utf8",
);
const metricModel = schema.match(/model StudyDailyMetric \{[\s\S]*?\n\}/u)?.[0] ?? "";

test("canonical daily metrics persist their latest D1 projection revision", () => {
  assert.match(metricModel, /projectionRevision\s+BigInt\s+@default\(0\)/u);
  assert.match(migration, /ADD COLUMN "projectionRevision" BIGINT NOT NULL DEFAULT 0/u);
  assert.match(migration, /MAX\(outbox\."revision"\)/u);
  assert.match(migration, /outbox\."data"->>'id' = metric\."id"/u);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/iu);
});
