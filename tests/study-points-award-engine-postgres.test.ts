import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import { createGroupFocusRoomSchema } from "../server/features/group-focus/schemas.js";
import type { StudyPointsAwardSourceResult, StudyPointsAwarder } from "../server/features/study-points/awardTypes.js";
import { studyPointsBaghdadDate } from "../server/features/study-points/caps.js";
import {
  createIntegrityObservation,
  createIntegrityActionEnvelope,
  evaluateIntegrityAction,
  INTEGRITY_ACTION_TYPES,
} from "../server/features/study-integrity/index.js";
import { getPrompt20StudyPointsPostgresGateUrl } from "./helpers/prompt20StudyPointsPostgresGate.js";

const databaseUrl = getPrompt20StudyPointsPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 20 disposable-schema PostgreSQL gate to run.";

type Fixture = {
  userIds: string[];
  lectureId: string;
};

let prisma: PrismaClient | undefined;
let createFocusService: typeof import("../server/features/focus/service.js").createFocusService;
let createGroupFocusService: typeof import("../server/features/group-focus/service.js").createGroupFocusService;
let createGroupFocusRuntimeSummaryService: typeof import("../server/features/group-focus/runtimeSummary.js").createGroupFocusRuntimeSummaryService;
let StudyPointsAwardEngine: typeof import("../server/features/study-points/awardEngine.js").StudyPointsAwardEngine;
let StudyPointsLedgerService: typeof import("../server/features/study-points/ledger.js").StudyPointsLedgerService;
let StudyPointsIntegrityService: typeof import("../server/features/study-integrity/persistence/index.js").StudyIntegrityService;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

const noOpAwarder: StudyPointsAwarder = {
  async awardStudyPointsForSource(input): Promise<StudyPointsAwardSourceResult> {
    return {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      attempts: [],
    };
  },
};

function makePastBaghdadNoon(daysAgo = 1): Date {
  const date = studyPointsBaghdadDate(new Date());
  const todayAtBaghdadNoonUtc = new Date(`${date}T09:00:00.000Z`);
  return new Date(todayAtBaghdadNoonUtc.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

async function createFixture(userCount = 1): Promise<Fixture> {
  const suffix = randomUUID();
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, index) => db().user.create({
      data: { email: `prompt20-points-${index}-${suffix}@example.test` },
      select: { id: true },
    })),
  );
  const lecture = await db().lecture.create({
    data: {
      name: "Prompt 20 Points Lecture",
      mainSubject: "Verification",
      trackMode: "test",
    },
    select: { id: true },
  });
  return { userIds: users.map((user) => user.id), lectureId: lecture.id };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  const rooms = await db().groupFocusRoom.findMany({
    where: { hostUserId: { in: fixture.userIds } },
    select: { id: true },
  });
  const roomIds = rooms.map((room) => room.id);
  await db().$executeRaw`
    DELETE FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' = ${fixture.userIds[0] ?? ""}
       OR "data"->>'userId' = ${fixture.userIds[1] ?? ""}
  `;
  await db().integritySignal.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().studyPointsLedgerEntry.deleteMany({
    where: {
      userId: { in: fixture.userIds },
      sourceType: "REVERSAL",
    },
  });
  await db().studyPointsLedgerEntry.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().studyEvent.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().groupFocusRun.deleteMany({
    where: { roomId: { in: roomIds } },
  });
  await db().groupFocusMembership.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().groupFocusRoom.deleteMany({
    where: { id: { in: roomIds } },
  });
  await db().focusSession.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().focusPlan.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().studyDailyMetric.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await db().user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await db().lecture.deleteMany({ where: { id: fixture.lectureId } });
}

async function withFixture(
  userCount: number,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture(userCount);
  try {
    await run(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

function focusPlanInput(
  lectureId: string,
  sessionCount = 1,
  focusDurationSeconds = 2_700,
) {
  return {
    title: "Prompt 20 award fixture",
    timezone: "Asia/Baghdad",
    items: [{
      lectureId,
      sequence: 1,
      sessionCount,
      focusDurationSeconds,
      breakDurationSeconds: 600,
      includeMcq: true,
      includeFlashcards: false,
      includeVideo: true,
    }],
  };
}

async function startAndCompleteFocus(
  input: {
    userId: string;
    lectureId: string;
    startAt: Date;
    sessionCount: number;
    focusDurationSeconds?: number;
    serviceAwarder?: StudyPointsAwarder;
  },
): Promise<{ sessionIds: string[]; focus: ReturnType<typeof createFocusService> }> {
  let clock = new Date(input.startAt);
  const focus = createFocusService({
    prisma: db(),
    now: () => new Date(clock),
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
    d1PlanReadsEnabled: () => false,
    d1MetricReadsEnabled: () => false,
    ...(input.serviceAwarder ? { studyPointsAwarder: input.serviceAwarder } : {}),
  });
  const plan = await focus.createPlan(input.userId, focusPlanInput(
    input.lectureId,
    input.sessionCount,
    input.focusDurationSeconds,
  ));
  const sessionIds: string[] = [];
  for (let index = 0; index < input.sessionCount; index += 1) {
    const started = await focus.startSession(input.userId, {
      planId: plan.id,
      planItemId: plan.items[0]!.id,
      idempotencyKey: `prompt20-focus-start-${randomUUID()}`,
      source: "web",
    });
    clock = new Date(input.startAt.getTime() + (index + 1) * 60 * 60 * 1000);
    const completed = await focus.completeSession(input.userId, started.session.id, {
      idempotencyKey: `prompt20-focus-complete-${randomUUID()}`,
    });
    assert.equal(completed.session.status, "COMPLETED");
    sessionIds.push(completed.session.id);
  }
  return { sessionIds, focus };
}

function groupRoomInput(lectureId: string) {
  return createGroupFocusRoomSchema.parse({
    name: "Prompt 20 shared study",
    visibility: "PUBLIC",
    mode: "SHARED_LECTURE",
    sharedLectureId: lectureId,
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 1,
    maxParticipants: 12,
    idempotencyKey: `prompt20-room-${randomUUID()}`,
  });
}

async function createGroupFixture(input: {
  hostUserId: string;
  memberUserId: string;
  lectureId: string;
  runtimeStartedAt: Date;
}): Promise<{
  roomId: string;
  hostMembershipId: string;
  memberMembershipId: string;
}> {
  let serviceClock = new Date(input.runtimeStartedAt.getTime() - 60_000);
  const groupFocus = createGroupFocusService({
    prisma: db(),
    now: () => new Date(serviceClock),
    isEnabled: () => true,
  });
  const room = await groupFocus.createRoom(
    input.hostUserId,
    groupRoomInput(input.lectureId),
  );
  serviceClock = new Date(input.runtimeStartedAt.getTime() + 1_000);
  const member = await groupFocus.joinRoom(
    input.memberUserId,
    room.room.id,
    {},
  );
  return {
    roomId: room.room.id,
    hostMembershipId: room.membership.membershipId,
    memberMembershipId: member.membership.membershipId,
  };
}

function makeGroupSummary(input: {
  roomId: string;
  hostUserId: string;
  hostMembershipId: string;
  memberUserId: string;
  memberMembershipId: string;
  lectureId: string;
  runtimeStartedAt: Date;
  hostVerifiedFocusSeconds?: number;
}): import("../shared/group-focus-reconciliation/contract.js").GroupFocusRuntimeSummary {
  const summaryId = randomUUID().replaceAll("-", "").slice(0, 22);
  const runtimeInstanceId = randomUUID().replaceAll("-", "").slice(0, 22);
  const runtimeEndedAt = new Date(input.runtimeStartedAt.getTime() + 2_700_000);
  const startedAt = input.runtimeStartedAt.toISOString();
  const endedAt = runtimeEndedAt.toISOString();
  const connectedAt = new Date(input.runtimeStartedAt.getTime() + 3_000).toISOString();
  const disconnectedAt = new Date(runtimeEndedAt.getTime() - 1_000).toISOString();
  const hostVerifiedFocusSeconds = input.hostVerifiedFocusSeconds ?? 2_700;
  const hostRounds = [{
    roundNumber: 1,
    verifiedFocusSeconds: hostVerifiedFocusSeconds,
  }];
  return {
    summaryVersion: 1,
    summaryId,
    runtimeInstanceId,
    roomId: input.roomId,
    mode: "SHARED_LECTURE",
    focusDurationSeconds: 2_700,
    breakDurationSeconds: 600,
    roundCount: 1,
    runtimeStartedAt: startedAt,
    runtimeEndedAt: endedAt,
    terminalReason: "COMPLETED",
    completedRounds: 1,
    finalRevision: 3,
    participants: [
      {
        userId: input.hostUserId,
        membershipId: input.hostMembershipId,
        role: "HOST",
        effectiveLectureId: input.lectureId,
        firstConnectedAt: connectedAt,
        lastDisconnectedAt: disconnectedAt,
        reconnectCount: 1,
        verifiedFocusSeconds: hostVerifiedFocusSeconds,
        rounds: hostRounds,
      },
      {
        userId: input.memberUserId,
        membershipId: input.memberMembershipId,
        role: "MEMBER",
        effectiveLectureId: input.lectureId,
        firstConnectedAt: connectedAt,
        lastDisconnectedAt: disconnectedAt,
        reconnectCount: 0,
        verifiedFocusSeconds: 0,
        rounds: [{
          roundNumber: 1,
          verifiedFocusSeconds: 0,
        }],
      },
    ],
  };
}

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";
  process.env.FOCUS_HUB_ENABLED = "true";
  process.env.GROUP_FOCUS_ENABLED = "true";
  process.env.STUDY_EVENTS_ENABLED = "true";
  process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED = "false";

  before(async () => {
    const [
      prismaModule,
      focusModule,
      groupModule,
      runtimeSummaryModule,
      awardModule,
      ledgerModule,
      integrityPersistence,
    ] = await Promise.all([
      import("../server/services/prismaClient.js"),
      import("../server/features/focus/service.js"),
      import("../server/features/group-focus/service.js"),
      import("../server/features/group-focus/runtimeSummary.js"),
      import("../server/features/study-points/awardEngine.js"),
      import("../server/features/study-points/ledger.js"),
      import("../server/features/study-integrity/persistence/index.js"),
    ]);
    prisma = prismaModule.getPrisma() as PrismaClient;
    createFocusService = focusModule.createFocusService;
    createGroupFocusService = groupModule.createGroupFocusService;
    createGroupFocusRuntimeSummaryService =
      runtimeSummaryModule.createGroupFocusRuntimeSummaryService;
    StudyPointsAwardEngine = awardModule.StudyPointsAwardEngine;
    StudyPointsLedgerService = ledgerModule.StudyPointsLedgerService;
    StudyPointsIntegrityService = integrityPersistence.StudyIntegrityService;
    await db().$connect();
  });

  after(async () => {
    await prisma?.$disconnect();
  });
}

test("Focus completion awards and replays in the canonical completion transaction", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const startAt = makePastBaghdadNoon();
    const userId = userIds[0]!;
    let clock = new Date(startAt);
    const focus = createFocusService({
      prisma: db(),
      now: () => new Date(clock),
      isFocusEnabled: () => true,
      isStudyEventsEnabled: () => true,
      d1PlanReadsEnabled: () => false,
      d1MetricReadsEnabled: () => false,
    });
    const plan = await focus.createPlan(userId, focusPlanInput(lectureId));
    const started = await focus.startSession(userId, {
      planId: plan.id,
      planItemId: plan.items[0]!.id,
      idempotencyKey: `prompt20-focus-start-${randomUUID()}`,
      source: "web",
    });
    clock = new Date(startAt.getTime() + 60 * 60 * 1000);
    const completionKey = `prompt20-focus-complete-${randomUUID()}`;
    await focus.completeSession(userId, started.session.id, {
      idempotencyKey: completionKey,
    });
    const beforeReplay = await db().studyPointsLedgerEntry.findMany({
      where: { userId },
      orderBy: { reasonCode: "asc" },
    });
    assert.deepEqual(beforeReplay.map((entry) => [entry.category, entry.reasonCode, entry.amount]), [
      ["CONSISTENCY", "consistency.verified_study_day", 5],
      ["FOCUS", "focus.verified_completion", 12],
    ]);

    const replay = await focus.completeSession(userId, started.session.id, {
      idempotencyKey: completionKey,
    });
    assert.equal(replay.session.status, "COMPLETED");
    const afterReplay = await db().studyPointsLedgerEntry.findMany({ where: { userId } });
    assert.equal(afterReplay.length, beforeReplay.length);
  });
});

test("an unresolved BLOCK signal for the canonical resource suppresses Focus awards", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const userId = userIds[0]!;
    const startAt = makePastBaghdadNoon();
    const { sessionIds } = await startAndCompleteFocus({
      userId,
      lectureId,
      startAt,
      sessionCount: 1,
      serviceAwarder: noOpAwarder,
    });
    const completedAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const envelope = createIntegrityActionEnvelope({
      actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
      userId,
      source: "backend",
      evidenceClass: "SERVER_VALIDATED",
      occurredAt: completedAt,
      receivedAt: completedAt,
      resource: { kind: "focus_session", id: sessionIds[0]! },
    });
    const decision = evaluateIntegrityAction(envelope, {
      idempotency: { result: "CONFLICTING_PAYLOAD" },
    });
    assert.equal(decision.outcome, "REJECT");
    const integrity = new StudyPointsIntegrityService(db());
    await integrity.recordIntegrityDecision({ envelope, decision });

    const engine = new StudyPointsAwardEngine(db(), () => completedAt);
    const result = await engine.awardStudyPointsForSource({
      userId,
      sourceType: "FOCUS_SESSION",
      sourceId: sessionIds[0]!,
      now: completedAt,
    });
    assert.equal(result.attempts[0]?.decision.outcome, "NO_AWARD");
    assert.equal(
      result.attempts[0]?.decision.outcome === "NO_AWARD"
        ? result.attempts[0].decision.reason
        : null,
      "INTEGRITY_BLOCKED",
    );
    assert.equal(await db().studyPointsLedgerEntry.count({ where: { userId } }), 0);
  });
});

test("REVIEW and resolved or dismissed BLOCK signals do not suppress Focus awards", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const [userId] = userIds as [string];
    const reviewer = await db().user.create({
      data: { email: `prompt20-reviewer-${randomUUID()}@example.test`, role: "admin" },
      select: { id: true },
    });
    userIds.push(reviewer.id);
    const integrity = new StudyPointsIntegrityService(db());
    const baseStartAt = makePastBaghdadNoon();
    const cases = [
      { offsetHours: 0, severity: "REVIEW" as const },
      { offsetHours: 4, severity: "BLOCK" as const, reviewAction: "RESOLVE" as const },
      { offsetHours: 8, severity: "BLOCK" as const, reviewAction: "DISMISS" as const },
    ];

    for (const scenario of cases) {
      const startAt = new Date(
        baseStartAt.getTime() + scenario.offsetHours * 60 * 60 * 1000,
      );
      const { sessionIds } = await startAndCompleteFocus({
        userId,
        lectureId,
        startAt,
        sessionCount: 1,
        serviceAwarder: noOpAwarder,
      });
      const sourceId = sessionIds[0]!;
      const completedAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      const envelope = createIntegrityActionEnvelope({
        actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
        userId,
        source: "backend",
        evidenceClass: "SERVER_VALIDATED",
        occurredAt: completedAt,
        receivedAt: completedAt,
        resource: { kind: "focus_session", id: sourceId },
      });

      if (scenario.severity === "REVIEW") {
        const base = evaluateIntegrityAction(envelope);
        await integrity.recordIntegrityDecision({
          envelope,
          decision: {
            ...base,
            outcome: "ALLOW_WITH_OBSERVATION",
            observations: [
              createIntegrityObservation(
                "RATE_WINDOW_EXCEEDED",
                { count: 6, limit: 5, burstAllowance: 0 },
                "REVIEW",
              ),
            ],
          },
        });
      } else {
        const decision = evaluateIntegrityAction(envelope, {
          idempotency: { result: "CONFLICTING_PAYLOAD" },
        });
        assert.equal(decision.outcome, "REJECT");
        await integrity.recordIntegrityDecision({ envelope, decision });
      }

      const signal = await db().integritySignal.findFirstOrThrow({
        where: {
          userId,
          actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
          resourceKind: "focus_session",
          resourceId: sourceId,
        },
      });
      if (scenario.severity === "REVIEW") {
        assert.equal(signal.severity, "REVIEW");
        assert.equal(signal.status, "OPEN");
      } else {
        const reviewed = await integrity.reviewSignal({
          signalId: signal.id,
          reviewerUserId: reviewer.id,
          action: scenario.reviewAction,
          expectedReviewVersion: signal.reviewVersion,
        });
        assert.equal(
          reviewed.signal.status,
          scenario.reviewAction === "RESOLVE" ? "RESOLVED" : "DISMISSED",
        );
      }

      const result = await new StudyPointsAwardEngine(db()).awardStudyPointsForSource({
        userId,
        sourceType: "FOCUS_SESSION",
        sourceId,
        now: new Date(completedAt.getTime() + 2 * 60 * 60 * 1000),
      });
      assert.equal(result.attempts[0]?.decision.outcome, "AWARD");
    }
    assert.equal(await db().studyPointsLedgerEntry.count({
      where: {
        userId,
        category: "FOCUS",
        reasonCode: "focus.verified_completion",
      },
    }), 3);
  });
});

test("Focus below minimum and abandoned completions award nothing", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const userId = userIds[0]!;
    const startAt = makePastBaghdadNoon();
    const short = await startAndCompleteFocus({
      userId,
      lectureId,
      startAt,
      sessionCount: 1,
      focusDurationSeconds: 599,
      serviceAwarder: noOpAwarder,
    });
    const engine = new StudyPointsAwardEngine(db(), () =>
      new Date(startAt.getTime() + 3 * 60 * 60 * 1000)
    );
    const shortResult = await engine.awardStudyPointsForSource({
      userId,
      sourceType: "FOCUS_SESSION",
      sourceId: short.sessionIds[0]!,
      now: new Date(startAt.getTime() + 3 * 60 * 60 * 1000),
    });
    assert.equal(shortResult.attempts[0]?.decision.outcome, "NO_AWARD");
    assert.equal(
      shortResult.attempts[0]?.decision.outcome === "NO_AWARD"
        ? shortResult.attempts[0].decision.reason
        : null,
      "BELOW_MINIMUM",
    );

    let clock = new Date(startAt.getTime() + 4 * 60 * 60 * 1000);
    const focus = createFocusService({
      prisma: db(),
      now: () => new Date(clock),
      isFocusEnabled: () => true,
      isStudyEventsEnabled: () => true,
      d1PlanReadsEnabled: () => false,
      d1MetricReadsEnabled: () => false,
      studyPointsAwarder: noOpAwarder,
    });
    const plan = await focus.createPlan(userId, focusPlanInput(lectureId));
    const started = await focus.startSession(userId, {
      planId: plan.id,
      planItemId: plan.items[0]!.id,
      idempotencyKey: `prompt20-abandoned-start-${randomUUID()}`,
      source: "web",
    });
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    const abandoned = await focus.abandonSession(userId, started.session.id, {
      idempotencyKey: `prompt20-abandoned-${randomUUID()}`,
      reason: "test",
    });
    assert.equal(abandoned.session.status, "ABANDONED");
    const abandonedResult = await engine.awardStudyPointsForSource({
      userId,
      sourceType: "FOCUS_SESSION",
      sourceId: started.session.id,
      now: clock,
    });
    assert.equal(abandonedResult.attempts[0]?.decision.outcome, "NO_AWARD");
    assert.equal(await db().studyPointsLedgerEntry.count({ where: { userId } }), 0);
  });
});

test("Focus completion rolls back its source writes if reward processing fails", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const userId = userIds[0]!;
    let clock = makePastBaghdadNoon();
    const failingAwarder: StudyPointsAwarder = {
      async awardStudyPointsForSource(): Promise<StudyPointsAwardSourceResult> {
        throw new Error("injected Prompt 20 award failure");
      },
    };
    const focus = createFocusService({
      prisma: db(),
      now: () => new Date(clock),
      isFocusEnabled: () => true,
      isStudyEventsEnabled: () => true,
      d1PlanReadsEnabled: () => false,
      d1MetricReadsEnabled: () => false,
      studyPointsAwarder: failingAwarder,
    });
    const plan = await focus.createPlan(userId, focusPlanInput(lectureId));
    const started = await focus.startSession(userId, {
      planId: plan.id,
      planItemId: plan.items[0]!.id,
      idempotencyKey: `prompt20-failed-start-${randomUUID()}`,
      source: "web",
    });
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await assert.rejects(focus.completeSession(userId, started.session.id, {
      idempotencyKey: `prompt20-failed-complete-${randomUUID()}`,
    }), /injected Prompt 20 award failure/u);

    const session = await db().focusSession.findUniqueOrThrow({
      where: { id: started.session.id },
      select: { status: true },
    });
    assert.equal(session.status, "ACTIVE");
    assert.equal(await db().studyEvent.count({
      where: { userId, eventType: "focus_session_completed" },
    }), 0);
    assert.equal(await db().studyPointsLedgerEntry.count({ where: { userId } }), 0);
  });
});

test("Group Focus summary awards only verified participants and commits atomically", {
  skip: skipped,
}, async () => {
  await withFixture(2, async ({ userIds, lectureId }) => {
    const [hostUserId, memberUserId] = userIds as [string, string];
    const runtimeStartedAt = makePastBaghdadNoon();
    const groupFixture = await createGroupFixture({
      hostUserId,
      memberUserId,
      lectureId,
      runtimeStartedAt,
    });
    const summary = makeGroupSummary({
      roomId: groupFixture.roomId,
      hostUserId,
      hostMembershipId: groupFixture.hostMembershipId,
      memberUserId,
      memberMembershipId: groupFixture.memberMembershipId,
      lectureId,
      runtimeStartedAt,
    });
    const failOnce: StudyPointsAwarder = {
      async awardStudyPointsForSource(): Promise<StudyPointsAwardSourceResult> {
        throw new Error("injected Prompt 20 group award failure");
      },
    };
    const failingService = createGroupFocusRuntimeSummaryService({
      prisma: db(),
      studyPointsAwarder: failOnce,
    });
    await assert.rejects(
      failingService.persistTerminalSummary(summary),
      /injected Prompt 20 group award failure/u,
    );
    assert.equal(await db().groupFocusRun.count({
      where: { roomId: groupFixture.roomId },
    }), 0);
    assert.equal(await db().studyEvent.count({
      where: { userId: { in: [hostUserId, memberUserId] } },
    }), 0);
    assert.equal((await db().groupFocusRoom.findUniqueOrThrow({
      where: { id: groupFixture.roomId },
      select: { status: true },
    })).status, "OPEN");

    const runtimeService = createGroupFocusRuntimeSummaryService({ prisma: db() });
    const applied = await runtimeService.persistTerminalSummary(summary);
    assert.equal(applied.status, "APPLIED");
    const hostEntries = await db().studyPointsLedgerEntry.findMany({
      where: { userId: hostUserId },
      orderBy: { reasonCode: "asc" },
    });
    assert.deepEqual(hostEntries.map((entry) => [entry.category, entry.reasonCode, entry.amount]), [
      ["CONSISTENCY", "consistency.verified_study_day", 5],
      ["FOCUS", "group_focus.verified_participation", 12],
      ["FOCUS", "group_focus.verified_social_bonus", 2],
    ]);
    assert.equal(await db().studyPointsLedgerEntry.count({
      where: { userId: memberUserId },
    }), 0);

    const replay = await runtimeService.persistTerminalSummary(summary);
    assert.equal(replay.status, "REPLAY");
    assert.equal(await db().studyPointsLedgerEntry.count({
      where: { userId: hostUserId },
    }), hostEntries.length);
  });
});

test("Group Focus grants only three social bonuses per Baghdad day", {
  skip: skipped,
}, async () => {
  await withFixture(2, async ({ userIds, lectureId }) => {
    const [hostUserId, memberUserId] = userIds as [string, string];
    const dayNoon = makePastBaghdadNoon();
    const runtimeService = createGroupFocusRuntimeSummaryService({ prisma: db() });

    for (let index = 0; index < 4; index += 1) {
      const runtimeStartedAt = new Date(dayNoon.getTime() + index * 60 * 60 * 1000);
      const groupFixture = await createGroupFixture({
        hostUserId,
        memberUserId,
        lectureId,
        runtimeStartedAt,
      });
      const summary = makeGroupSummary({
        roomId: groupFixture.roomId,
        hostUserId,
        hostMembershipId: groupFixture.hostMembershipId,
        memberUserId,
        memberMembershipId: groupFixture.memberMembershipId,
        lectureId,
        runtimeStartedAt,
      });
      const result = await runtimeService.persistTerminalSummary(summary);
      assert.equal(result.status, "APPLIED");
    }

    assert.equal(await db().studyPointsLedgerEntry.count({
      where: {
        userId: hostUserId,
        reasonCode: "group_focus.verified_participation",
      },
    }), 4);
    const socialRows = await db().studyPointsLedgerEntry.findMany({
      where: {
        userId: hostUserId,
        reasonCode: "group_focus.verified_social_bonus",
      },
    });
    assert.equal(socialRows.length, 3);
    assert.equal(socialRows.reduce((sum, row) => sum + row.amount, 0), 6);
  });
});

test("daily consistency triggers at 1,500 seconds and remains unique under concurrent replay", {
  skip: skipped,
}, async () => {
  await withFixture(2, async ({ userIds, lectureId }) => {
    const [hostUserId, memberUserId] = userIds as [string, string];
    const firstStartedAt = makePastBaghdadNoon();
    const secondStartedAt = new Date(firstStartedAt.getTime() + 60 * 60 * 1000);
    const firstGroup = await createGroupFixture({
      hostUserId,
      memberUserId,
      lectureId,
      runtimeStartedAt: firstStartedAt,
    });
    const secondGroup = await createGroupFixture({
      hostUserId,
      memberUserId,
      lectureId,
      runtimeStartedAt: secondStartedAt,
    });
    const firstSummary = makeGroupSummary({
      roomId: firstGroup.roomId,
      hostUserId,
      hostMembershipId: firstGroup.hostMembershipId,
      memberUserId,
      memberMembershipId: firstGroup.memberMembershipId,
      lectureId,
      runtimeStartedAt: firstStartedAt,
      hostVerifiedFocusSeconds: 1_499,
    });
    const secondSummary = makeGroupSummary({
      roomId: secondGroup.roomId,
      hostUserId,
      hostMembershipId: secondGroup.hostMembershipId,
      memberUserId,
      memberMembershipId: secondGroup.memberMembershipId,
      lectureId,
      runtimeStartedAt: secondStartedAt,
      hostVerifiedFocusSeconds: 1,
    });
    const runtimeService = createGroupFocusRuntimeSummaryService({
      prisma: db(),
      studyPointsAwarder: noOpAwarder,
    });
    assert.equal((await runtimeService.persistTerminalSummary(firstSummary)).status, "APPLIED");
    const firstRun = await db().groupFocusRun.findFirstOrThrow({
      where: { roomId: firstGroup.roomId },
      select: { id: true },
    });
    const evaluationTime = new Date(secondStartedAt.getTime() + 4 * 60 * 60 * 1000);
    const engine = new StudyPointsAwardEngine(db(), () => evaluationTime);
    const belowThreshold = await engine.awardStudyPointsForSource({
      userId: hostUserId,
      sourceType: "GROUP_FOCUS_RUN",
      sourceId: firstRun.id,
      now: evaluationTime,
    });
    assert.equal(belowThreshold.attempts[2]?.decision.outcome, "NO_AWARD");
    assert.equal(
      belowThreshold.attempts[2]?.decision.outcome === "NO_AWARD"
        ? belowThreshold.attempts[2].decision.reason
        : null,
      "BELOW_MINIMUM",
    );
    assert.equal(await db().studyPointsLedgerEntry.count({
      where: {
        userId: hostUserId,
        category: "CONSISTENCY",
      },
    }), 0);

    assert.equal((await runtimeService.persistTerminalSummary(secondSummary)).status, "APPLIED");
    const secondRun = await db().groupFocusRun.findFirstOrThrow({
      where: { roomId: secondGroup.roomId },
      select: { id: true },
    });
    const awards = await Promise.all([firstRun.id, secondRun.id].map((sourceId) =>
      engine.awardStudyPointsForSource({
        userId: hostUserId,
        sourceType: "GROUP_FOCUS_RUN",
        sourceId,
        now: evaluationTime,
      })
    ));
    const consistencyRows = await db().studyPointsLedgerEntry.findMany({
      where: {
        userId: hostUserId,
        category: "CONSISTENCY",
        reasonCode: "consistency.verified_study_day",
      },
    });
    assert.equal(awards.length, 2);
    assert.equal(consistencyRows.length, 1);
    assert.equal(consistencyRows[0]?.amount, 5);

    const replay = await engine.awardStudyPointsForSource({
      userId: hostUserId,
      sourceType: "GROUP_FOCUS_RUN",
      sourceId: firstRun.id,
      now: evaluationTime,
    });
    assert.equal(replay.attempts[2]?.replayed, true);
    assert.equal(await db().studyPointsLedgerEntry.count({
      where: {
        userId: hostUserId,
        category: "CONSISTENCY",
        reasonCode: "consistency.verified_study_day",
      },
    }), 1);
  });
});

test("cross-midnight Group Focus does not count toward daily consistency", {
  skip: skipped,
}, async () => {
  await withFixture(2, async ({ userIds, lectureId }) => {
    const [hostUserId, memberUserId] = userIds as [string, string];
    const runtimeStartedAt = new Date(
      makePastBaghdadNoon().getTime() + 11.5 * 60 * 60 * 1000,
    );
    const groupFixture = await createGroupFixture({
      hostUserId,
      memberUserId,
      lectureId,
      runtimeStartedAt,
    });
    const summary = makeGroupSummary({
      roomId: groupFixture.roomId,
      hostUserId,
      hostMembershipId: groupFixture.hostMembershipId,
      memberUserId,
      memberMembershipId: groupFixture.memberMembershipId,
      lectureId,
      runtimeStartedAt,
    });
    assert.notEqual(
      studyPointsBaghdadDate(runtimeStartedAt),
      studyPointsBaghdadDate(new Date(runtimeStartedAt.getTime() + 2_700_000)),
    );

    const runtimeService = createGroupFocusRuntimeSummaryService({ prisma: db() });
    const result = await runtimeService.persistTerminalSummary(summary);
    assert.equal(result.status, "APPLIED");
    const rows = await db().studyPointsLedgerEntry.findMany({
      where: { userId: hostUserId },
      orderBy: { reasonCode: "asc" },
    });
    assert.deepEqual(rows.map((row) => [row.reasonCode, row.amount]), [
      ["group_focus.verified_participation", 12],
      ["group_focus.verified_social_bonus", 2],
    ]);
  });
});

test("serialized daily caps include reversals and allow only a distinct source to use released capacity", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const userId = userIds[0]!;
    const startAt = makePastBaghdadNoon();
    const { sessionIds } = await startAndCompleteFocus({
      userId,
      lectureId,
      startAt,
      sessionCount: 2,
      serviceAwarder: noOpAwarder,
    });
    const ledger = new StudyPointsLedgerService(db());
    const seedFocus = await ledger.appendStudyPointsLedgerEntry({
      userId,
      amount: 55,
      category: "FOCUS",
      reasonCode: "prompt20.test_seed",
      sourceType: "ADMIN_ADJUSTMENT",
      sourceId: `seed-focus-${randomUUID()}`,
      ruleVersion: "prompt20-test-v1",
      idempotencyKey: `prompt20-seed-focus-${randomUUID()}`,
      effectiveAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    });
    await ledger.appendStudyPointsLedgerEntry({
      userId,
      amount: 30,
      category: "MASTERY",
      reasonCode: "prompt20.test_seed",
      sourceType: "ADMIN_ADJUSTMENT",
      sourceId: `seed-mastery-${randomUUID()}`,
      ruleVersion: "prompt20-test-v1",
      idempotencyKey: `prompt20-seed-mastery-${randomUUID()}`,
      effectiveAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    });
    await ledger.appendStudyPointsLedgerEntry({
      userId,
      amount: 5,
      category: "CONSISTENCY",
      reasonCode: "prompt20.test_seed",
      sourceType: "ADMIN_ADJUSTMENT",
      sourceId: `seed-consistency-${randomUUID()}`,
      ruleVersion: "prompt20-test-v1",
      idempotencyKey: `prompt20-seed-consistency-${randomUUID()}`,
      effectiveAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    });

    const engine = new StudyPointsAwardEngine(db(), () =>
      new Date(startAt.getTime() + 3 * 60 * 60 * 1000)
    );
    const concurrent = await Promise.all(sessionIds.map((sourceId) =>
      engine.awardStudyPointsForSource({
        userId,
        sourceType: "FOCUS_SESSION",
        sourceId,
        now: new Date(startAt.getTime() + 3 * 60 * 60 * 1000),
      })
    ));
    const positiveFocusAwards = await db().studyPointsLedgerEntry.findMany({
      where: {
        userId,
        category: "FOCUS",
        reasonCode: "focus.verified_completion",
        sourceType: "FOCUS_SESSION",
      },
    });
    assert.equal(positiveFocusAwards.length, 1);
    assert.equal(positiveFocusAwards[0]?.amount, 5);

    const reversed = await ledger.reverseStudyPointsLedgerEntry({
      userId,
      entryId: positiveFocusAwards[0]!.id,
      reasonCode: "prompt20.test_reversal",
      ruleVersion: "prompt20-test-v1",
      idempotencyKey: `prompt20-reversal-${randomUUID()}`,
      effectiveAt: positiveFocusAwards[0]!.effectiveAt,
    });
    assert.equal(reversed.entry.amount, -5);

    const awardedSourceId = positiveFocusAwards[0]!.sourceId!;
    const originalReplay = await engine.awardStudyPointsForSource({
      userId,
      sourceType: "FOCUS_SESSION",
      sourceId: awardedSourceId,
      now: new Date(startAt.getTime() + 3 * 60 * 60 * 1000),
    });
    assert.equal(originalReplay.attempts[0]?.replayed, true);
    assert.equal(await db().studyPointsLedgerEntry.count({
      where: {
        userId,
        category: "FOCUS",
        reasonCode: "focus.verified_completion",
        sourceType: "FOCUS_SESSION",
        sourceId: awardedSourceId,
      },
    }), 1);

    const distinctSourceId = sessionIds.find((sessionId) => sessionId !== awardedSourceId)!;
    const newlyAwarded = await engine.awardStudyPointsForSource({
      userId,
      sourceType: "FOCUS_SESSION",
      sourceId: distinctSourceId,
      now: new Date(startAt.getTime() + 3 * 60 * 60 * 1000),
    });
    assert.equal(newlyAwarded.attempts[0]?.decision.outcome, "AWARD");
    assert.equal(
      newlyAwarded.attempts[0]?.decision.outcome === "AWARD"
        ? newlyAwarded.attempts[0].decision.amount
        : 0,
      5,
    );

    const bounds = await db().$transaction(async (tx) => {
      const { getStudyPointsBaghdadDayBounds, getStudyPointsDailyUsage } =
        await import("../server/features/study-points/caps.js");
      const baghdadDate = studyPointsBaghdadDate(startAt);
      const day = await getStudyPointsBaghdadDayBounds(tx, baghdadDate);
      return getStudyPointsDailyUsage(tx, userId, day);
    });
    assert.equal(bounds.byCategory.FOCUS, 60);
    assert.equal(bounds.byCategory.MASTERY, 30);
    assert.equal(bounds.byCategory.CONSISTENCY, 5);
    assert.equal(bounds.total, 95);
    assert.equal(concurrent.length, 2);
    assert.equal(seedFocus.entry.amount, 55);
  });
});

test("serialized total cap partially awards the first concurrent source", {
  skip: skipped,
}, async () => {
  await withFixture(1, async ({ userIds, lectureId }) => {
    const userId = userIds[0]!;
    const startAt = makePastBaghdadNoon();
    const { sessionIds } = await startAndCompleteFocus({
      userId,
      lectureId,
      startAt,
      sessionCount: 2,
      serviceAwarder: noOpAwarder,
    });
    const ledger = new StudyPointsLedgerService(db());
    const seedTime = new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
    const seeds = [
      { category: "FOCUS" as const, amount: 20 },
      { category: "MASTERY" as const, amount: 40 },
      { category: "PROGRESS" as const, amount: 30 },
      { category: "CONSISTENCY" as const, amount: 5 },
    ];
    for (const [index, seed] of seeds.entries()) {
      await ledger.appendStudyPointsLedgerEntry({
        userId,
        amount: seed.amount,
        category: seed.category,
        reasonCode: "prompt20.test_seed",
        sourceType: "ADMIN_ADJUSTMENT",
        sourceId: `total-cap-seed-${index}-${randomUUID()}`,
        ruleVersion: "prompt20-test-v1",
        idempotencyKey: `prompt20-total-cap-seed-${index}-${randomUUID()}`,
        effectiveAt: seedTime,
      });
    }

    const engine = new StudyPointsAwardEngine(db(), () =>
      new Date(startAt.getTime() + 3 * 60 * 60 * 1000)
    );
    const concurrent = await Promise.all(sessionIds.map((sourceId) =>
      engine.awardStudyPointsForSource({
        userId,
        sourceType: "FOCUS_SESSION",
        sourceId,
        now: new Date(startAt.getTime() + 3 * 60 * 60 * 1000),
      })
    ));
    const awards = await db().studyPointsLedgerEntry.findMany({
      where: {
        userId,
        category: "FOCUS",
        reasonCode: "focus.verified_completion",
        sourceType: "FOCUS_SESSION",
      },
    });
    assert.equal(awards.length, 1);
    assert.equal(awards[0]?.amount, 5);
    assert.equal(concurrent.length, 2);

    const { getStudyPointsBaghdadDayBounds, getStudyPointsDailyUsage } =
      await import("../server/features/study-points/caps.js");
    const bounds = await db().$transaction(async (tx) => {
      const dayBounds = await getStudyPointsBaghdadDayBounds(
        tx,
        studyPointsBaghdadDate(startAt),
      );
      return getStudyPointsDailyUsage(tx, userId, dayBounds);
    });
    assert.equal(bounds.byCategory.FOCUS, 25);
    assert.equal(bounds.byCategory.MASTERY, 40);
    assert.equal(bounds.byCategory.PROGRESS, 30);
    assert.equal(bounds.byCategory.CONSISTENCY, 5);
    assert.equal(bounds.total, 100);
  });
});