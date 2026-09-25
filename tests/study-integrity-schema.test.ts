import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prismaSchema = await readFile(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../prisma/migrations/20260925100000_study_integrity_signals/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Prompt 18 adds only the two canonical integrity models", () => {
  assert.equal((prismaSchema.match(/^model IntegritySignal \{/gmu) ?? []).length, 1);
  assert.equal(
    (prismaSchema.match(/^model IntegrityReviewAction \{/gmu) ?? []).length,
    1,
  );
  assert.match(prismaSchema, /model IntegritySignal \{[\s\S]*?@@unique\(\[userId, signalFingerprint, dedupBucket, generation\]\)/u);
  assert.match(prismaSchema, /model IntegrityReviewAction \{[\s\S]*?reviewer User\?/u);
});

test("Prompt 18 PostgreSQL migration is additive and enforces safe workflow values", () => {
  assert.equal((migration.match(/^CREATE TABLE /gmu) ?? []).length, 2);
  assert.doesNotMatch(
    migration,
    /\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/iu,
  );
  assert.match(migration, /"IntegritySignal_status_check"/u);
  assert.match(migration, /"IntegritySignal_severity_check"/u);
  assert.match(migration, /"IntegritySignal_safeDetails_size_check"/u);
  assert.match(migration, /"IntegrityReviewAction_actionType_check"/u);
  assert.match(
    migration,
    /"IntegritySignal"\("userId", "signalFingerprint", "dedupBucket", "generation"\)/u,
  );
});