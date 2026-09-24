import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const outboxMigration = readFileSync(
  new URL("../prisma/migrations/20260924020000_private_d1_sync_outbox/migration.sql", import.meta.url),
  "utf8",
);
const signatureMigration = readFileSync(
  new URL("../prisma/migrations/20260924010000_add_user_signature/migration.sql", import.meta.url),
  "utf8",
);

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, "u"));
  assert.ok(match, `missing Prisma model ${name}`);
  return match[0];
}

test("outbox Prisma model records bounded retry state and the lease index", () => {
  const block = modelBlock("PrivateD1SyncOutbox");
  assert.match(block, /id\s+BigInt\s+@id\s+@default\(autoincrement\(\)\)/u);
  assert.match(block, /entity\s+String\s+@db\.VarChar\(100\)/u);
  assert.match(block, /operation\s+String\s+@db\.VarChar\(16\)/u);
  assert.match(block, /key\s+Json/u);
  assert.match(block, /revision\s+BigInt/u);
  assert.match(block, /data\s+Json\?/u);
  assert.match(block, /attempts\s+Int\s+@default\(0\)/u);
  assert.match(block, /lastError\s+String\?\s+@db\.VarChar\(500\)/u);
  assert.match(block, /nextAttemptAt\s+DateTime\s+@default\(now\(\)\)/u);
  assert.match(block, /updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/u);
  assert.match(block, /@@index\(\[nextAttemptAt, id\]\)/u);
});

test("outbox migration is additive and creates only the required table and index", () => {
  assert.match(outboxMigration, /CREATE TABLE "PrivateD1SyncOutbox"/u);
  assert.match(outboxMigration, /"id" BIGSERIAL/u);
  assert.match(outboxMigration, /"key" JSONB NOT NULL/u);
  assert.match(outboxMigration, /"revision" BIGINT NOT NULL/u);
  assert.match(outboxMigration, /"lastError" VARCHAR\(500\)/u);
  assert.match(outboxMigration, /ON "PrivateD1SyncOutbox"\("nextAttemptAt", "id"\)/u);
  assert.doesNotMatch(outboxMigration, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/iu);
  assert.doesNotMatch(outboxMigration, /\bALTER TABLE\b/iu);
});

test("signature migration repairs fresh-schema history without overwriting existing databases", () => {
  assert.match(signatureMigration, /ALTER TABLE "User"/u);
  assert.match(signatureMigration, /ADD COLUMN IF NOT EXISTS "signature" TEXT DEFAULT ''/u);
  assert.doesNotMatch(signatureMigration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/iu);
});