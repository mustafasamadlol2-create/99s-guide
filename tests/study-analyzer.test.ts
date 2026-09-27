import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudyAnalyzerDto,
  createStudyAnalyzerService,
  STUDY_ANALYZER_MAX_DTO_BYTES,
} from "../server/features/study-analyzer/index.js";
import type {
  StudyAnalyzerEventRow,
  StudyAnalyzerFocusRow,
  StudyAnalyzerGroupFocusRow,
  StudyAnalyzerMasteryRow,
  StudyAnalyzerRecallRow,
  StudyAnalyzerRetentionRow,
  StudyAnalyzerSnapshot,
  StudyAnalyzerSourceSlice,
} from "../server/features/study-analyzer/types.js";

const asOf = new Date("2026-09-27T12:00:00.000Z");
const coverageStart = new Date("2026-06-01T00:00:00.000Z");

function slice<T>(
  rows: T[] = [],
  overrides: Partial<StudyAnalyzerSourceSlice<T>> = {},
): StudyAnalyzerSourceSlice<T> {
  return {
    available: true,
    complete: true,
    truncated: false,
    coverageStart,
    rows,
    ...overrides,
  };
}

function baseSnapshot(): StudyAnalyzerSnapshot {
  return {
    focus: slice<StudyAnalyzerFocusRow>(),
    groupFocus: slice<StudyAnalyzerGroupFocusRow>(),
    mcq: slice<StudyAnalyzerEventRow>(),
    flashcards: slice<StudyAnalyzerEventRow>(),
    recall: slice<StudyAnalyzerRecallRow>(),
    mastery: { ...slice<StudyAnalyzerMasteryRow>(), trackedLectureCount: 0 },
    retention: slice<StudyAnalyzerRetentionRow>(),
    lectureSubjects: slice([]),
  };
}

function focusRow(
  id: string,
  status: string,
  endedAt: string,
  activeSeconds: number,
  startedAt = new Date(new Date(endedAt).getTime() - 30 * 60_000).toISOString(),
): StudyAnalyzerFocusRow {
  return {
    id,
    lectureId: "lecture-a",
    status,
    startedAt: new Date(startedAt),
    actualEndedAt: new Date(endedAt),
    activeSeconds,
    lecture: { mainSubject: "biology" },
  };
}

function groupFocusRow(id: string, endedAt: string, seconds: number): StudyAnalyzerGroupFocusRow {
  return {
    id,
    effectiveLectureId: "lecture-a",
    firstConnectedAt: new Date(new Date(endedAt).getTime() - 45 * 60_000),
    verifiedFocusSeconds: seconds,
    effectiveLecture: { mainSubject: "biology" },
    run: {
      runtimeStartedAt: new Date(new Date(endedAt).getTime() - 60 * 60_000),
      runtimeEndedAt: new Date(endedAt),
      terminalReason: "COMPLETED",
    },
  };
}

function mcqEvent(
  id: string,
  itemId: string,
  occurredAt: string,
  correct: boolean,
): StudyAnalyzerEventRow {
  return {
    id,
    eventType: "mcq_attempted",
    source: "backend",
    evidenceClass: "SERVER_VALIDATED",
    privacyClass: "PRIVATE_STUDY",
    occurredAt: new Date(occurredAt),
    receivedAt: new Date(occurredAt),
    lectureId: "lecture-a",
    mcqId: itemId,
    flashcardId: null,
    payload: { correct },
    mcq: { lectureId: "lecture-a", lecture: { mainSubject: "biology" } },
  };
}

function flashcardEvent(id: string, itemId: string, occurredAt: string): StudyAnalyzerEventRow {
  return {
    id,
    eventType: "flashcard_reviewed",
    source: "backend",
    evidenceClass: "SERVER_VALIDATED",
    privacyClass: "PRIVATE_STUDY",
    occurredAt: new Date(occurredAt),
    receivedAt: new Date(occurredAt),
    lectureId: "lecture-a",
    mcqId: null,
    flashcardId: itemId,
    payload: { quality: "AGAIN" },
    flashcard: { lectureId: "lecture-a", lecture: { mainSubject: "biology" } },
  };
}

function recallRow(input: {
  id: string;
  itemType: string;
  itemId: string;
  status: string;
  outcome: string | null;
  at: string;
  evidenceClass?: string;
  issuanceSource?: string | null;
}): StudyAnalyzerRecallRow {
  const date = new Date(input.at);
  return {
    id: input.id,
    itemType: input.itemType,
    itemId: input.itemId,
    lectureId: "lecture-a",
    status: input.status,
    presentedAt: date,
    answeredAt: input.status === "ANSWERED" ? date : null,
    skippedAt: input.status === "SKIPPED" ? date : null,
    expiredAt: input.status === "EXPIRED" ? date : null,
    outcome: input.outcome,
    issuanceSource: input.issuanceSource ?? "PERIODIC",
    evidenceClass: input.evidenceClass
      ?? (input.itemType === "MCQ" ? "SERVER_DERIVED" : "CLIENT_OBSERVED"),
    privacyClass: "PRIVATE_STUDY",
  };
}

function masteryRow(
  lectureId: string,
  revision: number,
  subject = "biology",
): StudyAnalyzerMasteryRow {
  return {
    lectureId,
    state: "FRESH",
    revision,
    ruleVersion: "mastery-v1",
    lastEvaluatedAt: new Date("2026-09-20T12:00:00.000Z"),
    lecture: { mainSubject: subject },
  };
}

function retentionRow(input: {
  lectureId: string;
  revision: number;
  nextEvaluationAt?: string | null;
  reviewState?: string;
  effectiveMasteryState?: string;
}): StudyAnalyzerRetentionRow {
  return {
    lectureId: input.lectureId,
    sourceMasteryRevision: input.revision,
    sourceMasteryRuleVersion: "mastery-v1",
    effectiveMasteryState: input.effectiveMasteryState ?? "FRESH",
    reviewState: input.reviewState ?? "FRESH",
    reviewUrgencyScore: 70,
    nextReviewAt: input.reviewState === "DUE" ? new Date("2026-09-26T12:00:00.000Z") : null,
    nextEvaluationAt: input.nextEvaluationAt
      ? new Date(input.nextEvaluationAt)
      : new Date("2026-10-01T12:00:00.000Z"),
    ruleVersion: "retention-v1",
    objectiveForgettingItemCount: 0,
  };
}

test("objective and flashcard facts deduplicate mirrored Recall outcomes", () => {
  const snapshot = baseSnapshot();
  const duplicateAt = "2026-09-27T10:00:00.000Z";
  snapshot.mcq = slice([
    mcqEvent("mcq-1", "item-1", duplicateAt, true),
    mcqEvent("mcq-2", "item-2", "2026-09-27T11:00:00.000Z", false),
  ]);
  snapshot.recall = slice([
    recallRow({
      id: "recall-mcq-1",
      itemType: "MCQ",
      itemId: "item-1",
      status: "ANSWERED",
      outcome: "CORRECT",
      at: duplicateAt,
    }),
    recallRow({
      id: "recall-flash-1",
      itemType: "FLASHCARD",
      itemId: "card-1",
      status: "ANSWERED",
      outcome: "SELF_REPORTED_HARD",
      at: duplicateAt,
    }),
    recallRow({
      id: "recall-skip",
      itemType: "MCQ",
      itemId: "item-3",
      status: "SKIPPED",
      outcome: null,
      at: "2026-09-26T10:00:00.000Z",
    }),
  ]);
  snapshot.flashcards = slice([
    flashcardEvent("flash-1", "card-1", duplicateAt),
  ]);

  const dto = buildStudyAnalyzerDto(snapshot, asOf);

  assert.deepEqual(dto.objectivePractice.combinedObjective.last30Days, {
    attempts: 2,
    correct: 1,
    incorrect: 1,
    accuracyRateBps: 5000,
  });
  assert.equal(dto.objectivePractice.normalMcq.last30Days.attempts, 2);
  assert.equal(dto.objectivePractice.recallObjective.last30Days.attempts, 1);
  assert.deepEqual(dto.flashcards.reviews.last30Days, {
    meaningfulReviews: 1,
    selfReportedRemembered: 0,
    selfReportedNotRemembered: 1,
    selfReportedNeutral: 0,
    selfReportedRememberedRateBps: 0,
    distinctCardsReviewed: 1,
  });
  assert.equal(dto.recall.answeredOutcomes.last30Days.objectiveCorrect, 1);
  assert.equal(dto.recall.periodicActivity.last30Days.skipped, 1);
  assert.equal(dto.recall.skipAndExpiryAreLearningFailures, false);
  assert.equal(dto.dataQuality.sources.recall.available, true);
  assert.ok(Buffer.byteLength(JSON.stringify(dto)) <= STUDY_ANALYZER_MAX_DTO_BYTES);
});

test("Focus metrics exclude nonterminal states and keep meaningful and terminal counts distinct", () => {
  const snapshot = baseSnapshot();
  snapshot.focus = slice([
    focusRow("completed-meaningful", "COMPLETED", "2026-09-27T09:00:00.000Z", 1200),
    focusRow("completed-short", "COMPLETED", "2026-09-26T09:00:00.000Z", 500),
    focusRow("abandoned", "ABANDONED", "2026-09-25T09:00:00.000Z", 200),
    focusRow("expired", "EXPIRED", "2026-09-24T09:00:00.000Z", 200),
    focusRow("paused", "PAUSED", "2026-09-24T10:00:00.000Z", 300),
  ]);
  snapshot.groupFocus = slice([
    groupFocusRow("verified-group", "2026-09-27T10:00:00.000Z", 900),
  ]);

  const dto = buildStudyAnalyzerDto(snapshot, asOf);

  assert.equal(dto.focus.meaningfulThresholdSeconds, 600);
  assert.equal(dto.focus.meaningfulCompletedSessions.last30Days, 2);
  assert.equal(dto.focus.verifiedFocusSeconds.last30Days, 2100);
  assert.equal(dto.focus.completion.last30Days.completedSessions, 2);
  assert.equal(dto.focus.completion.last30Days.terminalSessions, 4);
  assert.equal(dto.focus.completion.last30Days.completionRateBps, 5000);
  assert.equal(dto.focus.uncompletedSessionCount.last30Days, 2);
  assert.deepEqual(dto.focus.uncompletedStatusesIncluded, ["ABANDONED", "EXPIRED"]);
});

test("fresh retention is reported while stale projections are excluded from current signals", () => {
  const snapshot = baseSnapshot();
  snapshot.mastery = {
    ...slice([
      masteryRow("lecture-fresh", 3),
      masteryRow("lecture-stale", 5),
    ]),
    trackedLectureCount: 2,
  };
  snapshot.retention = slice([
    retentionRow({
      lectureId: "lecture-fresh",
      revision: 3,
      reviewState: "DUE",
      effectiveMasteryState: "NEEDS_REVIEW",
    }),
    retentionRow({
      lectureId: "lecture-stale",
      revision: 4,
      reviewState: "OVERDUE",
      nextEvaluationAt: "2026-09-20T12:00:00.000Z",
      effectiveMasteryState: "NEEDS_REVIEW",
    }),
  ]);

  const dto = buildStudyAnalyzerDto(snapshot, asOf);

  assert.equal(dto.retention.freshRows, 1);
  assert.equal(dto.retention.staleRows, 1);
  assert.equal(dto.retention.missingRows, 0);
  assert.equal(dto.retention.due, 1);
  assert.equal(dto.retention.overdue, 0);
  assert.equal(dto.retention.needsReview, 1);
  assert.deepEqual(dto.retention.dueReviews?.map((row) => row.lectureId), ["lecture-fresh"]);
  assert.equal(dto.retention.staleRetentionPresentedAsCurrent, false);
  assert.ok(dto.weaknesses.some((row) =>
    row.id === "MASTERY_NEEDS_REVIEW" && row.lectureId === "lecture-fresh"));
  assert.ok(!dto.weaknesses.some((row) => row.lectureId === "lecture-stale"));
  assert.deepEqual(
    dto.subjects[0]?.effectiveMasteryDistributionFreshOnly,
    { NEEDS_REVIEW: 1 },
  );
});

test("empty complete sources produce known zeroes; incomplete sources produce nulls", () => {
  const complete = buildStudyAnalyzerDto(baseSnapshot(), asOf);
  assert.equal(complete.activity.activeStudyDays.last30Days, 0);
  assert.equal(complete.objectivePractice.combinedObjective.last30Days.attempts, 0);
  assert.equal(complete.focus.meaningfulCompletedSessions.last30Days, 0);
  assert.equal(complete.retention.freshRows, 0);
  assert.equal(complete.windows.currentSemester.status, "UNAVAILABLE");
  assert.equal(complete.activity.activeStudyDays.currentSemester, null);

  const incompleteSnapshot = baseSnapshot();
  incompleteSnapshot.mcq = slice([], { complete: false });
  const incomplete = buildStudyAnalyzerDto(incompleteSnapshot, asOf);
  assert.equal(incomplete.dataQuality.mcqDataAvailable, false);
  assert.equal(incomplete.objectivePractice.normalMcq.last30Days.attempts, null);
  assert.equal(incomplete.objectivePractice.combinedObjective.last30Days.attempts, null);
  assert.equal(incomplete.activity.activeStudyDays.last30Days, null);
});

test("a truncated source remains exact for windows its retained rows fully cover", () => {
  const snapshot = baseSnapshot();
  snapshot.mcq = slice([
    mcqEvent("mcq-1", "item-1", "2026-09-27T10:00:00.000Z", true),
  ], {
    truncated: true,
    coverageStart,
  });

  const dto = buildStudyAnalyzerDto(snapshot, asOf);

  assert.equal(dto.objectivePractice.normalMcq.last30Days.attempts, 1);
  assert.equal(dto.activity.activeStudyDays.last30Days, 1);
  assert.equal(dto.dataQuality.mcqDataAvailable, false);
  assert.equal(dto.dataQuality.sources.mcq.collectionEnabled, true);
  assert.equal(dto.dataQuality.sources.mcq.complete, false);
  assert.equal(dto.dataQuality.sources.mcq.truncated, true);
});

test("subject facts are null when Recall lecture-to-subject attribution is unavailable", () => {
  const snapshot = baseSnapshot();
  snapshot.mcq = slice([
    mcqEvent("mcq-1", "item-1", "2026-09-27T10:00:00.000Z", true),
  ]);
  snapshot.lectureSubjects = slice([], {
    available: false,
    complete: false,
    coverageStart: null,
  });

  const dto = buildStudyAnalyzerDto(snapshot, asOf);

  assert.equal(dto.objectivePractice.normalMcq.last30Days.attempts, 1);
  assert.equal(dto.subjects[0]?.objectiveAttemptsLast30Days, null);
  assert.equal(dto.subjects[0]?.activeStudyDaysLast30Days, null);
  assert.equal(dto.dataQuality.sources.lectureSubjects.available, false);
});

test("the same snapshot and server timestamp produce byte-identical DTOs", () => {
  const snapshot = baseSnapshot();
  snapshot.focus = slice([
    focusRow("focus-1", "COMPLETED", "2026-09-27T09:00:00.000Z", 1800),
  ]);
  snapshot.mcq = slice([
    mcqEvent("mcq-1", "item-1", "2026-09-27T10:00:00.000Z", true),
  ]);
  const first = JSON.stringify(buildStudyAnalyzerDto(snapshot, asOf));
  const second = JSON.stringify(buildStudyAnalyzerDto(snapshot, asOf));

  assert.equal(second, first);
});

test("bounded source reads are user-scoped, capped, and read-only", async () => {
  const calls: Array<{ model: string; args: Record<string, any> }> = [];
  const delegate = (model: string) => ({
    findMany: async (args: Record<string, any>) => {
      calls.push({ model, args });
      return [];
    },
  });
  const database = {
    focusSession: delegate("focusSession"),
    groupFocusParticipantSummary: delegate("groupFocusParticipantSummary"),
    studyEvent: delegate("studyEvent"),
    recallAttempt: delegate("recallAttempt"),
    lectureMastery: {
      ...delegate("lectureMastery"),
      count: async (args: Record<string, any>) => {
        calls.push({ model: "lectureMastery.count", args });
        return 0;
      },
    },
    lectureRetention: delegate("lectureRetention"),
    lecture: delegate("lecture"),
  };
  const flags = {
    STUDY_EVENTS_ENABLED: true,
    FOCUS_HUB_ENABLED: true,
    GROUP_FOCUS_ENABLED: true,
    SPACED_RECALL_ENABLED: true,
  };
  const read = createStudyAnalyzerService({
    database: database as never,
    now: () => asOf,
    getFeatureFlags: () => flags as never,
  });

  await read("authenticated-user");

  assert.equal(calls.length, 8);
  for (const call of calls) {
    assert.equal(call.args.where.userId, "authenticated-user");
  }
  for (const call of calls.filter((entry) => entry.model !== "lectureMastery.count")) {
    assert.equal(call.args.take, 10_001);
  }
  assert.ok(!calls.some(({ model }) => /update|create|delete|transaction/i.test(model)));
});

test("pattern outputs are bounded and label associations rather than causal effects", () => {
  const snapshot = baseSnapshot();
  const focuses: StudyAnalyzerFocusRow[] = [];
  const mcqs: StudyAnalyzerEventRow[] = [];
  for (let index = 0; index < 10; index += 1) {
    const endAt = new Date(Date.parse("2026-09-01T08:00:00.000Z") + index * 2 * 86_400_000);
    const endIso = endAt.toISOString();
    focuses.push(focusRow(`focus-${index}`, "COMPLETED", endIso, 1_800));
    const outcomeAt = new Date(endAt.getTime() + 10 * 60_000).toISOString();
    mcqs.push(mcqEvent(`mcq-${index}`, `item-${index}`, outcomeAt, true));
  }
  snapshot.focus = slice(focuses);
  snapshot.mcq = slice(mcqs);

  const dto = buildStudyAnalyzerDto(snapshot, asOf);

  assert.equal(dto.patterns.sessionLength.status, "SUPPORTED_PATTERN");
  assert.equal(dto.patterns.sessionLength.bucket, "25_44_MIN");
  assert.equal(dto.patterns.sessionLength.linkedSessions, 10);
  assert.equal(dto.patterns.sessionLength.interpretationScope, "OBSERVED_ASSOCIATION");
  assert.equal(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status, "SUPPORTED_PATTERN");
  assert.equal(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.bucket, "MORNING");
  assert.equal(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.window, "LAST_90_DAYS");
});