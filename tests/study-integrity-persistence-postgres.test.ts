import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import {
  INTEGRITY_ACTION_TYPES,
  createIntegrityActionEnvelope,
  createIntegrityObservation,
  evaluateIntegrityAction,
} from "../server/features/study-integrity/index.js";
import type { IntegrityObservationSeverity } from "../server/features/study-integrity/constants.js";
import type {
  IntegrityActionEnvelope,
  IntegrityDecision,
} from "../server/features/study-integrity/types.js";
import {
  getPrompt18IntegrityPostgresGateUrl,
} from "./helpers/prompt18IntegrityPostgresGate.js";

const databaseUrl = getPrompt18IntegrityPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 18 disposable-schema test markers to run.";
const BASE_TIME = new Date("2026-09-25T10:00:00.000Z");

type Fixture = {
  userIds: string[];
  reviewerId: string;
};

let prisma: PrismaClient | undefined;
let service: import("../server/features/study-integrity/persistence/index.js").StudyIntegrityService;

function client(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

function makeEnvelope(
  userId: string,
  receivedAt = BASE_TIME,
  resource?: { kind: string; id: string },
): IntegrityActionEnvelope {
  return createIntegrityActionEnvelope({
    actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START,
    userId,
    source: "ios",
    evidenceClass: "CLIENT_OBSERVED",
    occurredAt: new Date(receivedAt.getTime() - 1_000),
    receivedAt,
    ...(resource ? { resource } : {}),
  });
}

function conflictDecision(envelope: IntegrityActionEnvelope): IntegrityDecision {
  return evaluateIntegrityAction(envelope, {
    idempotency: { result: "CONFLICTING_PAYLOAD" },
  });
}

function rateDecision(
  envelope: IntegrityActionEnvelope,
  severity: IntegrityObservationSeverity,
  count: number,
): IntegrityDecision {
  const base = evaluateIntegrityAction(envelope);
  return {
    ...base,
    outcome: severity === "BLOCK" ? "REJECT" : "ALLOW_WITH_OBSERVATION",
    observations: [
      createIntegrityObservation(
        "RATE_WINDOW_EXCEEDED",
        {
          count,
          limit: 5,
          burstAllowance: 0,
          token: "must-not-be-stored",
          note: "private source text",
        },
        severity,
      ),
    ],
  };
}

async function createFixture(userCount = 1): Promise<Fixture> {
  const suffix = randomUUID();
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, index) =>
      client().user.create({
        data: {
          email: `prompt18-${suffix}-${index}@example.test`,
          role: "user",
        },
      }),
    ),
  );
  const reviewer = await client().user.create({
    data: {
      email: `prompt18-reviewer-${suffix}@example.test`,
      role: "admin",
    },
  });
  return { userIds: users.map((user) => user.id), reviewerId: reviewer.id };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await client().user.deleteMany({
    where: { id: { in: [...fixture.userIds, fixture.reviewerId] } },
  });
}

async function withFixture(
  run: (fixture: Fixture) => Promise<void>,
  userCount = 1,
): Promise<void> {
  const fixture = await createFixture(userCount);
  try {
    await run(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";
  process.env.STUDY_EVENTS_ENABLED = "false";
  process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED = "false";

  before(async () => {
    const [{ getPrisma }, persistence] = await Promise.all([
      import("../server/services/prismaClient.js"),
      import("../server/features/study-integrity/persistence/index.js"),
    ]);
    prisma = getPrisma() as PrismaClient;
    service = new persistence.StudyIntegrityService(client());
    await client().$connect();
  });

  after(async () => {
    await prisma?.$disconnect();
  });
}

test("20 concurrent identical observations produce one row and no lost increments", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds }) => {
    const envelope = makeEnvelope(userIds[0]!);
    const decision = conflictDecision(envelope);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.recordIntegrityDecision({ envelope, decision }),
      ),
    );
    assert.equal(results.filter((result) => result.persisted).length, 20);

    const signals = await client().integritySignal.findMany({
      where: { userId: userIds[0] },
    });
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.occurrenceCount, 20);
    assert.equal(signals[0]?.firstOccurredAt.getTime(), envelope.occurredAt.getTime());
    assert.equal(signals[0]?.lastReceivedAt.getTime(), envelope.receivedAt.getTime());
  });
});

test("deduplication stays user/resource scoped and uses 24-hour receipt buckets", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds }) => {
    const firstUser = userIds[0]!;
    const secondUser = userIds[1]!;
    const resourceA = { kind: "focus-session", id: "session-a" };
    const firstEnvelope = makeEnvelope(firstUser, BASE_TIME, resourceA);
    const secondUserEnvelope = makeEnvelope(secondUser, BASE_TIME, resourceA);
    const otherResourceEnvelope = makeEnvelope(
      firstUser,
      BASE_TIME,
      { kind: "focus-session", id: "session-b" },
    );
    const decision = (envelope: IntegrityActionEnvelope) =>
      conflictDecision(envelope);

    await Promise.all([
      service.recordIntegrityDecision({
        envelope: firstEnvelope,
        decision: decision(firstEnvelope),
      }),
      service.recordIntegrityDecision({
        envelope: secondUserEnvelope,
        decision: decision(secondUserEnvelope),
      }),
      service.recordIntegrityDecision({
        envelope: otherResourceEnvelope,
        decision: decision(otherResourceEnvelope),
      }),
    ]);
    assert.equal(
      await client().integritySignal.count({ where: { userId: firstUser } }),
      2,
    );
    assert.equal(
      await client().integritySignal.count({ where: { userId: secondUser } }),
      1,
    );

    const nextBucketEnvelope = makeEnvelope(
      firstUser,
      new Date(BASE_TIME.getTime() + 25 * 60 * 60 * 1000),
      resourceA,
    );
    await service.recordIntegrityDecision({
      envelope: nextBucketEnvelope,
      decision: decision(nextBucketEnvelope),
    });
    assert.equal(
      await client().integritySignal.count({ where: { userId: firstUser } }),
      3,
    );
  }, 2);
});

test("final dispositions keep history and a repeat starts a new generation", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds, reviewerId }) => {
    const envelope = makeEnvelope(userIds[0]!);
    const decision = conflictDecision(envelope);
    await service.recordIntegrityDecision({ envelope, decision });
    const original = await client().integritySignal.findFirstOrThrow({
      where: { userId: userIds[0] },
    });
    await service.reviewSignal({
      signalId: original.id,
      reviewerUserId: reviewerId,
      action: "DISMISS",
      expectedReviewVersion: 0,
      note: "No further technical follow-up.",
    });

    const repeatEnvelope = makeEnvelope(
      userIds[0]!,
      new Date(BASE_TIME.getTime() + 60_000),
    );
    await service.recordIntegrityDecision({
      envelope: repeatEnvelope,
      decision: conflictDecision(repeatEnvelope),
    });
    const generations = await client().integritySignal.findMany({
      where: {
        userId: userIds[0],
        signalFingerprint: original.signalFingerprint,
        dedupBucket: original.dedupBucket,
      },
      orderBy: { generation: "asc" },
      include: { reviewActions: true },
    });
    assert.equal(generations.length, 2);
    assert.equal(generations[0]?.status, "DISMISSED");
    assert.equal(generations[0]?.occurrenceCount, 1);
    assert.equal(generations[0]?.reviewActions.length, 1);
    assert.equal(generations[1]?.status, "OPEN");
    assert.equal(generations[1]?.generation, 1);
    assert.equal(generations[1]?.occurrenceCount, 1);
  });
});

test("severity escalates only upward while latest sanitized details refresh", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds }) => {
    const envelope = makeEnvelope(userIds[0]!);
    for (const [severity, count] of [
      ["REVIEW", 6],
      ["BLOCK", 7],
      ["REVIEW", 8],
    ] as const) {
      await service.recordIntegrityDecision({
        envelope,
        decision: rateDecision(envelope, severity, count),
      });
    }
    const signal = await client().integritySignal.findFirstOrThrow({
      where: { userId: userIds[0] },
    });
    assert.equal(signal.severity, "BLOCK");
    assert.equal(signal.occurrenceCount, 3);
    assert.deepEqual(signal.latestSafeDetails, {
      burstAllowance: 0,
      count: 8,
      limit: 5,
    });
    assert.doesNotMatch(
      JSON.stringify(signal.latestSafeDetails),
      /must-not-be-stored|private source text/u,
    );
  });
});

test("rule versions remain separate and INFO replay observations are not stored", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds }) => {
    const envelope = makeEnvelope(userIds[0]!);
    const versionOne = conflictDecision(envelope);
    const versionTwo = { ...versionOne, ruleVersion: "study-integrity-v2" };
    await service.recordIntegrityDecision({ envelope, decision: versionOne });
    await service.recordIntegrityDecision({ envelope, decision: versionTwo });
    assert.equal(
      await client().integritySignal.count({ where: { userId: userIds[0] } }),
      2,
    );

    const replay = evaluateIntegrityAction(envelope, {
      idempotency: { result: "REPLAY_SAME_PAYLOAD" },
    });
    const result = await service.recordIntegrityDecision({
      envelope,
      decision: replay,
    });
    assert.equal(result.persisted, false);
    assert.equal(
      result.observations[0]?.persisted === false
        ? result.observations[0].reason
        : undefined,
      "INFO",
    );
    assert.equal(
      await client().integritySignal.count({ where: { userId: userIds[0] } }),
      2,
    );
  });
});

test("review uses expected versions, immutable history, and safe internal context queries", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds, reviewerId }) => {
    const envelope = makeEnvelope(userIds[0]!);
    await service.recordIntegrityDecision({
      envelope,
      decision: conflictDecision(envelope),
    });
    const signal = await client().integritySignal.findFirstOrThrow({
      where: { userId: userIds[0] },
    });

    await assert.rejects(
      service.reviewSignal({
        signalId: signal.id,
        reviewerUserId: reviewerId,
        action: "REOPEN",
        expectedReviewVersion: 0,
      }),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "INVALID_TRANSITION",
    );

    const acknowledged = await service.reviewSignal({
      signalId: signal.id,
      reviewerUserId: reviewerId,
      action: "ACKNOWLEDGE",
      expectedReviewVersion: 0,
    });
    assert.equal(acknowledged.signal.status, "ACKNOWLEDGED");
    assert.equal(acknowledged.signal.reviewVersion, 1);

    await assert.rejects(
      service.reviewSignal({
        signalId: signal.id,
        reviewerUserId: reviewerId,
        action: "RESOLVE",
        expectedReviewVersion: 0,
      }),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "REVIEW_VERSION_CONFLICT",
    );

    const resolved = await service.reviewSignal({
      signalId: signal.id,
      reviewerUserId: reviewerId,
      action: "RESOLVE",
      expectedReviewVersion: 1,
    });
    assert.equal(resolved.signal.status, "RESOLVED");
    assert.ok(resolved.signal.resolvedAt);
    const reopened = await service.reviewSignal({
      signalId: signal.id,
      reviewerUserId: reviewerId,
      action: "REOPEN",
      expectedReviewVersion: 2,
    });
    assert.equal(reopened.signal.status, "OPEN");
    assert.equal(reopened.signal.resolvedAt, null);
    const noted = await service.reviewSignal({
      signalId: signal.id,
      reviewerUserId: reviewerId,
      action: "ADD_NOTE",
      expectedReviewVersion: 3,
      note: "Internal technical review only.",
    });
    assert.equal(noted.signal.status, "OPEN");
    assert.equal(noted.signal.reviewVersion, 4);

    const detail = await service.getSignalDetail(signal.id);
    assert.equal(detail?.reviewHistory.length, 4);
    assert.deepEqual(
      detail?.reviewHistory.map(({ fromStatus, toStatus, actionType }) => ({
        fromStatus,
        toStatus,
        actionType,
      })),
      [
        { fromStatus: "OPEN", toStatus: "ACKNOWLEDGED", actionType: "ACKNOWLEDGE" },
        { fromStatus: "ACKNOWLEDGED", toStatus: "RESOLVED", actionType: "RESOLVE" },
        { fromStatus: "RESOLVED", toStatus: "OPEN", actionType: "REOPEN" },
        { fromStatus: "OPEN", toStatus: "OPEN", actionType: "ADD_NOTE" },
      ],
    );

    const context = await service.getUserIntegrityContext({
      userId: userIds[0]!,
      since: new Date(BASE_TIME.getTime() - 10_000),
      actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START,
    });
    assert.equal(context.openBlockSignals, 1);
    assert.equal(context.recentIdempotencyConflicts, 1);
    assert.equal(context.lastSignalAt?.getTime(), envelope.occurredAt.getTime());

    const scopedBlock = await service.hasBlockingIntegritySignal({
      userId: userIds[0]!,
      actionType: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START,
      since: new Date(BASE_TIME.getTime() - 10_000),
    });
    assert.equal(scopedBlock.blocked, true);
    assert.equal(scopedBlock.signals.length, 1);
  });
});

test("review row and status change roll back together when audit insertion fails", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds }) => {
    const envelope = makeEnvelope(userIds[0]!);
    await service.recordIntegrityDecision({
      envelope,
      decision: conflictDecision(envelope),
    });
    const signal = await client().integritySignal.findFirstOrThrow({
      where: { userId: userIds[0] },
    });
    await assert.rejects(
      service.reviewSignal({
        signalId: signal.id,
        reviewerUserId: randomUUID(),
        action: "ACKNOWLEDGE",
        expectedReviewVersion: 0,
      }),
    );

    const unchanged = await client().integritySignal.findUniqueOrThrow({
      where: { id: signal.id },
    });
    assert.equal(unchanged.status, "OPEN");
    assert.equal(unchanged.reviewVersion, 0);
    assert.equal(
      await client().integrityReviewAction.count({
        where: { signalId: signal.id },
      }),
      0,
    );
  });
});

test("concurrent reviews cannot silently overwrite one another", {
  skip: skipped,
}, async () => {
  await withFixture(async ({ userIds, reviewerId }) => {
    const envelope = makeEnvelope(userIds[0]!);
    await service.recordIntegrityDecision({
      envelope,
      decision: conflictDecision(envelope),
    });
    const signal = await client().integritySignal.findFirstOrThrow({
      where: { userId: userIds[0] },
    });
    const outcomes = await Promise.allSettled([
      service.reviewSignal({
        signalId: signal.id,
        reviewerUserId: reviewerId,
        action: "ACKNOWLEDGE",
        expectedReviewVersion: 0,
      }),
      service.reviewSignal({
        signalId: signal.id,
        reviewerUserId: reviewerId,
        action: "DISMISS",
        expectedReviewVersion: 0,
      }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(
      rejected.reason instanceof Error
      && "code" in rejected.reason
      && rejected.reason.code === "REVIEW_VERSION_CONFLICT",
    );
    assert.equal(
      await client().integrityReviewAction.count({
        where: { signalId: signal.id },
      }),
      1,
    );
  });
});