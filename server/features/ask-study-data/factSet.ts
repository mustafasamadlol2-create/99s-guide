import {
  ASK_STUDY_DATA_MAX_FACT_SET_BYTES,
  askStudyDataFactSetSchema,
  type AskStudyDataFactSetV1,
  type AskStudyDataIntent,
  type AskStudyDataSupportedIntent,
  type AskStudyDataWindow,
} from "../../../shared/askStudyData.js";
import type { StudyAnalyzerDto } from "../study-analyzer/types.js";

const WINDOW_NAME: Record<AskStudyDataWindow, "last7Days" | "last30Days" | "currentSemester" | null> = {
  LAST_7_DAYS: "last7Days",
  LAST_30_DAYS: "last30Days",
  CURRENT_SEMESTER: "currentSemester",
  CURRENT: null,
};

const WINDOW_SUFFIX: Record<AskStudyDataWindow, string> = {
  LAST_7_DAYS: "7d",
  LAST_30_DAYS: "30d",
  CURRENT_SEMESTER: "semester",
  CURRENT: "current",
};

type Fact = AskStudyDataFactSetV1["facts"][number];
type References = AskStudyDataFactSetV1["references"];

function metricWindow(dto: StudyAnalyzerDto, window: AskStudyDataWindow) {
  const key = WINDOW_NAME[window];
  return key ? dto.windows[key] : null;
}

function addFact(facts: Fact[], id: string, value: Fact["value"], unit?: Fact["unit"], window?: string): void {
  if (facts.some((fact) => fact.id === id)) return;
  facts.push({
    id,
    value,
    ...(unit ? { unit } : {}),
    ...(window ? { window } : {}),
  });
}

function addWindowedMetric(
  facts: Fact[],
  id: string,
  values: Record<"last7Days" | "last30Days" | "currentSemester", number | null>,
  window: AskStudyDataWindow,
  unit: Fact["unit"],
): void {
  const key = WINDOW_NAME[window];
  addFact(facts, id, key ? values[key] : null, unit, window);
}

function addRelevantLimitations(
  dto: StudyAnalyzerDto,
  intent: AskStudyDataSupportedIntent,
  window: AskStudyDataWindow,
  limitations: string[],
): void {
  const sources = dto.dataQuality.sources;
  const addSourceLimit = (names: Array<keyof typeof sources>) => {
    if (names.some((name) => !sources[name].available || !sources[name].complete || sources[name].truncated)) {
      limitations.push("Some source data is unavailable, incomplete, or bounded for this summary.");
    }
  };
  switch (intent) {
    case "ACTIVITY_SUMMARY":
    case "CONSISTENCY":
      addSourceLimit(["focus", "groupFocus", "mcq", "flashcards", "recall"]);
      break;
    case "FOCUS_SUMMARY":
    case "STUDY_TIME_PATTERN":
    case "SESSION_LENGTH_PATTERN":
      addSourceLimit(["focus", "groupFocus"]);
      break;
    case "OBJECTIVE_PRACTICE":
    case "OBJECTIVE_TREND":
    case "REPEATED_ERRORS":
      addSourceLimit(["mcq", "recall"]);
      break;
    case "FLASHCARD_SUMMARY":
      addSourceLimit(["flashcards", "recall"]);
      break;
    case "RECALL_SUMMARY":
      addSourceLimit(["recall"]);
      break;
    case "MASTERY_SUMMARY":
    case "RETENTION_REVIEW":
    case "DUE_REVIEW_LECTURES":
      addSourceLimit(["mastery", "retention"]);
      if ((dto.dataQuality.retention.staleRows ?? 0) > 0) {
        limitations.push("Stale Retention projections are excluded from current review facts.");
      }
      if ((dto.dataQuality.retention.missingRows ?? 0) > 0) {
        limitations.push("Some tracked lectures do not have a Retention projection.");
      }
      break;
    case "SUBJECT_ACTIVITY":
      addSourceLimit(["focus", "groupFocus", "mcq", "flashcards", "recall", "mastery", "retention", "lectureSubjects"]);
      if (dto.dataQuality.subjectFactsTruncated) {
        limitations.push("Subject-level facts are bounded; not every subject may be listed.");
      }
      break;
    case "WEAKNESS_SIGNALS":
    case "POSITIVE_SIGNALS":
    case "GENERAL_STUDY_SUMMARY":
      addSourceLimit(["focus", "groupFocus", "mcq", "flashcards", "recall", "mastery", "retention"]);
      break;
  }
  if (intent === "OBJECTIVE_TREND" ||
      intent === "REPEATED_ERRORS" ||
      intent === "STUDY_TIME_PATTERN" ||
      intent === "SESSION_LENGTH_PATTERN") {
    limitations.push("This Prompt 36 pattern uses a fixed recent 90-day sample; selecting 7 or 30 days does not change that sample.");
  }
  if (intent === "SUBJECT_ACTIVITY") {
    limitations.push("Per-subject activity uses the last 30 days; due-review counts are current.");
  }
  if (window === "CURRENT_SEMESTER" && metricWindow(dto, window)?.status !== "AVAILABLE") {
    limitations.push("Current-semester boundaries are not configured, so semester facts are unavailable.");
  }
}

function buildIntentFacts(
  dto: StudyAnalyzerDto,
  intent: AskStudyDataSupportedIntent,
  window: AskStudyDataWindow,
  facts: Fact[],
  references: References,
  subjectIds?: readonly string[],
): void {
  const suffix = WINDOW_SUFFIX[window];
  const period = window === "CURRENT" ? "CURRENT" : window;
  const addActiveDays = () => addWindowedMetric(
    facts,
    `activity.active_days.${suffix}`,
    dto.activity.activeStudyDays,
    window,
    "COUNT",
  );
  const addFocus = () => {
    addWindowedMetric(facts, `focus.meaningful_sessions.${suffix}`, dto.focus.meaningfulCompletedSessions, window, "COUNT");
    addWindowedMetric(facts, `focus.verified_seconds.${suffix}`, dto.focus.verifiedFocusSeconds, window, "SECONDS");
    addWindowedMetric(
      facts,
      `focus.completion_rate.${suffix}`,
      {
        last7Days: dto.focus.completion.last7Days.completionRateBps,
        last30Days: dto.focus.completion.last30Days.completionRateBps,
        currentSemester: dto.focus.completion.currentSemester.completionRateBps,
      },
      window,
      "RATE_BPS",
    );
  };
  const addObjective = () => {
    const metric = window === "CURRENT" ? dto.objectivePractice.combinedObjective.last30Days :
      dto.objectivePractice.combinedObjective[WINDOW_NAME[window]!];
    addFact(facts, `mcq.objective_attempts.${suffix}`, metric.attempts, "COUNT", period);
    addFact(facts, `mcq.objective_correct.${suffix}`, metric.correct, "COUNT", period);
    addFact(facts, `mcq.objective_incorrect.${suffix}`, metric.incorrect, "COUNT", period);
    addFact(facts, `mcq.objective_accuracy.${suffix}`, metric.accuracyRateBps, "RATE_BPS", period);
  };
  const addMastery = () => {
    addFact(facts, "mastery.tracked_lectures.current", dto.mastery.trackedLectureCount, "COUNT", "CURRENT");
    addFact(facts, "mastery.needs_review.current", dto.retention.needsReview, "COUNT", "CURRENT");
    for (const [state, count] of Object.entries(dto.mastery.effectiveMasteryDistributionFreshOnly ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      addFact(facts, `mastery.effective_distribution.${state.toLowerCase()}.current`, count, "COUNT", "CURRENT");
    }
    addFact(facts, "mastery.retention_fresh_rows.current", dto.retention.freshRows, "COUNT", "CURRENT");
    addFact(facts, "mastery.retention_stale_rows.current", dto.retention.staleRows, "COUNT", "CURRENT");
  };
  const addRetention = () => {
    addFact(facts, "retention.due.current", dto.retention.due, "COUNT", "CURRENT");
    addFact(facts, "retention.overdue.current", dto.retention.overdue, "COUNT", "CURRENT");
    addFact(facts, "retention.needs_review.current", dto.retention.needsReview, "COUNT", "CURRENT");
    addFact(facts, "retention.fresh_rows.current", dto.retention.freshRows, "COUNT", "CURRENT");
    addFact(facts, "retention.stale_rows.current", dto.retention.staleRows, "COUNT", "CURRENT");
    addFact(facts, "retention.missing_rows.current", dto.retention.missingRows, "COUNT", "CURRENT");
  };
  const addDueReviewItems = () => {
    const rows = (dto.retention.dueReviews ?? []).slice(0, 5);
    rows.forEach((review, index) => {
      const suffixIndex = String(index + 1);
      addFact(facts, `retention.review_state.${suffixIndex}`, review.reviewState, "STATE", "CURRENT");
      addFact(facts, `retention.review_urgency.${suffixIndex}`, review.reviewUrgencyScore, "COUNT", "CURRENT");
      addFact(facts, `retention.objective_forgetting.${suffixIndex}`, review.hasActiveObjectiveForgetting, undefined, "CURRENT");
      references.lectureIds.push(review.lectureId);
      if (review.subjectId) references.subjectIds.push(review.subjectId);
    });
  };
  const addObjectiveTrend = () => {
    addFact(facts, "mcq.objective_trend.state", dto.objectivePractice.trend.state, "STATE", "LAST_90_DAYS");
    addFact(facts, "mcq.objective_trend.latest_accuracy", dto.objectivePractice.trend.latest.accuracyRateBps, "RATE_BPS", "LAST_90_DAYS");
    addFact(facts, "mcq.objective_trend.previous_accuracy", dto.objectivePractice.trend.previous.accuracyRateBps, "RATE_BPS", "LAST_90_DAYS");
  };
  const addSubjectFacts = () => {
    const subjects = subjectIds
      ? dto.subjects.filter((subject) => subjectIds.includes(subject.subjectId))
      : dto.subjects.slice(0, 2);
    subjects.forEach((subject, index) => {
      const slot = String(index + 1);
      addFact(facts, `subject.active_days.30d.${slot}`, subject.activeStudyDaysLast30Days, "COUNT", "LAST_30_DAYS");
      addFact(facts, `subject.focus_seconds.30d.${slot}`, subject.meaningfulFocusSecondsLast30Days, "SECONDS", "LAST_30_DAYS");
      addFact(facts, `subject.objective_attempts.30d.${slot}`, subject.objectiveAttemptsLast30Days, "COUNT", "LAST_30_DAYS");
      addFact(facts, `subject.objective_accuracy.30d.${slot}`, subject.objectiveAccuracyRateBpsLast30Days, "RATE_BPS", "LAST_30_DAYS");
      addFact(facts, `subject.due_reviews.current.${slot}`, subject.dueReviewCount, "COUNT", "CURRENT");
      references.subjectIds.push(subject.subjectId.slice(0, 255));
    });
  };

  switch (intent) {
    case "ACTIVITY_SUMMARY":
      addActiveDays();
      addFocus();
      break;
    case "CONSISTENCY":
      addActiveDays();
      addFact(facts, "consistency.trend.state", dto.consistency.trend.state, "STATE", "LAST_30_DAYS");
      addFact(facts, "consistency.current_streak_days", dto.consistency.currentConsistencyStreakDays, "COUNT", "CURRENT");
      addFact(facts, "consistency.active_day_rate.30d", dto.consistency.activeStudyDayRateBpsLast30Days, "RATE_BPS", "LAST_30_DAYS");
      break;
    case "FOCUS_SUMMARY":
      addFocus();
      break;
    case "OBJECTIVE_PRACTICE":
      addObjective();
      break;
    case "OBJECTIVE_TREND":
      addObjectiveTrend();
      break;
    case "REPEATED_ERRORS":
      addFact(facts, "mcq.repeated_errors.count.90d", dto.objectivePractice.repeatedErrors.length, "COUNT", "LAST_90_DAYS");
      dto.objectivePractice.repeatedErrors.slice(0, 10).forEach((error, index) => {
        const id = String(index + 1);
        addFact(facts, `mcq.repeated_error.incorrect.${id}`, error.recentIncorrectCount, "COUNT", "LAST_90_DAYS");
        references.itemIds.push(error.itemId);
        references.lectureIds.push(error.lectureId);
        if (error.subjectId) references.subjectIds.push(error.subjectId);
      });
      break;
    case "FLASHCARD_SUMMARY": {
      const metric = window === "CURRENT" ? dto.flashcards.reviews.last30Days : dto.flashcards.reviews[WINDOW_NAME[window]!];
      addFact(facts, `flashcards.meaningful_reviews.${suffix}`, metric.meaningfulReviews, "COUNT", period);
      addFact(facts, `flashcards.self_reported_remembered.${suffix}`, metric.selfReportedRemembered, "COUNT", period);
      addFact(facts, `flashcards.self_reported_not_remembered.${suffix}`, metric.selfReportedNotRemembered, "COUNT", period);
      addFact(facts, `flashcards.self_reported_remembered_rate.${suffix}`, metric.selfReportedRememberedRateBps, "RATE_BPS", period);
      break;
    }
    case "RECALL_SUMMARY": {
      const key = window === "CURRENT" ? "last30Days" : WINDOW_NAME[window]!;
      addFact(facts, `recall.presented.${suffix}`, dto.recall.periodicActivity[key].presented, "COUNT", period);
      addFact(facts, `recall.answered.${suffix}`, dto.recall.periodicActivity[key].answered, "COUNT", period);
      addFact(facts, `recall.skipped.${suffix}`, dto.recall.periodicActivity[key].skipped, "COUNT", period);
      addFact(facts, `recall.expired.${suffix}`, dto.recall.periodicActivity[key].expired, "COUNT", period);
      addFact(facts, `recall.objective_correct.${suffix}`, dto.recall.answeredOutcomes[key].objectiveCorrect, "COUNT", period);
      addFact(facts, `recall.objective_incorrect.${suffix}`, dto.recall.answeredOutcomes[key].objectiveIncorrect, "COUNT", period);
      break;
    }
    case "MASTERY_SUMMARY":
      addMastery();
      break;
    case "RETENTION_REVIEW":
      addRetention();
      addDueReviewItems();
      break;
    case "DUE_REVIEW_LECTURES":
      addRetention();
      addDueReviewItems();
      break;
    case "SUBJECT_ACTIVITY":
      addSubjectFacts();
      break;
    case "STUDY_TIME_PATTERN":
      addFact(facts, "pattern.most_used_time_of_day.status", dto.patterns.timeOfDay.mostUsedTimeOfDay.status, "STATE", "LAST_90_DAYS");
      if (dto.patterns.timeOfDay.mostUsedTimeOfDay.bucket) {
        addFact(facts, "pattern.most_used_time_of_day.bucket", dto.patterns.timeOfDay.mostUsedTimeOfDay.bucket, "TEXT", "LAST_90_DAYS");
      }
      addFact(facts, "pattern.best_outcome_time.status", dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status, "STATE", "LAST_90_DAYS");
      if (dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status === "SUPPORTED_PATTERN") {
        addFact(facts, "pattern.best_outcome_time.bucket", dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.bucket ?? null, "TEXT", "LAST_90_DAYS");
        addFact(facts, "pattern.best_outcome_time.objective_accuracy", dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveCorrectRateBps ?? null, "RATE_BPS", "LAST_90_DAYS");
      }
      break;
    case "SESSION_LENGTH_PATTERN":
      addFact(facts, "pattern.session_length.status", dto.patterns.sessionLength.status, "STATE", "LAST_90_DAYS");
      if (dto.patterns.sessionLength.status === "SUPPORTED_PATTERN") {
        addFact(facts, "pattern.session_length.bucket", dto.patterns.sessionLength.bucket ?? null, "TEXT", "LAST_90_DAYS");
        addFact(facts, "pattern.session_length.linked_sessions", dto.patterns.sessionLength.linkedSessions ?? null, "COUNT", "LAST_90_DAYS");
        addFact(facts, "pattern.session_length.objective_accuracy", dto.patterns.sessionLength.objectiveCorrectRateBps ?? null, "RATE_BPS", "LAST_90_DAYS");
      }
      break;
    case "WEAKNESS_SIGNALS":
      dto.weaknesses.slice(0, 8).forEach((signal, index) => {
        const id = `weakness.${index + 1}`;
        addFact(facts, id, signal.id, "STATE", signal.evidence.window);
        addFact(facts, `${id}.severity`, signal.severity, "STATE", signal.evidence.window);
        references.itemIds.push(...(signal.itemId ? [signal.itemId] : []));
        references.lectureIds.push(...(signal.lectureId ? [signal.lectureId] : []));
        references.subjectIds.push(...(signal.subjectId ? [signal.subjectId] : []));
      });
      break;
    case "POSITIVE_SIGNALS":
      dto.positives.slice(0, 8).forEach((signal, index) => {
        addFact(facts, `positive.${index + 1}`, signal.id, "STATE", signal.evidence.window);
      });
      break;
    case "GENERAL_STUDY_SUMMARY":
      addActiveDays();
      addFocus();
      addObjective();
      addFact(facts, "consistency.trend.state", dto.consistency.trend.state, "STATE", "LAST_30_DAYS");
      addFact(facts, "mcq.objective_trend.state", dto.objectivePractice.trend.state, "STATE", "LAST_90_DAYS");
      addFact(facts, "flashcards.meaningful_reviews.30d", dto.flashcards.reviews.last30Days.meaningfulReviews, "COUNT", "LAST_30_DAYS");
      addRetention();
      break;
  }
}

export function buildAskStudyDataFactSet(input: {
  dto: StudyAnalyzerDto;
  intent: AskStudyDataSupportedIntent;
  window: AskStudyDataWindow;
  asOf: Date;
  recentlyDefaulted?: boolean;
  subjectIds?: readonly string[];
}): AskStudyDataFactSetV1 {
  const facts: Fact[] = [];
  const limitations: string[] = [];
  const references: References = { lectureIds: [], subjectIds: [], itemIds: [] };
  buildIntentFacts(input.dto, input.intent, input.window, facts, references, input.subjectIds);
  addRelevantLimitations(input.dto, input.intent, input.window, limitations);
  if (input.intent === "SUBJECT_ACTIVITY" && !input.subjectIds && input.dto.subjects.length > 2) {
    limitations.push("This bounded deterministic summary lists at most two available subjects.");
  }
  if (input.recentlyDefaulted) {
    limitations.push("The phrase 'recently' is interpreted as the last 30 days.");
  }
  if ([...input.dto.dataQuality.incompleteWindows].length > 0 &&
      !limitations.some((limitation) => limitation.startsWith("Some source data"))) {
    limitations.push("Some study sources have incomplete coverage for this period.");
  }

  const factSet = askStudyDataFactSetSchema.parse({
    intent: input.intent,
    window: input.window,
    analyzerVersion: input.dto.analyzerVersion,
    asOf: input.asOf.toISOString(),
    facts: facts.slice(0, 48),
    limitations: [...new Set(limitations)].slice(0, 8),
    references: {
      lectureIds: [...new Set(references.lectureIds)].slice(0, 20),
      subjectIds: [...new Set(references.subjectIds)].slice(0, 20),
      itemIds: [...new Set(references.itemIds)].slice(0, 20),
    },
  });
  if (new TextEncoder().encode(JSON.stringify(factSet)).byteLength > ASK_STUDY_DATA_MAX_FACT_SET_BYTES) {
    throw new Error("ASK_STUDY_DATA_FACT_SET_TOO_LARGE");
  }
  return factSet;
}