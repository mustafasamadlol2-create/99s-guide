import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";
import type { FocusBackendService } from "../server/features/focus/types.js";
import { createFocusRouter } from "../server/routes/focus.js";

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
  otherUserId: string;
  lectureId: string;
  planId: string;
  planItemId: string;
  sessionId: string;
  focus: FocusBackendService;
}> {
  const suffix = randomUUID();
  const [user, otherUser, lecture] = await Promise.all([
    db().user.create({ data: { email: `prompt12-note-${suffix}@example.test` } }),
    db().user.create({ data: { email: `prompt12-note-other-${suffix}@example.test` } }),
    db().lecture.create({
      data: { name: "Prompt 12 note lecture", mainSubject: "Verification", trackMode: "test" },
    }),
  ]);
  const focus = service();
  const plan = await focus.createPlan(user.id, {
    title: "Prompt 12 note source",
    timezone: "Asia/Baghdad",
    items: [{
      lectureId: lecture.id,
      sequence: 1,
      sessionCount: 2,
      focusDurationSeconds: 2_700,
      breakDurationSeconds: 600,
      includeMcq: true,
      includeFlashcards: false,
      includeVideo: true,
    }],
  });
  const started = await focus.startSession(user.id, {
    planId: plan.id,
    planItemId: plan.items[0].id,
    idempotencyKey: `prompt12-start-${suffix}`,
    source: "web",
  });
  return {
    userId: user.id,
    otherUserId: otherUser.id,
    lectureId: lecture.id,
    planId: plan.id,
    planItemId: plan.items[0].id,
    sessionId: started.session.id,
    focus,
  };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await db().focusQuickNote.deleteMany({ where: { userId: { in: [value.userId, value.otherUserId] } } });
  await db().studyEvent.deleteMany({ where: { userId: { in: [value.userId, value.otherUserId] } } });
  await db().studyDailyMetric.deleteMany({ where: { userId: { in: [value.userId, value.otherUserId] } } });
  await db().focusSession.deleteMany({ where: { userId: { in: [value.userId, value.otherUserId] } } });
  await db().focusPlan.deleteMany({ where: { userId: { in: [value.userId, value.otherUserId] } } });
  await db().$executeRaw`
    DELETE FROM "PrivateD1SyncOutbox" WHERE "data"->>'userId' IN (${value.userId}, ${value.otherUserId})
  `;
  await db().user.deleteMany({ where: { id: { in: [value.userId, value.otherUserId] } } });
  await db().lecture.deleteMany({ where: { id: value.lectureId } });
}

async function serveFocusRoutes(
  focus: FocusBackendService,
  fallbackUserId: string,
): Promise<{ server: ReturnType<typeof express.application.listen>; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  const requireUser: RequestHandler = (req, _res, next) => {
    const requestedUser = req.get("x-test-user-id") ?? fallbackUserId;
    (req as express.Request & { user: { id: string } }).user = { id: requestedUser };
    next();
  };
  app.use("/api/focus", createFocusRouter({ requireUser, service: focus }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test("PostgreSQL Quick Notes are private, inferred, editable, archive-only, and idempotent", { skip: skipped }, async () => {
  const f = await fixture();
  try {
    const noteText = "Keep the parasympathetic pathway straight.\nSecond line.";
    const eventCountBefore = await db().studyEvent.count({ where: { userId: f.userId } });
    const outboxCountBefore = await db().privateD1SyncOutbox.count();
    const request = {
      focusSessionId: f.sessionId,
      content: noteText,
      idempotencyKey: "prompt12-note-create-key",
    };
    const first = await f.focus.createQuickNote(f.userId, request);
    assert.equal(first.idempotency, "CREATED");
    assert.equal(first.note.lectureId, f.lectureId);
    assert.equal(first.note.status, "ACTIVE");
    assert.equal(await db().focusQuickNote.count({ where: { userId: f.userId } }), 1);

    const replay = await f.focus.createQuickNote(f.userId, request);
    assert.equal(replay.idempotency, "REPLAY_SAME_PAYLOAD");
    assert.equal(replay.note.id, first.note.id);
    await assert.rejects(
      f.focus.createQuickNote(f.userId, { ...request, content: "Different note text." }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await assert.rejects(
      f.focus.createQuickNote(f.otherUserId, request),
      { code: "SESSION_NOT_FOUND" },
    );

    const simultaneous = await Promise.all([
      f.focus.createQuickNote(f.userId, {
        ...request,
        content: "Concurrent note",
        idempotencyKey: "prompt12-note-concurrent-key",
      }),
      f.focus.createQuickNote(f.userId, {
        ...request,
        content: "Concurrent note",
        idempotencyKey: "prompt12-note-concurrent-key",
      }),
    ]);
    assert.equal(simultaneous.filter((result) => result.idempotency === "CREATED").length, 1);
    assert.equal(new Set(simultaneous.map((result) => result.note.id)).size, 1);
    assert.equal(await db().focusQuickNote.count({ where: { userId: f.userId } }), 2);

    assert.equal((await f.focus.listQuickNotes(f.userId)).length, 2);
    assert.deepEqual(await f.focus.listQuickNotes(f.otherUserId), []);
    await assert.rejects(f.focus.getQuickNote(f.otherUserId, first.note.id), {
      code: "QUICK_NOTE_NOT_FOUND",
    });

    const updated = await f.focus.updateQuickNote(f.userId, first.note.id, {
      content: "Edited private note",
    });
    assert.equal(updated.content, "Edited private note");
    const archived = await f.focus.archiveQuickNote(f.userId, first.note.id);
    assert.equal(archived.status, "ARCHIVED");
    assert.ok(archived.archivedAt);
    assert.equal((await f.focus.archiveQuickNote(f.userId, first.note.id)).status, "ARCHIVED");
    await assert.rejects(
      f.focus.updateQuickNote(f.userId, first.note.id, { content: "Cannot edit after archive" }),
      { code: "QUICK_NOTE_ARCHIVED" },
    );
    assert.equal((await f.focus.listQuickNotes(f.userId)).length, 1);
    assert.equal((await f.focus.listQuickNotes(f.userId, { status: "ARCHIVED" })).length, 1);

    assert.equal(await db().studyEvent.count({ where: { userId: f.userId } }), eventCountBefore);
    assert.equal(await db().privateD1SyncOutbox.count(), outboxCountBefore);
    const storedEvents = await db().studyEvent.findMany({
      where: { userId: f.userId },
      select: { payload: true },
    });
    const outbox = await db().privateD1SyncOutbox.findMany({ select: { data: true } });
    assert.equal(JSON.stringify(storedEvents).includes(noteText), false);
    assert.equal(JSON.stringify(outbox).includes(noteText), false);
  } finally {
    await cleanup(f);
  }
});

test("converting an archived or cross-user Quick Note is rejected without disclosure", { skip: skipped }, async () => {
  const f = await fixture();
  try {
    const note = await f.focus.createQuickNote(f.userId, {
      focusSessionId: f.sessionId,
      content: "A short observation.",
      idempotencyKey: "prompt12-note-archive-convert",
    });
    await f.focus.archiveQuickNote(f.userId, note.note.id);
    await assert.rejects(
      f.focus.convertQuickNote(f.userId, note.note.id, { targetPlanId: f.planId }),
      { code: "QUICK_NOTE_ARCHIVED" },
    );
    await assert.rejects(
      f.focus.convertQuickNote(f.otherUserId, note.note.id, { targetPlanId: f.planId }),
      { code: "QUICK_NOTE_NOT_FOUND" },
    );
  } finally {
    await cleanup(f);
  }
});

test("authenticated Quick Note routes validate inputs and expose create, list, edit, archive, and conversion", { skip: skipped }, async () => {
  const f = await fixture();
  const routes = await serveFocusRoutes(f.focus, f.userId);
  try {
    const target = await f.focus.createPlan(f.userId, {
      title: "Route conversion target",
      timezone: "Asia/Baghdad",
      items: [{
        lectureId: f.lectureId,
        sequence: 1,
        sessionCount: 1,
        focusDurationSeconds: 1_800,
        breakDurationSeconds: 0,
        includeMcq: false,
        includeFlashcards: true,
        includeVideo: false,
      }],
    });

    const rejected = await fetch(`${routes.baseUrl}/api/focus/quick-notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        focusSessionId: f.sessionId,
        content: "Route note",
        idempotencyKey: "prompt12-route-invalid",
        userId: f.otherUserId,
      }),
    });
    assert.equal(rejected.status, 400);

    const create = async (key: string, content: string) => fetch(`${routes.baseUrl}/api/focus/quick-notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focusSessionId: f.sessionId, content, idempotencyKey: key }),
    });
    const createArchive = await create("prompt12-route-archive", "Route archive note");
    assert.equal(createArchive.status, 201);
    const archivedNote = (await createArchive.json() as { note: { id: string; userId?: string } }).note;
    assert.equal(archivedNote.userId, undefined);

    const list = await fetch(`${routes.baseUrl}/api/focus/quick-notes?status=ACTIVE`);
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { notes: unknown[] }).notes.length, 1);
    const detail = await fetch(`${routes.baseUrl}/api/focus/quick-notes/${archivedNote.id}`, {
      headers: { "x-test-user-id": f.otherUserId },
    });
    assert.equal(detail.status, 404);

    const edit = await fetch(`${routes.baseUrl}/api/focus/quick-notes/${archivedNote.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Updated route note" }),
    });
    assert.equal(edit.status, 200);
    assert.equal((await edit.json() as { note: { content: string } }).note.content, "Updated route note");
    const archive = await fetch(`${routes.baseUrl}/api/focus/quick-notes/${archivedNote.id}/archive`, {
      method: "POST",
    });
    assert.equal(archive.status, 200);
    assert.equal((await archive.json() as { note: { status: string } }).note.status, "ARCHIVED");

    const createConversion = await create("prompt12-route-conversion", "Convert from route");
    const conversionNote = (await createConversion.json() as { note: { id: string } }).note;
    const converted = await fetch(
      `${routes.baseUrl}/api/focus/quick-notes/${conversionNote.id}/convert-to-plan-item`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPlanId: target.id }),
      },
    );
    assert.equal(converted.status, 201);
    const conversion = await converted.json() as {
      note: { status: string; convertedToPlanItemId: string };
      planItem: { lectureId: string; sessionCount: number };
    };
    assert.equal(conversion.note.status, "CONVERTED");
    assert.equal(conversion.planItem.lectureId, f.lectureId);
    assert.equal(conversion.planItem.sessionCount, 1);
    const replay = await fetch(
      `${routes.baseUrl}/api/focus/quick-notes/${conversionNote.id}/convert-to-plan-item`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPlanId: target.id }),
      },
    );
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { idempotency: string }).idempotency, "REPLAY_SAME_PAYLOAD");
  } finally {
    await new Promise<void>((resolve, reject) =>
      routes.server.close((error) => error ? reject(error) : resolve())
    );
    await cleanup(f);
  }
});