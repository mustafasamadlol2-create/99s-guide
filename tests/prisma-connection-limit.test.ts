import assert from "node:assert/strict";
import test from "node:test";
import { withDevelopmentPrismaConnectionLimit } from "../server/services/prismaConnectionLimit.js";

test("development bounds the Prisma pool and preserves other PostgreSQL URL options", () => {
  const original =
    "postgresql://example:example@db.example.test:5432/app?sslmode=require&pool_timeout=10&connection_limit=15";

  const adjusted = new URL(withDevelopmentPrismaConnectionLimit(original, "development"));

  assert.equal(adjusted.searchParams.get("connection_limit"), "2");
  assert.equal(adjusted.searchParams.get("sslmode"), "require");
  assert.equal(adjusted.searchParams.get("pool_timeout"), "10");
  assert.equal(adjusted.hostname, "db.example.test");
});

test("production and non-PostgreSQL URLs are unchanged", () => {
  const postgresUrl = "postgresql://example:example@db.example.test:5432/app";
  const otherUrl = "file:./dev.db";

  assert.equal(withDevelopmentPrismaConnectionLimit(postgresUrl, "production"), postgresUrl);
  assert.equal(withDevelopmentPrismaConnectionLimit(postgresUrl, undefined), postgresUrl);
  assert.equal(withDevelopmentPrismaConnectionLimit(otherUrl, "development"), otherUrl);
});

test("development rejects an invalid database URL instead of masking it", () => {
  assert.throws(
    () => withDevelopmentPrismaConnectionLimit("not-a-url", "development"),
    /DATABASE_URL must be a valid URL in development/,
  );
});