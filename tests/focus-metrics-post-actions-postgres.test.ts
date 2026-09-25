import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";
import type { FocusBackendService } from "../server/features/focus/types.js";
import type { StudyDailyMetricProjection } from "../server/features/study-core/projection.js";
import { createFocusRouter } from "../server/routes/focus.js";

const databaseUrl = getPrompt8PostgresGateUrl();
const skipped = databaseUrl ? false : "Set the explicit disposable-schema markers to run.";
const T0 = new Date("2026-09-23T22:00:00.000Z");
const METRIC_NOW = new Date("2026-09-25T22:00:00.000Z");
let prisma: PrismaClient | undefined;
let createFocusService: typeof import("../server/features/focus/service.js").createFocusService;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";
  before(async () => {
    ({ createFocusService } = await import("../server/features/focus/service.js"));
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
  });
  after(async () => prisma?.$disconnect());
}

function service(
  userNow: () => Date,
  overrides: Partial<Parameters<typeof createFocusService>[0]> = {},
): FocusBackendService {
  return createFocusService({
    prisma: db(),
    now: userNow,
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
    d1PlanReadsEnabled: () => false,
    d1MetricReadsEnabled: () => false,
    ...overrides,
  });
}

async function makeUserAndLecture(prefix: string): Promise<{ userId: string; lectureId: string }> {
  const suffix = randomUUID();
  const [user, lecture] = await Promise.all([
    db().user.create({ data: { email: `${prefix}-${suffix}@example.test` } }),
    db().lecture.create({
      data: { name: `${prefix} lecture`, mainSubject: "Verification", trackMode: "test" },
    }),
  ]);
  return { userId: user.id, lectureId: lecture.id };
}

async function cleanup(userIds: string[], lectureIds: string[]): Promise<void> {
  await db().focusQuickNote.deleteMany({ where: { userId: { in: userIds } } });
  await db().studyEvent.deleteMany({ where: { userId: { in: userIds } } });
  await db().studyDailyMetric.deleteMany({ where: { userId: { in: userIds } } });
  await db().focusSession.deleteMany({ where: { userId: { in: userIds } } });
  await db().focusPlan.deleteMany({ where: { userId: { in: userIds } } });
  await db().$executeRaw`
    DELETE FROM "PrivateD1SyncOutbox" WHERE "data"->>'userId' IN (${userIds[0]}, ${userIds[1] ?? ""})
  `;
  await db().user.deleteMany({ where: { id: { in: userIds } } });
  await db().lecture.deleteMany({ where: { id: { in: lectureIds } } });
}

function metricProjection(userId: string, metricDate: string, focusSeconds = 999): StudyDailyMetricProjection {
  const id = randomUUID();
  return {
    id,
    canonicalId: id,
    revision: "1",
    projectionVersion: 1,
    updatedAt: T0.toISOString(),
    deletedAt: null,
    userScope: userId,
    userId,
    metricDate,
    focusSeconds,
    sessionsCompleted: 9,
    mcqAttempts: 0,
    mcqCorrect: 0,
    flashcardReviews: 0,
    recallAttempts: 0,
    recallCorrect: 0,
    lectureCompletions: 0,
    interruptionCount: 4,
  };
}

test("Focus metrics use Baghdad calendar dates, zero-fill, scope safely, and remain read-only", { skip: skipped }, async () => {
  const f = await makeUserAndLecture("prompt12-metrics");
  const other = await makeUserAndLecture("prompt12-metrics-other");
  const focus = service(() => METRIC_NOW);
  try {
    await db().studyDailyMetric.createMany({
      data: [
        {
          userId: f.userId,
          metricDate: new Date("2026-09-26T00:00:00.000Z"),
          focusSeconds: 600,
          sessionsCompleted: 1,
          interruptionCount: 2,
        },
        {
          userId: f.userId,
          metricDate: new Date("2026-09-24T00:00:00.000Z"),
          focusSeconds: 1_200,
          sessionsCompleted: 2,
          interruptionCount: 1,
        },
        {
          userId: f.userId,
          metricDate: new Date("2026-09-01T00:00:00.000Z"),
          focusSeconds: 100,
          sessionsCompleted: 1,
          interruptionCount: 0,
        },
        {
          userId: other.userId,
          metricDate: new Date("2026-09-26T00:00:00.000Z"),
          focusSeconds: 9_999,
          sessionsCompleted: 99,
          interruptionCount: 99,
        },
      ],
    });

    const app = express();
    const requireUser: RequestHandler = (req, _res, next) => {
      (req as express.Request & { user: { id: string } }).user = { id: f.userId };
      next();
    };
    app.use("/api/focus", createFocusRouter({ requireUser, service: focus }));
    const server = app.listen(0);
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const writesBefore = {
      metrics: await db().studyDailyMetric.count({ where: { userId: f.userId } }),
      events: await db().studyEvent.count({ where: { userId: f.userId } }),
      sessions: await db().focusSession.count({ where: { userId: f.userId } }),
      outbox: await db().privateD1SyncOutbox.count({
        where: { data: { path: ["userId"], equals: f.userId } },
      }),
      lectureProgress: await db().lectureProgress.count({ where: { userId: f.userId } }),
      calendar: await db().calendarEvent.count({ where: { userId: f.userId } }),
    };
    try {
      const todayResponse = await fetch(`${baseUrl}/api/focus/metrics?period=today`);
      assert.equal(todayResponse.status, 200);
      const today = await todayResponse.json() as {
        startDate: string;
        endDate: string;
        totals: { focusSeconds: number; sessionsCompleted: number; interruptionCount: number };
        daily: Array<{ date: string }>;
      };
      assert.equal(today.startDate, "2026-09-26");
      assert.equal(today.endDate, "2026-09-26");
      assert.deepEqual(today.totals, { focusSeconds: 600, sessionsCompleted: 1, interruptionCount: 2 });
      assert.equal(today.daily.length, 1);

      const seven = await focus.getMetrics(f.userId, "last7Days");
      assert.equal(seven.startDate, "2026-09-20");
      assert.equal(seven.endDate, "2026-09-26");
      assert.equal(seven.daily.length, 7);
      assert.deepEqual(seven.totals, {
        focusSeconds: 1_800,
        sessionsCompleted: 3,
        interruptionCount: 3,
      });
      assert.deepEqual(seven.daily.find((row) => row.date === "2026-09-25"), {
        date: "2026-09-25",
        focusSeconds: 0,
        sessionsCompleted: 0,
        interruptionCount: 0,
      });

      const month = await focus.getMetrics(f.userId, "month");
      assert.equal(month.startDate, "2026-09-01");
      assert.equal(month.endDate, "2026-09-26");
      assert.equal(month.daily.length, 26);
      assert.deepEqual(month.totals, {
        focusSeconds: 1_900,
        sessionsCompleted: 4,
        interruptionCount: 3,
      });
      assert.deepEqual(await focus.getMetrics(other.userId, "today").then((result) => result.totals), {
        focusSeconds: 9_999,
        sessionsCompleted: 99,
        interruptionCount: 99,
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    assert.deepEqual({
      metrics: await db().studyDailyMetric.count({ where: { userId: f.userId } }),
      events: await db().studyEvent.count({ where: { userId: f.userId } }),
      sessions: await db().focusSession.count({ where: { userId: f.userId } }),
      outbox: await db().privateD1SyncOutbox.count({
        where: { data: { path: ["userId"], equals: f.userId } },
      }),
      lectureProgress: await db().lectureProgress.count({ where: { userId: f.userId } }),
      calendar: await db().calendarEvent.count({ where: { userId: f.userId } }),
    }, writesBefore);
  } finally {
    await cleanup([f.userId, other.userId], [f.lectureId, other.lectureId]);
  }
});

test("metric D1 success and every invalid/unavailable state follow the PostgreSQL fallback", { skip: skipped }, async () => {
  const f = await makeUserAndLecture("prompt12-d1-metrics");
  try {
    await db().studyDailyMetric.create({
      data: {
        userId: f.userId,
        metricDate: new Date("2026-09-26T00:00:00.000Z"),
        focusSeconds: 321,
        sessionsCompleted: 2,
        interruptionCount: 1,
      },
    });
    const expected = { focusSeconds: 321, sessionsCompleted: 2, interruptionCount: 1 };
    const successProjection = metricProjection(f.userId, "2026-09-26", 777);
    let fetchCount = 0;
    const success = service(() => METRIC_NOW, {
      d1MetricReadsEnabled: () => true,
      fetchMetricsFromD1: async (userId, options) => {
        fetchCount += 1;
        assert.equal(userId, f.userId);
        assert.deepEqual(options, { from: "2026-09-26", to: "2026-09-26", limit: 1 });
        return [successProjection];
      },
    });
    assert.deepEqual((await success.getMetrics(f.userId, "today")).totals, {
      focusSeconds: 777,
      sessionsCompleted: 9,
      interruptionCount: 4,
    });
    assert.equal(fetchCount, 1);

    let disabledCalls = 0;
    const disabled = service(() => METRIC_NOW, {
      d1MetricReadsEnabled: () => false,
      fetchMetricsFromD1: async () => {
        disabledCalls += 1;
        throw new Error("disabled projection must not be requested");
      },
    });
    assert.deepEqual((await disabled.getMetrics(f.userId, "today")).totals, expected);
    assert.equal(disabledCalls, 0);

    const unavailable = service(() => METRIC_NOW, {
      d1MetricReadsEnabled: () => true,
      fetchMetricsFromD1: async () => { throw new Error("worker unavailable"); },
    });
    assert.deepEqual((await unavailable.getMetrics(f.userId, "today")).totals, expected);

    const malformed = service(() => METRIC_NOW, {
      d1MetricReadsEnabled: () => true,
      fetchMetricsFromD1: async () => [{
        ...successProjection,
        canonicalId: randomUUID(),
      }],
    });
    assert.deepEqual((await malformed.getMetrics(f.userId, "today")).totals, expected);

    const scopeMismatch = service(() => METRIC_NOW, {
      d1MetricReadsEnabled: () => true,
      fetchMetricsFromD1: async () => [{
        ...successProjection,
        userId: randomUUID(),
      }],
    });
    assert.deepEqual((await scopeMismatch.getMetrics(f.userId, "today")).totals, expected);
  } finally {
    await cleanup([f.userId], [f.lectureId]);
  }
});

test("Post-Focus context is completed-only, separates configuration from availability, and does not write", { skip: skipped }, async () => {
  const f = await makeUserAndLecture("prompt12-post-actions");
  const other = await db().user.create({
    data: { email: `prompt12-post-actions-other-${randomUUID()}@example.test` },
  });
  let clock = new Date(T0);
  const focus = service(() => new Date(clock));
  try {
    await db().mcq.create({
      data: {
        question: "Question",
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctAnswer: "A",
        lectureId: f.lectureId,
      },
    });
    await db().flashcard.create({
      data: { clinicalConcept: "Concept", explanation: "Explanation", lectureId: f.lectureId },
    });
    await db().material.create({
      data: {
        title: "PDF only",
        type: "PDF",
        fileUrlOrLink: "prompt12-pdf",
        lectureId: f.lectureId,
      },
    });
    const plan = await focus.createPlan(f.userId, {
      title: "One planned session",
      timezone: "Asia/Baghdad",
      items: [{
        lectureId: f.lectureId,
        sequence: 1,
        sessionCount: 1,
        focusDurationSeconds: 2_700,
        breakDurationSeconds: 0,
        includeMcq: false,
        includeFlashcards: true,
        includeVideo: true,
      }],
    });
    const active = await focus.startSession(f.userId, {
      planId: plan.id,
      planItemId: plan.items[0].id,
      idempotencyKey: "prompt12-post-active",
      source: "web",
    });
    await assert.rejects(focus.getPostFocusActionContext(f.userId, active.session.id), {
      code: "INVALID_SESSION_STATE",
    });
    clock = new Date(T0.getTime() + 120_000);
    await focus.pauseSession(f.userId, active.session.id, {
      idempotencyKey: "prompt12-post-pause",
      source: "web",
    });
    await assert.rejects(focus.getPostFocusActionContext(f.userId, active.session.id), {
      code: "INVALID_SESSION_STATE",
    });
    await focus.abandonSession(f.userId, active.session.id, {
      idempotencyKey: "prompt12-post-abandon",
    });
    await assert.rejects(focus.getPostFocusActionContext(f.userId, active.session.id), {
      code: "INVALID_SESSION_STATE",
    });

    clock = new Date(T0.getTime() + 600_000);
    const completed = await focus.startSession(f.userId, {
      planId: plan.id,
      planItemId: plan.items[0].id,
      idempotencyKey: "prompt12-post-complete",
      source: "web",
    });
    clock = new Date(T0.getTime() + 600_000 + 2_750_000);
    await focus.completeSession(f.userId, completed.session.id, {
      idempotencyKey: "prompt12-post-complete-event",
    });

    const beforeRead = {
      events: await db().studyEvent.count({ where: { userId: f.userId } }),
      metrics: await db().studyDailyMetric.count({ where: { userId: f.userId } }),
      sessions: await db().focusSession.count({ where: { userId: f.userId } }),
      progress: await db().lectureProgress.count({ where: { userId: f.userId } }),
      calendar: await db().calendarEvent.count({ where: { userId: f.userId } }),
      outbox: await db().privateD1SyncOutbox.count({
        where: { data: { path: ["userId"], equals: f.userId } },
      }),
    };
    const context = await focus.getPostFocusActionContext(f.userId, completed.session.id);
    assert.equal(context.sessionNumber, 1);
    assert.equal(context.plannedSessionCount, 1);
    assert.equal(context.isLastPlannedSession, true);
    assert.equal(context.manualLectureCompletionRequired, true);
    assert.deepEqual(context.configured, { mcq: false, flashcards: true, video: true });
    assert.deepEqual(context.available, { mcq: true, flashcards: true, video: false });
    await assert.rejects(
      focus.getPostFocusActionContext(other.id, completed.session.id),
      { code: "SESSION_NOT_FOUND" },
    );
    assert.deepEqual({
      events: await db().studyEvent.count({ where: { userId: f.userId } }),
      metrics: await db().studyDailyMetric.count({ where: { userId: f.userId } }),
      sessions: await db().focusSession.count({ where: { userId: f.userId } }),
      progress: await db().lectureProgress.count({ where: { userId: f.userId } }),
      calendar: await db().calendarEvent.count({ where: { userId: f.userId } }),
      outbox: await db().privateD1SyncOutbox.count({
        where: { data: { path: ["userId"], equals: f.userId } },
      }),
    }, beforeRead);
  } finally {
    await cleanup([f.userId, other.id], [f.lectureId]);
  }
});