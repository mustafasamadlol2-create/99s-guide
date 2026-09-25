import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import express, { type RequestHandler } from "express";

import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";
import type { FocusBackendService } from "../server/features/focus/types.js";
import { createFocusRouter } from "../server/routes/focus.js";

const databaseUrl = getPrompt8PostgresGateUrl();
const skipped = databaseUrl ? false : "Set the explicit disposable-schema markers to run.";
const T0 = new Date("2026-09-24T06:00:00.000Z");
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

async function fixture(now: () => Date): Promise<{
  focus: FocusBackendService;
  userId: string;
  sessionId: string;
  materialId: string;
  otherMaterialId: string;
  lectureId: string;
  otherLectureId: string;
}> {
  const user = await db().user.create({ data: { email: `prompt11-${randomUUID()}@example.test` } });
  const lecture = await db().lecture.create({
    data: { name: "Prompt 11 Lecture", mainSubject: "Verification", trackMode: "test" },
  });
  const otherLecture = await db().lecture.create({
    data: { name: "Prompt 11 Other Lecture", mainSubject: "Verification", trackMode: "test" },
  });
  const material = await db().material.create({
    data: { title: "Prompt 11 PDF", type: "PDF", fileUrlOrLink: "stored-material", lectureId: lecture.id },
  });
  const otherMaterial = await db().material.create({
    data: { title: "Prompt 11 Other PDF", type: "PDF", fileUrlOrLink: "other-material", lectureId: otherLecture.id },
  });
  const focus = createFocusService({
    prisma: db(), now, isFocusEnabled: () => true, isStudyEventsEnabled: () => true,
    d1PlanReadsEnabled: () => false,
  });
  const plan = await focus.createPlan(user.id, {
    title: "Prompt 11 plan", timezone: "Asia/Baghdad",
    items: [{ lectureId: lecture.id, sequence: 1, sessionCount: 1,
      focusDurationSeconds: 2_700, breakDurationSeconds: 0,
      includeMcq: false, includeFlashcards: false, includeVideo: true }],
  });
  const started = await focus.startSession(user.id, {
    planId: plan.id, planItemId: plan.items[0].id,
    idempotencyKey: "prompt11-session-start", source: "web",
  });
  return {
    focus, userId: user.id, sessionId: started.session.id, materialId: material.id,
    otherMaterialId: otherMaterial.id, lectureId: lecture.id, otherLectureId: otherLecture.id,
  };
}

async function cleanup(userId: string, sessionId: string, lectureId: string, otherLectureId: string): Promise<void> {
  await db().$executeRaw`DELETE FROM "PrivateD1SyncOutbox" WHERE "data"->>'userId' = ${userId}`;
  await db().studyEvent.deleteMany({ where: { userId } });
  await db().studyDailyMetric.deleteMany({ where: { userId } });
  await db().focusSession.deleteMany({ where: { id: sessionId } });
  await db().focusPlan.deleteMany({ where: { userId } });
  await db().user.delete({ where: { id: userId } });
  await db().lecture.deleteMany({ where: { id: { in: [lectureId, otherLectureId] } } });
}

test("real PostgreSQL handoff start/return is capped, replayed, and interruption is exactly once", { skip: skipped }, async () => {
  let clock = new Date(T0);
  const f = await fixture(() => new Date(clock));
  try {
    clock = new Date(T0.getTime() + 20 * 60_000);
    const started = await f.focus.startResourceHandoff(f.userId, f.sessionId, {
      resourceType: "PDF", resourceId: f.materialId, idempotencyKey: "prompt11-handoff-start", source: "web",
    });
    assert.equal(started.session.status, "RESOURCE_HANDOFF");
    assert.equal(started.session.activeSeconds, 20 * 60);
    const replayStart = await f.focus.startResourceHandoff(f.userId, f.sessionId, {
      resourceType: "PDF", resourceId: f.materialId, idempotencyKey: "prompt11-handoff-start", source: "web",
    });
    assert.equal(replayStart.idempotency, "REPLAY_SAME_PAYLOAD");

    clock = new Date(T0.getTime() + 80 * 60_000);
    const returned = await f.focus.returnFromResourceHandoff(f.userId, f.sessionId, {
      targetState: "ACTIVE", idempotencyKey: "prompt11-handoff-return", source: "web",
    });
    assert.equal(returned.session.status, "ACTIVE");
    assert.equal(returned.session.activeSeconds, 2_700);
    assert.equal(returned.session.pauseSeconds, 0);
    assert.equal(returned.session.plannedEndAt, new Date(T0.getTime() + 45 * 60_000).toISOString());
    const returnedEvent = await db().studyEvent.findFirst({
      where: { userId: f.userId, eventType: "focus_resource_handoff_returned" },
    });
    assert.deepEqual(returnedEvent?.payload, {
      resourceType: "PDF", resourceId: f.materialId, status: "RETURNED",
    });
    const interruption = await f.focus.recordInterruption(f.userId, f.sessionId, {
      observedAwaySeconds: 120, reason: "background_absence",
      idempotencyKey: "prompt11-interruption", source: "web",
    });
    assert.equal(interruption.idempotency, "FIRST_SEEN");
    assert.equal((await f.focus.recordInterruption(f.userId, f.sessionId, {
      observedAwaySeconds: 120, reason: "background_absence",
      idempotencyKey: "prompt11-interruption", source: "web",
    })).idempotency, "REPLAY_SAME_PAYLOAD");
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: "focus_interruption_recorded" } }), 1);
    assert.equal((await db().studyDailyMetric.findFirst({ where: { userId: f.userId } }))?.interruptionCount, 1);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

async function focusOutboxCount(userId: string, entity: string): Promise<number> {
  const rows = await db().$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' = ${userId} AND "entity" = ${entity}
  `;
  return Number(rows[0].count);
}

test("real PostgreSQL rejects a wrong-Lecture resource without side effects", { skip: skipped }, async () => {
  const f = await fixture(() => T0);
  try {
    await assert.rejects(f.focus.startResourceHandoff(f.userId, f.sessionId, {
      resourceType: "PDF", resourceId: f.otherMaterialId, idempotencyKey: "prompt11-wrong-lecture", source: "web",
    }), { code: "RESOURCE_NOT_FOUND" });
    assert.equal((await db().focusSession.findUnique({ where: { id: f.sessionId } }))?.status, "ACTIVE");
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: "focus_resource_handoff_started" } }), 0);
    assert.equal(await focusOutboxCount(f.userId, "FocusSession"), 1);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

test("real PostgreSQL handoff replay/conflict and return replay are idempotent", { skip: skipped }, async () => {
  let clock = new Date(T0);
  const f = await fixture(() => new Date(clock));
  try {
    const input = { resourceType: "PDF" as const, resourceId: f.materialId, idempotencyKey: "prompt11-replay-start", source: "web" as const };
    await f.focus.startResourceHandoff(f.userId, f.sessionId, input);
    assert.equal((await f.focus.startResourceHandoff(f.userId, f.sessionId, input)).idempotency, "REPLAY_SAME_PAYLOAD");
    await assert.rejects(f.focus.startResourceHandoff(f.userId, f.sessionId, {
      ...input, resourceId: f.otherMaterialId,
    }), { code: "IDEMPOTENCY_CONFLICT" });
    clock = new Date(T0.getTime() + 10 * 60_000);
    const returnInput = { targetState: "ACTIVE" as const, idempotencyKey: "prompt11-replay-return", source: "web" as const };
    await f.focus.returnFromResourceHandoff(f.userId, f.sessionId, returnInput);
    assert.equal((await f.focus.returnFromResourceHandoff(f.userId, f.sessionId, returnInput)).idempotency, "REPLAY_SAME_PAYLOAD");
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: { in: ["focus_resource_handoff_started", "focus_resource_handoff_returned"] } } }), 2);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

test("real PostgreSQL disallows completion and interruption while in resource handoff", { skip: skipped }, async () => {
  const f = await fixture(() => T0);
  try {
    await f.focus.startResourceHandoff(f.userId, f.sessionId, {
      resourceType: "PDF", resourceId: f.materialId, idempotencyKey: "prompt11-state-start", source: "web",
    });
    await assert.rejects(f.focus.completeSession(f.userId, f.sessionId, { idempotencyKey: "prompt11-illegal-complete" }), { code: "INVALID_SESSION_STATE" });
    await assert.rejects(f.focus.recordInterruption(f.userId, f.sessionId, {
      observedAwaySeconds: 120, reason: "background_absence", idempotencyKey: "prompt11-suppressed", source: "web",
    }), { code: "HANDOFF_SUPPRESSES_INTERRUPTION" });
    assert.equal((await db().focusSession.findUnique({ where: { id: f.sessionId } }))?.status, "RESOURCE_HANDOFF");
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: { in: ["focus_session_completed", "focus_interruption_recorded"] } } }), 0);
    assert.equal(await db().studyDailyMetric.count({ where: { userId: f.userId } }), 0);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

test("real PostgreSQL interruption conflict and projection budget are exact", { skip: skipped }, async () => {
  const f = await fixture(() => T0);
  try {
    const input = { observedAwaySeconds: 120, reason: "background_absence" as const, idempotencyKey: "prompt11-interruption-conflict", source: "web" as const };
    assert.equal((await f.focus.recordInterruption(f.userId, f.sessionId, input)).idempotency, "FIRST_SEEN");
    assert.equal((await f.focus.recordInterruption(f.userId, f.sessionId, input)).idempotency, "REPLAY_SAME_PAYLOAD");
    await assert.rejects(f.focus.recordInterruption(f.userId, f.sessionId, { ...input, observedAwaySeconds: 121 }), { code: "IDEMPOTENCY_CONFLICT" });
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: "focus_interruption_recorded" } }), 1);
    assert.equal((await db().studyDailyMetric.findFirst({ where: { userId: f.userId } }))?.interruptionCount, 1);
    assert.equal(await focusOutboxCount(f.userId, "StudyDailyMetric"), 1);
    assert.equal(await focusOutboxCount(f.userId, "FocusSession"), 1);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

test("real PostgreSQL handoff start and return projection failures roll back atomically", { skip: skipped }, async () => {
  let clock = new Date(T0);
  const f = await fixture(() => new Date(clock));
  try {
    await db().$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "prompt11_fail_handoff_projection"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entity" = 'FocusSession' THEN RAISE EXCEPTION 'prompt11 handoff projection failure'; END IF; RETURN NEW; END; $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER "prompt11_fail_handoff_projection" BEFORE INSERT ON "PrivateD1SyncOutbox" FOR EACH ROW EXECUTE FUNCTION "prompt11_fail_handoff_projection"()`);
    try {
      await assert.rejects(f.focus.startResourceHandoff(f.userId, f.sessionId, {
        resourceType: "PDF", resourceId: f.materialId, idempotencyKey: "prompt11-rollback-start", source: "web",
      }), { code: "OUTBOX_FAILURE" });
    } finally {
      await db().$executeRawUnsafe(`DROP TRIGGER "prompt11_fail_handoff_projection" ON "PrivateD1SyncOutbox"`);
      await db().$executeRawUnsafe(`DROP FUNCTION "prompt11_fail_handoff_projection"()`);
    }
    assert.equal((await db().focusSession.findUnique({ where: { id: f.sessionId } }))?.status, "ACTIVE");
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: "focus_resource_handoff_started" } }), 0);

    await f.focus.startResourceHandoff(f.userId, f.sessionId, {
      resourceType: "PDF", resourceId: f.materialId, idempotencyKey: "prompt11-rollback-return-start", source: "web",
    });
    clock = new Date(T0.getTime() + 10 * 60_000);
    await db().$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "prompt11_fail_handoff_projection"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entity" = 'FocusSession' THEN RAISE EXCEPTION 'prompt11 handoff projection failure'; END IF; RETURN NEW; END; $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER "prompt11_fail_handoff_projection" BEFORE INSERT ON "PrivateD1SyncOutbox" FOR EACH ROW EXECUTE FUNCTION "prompt11_fail_handoff_projection"()`);
    try {
      await assert.rejects(f.focus.returnFromResourceHandoff(f.userId, f.sessionId, {
        targetState: "ACTIVE", idempotencyKey: "prompt11-rollback-return", source: "web",
      }), { code: "OUTBOX_FAILURE" });
    } finally {
      await db().$executeRawUnsafe(`DROP TRIGGER "prompt11_fail_handoff_projection" ON "PrivateD1SyncOutbox"`);
      await db().$executeRawUnsafe(`DROP FUNCTION "prompt11_fail_handoff_projection"()`);
    }
    assert.equal((await db().focusSession.findUnique({ where: { id: f.sessionId } }))?.status, "RESOURCE_HANDOFF");
    assert.equal(await db().studyEvent.count({ where: { userId: f.userId, eventType: "focus_resource_handoff_returned" } }), 0);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

test("real PostgreSQL current-session recovery preserves handoff and timer fields", { skip: skipped }, async () => {
  let clock = new Date(T0);
  const f = await fixture(() => new Date(clock));
  try {
    const before = await db().focusSession.findUnique({ where: { id: f.sessionId } });
    await f.focus.startResourceHandoff(f.userId, f.sessionId, {
      resourceType: "PDF", resourceId: f.materialId, idempotencyKey: "prompt11-recovery-start", source: "web",
    });
    const storedStart = await db().focusSession.findUnique({ where: { id: f.sessionId } });
    assert.equal(storedStart?.pauseSeconds, before?.pauseSeconds);
    assert.equal(storedStart?.plannedEndAt?.toISOString(), before?.plannedEndAt?.toISOString());
    const fresh = createFocusService({
      prisma: db(), now: () => new Date(clock), isFocusEnabled: () => true,
      isStudyEventsEnabled: () => true, d1PlanReadsEnabled: () => false,
    });
    assert.equal((await fresh.currentSession(f.userId)).session?.status, "RESOURCE_HANDOFF");
    clock = new Date(T0.getTime() + 20 * 60_000);
    await f.focus.returnFromResourceHandoff(f.userId, f.sessionId, {
      targetState: "ACTIVE", idempotencyKey: "prompt11-recovery-return", source: "web",
    });
    const storedReturn = await db().focusSession.findUnique({ where: { id: f.sessionId } });
    assert.equal(storedReturn?.pauseSeconds, before?.pauseSeconds);
    assert.equal(storedReturn?.plannedEndAt?.toISOString(), before?.plannedEndAt?.toISOString());
    assert.equal(await focusOutboxCount(f.userId, "FocusSession"), 3);
  } finally {
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});

test("real PostgreSQL handoff and interruption routes enforce auth, flags, DTOs, and state", { skip: skipped }, async () => {
  const clock = new Date(T0);
  const f = await fixture(() => new Date(clock));
  const focusDisabled = createFocusService({
    prisma: db(), now: () => new Date(clock), isFocusEnabled: () => false,
    isStudyEventsEnabled: () => true, d1PlanReadsEnabled: () => false,
  });
  const eventsDisabled = createFocusService({
    prisma: db(), now: () => new Date(clock), isFocusEnabled: () => true,
    isStudyEventsEnabled: () => false, d1PlanReadsEnabled: () => false,
  });
  const app = express();
  app.use(express.json());
  const requireUser: RequestHandler = (req, res, next) => {
    if (req.header("x-test-auth") !== "verified") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as typeof req & { user: { id: string } }).user = { id: f.userId };
    next();
  };
  app.use("/api/focus", createFocusRouter({ service: f.focus, requireUser }));
  app.use("/focus-disabled", createFocusRouter({ service: focusDisabled, requireUser }));
  app.use("/events-disabled", createFocusRouter({ service: eventsDisabled, requireUser }));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const handoffPath = `/sessions/${f.sessionId}/handoff/start`;
    const handoffBody = {
      resourceType: "PDF", resourceId: f.materialId,
      idempotencyKey: "prompt11-route-start", source: "web",
    };
    const post = (path: string, body: unknown, authenticated = true) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { "x-test-auth": "verified" } : {}),
      },
      body: JSON.stringify(body),
    });

    assert.equal((await post(`/api/focus${handoffPath}`, handoffBody, false)).status, 401);
    assert.equal((await (await post(`/focus-disabled${handoffPath}`, handoffBody)).json() as { code: string }).code, "FEATURE_DISABLED");
    assert.equal((await (await post(`/events-disabled${handoffPath}`, handoffBody)).json() as { code: string }).code, "DEPENDENCY_DISABLED");
    const invalidResource = await post(`/api/focus${handoffPath}`, {
      ...handoffBody, resourceId: "https://example.invalid/arbitrary.pdf",
    });
    assert.equal(invalidResource.status, 400);
    assert.equal((await db().focusSession.findUnique({ where: { id: f.sessionId } }))?.status, "ACTIVE");

    const started = await post(`/api/focus${handoffPath}`, handoffBody);
    assert.equal(started.status, 201);
    assert.equal((await started.json() as { session: { status: string } }).session.status, "RESOURCE_HANDOFF");
    clock.setTime(T0.getTime() + 60_000);
    const returned = await post(`/api/focus/sessions/${f.sessionId}/handoff/return`, {
      targetState: "ACTIVE", idempotencyKey: "prompt11-route-return", source: "web",
    });
    assert.equal(returned.status, 200);
    assert.equal((await returned.json() as { session: { status: string } }).session.status, "ACTIVE");
    const interruption = await post(`/api/focus/sessions/${f.sessionId}/interruptions`, {
      observedAwaySeconds: 120, reason: "background_absence",
      idempotencyKey: "prompt11-route-interruption", source: "web",
    });
    assert.equal(interruption.status, 201);
    assert.equal((await interruption.json() as { metricUpdated: boolean }).metricUpdated, true);
    assert.equal((await db().focusSession.findUnique({ where: { id: f.sessionId } }))?.status, "ACTIVE");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await cleanup(f.userId, f.sessionId, f.lectureId, f.otherLectureId);
  }
});