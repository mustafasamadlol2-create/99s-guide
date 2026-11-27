import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import express from "express";
import { readCanonicalQaFeed } from "../server/features/qa/read.js";
import { readStudyAnalyzerEvents } from "../server/features/study-analyzer/eventReads.js";
import { createStudyAnalyzerService } from "../server/features/study-analyzer/service.js";
import { requestLogger } from "../server/middleware/requestLogger.js";
import { clearOperationalMetricsForTests, getOperationalMetricsSnapshot, recordEgress } from "../server/observability/metrics.js";
import type { EgressCategory } from "../server/observability/types.js";
import { readLegacyPdf } from "../server/services/legacyPdfRead.js";
import { logger } from "../server/services/logger.js";
import { logPrivateReadFallback } from "../server/services/privateD1Read.js";

test("egress counters keep known categories, preserve unknown byte counts and expire with the window", () => {
  clearOperationalMetricsForTests();
  const at = Date.parse("2026-11-26T07:15:00Z");
  recordEgress("analyzer_event_result", { rows: 25, at });
  recordEgress("private_outbox_send", { bytes: 120, at });
  recordEgress("private_outbox_send", { bytes: 80, at });
  recordEgress("private_outbox_poll", { rows: 0, at });
  recordEgress("arbitrary private identifier" as EgressCategory, { bytes: 100, at });
  assert.deepEqual(getOperationalMetricsSnapshot(at).egress, [
    { category: "analyzer_event_result", observations: 1, rows: 25, bytes: null },
    { category: "private_outbox_poll", observations: 1, rows: 0, bytes: null },
    { category: "private_outbox_send", observations: 2, rows: null, bytes: 200 },
  ]);
  assert.deepEqual(getOperationalMetricsSnapshot(at + 15 * 60_000).egress, []);
});

test("private D1 fallback reason bucketing survives logging failure", () => {
  clearOperationalMetricsForTests();
  const warn = logger.warn;
  try {
    logger.warn = () => { throw new Error("synthetic log sink failure"); };
    assert.doesNotThrow(() => logPrivateReadFallback("qa", new Error("Private D1 read HTTP 403: private fixture")));
    assert.doesNotThrow(() => logPrivateReadFallback("qa", new DOMException("private fixture", "AbortError")));
    assert.doesNotThrow(() => logPrivateReadFallback("qa", new Error("Invalid Q&A private payload.")));
    assert.deepEqual(getOperationalMetricsSnapshot().egress.map(({ category }) => category), [
      "private_fallback_auth", "private_fallback_invalid", "private_fallback_timeout",
    ]);
    assert.doesNotMatch(JSON.stringify(getOperationalMetricsSnapshot()), /private fixture/);
  } finally {
    logger.warn = warn;
  }
});

test("completed D1 and fallback responses are counted once and failed responses are excluded", async () => {
  clearOperationalMetricsForTests();
  const app = express();
  app.use(requestLogger);
  app.get("/api/qa/:id", (req, res) => {
    const fallback = req.params.id === "fallback";
    res.setHeader("X-Private-QA-Read-Source", fallback ? "supabase-fallback" : "d1");
    res.setHeader("X-Private-Other-Read-Source", fallback ? "supabase-fallback" : "d1");
    res.status(req.params.id === "failed" ? 503 : 200).json([]);
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const root = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api/qa/";
    for (const route of ["canonical", "fallback", "failed"]) await (await fetch(root + route)).json();
    const snapshot = getOperationalMetricsSnapshot();
    assert.deepEqual(snapshot.egress, [
      { category: "private_d1_response", observations: 1, rows: null, bytes: null },
      { category: "private_postgres_fallback", observations: 1, rows: null, bytes: null },
    ]);
    assert.equal(snapshot.byFeature.find(({ feature }) => feature === "QA")?.requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

const fixturePath = process.env.PHASE10A_LOCAL_FIXTURE_DIRECTORY;
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

test("verified disposable PostgreSQL preserves Q&A and analyzer output and delivers smaller results", {
  skip: fixturePath ? false : "Requires the explicitly selected disposable PostgreSQL fixture.",
}, async () => {
  const db = new PrismaClient({
    datasourceUrl: "postgresql://phase9_test@127.0.0.1:56793/phase9b_runtime?schema=public&connection_limit=1",
    log: [{ emit: "event", level: "query" }],
  });
  let queryCount = 0;
  db.$on("query", () => { queryCount++; });
  const expected = realpathSync(fixturePath!);
  const rollback = new Error("rollback synthetic fixture");
  try {
    const [identity] = await db.$queryRaw<Array<{ path: string; name: string; role: string; ip: string; port: number }>>`
      SELECT current_setting('data_directory') AS "path", current_database() AS "name",
             current_user AS "role", inet_server_addr()::text AS "ip", inet_server_port() AS "port"
    `;
    assert.equal(realpathSync(identity.path), expected);
    assert.equal(identity.name, "phase9b_runtime");
    assert.equal(identity.role, "phase9_test");
    assert.match(identity.ip, /^127\.0\.0\.1(?:\/32)?$/);
    assert.equal(identity.port, 56793);

    await assert.rejects(db.$transaction(async (tx) => {
      const stamp = new Date("2026-11-26T20:59:59.567Z");
      const viewer = "p10-viewer";
      const author = "p10-author";
      const legacyAuthor = "p10-legacy-author";
      const lecture = "p10-lecture";
      await tx.user.createMany({ data: [
        { id: viewer, email: "viewer@phase10a.invalid" },
        { id: author, email: "author@phase10a.invalid", name: "Author", avatar: "x".repeat(65_536), avatarUrl: "/image.webp" },
        { id: legacyAuthor, email: "legacy@phase10a.invalid", name: "", avatar: "x".repeat(512), avatarUrl: "" },
      ] });
      await tx.userBlock.create({ data: { blockerId: viewer, blockedId: author } });
      await tx.lecture.create({ data: { id: lecture, name: "Fixture lecture", mainSubject: "fixture", trackMode: "STANDARD" } });
      await tx.qaQuestion.createMany({ data: [
        { id: "p10-live", lectureId: lecture, userId: author, content: "question", createdAt: stamp },
        { id: "p10-hidden", lectureId: lecture, userId: author, content: "deleted", isDeleted: true, createdAt: stamp },
        { id: "p10-other", lectureId: "other-lecture", userId: author, content: "other lecture", createdAt: stamp },
        { id: "p10-empty", lectureId: lecture, userId: legacyAuthor, content: "empty", createdAt: new Date(stamp.getTime() + 1) },
      ] });
      await tx.qaAnswer.createMany({ data: Array.from({ length: 212 }, (_, index) => ({
        id: "p10-reply-" + String(index).padStart(3, "0"),
        questionId: "p10-live",
        userId: index % 2 === 0 ? author : legacyAuthor,
        content: "synthetic reply " + index,
        createdAt: new Date(stamp.getTime() + index),
        isDeleted: index === 0,
        isBest: index === 1,
      })) });
      const beforeStart = queryCount;
      const baselineStartedAt = performance.now();
      const [blocks, before] = await Promise.all([
        tx.userBlock.findMany({ where: { blockerId: viewer }, select: { blockedId: true } }),
        tx.qaQuestion.findMany({
          where: { lectureId: lecture, isDeleted: false },
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
            answers: {
              where: { isDeleted: false }, orderBy: { createdAt: "asc" }, take: 200,
              include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
            },
          },
        }),
      ]);
      const baselineCalls = queryCount - beforeStart;
      const baselineMs = performance.now() - baselineStartedAt;
      const blocked = new Set(blocks.map(({ blockedId }) => blockedId));
      const display = (user: { name: string | null; avatar: string | null; avatarUrl: string | null }) => ({
        userName: user.name || "Unknown", userAvatar: user.avatarUrl || user.avatar || "",
      });
      const baselineResponse = before.map((q) => ({
        id: q.id, lectureId: q.lectureId, user_id: q.userId, ...display(q.user), content: q.content,
        createdAt: q.createdAt.toISOString(), upvotes: q.upvotes, isBlocked: blocked.has(q.userId),
        answers: q.answers.map((a) => ({
          id: a.id, questionId: a.questionId, userId: a.userId, ...display(a.user), content: a.content,
          createdAt: a.createdAt.toISOString(), upvotes: a.upvotes, isBest: a.isBest, isBlocked: blocked.has(a.userId),
        })),
      }));
      const replies = before.flatMap(({ answers }) => answers);
      const uniqueAuthors = <T extends { user: { id: string } }>(rows: T[]) =>
        [...new Map(rows.map(({ user }) => [user.id, user])).values()];
      // Count authors once per Prisma relation result, avoiding estimates based
      // on repeated references in the decoded JavaScript object graph.
      const baselineGroups = [
        blocks, before.map(({ answers: _answers, user: _user, ...q }) => q), uniqueAuthors(before),
        replies.map(({ user: _user, ...a }) => a), uniqueAuthors(replies),
      ];
      let projectedRows: unknown[] = [];
      const afterStart = queryCount;
      const optimizedStartedAt = performance.now();
      const measured = {
        $queryRaw: (async (parts: TemplateStringsArray, ...bindings: unknown[]) => {
          projectedRows = await tx.$queryRaw<unknown[]>(parts, ...bindings);
          return projectedRows;
        }) as PrismaClient["$queryRaw"],
      };
      const optimized = await readCanonicalQaFeed(measured, lecture, viewer);
      const optimizedCalls = queryCount - afterStart;
      const optimizedMs = performance.now() - optimizedStartedAt;
      assert.deepEqual(optimized, baselineResponse);
      assert.equal(optimizedCalls, 1);
      assert.equal(optimized[0].answers.length, 0);
      assert.equal(optimized[1].answers.length, 200);
      assert.equal(optimized[1].answers[0].id, "p10-reply-001");
      assert.equal(optimized[1].answers[0].isBest, true);
      assert.equal(optimized[1].answers[1].isBlocked, true);
      assert.equal((await readCanonicalQaFeed(tx, lecture, legacyAuthor))[1].isBlocked, false);
      assert.deepEqual(await readCanonicalQaFeed(tx, "no-such-lecture", viewer), []);
      const estimatedBaseline = baselineGroups.reduce((sum, group) => sum + jsonBytes(group), 0);
      assert.ok(jsonBytes(projectedRows) < estimatedBaseline);
      console.log("PHASE10A_QA_FIXTURE", JSON.stringify({
        calls: [baselineCalls, optimizedCalls],
        rows: [baselineGroups.reduce((sum, group) => sum + group.length, 0), projectedRows.length],
        resultBytes: [estimatedBaseline, jsonBytes(projectedRows)], apiBytes: jsonBytes(optimized),
        specimenMs: [baselineMs, optimizedMs].map((ms) => Math.round(ms * 10) / 10),
      }));

      const mcq = await tx.mcq.create({
        data: { lectureId: lecture, question: "fixture", optionA: "A", optionB: "B", optionC: "C", optionD: "D", correctAnswer: "A" },
      });
      const flashcard = await tx.flashcard.create({
        data: { lectureId: lecture, clinicalConcept: "fixture", explanation: "fixture" },
      });
      const common = {
        userId: viewer, lectureId: lecture, source: "offline_replay", evidenceClass: "SERVER_VALIDATED",
        privacyClass: "PRIVATE_STUDY", occurredAt: new Date(stamp.getTime() - 86_400_000), receivedAt: stamp,
      };
      const padding = "synthetic unused historical evidence ".repeat(40);
      await tx.studyEvent.createMany({ data: [
        ...Array.from({ length: 120 }, (_, index) => ({
          ...common, id: "p10-mcq-" + index, idempotencyKey: "p10-mcq-" + index,
          eventType: "mcq_attempted", mcqId: mcq.id,
          payload: { correct: index % 2 === 0 ? true : "false", unused: padding },
        })),
        ...Array.from({ length: 85 }, (_, index) => ({
          ...common, id: "p10-flash-" + index, idempotencyKey: "p10-flash-" + index,
          eventType: "flashcard_reviewed", flashcardId: flashcard.id,
          payload: { quality: index % 2 === 0 ? "EASY" : "HARD", unused: padding },
        })),
        { ...common, id: "p10-other-account", idempotencyKey: "p10-other-account",
          userId: author, eventType: "mcq_attempted", mcqId: mcq.id, payload: { correct: true } },
        { ...common, id: "p10-future", idempotencyKey: "p10-future", receivedAt: new Date(stamp.getTime() + 1),
          eventType: "mcq_attempted", mcqId: mcq.id, payload: { correct: true } },
      ] });
      const input = { userId: viewer, from: stamp, through: stamp, limit: 10_001 };
      const analyticsBefore = queryCount;
      const eventStartedAt = performance.now();
      const link = { select: { lectureId: true, lecture: { select: { mainSubject: true } } } } as const;
      const oldEvents = (await Promise.all((["mcq_attempted", "flashcard_reviewed"] as const).map((eventType) => tx.studyEvent.findMany({
        where: { userId: viewer, eventType, receivedAt: { gte: stamp, lte: stamp } },
        select: {
          id: true, eventType: true, source: true, evidenceClass: true, privacyClass: true, occurredAt: true,
          receivedAt: true, lectureId: true, mcqId: true, flashcardId: true, payload: true,
          mcq: eventType === "mcq_attempted" ? link : false,
          flashcard: eventType === "flashcard_reviewed" ? link : false,
        },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 10_001,
      })))).flat();
      const oldEventCalls = queryCount - analyticsBefore;
      const oldEventMs = performance.now() - eventStartedAt;
      const analyticsAfter = queryCount;
      const optimizedEventStartedAt = performance.now();
      const normalMcqs = await readStudyAnalyzerEvents(tx, { ...input, eventType: "mcq_attempted" });
      const normalFlashcards = await readStudyAnalyzerEvents(tx, { ...input, eventType: "flashcard_reviewed" });
      const eventCalls = queryCount - analyticsAfter;
      const optimizedEventMs = performance.now() - optimizedEventStartedAt;
      assert.equal(eventCalls, 2);
      assert.equal(oldEvents.length, 205);
      assert.equal(normalMcqs.length, 120);
      assert.equal(normalFlashcards.length, 85);
      const oldProjection = (mcqs: boolean) => oldEvents
        .filter((row) => row.eventType === (mcqs ? "mcq_attempted" : "flashcard_reviewed"))
        .map(({ occurredAt: _occurredAt, mcq: mcqLink, flashcard: flashcardLink, payload, ...row }) => {
          const key = mcqs ? "correct" : "quality";
          return { ...row, payload: { [key]: (payload as Record<string, unknown>)[key] },
            ...(mcqs ? { mcq: mcqLink } : { flashcard: flashcardLink }) };
        });
      assert.deepEqual(normalMcqs, oldProjection(true));
      assert.deepEqual(normalFlashcards, oldProjection(false));
      const analyzer = createStudyAnalyzerService({ database: tx as never, now: () => stamp });
      const baselineAnalyzer = createStudyAnalyzerService({
        database: {
          focusSession: tx.focusSession, groupFocusParticipantSummary: tx.groupFocusParticipantSummary,
          recallAttempt: tx.recallAttempt, lectureMastery: tx.lectureMastery,
          lectureRetention: tx.lectureRetention, lecture: tx.lecture,
          $queryRaw: async (_parts: TemplateStringsArray, ...bindings: unknown[]) => {
            const isMcq = bindings[3] === "mcq_attempted";
            return oldEvents.filter((event) => event.eventType === bindings[3])
              .map((event) => ({ ...event, item: isMcq ? event.mcq : event.flashcard }));
          },
        } as never,
        now: () => stamp,
      });
      assert.deepEqual(await analyzer(viewer), await baselineAnalyzer(viewer));
      const eventBytes = [jsonBytes(oldEvents), jsonBytes([...normalMcqs, ...normalFlashcards])];
      assert.ok(eventBytes[1] < eventBytes[0] / 3);
      console.log("PHASE10A_ANALYZER_FIXTURE", JSON.stringify({
        calls: [oldEventCalls, eventCalls], rows: [oldEvents.length, normalMcqs.length + normalFlashcards.length],
        resultBytes: eventBytes,
        specimenMs: [oldEventMs, optimizedEventMs].map((ms) => Math.round(ms * 10) / 10),
      }));

      const pdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(262_144, 32)]);
      const txFixture = { $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx) };
      const legacy = await tx.material.create({
        data: { lectureId: lecture, type: "PDF", title: "Fixture", fileUrlOrLink: "/uploads/fixture.pdf" },
      });
      const blobBefore = await tx.material.update({ where: { id: legacy.id }, data: { fileData: pdf } });
      const blobAfter = await tx.material.update({
        where: { id: legacy.id }, data: { fileData: pdf }, select: { id: true },
      });
      assert.equal(blobBefore.fileData?.byteLength, pdf.byteLength);
      assert.deepEqual(blobAfter, { id: blobBefore.id });
      const partial = await readLegacyPdf(txFixture as never, legacy.id, { range: "bytes=0-4" });
      assert.equal(partial.kind, "pdf");
      if (partial.kind === "pdf") assert.deepEqual(partial.body, Buffer.from("%PDF-"));
      const key = "phase10-fixture-outbox";
      const value = JSON.stringify({ content: padding.repeat(20) });
      const priorQueue = await tx.systemSetting.upsert({
        where: { key }, create: { key, value, updatedAt: stamp }, update: { value, updatedAt: stamp },
      });
      const nextQueue = await tx.systemSetting.upsert({
        where: { key }, create: { key, value, updatedAt: stamp }, update: { value, updatedAt: stamp }, select: { key: true },
      });
      assert.equal((await tx.systemSetting.findUnique({ where: { key } }))?.value, value);
      await tx.notification.createMany({ data: ["p10-note-a", "p10-note-b"].map((id) => ({
        id, title: "Fixture", message: "x".repeat(2_000), targetUserId: viewer, createdAt: stamp,
      })) });
      const oldNotification = await tx.notification.findUnique({ where: { id: "p10-note-a" } });
      assert.equal(oldNotification?.targetUserId, viewer);
      const oldDeleted = await tx.notification.delete({ where: { id: "p10-note-a" } });
      const notification = await tx.notification.findUnique({
        where: { id: "p10-note-b" }, select: { targetUserId: true },
      });
      assert.equal(notification?.targetUserId, viewer);
      const deleted = await tx.notification.delete({ where: { id: "p10-note-b" }, select: { id: true } });
      assert.equal(deleted.id, "p10-note-b");
      console.log("PHASE10A_WRITES_FIXTURE", JSON.stringify({
        pdfResultBytes: [jsonBytes(blobBefore), jsonBytes(blobAfter)], pdfBlobBytes: [pdf.byteLength, 0],
        contentQueueBytes: [jsonBytes(priorQueue), jsonBytes(nextQueue)],
        notificationDeleteBytes: [jsonBytes([oldNotification, oldDeleted]), jsonBytes([notification, deleted])],
      }));
      throw rollback;
    }, { timeout: 50_000 }), (error) => error === rollback);
  } finally {
    await db.$disconnect();
  }
});
