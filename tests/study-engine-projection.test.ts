import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../cloudflare-private-data-api/src/index";
import {
  buildFocusPlanProjection,
  buildFocusSessionProjection,
  buildStudyDailyMetricProjection,
} from "../server/features/study-core/projection";

const privateWorker = (worker as any).default ?? (worker as any);
const migration = readFileSync(
  new URL(
    "../cloudflare-private-data-api/migrations/0001_study_engine_batch_a_projections.sql",
    import.meta.url,
  ),
  "utf8",
);

function planInput() {
  return {
    plan: {
      id: "plan-1",
      userId: "user-1",
      title: "Morning focus",
      status: "ACTIVE",
      timezone: "Asia/Baghdad",
      planVersion: 1,
      createdAt: "2026-09-24T08:00:00.000Z",
      updatedAt: "2026-09-24T08:10:00.000Z",
      archivedAt: null,
    },
    items: [
      {
        id: "item-2",
        lectureId: "lecture-2",
        sequence: 2,
        sessionCount: 1,
        focusDurationSeconds: 1500,
        breakDurationSeconds: 300,
        includeMcq: false,
        includeFlashcards: true,
        includeVideo: false,
      },
      {
        id: "item-1",
        lectureId: "lecture-1",
        sequence: 1,
        sessionCount: 2,
        focusDurationSeconds: 1800,
        breakDurationSeconds: 300,
        includeMcq: true,
        includeFlashcards: false,
        includeVideo: true,
      },
    ],
    revision: "12",
  } as const;
}

test("Focus Plan projection is bounded, canonical, and sequence ordered", () => {
  const projection = buildFocusPlanProjection(planInput());
  const items = JSON.parse(projection.itemsJson) as Array<Record<string, unknown>>;

  assert.equal(projection.id, "plan-1");
  assert.equal(projection.canonicalId, "plan-1");
  assert.equal(projection.userScope, "user-1");
  assert.deepEqual(items.map((item) => item.sequence), [1, 2]);
  assert.deepEqual(Object.keys(items[0] ?? {}).sort(), [
    "breakDurationSeconds",
    "focusDurationSeconds",
    "id",
    "includeFlashcards",
    "includeMcq",
    "includeVideo",
    "lectureId",
    "sequence",
    "sessionCount",
  ]);
  assert.equal("lectureName" in (items[0] ?? {}), false);
});

test("Focus Session and Daily Metric builders retain summaries only", () => {
  const session = buildFocusSessionProjection({
    session: {
      id: "session-1",
      userId: "user-1",
      planId: "plan-1",
      planItemId: "item-1",
      lectureId: "lecture-1",
      status: "ACTIVE",
      startedAt: "2026-09-24T08:00:00.000Z",
      plannedEndAt: "2026-09-24T08:30:00.000Z",
      actualEndedAt: null,
      lastCheckpointAt: "2026-09-24T08:10:00.000Z",
      activeSeconds: 600,
      pauseSeconds: 0,
      completionReason: null,
      updatedAt: "2026-09-24T08:10:00.000Z",
    },
    revision: 3,
  });
  const metric = buildStudyDailyMetricProjection({
    metric: {
      id: "metric-1",
      userId: "user-1",
      metricDate: "2026-09-24",
      focusSeconds: 600,
      sessionsCompleted: 1,
      mcqAttempts: 2,
      mcqCorrect: 1,
      flashcardReviews: 3,
      recallAttempts: 2,
      recallCorrect: 1,
      lectureCompletions: 1,
      interruptionCount: 0,
      updatedAt: "2026-09-24T08:10:00.000Z",
    },
    revision: "4",
  });

  assert.equal(session.canonicalId, "session-1");
  assert.equal(session.activeSeconds, 600);
  assert.equal("transitions" in session, false);
  assert.equal(metric.metricDate, "2026-09-24");
  assert.equal(metric.mcqCorrect, 1);
  assert.equal(metric.projectionVersion, 1);
});

test("D1 migration creates only the three supported projections", () => {
  assert.deepEqual(
    [...migration.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((match) => match[1]),
    ["FocusPlan", "FocusSession", "StudyDailyMetric"],
  );
  assert.match(migration, /FocusPlan_userScope_status_updatedAt_idx/u);
  assert.match(migration, /FocusSession_userScope_startedAt_idx/u);
  assert.match(migration, /StudyDailyMetric_userScope_metricDate_key/u);
  assert.doesNotMatch(migration, /StudyEvent|study_events|raw_study_events/u);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER TABLE/iu);
});

test("private Worker requires its sync secret and rejects raw Study Events", async () => {
  const noSecret = await privateWorker.fetch(
    new Request("https://worker.test/internal/private-sync", {
      method: "POST",
      body: "{}",
    }),
    { DB: {}, PRIVATE_DATA_SYNC_SECRET: "secret" },
  );
  assert.equal(noSecret.status, 401);

  const unsupported = await privateWorker.fetch(
    new Request("https://worker.test/internal/private-sync", {
      method: "POST",
      headers: {
        "X-Private-Data-Sync-Secret": "secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        entity: "StudyEvent",
        operation: "upsert",
        key: { id: "event-1" },
        revision: "1",
        userScope: "user-1",
        data: { id: "event-1", userId: "user-1" },
      }),
    }),
    { DB: {}, PRIVATE_DATA_SYNC_SECRET: "secret" },
  );
  assert.equal(unsupported.status, 400);

  const missingScope = await privateWorker.fetch(
    new Request("https://worker.test/internal/private-sync", {
      method: "POST",
      headers: {
        "X-Private-Data-Sync-Secret": "secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        entity: "FocusPlan",
        operation: "delete",
        key: { id: "plan-1" },
        revision: "1",
      }),
    }),
    { DB: {}, PRIVATE_DATA_SYNC_SECRET: "secret" },
  );
  assert.equal(missingScope.status, 400);

  const missingUserRead = await privateWorker.fetch(
    new Request("https://worker.test/internal/private-read/focus-plans", {
      headers: { "X-Private-Data-Sync-Secret": "secret" },
    }),
    { DB: {}, PRIVATE_DATA_SYNC_SECRET: "secret" },
  );
  assert.equal(missingUserRead.status, 400);
});

test("private Worker applies newer revisions and ignores stale ones", async () => {
  const rows = new Map<string, Record<string, unknown>>();
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (!sql.startsWith('SELECT * FROM "FocusPlan"')) return null;
              return rows.get(String(values[0])) ?? null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              const match = sql.match(/INSERT INTO "([^"]+)" \(([^)]+)\)/u);
              if (!match) return {};
              const columns = match[2].split(",").map((column) => column.trim().replaceAll('"', ""));
              const row = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]));
              rows.set(String(row.id), row);
              return {};
            },
          };
        },
      };
    },
  };
  const env = { DB: db, PRIVATE_DATA_SYNC_SECRET: "secret" };

  const request = (revision: string, title: string) => new Request(
    "https://worker.test/internal/private-sync",
    {
      method: "POST",
      headers: {
        "X-Private-Data-Sync-Secret": "secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        entity: "FocusPlan",
        operation: "upsert",
        key: { id: "plan-1" },
        revision,
        projectionVersion: 1,
        userScope: "user-1",
        data: {
          ...buildFocusPlanProjection({ ...planInput(), plan: { ...planInput().plan, title } }),
        },
      }),
    },
  );

  assert.equal((await privateWorker.fetch(request("2", "new"), env)).status, 200);
  const writesAfterNew = statements.filter((statement) => statement.startsWith('INSERT INTO "FocusPlan"')).length;
  assert.equal((await privateWorker.fetch(request("1", "stale"), env)).status, 200);
  assert.equal((await privateWorker.fetch(request("2", "new"), env)).status, 200);
  assert.equal(rows.get("plan-1")?.title, "new");
  assert.equal(
    statements.filter((statement) => statement.startsWith('INSERT INTO "FocusPlan"')).length,
    writesAfterNew,
  );
});