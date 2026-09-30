import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnavailablePrisma,
  DatabaseUnavailableError,
} from "../server/services/databaseUnavailable.js";

test("unconfigured database operations fail instead of returning mock rows", async () => {
  const client = createUnavailablePrisma();

  await assert.rejects(
    client.user.findUnique({ where: { email: "student@example.edu" } }),
    { name: "DatabaseUnavailableError", code: "DATABASE_UNAVAILABLE" },
  );
  await assert.rejects(
    client.user.create({ data: { email: "student@example.edu" } }),
    { name: "DatabaseUnavailableError", code: "DATABASE_UNAVAILABLE" },
  );
  await assert.rejects(
    client.$transaction(async () => "must not run"),
    { name: "DatabaseUnavailableError", code: "DATABASE_UNAVAILABLE" },
  );
  await assert.rejects(
    client.$queryRaw`SELECT 1`,
    { name: "DatabaseUnavailableError", code: "DATABASE_UNAVAILABLE" },
  );
});

test("the database-unavailable sentinel is not treated as a valid Prisma result", () => {
  assert.equal(new DatabaseUnavailableError().code, "DATABASE_UNAVAILABLE");
});