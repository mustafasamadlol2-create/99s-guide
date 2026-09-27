import { getPrisma } from "../../services/prismaClient.js";
import {
  aggregateActiveStudyUsers,
  aggregateContentScopes,
  aggregateCurrentState,
  aggregateFlashcards,
  aggregateFocus,
  aggregateGroupFocus,
  aggregateMcq,
  aggregatePopulation,
  aggregateRecall,
  aggregateResources,
  type ActiveUsersAggregateRow,
  type ContentScopeRow,
  type CurrentStateAggregateRow,
  type FlashcardAggregateRow,
  type FocusAggregateRow,
  type GroupFocusAggregateRow,
  type McqAggregateRow,
  type RecallAggregateRow,
  type ResourceAggregateRow,
} from "./aggregateQueries.js";
import { rateMetric } from "./rate.js";
import { safeAggregateInteger, type OwnerAnalyticsDatabase } from "./queryParts.js";
import { OWNER_ACADEMIC_ANALYTICS_VERSION } from "./version.js";
import type {
  OwnerAcademicAggregateInput,
  OwnerAcademicAnalyticsPrivacyMetadata,
  OwnerAcademicAggregates,
  OwnerActivityWindowMetrics,
  OwnerAnalyticsFreshness,
  OwnerAnalyticsScopePrivacyMetadata,
  OwnerAnalyticsScope,
  OwnerAnalyticsSourceFilter,
  OwnerCurrentStateMetrics,
  OwnerForgettingDistribution,
  OwnerLectureAggregate,
  OwnerMasteryDistribution,
  OwnerReviewDistribution,
  OwnerSubjectAggregate,
} from "./types.js";

const MAX_WINDOW_DAYS = 366;
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const MAX_SUBJECT_IDS = 50;
const MAX_LECTURE_IDS = 300;

type ScopeKey = "COHORT" | `SUBJECT:${string}` | `LECTURE:${string}`;

type ScopeAccumulator = {
  scope: OwnerAnalyticsScope;
  subjectId: string | null;
  lectureId: string | null;
  lectureCount: number;
  activeStudyUsers: number;
  trackedUsers: number;
  activity: {
    focus: {
      meaningfulSessions: number;
      verifiedStudySeconds: number;
      uniqueUsers: number;
    };
    groupFocus: {
      completedRuns: number;
      verifiedParticipantSessions: number;
      verifiedFocusSeconds: number;
      uniqueParticipants: number;
    };
    mcq: {
      attempts: number;
      correct: number;
      incorrect: number;
      uniqueUsers: number;
      distinctItems: number;
    };
    flashcards: {
      reviews: number;
      remembered: number;
      notRemembered: number;
      outcomes: number;
      uniqueUsers: number;
      distinctCards: number;
    };
    recall: {
      presented: number;
      answered: number;
      skipped: number;
      expired: number;
      objectiveAnswered: number;
      objectiveCorrect: number;
      objectiveIncorrect: number;
      flashcardRemembered: number;
      flashcardNotRemembered: number;
      uniqueUsers: number;
    };
    resources: {
      handoffs: number;
      uniqueUsers: number;
      pdfHandoffs: number;
      videoHandoffs: number;
    };
  };
  current: {
    masteryRows: number;
    base: OwnerMasteryDistribution;
    effective: OwnerMasteryDistribution;
    freshRows: number;
    staleRows: number;
    missingRows: number;
    review: OwnerReviewDistribution;
    forgetting: OwnerForgettingDistribution;
  };
  privacy: OwnerAnalyticsScopePrivacyMetadata;
};

function emptyMasteryDistribution(): OwnerMasteryDistribution {
  return {
    NOT_STARTED: 0,
    STARTED: 0,
    LEARNING: 0,
    NEEDS_REVIEW: 0,
    GOOD: 0,
    MASTERED: 0,
  };
}

function emptyReviewDistribution(): OwnerReviewDistribution {
  return {
    INSUFFICIENT_EVIDENCE: 0,
    FRESH: 0,
    DUE_SOON: 0,
    DUE: 0,
    OVERDUE: 0,
  };
}

function emptyForgettingDistribution(): OwnerForgettingDistribution {
  return {
    OBJECTIVE: 0,
    SELF_REPORTED: 0,
    MIXED: 0,
    NONE: 0,
  };
}

function emptyScopePrivacyMetadata(): OwnerAnalyticsScopePrivacyMetadata {
  return {
    activity: {
      activeStudyUsers: 0,
      focusUsers: 0,
      groupFocusUsers: 0,
      mcqUsers: 0,
      flashcardUsers: 0,
      recallPresentedUsers: 0,
      recallAnsweredUsers: 0,
      recallSkippedUsers: 0,
      recallExpiredUsers: 0,
      recallObjectiveMcqUsers: 0,
      recallFlashcardRememberedUsers: 0,
      recallFlashcardNotRememberedUsers: 0,
      resourceUsers: 0,
      resourcePdfUsers: 0,
      resourceVideoUsers: 0,
    },
    currentState: {
      trackedUsers: 0,
      baseMasteryBucketUsers: emptyMasteryDistribution(),
      effectiveMasteryBucketUsers: emptyMasteryDistribution(),
      freshRetentionUsers: 0,
      staleRetentionUsers: 0,
      missingRetentionUsers: 0,
      reviewBucketUsers: emptyReviewDistribution(),
      forgettingBucketUsers: emptyForgettingDistribution(),
    },
  };
}

function emptyScope(
  scope: OwnerAnalyticsScope,
  subjectId: string | null = null,
  lectureId: string | null = null,
): ScopeAccumulator {
  return {
    scope,
    subjectId,
    lectureId,
    lectureCount: 0,
    activeStudyUsers: 0,
    trackedUsers: 0,
    activity: {
      focus: { meaningfulSessions: 0, verifiedStudySeconds: 0, uniqueUsers: 0 },
      groupFocus: {
        completedRuns: 0,
        verifiedParticipantSessions: 0,
        verifiedFocusSeconds: 0,
        uniqueParticipants: 0,
      },
      mcq: { attempts: 0, correct: 0, incorrect: 0, uniqueUsers: 0, distinctItems: 0 },
      flashcards: {
        reviews: 0,
        remembered: 0,
        notRemembered: 0,
        outcomes: 0,
        uniqueUsers: 0,
        distinctCards: 0,
      },
      recall: {
        presented: 0,
        answered: 0,
        skipped: 0,
        expired: 0,
        objectiveAnswered: 0,
        objectiveCorrect: 0,
        objectiveIncorrect: 0,
        flashcardRemembered: 0,
        flashcardNotRemembered: 0,
        uniqueUsers: 0,
      },
      resources: { handoffs: 0, uniqueUsers: 0, pdfHandoffs: 0, videoHandoffs: 0 },
    },
    current: {
      masteryRows: 0,
      base: emptyMasteryDistribution(),
      effective: emptyMasteryDistribution(),
      freshRows: 0,
      staleRows: 0,
      missingRows: 0,
      review: emptyReviewDistribution(),
      forgetting: emptyForgettingDistribution(),
    },
    privacy: emptyScopePrivacyMetadata(),
  };
}

function scopeKey(
  scope: OwnerAnalyticsScope,
  subjectId: string | null,
  lectureId: string | null,
): ScopeKey | null {
  if (scope === "COHORT") return "COHORT";
  if (scope === "SUBJECT") return subjectId === null ? null : `SUBJECT:${subjectId}`;
  return lectureId === null ? null : `LECTURE:${lectureId}`;
}

function validatedIds(
  values: readonly string[] | undefined,
  max: number,
  label: string,
): string[] | undefined {
  if (values === undefined || values.length === 0) return undefined;
  if (values.length > max) {
    throw new RangeError(`${label} may contain at most ${max} values.`);
  }
  const ids = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 255 ||
      value.trim() !== value
    ) {
      throw new TypeError(`${label} must contain non-empty canonical string identifiers.`);
    }
    ids.add(value);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function validateInput(input: OwnerAcademicAggregateInput): OwnerAnalyticsSourceFilter {
  const { from, to } = input.window;
  if (
    !(from instanceof Date) ||
    !(to instanceof Date) ||
    !(input.asOf instanceof Date) ||
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    !Number.isFinite(input.asOf.getTime())
  ) {
    throw new TypeError("window.from, window.to, and asOf must be valid Date values.");
  }
  if (from.getTime() >= to.getTime()) {
    throw new RangeError("window.from must be earlier than window.to.");
  }
  if (to.getTime() > input.asOf.getTime()) {
    throw new RangeError("window.to must be less than or equal to asOf.");
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    throw new RangeError(`The activity window cannot exceed ${MAX_WINDOW_DAYS} days.`);
  }

  return {
    subjectIds: validatedIds(input.subjectIds, MAX_SUBJECT_IDS, "subjectIds"),
    lectureIds: validatedIds(input.lectureIds, MAX_LECTURE_IDS, "lectureIds"),
  };
}

function numberField(
  row: Record<string, unknown>,
  field: string,
): number {
  return safeAggregateInteger(row[field] ?? 0n);
}

function ensureScope(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  scope: OwnerAnalyticsScope,
  subjectId: string | null,
  lectureId: string | null,
): ScopeAccumulator | null {
  const key = scopeKey(scope, subjectId, lectureId);
  if (key === null) return null;
  let value = scopes.get(key);
  if (!value) {
    value = emptyScope(scope, subjectId, lectureId);
    scopes.set(key, value);
  }
  return value;
}

function getOrCreateScope(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  row: { scope: OwnerAnalyticsScope; subject_id: string | null; lecture_id: string | null },
): ScopeAccumulator | null {
  return ensureScope(scopes, row.scope, row.subject_id, row.lecture_id);
}

function mergeActivityRows<Row extends {
  scope: OwnerAnalyticsScope;
  subject_id: string | null;
  lecture_id: string | null;
}>(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly Row[],
  apply: (scope: ScopeAccumulator, row: Row) => void,
): void {
  for (const row of rows) {
    const scope = getOrCreateScope(scopes, row);
    if (scope) apply(scope, row);
  }
}

function mergeContentRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly ContentScopeRow[],
): void {
  for (const row of rows) {
    const scope = getOrCreateScope(scopes, row);
    if (!scope) continue;
    scope.lectureCount = numberField(row, "lecture_count");
    if (row.scope === "LECTURE") {
      scope.subjectId = row.subject_id;
    }
  }
}

function mergeFocusRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly FocusAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activity.focus = {
      meaningfulSessions: numberField(row, "meaningful_sessions"),
      verifiedStudySeconds: numberField(row, "verified_study_seconds"),
      uniqueUsers: numberField(row, "unique_users"),
    };
    scope.privacy.activity.focusUsers = numberField(row, "unique_users");
  });
}

function mergeGroupFocusRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly GroupFocusAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activity.groupFocus = {
      completedRuns: numberField(row, "completed_runs"),
      verifiedParticipantSessions: numberField(row, "verified_participant_sessions"),
      verifiedFocusSeconds: numberField(row, "verified_focus_seconds"),
      uniqueParticipants: numberField(row, "unique_participants"),
    };
    scope.privacy.activity.groupFocusUsers = numberField(row, "unique_participants");
  });
}

function mergeMcqRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly McqAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activity.mcq = {
      attempts: numberField(row, "objective_attempts"),
      correct: numberField(row, "objective_correct"),
      incorrect: numberField(row, "objective_incorrect"),
      uniqueUsers: numberField(row, "unique_users"),
      distinctItems: numberField(row, "distinct_items_attempted"),
    };
    scope.privacy.activity.mcqUsers = numberField(row, "unique_users");
  });
}

function mergeFlashcardRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly FlashcardAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activity.flashcards = {
      reviews: numberField(row, "meaningful_reviews"),
      remembered: numberField(row, "self_reported_remembered"),
      notRemembered: numberField(row, "self_reported_not_remembered"),
      outcomes: numberField(row, "self_reported_outcomes"),
      uniqueUsers: numberField(row, "unique_users"),
      distinctCards: numberField(row, "distinct_cards_reviewed"),
    };
    scope.privacy.activity.flashcardUsers = numberField(row, "unique_users");
  });
}

function mergeRecallRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly RecallAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activity.recall = {
      presented: numberField(row, "periodic_presented"),
      answered: numberField(row, "periodic_answered"),
      skipped: numberField(row, "periodic_skipped"),
      expired: numberField(row, "periodic_expired"),
      objectiveAnswered: numberField(row, "objective_mcq_answered"),
      objectiveCorrect: numberField(row, "objective_mcq_correct"),
      objectiveIncorrect: numberField(row, "objective_mcq_incorrect"),
      flashcardRemembered: numberField(row, "flashcard_remembered"),
      flashcardNotRemembered: numberField(row, "flashcard_not_remembered"),
      uniqueUsers: numberField(row, "unique_users"),
    };
    scope.privacy.activity.recallPresentedUsers = numberField(row, "periodic_presented_users");
    scope.privacy.activity.recallAnsweredUsers = numberField(row, "periodic_answered_users");
    scope.privacy.activity.recallSkippedUsers = numberField(row, "periodic_skipped_users");
    scope.privacy.activity.recallExpiredUsers = numberField(row, "periodic_expired_users");
    scope.privacy.activity.recallObjectiveMcqUsers = numberField(row, "objective_mcq_unique_users");
    scope.privacy.activity.recallFlashcardRememberedUsers = numberField(row, "flashcard_remembered_users");
    scope.privacy.activity.recallFlashcardNotRememberedUsers = numberField(row, "flashcard_not_remembered_users");
  });
}

function mergeResourceRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly ResourceAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activity.resources = {
      handoffs: numberField(row, "resource_handoffs"),
      uniqueUsers: numberField(row, "unique_users"),
      pdfHandoffs: numberField(row, "pdf_handoffs"),
      videoHandoffs: numberField(row, "video_handoffs"),
    };
    scope.privacy.activity.resourceUsers = numberField(row, "unique_users");
    scope.privacy.activity.resourcePdfUsers = numberField(row, "pdf_unique_users");
    scope.privacy.activity.resourceVideoUsers = numberField(row, "video_unique_users");
  });
}

function mergeActiveUserRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly ActiveUsersAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.activeStudyUsers = numberField(row, "active_users");
    scope.privacy.activity.activeStudyUsers = numberField(row, "active_users");
  });
}

function masteryStateCounts(
  row: CurrentStateAggregateRow,
  prefix: "base" | "fresh_effective",
): OwnerMasteryDistribution {
  if (prefix === "base") {
    return {
      NOT_STARTED: numberField(row, "base_not_started"),
      STARTED: numberField(row, "base_started"),
      LEARNING: numberField(row, "base_learning"),
      NEEDS_REVIEW: numberField(row, "base_needs_review"),
      GOOD: numberField(row, "base_good"),
      MASTERED: numberField(row, "base_mastered"),
    };
  }
  return {
    NOT_STARTED: numberField(row, "fresh_effective_not_started"),
    STARTED: numberField(row, "fresh_effective_started"),
    LEARNING: numberField(row, "fresh_effective_learning"),
    NEEDS_REVIEW: numberField(row, "fresh_effective_needs_review"),
    GOOD: numberField(row, "fresh_effective_good"),
    MASTERED: numberField(row, "fresh_effective_mastered"),
  };
}

function mergeCurrentStateRows(
  scopes: Map<ScopeKey, ScopeAccumulator>,
  rows: readonly CurrentStateAggregateRow[],
): void {
  mergeActivityRows(scopes, rows, (scope, row) => {
    scope.current = {
      masteryRows: numberField(row, "mastery_rows"),
      base: masteryStateCounts(row, "base"),
      effective: masteryStateCounts(row, "fresh_effective"),
      freshRows: numberField(row, "fresh_retention_rows"),
      staleRows: numberField(row, "stale_retention_rows"),
      missingRows: numberField(row, "missing_retention_rows"),
      review: {
        INSUFFICIENT_EVIDENCE: numberField(row, "review_insufficient_evidence"),
        FRESH: numberField(row, "review_fresh"),
        DUE_SOON: numberField(row, "review_due_soon"),
        DUE: numberField(row, "review_due"),
        OVERDUE: numberField(row, "review_overdue"),
      },
      forgetting: {
        OBJECTIVE: numberField(row, "forgetting_objective"),
        SELF_REPORTED: numberField(row, "forgetting_self_reported"),
        MIXED: numberField(row, "forgetting_mixed"),
        NONE: numberField(row, "forgetting_none"),
      },
    };
    scope.trackedUsers = numberField(row, "tracked_users");
    scope.privacy.currentState.trackedUsers = numberField(row, "tracked_users");
    scope.privacy.currentState.baseMasteryBucketUsers = {
      NOT_STARTED: numberField(row, "base_not_started_users"),
      STARTED: numberField(row, "base_started_users"),
      LEARNING: numberField(row, "base_learning_users"),
      NEEDS_REVIEW: numberField(row, "base_needs_review_users"),
      GOOD: numberField(row, "base_good_users"),
      MASTERED: numberField(row, "base_mastered_users"),
    };
    scope.privacy.currentState.effectiveMasteryBucketUsers = {
      NOT_STARTED: numberField(row, "fresh_effective_not_started_users"),
      STARTED: numberField(row, "fresh_effective_started_users"),
      LEARNING: numberField(row, "fresh_effective_learning_users"),
      NEEDS_REVIEW: numberField(row, "fresh_effective_needs_review_users"),
      GOOD: numberField(row, "fresh_effective_good_users"),
      MASTERED: numberField(row, "fresh_effective_mastered_users"),
    };
    scope.privacy.currentState.freshRetentionUsers = numberField(row, "fresh_retention_users");
    scope.privacy.currentState.staleRetentionUsers = numberField(row, "stale_retention_users");
    scope.privacy.currentState.missingRetentionUsers = numberField(row, "missing_retention_users");
    scope.privacy.currentState.reviewBucketUsers = {
      INSUFFICIENT_EVIDENCE: numberField(row, "review_insufficient_evidence_users"),
      FRESH: numberField(row, "review_fresh_users"),
      DUE_SOON: numberField(row, "review_due_soon_users"),
      DUE: numberField(row, "review_due_users"),
      OVERDUE: numberField(row, "review_overdue_users"),
    };
    scope.privacy.currentState.forgettingBucketUsers = {
      OBJECTIVE: numberField(row, "forgetting_objective_users"),
      SELF_REPORTED: numberField(row, "forgetting_self_reported_users"),
      MIXED: numberField(row, "forgetting_mixed_users"),
      NONE: numberField(row, "forgetting_none_users"),
    };
  });
}

function activityDto(scope: ScopeAccumulator): OwnerActivityWindowMetrics {
  const focus = scope.activity.focus;
  const mcq = scope.activity.mcq;
  const flashcards = scope.activity.flashcards;
  const recall = scope.activity.recall;
  const resources = scope.activity.resources;
  return {
    focus: {
      meaningfulSessionCount: focus.meaningfulSessions,
      verifiedStudySeconds: focus.verifiedStudySeconds,
      uniqueUsers: focus.uniqueUsers,
      averageMeaningfulSessionSeconds: focus.meaningfulSessions === 0
        ? null
        : Math.round(focus.verifiedStudySeconds / focus.meaningfulSessions),
      averageMeaningfulSessionSecondsDenominator: focus.meaningfulSessions,
    },
    groupFocus: { ...scope.activity.groupFocus },
    mcq: {
      objectiveAttempts: mcq.attempts,
      objectiveCorrect: mcq.correct,
      objectiveIncorrect: mcq.incorrect,
      uniqueUsers: mcq.uniqueUsers,
      distinctItemsAttempted: mcq.distinctItems,
      accuracyRate: rateMetric(mcq.correct, mcq.attempts),
    },
    flashcards: {
      meaningfulReviews: flashcards.reviews,
      selfReportedRemembered: flashcards.remembered,
      selfReportedNotRemembered: flashcards.notRemembered,
      selfReportedOutcomeCount: flashcards.outcomes,
      uniqueUsers: flashcards.uniqueUsers,
      distinctCardsReviewed: flashcards.distinctCards,
      selfReportedRememberedRate: rateMetric(flashcards.remembered, flashcards.outcomes),
    },
    recall: {
      periodicPresented: recall.presented,
      periodicAnswered: recall.answered,
      periodicSkipped: recall.skipped,
      periodicExpired: recall.expired,
      objectiveMcqAnswered: recall.objectiveAnswered,
      objectiveMcqCorrect: recall.objectiveCorrect,
      objectiveMcqIncorrect: recall.objectiveIncorrect,
      objectiveMcqAccuracyRate: rateMetric(recall.objectiveCorrect, recall.objectiveAnswered),
      flashcardRemembered: recall.flashcardRemembered,
      flashcardNotRemembered: recall.flashcardNotRemembered,
      uniqueUsers: recall.uniqueUsers,
    },
    resources: {
      resourceLaunches: null,
      resourceHandoffs: resources.handoffs,
      uniqueUsersWithResourceHandoffs: resources.uniqueUsers,
      handoffsByType: { PDF: resources.pdfHandoffs, VIDEO: resources.videoHandoffs },
      launchMetricsAvailable: false,
      handoffMetricsAvailable: true,
    },
  };
}

function currentStateDto(scope: ScopeAccumulator): OwnerCurrentStateMetrics {
  const current = scope.current;
  return {
    mastery: {
      trackedUserLecturePairs: current.masteryRows,
      baseDistribution: { ...current.base },
      freshEffectiveDistribution: { ...current.effective },
      freshRetentionRows: current.freshRows,
      staleRetentionRows: current.staleRows,
      missingRetentionRows: current.missingRows,
    },
    retention: {
      reviewDistribution: { ...current.review },
      forgettingEvidenceDistribution: { ...current.forgetting },
      freshRows: current.freshRows,
      staleRows: current.staleRows,
      missingRows: current.missingRows,
    },
  };
}

function subjectAggregate(scope: ScopeAccumulator): OwnerSubjectAggregate {
  if (scope.subjectId === null) throw new Error("Subject aggregate is missing subjectId.");
  return {
    subjectId: scope.subjectId,
    lectureCount: scope.lectureCount,
    activeStudyUsers: scope.activeStudyUsers,
    activityWindowMetrics: activityDto(scope),
    currentStateMetrics: currentStateDto(scope),
  };
}

function lectureAggregate(scope: ScopeAccumulator): OwnerLectureAggregate {
  if (scope.lectureId === null) throw new Error("Lecture aggregate is missing lectureId.");
  return {
    lectureId: scope.lectureId,
    subjectId: scope.subjectId,
    samples: {
      trackedUsers: scope.trackedUsers,
      activeStudyUsers: scope.activeStudyUsers,
    },
    activityWindowMetrics: activityDto(scope),
    currentStateMetrics: currentStateDto(scope),
  };
}

function makeFreshness(scope: ScopeAccumulator, asOf: Date): OwnerAnalyticsFreshness {
  return {
    asOf: asOf.toISOString(),
    masteryRows: scope.current.masteryRows,
    retention: {
      freshRows: scope.current.freshRows,
      staleRows: scope.current.staleRows,
      missingRows: scope.current.missingRows,
    },
    resourceMetricsAvailable: true,
  };
}

async function aggregateWithDatabase(
  input: OwnerAcademicAggregateInput,
  database: OwnerAnalyticsDatabase,
): Promise<OwnerAcademicAggregates> {
  const filters = validateInput(input);
  const [
    populationRow,
    contentRows,
    focusRows,
    groupFocusRows,
    mcqRows,
    flashcardRows,
    recallRows,
    resourceRows,
    activeUserRows,
    currentStateRows,
  ] = await Promise.all([
    aggregatePopulation(database),
    aggregateContentScopes(database, filters),
    aggregateFocus(database, input, filters),
    aggregateGroupFocus(database, input, filters),
    aggregateMcq(database, input, filters),
    aggregateFlashcards(database, input, filters),
    aggregateRecall(database, input, filters),
    aggregateResources(database, input, filters),
    aggregateActiveStudyUsers(database, input, filters),
    aggregateCurrentState(database, input, filters),
  ]);

  const scopes = new Map<ScopeKey, ScopeAccumulator>();
  scopes.set("COHORT", emptyScope("COHORT"));
  mergeContentRows(scopes, contentRows);
  mergeFocusRows(scopes, focusRows);
  mergeGroupFocusRows(scopes, groupFocusRows);
  mergeMcqRows(scopes, mcqRows);
  mergeFlashcardRows(scopes, flashcardRows);
  mergeRecallRows(scopes, recallRows);
  mergeResourceRows(scopes, resourceRows);
  mergeActiveUserRows(scopes, activeUserRows);
  mergeCurrentStateRows(scopes, currentStateRows);

  const cohort = scopes.get("COHORT");
  if (!cohort) throw new Error("Cohort aggregate was not initialized.");
  const eligibleStudents = safeAggregateInteger(populationRow.eligible_students);
  const cohortActivity = activityDto(cohort);

  const subjects = [...scopes.values()]
    .filter((scope) => scope.scope === "SUBJECT")
    .map(subjectAggregate)
    .sort((left, right) => left.subjectId.localeCompare(right.subjectId));
  const lectures = [...scopes.values()]
    .filter((scope) => scope.scope === "LECTURE")
    .map(lectureAggregate)
    .sort((left, right) => left.lectureId.localeCompare(right.lectureId));
  const privacyMetadata: OwnerAcademicAnalyticsPrivacyMetadata = {
    cohort: cohort.privacy,
    subjects: Object.fromEntries(
      [...scopes.values()]
        .filter((scope) => scope.scope === "SUBJECT" && scope.subjectId !== null)
        .map((scope) => [scope.subjectId!, scope.privacy]),
    ),
    lectures: Object.fromEntries(
      [...scopes.values()]
        .filter((scope) => scope.scope === "LECTURE" && scope.lectureId !== null)
        .map((scope) => [scope.lectureId!, scope.privacy]),
    ),
  };

  return {
    analyticsVersion: OWNER_ACADEMIC_ANALYTICS_VERSION,
    window: {
      from: input.window.from.toISOString(),
      to: input.window.to.toISOString(),
      asOf: input.asOf.toISOString(),
    },
    population: {
      eligibleStudents,
      activeStudyUsers: cohort.activeStudyUsers,
      activeStudyRate: rateMetric(cohort.activeStudyUsers, eligibleStudents),
    },
    participationRates: {
      activeStudyUsers: rateMetric(cohort.activeStudyUsers, eligibleStudents),
      meaningfulFocusUsers: rateMetric(cohortActivity.focus.uniqueUsers, eligibleStudents),
      normalMcqUsers: rateMetric(cohortActivity.mcq.uniqueUsers, eligibleStudents),
      flashcardUsers: rateMetric(cohortActivity.flashcards.uniqueUsers, eligibleStudents),
      periodicRecallUsers: rateMetric(cohortActivity.recall.uniqueUsers, eligibleStudents),
    },
    activityWindowMetrics: cohortActivity,
    currentStateMetrics: currentStateDto(cohort),
    freshness: makeFreshness(cohort, input.asOf),
    subjects,
    lectures,
    privacyMetadata,
  };
}

export function createOwnerAcademicAnalyticsService(database: OwnerAnalyticsDatabase) {
  return {
    getOwnerAcademicAggregates(input: OwnerAcademicAggregateInput): Promise<OwnerAcademicAggregates> {
      return aggregateWithDatabase(input, database);
    },
  };
}

export function getOwnerAcademicAggregates(
  input: OwnerAcademicAggregateInput,
): Promise<OwnerAcademicAggregates> {
  return aggregateWithDatabase(input, getPrisma());
}
