import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerAcademicAnalyticsService,
  rateBps,
} from "../server/features/owner-analytics/index.js";

type CapturedQuery = {
  name: string;
  sql: string;
  values: unknown[];
};

class RecordingDatabase {
  readonly queries: CapturedQuery[] = [];

  constructor(private readonly fixture: (name: string) => unknown[]) {}

  async $queryRaw(query: unknown): Promise<unknown> {
    const sqlQuery = query as { sql?: string; values?: unknown[] };
    const sql = sqlQuery.sql ?? "";
    const name = /owner-analytics:([a-z-]+)/.exec(sql)?.[1];
    if (!name) throw new Error("Aggregate query was missing its diagnostic tag.");
    this.queries.push({ name, sql, values: sqlQuery.values ?? [] });
    return this.fixture(name);
  }
}

function serviceFor(database: RecordingDatabase) {
  return createOwnerAcademicAnalyticsService(
    database as unknown as Parameters<typeof createOwnerAcademicAnalyticsService>[0],
  );
}

function scoped(
  scope: "COHORT" | "SUBJECT" | "LECTURE",
  subject_id: string | null,
  lecture_id: string | null,
  values: Record<string, bigint | number> = {},
) {
  return { scope, subject_id, lecture_id, ...values };
}

function fixtureRows(): Record<string, unknown[]> {
  return {
    population: [{ eligible_students: 10n }],
    content: [
      scoped("COHORT", null, null, { lecture_count: 2n }),
      scoped("SUBJECT", "cardiology", null, { lecture_count: 2n }),
      scoped("LECTURE", "cardiology", "lecture-1", { lecture_count: 1n }),
      scoped("LECTURE", "cardiology", "lecture-2", { lecture_count: 1n }),
    ],
    focus: [
      scoped("COHORT", null, null, {
        meaningful_sessions: 2n,
        verified_study_seconds: 1800n,
        unique_users: 1n,
      }),
      scoped("SUBJECT", "cardiology", null, {
        meaningful_sessions: 2n,
        verified_study_seconds: 1800n,
        unique_users: 1n,
      }),
      scoped("LECTURE", "cardiology", "lecture-1", {
        meaningful_sessions: 1n,
        verified_study_seconds: 600n,
        unique_users: 1n,
      }),
      scoped("LECTURE", "cardiology", "lecture-2", {
        meaningful_sessions: 1n,
        verified_study_seconds: 1200n,
        unique_users: 1n,
      }),
    ],
    "group-focus": [
      scoped("COHORT", null, null, {
        completed_runs: 1n,
        verified_participant_sessions: 1n,
        verified_focus_seconds: 900n,
        unique_participants: 1n,
      }),
      scoped("SUBJECT", "cardiology", null, {
        completed_runs: 1n,
        verified_participant_sessions: 1n,
        verified_focus_seconds: 900n,
        unique_participants: 1n,
      }),
    ],
    mcq: [
      scoped("COHORT", null, null, {
        objective_attempts: 10n,
        objective_correct: 7n,
        objective_incorrect: 3n,
        unique_users: 1n,
        distinct_items_attempted: 8n,
      }),
      scoped("SUBJECT", "cardiology", null, {
        objective_attempts: 10n,
        objective_correct: 7n,
        objective_incorrect: 3n,
        unique_users: 1n,
        distinct_items_attempted: 8n,
      }),
    ],
    flashcards: [
      scoped("COHORT", null, null, {
        meaningful_reviews: 10n,
        self_reported_remembered: 8n,
        self_reported_not_remembered: 2n,
        self_reported_outcomes: 10n,
        unique_users: 1n,
        distinct_cards_reviewed: 5n,
      }),
      scoped("SUBJECT", "cardiology", null, {
        meaningful_reviews: 10n,
        self_reported_remembered: 8n,
        self_reported_not_remembered: 2n,
        self_reported_outcomes: 10n,
        unique_users: 1n,
        distinct_cards_reviewed: 5n,
      }),
    ],
    recall: [
      scoped("COHORT", null, null, {
        periodic_presented: 5n,
        periodic_answered: 4n,
        periodic_skipped: 1n,
        periodic_expired: 0n,
        objective_mcq_answered: 3n,
        objective_mcq_correct: 2n,
        objective_mcq_incorrect: 1n,
        flashcard_remembered: 1n,
        flashcard_not_remembered: 0n,
        unique_users: 1n,
      }),
    ],
    resources: [
      scoped("COHORT", null, null, {
        resource_handoffs: 1n,
        unique_users: 1n,
        pdf_handoffs: 1n,
        video_handoffs: 0n,
      }),
    ],
    "active-users": [
      scoped("COHORT", null, null, { active_users: 1n }),
      scoped("SUBJECT", "cardiology", null, { active_users: 1n }),
      scoped("LECTURE", "cardiology", "lecture-1", { active_users: 1n }),
      scoped("LECTURE", "cardiology", "lecture-2", { active_users: 1n }),
    ],
    "current-state": [
      scoped("COHORT", null, null, currentStateValues(2, 2, 1, 1, 0)),
      scoped("SUBJECT", "cardiology", null, currentStateValues(2, 2, 1, 1, 0)),
      scoped("LECTURE", "cardiology", "lecture-1", currentStateValues(1, 1, 1, 0, 0)),
      scoped("LECTURE", "cardiology", "lecture-2", currentStateValues(1, 1, 0, 1, 0)),
    ],
  };
}

function currentStateValues(
  masteryRows: number,
  trackedUsers: number,
  freshRows: number,
  staleRows: number,
  missingRows: number,
): Record<string, bigint> {
  return {
    mastery_rows: BigInt(masteryRows),
    tracked_users: BigInt(trackedUsers),
    base_not_started: 0n,
    base_started: 0n,
    base_learning: 0n,
    base_needs_review: 0n,
    base_good: 0n,
    base_mastered: BigInt(masteryRows),
    fresh_effective_not_started: 0n,
    fresh_effective_started: 0n,
    fresh_effective_learning: 0n,
    fresh_effective_needs_review: 0n,
    fresh_effective_good: 0n,
    fresh_effective_mastered: BigInt(freshRows),
    fresh_retention_rows: BigInt(freshRows),
    stale_retention_rows: BigInt(staleRows),
    missing_retention_rows: BigInt(missingRows),
    review_insufficient_evidence: 0n,
    review_fresh: BigInt(freshRows),
    review_due_soon: 0n,
    review_due: 0n,
    review_overdue: 0n,
    forgetting_objective: 0n,
    forgetting_self_reported: 0n,
    forgetting_mixed: 0n,
    forgetting_none: BigInt(freshRows),
  };
}

const input = {
  window: {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-10T00:00:00.000Z"),
  },
  asOf: new Date("2026-01-11T00:00:00.000Z"),
};

test("basis-point rates use integer rounding and null for empty denominators", () => {
  assert.equal(rateBps(7, 10), 7000);
  assert.equal(rateBps(1, 6), 1667);
  assert.equal(rateBps(0, 0), null);
  assert.throws(() => rateBps(2, 1), RangeError);
});

test("owner aggregates preserve scope, denominators, and current-state freshness", async () => {
  const fixtures = fixtureRows();
  const database = new RecordingDatabase((name) => fixtures[name] ?? []);
  const result = await serviceFor(database).getOwnerAcademicAggregates(input);

  assert.equal(result.analyticsVersion, "owner-academic-analytics-v1");
  assert.equal(result.population.eligibleStudents, 10);
  assert.equal(result.population.activeStudyUsers, 1);
  assert.deepEqual(result.population.activeStudyRate, {
    numerator: 1,
    denominator: 10,
    rateBps: 1000,
  });

  assert.equal(result.activityWindowMetrics.focus.meaningfulSessionCount, 2);
  assert.equal(result.activityWindowMetrics.focus.averageMeaningfulSessionSeconds, 900);
  assert.equal(result.activityWindowMetrics.mcq.objectiveAttempts, 10);
  assert.equal(result.activityWindowMetrics.mcq.objectiveCorrect, 7);
  assert.deepEqual(result.activityWindowMetrics.mcq.accuracyRate, {
    numerator: 7,
    denominator: 10,
    rateBps: 7000,
  });
  assert.equal(result.activityWindowMetrics.flashcards.meaningfulReviews, 10);
  assert.deepEqual(result.activityWindowMetrics.flashcards.selfReportedRememberedRate, {
    numerator: 8,
    denominator: 10,
    rateBps: 8000,
  });
  assert.equal(result.activityWindowMetrics.recall.objectiveMcqAnswered, 3);
  assert.deepEqual(result.activityWindowMetrics.recall.objectiveMcqAccuracyRate, {
    numerator: 2,
    denominator: 3,
    rateBps: 6667,
  });
  assert.equal(result.activityWindowMetrics.resources.resourceLaunches, null);
  assert.equal(result.activityWindowMetrics.resources.resourceHandoffs, 1);
  assert.equal(result.activityWindowMetrics.resources.handoffsByType.PDF, 1);

  assert.equal(result.currentStateMetrics.mastery.trackedUserLecturePairs, 2);
  assert.equal(result.currentStateMetrics.mastery.baseDistribution.MASTERED, 2);
  assert.equal(result.currentStateMetrics.mastery.freshEffectiveDistribution.MASTERED, 1);
  assert.equal(result.freshness.retention.freshRows, 1);
  assert.equal(result.freshness.retention.staleRows, 1);
  assert.equal(result.freshness.retention.missingRows, 0);

  assert.equal(result.subjects.length, 1);
  assert.equal(result.subjects[0]?.activeStudyUsers, 1);
  assert.equal(result.subjects[0]?.lectureCount, 2);
  assert.equal(result.lectures.length, 2);
  assert.equal(result.lectures[0]?.samples.trackedUsers, 1);
  assert.equal(result.lectures[0]?.samples.activeStudyUsers, 1);
  assert.equal(database.queries.length, 10);
  assert.equal(new Set(database.queries.map((query) => query.name)).size, 10);

  const focusQuery = database.queries.find((query) => query.name === "focus");
  const mcqQuery = database.queries.find((query) => query.name === "mcq");
  const groupFocusQuery = database.queries.find((query) => query.name === "group-focus");
  const activeUsersQuery = database.queries.find((query) => query.name === "active-users");
  const currentStateQuery = database.queries.find((query) => query.name === "current-state");
  assert.ok(focusQuery?.sql.includes('"actualEndedAt" >= ?'));
  assert.ok(focusQuery?.sql.includes('"actualEndedAt" < ?'));
  assert.ok(mcqQuery?.sql.includes('"receivedAt" >= ?'));
  assert.ok(mcqQuery?.sql.includes('"receivedAt" < ?'));
  assert.ok(!mcqQuery?.sql.includes('"occurredAt"'));
  assert.ok(groupFocusQuery?.sql.includes('"GroupFocusParticipantSummary"'));
  assert.ok(!groupFocusQuery?.sql.includes('"GroupFocusMembership"'));
  assert.ok(!activeUsersQuery?.sql.includes("focus_resource_handoff_started"));
  assert.ok(!activeUsersQuery?.sql.includes("lecture_resource_launched"));
  assert.ok(currentStateQuery?.sql.includes('"sourceMasteryRevision"'));
  assert.ok(currentStateQuery?.sql.includes('"nextEvaluationAt"'));
  assert.ok(currentStateQuery?.sql.includes('"lastEvaluatedAt"'));
  for (const query of database.queries) {
    assert.match(query.sql, /\bSELECT\b/);
    assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|ALTER|CALL)\b/i);
  }

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /"userId"|"user_id"|"email"|"name"|"avatar"|"signature"|"attemptId"|"selectedAnswer"|"quickNotes"|"integrityDetails"/i,
  );
});

test("zero-data scopes return zero counts and null rates without querying individual entities", async () => {
  const database = new RecordingDatabase((name) =>
    name === "population" ? [{ eligible_students: 0n }] : [],
  );
  const result = await serviceFor(database).getOwnerAcademicAggregates(input);

  assert.equal(result.population.eligibleStudents, 0);
  assert.equal(result.population.activeStudyUsers, 0);
  assert.equal(result.population.activeStudyRate.rateBps, null);
  assert.equal(result.activityWindowMetrics.mcq.accuracyRate.rateBps, null);
  assert.equal(result.activityWindowMetrics.flashcards.selfReportedRememberedRate.rateBps, null);
  assert.equal(result.activityWindowMetrics.recall.objectiveMcqAccuracyRate.rateBps, null);
  assert.equal(database.queries.length, 10);
});

test("filters are parameterized, bounded, and rejected before database access", async () => {
  const database = new RecordingDatabase((name) => {
    if (name === "population") return [{ eligible_students: 1n }];
    return [];
  });
  const service = serviceFor(database);
  const subjectId = "cardiology";
  await service.getOwnerAcademicAggregates({
    ...input,
    subjectIds: [subjectId],
    lectureIds: ["lecture-1"],
  });

  const content = database.queries.find((query) => query.name === "content");
  assert.ok(content);
  assert.ok(!content.sql.includes(subjectId));
  assert.ok(content.values.includes(subjectId));
  assert.ok(content.values.includes("lecture-1"));

  database.queries.length = 0;
  await assert.rejects(
    service.getOwnerAcademicAggregates({
      window: {
        from: new Date("2024-01-01T00:00:00.000Z"),
        to: new Date("2025-01-02T00:00:00.000Z"),
      },
      asOf: new Date("2025-01-03T00:00:00.000Z"),
    }),
    RangeError,
  );
  assert.equal(database.queries.length, 0);

  await assert.rejects(
    service.getOwnerAcademicAggregates({
      ...input,
      lectureIds: Array.from({ length: 301 }, (_, index) => `lecture-${index}`),
    }),
    RangeError,
  );
  assert.equal(database.queries.length, 0);
});

test("800-student and 300-lecture scope uses a fixed set of aggregate queries", async () => {
  const lectureIds = Array.from({ length: 300 }, (_, index) => `lecture-${index}`);
  const subjectIds = Array.from({ length: 10 }, (_, index) => `subject-${index}`);
  const contentRows: unknown[] = [
    scoped("COHORT", null, null, { lecture_count: 300n }),
    ...subjectIds.map((subject_id) =>
      scoped("SUBJECT", subject_id, null, { lecture_count: 30n })),
    ...lectureIds.map((lecture_id, index) =>
      scoped("LECTURE", subjectIds[Math.floor(index / 30)]!, lecture_id, { lecture_count: 1n })),
  ];
  const activeRows: unknown[] = [
    scoped("COHORT", null, null, { active_users: 400n }),
    ...subjectIds.map((subject_id) =>
      scoped("SUBJECT", subject_id, null, { active_users: 80n })),
    ...lectureIds.map((lecture_id, index) =>
      scoped("LECTURE", subjectIds[Math.floor(index / 30)]!, lecture_id, { active_users: 8n })),
  ];
  const database = new RecordingDatabase((name) => {
    if (name === "population") return [{ eligible_students: 800n }];
    if (name === "content") return contentRows;
    if (name === "active-users") return activeRows;
    return [];
  });

  const result = await serviceFor(database).getOwnerAcademicAggregates({
    ...input,
    subjectIds,
    lectureIds,
  });

  assert.equal(result.population.eligibleStudents, 800);
  assert.equal(result.subjects.length, 10);
  assert.equal(result.lectures.length, 300);
  assert.equal(database.queries.length, 10);
  assert.equal(new Set(database.queries.map((query) => query.name)).size, 10);
});

test("same data and asOf produce the same sorted DTO regardless of SQL row order", async () => {
  const fixtures = fixtureRows();
  const firstDatabase = new RecordingDatabase((name) => fixtures[name] ?? []);
  const reversedDatabase = new RecordingDatabase((name) => [...(fixtures[name] ?? [])].reverse());

  const first = await serviceFor(firstDatabase).getOwnerAcademicAggregates(input);
  const reversed = await serviceFor(reversedDatabase).getOwnerAcademicAggregates(input);

  assert.deepEqual(reversed, first);
});