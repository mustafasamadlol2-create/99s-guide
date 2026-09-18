import test from "node:test";
import assert from "node:assert/strict";
import { backfillMcqMetadata } from "../server/services/mcqBackfill.js";

function fakePrisma(rows: any[]) {
  let updates = 0;
  return {
    mcq: {
      async findMany(args: any) {
        return rows
          .filter((row) => row.createdAt < args.where.createdAt.lt)
          .map((row) => ({ ...row }));
      },
      async updateMany(args: any) {
        for (const row of rows) {
          if (args.where.id.in.includes(row.id) && row.createdAt < args.where.createdAt.lt) {
            row.sourceType = args.data.sourceType;
            row.difficulty = args.data.difficulty;
            updates += 1;
          }
        }
        return { count: updates };
      },
    },
    get updates() {
      return updates;
    },
  };
}

test("MCQ backfill updates only pre-cutoff rows and is idempotent", async () => {
  const before = new Date("2026-01-01T00:00:00.000Z");
  const rows = [
    { id: "old", sourceType: "ai", difficulty: "Easy", createdAt: new Date("2025-01-01T00:00:00.000Z") },
    { id: "new", sourceType: "PREVIOUS_YEAR", difficulty: "Hard", createdAt: new Date("2026-02-01T00:00:00.000Z") },
  ];
  const prisma = fakePrisma(rows);
  const changed: string[] = [];

  const first = await backfillMcqMetadata(prisma, before, {
    apply: true,
    onChanged: async (row) => { changed.push(row.id); },
  });
  assert.equal(first.scanned, 1);
  assert.equal(first.changed, 1);
  assert.deepEqual(changed, ["old"]);
  assert.equal(rows[0].sourceType, "AI_GENERATED");
  assert.equal(rows[0].difficulty, "Medium");
  assert.equal(rows[1].sourceType, "PREVIOUS_YEAR");

  const second = await backfillMcqMetadata(prisma, before, { apply: true });
  assert.equal(second.changed, 0);
  assert.equal(prisma.updates, 1);
});