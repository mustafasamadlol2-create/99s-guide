import {
  STUDY_INSIGHT_GROUNDING_VERSION,
  STUDY_INSIGHT_MAX_GROUNDING_BYTES,
  studyInsightGroundingSchema,
  type StudyInsightGroundingV1,
} from "../../../shared/studyInsights.js";
import type {
  StudyAnalyzerDto,
  StudySignalEvidence,
  StudyWeaknessSignal,
  StudyPositiveSignal,
} from "../study-analyzer/types.js";

const MAX_SIGNALS = 20;
const MAX_DUE_REVIEW_LECTURES = 20;
const MAX_REPEATED_ERROR_ITEMS = 20;

function safeCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeRate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000
    ? value
    : null;
}

function boundedId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 255
    ? value
    : null;
}

function normalizedEvidence(evidence: StudySignalEvidence): StudyInsightGroundingV1["weaknesses"][number]["evidence"] {
  return {
    metricId: evidence.metricId.slice(0, 120),
    ...(evidence.numerator !== undefined ? { numerator: safeCount(evidence.numerator) } : {}),
    ...(evidence.denominator !== undefined ? { denominator: safeCount(evidence.denominator) } : {}),
    ...(evidence.rateBps !== undefined ? { rateBps: safeRate(evidence.rateBps) } : {}),
    ...(evidence.count !== undefined ? { count: safeCount(evidence.count) } : {}),
    ...(evidence.window ? { window: evidence.window.slice(0, 40) } : {}),
  };
}

function stableSignalId(
  kind: "weakness" | "positive",
  signal: { id: string; scope: string },
  index: number,
): string {
  return [kind, signal.id, signal.scope, String(index)].join(":");
}

function normalizeWeaknesses(dto: StudyAnalyzerDto): StudyInsightGroundingV1["weaknesses"] {
  return dto.weaknesses.slice(0, MAX_SIGNALS).map((signal, index) => ({
    signalId: stableSignalId("weakness", signal, index),
    id: signal.id,
    scope: signal.scope,
    severity: signal.severity,
    ...(boundedId(signal.subjectId) ? { subjectId: boundedId(signal.subjectId)! } : {}),
    ...(boundedId(signal.lectureId) ? { lectureId: boundedId(signal.lectureId)! } : {}),
    ...(boundedId(signal.itemId) ? { itemId: boundedId(signal.itemId)! } : {}),
    evidence: normalizedEvidence(signal.evidence),
  }));
}

function normalizePositives(dto: StudyAnalyzerDto): StudyInsightGroundingV1["positives"] {
  return dto.positives.slice(0, MAX_SIGNALS).map((signal, index) => ({
    signalId: stableSignalId("positive", signal, index),
    id: signal.id,
    scope: signal.scope,
    evidence: normalizedEvidence(signal.evidence),
  }));
}

function createFacts(dto: StudyAnalyzerDto): StudyInsightGroundingV1["facts"] {
  const facts: StudyInsightGroundingV1["facts"] = [];
  const add = (
    id: string,
    value: number | null | undefined,
    unit: "COUNT" | "RATE_BPS" | "SECONDS",
    window?: string,
  ) => {
    facts.push({ id, value: unit === "RATE_BPS" ? safeRate(value) : safeCount(value), unit, ...(window ? { window } : {}) });
  };

  add("activity.active_days.7d", dto.activity.activeStudyDays.last7Days, "COUNT", "LAST_7_DAYS");
  add("activity.active_days.30d", dto.activity.activeStudyDays.last30Days, "COUNT", "LAST_30_DAYS");
  add("focus.meaningful_sessions.30d", dto.focus.meaningfulCompletedSessions.last30Days, "COUNT", "LAST_30_DAYS");
  add("focus.verified_seconds.30d", dto.focus.verifiedFocusSeconds.last30Days, "SECONDS", "LAST_30_DAYS");
  add("focus.completion_rate.30d", dto.focus.completion.last30Days.completionRateBps, "RATE_BPS", "LAST_30_DAYS");
  add("mcq.objective_attempts.30d", dto.objectivePractice.combinedObjective.last30Days.attempts, "COUNT", "LAST_30_DAYS");
  add("mcq.objective_accuracy.30d", dto.objectivePractice.combinedObjective.last30Days.accuracyRateBps, "RATE_BPS", "LAST_30_DAYS");
  add("flashcards.meaningful_reviews.30d", dto.flashcards.reviews.last30Days.meaningfulReviews, "COUNT", "LAST_30_DAYS");
  add("flashcards.self_reported_remembered_rate.30d", dto.flashcards.reviews.last30Days.selfReportedRememberedRateBps, "RATE_BPS", "LAST_30_DAYS");
  add("recall.periodic_answered.30d", dto.recall.periodicActivity.last30Days.answered, "COUNT", "LAST_30_DAYS");
  add("mastery.tracked_lectures.current", dto.mastery.trackedLectureCount, "COUNT", "CURRENT");
  add(
    "mastery.effective.needs_review.current",
    dto.retention.needsReview,
    "COUNT",
    "CURRENT",
  );
  for (const [state, count] of Object.entries(dto.mastery.effectiveMasteryDistributionFreshOnly ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    add(`mastery.effective_distribution.${state.toLowerCase()}.current`, count, "COUNT", "CURRENT");
  }
  add(
    "pattern.most_used_time_of_day.sessions.90d",
    dto.patterns.timeOfDay.mostUsedTimeOfDay.meaningfulSessions,
    "COUNT",
    "LAST_90_DAYS",
  );
  add(
    "pattern.outcome_time_bucket.linked_sessions.90d",
    dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.linkedSessions,
    "COUNT",
    "LAST_90_DAYS",
  );
  add(
    "pattern.outcome_time_bucket.objective_attempts.90d",
    dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveAttempts,
    "COUNT",
    "LAST_90_DAYS",
  );
  add(
    "pattern.outcome_time_bucket.objective_accuracy.90d",
    dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveCorrectRateBps,
    "RATE_BPS",
    "LAST_90_DAYS",
  );
  add(
    "pattern.session_length.linked_sessions.90d",
    dto.patterns.sessionLength.linkedSessions,
    "COUNT",
    "LAST_90_DAYS",
  );
  add(
    "pattern.session_length.objective_attempts.90d",
    dto.patterns.sessionLength.objectiveAttempts,
    "COUNT",
    "LAST_90_DAYS",
  );
  add(
    "pattern.session_length.objective_accuracy.90d",
    dto.patterns.sessionLength.objectiveCorrectRateBps,
    "RATE_BPS",
    "LAST_90_DAYS",
  );
  add("retention.due.current", dto.retention.due, "COUNT", "CURRENT");
  add("retention.overdue.current", dto.retention.overdue, "COUNT", "CURRENT");
  return facts;
}

function insufficientPatterns(dto: StudyAnalyzerDto): StudyInsightGroundingV1["dataQuality"]["insufficientPatterns"] {
  const result: StudyInsightGroundingV1["dataQuality"]["insufficientPatterns"] = [];
  if (dto.dataQuality.insufficientForTimeOfDayPattern ||
      dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status === "INSUFFICIENT_DATA") {
    result.push("TIME_OF_DAY_PATTERN_INSUFFICIENT");
  }
  if (dto.dataQuality.insufficientForSessionLengthPattern ||
      dto.patterns.sessionLength.status === "INSUFFICIENT_DATA") {
    result.push("SESSION_LENGTH_PATTERN_INSUFFICIENT");
  }
  if (dto.dataQuality.incompleteWindows.length > 0) result.push("SOURCE_WINDOWS_INCOMPLETE");
  if (dto.dataQuality.subjectFactsTruncated) result.push("SUBJECT_FACTS_TRUNCATED");
  if ((dto.dataQuality.retention.staleRows ?? 0) > 0) result.push("RETENTION_DATA_STALE");
  if ((dto.dataQuality.retention.missingRows ?? 0) > 0) result.push("RETENTION_DATA_MISSING");
  return result;
}

function buildGrounding(dto: StudyAnalyzerDto): StudyInsightGroundingV1 {
  const dueReviewLectures = (dto.retention.dueReviews ?? [])
    .slice(0, MAX_DUE_REVIEW_LECTURES)
    .map((review) => ({
      lectureId: review.lectureId,
      ...(boundedId(review.subjectId) ? { subjectId: boundedId(review.subjectId) } : {}),
      effectiveMasteryState: review.effectiveMasteryState.slice(0, 80),
      reviewState: review.reviewState.slice(0, 80),
      ...(review.nextReviewAt ? { nextReviewAt: review.nextReviewAt } : {}),
    }));
  const repeatedErrorItems = dto.objectivePractice.repeatedErrors
    .slice(0, MAX_REPEATED_ERROR_ITEMS)
    .map((error) => ({
      itemId: error.itemId,
      lectureId: error.lectureId,
      subjectId: error.subjectId,
      recentIncorrectCount: error.recentIncorrectCount,
      recentCorrectCount: error.recentCorrectCount,
      lastOutcome: error.lastOutcome,
    }));

  return {
    groundingVersion: STUDY_INSIGHT_GROUNDING_VERSION,
    analyzerVersion: dto.analyzerVersion,
    windows: {
      last7Days: {
        status: dto.windows.last7Days.status,
        from: dto.windows.last7Days.from,
        to: dto.windows.last7Days.to,
      },
      last30Days: {
        status: dto.windows.last30Days.status,
        from: dto.windows.last30Days.from,
        to: dto.windows.last30Days.to,
      },
    },
    dataQuality: {
      trackedLectures: safeCount(dto.dataQuality.trackedLectureCount),
      freshRetentionRows: safeCount(dto.dataQuality.retention.freshRows),
      staleRetentionRows: safeCount(dto.dataQuality.retention.staleRows),
      missingRetentionRows: safeCount(dto.dataQuality.retention.missingRows),
      insufficientPatterns: insufficientPatterns(dto),
    },
    activity: {
      activeDays7d: safeCount(dto.activity.activeStudyDays.last7Days),
      activeDays30d: safeCount(dto.activity.activeStudyDays.last30Days),
      consistencyTrend: dto.consistency.trend.state,
    },
    focus: {
      meaningfulSessions30d: safeCount(dto.focus.meaningfulCompletedSessions.last30Days),
      verifiedSeconds30d: safeCount(dto.focus.verifiedFocusSeconds.last30Days),
      completionRateBps: safeRate(dto.focus.completion.last30Days.completionRateBps),
    },
    objectivePractice: {
      attempts30d: safeCount(dto.objectivePractice.combinedObjective.last30Days.attempts),
      accuracyRateBps30d: safeRate(dto.objectivePractice.combinedObjective.last30Days.accuracyRateBps),
      trend: dto.objectivePractice.trend.state,
    },
    flashcards: {
      reviews30d: safeCount(dto.flashcards.reviews.last30Days.meaningfulReviews),
      rememberedRateBps30d: safeRate(dto.flashcards.reviews.last30Days.selfReportedRememberedRateBps),
    },
    recall: {
      answered30d: safeCount(dto.recall.periodicActivity.last30Days.answered),
      objectiveAccuracyRateBps30d: safeRate(
        dto.recall.answeredOutcomes.last30Days.objectiveCorrect !== null &&
        dto.recall.answeredOutcomes.last30Days.objectiveIncorrect !== null &&
        dto.recall.answeredOutcomes.last30Days.objectiveCorrect +
          dto.recall.answeredOutcomes.last30Days.objectiveIncorrect > 0
          ? Math.round(
            dto.recall.answeredOutcomes.last30Days.objectiveCorrect * 10_000 /
              (dto.recall.answeredOutcomes.last30Days.objectiveCorrect +
                dto.recall.answeredOutcomes.last30Days.objectiveIncorrect),
          )
          : null,
      ),
      skipAndExpiryAreLearningFailures: false,
    },
    mastery: {
      trackedLectures: safeCount(dto.mastery.trackedLectureCount),
      effectiveDistributionFreshOnly: dto.mastery.effectiveMasteryDistributionFreshOnly,
    },
    retention: {
      due: safeCount(dto.retention.due),
      overdue: safeCount(dto.retention.overdue),
      staleRows: safeCount(dto.retention.staleRows),
      missingRows: safeCount(dto.retention.missingRows),
    },
    patterns: {
      mostUsedTimeOfDay: {
        status: dto.patterns.timeOfDay.mostUsedTimeOfDay.status,
        ...(dto.patterns.timeOfDay.mostUsedTimeOfDay.bucket
          ? { bucket: dto.patterns.timeOfDay.mostUsedTimeOfDay.bucket }
          : {}),
        ...(dto.patterns.timeOfDay.mostUsedTimeOfDay.meaningfulSessions !== undefined
          ? { meaningfulSessions: safeCount(dto.patterns.timeOfDay.mostUsedTimeOfDay.meaningfulSessions) ?? 0 }
          : {}),
      },
      bestSupportedOutcomeTimeBucket: {
        status: dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status,
        interpretationScope: "OBSERVED_ASSOCIATION",
        ...(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.bucket
          ? { bucket: dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.bucket }
          : {}),
        ...(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.linkedSessions !== undefined
          ? { linkedSessions: safeCount(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.linkedSessions) ?? 0 }
          : {}),
        ...(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveAttempts !== undefined
          ? { objectiveAttempts: safeCount(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveAttempts) ?? 0 }
          : {}),
        ...(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveCorrectRateBps !== undefined
          ? { objectiveCorrectRateBps: safeRate(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveCorrectRateBps) ?? 0 }
          : {}),
      },
      bestSupportedSessionLengthBucket: {
        status: dto.patterns.sessionLength.status,
        interpretationScope: "OBSERVED_ASSOCIATION",
        ...(dto.patterns.sessionLength.bucket ? { bucket: dto.patterns.sessionLength.bucket } : {}),
        ...(dto.patterns.sessionLength.linkedSessions !== undefined
          ? { linkedSessions: safeCount(dto.patterns.sessionLength.linkedSessions) ?? 0 }
          : {}),
        ...(dto.patterns.sessionLength.objectiveAttempts !== undefined
          ? { objectiveAttempts: safeCount(dto.patterns.sessionLength.objectiveAttempts) ?? 0 }
          : {}),
        ...(dto.patterns.sessionLength.objectiveCorrectRateBps !== undefined
          ? { objectiveCorrectRateBps: safeRate(dto.patterns.sessionLength.objectiveCorrectRateBps) ?? 0 }
          : {}),
      },
    },
    facts: createFacts(dto),
    weaknesses: normalizeWeaknesses(dto),
    positives: normalizePositives(dto),
    dueReviewLectures,
    repeatedErrorItems,
  };
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function trimGrounding(grounding: StudyInsightGroundingV1): StudyInsightGroundingV1 {
  const trimmed = structuredClone(grounding);
  const remainsWithinLimit = () => serializedBytes(trimmed) <= STUDY_INSIGHT_MAX_GROUNDING_BYTES;
  while (!remainsWithinLimit()) {
    if (trimmed.repeatedErrorItems.length > 0) {
      trimmed.repeatedErrorItems.pop();
    } else if (trimmed.dueReviewLectures.length > 1) {
      trimmed.dueReviewLectures.pop();
    } else if (trimmed.positives.length > 1) {
      trimmed.positives.pop();
    } else if (trimmed.weaknesses.length > 1) {
      trimmed.weaknesses.pop();
    } else {
      throw new Error("Study insight grounding exceeds the hard size limit after deterministic trimming.");
    }
  }
  return trimmed;
}

export function buildStudyInsightGrounding(dto: StudyAnalyzerDto): StudyInsightGroundingV1 {
  const initial = buildGrounding(dto);
  const grounding = trimGrounding(initial);
  const parsed = studyInsightGroundingSchema.safeParse(grounding);
  if (!parsed.success) {
    throw new Error("Prompt 36 Analyzer facts could not be normalized into the study insight contract.");
  }
  if (serializedBytes(grounding) > STUDY_INSIGHT_MAX_GROUNDING_BYTES) {
    throw new Error("Study insight grounding exceeded its hard size limit.");
  }
  return parsed.data;
}

export function hasStudyInsightData(grounding: StudyInsightGroundingV1): boolean {
  return [
    grounding.activity.activeDays7d,
    grounding.activity.activeDays30d,
    grounding.focus.meaningfulSessions30d,
    grounding.focus.verifiedSeconds30d,
    grounding.objectivePractice.attempts30d,
    grounding.flashcards.reviews30d,
    grounding.recall.answered30d,
    grounding.retention.due,
    grounding.retention.overdue,
  ].some((value) => typeof value === "number" && value > 0) ||
    (typeof grounding.mastery.trackedLectures === "number" && grounding.mastery.trackedLectures > 0) ||
    grounding.weaknesses.length > 0 ||
    grounding.positives.length > 0 ||
    grounding.dueReviewLectures.length > 0 ||
    grounding.repeatedErrorItems.length > 0;
}