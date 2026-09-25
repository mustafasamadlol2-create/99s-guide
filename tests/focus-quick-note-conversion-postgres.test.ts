import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";
import type { FocusBackendService } from "../server/features/focus/types.js";

const databaseUrl = getPrompt8PostgresGateUrl();
const skipped = databaseUrl ? false : "Set the explicit disposable-schema markers to run.";
const NOW = new Date("2026-09-24T10:00:00.000Z");
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

function service(now = () => NOW): FocusBackendService {
  return createFocusService({
    prisma: db(),
    now,
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
    d1PlanReadsEnabled: () => false,
    d1MetricReadsEnabled: () => false,
  });
}

async function fixture(): Promise<{
  userId: string;
  lectureId: string;
  targetLectureId: string;
  focus: FocusBackendService;
  sourcePlanId: string;
  sourcePlanItemId: string;
  sessionId: string;
  targetPlanId: string;
  alternatePlanId: string;
}> {
  const suffix = randomUUID();
  const [user, sourceLecture, targetLecture] = await Promise.all([
    db().user.create({ data: { email: `prompt12-convert-${suffix}@example.test` } }),
    db().lecture.create({
      data: { name: "Quick Note source lecture", mainSubject: "Verification", trackMode: "test" },
    }),
    db().lecture.create({
      data: { name: "Quick Note target lecture", mainSubject: "Verification", trackMode: "test" },
    }),
  ]);
  const focus = service();
  const sourcePlan = await focus.createPlan(user.id, {
    title: "Source configuration",
    timezone: "Asia/Baghdad",
    items: [{
      lectureId: sourceLecture.id,
      sequence: 1,
      sessionCount: 2,
      focusDurationSeconds: 2_100,
      breakDurationSeconds: 420,
      includeMcq: true,
      includeFlashcards: false,
      includeVideo: true,
    }],
  });
  const started = await focus.startSession(user.id, {
    planId: sourcePlan.id,
    planItemId: sourcePlan.items[0].id,
    idempotencyKey: `prompt12-source-${suffix}`,
    source: "web",
  });
  const targetPlan = await focus.createPlan(user.id, {
    title: "Conversion target",
    timezone: "Asia/Baghdad",
    items: [{
      lectureId: targetLecture.id,
      sequence: 1,
      sessionCount: 3,
      focusDurationSeconds: 1_800,
      breakDurationSeconds: 300,
      includeMcq: false,
      includeFlashcards: true,
      includeVideo: false,
    }],
  });
  const alternatePlan = await focus.createPlan(user.id, {
    title: "Alternate conversion target",
    timezone: "Asia/Baghdad",
    items: [{
      lectureId: targetLecture.id,
      sequence: 1,
      sessionCount: 1,
      focusDurationSeconds: 1_500,
      breakDurationSeconds: 0,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    }],
  });
  return {
    userId: user.id,
    lectureId: sourceLecture.id,
    targetLectureId: targetLecture.id,
    focus,
    sourcePlanId: sourcePlan.id,
    sourcePlanItemId: sourcePlan.items[0].id,
    sessionId: started.session.id,
    targetPlanId: targetPlan.id,
    alternatePlanId: alternatePlan.id,
  };
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await db().focusQuickNote.deleteMany({ where: { userId: f.userId } });
  await db().studyEvent.deleteMany({ where: { userId: f.userId } });
  await db().studyDailyMetric.deleteMany({ where: { userId: f.userId } });
  await db().focusSession.deleteMany({ where: { userId: f.userId } });
  await db().focusPlan.deleteMany({ where: { userId: f.userId } });
  await db().$executeRaw`DELETE FROM "PrivateD1SyncOutbox" WHERE "data"->>'userId' = ${f.userId}`;
  await db().user.deleteMany({ where: { id: f.userId } });
  await db().lecture.deleteMany({ where: { id: { in: [f.lectureId, f.targetLectureId] } } });
}

async function makeNote(f: Awaited<ReturnType<typeof fixture>>, key = "prompt12-conversion-note") {
  return f.focus.createQuickNote(f.userId, {
    focusSessionId: f.sessionId,
    content: "Review this Lecture next time.",
    idempotencyKey: key,
  });
}

test("Quick Note conversion appends one configured Focus item and preserves its link", { skip: skipped }, async () => {
  const f = await fixture();
  try {
    const created = await makeNote(f);
    const planOutboxBefore = await db().privateD1SyncOutbox.count({
      where: { entity: "FocusPlan", data: { path: ["userId"], equals: f.userId } },
    });
    const calendarBefore = await db().calendarEvent.count({ where: { userId: f.userId } });
    const first = await f.focus.convertQuickNote(f.userId, created.note.id, {
      targetPlanId: f.targetPlanId,
    });
    assert.equal(first.idempotency, "CONVERTED");
    assert.equal(first.note.status, "CONVERTED");
    assert.equal(first.note.convertedToPlanItemId, first.planItem.id);
    assert.equal(first.planItem.planId, f.targetPlanId);
    assert.equal(first.planItem.lectureId, f.lectureId);
    assert.equal(first.planItem.sequence, 2);
    assert.equal(first.planItem.sessionCount, 1);
    assert.equal(first.planItem.focusDurationSeconds, 2_100);
    assert.equal(first.planItem.breakDurationSeconds, 420);
    assert.equal(first.planItem.includeMcq, true);
    assert.equal(first.planItem.includeFlashcards, false);
    assert.equal(first.planItem.includeVideo, true);
    const projectionRows = await db().privateD1SyncOutbox.findMany({
      where: {
        entity: "FocusPlan",
        data: { path: ["userId"], equals: f.userId },
      },
      select: { data: true },
    });
    assert.equal(JSON.stringify(projectionRows).includes("Review this Lecture next time."), false);

    const replay = await f.focus.convertQuickNote(f.userId, created.note.id, {
      targetPlanId: f.targetPlanId,
    });
    assert.equal(replay.idempotency, "REPLAY_SAME_PAYLOAD");
    assert.equal(replay.planItem.id, first.planItem.id);
    assert.equal(await db().focusPlanItem.count({ where: { planId: f.targetPlanId } }), 2);
    assert.equal(await db().privateD1SyncOutbox.count({
      where: { entity: "FocusPlan", data: { path: ["userId"], equals: f.userId } },
    }), planOutboxBefore + 1);
    assert.equal(await db().calendarEvent.count({ where: { userId: f.userId } }), calendarBefore);

    await assert.rejects(
      f.focus.convertQuickNote(f.userId, created.note.id, { targetPlanId: f.alternatePlanId }),
      { code: "QUICK_NOTE_CONVERSION_CONFLICT" },
    );
    const target = await f.focus.getPlan(f.userId, f.targetPlanId);
    await assert.rejects(
      f.focus.updatePlan(f.userId, f.targetPlanId, {
        items: [target.items[0]],
      }),
      { code: "PLAN_ITEM_HAS_QUICK_NOTE_CONVERSION" },
    );
  } finally {
    await cleanup(f);
  }
});

test("concurrent conversion creates one item and one projection; enqueue failure rolls back", { skip: skipped }, async () => {
  const f = await fixture();
  try {
    const created = await makeNote(f, "prompt12-concurrent-convert-note");
    const beforeOutbox = await db().privateD1SyncOutbox.count({
      where: { entity: "FocusPlan", data: { path: ["userId"], equals: f.userId } },
    });
    const converted = await Promise.all([
      f.focus.convertQuickNote(f.userId, created.note.id, { targetPlanId: f.targetPlanId }),
      f.focus.convertQuickNote(f.userId, created.note.id, { targetPlanId: f.targetPlanId }),
    ]);
    assert.equal(converted.filter((result) => result.idempotency === "CONVERTED").length, 1);
    assert.equal(new Set(converted.map((result) => result.planItem.id)).size, 1);
    assert.equal(await db().focusPlanItem.count({ where: { planId: f.targetPlanId } }), 2);
    assert.equal(await db().privateD1SyncOutbox.count({
      where: { entity: "FocusPlan", data: { path: ["userId"], equals: f.userId } },
    }), beforeOutbox + 1);

    const rollbackNote = await makeNote(f, "prompt12-rollback-convert-note");
    const outboxBeforeRollback = await db().privateD1SyncOutbox.count({
      where: { entity: "FocusPlan", data: { path: ["userId"], equals: f.userId } },
    });
    await db().$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION "prompt12_fail_plan_projection"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entity" = 'FocusPlan' THEN RAISE EXCEPTION 'prompt12 projection failure'; END IF; RETURN NEW; END; $$`,
    );
    await db().$executeRawUnsafe(
      `CREATE TRIGGER "prompt12_fail_plan_projection" BEFORE INSERT ON "PrivateD1SyncOutbox" FOR EACH ROW EXECUTE FUNCTION "prompt12_fail_plan_projection"()`,
    );
    try {
      await assert.rejects(
        f.focus.convertQuickNote(f.userId, rollbackNote.note.id, { targetPlanId: f.alternatePlanId }),
        { code: "OUTBOX_FAILURE" },
      );
    } finally {
      await db().$executeRawUnsafe(
        `DROP TRIGGER "prompt12_fail_plan_projection" ON "PrivateD1SyncOutbox"`,
      );
      await db().$executeRawUnsafe(`DROP FUNCTION "prompt12_fail_plan_projection"()`);
    }
    const persisted = await db().focusQuickNote.findUnique({ where: { id: rollbackNote.note.id } });
    assert.equal(persisted?.status, "ACTIVE");
    assert.equal(persisted?.convertedToPlanItemId, null);
    assert.equal(await db().focusPlanItem.count({ where: { planId: f.alternatePlanId } }), 1);
    assert.equal(await db().privateD1SyncOutbox.count({
      where: { entity: "FocusPlan", data: { path: ["userId"], equals: f.userId } },
    }), outboxBeforeRollback);
  } finally {
    await cleanup(f);
  }
});

test("an active target Plan remains structurally locked during conversion", { skip: skipped }, async () => {
  const f = await fixture();
  try {
    const note = await makeNote(f, "prompt12-active-target-note");
    await f.focus.abandonSession(f.userId, f.sessionId, { idempotencyKey: "prompt12-abandon-source" });
    const activeTarget = await f.focus.startSession(f.userId, {
      planId: f.targetPlanId,
      planItemId: (await f.focus.getPlan(f.userId, f.targetPlanId)).items[0].id,
      idempotencyKey: "prompt12-start-target",
      source: "web",
    });
    await assert.rejects(
      f.focus.convertQuickNote(f.userId, note.note.id, { targetPlanId: f.targetPlanId }),
      { code: "PLAN_HAS_ACTIVE_SESSION" },
    );
    await f.focus.abandonSession(f.userId, activeTarget.session.id, {
      idempotencyKey: "prompt12-abandon-target",
    });
    await f.focus.archivePlan(f.userId, f.targetPlanId);
    await assert.rejects(
      f.focus.convertQuickNote(f.userId, note.note.id, { targetPlanId: f.targetPlanId }),
      { code: "PLAN_ARCHIVED" },
    );
    assert.equal((await f.focus.getQuickNote(f.userId, note.note.id)).status, "ACTIVE");
    assert.equal(await db().focusPlanItem.count({ where: { planId: f.targetPlanId } }), 1);
  } finally {
    await cleanup(f);
  }
});