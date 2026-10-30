import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare-content-api/src/index";

const contentWorker = (worker as any).default ?? (worker as any);

function testEnv() {
  const writes: unknown[][] = [];
  return {
    writes,
    env: {
      CONTENT_SYNC_SECRET: "test-secret",
      FILES: { async list() { return { objects: [] }; } },
      DB: {
        prepare(sql: string) {
          const statement: any = {
            bind(...values: unknown[]) {
              writes.push(values);
              return statement;
            },
            async run() { return { success: true }; },
            async first() {
              if (sql.includes("COUNT(*)")) return { count: 0 };
              if (sql.includes("SELECT 1 AS ok")) return { ok: 1 };
              if (sql.includes('FROM "Material"')) {
                return {
                  id: "material-1",
                  title: "Lecture PDF",
                  type: "PDF",
                  fileUrlOrLink: "/api/materials/pdf/material-1",
                  lectureId: "lecture-1",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  storagePath: "materials/lecture-1/material-1.pdf",
                };
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM "DailyMotto"')) {
                return {
                  results: [{
                    id: "motto-1",
                    message: "Keep moving.",
                    isActive: 1,
                    isFeatured: 0,
                    createdBy: null,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  }],
                };
              }
              return { results: [] };
            },
          };
          return statement;
        },
      },
    },
  };
}

test("Phase 1 internal content reads require the shared secret", async () => {
  const { env } = testEnv();
  const response = await contentWorker.fetch(
    new Request("https://worker.test/internal/content-read/mottos/active"),
    env,
  );
  assert.equal(response.status, 401);
});

test("Phase 1 active motto read is served from D1 and normalizes booleans", async () => {
  const { env } = testEnv();
  const response = await contentWorker.fetch(
    new Request("https://worker.test/internal/content-read/mottos/active", {
      headers: { "X-Content-Sync-Secret": "test-secret" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.equal(payload.mottos.length, 1);
  assert.equal(payload.mottos[0].isActive, true);
  assert.equal(payload.mottos[0].isFeatured, false);
});

test("Phase 1 batch sync accepts multiple canonical upserts", async () => {
  const { env, writes } = testEnv();
  const response = await contentWorker.fetch(
    new Request("https://worker.test/internal/content-sync/batch", {
      method: "POST",
      headers: {
        "X-Content-Sync-Secret": "test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mutations: [
          {
            version: 1,
            entity: "Lecture",
            operation: "upsert",
            id: "lecture-1",
            data: {
              id: "lecture-1",
              name: "Lecture 1",
              mainSubject: "Subject",
              subSubject: null,
              trackMode: "THEORY",
              department: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          },
          {
            version: 1,
            entity: "Flashcard",
            operation: "upsert",
            id: "flashcard-1",
            data: {
              id: "flashcard-1",
              clinicalConcept: "Concept",
              explanation: "Explanation",
              lectureId: "lecture-1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          },
        ],
      }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.equal(payload.applied, 2);
  assert.equal(writes.length, 2);
});


test("Phase 2 material detail read returns R2 metadata from D1", async () => {
  const { env } = testEnv();
  const response = await contentWorker.fetch(
    new Request("https://worker.test/internal/content-read/material/material-1", {
      headers: { "X-Content-Sync-Secret": "test-secret" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.equal(payload.material.id, "material-1");
  assert.equal(payload.material.storagePath, "materials/lecture-1/material-1.pdf");
});
