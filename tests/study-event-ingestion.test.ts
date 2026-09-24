import assert from "node:assert/strict";
import test from "node:test";

import {
  createStudyEventIngestionService,
  getBaghdadMetricDate,
  reduceStudyDailyMetric,
  STUDY_EVENT_POLICY_REGISTRY,
  STUDY_EVENT_TYPES,
  StudyEventError,
  type IngestStudyEventInput,
  type StudyEventRepository,
  type StudyEventTransaction,
} from "../server/features/study-events/index.js";
import { enqueuePrivateD1Projection } from "../server/services/privateD1Sync.js";
import {
  DEFAULT_STUDY_FEATURE_FLAGS,
  isStudyFeatureEnabled,
} from "../server/features/study-core/featureFlags.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function uniqueViolation() {
  return Object.assign(new Error("duplicate"), {
    code: "P2002",
    meta: { target: ["userId", "idempotencyKey"] },
  });
}

class MemoryRepository implements StudyEventRepository {
  events: Record<string, unknown>[] = [];
  metrics = new Map<string, Record<string, unknown>>();
  projections: Record<string, unknown>[] = [];
  transactionCount = 0;
  focusSessionOwner: string | null = "user-1";
  private id = 0;
  private transactionTail: Promise<void> = Promise.resolve();

  async findByIdempotency(userId: string, idempotencyKey: string) {
    return this.events.find((event) =>
      event.userId === userId && event.idempotencyKey === idempotencyKey,
    ) ?? null;
  }

  async validateReference(
    _tx: StudyEventTransaction,
    reference: { field: string; id: string; userId: string },
  ) {
    if (reference.field === "focusSessionId" && this.focusSessionOwner !== reference.userId) {
      throw new StudyEventError("OWNERSHIP_MISMATCH", "Focus session belongs to another user.");
    }
  }

  async transaction<T>(callback: (tx: StudyEventTransaction) => Promise<T>): Promise<T> {
    let release = () => {};
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    this.transactionCount += 1;
    const events = structuredClone(this.events);
    const metrics = structuredClone(this.metrics);
    const projections = structuredClone(this.projections);
    const tx = {
      studyEvent: {
        findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) =>
          events.find((event) =>
            event.userId === where.userId_idempotencyKey.userId &&
            event.idempotencyKey === where.userId_idempotencyKey.idempotencyKey,
          ) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (events.some((event) =>
            event.userId === data.userId && event.idempotencyKey === data.idempotencyKey,
          )) throw uniqueViolation();
          const row = { ...data, id: `event-${++this.id}`, createdAt: NOW };
          events.push(row);
          return row;
        },
      },
      studyDailyMetric: {
        upsert: async (args: {
          where: { userId_metricDate: { userId: string; metricDate: Date } };
          create: Record<string, unknown>;
          update: Record<string, { increment: number }>;
        }) => {
          const { userId, metricDate } = args.where.userId_metricDate;
          const date = metricDate.toISOString().slice(0, 10);
          const key = `${userId}:${date}`;
          const current = metrics.get(key);
          const row = current ?? {
            id: `metric-${key}`,
            userId,
            metricDate,
            focusSeconds: 0,
            sessionsCompleted: 0,
            mcqAttempts: 0,
            mcqCorrect: 0,
            flashcardReviews: 0,
            recallAttempts: 0,
            recallCorrect: 0,
            lectureCompletions: 0,
            interruptionCount: 0,
            updatedAt: NOW,
          };
          if (current) {
            for (const [field, increment] of Object.entries(args.update)) {
              row[field] = Number(row[field] || 0) + increment.increment;
            }
          } else {
            Object.assign(row, args.create);
          }
          metrics.set(key, row);
          return row;
        },
      },
      lecture: { findUnique: async () => ({ id: "lecture-1" }) },
      material: { findUnique: async () => ({ id: "material-1" }) },
      mcq: { findUnique: async () => ({ id: "mcq-1" }) },
      flashcard: { findUnique: async () => ({ id: "flashcard-1" }) },
      focusSession: { findUnique: async () => ({ id: "focus-1", userId: this.focusSessionOwner }) },
      $queryRawUnsafe: async (query: string, ...args: unknown[]) => {
        if (query === "MOCK_OUTBOX") projections.push(args[0] as Record<string, unknown>);
        return [];
      },
    } as unknown as StudyEventTransaction;

    try {
      const result = await callback(tx);
      this.events = events;
      this.metrics = metrics;
      this.projections = projections;
      return result;
    } finally {
      release();
    }
  }
}

function makeService(): {
  service: ReturnType<typeof createStudyEventIngestionService>;
  repository: MemoryRepository;
};
function makeService(
  repository: MemoryRepository,
  options?: {
    isEnabled?: () => boolean;
    enqueueProjection?: (
      tx: StudyEventTransaction,
      projection: Record<string, unknown>,
    ) => Promise<unknown>;
    now?: () => Date;
  },
): { service: ReturnType<typeof createStudyEventIngestionService>; repository: MemoryRepository };
function makeService(
  repository: StudyEventRepository,
  options?: {
    isEnabled?: () => boolean;
    enqueueProjection?: (
      tx: StudyEventTransaction,
      projection: Record<string, unknown>,
    ) => Promise<unknown>;
    now?: () => Date;
  },
): { service: ReturnType<typeof createStudyEventIngestionService>; repository: StudyEventRepository };
function makeService(
  repository: StudyEventRepository = new MemoryRepository(),
  options: {
    isEnabled?: () => boolean;
    enqueueProjection?: (
      tx: StudyEventTransaction,
      projection: Record<string, unknown>,
    ) => Promise<unknown>;
    now?: () => Date;
  } = {},
) {
  const service = createStudyEventIngestionService({
    repository,
    isEnabled: options.isEnabled ?? (() => true),
    now: options.now ?? (() => new Date(NOW)),
    enqueueProjection: options.enqueueProjection ?? ((tx, projection) =>
      tx.$queryRawUnsafe("MOCK_OUTBOX", projection)),
  });
  return { service, repository };
}

function focusCompletion(overrides: Partial<IngestStudyEventInput> = {}) {
  return {
    eventType: "focus_session_completed",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "focus-complete-0001",
    focusSessionId: "focus-1",
    evidenceClass: "SERVER_VALIDATED",
    payload: { activeSeconds: 2700, pauseSeconds: 300 },
    ...overrides,
  } as IngestStudyEventInput;
}

test("all frozen Study Event types have centralized policy", () => {
  assert.deepEqual(Object.keys(STUDY_EVENT_POLICY_REGISTRY).sort(), [...STUDY_EVENT_TYPES].sort());
  for (const eventType of STUDY_EVENT_TYPES) {
    const policy = STUDY_EVENT_POLICY_REGISTRY[eventType];
    assert.ok(policy.minimumEvidence);
    assert.ok(policy.privacyClass);
    assert.ok(policy.payloadSchema);
    assert.ok(policy.intendedProducer);
  }
});

test("Baghdad metric dates split events at local midnight independent of host timezone", () => {
  assert.equal(getBaghdadMetricDate("2026-09-24T20:59:00.000Z"), "2026-09-24");
  assert.equal(getBaghdadMetricDate("2026-09-24T21:01:00.000Z"), "2026-09-25");
});

test("reducer returns the exact configured metric deltas", () => {
  assert.deepEqual(reduceStudyDailyMetric("focus_session_completed", { activeSeconds: 2700 }), {
    focusSeconds: 2700, sessionsCompleted: 1,
  });
  assert.deepEqual(reduceStudyDailyMetric("focus_interruption_recorded", {}), { interruptionCount: 1 });
  assert.deepEqual(reduceStudyDailyMetric("mcq_attempted", { correct: true }), { mcqAttempts: 1, mcqCorrect: 1 });
  assert.deepEqual(reduceStudyDailyMetric("mcq_attempted", { correct: false }), { mcqAttempts: 1, mcqCorrect: 0 });
  assert.deepEqual(reduceStudyDailyMetric("flashcard_reviewed", {}), { flashcardReviews: 1 });
  assert.deepEqual(reduceStudyDailyMetric("spaced_recall_answered", { response: "CORRECT" }), { recallAttempts: 1, recallCorrect: 1 });
  assert.deepEqual(reduceStudyDailyMetric("spaced_recall_answered", { response: "INCORRECT" }), { recallAttempts: 1, recallCorrect: 0 });
  assert.equal(reduceStudyDailyMetric("spaced_recall_skipped", {}), null);
  assert.deepEqual(reduceStudyDailyMetric("lecture_completion_confirmed", {}), { lectureCompletions: 1 });
  assert.equal(reduceStudyDailyMetric("group_focus_round_completed", {}), null);
  assert.equal(reduceStudyDailyMetric("group_focus_summary_completed", {}), null);
  assert.equal(reduceStudyDailyMetric("focus_session_completed", { activeSeconds: -1 }), null);
});

test("valid non-metric event persists once without metric or projection writes", async () => {
  const { service, repository } = makeService();
  const result = await service.ingestStudyEvent({
    eventType: "focus_session_started",
    userId: "user-1",
    occurredAt: NOW,
    source: "web",
    idempotencyKey: "focus-start-0001",
    evidenceClass: "CLIENT_OBSERVED",
    payload: {},
  });
  assert.equal(result.status, "INGESTED");
  assert.equal(repository.events.length, 1);
  assert.equal(repository.metrics.size, 0);
  assert.equal(repository.projections.length, 0);
});

test("first metric event creates event, increments metric and enqueues derived projection", async () => {
  const { service, repository } = makeService();
  const result = await service.ingestStudyEvent(focusCompletion());
  assert.equal(result.status, "INGESTED");
  assert.equal(result.idempotency, "FIRST_SEEN");
  assert.equal(result.metricUpdated, true);
  assert.equal(result.metricDate, "2026-09-24");
  assert.equal(repository.events.length, 1);
  assert.equal(repository.metrics.size, 1);
  const metric = [...repository.metrics.values()][0];
  assert.equal(metric.focusSeconds, 2700);
  assert.equal(metric.sessionsCompleted, 1);
  assert.equal(repository.projections.length, 1);
  assert.equal(repository.projections[0].id, metric.id);
  assert.equal(repository.projections[0].userScope, "user-1");
  assert.equal(repository.projections[0].eventType, undefined);
});

test("multiple metric events on one Baghdad day aggregate atomically", async () => {
  const { service, repository } = makeService();
  await service.ingestStudyEvent(focusCompletion({ idempotencyKey: "focus-complete-0002" }));
  await service.ingestStudyEvent({
    eventType: "mcq_attempted",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "mcq-attempt-0001",
    mcqId: "mcq-1",
    evidenceClass: "SERVER_VALIDATED",
    payload: { correct: true },
  });
  const metric = [...repository.metrics.values()][0];
  assert.equal(repository.metrics.size, 1);
  assert.equal(metric.focusSeconds, 2700);
  assert.equal(metric.mcqAttempts, 1);
  assert.equal(metric.mcqCorrect, 1);
  assert.equal(repository.projections.length, 2);
});

test("metric events immediately around Baghdad midnight use separate dates", async () => {
  const repository = new MemoryRepository();
  const { service } = makeService(repository, {
    now: () => new Date("2026-09-25T01:00:00.000Z"),
  });
  const before = await service.ingestStudyEvent(focusCompletion({
    idempotencyKey: "midnight-before-0001",
    occurredAt: "2026-09-24T20:59:00.000Z",
  }));
  const after = await service.ingestStudyEvent(focusCompletion({
    idempotencyKey: "midnight-after-00001",
    occurredAt: "2026-09-24T21:01:00.000Z",
  }));
  assert.equal(before.metricDate, "2026-09-24");
  assert.equal(after.metricDate, "2026-09-25");
  assert.equal(repository.metrics.size, 2);
});

test("same idempotency key and semantic payload replays without duplicate metric or outbox", async () => {
  const { service, repository } = makeService();
  const first = await service.ingestStudyEvent(focusCompletion());
  const replay = await service.ingestStudyEvent(focusCompletion());
  assert.equal(first.idempotency, "FIRST_SEEN");
  assert.equal(replay.idempotency, "REPLAY_SAME_PAYLOAD");
  assert.equal(replay.metricUpdated, false);
  assert.equal(repository.events.length, 1);
  assert.equal(repository.metrics.size, 1);
  assert.equal(repository.projections.length, 1);
});

test("same idempotency key with a different semantic payload conflicts", async () => {
  const { service, repository } = makeService();
  await service.ingestStudyEvent(focusCompletion());
  await assert.rejects(
    service.ingestStudyEvent(focusCompletion({
      payload: { activeSeconds: 2701, pauseSeconds: 300 },
    })),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.equal(repository.events.length, 1);
  assert.equal(repository.projections.length, 1);
});

test("semantic fingerprint ignores JSON object key ordering", async () => {
  const { service, repository } = makeService();
  await service.ingestStudyEvent(focusCompletion({
    payload: { activeSeconds: 2700, pauseSeconds: 300 },
  }));
  const result = await service.ingestStudyEvent(focusCompletion({
    payload: { pauseSeconds: 300, activeSeconds: 2700 },
  }));
  assert.equal(result.idempotency, "REPLAY_SAME_PAYLOAD");
  assert.equal(repository.events.length, 1);
  assert.equal(repository.projections.length, 1);
});

test("concurrent duplicate requests produce one event, metric increment and projection", async () => {
  const { service, repository } = makeService();
  const results = await Promise.all([
    service.ingestStudyEvent(focusCompletion()),
    service.ingestStudyEvent(focusCompletion()),
  ]);
  assert.equal(results.filter((result) => result.idempotency === "FIRST_SEEN").length, 1);
  assert.equal(results.filter((result) => result.idempotency === "REPLAY_SAME_PAYLOAD").length, 1);
  assert.equal(repository.events.length, 1);
  assert.equal([...repository.metrics.values()][0].focusSeconds, 2700);
  assert.equal(repository.projections.length, 1);
});

test("mocked Prisma unique violation race resolves the winner as replay", async () => {
  const winner = {
    ...focusCompletion(),
    id: "winner",
    schemaVersion: 1,
    receivedAt: NOW,
    createdAt: NOW,
    privacyClass: "PRIVATE_STUDY",
    lectureId: null,
    materialId: null,
    mcqId: null,
    flashcardId: null,
    groupFocusRoomId: null,
  };
  let outsideReads = 0;
  const repository: StudyEventRepository = {
    findByIdempotency: async () => {
      outsideReads += 1;
      return outsideReads === 1 ? null : winner;
    },
    validateReference: async () => {},
    transaction: async (callback) => callback({
      studyEvent: {
        findUnique: async () => null,
        create: async () => { throw uniqueViolation(); },
      },
    } as unknown as StudyEventTransaction),
  };
  const { service } = makeService(repository);
  const result = await service.ingestStudyEvent(focusCompletion());
  assert.equal(result.idempotency, "REPLAY_SAME_PAYLOAD");
});

test("low evidence cannot create an authoritative metric event", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent({
    eventType: "mcq_attempted",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "mcq-low-evidence-1",
    mcqId: "mcq-1",
    evidenceClass: "CLIENT_OBSERVED",
    payload: { correct: true },
  }), { code: "INVALID_EVIDENCE" });
  assert.equal(repository.events.length, 0);
  assert.equal(repository.metrics.size, 0);
});

test("malformed metric payload is rejected", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent(focusCompletion({
    payload: { activeSeconds: -1 },
  })), { code: "INVALID_EVENT" });
  assert.equal(repository.events.length, 0);
});

test("unsupported event type and unknown top-level fields are rejected", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent({
    ...focusCompletion(),
    eventType: "made_up_event",
  } as unknown as IngestStudyEventInput), { code: "INVALID_EVENT" });
  await assert.rejects(service.ingestStudyEvent({
    ...focusCompletion(),
    createdAt: NOW,
  } as IngestStudyEventInput & { createdAt: Date }), { code: "INVALID_EVENT" });
  assert.equal(repository.events.length, 0);
});

test("timestamp beyond future tolerance is rejected", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent(focusCompletion({
    occurredAt: "2026-09-24T12:06:00.000Z",
  })), { code: "INVALID_EVENT" });
  assert.equal(repository.events.length, 0);
});

test("offline replay permits bounded historical events while normal events do not", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent(focusCompletion({
    occurredAt: "2026-01-01T12:00:00.000Z",
  })), { code: "INVALID_EVENT" });
  const replay = await service.ingestStudyEvent({
    eventType: "mcq_attempted",
    userId: "user-1",
    occurredAt: "2025-10-01T12:00:00.000Z",
    source: "offline_replay",
    idempotencyKey: "offline-replay-0001",
    mcqId: "mcq-1",
    evidenceClass: "SERVER_VALIDATED",
    payload: { correct: false },
  });
  assert.equal(replay.status, "INGESTED");
  assert.equal(replay.metricDate, "2025-10-01");
  assert.equal(repository.events.length, 1);
});

test("privacy class is fixed by policy and caller cannot promote study activity", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent(focusCompletion({
    privacyClass: "PUBLIC",
  })), { code: "INVALID_EVENT" });
  assert.equal(repository.events.length, 0);
});

test("focus session reference ownership is validated before persistence", async () => {
  const repository = new MemoryRepository();
  repository.focusSessionOwner = "another-user";
  const { service } = makeService(repository);
  await assert.rejects(service.ingestStudyEvent(focusCompletion()), { code: "OWNERSHIP_MISMATCH" });
  assert.equal(repository.events.length, 0);
});

test("SKIPPED recall creates a private event without positive or negative metric", async () => {
  const { service, repository } = makeService();
  const result = await service.ingestStudyEvent({
    eventType: "spaced_recall_skipped",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "recall-skip-0001",
    evidenceClass: "SERVER_VALIDATED",
    payload: { reason: "deferred" },
  });
  assert.equal(result.status, "INGESTED");
  assert.equal(repository.events.length, 1);
  assert.equal(repository.metrics.size, 0);
  assert.equal(repository.projections.length, 0);
});

test("Group Focus round and summary events do not double-count Focus metrics", async () => {
  const { service, repository } = makeService();
  for (const [eventType, idempotencyKey] of [
    ["group_focus_round_completed", "group-round-0001"],
    ["group_focus_summary_completed", "group-summary-001"],
  ] as const) {
    await service.ingestStudyEvent({
      eventType,
      userId: "user-1",
      occurredAt: NOW,
      source: "durable_object",
      idempotencyKey,
      evidenceClass: "REALTIME_VERIFIED",
      payload: {},
    });
  }
  assert.equal(repository.events.length, 2);
  assert.equal(repository.metrics.size, 0);
  assert.equal(repository.projections.length, 0);
});

test("disabled feature flag returns a predictable result without database access", async () => {
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.STUDY_EVENTS_ENABLED, false);
  assert.equal(isStudyFeatureEnabled("STUDY_EVENTS_ENABLED", {}), false);
  const { service, repository } = makeService(new MemoryRepository(), {
    isEnabled: () => false,
  });
  const result = await service.ingestStudyEvent(focusCompletion());
  assert.equal(result.status, "FEATURE_DISABLED");
  assert.equal(result.event, null);
  assert.equal(result.metricUpdated, false);
  assert.equal(repository.transactionCount, 0);
  assert.equal(repository.events.length, 0);
});

test("outbox failure rolls back canonical event and metric within the transaction", async () => {
  const { service, repository } = makeService(new MemoryRepository(), {
    enqueueProjection: async () => { throw new Error("outbox unavailable"); },
  });
  await assert.rejects(service.ingestStudyEvent(focusCompletion()), { code: "OUTBOX_FAILURE" });
  assert.equal(repository.events.length, 0);
  assert.equal(repository.metrics.size, 0);
  assert.equal(repository.projections.length, 0);
});

test("transactional outbox adapter uses a monotonic sequence and never enqueues raw StudyEvent", async () => {
  let capturedQuery = "";
  let capturedArgs: unknown[] = [];
  const revision = await enqueuePrivateD1Projection({
    $queryRawUnsafe: async (query: string, ...args: unknown[]) => {
      capturedQuery = query;
      capturedArgs = args;
      return [{ revision: "991" }] as never;
    },
  }, {
    entity: "StudyDailyMetric",
    key: { id: "metric-1" },
    data: { id: "metric-1", userId: "user-1", revision: "0" },
  });
  assert.equal(revision, "991");
  assert.match(capturedQuery, /nextval/u);
  assert.match(capturedQuery, /INSERT INTO "PrivateD1SyncOutbox"/u);
  assert.doesNotMatch(capturedQuery, /StudyEvent/u);
  assert.equal(capturedArgs[0], "StudyDailyMetric");
  assert.equal(JSON.parse(String(capturedArgs[1])).id, "metric-1");
});

test("oversized and malformed event payloads are rejected before canonical writes", async () => {
  const { service, repository } = makeService();
  await assert.rejects(service.ingestStudyEvent({
    eventType: "study_event_flagged",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "flag-payload-large-1",
    evidenceClass: "ADMIN_VERIFIED",
    payload: { reason: "x", notes: "x".repeat(33_000) },
  }), { code: "INVALID_EVENT" });
  await assert.rejects(service.ingestStudyEvent({
    eventType: "spaced_recall_answered",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "recall-bad-answer-01",
    evidenceClass: "SERVER_VALIDATED",
    payload: { response: "SKIPPED" },
  } as unknown as IngestStudyEventInput), { code: "INVALID_EVENT" });
  await assert.rejects(service.ingestStudyEvent(focusCompletion({
    idempotencyKey: "focus-duration-too-long-1",
    payload: { activeSeconds: 86_401 },
  })), { code: "INVALID_EVENT" });
  await assert.rejects(service.ingestStudyEvent({
    eventType: "mcq_attempted",
    userId: "user-1",
    occurredAt: NOW,
    source: "backend",
    idempotencyKey: "mcq-malformed-correct-1",
    mcqId: "mcq-1",
    evidenceClass: "SERVER_VALIDATED",
    payload: { correct: "yes" },
  } as unknown as IngestStudyEventInput), { code: "INVALID_EVENT" });
  assert.equal(repository.events.length, 0);
});