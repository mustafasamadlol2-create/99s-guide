import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";
import type { PrismaClient } from "@prisma/client";
import type { FocusBackendService, FocusPlanDto } from "../server/features/focus/types.js";
import type { FocusPlanReadProjection } from "../server/services/privateD1Read.js";

const databaseUrl = getPrompt8PostgresGateUrl();
const skipped = databaseUrl ? false : "Set the explicit Prompt 8 disposable-schema test markers to run.";
const T0 = new Date("2026-09-24T06:00:00.000Z");

type Fixture = {
  userId: string;
  otherUserId: string;
  lectureId: string;
  otherLectureId: string;
};

let prisma: PrismaClient | undefined;
let serviceFactory: typeof import("../server/features/focus/service.js").createFocusService;

function client(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

function makeService(
  now: () => Date,
  overrides: Partial<Parameters<typeof serviceFactory>[0]> = {},
): FocusBackendService {
  return serviceFactory({
    prisma: client(),
    now,
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
    d1PlanReadsEnabled: () => false,
    ...overrides,
  });
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const [user, otherUser, lecture, otherLecture] = await Promise.all([
    client().user.create({ data: { email: `prompt9-${suffix}@example.test` } }),
    client().user.create({ data: { email: `prompt9-other-${suffix}@example.test` } }),
    client().lecture.create({
      data: { name: "Prompt 9 Focus fixture", mainSubject: "Verification", trackMode: "test" },
    }),
    client().lecture.create({
      data: { name: "Prompt 9 second Lecture", mainSubject: "Verification", trackMode: "test" },
    }),
  ]);
  return {
    userId: user.id,
    otherUserId: otherUser.id,
    lectureId: lecture.id,
    otherLectureId: otherLecture.id,
  };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await client().$executeRaw`
    DELETE FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' IN (${fixture.userId}, ${fixture.otherUserId})
  `;
  await client().studyEvent.deleteMany({
    where: { userId: { in: [fixture.userId, fixture.otherUserId] } },
  });
  await client().focusSession.deleteMany({
    where: { userId: { in: [fixture.userId, fixture.otherUserId] } },
  });
  await client().focusPlan.deleteMany({
    where: { userId: { in: [fixture.userId, fixture.otherUserId] } },
  });
  await client().studyDailyMetric.deleteMany({
    where: { userId: { in: [fixture.userId, fixture.otherUserId] } },
  });
  await client().user.deleteMany({
    where: { id: { in: [fixture.userId, fixture.otherUserId] } },
  });
  await client().lecture.deleteMany({
    where: { id: { in: [fixture.lectureId, fixture.otherLectureId] } },
  });
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

function planInput(fixture: Fixture, sessionCount = 2) {
  return {
    title: "Prompt 9 plan",
    timezone: "Asia/Baghdad",
    items: [{
      lectureId: fixture.lectureId,
      sequence: 1,
      sessionCount,
      focusDurationSeconds: 2_700,
      breakDurationSeconds: 600,
      includeMcq: true,
      includeFlashcards: false,
      includeVideo: true,
    }],
  };
}

async function createPlan(
  focus: FocusBackendService,
  fixture: Fixture,
  sessionCount = 2,
): Promise<FocusPlanDto> {
  return focus.createPlan(fixture.userId, planInput(fixture, sessionCount));
}

function startInput(plan: FocusPlanDto, idempotencyKey: string, source = "web" as const) {
  return {
    planId: plan.id,
    planItemId: plan.items[0].id,
    idempotencyKey,
    source,
  };
}

async function outboxRows(userId: string): Promise<Array<{
  entity: string;
  key: Record<string, unknown>;
  data: Record<string, unknown>;
}>> {
  return client().$queryRaw`
    SELECT "entity", "key", "data"
    FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' = ${userId}
    ORDER BY "id"::bigint ASC
  `;
}

async function counts(userId: string) {
  const [sessions, events, metrics, rows] = await Promise.all([
    client().focusSession.count({ where: { userId } }),
    client().studyEvent.count({ where: { userId } }),
    client().studyDailyMetric.count({ where: { userId } }),
    outboxRows(userId),
  ]);
  return { sessions, events, metrics, outbox: rows.length };
}

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";
  process.env.FOCUS_HUB_ENABLED = "true";

  before(async () => {
    const { getPrisma } = await import("../server/services/prismaClient.js");
    const focusModule = await import("../server/features/focus/service.js");
    prisma = getPrisma() as PrismaClient;
    serviceFactory = focusModule.createFocusService;
    await prisma.$connect();
  });

  after(async () => {
    await prisma?.$disconnect();
  });
}

test("real PostgreSQL plan persistence, history protection, D1 reads and fallback", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const focus = makeService(() => T0);
    const plan = await createPlan(focus, fixture);
    const initialRows = await outboxRows(fixture.userId);
    assert.equal(initialRows.length, 1);
    assert.equal(initialRows[0].entity, "FocusPlan");
    assert.deepEqual(initialRows[0].key, { id: plan.id });

    let scopedUserId: string | null = null;
    const d1Service = makeService(() => T0, {
      d1PlanReadsEnabled: () => true,
      fetchPlansFromD1: async (userId) => {
        scopedUserId = userId;
        return [{
          id: plan.id,
          canonicalId: plan.id,
          projectionVersion: 1,
          revision: "77",
          updatedAt: plan.updatedAt,
          deletedAt: null,
          userScope: fixture.userId,
          userId: fixture.userId,
          title: "Validated D1 snapshot",
          status: "ACTIVE",
          timezone: plan.timezone,
          planVersion: plan.planVersion,
          createdAt: plan.createdAt,
          archivedAt: null,
          items: plan.items,
        } satisfies FocusPlanReadProjection];
      },
    });
    assert.equal((await d1Service.getPlan(fixture.userId, plan.id)).title, "Validated D1 snapshot");
    assert.equal(scopedUserId, fixture.userId);

    const fallbackService = makeService(() => T0, {
      d1PlanReadsEnabled: () => true,
      fetchPlansFromD1: async () => {
        throw new Error("simulated malformed or unavailable D1 projection");
      },
    });
    assert.equal((await fallbackService.getPlan(fixture.userId, plan.id)).title, plan.title);

    const started = await focus.startSession(
      fixture.userId,
      startInput(plan, "prompt9-plan-history-start"),
    );
    await assert.rejects(
      focus.updatePlan(fixture.userId, plan.id, {
        items: [{
          ...plan.items[0],
          sequence: 1,
        }],
      }),
      { code: "PLAN_HAS_ACTIVE_SESSION" },
    );

    const abandoned = await focus.abandonSession(fixture.userId, started.session.id, {
      idempotencyKey: "prompt9-plan-history-abandon",
      reason: "test",
    });
    assert.equal(abandoned.session.status, "ABANDONED");
    await assert.rejects(
      focus.updatePlan(fixture.userId, plan.id, { items: [] } as never),
      { code: "INVALID_REQUEST" },
    );
    await assert.rejects(
      focus.updatePlan(fixture.userId, plan.id, {
        items: [{
          ...plan.items[0],
          id: undefined,
          lectureId: fixture.otherLectureId,
        }],
      }),
      { code: "PLAN_ITEM_HAS_HISTORY" },
    );

    const renamed = await focus.updatePlan(fixture.userId, plan.id, { title: "Retitled plan" });
    assert.equal(renamed.title, "Retitled plan");
    const archived = await focus.archivePlan(fixture.userId, plan.id);
    assert.equal(archived.status, "ARCHIVED");
    assert.ok(archived.archivedAt);
    assert.equal((await outboxRows(fixture.userId)).filter((row) => row.entity === "FocusPlan").length, 3);
    assert.equal((await client().lectureProgress.count({ where: { lectureId: fixture.lectureId } })), 0);
  });
});

test("real PostgreSQL serializes concurrent starts and enforces start idempotency", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const focus = makeService(() => T0);
    const plan = await createPlan(focus, fixture, 5);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        focus.startSession(fixture.userId, startInput(plan, `prompt9-race-${index}-key`)),
      ),
    );
    const fulfilled = outcomes.filter((result) => result.status === "fulfilled");
    const rejected = outcomes.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 11);
    assert.ok(rejected.every((result) =>
      result.status === "rejected" && result.reason?.code === "ACTIVE_SESSION_EXISTS",
    ));
    assert.deepEqual(await counts(fixture.userId), {
      sessions: 1,
      events: 1,
      metrics: 0,
      outbox: 2,
    });

    await withFixture(async (sameKeyFixture) => {
      const sameKeyFocus = makeService(() => T0);
      const sameKeyPlan = await createPlan(sameKeyFocus, sameKeyFixture, 5);
      const input = startInput(sameKeyPlan, "prompt9-same-start-key");
      const sameKeyResults = await Promise.all(
        Array.from({ length: 8 }, () => sameKeyFocus.startSession(sameKeyFixture.userId, input)),
      );
      assert.equal(new Set(sameKeyResults.map((result) => result.session.id)).size, 1);
      assert.equal(sameKeyResults.filter((result) => result.idempotency === "FIRST_SEEN").length, 1);
      assert.equal(sameKeyResults.filter((result) => result.idempotency === "REPLAY_SAME_PAYLOAD").length, 7);
      await assert.rejects(
        sameKeyFocus.startSession(sameKeyFixture.userId, {
          ...input,
          planItemId: randomUUID(),
        }),
        { code: "IDEMPOTENCY_CONFLICT" },
      );
      assert.deepEqual(await counts(sameKeyFixture.userId), {
        sessions: 1,
        events: 1,
        metrics: 0,
        outbox: 2,
      });
    });
  });
});

test("real PostgreSQL pause/resume recovers persisted timer math across service instances", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    let clock = new Date(T0);
    const firstProcess = makeService(() => new Date(clock));
    const plan = await createPlan(firstProcess, fixture);
    const started = await firstProcess.startSession(
      fixture.userId,
      startInput(plan, "prompt9-timer-start-key"),
    );

    clock = new Date(T0.getTime() + 10 * 60_000);
    const paused = await firstProcess.pauseSession(fixture.userId, started.session.id, {
      idempotencyKey: "prompt9-timer-pause-key",
      source: "web",
    });
    assert.equal(paused.session.status, "PAUSED");
    assert.equal(paused.session.activeSeconds, 600);

    clock = new Date(T0.getTime() + 40 * 60_000);
    const restartedProcess = makeService(() => new Date(clock));
    const currentWhilePaused = await restartedProcess.currentSession(fixture.userId);
    assert.equal(currentWhilePaused.session?.remainingSeconds, 2_100);
    assert.equal(currentWhilePaused.session?.activeSeconds, 600);

    const resumed = await restartedProcess.resumeSession(fixture.userId, started.session.id, {
      idempotencyKey: "prompt9-timer-resume-key",
      source: "web",
    });
    assert.equal(resumed.session.status, "ACTIVE");
    assert.equal(resumed.session.pauseSeconds, 1_800);
    assert.equal(resumed.session.remainingSeconds, 2_100);
    assert.equal(resumed.session.plannedEndAt, new Date(T0.getTime() + 75 * 60_000).toISOString());

    const stored = await client().focusSession.findUnique({ where: { id: started.session.id } });
    assert.equal(stored?.activeSeconds, 600);
    assert.equal(stored?.pauseSeconds, 1_800);
    assert.equal(stored?.status, "ACTIVE");
    assert.deepEqual(await counts(fixture.userId), {
      sessions: 1,
      events: 3,
      metrics: 0,
      outbox: 4,
    });
  });
});

test("real PostgreSQL completion is atomic, capped, idempotent and updates metrics once", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    let clock = new Date(T0);
    const focus = makeService(() => new Date(clock));
    const plan = await createPlan(focus, fixture, 1);
    const started = await focus.startSession(
      fixture.userId,
      startInput(plan, "prompt9-complete-start-key"),
    );

    clock = new Date(T0.getTime() + 44 * 60_000 + 57_000);
    await assert.rejects(
      focus.completeSession(fixture.userId, started.session.id, {
        idempotencyKey: "prompt9-complete-operation-key",
      }),
      { code: "SESSION_NOT_READY_TO_COMPLETE" },
    );
    assert.equal((await client().focusSession.findUnique({ where: { id: started.session.id } }))?.status, "ACTIVE");
    assert.equal(await client().studyEvent.count({ where: { userId: fixture.userId } }), 1);

    clock = new Date(T0.getTime() + 2 * 60 * 60_000);
    const completed = await focus.completeSession(fixture.userId, started.session.id, {
      idempotencyKey: "prompt9-complete-operation-key",
    });
    const replay = await focus.completeSession(fixture.userId, started.session.id, {
      idempotencyKey: "prompt9-complete-operation-key",
    });
    assert.equal(completed.session.status, "COMPLETED");
    assert.equal(completed.session.activeSeconds, 2_700);
    assert.equal(completed.manualLectureCompletionRequired, true);
    assert.deepEqual(completed.followUpPreferences, {
      includeMcq: true,
      includeFlashcards: false,
      includeVideo: true,
    });
    assert.equal(replay.idempotency, "REPLAY_SAME_PAYLOAD");
    assert.equal(replay.session.id, completed.session.id);

    const eventRows = await client().studyEvent.findMany({
      where: { userId: fixture.userId },
      orderBy: { occurredAt: "asc" },
    });
    const metric = await client().studyDailyMetric.findFirst({ where: { userId: fixture.userId } });
    assert.deepEqual(eventRows.map((event) => event.eventType).sort(), [
      "focus_session_completed",
      "focus_session_started",
    ]);
    assert.equal(metric?.focusSeconds, 2_700);
    assert.equal(metric?.sessionsCompleted, 1);
    assert.equal(await client().lectureProgress.count({ where: { lectureId: fixture.lectureId } }), 0);
    const projections = await outboxRows(fixture.userId);
    assert.equal(projections.filter((row) => row.entity === "FocusSession").length, 2);
    assert.equal(projections.filter((row) => row.entity === "StudyDailyMetric").length, 1);
    assert.deepEqual(await counts(fixture.userId), {
      sessions: 1,
      events: 2,
      metrics: 1,
      outbox: 4,
    });
  });
});

test("real PostgreSQL rolls back completion state, Study Event, metric and projections on Focus outbox failure", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    let clock = new Date(T0);
    const focus = makeService(() => new Date(clock));
    const plan = await createPlan(focus, fixture, 1);
    const started = await focus.startSession(
      fixture.userId,
      startInput(plan, "prompt9-rollback-start-key"),
    );
    await client().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "prompt9_fail_focus_session_projection"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."entity" = 'FocusSession' THEN
          RAISE EXCEPTION 'prompt9 isolated Focus projection failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client().$executeRawUnsafe(`
      CREATE TRIGGER "prompt9_fail_focus_session_projection"
      BEFORE INSERT ON "PrivateD1SyncOutbox"
      FOR EACH ROW EXECUTE FUNCTION "prompt9_fail_focus_session_projection"()
    `);
    try {
      clock = new Date(T0.getTime() + 50 * 60_000);
      await assert.rejects(
        focus.completeSession(fixture.userId, started.session.id, {
          idempotencyKey: "prompt9-rollback-completion-key",
        }),
        { code: "OUTBOX_FAILURE" },
      );
    } finally {
      await client().$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS "prompt9_fail_focus_session_projection" ON "PrivateD1SyncOutbox"',
      );
      await client().$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS "prompt9_fail_focus_session_projection"()',
      );
    }

    const stored = await client().focusSession.findUnique({ where: { id: started.session.id } });
    const metric = await client().studyDailyMetric.findFirst({ where: { userId: fixture.userId } });
    assert.equal(stored?.status, "ACTIVE");
    assert.equal(await client().studyEvent.count({ where: { userId: fixture.userId } }), 1);
    assert.equal(metric, null);
    assert.deepEqual(await counts(fixture.userId), {
      sessions: 1,
      events: 1,
      metrics: 0,
      outbox: 2,
    });
  });
});

test("real PostgreSQL serializes the final planned-session edge", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    let clock = new Date(T0);
    const focus = makeService(() => new Date(clock));
    const plan = await createPlan(focus, fixture, 2);
    const first = await focus.startSession(
      fixture.userId,
      startInput(plan, "prompt9-count-first-start"),
    );
    clock = new Date(T0.getTime() + 50 * 60_000);
    await focus.completeSession(fixture.userId, first.session.id, {
      idempotencyKey: "prompt9-count-first-complete",
    });

    const attempts = await Promise.allSettled([
      focus.startSession(fixture.userId, startInput(plan, "prompt9-count-final-a")),
      focus.startSession(fixture.userId, startInput(plan, "prompt9-count-final-b")),
    ]);
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = attempts.find((item) => item.status === "rejected");
    assert.equal((rejected as PromiseRejectedResult).reason?.code, "ACTIVE_SESSION_EXISTS");
    const second = (attempts.find((item) => item.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<FocusBackendService["startSession"]>>
    >).value;
    assert.equal(second.session.sessionNumber, 2);
    assert.equal(second.session.isLastPlannedSession, true);

    clock = new Date(clock.getTime() + 50 * 60_000);
    await focus.completeSession(fixture.userId, second.session.id, {
      idempotencyKey: "prompt9-count-final-complete",
    });
    await assert.rejects(
      focus.startSession(fixture.userId, startInput(plan, "prompt9-count-over-limit")),
      { code: "PLANNED_SESSIONS_COMPLETE" },
    );
    assert.equal(await client().focusSession.count({
      where: { userId: fixture.userId, planItemId: plan.items[0].id, status: "COMPLETED" },
    }), 2);
  });
});

test("real PostgreSQL-backed HTTP routes enforce auth, ownership, flags and server timestamps", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const fixedNow = new Date(T0);
    const focus = makeService(() => fixedNow);
    const auth: RequestHandler = (req, res, next) => {
      const id = req.header("x-test-user");
      if (!id) return res.status(401).json({ error: "Authentication required." });
      (req as express.Request & { user: { id: string } }).user = { id };
      return next();
    };
    const app = express();
    app.use(express.json());
    app.use("/api/focus", (await import("../server/routes/focus.js")).createFocusRouter({
      requireUser: auth,
      service: focus,
    }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/api/focus`;
    const request = (path: string, userId?: string, init: RequestInit = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(userId ? { "x-test-user": userId } : {}),
          ...init.headers,
        },
      });
    try {
      assert.equal((await request("/plans")).status, 401);
      const invalidUserBody = await request("/plans", fixture.userId, {
        method: "POST",
        body: JSON.stringify({ ...planInput(fixture), userId: fixture.otherUserId }),
      });
      assert.equal(invalidUserBody.status, 400);

      const createdResponse = await request("/plans", fixture.userId, {
        method: "POST",
        body: JSON.stringify(planInput(fixture, 1)),
      });
      assert.equal(createdResponse.status, 201);
      const created = await createdResponse.json() as { plan: FocusPlanDto };
      assert.equal(created.plan.title, "Prompt 9 plan");
      assert.ok(created.plan.items[0].id);
      assert.equal((await request(`/plans/${created.plan.id}`, fixture.otherUserId)).status, 404);
      assert.equal((await request(`/plans/${created.plan.id}`, fixture.userId)).status, 200);

      const forgedTimestamp = await request("/sessions/start", fixture.userId, {
        method: "POST",
        body: JSON.stringify({
          ...startInput(created.plan, "prompt9-http-forged-time"),
          startedAt: "2000-01-01T00:00:00.000Z",
        }),
      });
      assert.equal(forgedTimestamp.status, 400);

      const dependencyDisabled = makeService(() => fixedNow, {
        isStudyEventsEnabled: () => false,
      });
      const dependencyRouterApp = express();
      dependencyRouterApp.use(express.json());
      dependencyRouterApp.use("/api/focus", (await import("../server/routes/focus.js")).createFocusRouter({
        requireUser: auth,
        service: dependencyDisabled,
      }));
      const dependencyServer = dependencyRouterApp.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => dependencyServer.once("listening", resolve));
      const dependencyAddress = dependencyServer.address() as AddressInfo;
      try {
        const response = await fetch(
          `http://127.0.0.1:${dependencyAddress.port}/api/focus/sessions/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-test-user": fixture.userId },
            body: JSON.stringify(startInput(created.plan, "prompt9-http-dependency-off")),
          },
        );
        assert.equal(response.status, 503);
        assert.equal((await response.json() as { code: string }).code, "DEPENDENCY_DISABLED");
      } finally {
        await new Promise<void>((resolve, reject) =>
          dependencyServer.close((error) => error ? reject(error) : resolve()),
        );
      }

      const disabled = makeService(() => fixedNow, { isFocusEnabled: () => false });
      const disabledApp = express();
      disabledApp.use(express.json());
      disabledApp.use("/api/focus", (await import("../server/routes/focus.js")).createFocusRouter({
        requireUser: auth,
        service: disabled,
      }));
      const disabledServer = disabledApp.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => disabledServer.once("listening", resolve));
      const disabledAddress = disabledServer.address() as AddressInfo;
      try {
        const before = await client().focusPlan.count({ where: { userId: fixture.userId } });
        const response = await fetch(`http://127.0.0.1:${disabledAddress.port}/api/focus/plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-test-user": fixture.userId },
          body: JSON.stringify(planInput(fixture)),
        });
        assert.equal(response.status, 404);
        assert.equal((await response.json() as { code: string }).code, "FEATURE_DISABLED");
        assert.equal(await client().focusPlan.count({ where: { userId: fixture.userId } }), before);
      } finally {
        await new Promise<void>((resolve, reject) =>
          disabledServer.close((error) => error ? reject(error) : resolve()),
        );
      }

      const validStart = await request("/sessions/start", fixture.userId, {
        method: "POST",
        body: JSON.stringify(startInput(created.plan, "prompt9-http-valid-start")),
      });
      assert.equal(validStart.status, 201);
      const started = await validStart.json() as { session: { startedAt: string } };
      assert.equal(started.session.startedAt, fixedNow.toISOString());
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    }
  });
});