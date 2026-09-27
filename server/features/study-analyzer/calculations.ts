import { MASTERY_MEANINGFUL_FOCUS_SECONDS } from "../mastery/constants.js";
import { RETENTION_RULE_VERSION } from "../mastery/retentionConstants.js";
import {
  STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS,
  STUDY_ANALYZER_FACT_REGISTRY_VERSION,
  STUDY_ANALYZER_FOCUS_DURATION_BUCKETS,
  STUDY_ANALYZER_LOOKBACK_DAYS,
  STUDY_ANALYZER_MAX_DTO_BYTES,
  STUDY_ANALYZER_MAX_DUE_REVIEWS,
  STUDY_ANALYZER_MAX_REPEATED_ERRORS,
  STUDY_ANALYZER_MAX_SIGNALS,
  STUDY_ANALYZER_MAX_SUBJECTS,
  STUDY_ANALYZER_MIN_LINKED_PATTERN_SESSIONS,
  STUDY_ANALYZER_MIN_MOST_USED_SESSIONS,
  STUDY_ANALYZER_MIN_OBJECTIVE_TREND_OUTCOMES,
  STUDY_ANALYZER_MIN_SESSION_PATTERN_SESSIONS,
  STUDY_ANALYZER_MIN_TIME_OF_DAY_SESSIONS,
  STUDY_ANALYZER_OBJECTIVE_TREND_DELTA_BPS,
  STUDY_ANALYZER_OBJECTIVE_TREND_SAMPLE,
  STUDY_ANALYZER_REPEAT_OUTCOME_LIMIT,
  STUDY_ANALYZER_TIME_BUCKETS,
  STUDY_ANALYZER_TIMEZONE,
  STUDY_ANALYZER_VERSION,
} from "./constants.js";
import {
  baghdadDayStartDaysBefore,
  baghdadDayKey,
  baghdadHour,
  calendarDaysBetween,
  getCurrentAndCompletedWeeks,
  resolveStudyAnalyzerWindows,
} from "./dateWindows.js";
import type {
  AnalyzerTrendState,
  FlashcardMetric,
  FocusCompletionMetric,
  FocusDurationBucketId,
  ObjectiveMetric,
  StudyAnalyzerDto,
  StudyAnalyzerEventRow,
  StudyAnalyzerFocusRow,
  StudyAnalyzerGroupFocusRow,
  StudyAnalyzerMasteryRow,
  StudyAnalyzerRecallRow,
  StudyAnalyzerRetentionRow,
  StudyAnalyzerSnapshot,
  StudyAnalyzerSourceSlice,
  StudyPositiveSignal,
  StudySignalEvidence,
  StudySignalScope,
  StudySignalSeverity,
  StudyTimeBucketId,
  StudyWeaknessSignal,
  StudyWeaknessSignalId,
  Windowed,
} from "./types.js";

type TimedEvidence = {
  at: Date;
  lectureId: string | null;
  subjectId: string | null;
  source: string;
};

type ObjectiveOutcome = {
  itemId: string;
  lectureId: string;
  subjectId: string | null;
  occurredAt: Date;
  correct: boolean;
  source: "MCQ" | "RECALL";
  sourceId: string;
};

type FlashcardOutcome = {
  itemId: string;
  lectureId: string;
  subjectId: string | null;
  occurredAt: Date;
  remembered: boolean | null;
  source: "FLASHCARD" | "RECALL";
  sourceId: string;
};

type MeaningfulFocusSession = {
  id: string;
  lectureId: string;
  subjectId: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  source: "SOLO" | "GROUP";
};

type TerminalSoloSession = {
  endedAt: Date;
  status: "COMPLETED" | "ABANDONED" | "EXPIRED";
};

type SessionOutcomeAssociation = {
  session: MeaningfulFocusSession;
  attempts: number;
  correct: number;
};

type PatternBucket = {
  bucket: string;
  sessions: number;
  linkedSessions: number;
  attempts: number;
  correct: number;
  latestLinkedAt: Date | null;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isInWindow(value: Date | null | undefined, window: { from: Date; to: Date } | null): boolean {
  return Boolean(
    value
    && window
    && value.getTime() >= window.from.getTime()
    && value.getTime() <= window.to.getTime(),
  );
}

function sourceCoversWindow(
  source: StudyAnalyzerSourceSlice<unknown>,
  window: { from: Date; to: Date } | null,
): boolean {
  if (!window || !source.available || !source.complete) return false;
  if (!source.truncated) return true;
  return Boolean(
    source.coverageStart
    && source.coverageStart.getTime() <= window.from.getTime(),
  );
}

function allSourcesCover(
  sources: StudyAnalyzerSourceSlice<unknown>[],
  window: { from: Date; to: Date } | null,
): boolean {
  return sources.every((source) => sourceCoversWindow(source, window));
}

function windowed<T>(build: (name: "last7Days" | "last30Days" | "currentSemester") => T): Windowed<T> {
  return {
    last7Days: build("last7Days"),
    last30Days: build("last30Days"),
    currentSemester: build("currentSemester"),
  };
}

function emptyObjectiveMetric(): ObjectiveMetric {
  return { attempts: 0, correct: 0, incorrect: 0, accuracyRateBps: null };
}

function unavailableObjectiveMetric(): ObjectiveMetric {
  return { attempts: null, correct: null, incorrect: null, accuracyRateBps: null };
}

function calculateObjectiveMetric(outcomes: ObjectiveOutcome[]): ObjectiveMetric {
  const attempts = outcomes.length;
  const correct = outcomes.filter((outcome) => outcome.correct).length;
  return {
    attempts,
    correct,
    incorrect: attempts - correct,
    accuracyRateBps: attempts === 0 ? null : Math.round((correct * 10_000) / attempts),
  };
}

function inRangeCount<T>(
  rows: T[],
  dateFor: (row: T) => Date | null,
  window: { from: Date; to: Date } | null,
): T[] {
  return rows.filter((row) => isInWindow(dateFor(row), window));
}

function normalizeMcqOutcomes(
  events: StudyAnalyzerEventRow[],
): ObjectiveOutcome[] {
  const rows: ObjectiveOutcome[] = [];
  for (const event of events) {
    if (
      event.eventType !== "mcq_attempted"
      || !["backend", "offline_replay"].includes(event.source)
      || event.evidenceClass !== "SERVER_VALIDATED"
      || event.privacyClass !== "PRIVATE_STUDY"
      || !event.mcqId
    ) continue;
    const lectureId = event.mcq?.lectureId ?? event.lectureId;
    if (
      !lectureId
      || (event.lectureId !== null && event.mcq && event.lectureId !== event.mcq.lectureId)
    ) continue;
    const payload = recordValue(event.payload);
    const correctValue = payload?.correct;
    if (
      correctValue !== true
      && correctValue !== false
      && correctValue !== "true"
      && correctValue !== "false"
    ) continue;
    rows.push({
      itemId: event.mcqId,
      lectureId,
      subjectId: event.mcq?.lecture?.mainSubject ?? null,
      occurredAt: event.receivedAt,
      correct: correctValue === true || correctValue === "true",
      source: "MCQ",
      sourceId: event.id,
    });
  }
  return rows;
}

function normalizeRecallObjectiveOutcomes(
  attempts: StudyAnalyzerRecallRow[],
  subjectByLecture: Map<string, string | null>,
): ObjectiveOutcome[] {
  return attempts.flatMap((attempt) => {
    if (
      attempt.status !== "ANSWERED"
      || attempt.itemType !== "MCQ"
      || attempt.evidenceClass !== "SERVER_DERIVED"
      || attempt.privacyClass !== "PRIVATE_STUDY"
      || !attempt.answeredAt
      || (attempt.outcome !== "CORRECT" && attempt.outcome !== "INCORRECT")
    ) return [];
    return [{
      itemId: attempt.itemId,
      lectureId: attempt.lectureId,
      subjectId: subjectByLecture.get(attempt.lectureId) ?? null,
      occurredAt: attempt.answeredAt,
      correct: attempt.outcome === "CORRECT",
      source: "RECALL" as const,
      sourceId: attempt.id,
    }];
  });
}

function isValidRecallAnswer(attempt: StudyAnalyzerRecallRow): boolean {
  if (
    attempt.status !== "ANSWERED"
    || attempt.privacyClass !== "PRIVATE_STUDY"
    || !attempt.answeredAt
  ) return false;
  if (attempt.itemType === "MCQ") {
    return attempt.evidenceClass === "SERVER_DERIVED"
      && (attempt.outcome === "CORRECT" || attempt.outcome === "INCORRECT");
  }
  if (attempt.itemType === "FLASHCARD") {
    return attempt.evidenceClass === "CLIENT_OBSERVED"
      && [
        "SELF_REPORTED_HARD",
        "SELF_REPORTED_MEDIUM",
        "SELF_REPORTED_EASY",
      ].includes(String(attempt.outcome));
  }
  return false;
}

function objectiveDedupKey(outcome: ObjectiveOutcome): string {
  return [
    outcome.lectureId,
    outcome.itemId,
    outcome.occurredAt.getTime(),
    outcome.correct ? "1" : "0",
  ].join("\u0000");
}

function deduplicateObjectiveOutcomes(rows: ObjectiveOutcome[]): ObjectiveOutcome[] {
  const byKey = new Map<string, ObjectiveOutcome>();
  for (const row of rows) {
    const key = objectiveDedupKey(row);
    const previous = byKey.get(key);
    if (
      !previous
      || (row.source === "RECALL" && previous.source !== "RECALL")
      || (row.source === previous.source && row.sourceId.localeCompare(previous.sourceId) < 0)
    ) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.sourceId.localeCompare(right.sourceId)
    || left.source.localeCompare(right.source));
}

function normalizeFlashcardOutcomes(
  events: StudyAnalyzerEventRow[],
): FlashcardOutcome[] {
  const rows: FlashcardOutcome[] = [];
  for (const event of events) {
    if (
      event.eventType !== "flashcard_reviewed"
      || !["backend", "offline_replay"].includes(event.source)
      || event.evidenceClass !== "SERVER_VALIDATED"
      || event.privacyClass !== "PRIVATE_STUDY"
      || !event.flashcardId
    ) continue;
    const lectureId = event.flashcard?.lectureId ?? event.lectureId;
    if (
      !lectureId
      || (event.lectureId !== null && event.flashcard && event.lectureId !== event.flashcard.lectureId)
    ) continue;
    const quality = recordValue(event.payload)?.quality;
    if (!["AGAIN", "HARD", "GOOD", "EASY"].includes(String(quality))) continue;
    rows.push({
      itemId: event.flashcardId,
      lectureId,
      subjectId: event.flashcard?.lecture?.mainSubject ?? null,
      occurredAt: event.receivedAt,
      remembered: quality !== "AGAIN",
      source: "FLASHCARD",
      sourceId: event.id,
    });
  }
  return rows;
}

function normalizeRecallFlashcardOutcomes(
  attempts: StudyAnalyzerRecallRow[],
  subjectByLecture: Map<string, string | null>,
): FlashcardOutcome[] {
  return attempts.flatMap((attempt) => {
    if (
      attempt.status !== "ANSWERED"
      || attempt.itemType !== "FLASHCARD"
      || attempt.evidenceClass !== "CLIENT_OBSERVED"
      || attempt.privacyClass !== "PRIVATE_STUDY"
      || !attempt.answeredAt
    ) return [];
    const remembered =
      attempt.outcome === "SELF_REPORTED_EASY" ? true
        : attempt.outcome === "SELF_REPORTED_HARD" ? false
          : attempt.outcome === "SELF_REPORTED_MEDIUM" ? null
            : undefined;
    if (remembered === undefined) return [];
    return [{
      itemId: attempt.itemId,
      lectureId: attempt.lectureId,
      subjectId: subjectByLecture.get(attempt.lectureId) ?? null,
      occurredAt: attempt.answeredAt,
      remembered,
      source: "RECALL" as const,
      sourceId: attempt.id,
    }];
  });
}

function flashcardDedupKey(outcome: FlashcardOutcome): string {
  return [
    outcome.lectureId,
    outcome.itemId,
    outcome.occurredAt.getTime(),
    outcome.remembered === null ? "NEUTRAL" : outcome.remembered ? "REMEMBERED" : "NOT_REMEMBERED",
  ].join("\u0000");
}

function deduplicateFlashcardOutcomes(rows: FlashcardOutcome[]): FlashcardOutcome[] {
  const byKey = new Map<string, FlashcardOutcome>();
  for (const row of rows) {
    const key = flashcardDedupKey(row);
    const previous = byKey.get(key);
    if (
      !previous
      || (row.source === "RECALL" && previous.source !== "RECALL")
      || (row.source === previous.source && row.sourceId.localeCompare(previous.sourceId) < 0)
    ) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.sourceId.localeCompare(right.sourceId)
    || left.source.localeCompare(right.source));
}

function normalizeMeaningfulFocusSessions(
  soloRows: StudyAnalyzerFocusRow[],
  groupRows: StudyAnalyzerGroupFocusRow[],
  asOf: Date,
): MeaningfulFocusSession[] {
  const solo: MeaningfulFocusSession[] = soloRows.flatMap((row) => {
    if (
      row.status !== "COMPLETED"
      || row.activeSeconds < MASTERY_MEANINGFUL_FOCUS_SECONDS
      || !row.startedAt
      || !row.actualEndedAt
      || row.actualEndedAt > asOf
    ) return [];
    return [{
      id: row.id,
      lectureId: row.lectureId,
      subjectId: row.lecture?.mainSubject ?? null,
      startedAt: row.startedAt,
      endedAt: row.actualEndedAt,
      durationSeconds: row.activeSeconds,
      source: "SOLO" as const,
    }];
  });
  const group: MeaningfulFocusSession[] = groupRows.flatMap((row) => {
    if (
      row.verifiedFocusSeconds < MASTERY_MEANINGFUL_FOCUS_SECONDS
      || row.run.runtimeEndedAt > asOf
    ) return [];
    return [{
      id: row.id,
      lectureId: row.effectiveLectureId,
      subjectId: row.effectiveLecture?.mainSubject ?? null,
      startedAt: row.firstConnectedAt,
      endedAt: row.run.runtimeEndedAt,
      durationSeconds: row.verifiedFocusSeconds,
      source: "GROUP" as const,
    }];
  });
  return [...solo, ...group].sort((left, right) =>
    left.endedAt.getTime() - right.endedAt.getTime()
    || left.id.localeCompare(right.id)
    || left.source.localeCompare(right.source));
}

function normalizeTerminalSoloSessions(
  rows: StudyAnalyzerFocusRow[],
  asOf: Date,
): TerminalSoloSession[] {
  return rows.flatMap((row) => {
    if (
      !["COMPLETED", "ABANDONED", "EXPIRED"].includes(row.status)
      || !row.startedAt
      || !row.actualEndedAt
      || row.actualEndedAt > asOf
    ) return [];
    return [{
      endedAt: row.actualEndedAt,
      status: row.status as TerminalSoloSession["status"],
    }];
  });
}

function focusBucket(seconds: number): FocusDurationBucketId | null {
  return STUDY_ANALYZER_FOCUS_DURATION_BUCKETS.find((bucket) =>
    seconds >= bucket.minimumSeconds
    && (bucket.maximumSeconds === null || seconds <= bucket.maximumSeconds))?.id ?? null;
}

function timeBucket(value: Date): StudyTimeBucketId {
  const hour = baghdadHour(value);
  if (hour >= 5 && hour < 12) return "MORNING";
  if (hour >= 12 && hour < 17) return "AFTERNOON";
  if (hour >= 17 && hour < 22) return "EVENING";
  return "NIGHT";
}

function makeTimedEvidence(
  objectives: ObjectiveOutcome[],
  flashcards: FlashcardOutcome[],
  recallRows: StudyAnalyzerRecallRow[],
  focusSessions: MeaningfulFocusSession[],
  subjectByLecture: Map<string, string | null>,
): TimedEvidence[] {
  return [
    ...focusSessions.map((session) => ({
      at: session.endedAt,
      lectureId: session.lectureId,
      subjectId: session.subjectId,
      source: session.source === "SOLO" ? "MEANINGFUL_COMPLETED_FOCUS" : "VERIFIED_GROUP_FOCUS",
    })),
    ...objectives.map((outcome) => ({
      at: outcome.occurredAt,
      lectureId: outcome.lectureId,
      subjectId: outcome.subjectId,
      source: "SERVER_VALIDATED_MCQ",
    })),
    ...flashcards.map((outcome) => ({
      at: outcome.occurredAt,
      lectureId: outcome.lectureId,
      subjectId: outcome.subjectId,
      source: "FLASHCARD_REVIEW",
    })),
    ...recallRows.flatMap((attempt) => {
      if (!isValidRecallAnswer(attempt)) return [];
      return [{
        at: attempt.answeredAt!,
        lectureId: attempt.lectureId,
        subjectId: subjectByLecture.get(attempt.lectureId) ?? null,
        source: "ANSWERED_RECALL",
      }];
    }),
  ];
}

function rateBps(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator * 10_000) / denominator);
}

function latestIsoDate(dates: Date[]): string | undefined {
  if (dates.length === 0) return undefined;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function metricFromOutcomes(
  rows: ObjectiveOutcome[],
  available: boolean,
): ObjectiveMetric {
  return available ? calculateObjectiveMetric(rows) : unavailableObjectiveMetric();
}

function metricFromFlashcards(
  rows: FlashcardOutcome[],
  available: boolean,
): FlashcardMetric {
  if (!available) {
    return {
      meaningfulReviews: null,
      selfReportedRemembered: null,
      selfReportedNotRemembered: null,
      selfReportedNeutral: null,
      selfReportedRememberedRateBps: null,
      distinctCardsReviewed: null,
    };
  }
  const remembered = rows.filter((row) => row.remembered === true).length;
  const notRemembered = rows.filter((row) => row.remembered === false).length;
  const neutral = rows.filter((row) => row.remembered === null).length;
  return {
    meaningfulReviews: rows.length,
    selfReportedRemembered: remembered,
    selfReportedNotRemembered: notRemembered,
    selfReportedNeutral: neutral,
    selfReportedRememberedRateBps: rateBps(remembered, remembered + notRemembered),
    distinctCardsReviewed: new Set(rows.map((row) => row.itemId)).size,
  };
}

function objectiveTrend(rows: ObjectiveOutcome[], available: boolean): {
  state: AnalyzerTrendState;
  latest: ObjectiveMetric;
  previous: ObjectiveMetric;
} {
  if (!available) {
    return {
      state: "INSUFFICIENT_DATA",
      latest: unavailableObjectiveMetric(),
      previous: unavailableObjectiveMetric(),
    };
  }
  const recent = rows.slice(-STUDY_ANALYZER_OBJECTIVE_TREND_SAMPLE * 2);
  if (recent.length < STUDY_ANALYZER_MIN_OBJECTIVE_TREND_OUTCOMES) {
    const partial = calculateObjectiveMetric(recent);
    return {
      state: "INSUFFICIENT_DATA",
      latest: partial,
      previous: emptyObjectiveMetric(),
    };
  }
  const halfSize = recent.length >= STUDY_ANALYZER_OBJECTIVE_TREND_SAMPLE * 2
    ? STUDY_ANALYZER_OBJECTIVE_TREND_SAMPLE
    : Math.floor(recent.length / 2);
  const previousRows = recent.slice(recent.length - halfSize * 2, recent.length - halfSize);
  const latestRows = recent.slice(-halfSize);
  const latest = calculateObjectiveMetric(latestRows);
  const previous = calculateObjectiveMetric(previousRows);
  const difference = (latest.accuracyRateBps ?? 0) - (previous.accuracyRateBps ?? 0);
  return {
    state: difference >= STUDY_ANALYZER_OBJECTIVE_TREND_DELTA_BPS
      ? "IMPROVED"
      : difference <= -STUDY_ANALYZER_OBJECTIVE_TREND_DELTA_BPS
        ? "DECLINED"
        : "STABLE",
    latest,
    previous,
  };
}

function subjectMapFromSnapshot(snapshot: StudyAnalyzerSnapshot): Map<string, string | null> {
  const subjects = new Map<string, string | null>();
  const add = (lectureId: string | null | undefined, subjectId: string | null | undefined) => {
    if (lectureId && subjectId !== undefined) {
      const existing = subjects.get(lectureId);
      if (!subjects.has(lectureId) || (existing === null && subjectId !== null)) {
        subjects.set(lectureId, subjectId ?? null);
      }
    }
  };
  for (const row of snapshot.lectureSubjects.rows) add(row.id, row.mainSubject);
  for (const row of snapshot.focus.rows) add(row.lectureId, row.lecture?.mainSubject);
  for (const row of snapshot.groupFocus.rows) {
    add(row.effectiveLectureId, row.effectiveLecture?.mainSubject);
  }
  for (const row of snapshot.mcq.rows) {
    add(row.mcq?.lectureId ?? row.lectureId, row.mcq?.lecture?.mainSubject);
  }
  for (const row of snapshot.flashcards.rows) {
    add(row.flashcard?.lectureId ?? row.lectureId, row.flashcard?.lecture?.mainSubject);
  }
  for (const row of snapshot.mastery.rows) add(row.lectureId, row.lecture?.mainSubject);
  return subjects;
}

function sourceQuality(source: StudyAnalyzerSourceSlice<unknown>) {
  return {
    available: source.available,
    collectionEnabled: source.complete,
    complete: source.available && source.complete && !source.truncated,
    truncated: source.truncated,
    coverageStart: source.coverageStart?.toISOString() ?? null,
  };
}

function compareNullableDates(left: Date | null, right: Date | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left.getTime() - right.getTime();
}

function retentionIsFresh(
  row: StudyAnalyzerRetentionRow,
  mastery: StudyAnalyzerMasteryRow,
  asOf: Date,
): boolean {
  return row.sourceMasteryRevision === mastery.revision
    && row.sourceMasteryRuleVersion === mastery.ruleVersion
    && row.ruleVersion === RETENTION_RULE_VERSION
    && (row.nextEvaluationAt === null || row.nextEvaluationAt.getTime() > asOf.getTime());
}

function countStates(rows: Array<{ state: string }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) result[row.state] = (result[row.state] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function buildRetentionData(
  masteryRows: StudyAnalyzerMasteryRow[],
  retentionRows: StudyAnalyzerRetentionRow[],
  subjectByLecture: Map<string, string | null>,
  asOf: Date,
  available: boolean,
): {
  freshRows: number | null;
  staleRows: number | null;
  missingRows: number | null;
  due: number | null;
  overdue: number | null;
  needsReview: number | null;
  dueReviews: StudyAnalyzerDto["retention"]["dueReviews"];
  freshRowsByLecture: Map<string, StudyAnalyzerRetentionRow>;
} {
  const freshRowsByLecture = new Map<string, StudyAnalyzerRetentionRow>();
  if (!available) {
    return {
      freshRows: null,
      staleRows: null,
      missingRows: null,
      due: null,
      overdue: null,
      needsReview: null,
      dueReviews: null,
      freshRowsByLecture,
    };
  }
  const byLecture = new Map(retentionRows.map((row) => [row.lectureId, row]));
  let freshRows = 0;
  let staleRows = 0;
  let missingRows = 0;
  const dueRows: StudyAnalyzerRetentionRow[] = [];
  for (const mastery of masteryRows) {
    const row = byLecture.get(mastery.lectureId);
    if (!row) {
      missingRows += 1;
      continue;
    }
    if (!retentionIsFresh(row, mastery, asOf)) {
      staleRows += 1;
      continue;
    }
    freshRows += 1;
    freshRowsByLecture.set(row.lectureId, row);
    if (
      row.reviewState === "DUE"
      || row.reviewState === "OVERDUE"
      || row.effectiveMasteryState === "NEEDS_REVIEW"
    ) dueRows.push(row);
  }
  const due = [...freshRowsByLecture.values()].filter((row) => row.reviewState === "DUE").length;
  const overdue = [...freshRowsByLecture.values()].filter((row) => row.reviewState === "OVERDUE").length;
  const needsReview = [...freshRowsByLecture.values()]
    .filter((row) => row.effectiveMasteryState === "NEEDS_REVIEW").length;
  const sorted = dueRows.sort((left, right) =>
    right.reviewUrgencyScore - left.reviewUrgencyScore
    || Number(right.objectiveForgettingItemCount > 0) - Number(left.objectiveForgettingItemCount > 0)
    || compareNullableDates(left.nextReviewAt, right.nextReviewAt)
    || left.lectureId.localeCompare(right.lectureId));
  return {
    freshRows,
    staleRows,
    missingRows,
    due,
    overdue,
    needsReview,
    dueReviews: sorted.slice(0, STUDY_ANALYZER_MAX_DUE_REVIEWS).map((row) => ({
      lectureId: row.lectureId,
      subjectId: subjectByLecture.get(row.lectureId) ?? null,
      effectiveMasteryState: row.effectiveMasteryState,
      reviewState: row.reviewState,
      reviewUrgencyScore: row.reviewUrgencyScore,
      nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
      hasActiveObjectiveForgetting: row.objectiveForgettingItemCount > 0,
    })),
    freshRowsByLecture,
  };
}

function signal(
  id: StudyWeaknessSignalId,
  scope: StudySignalScope,
  severity: StudySignalSeverity,
  evidence: StudySignalEvidence,
  extra: { subjectId?: string; lectureId?: string; itemId?: string } = {},
): StudyWeaknessSignal {
  return { id, scope, ...extra, evidence, severity };
}

const severityOrder: Record<StudySignalSeverity, number> = {
  HIGH: 0,
  MODERATE: 1,
  LOW: 2,
};
const scopeSpecificity: Record<StudySignalScope, number> = {
  ITEM: 0,
  LECTURE: 1,
  SUBJECT: 2,
  GLOBAL: 3,
};

function sortWeaknessSignals(rows: StudyWeaknessSignal[]): StudyWeaknessSignal[] {
  return rows.sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity]
    || scopeSpecificity[left.scope] - scopeSpecificity[right.scope]
    || (right.evidence.lastEvidenceAt ?? "").localeCompare(left.evidence.lastEvidenceAt ?? "")
    || left.id.localeCompare(right.id)
    || (left.subjectId ?? "").localeCompare(right.subjectId ?? "")
    || (left.lectureId ?? "").localeCompare(right.lectureId ?? "")
    || (left.itemId ?? "").localeCompare(right.itemId ?? ""));
}

function severityForAccuracy(rate: number): StudySignalSeverity | null {
  if (rate < 5_000) return "HIGH";
  if (rate < 6_000) return "MODERATE";
  if (rate < 7_000) return "LOW";
  return null;
}

function severityForFlashcards(rate: number): StudySignalSeverity | null {
  if (rate >= 6_500) return "HIGH";
  if (rate >= 5_000) return "MODERATE";
  if (rate >= 4_000) return "LOW";
  return null;
}

function severityForUncompleted(rate: number): StudySignalSeverity | null {
  if (rate >= 7_000) return "HIGH";
  if (rate >= 5_500) return "MODERATE";
  if (rate >= 4_000) return "LOW";
  return null;
}

function buildRepeatedErrors(
  objectiveRows: ObjectiveOutcome[],
  subjectByLecture: Map<string, string | null>,
): StudyAnalyzerDto["objectivePractice"]["repeatedErrors"] {
  const recent = objectiveRows.slice(-STUDY_ANALYZER_REPEAT_OUTCOME_LIMIT);
  const byItem = new Map<string, ObjectiveOutcome[]>();
  for (const row of recent) {
    const key = `${row.lectureId}\u0000${row.itemId}`;
    const rows = byItem.get(key) ?? [];
    rows.push(row);
    byItem.set(key, rows);
  }
  return [...byItem.values()]
    .flatMap((rows) => {
      const latest = rows.at(-1);
      const recentIncorrectCount = rows.filter((row) => !row.correct).length;
      if (!latest || latest.correct || recentIncorrectCount < 2) return [];
      return [{
        itemId: latest.itemId,
        lectureId: latest.lectureId,
        subjectId: latest.subjectId ?? subjectByLecture.get(latest.lectureId) ?? null,
        recentIncorrectCount,
        recentCorrectCount: rows.filter((row) => row.correct).length,
        lastOutcome: "INCORRECT" as const,
        lastAttemptAt: latest.occurredAt.toISOString(),
      }];
    })
    .sort((left, right) =>
      right.recentIncorrectCount - left.recentIncorrectCount
      || right.lastAttemptAt.localeCompare(left.lastAttemptAt)
      || left.itemId.localeCompare(right.itemId)
      || left.lectureId.localeCompare(right.lectureId))
    .slice(0, STUDY_ANALYZER_MAX_REPEATED_ERRORS);
}

function buildSignals(input: {
  objectiveLast30: ObjectiveOutcome[];
  objectiveLast90: ObjectiveOutcome[];
  flashcardsLast30: FlashcardOutcome[];
  focusTerminalLast30: TerminalSoloSession[];
  consistencyTrend: StudyAnalyzerDto["consistency"]["trend"];
  freshRetentionRows: Map<string, StudyAnalyzerRetentionRow>;
  repeatedErrors: StudyAnalyzerDto["objectivePractice"]["repeatedErrors"];
  subjectByLecture: Map<string, string | null>;
}): { weaknesses: StudyWeaknessSignal[]; positives: StudyPositiveSignal[] } {
  const weaknesses: StudyWeaknessSignal[] = [];
  const positives: StudyPositiveSignal[] = [];
  const objectiveLast30 = input.objectiveLast30;
  if (objectiveLast30.length >= 10) {
    const correct = objectiveLast30.filter((row) => row.correct).length;
    const rate = rateBps(correct, objectiveLast30.length);
    const severity = rate === null ? null : severityForAccuracy(rate);
    if (severity) {
      weaknesses.push(signal(
        "LOW_RECENT_OBJECTIVE_ACCURACY",
        "GLOBAL",
        severity,
        {
          metricId: "mcq.objective_accuracy.30d",
          numerator: correct,
          denominator: objectiveLast30.length,
          rateBps: rate ?? undefined,
          window: "LAST_30_DAYS",
          lastEvidenceAt: objectiveLast30.at(-1)?.occurredAt.toISOString(),
        },
      ));
    }
  }

  for (const error of input.repeatedErrors) {
    weaknesses.push(signal(
      "REPEATED_OBJECTIVE_ERRORS",
      "ITEM",
      error.recentIncorrectCount >= 4 ? "HIGH"
        : error.recentIncorrectCount === 3 ? "MODERATE"
          : "LOW",
      {
        metricId: "mcq.repeated_errors.90d",
        count: error.recentIncorrectCount,
        window: "LAST_90_DAYS_LAST_100_OUTCOMES",
        lastEvidenceAt: error.lastAttemptAt,
      },
      {
        itemId: error.itemId,
        lectureId: error.lectureId,
        ...(error.subjectId ? { subjectId: error.subjectId } : {}),
      },
    ));
  }

  const flashcardRemembered = input.flashcardsLast30.filter((row) => row.remembered === true).length;
  const flashcardNotRemembered = input.flashcardsLast30.filter((row) => row.remembered === false).length;
  const flashcardRate = rateBps(
    flashcardNotRemembered,
    flashcardRemembered + flashcardNotRemembered,
  );
  if (
    input.flashcardsLast30.length >= 5
    && flashcardRate !== null
  ) {
    const severity = severityForFlashcards(flashcardRate);
    if (severity) {
      weaknesses.push(signal(
        "FLASHCARD_NOT_REMEMBERED_PATTERN",
        "GLOBAL",
        severity,
        {
          metricId: "flashcards.self_reported_not_remembered_rate.30d",
          numerator: flashcardNotRemembered,
          denominator: flashcardRemembered + flashcardNotRemembered,
          rateBps: flashcardRate,
          count: input.flashcardsLast30.length,
          window: "LAST_30_DAYS",
          lastEvidenceAt: input.flashcardsLast30.at(-1)?.occurredAt.toISOString(),
        },
      ));
    }
  }

  const terminalCount = input.focusTerminalLast30.length;
  const uncompletedCount = input.focusTerminalLast30
    .filter((row) => row.status === "ABANDONED" || row.status === "EXPIRED").length;
  const uncompletedRate = rateBps(uncompletedCount, terminalCount);
  if (terminalCount >= 5 && uncompletedRate !== null) {
    const severity = severityForUncompleted(uncompletedRate);
    if (severity) {
      weaknesses.push(signal(
        "FOCUS_FREQUENTLY_UNCOMPLETED",
        "GLOBAL",
        severity,
        {
          metricId: "focus.uncompleted_rate.30d",
          numerator: uncompletedCount,
          denominator: terminalCount,
          rateBps: uncompletedRate,
          window: "LAST_30_DAYS",
          lastEvidenceAt: latestIsoDate(input.focusTerminalLast30.map((row) => row.endedAt)),
        },
      ));
    }
  }

  if (
    input.consistencyTrend.state === "DECLINED"
    && input.consistencyTrend.latestActiveDays !== null
    && input.consistencyTrend.previousActiveDays !== null
  ) {
    const decline = input.consistencyTrend.previousActiveDays
      - input.consistencyTrend.latestActiveDays;
    weaknesses.push(signal(
      "LOW_RECENT_STUDY_CONSISTENCY",
      "GLOBAL",
      decline >= 6 ? "HIGH" : decline >= 4 ? "MODERATE" : "LOW",
      {
        metricId: "activity.active_days.equal_7d_trend",
        numerator: input.consistencyTrend.latestActiveDays,
        denominator: input.consistencyTrend.previousActiveDays,
        count: decline,
        window: "LATEST_7_COMPLETE_DAYS_VS_PREVIOUS_7",
      },
    ));
  }

  for (const [lectureId, row] of input.freshRetentionRows) {
    const subjectId = input.subjectByLecture.get(lectureId) ?? null;
    if (row.effectiveMasteryState === "NEEDS_REVIEW") {
      weaknesses.push(signal(
        "MASTERY_NEEDS_REVIEW",
        "LECTURE",
        "LOW",
        {
          metricId: "mastery.effective.needs_review.current",
          count: 1,
          window: "CURRENT_FRESH_RETENTION",
        },
        { lectureId, ...(subjectId ? { subjectId } : {}) },
      ));
    }
    if (row.reviewState === "DUE") {
      weaknesses.push(signal(
        "RETENTION_DUE",
        "LECTURE",
        "MODERATE",
        {
          metricId: "retention.due.current",
          count: 1,
          window: "CURRENT_FRESH_RETENTION",
        },
        { lectureId, ...(subjectId ? { subjectId } : {}) },
      ));
    }
    if (row.reviewState === "OVERDUE") {
      weaknesses.push(signal(
        "RETENTION_OVERDUE",
        "LECTURE",
        "HIGH",
        {
          metricId: "retention.overdue.current",
          count: 1,
          window: "CURRENT_FRESH_RETENTION",
        },
        { lectureId, ...(subjectId ? { subjectId } : {}) },
      ));
    }
  }

  const repeatedOutcomeTrend = objectiveTrend(input.objectiveLast90, true);
  if (repeatedOutcomeTrend.state === "IMPROVED") {
    positives.push({
      id: "OBJECTIVE_ACCURACY_IMPROVED",
      scope: "GLOBAL",
      evidence: {
        metricId: "mcq.objective_accuracy.equal_outcome_windows",
        numerator: repeatedOutcomeTrend.latest.correct ?? undefined,
        denominator: repeatedOutcomeTrend.latest.attempts ?? undefined,
        rateBps: repeatedOutcomeTrend.latest.accuracyRateBps ?? undefined,
        window: "LATEST_20_VS_PREVIOUS_20_OR_EQUAL_HALVES",
      },
    });
  }
  if (input.consistencyTrend.state === "IMPROVED") {
    positives.push({
      id: "CONSISTENCY_IMPROVED",
      scope: "GLOBAL",
      evidence: {
        metricId: "activity.active_days.equal_7d_trend",
        numerator: input.consistencyTrend.latestActiveDays ?? undefined,
        denominator: input.consistencyTrend.previousActiveDays ?? undefined,
        window: "LATEST_7_COMPLETE_DAYS_VS_PREVIOUS_7",
      },
    });
  }
  if (terminalCount >= 5 && uncompletedRate !== null && uncompletedRate <= 2_000) {
    positives.push({
      id: "HIGH_FOCUS_COMPLETION",
      scope: "GLOBAL",
      evidence: {
        metricId: "focus.completion_rate.30d",
        numerator: terminalCount - uncompletedCount,
        denominator: terminalCount,
        rateBps: 10_000 - uncompletedRate,
        window: "LAST_30_DAYS",
      },
    });
  }
  positives.sort((left, right) =>
    left.id.localeCompare(right.id)
    || (left.evidence.lastEvidenceAt ?? "").localeCompare(right.evidence.lastEvidenceAt ?? ""));

  return {
    weaknesses: sortWeaknessSignals(weaknesses).slice(0, STUDY_ANALYZER_MAX_SIGNALS),
    positives: positives.slice(0, STUDY_ANALYZER_MAX_SIGNALS),
  };
}

function consistencyTrend(
  activeDayKeys: Set<string>,
  available: boolean,
  asOf: Date,
): StudyAnalyzerDto["consistency"]["trend"] {
  if (!available) {
    return {
      state: "INSUFFICIENT_DATA",
      latestActiveDays: null,
      previousActiveDays: null,
      minimumChangeDays: STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS,
    };
  }
  const today = baghdadDayKey(asOf);
  const utcToday = Date.parse(`${today}T00:00:00.000Z`);
  const latestStartKey = new Date(utcToday - 7 * 86_400_000).toISOString().slice(0, 10);
  const previousStartKey = new Date(utcToday - 14 * 86_400_000).toISOString().slice(0, 10);
  const latestActiveDays = [...activeDayKeys].filter((key) =>
    key >= latestStartKey && key < today).length;
  const previousActiveDays = [...activeDayKeys].filter((key) =>
    key >= previousStartKey && key < latestStartKey).length;
  const difference = latestActiveDays - previousActiveDays;
  return {
    state: difference >= STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS
      ? "IMPROVED"
      : difference <= -STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS
        ? "DECLINED"
        : "STABLE",
    latestActiveDays,
    previousActiveDays,
    minimumChangeDays: STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS,
  };
}

function currentStreak(
  activeDayKeys: Set<string>,
  available: boolean,
  asOf: Date,
): { days: number | null; capped: boolean } {
  if (!available) return { days: null, capped: false };
  const today = baghdadDayKey(asOf);
  const utcToday = Date.parse(`${today}T00:00:00.000Z`);
  const yesterday = new Date(utcToday - 86_400_000).toISOString().slice(0, 10);
  let current = activeDayKeys.has(today) ? today : activeDayKeys.has(yesterday) ? yesterday : null;
  if (!current) return { days: 0, capped: false };
  const maximumKnownDays = current === today
    ? STUDY_ANALYZER_LOOKBACK_DAYS
    : STUDY_ANALYZER_LOOKBACK_DAYS - 1;
  let count = 0;
  while (current && activeDayKeys.has(current)) {
    count += 1;
    const prior = new Date(Date.parse(`${current}T00:00:00.000Z`) - 86_400_000)
      .toISOString().slice(0, 10);
    current = activeDayKeys.has(prior) ? prior : null;
  }
  return count >= maximumKnownDays
    ? { days: null, capped: true }
    : { days: count, capped: false };
}

function assignObjectiveOutcomesToSessions(
  sessions: MeaningfulFocusSession[],
  outcomes: ObjectiveOutcome[],
): SessionOutcomeAssociation[] {
  const byLecture = new Map<string, MeaningfulFocusSession[]>();
  for (const session of sessions) {
    const rows = byLecture.get(session.lectureId) ?? [];
    rows.push(session);
    byLecture.set(session.lectureId, rows);
  }
  for (const rows of byLecture.values()) {
    rows.sort((left, right) =>
      left.endedAt.getTime() - right.endedAt.getTime()
      || left.id.localeCompare(right.id)
      || left.source.localeCompare(right.source));
  }
  const associations = new Map<string, SessionOutcomeAssociation>();
  for (const session of sessions) {
    associations.set(`${session.source}:${session.id}`, {
      session,
      attempts: 0,
      correct: 0,
    });
  }
  const linkWindowMs = 24 * 60 * 60 * 1000;
  for (const outcome of outcomes) {
    const candidates = byLecture.get(outcome.lectureId) ?? [];
    let low = 0;
    let high = candidates.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[middle]!.endedAt.getTime() <= outcome.occurredAt.getTime()) low = middle + 1;
      else high = middle;
    }
    const candidate = candidates[low - 1];
    if (
      !candidate
      || outcome.occurredAt.getTime() - candidate.endedAt.getTime() > linkWindowMs
    ) continue;
    const association = associations.get(`${candidate.source}:${candidate.id}`)!;
    association.attempts += 1;
    if (outcome.correct) association.correct += 1;
  }
  return [...associations.values()];
}

function bucketPatterns(
  sessions: MeaningfulFocusSession[],
  outcomes: ObjectiveOutcome[],
): {
  byLength: PatternBucket[];
  byTime: PatternBucket[];
} {
  const associations = assignObjectiveOutcomesToSessions(sessions, outcomes);
  const byLength = new Map<FocusDurationBucketId, PatternBucket>();
  const byTime = new Map<StudyTimeBucketId, PatternBucket>();
  for (const definition of STUDY_ANALYZER_FOCUS_DURATION_BUCKETS) {
    byLength.set(definition.id, {
      bucket: definition.id,
      sessions: 0,
      linkedSessions: 0,
      attempts: 0,
      correct: 0,
      latestLinkedAt: null,
    });
  }
  for (const definition of STUDY_ANALYZER_TIME_BUCKETS) {
    byTime.set(definition.id, {
      bucket: definition.id,
      sessions: 0,
      linkedSessions: 0,
      attempts: 0,
      correct: 0,
      latestLinkedAt: null,
    });
  }
  for (const association of associations) {
    const session = association.session;
    const length = focusBucket(session.durationSeconds);
    const time = timeBucket(session.startedAt);
    const update = (bucket: PatternBucket | undefined) => {
      if (!bucket) return;
      bucket.sessions += 1;
      bucket.attempts += association.attempts;
      bucket.correct += association.correct;
      if (association.attempts > 0) {
        bucket.linkedSessions += 1;
        if (
          !bucket.latestLinkedAt
          || session.endedAt.getTime() > bucket.latestLinkedAt.getTime()
        ) bucket.latestLinkedAt = session.endedAt;
      }
    };
    if (length) update(byLength.get(length));
    update(byTime.get(time));
  }
  return {
    byLength: [...byLength.values()],
    byTime: [...byTime.values()],
  };
}

function bestPatternBucket(rows: PatternBucket[]): PatternBucket | null {
  return rows
    .filter((row) => row.linkedSessions >= STUDY_ANALYZER_MIN_LINKED_PATTERN_SESSIONS && row.attempts > 0)
    .sort((left, right) =>
      (right.correct / right.attempts) - (left.correct / left.attempts)
      || right.linkedSessions - left.linkedSessions
      || right.attempts - left.attempts
      || (right.latestLinkedAt?.getTime() ?? 0) - (left.latestLinkedAt?.getTime() ?? 0)
      || left.bucket.localeCompare(right.bucket))[0] ?? null;
}

function buildStudyPatterns(
  sessions: MeaningfulFocusSession[],
  objectiveRows: ObjectiveOutcome[],
  asOf: Date,
  sourceDataComplete: boolean,
): StudyAnalyzerDto["patterns"] {
  const cutoff = baghdadDayStartDaysBefore(asOf, STUDY_ANALYZER_LOOKBACK_DAYS - 1);
  const recentSessions = sessions.filter((session) => session.endedAt >= cutoff && session.endedAt <= asOf);
  const recentObjectives = objectiveRows.filter((row) => row.occurredAt >= cutoff && row.occurredAt <= asOf);
  const patterns = bucketPatterns(recentSessions, recentObjectives);
  const bestLength = sourceDataComplete
    && recentSessions.length >= STUDY_ANALYZER_MIN_SESSION_PATTERN_SESSIONS
    ? bestPatternBucket(patterns.byLength)
    : null;
  const bestTime = sourceDataComplete
    && recentSessions.length >= STUDY_ANALYZER_MIN_TIME_OF_DAY_SESSIONS
    ? bestPatternBucket(patterns.byTime)
    : null;
  const mostUsedRow = sourceDataComplete && recentSessions.length >= STUDY_ANALYZER_MIN_MOST_USED_SESSIONS
    ? patterns.byTime
      .slice()
      .sort((left, right) =>
        right.sessions - left.sessions
        || STUDY_ANALYZER_TIME_BUCKETS.findIndex((entry) => entry.id === left.bucket)
          - STUDY_ANALYZER_TIME_BUCKETS.findIndex((entry) => entry.id === right.bucket))[0]
    : null;
  const result: StudyAnalyzerDto["patterns"] = {
    sessionLength: {
      status: bestLength ? "SUPPORTED_PATTERN" : "INSUFFICIENT_DATA",
      interpretationScope: "OBSERVED_ASSOCIATION",
      window: "LAST_90_DAYS",
      ...(bestLength ? {
        bucket: bestLength.bucket as FocusDurationBucketId,
        linkedSessions: bestLength.linkedSessions,
        objectiveAttempts: bestLength.attempts,
        objectiveCorrect: bestLength.correct,
        objectiveCorrectRateBps: rateBps(bestLength.correct, bestLength.attempts) ?? undefined,
      } : {}),
      minimumMeaningfulSessions: STUDY_ANALYZER_MIN_SESSION_PATTERN_SESSIONS,
      minimumLinkedSessionsPerBucket: STUDY_ANALYZER_MIN_LINKED_PATTERN_SESSIONS,
      outcomeLinkWindowHours: 24,
      tieBreakOrder: [
        "objectiveCorrectRateBps DESC",
        "linkedSessions DESC",
        "objectiveAttempts DESC",
        "latestLinkedEvidenceAt DESC",
        "bucketId ASC",
      ],
    },
    timeOfDay: {
      mostUsedTimeOfDay: {
        status: mostUsedRow ? "SUPPORTED_PATTERN" : "INSUFFICIENT_DATA",
        ...(mostUsedRow ? {
          bucket: mostUsedRow.bucket as StudyTimeBucketId,
          meaningfulSessions: mostUsedRow.sessions,
        } : {}),
        minimumSessions: STUDY_ANALYZER_MIN_MOST_USED_SESSIONS,
      },
      bestSupportedOutcomeTimeBucket: {
        status: bestTime ? "SUPPORTED_PATTERN" : "INSUFFICIENT_DATA",
        interpretationScope: "OBSERVED_ASSOCIATION",
        window: "LAST_90_DAYS",
        ...(bestTime ? {
          bucket: bestTime.bucket as StudyTimeBucketId,
          linkedSessions: bestTime.linkedSessions,
          objectiveAttempts: bestTime.attempts,
          objectiveCorrect: bestTime.correct,
          objectiveCorrectRateBps: rateBps(bestTime.correct, bestTime.attempts) ?? undefined,
        } : {}),
        minimumMeaningfulSessions: STUDY_ANALYZER_MIN_TIME_OF_DAY_SESSIONS,
        minimumLinkedSessionsPerBucket: STUDY_ANALYZER_MIN_LINKED_PATTERN_SESSIONS,
        outcomeLinkWindowHours: 24,
        tieBreakOrder: [
          "objectiveCorrectRateBps DESC",
          "linkedSessions DESC",
          "objectiveAttempts DESC",
          "latestLinkedEvidenceAt DESC",
          "bucketId ASC",
        ],
      },
      bucketBoundariesBaghdad: {
        MORNING: "05:00-11:59",
        AFTERNOON: "12:00-16:59",
        EVENING: "17:00-21:59",
        NIGHT: "22:00-04:59",
      },
    },
  };
  return result;
}

export function buildStudyAnalyzerDto(
  snapshot: StudyAnalyzerSnapshot,
  asOf: Date,
): StudyAnalyzerDto {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Analyzer server time is invalid.");
  const { resolved: windows, dto: windowDtos } = resolveStudyAnalyzerWindows(asOf);
  const subjectByLecture = subjectMapFromSnapshot(snapshot);
  const mcqOutcomes = normalizeMcqOutcomes(snapshot.mcq.rows);
  const recallObjectiveOutcomes = normalizeRecallObjectiveOutcomes(
    snapshot.recall.rows,
    subjectByLecture,
  );
  const combinedObjectiveRows = deduplicateObjectiveOutcomes([
    ...mcqOutcomes,
    ...recallObjectiveOutcomes,
  ]);
  const normalFlashcardOutcomes = normalizeFlashcardOutcomes(snapshot.flashcards.rows);
  const recallFlashcardOutcomes = normalizeRecallFlashcardOutcomes(
    snapshot.recall.rows,
    subjectByLecture,
  );
  const combinedFlashcardRows = deduplicateFlashcardOutcomes([
    ...normalFlashcardOutcomes,
    ...recallFlashcardOutcomes,
  ]);
  const meaningfulSessions = normalizeMeaningfulFocusSessions(
    snapshot.focus.rows,
    snapshot.groupFocus.rows,
    asOf,
  );
  const terminalSoloSessions = normalizeTerminalSoloSessions(snapshot.focus.rows, asOf);
  const history90Window = {
    from: baghdadDayStartDaysBefore(asOf, STUDY_ANALYZER_LOOKBACK_DAYS - 1),
    to: asOf,
  };
  const timedEvidence = makeTimedEvidence(
    combinedObjectiveRows,
    combinedFlashcardRows,
    snapshot.recall.rows,
    meaningfulSessions,
    subjectByLecture,
  );

  const sourceSupportsWindow = (
    name: "last7Days" | "last30Days" | "currentSemester",
    sources: StudyAnalyzerSourceSlice<unknown>[],
  ) => allSourcesCover(sources, windows[name]);
  const activitySources = [
    snapshot.focus,
    snapshot.groupFocus,
    snapshot.mcq,
    snapshot.flashcards,
    snapshot.recall,
  ] as StudyAnalyzerSourceSlice<unknown>[];
  const activeDaySets = new Map<"last7Days" | "last30Days" | "currentSemester", Set<string>>();
  for (const name of ["last7Days", "last30Days", "currentSemester"] as const) {
    const period = windows[name];
    const values = new Set<string>();
    if (period) {
      for (const evidence of timedEvidence) {
        if (isInWindow(evidence.at, period)) values.add(baghdadDayKey(evidence.at));
      }
    }
    activeDaySets.set(name, values);
  }
  const activeDayAvailability = new Map(
    (["last7Days", "last30Days", "currentSemester"] as const).map((name) => [
      name,
      sourceSupportsWindow(name, activitySources),
    ]),
  );
  const activeDays = windowed((name) =>
    activeDayAvailability.get(name)
      ? activeDaySets.get(name)!.size
      : null);
  const history90DayKeys = new Set<string>();
  for (const evidence of timedEvidence) {
    if (isInWindow(evidence.at, history90Window)) {
      history90DayKeys.add(baghdadDayKey(evidence.at));
    }
  }
  const history90Complete = allSourcesCover(activitySources, history90Window);

  const focusSources = [snapshot.focus, snapshot.groupFocus] as StudyAnalyzerSourceSlice<unknown>[];
  const focusTerminalLast30 = inRangeCount(
    terminalSoloSessions,
    (row) => row.endedAt,
    windows.last30Days,
  );
  const focusMeaningfulLast30 = inRangeCount(
    meaningfulSessions,
    (row) => row.endedAt,
    windows.last30Days,
  );
  const focusFacts = {
    meaningfulCompletedSessions: windowed((name) => {
      if (!sourceSupportsWindow(name, focusSources)) return null;
      return inRangeCount(meaningfulSessions, (row) => row.endedAt, windows[name]).length;
    }),
    verifiedFocusSeconds: windowed((name) => {
      if (!sourceSupportsWindow(name, focusSources)) return null;
      return inRangeCount(meaningfulSessions, (row) => row.endedAt, windows[name])
        .reduce((sum, row) => sum + row.durationSeconds, 0);
    }),
    averageMeaningfulSessionSeconds: windowed((name) => {
      if (!sourceSupportsWindow(name, focusSources)) return null;
      const rows = inRangeCount(meaningfulSessions, (row) => row.endedAt, windows[name]);
      return rows.length === 0
        ? null
        : Math.round(rows.reduce((sum, row) => sum + row.durationSeconds, 0) / rows.length);
    }),
    uncompletedSessionCount: windowed((name) => {
      if (!sourceCoversWindow(snapshot.focus, windows[name])) return null;
      return inRangeCount(terminalSoloSessions, (row) => row.endedAt, windows[name])
        .filter((row) => row.status === "ABANDONED" || row.status === "EXPIRED").length;
    }),
    completion: windowed((name): FocusCompletionMetric => {
      if (!sourceCoversWindow(snapshot.focus, windows[name])) {
        return { completedSessions: null, terminalSessions: null, completionRateBps: null };
      }
      const terminal = inRangeCount(terminalSoloSessions, (row) => row.endedAt, windows[name]);
      const completed = terminal.filter((row) => row.status === "COMPLETED").length;
      return {
        completedSessions: completed,
        terminalSessions: terminal.length,
        completionRateBps: rateBps(completed, terminal.length),
      };
    }),
  };

  const objectiveWindow = (
    rows: ObjectiveOutcome[],
    name: "last7Days" | "last30Days" | "currentSemester",
    sources: StudyAnalyzerSourceSlice<unknown>[],
  ) => metricFromOutcomes(
    inRangeCount(rows, (row) => row.occurredAt, windows[name]),
    sourceSupportsWindow(name, sources),
  );
  const objectiveWindowed = (
    rows: ObjectiveOutcome[],
    sources: StudyAnalyzerSourceSlice<unknown>[],
  ): Windowed<ObjectiveMetric> => windowed((name) => objectiveWindow(rows, name, sources));
  const normalMcqMetrics = objectiveWindowed(mcqOutcomes, [snapshot.mcq]);
  const recallObjectiveMetrics = objectiveWindowed(recallObjectiveOutcomes, [snapshot.recall]);
  const combinedObjectiveMetrics = objectiveWindowed(combinedObjectiveRows, [
    snapshot.mcq,
    snapshot.recall,
  ]);

  const flashcardSources = [snapshot.flashcards, snapshot.recall] as StudyAnalyzerSourceSlice<unknown>[];
  const flashcardMetrics = windowed((name) => metricFromFlashcards(
    inRangeCount(combinedFlashcardRows, (row) => row.occurredAt, windows[name]),
    sourceSupportsWindow(name, flashcardSources),
  ));

  const recallAvailability = (name: "last7Days" | "last30Days" | "currentSemester") =>
    sourceCoversWindow(snapshot.recall, windows[name]);
  const periodicRows = snapshot.recall.rows.filter((row) =>
    row.issuanceSource === "PERIODIC" && row.privacyClass === "PRIVATE_STUDY");
  const periodicActivity = windowed((name) => {
    if (!recallAvailability(name)) {
      return { presented: null, answered: null, skipped: null, expired: null };
    }
    const rows = inRangeCount(periodicRows, (row) => row.presentedAt, windows[name]);
    return {
      presented: rows.length,
      answered: rows.filter((row) => row.status === "ANSWERED").length,
      skipped: rows.filter((row) => row.status === "SKIPPED").length,
      expired: rows.filter((row) => row.status === "EXPIRED").length,
    };
  });
  const recallAnsweredRows = snapshot.recall.rows.filter(isValidRecallAnswer);
  const answeredOutcomes = windowed((name) => {
    if (!recallAvailability(name)) {
      return {
        objectiveCorrect: null,
        objectiveIncorrect: null,
        flashcardRemembered: null,
        flashcardNotRemembered: null,
        flashcardNeutral: null,
      };
    }
    const rows = inRangeCount(recallAnsweredRows, (row) => row.answeredAt, windows[name]);
    return {
      objectiveCorrect: rows.filter((row) => row.itemType === "MCQ" && row.outcome === "CORRECT").length,
      objectiveIncorrect: rows.filter((row) => row.itemType === "MCQ" && row.outcome === "INCORRECT").length,
      flashcardRemembered: rows.filter((row) =>
        row.itemType === "FLASHCARD" && row.outcome === "SELF_REPORTED_EASY").length,
      flashcardNotRemembered: rows.filter((row) =>
        row.itemType === "FLASHCARD" && row.outcome === "SELF_REPORTED_HARD").length,
      flashcardNeutral: rows.filter((row) =>
        row.itemType === "FLASHCARD" && row.outcome === "SELF_REPORTED_MEDIUM").length,
    };
  });

  const activeDayKeys = activeDaySets.get("last30Days")!;
  const trendAvailable = activeDayAvailability.get("last30Days") === true;
  const consistencyChange = consistencyTrend(activeDayKeys, trendAvailable, asOf);
  const weekInfo = getCurrentAndCompletedWeeks(asOf);
  const completedWeeks = weekInfo.completedWeeks.map(({ from, toExclusive }) => {
    const available = allSourcesCover(activitySources, {
      from,
      to: new Date(toExclusive.getTime() - 1),
    });
    if (!available) {
      return {
        from: from.toISOString(),
        toExclusive: toExclusive.toISOString(),
        activeDays: null,
        activeDayRateBps: null,
      };
    }
    const fromKey = baghdadDayKey(from);
    const toKey = baghdadDayKey(toExclusive);
    const days = [...history90DayKeys].filter((key) => key >= fromKey && key < toKey).length;
    return {
      from: from.toISOString(),
      toExclusive: toExclusive.toISOString(),
      activeDays: days,
      activeDayRateBps: rateBps(days, 7),
    };
  });
  const currentWeekStartKey = baghdadDayKey(weekInfo.currentWeekStart);
  const todayKey = baghdadDayKey(asOf);
  const currentWeekActiveDays = trendAvailable
    ? [...history90DayKeys].filter((key) => key >= currentWeekStartKey && key <= todayKey).length
    : null;
  const consistencyStreak = currentStreak(history90DayKeys, history90Complete, asOf);
  const thirtyDayDenominator = windows.last30Days
    ? Math.max(1, calendarDaysBetween(
        baghdadDayKey(windows.last30Days.from),
        baghdadDayKey(asOf),
      ) + 1)
    : 0;
  const activeDays30 = activeDays.last30Days;
  const consistency = {
    activeStudyDays: activeDays,
    activeStudyDayRateBpsLast30Days: activeDays30 === null
      ? null
      : rateBps(activeDays30, thirtyDayDenominator),
    currentConsistencyStreakDays: consistencyStreak.days,
    streakCappedAtLookback: consistencyStreak.capped,
    streakAnchorRule: "TODAY_OR_YESTERDAY" as const,
    currentWeekActiveDays,
    daysElapsedInCurrentWeek: weekInfo.daysElapsedInCurrentWeek,
    completedWeeks,
    trend: consistencyChange,
  };

  const mcqAndRecallLast30Complete = sourceSupportsWindow("last30Days", [
    snapshot.mcq,
    snapshot.recall,
  ]);
  const flashcardsAndRecallLast30Complete = sourceSupportsWindow("last30Days", flashcardSources);
  const subjectAttributionComplete = snapshot.lectureSubjects.available
    && snapshot.lectureSubjects.complete
    && !snapshot.lectureSubjects.truncated;
  const mcqAndRecallLast90Complete = sourceCoversWindow(snapshot.mcq, history90Window)
    && sourceCoversWindow(snapshot.recall, history90Window);
  const objectivesLast30 = inRangeCount(
    combinedObjectiveRows,
    (row) => row.occurredAt,
    windows.last30Days,
  );
  const objectivesLast90 = combinedObjectiveRows.filter((row) =>
    isInWindow(row.occurredAt, history90Window));
  const objectiveTrendResult = objectiveTrend(objectivesLast90, mcqAndRecallLast90Complete);
  const repeatedErrors = mcqAndRecallLast90Complete
    ? buildRepeatedErrors(objectivesLast90, subjectByLecture)
    : [];
  const flashcardsLast30 = inRangeCount(
    combinedFlashcardRows,
    (row) => row.occurredAt,
    windows.last30Days,
  );

  const masteryComplete = snapshot.mastery.available
    && snapshot.mastery.complete
    && !snapshot.mastery.truncated
    && snapshot.mastery.trackedLectureCount !== null
    && snapshot.mastery.rows.length === snapshot.mastery.trackedLectureCount;
  const retentionComplete = snapshot.retention.available
    && snapshot.retention.complete
    && !snapshot.retention.truncated
    && masteryComplete;
  const retentionData = buildRetentionData(
    snapshot.mastery.rows,
    snapshot.retention.rows,
    subjectByLecture,
    asOf,
    retentionComplete,
  );

  const baseDistribution = masteryComplete
    ? countStates(snapshot.mastery.rows.map((row) => ({ state: row.state })))
    : null;
  const effectiveFreshRows = [...retentionData.freshRowsByLecture.values()];
  const effectiveDistribution = retentionComplete
    ? countStates(effectiveFreshRows.map((row) => ({ state: row.effectiveMasteryState })))
    : null;
  const evaluatedAt = masteryComplete && snapshot.mastery.rows.length > 0
    ? snapshot.mastery.rows.map((row) => row.lastEvaluatedAt.getTime()).sort((a, b) => a - b)
    : [];
  const masteryProjectionEvaluatedAt = {
    oldest: evaluatedAt.length ? new Date(evaluatedAt[0]!).toISOString() : null,
    newest: evaluatedAt.length ? new Date(evaluatedAt.at(-1)!).toISOString() : null,
  };

  const incompleteWindows = (["last7Days", "last30Days", "currentSemester"] as const)
    .filter((name) =>
      windowDtos[name].status === "AVAILABLE"
      && !activeDayAvailability.get(name));
  const dataQuality = {
    trackedLectureCount: snapshot.mastery.trackedLectureCount,
    masteryRows: masteryComplete ? snapshot.mastery.rows.length : null,
    retention: {
      freshRows: retentionData.freshRows,
      staleRows: retentionData.staleRows,
      missingRows: retentionData.missingRows,
    },
    mcqDataAvailable: snapshot.mcq.available && snapshot.mcq.complete && !snapshot.mcq.truncated,
    flashcardDataAvailable: snapshot.flashcards.available
      && snapshot.flashcards.complete
      && !snapshot.flashcards.truncated,
    recallDataAvailable: snapshot.recall.available && snapshot.recall.complete && !snapshot.recall.truncated,
    focusDataAvailable: snapshot.focus.available && snapshot.focus.complete && !snapshot.focus.truncated,
    groupFocusDataAvailable: snapshot.groupFocus.available
      && snapshot.groupFocus.complete
      && !snapshot.groupFocus.truncated,
    masteryDataAvailable: masteryComplete,
    retentionDataAvailable: retentionComplete,
    sources: {
      focus: sourceQuality(snapshot.focus),
      groupFocus: sourceQuality(snapshot.groupFocus),
      mcq: sourceQuality(snapshot.mcq),
      flashcards: sourceQuality(snapshot.flashcards),
      recall: sourceQuality(snapshot.recall),
      mastery: sourceQuality(snapshot.mastery),
      retention: sourceQuality(snapshot.retention),
      lectureSubjects: sourceQuality(snapshot.lectureSubjects),
    },
    incompleteWindows,
    insufficientForTimeOfDayPattern: !(
      sourceSupportsWindow("last30Days", focusSources)
      && sourceSupportsWindow("last30Days", [snapshot.mcq, snapshot.recall])
    ),
    insufficientForSessionLengthPattern: !(
      sourceSupportsWindow("last30Days", focusSources)
      && sourceSupportsWindow("last30Days", [snapshot.mcq, snapshot.recall])
    ),
    subjectFactsTruncated: false,
  };

  const subjectStats = new Map<string, {
    activity: TimedEvidence[];
    focusSeconds: number;
    objectiveRows: ObjectiveOutcome[];
    flashcardRows: FlashcardOutcome[];
    recallAnswered: number;
    trackedLectures: number;
    baseMasteryStates: Record<string, number>;
    effectiveMasteryStates: Record<string, number>;
    dueReviewCount: number;
  }>();
  const ensureSubject = (subjectId: string | null | undefined) => {
    if (!subjectId) return null;
    let current = subjectStats.get(subjectId);
    if (!current) {
      current = {
        activity: [],
        focusSeconds: 0,
        objectiveRows: [],
        flashcardRows: [],
        recallAnswered: 0,
        trackedLectures: 0,
        baseMasteryStates: {},
        effectiveMasteryStates: {},
        dueReviewCount: 0,
      };
      subjectStats.set(subjectId, current);
    }
    return current;
  };
  for (const item of timedEvidence) {
    if (!isInWindow(item.at, windows.last30Days)) continue;
    ensureSubject(item.subjectId)?.activity.push(item);
  }
  for (const session of focusMeaningfulLast30) {
    const bucket = ensureSubject(session.subjectId);
    if (bucket) bucket.focusSeconds += session.durationSeconds;
  }
  if (mcqAndRecallLast30Complete) {
    for (const row of objectivesLast30) ensureSubject(row.subjectId)?.objectiveRows.push(row);
  }
  if (flashcardsAndRecallLast30Complete) {
    for (const row of flashcardsLast30) ensureSubject(row.subjectId)?.flashcardRows.push(row);
  }
  for (const attempt of recallAnsweredRows) {
    if (!isInWindow(attempt.answeredAt, windows.last30Days)) continue;
    const subject = ensureSubject(subjectByLecture.get(attempt.lectureId));
    if (subject) subject.recallAnswered += 1;
  }
  if (masteryComplete) {
    for (const row of snapshot.mastery.rows) {
      const bucket = ensureSubject(row.lecture.mainSubject);
      if (bucket) {
        bucket.trackedLectures += 1;
        bucket.baseMasteryStates[row.state] = (bucket.baseMasteryStates[row.state] ?? 0) + 1;
      }
    }
  }
  if (retentionComplete) {
    for (const row of effectiveFreshRows) {
      const bucket = ensureSubject(subjectByLecture.get(row.lectureId));
      if (!bucket) continue;
      bucket.effectiveMasteryStates[row.effectiveMasteryState] =
        (bucket.effectiveMasteryStates[row.effectiveMasteryState] ?? 0) + 1;
      if (
        row.reviewState === "DUE"
        || row.reviewState === "OVERDUE"
        || row.effectiveMasteryState === "NEEDS_REVIEW"
      ) bucket.dueReviewCount += 1;
    }
  }
  const sortedSubjectIds = [...subjectStats.keys()].sort((left, right) => left.localeCompare(right));
  const subjectFactsTruncated = sortedSubjectIds.length > STUDY_ANALYZER_MAX_SUBJECTS;
  const subjects = sortedSubjectIds.slice(0, STUDY_ANALYZER_MAX_SUBJECTS).map((subjectId) => {
    const stats = subjectStats.get(subjectId)!;
    const subjectDays = new Set(stats.activity.map((row) => baghdadDayKey(row.at)));
    return {
      subjectId,
      activeStudyDaysLast30Days: sourceSupportsWindow("last30Days", activitySources)
        && subjectAttributionComplete
        ? subjectDays.size
        : null,
      meaningfulFocusSecondsLast30Days: sourceSupportsWindow("last30Days", focusSources)
        ? stats.focusSeconds
        : null,
      objectiveAttemptsLast30Days: mcqAndRecallLast30Complete && subjectAttributionComplete
        ? stats.objectiveRows.length
        : null,
      objectiveCorrectLast30Days: mcqAndRecallLast30Complete && subjectAttributionComplete
        ? stats.objectiveRows.filter((row) => row.correct).length
        : null,
      objectiveAccuracyRateBpsLast30Days: mcqAndRecallLast30Complete && subjectAttributionComplete
        ? rateBps(
            stats.objectiveRows.filter((row) => row.correct).length,
            stats.objectiveRows.length,
          )
        : null,
      flashcardReviewsLast30Days: flashcardsAndRecallLast30Complete && subjectAttributionComplete
        ? stats.flashcardRows.length
        : null,
      recallAnsweredLast30Days: recallAvailability("last30Days") && subjectAttributionComplete
        ? stats.recallAnswered
        : null,
      trackedLectures: masteryComplete ? stats.trackedLectures : null,
      effectiveMasteryDistributionFreshOnly: retentionComplete
        ? Object.fromEntries(
            Object.entries(stats.effectiveMasteryStates)
              .sort(([left], [right]) => left.localeCompare(right)),
          )
        : null,
      dueReviewCount: retentionComplete ? stats.dueReviewCount : null,
    };
  });
  dataQuality.subjectFactsTruncated = subjectFactsTruncated;

  const signals = buildSignals({
    objectiveLast30: mcqAndRecallLast30Complete ? objectivesLast30 : [],
    objectiveLast90: mcqAndRecallLast90Complete ? objectivesLast90 : [],
    flashcardsLast30: flashcardsAndRecallLast30Complete ? flashcardsLast30 : [],
    focusTerminalLast30: sourceCoversWindow(snapshot.focus, windows.last30Days)
      ? focusTerminalLast30
      : [],
    consistencyTrend: sourceSupportsWindow("last30Days", activitySources)
      ? consistencyChange
      : {
          state: "INSUFFICIENT_DATA",
          latestActiveDays: null,
          previousActiveDays: null,
          minimumChangeDays: STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS,
        },
    freshRetentionRows: retentionComplete
      ? retentionData.freshRowsByLecture
      : new Map(),
    repeatedErrors: mcqAndRecallLast90Complete ? repeatedErrors : [],
    subjectByLecture,
  });
  const objectiveWeaknesses = signals.weaknesses;
  const positives = signals.positives;

  const patternSourceComplete =
    sourceCoversWindow(snapshot.focus, history90Window)
    && sourceCoversWindow(snapshot.groupFocus, history90Window)
    && sourceCoversWindow(snapshot.mcq, history90Window)
    && sourceCoversWindow(snapshot.recall, history90Window);
  const patterns = buildStudyPatterns(
    meaningfulSessions,
    combinedObjectiveRows,
    asOf,
    patternSourceComplete,
  );
  dataQuality.insufficientForSessionLengthPattern =
    patterns.sessionLength.status !== "SUPPORTED_PATTERN";
  dataQuality.insufficientForTimeOfDayPattern =
    patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status !== "SUPPORTED_PATTERN";

  const durationDistributionLast30Days = STUDY_ANALYZER_FOCUS_DURATION_BUCKETS.map((bucket) => {
    const rows = focusMeaningfulLast30.filter((session) => focusBucket(session.durationSeconds) === bucket.id);
    const available = sourceSupportsWindow("last30Days", focusSources);
    return {
      bucket: bucket.id,
      meaningfulSessions: available ? rows.length : null,
      verifiedFocusSeconds: available
        ? rows.reduce((sum, row) => sum + row.durationSeconds, 0)
        : null,
    };
  });

  const dto: StudyAnalyzerDto = {
    analyzerVersion: STUDY_ANALYZER_VERSION,
    factRegistryVersion: STUDY_ANALYZER_FACT_REGISTRY_VERSION,
    generatedAt: asOf.toISOString(),
    asOf: asOf.toISOString(),
    timezone: STUDY_ANALYZER_TIMEZONE,
    windows: windowDtos,
    dataQuality,
    activity: {
      activeStudyDays: activeDays,
      activeDayEvidenceTypes: [
        "MEANINGFUL_COMPLETED_FOCUS",
        "VERIFIED_GROUP_FOCUS",
        "SERVER_VALIDATED_MCQ",
        "FLASHCARD_REVIEW",
        "ANSWERED_RECALL",
      ],
      activeDayTimeBasisBySource: {
        soloFocus: "ACTUAL_ENDED_AT",
        groupFocus: "RUNTIME_ENDED_AT",
        studyEvents: "RECEIVED_AT",
        recall: "ANSWERED_AT",
      },
      excludedActivityEvidence: [
        "RESOURCE_OPEN_OR_LAUNCH",
        "UNCOMPLETED_FOCUS",
        "RECALL_SKIP_OR_EXPIRY",
      ],
    },
    focus: {
      meaningfulThresholdSeconds: MASTERY_MEANINGFUL_FOCUS_SECONDS,
      ...focusFacts,
      durationDistributionLast30Days,
      completionStatusesIncluded: ["COMPLETED", "ABANDONED", "EXPIRED"],
      uncompletedStatusesIncluded: ["ABANDONED", "EXPIRED"],
    },
    consistency,
    objectivePractice: {
      normalMcq: normalMcqMetrics,
      recallObjective: recallObjectiveMetrics,
      combinedObjective: combinedObjectiveMetrics,
      trend: {
        ...objectiveTrendResult,
        sampleStrategy: "LATEST_20_VS_PREVIOUS_20_OR_EQUAL_HALVES",
        minimumTotalOutcomes: STUDY_ANALYZER_MIN_OBJECTIVE_TREND_OUTCOMES,
        changeThresholdBps: STUDY_ANALYZER_OBJECTIVE_TREND_DELTA_BPS,
      },
      repeatedErrors,
    },
    flashcards: { reviews: flashcardMetrics },
    recall: {
      periodicActivityWindowBasis: "PRESENTED_AT",
      periodicActivity,
      answeredOutcomes,
      skipAndExpiryAreLearningFailures: false,
    },
    mastery: {
      trackedLectureCount: snapshot.mastery.trackedLectureCount,
      baseMasteryDistribution: baseDistribution,
      effectiveMasteryDistributionFreshOnly: effectiveDistribution,
      projectionEvaluatedAt: masteryProjectionEvaluatedAt,
      historicalImprovementAvailable: false,
    },
    retention: {
      freshRows: retentionData.freshRows,
      staleRows: retentionData.staleRows,
      missingRows: retentionData.missingRows,
      due: retentionData.due,
      overdue: retentionData.overdue,
      needsReview: retentionData.needsReview,
      dueReviews: retentionData.dueReviews,
      staleRetentionPresentedAsCurrent: false,
    },
    subjects,
    weaknesses: objectiveWeaknesses,
    positives,
    patterns,
  };
  const serializedSize = Buffer.byteLength(JSON.stringify(dto), "utf8");
  if (serializedSize > STUDY_ANALYZER_MAX_DTO_BYTES) {
    throw new Error("STUDY_ANALYZER_DTO_SIZE_LIMIT_EXCEEDED");
  }
  return dto;
}

export function getStudyAnalyzerFactReadiness(dto: StudyAnalyzerDto): {
  sourceIds: string[];
  dtoBytes: number;
} {
  return {
    sourceIds: [
      "activity.active_days.7d",
      "activity.active_days.30d",
      "activity.active_days.semester",
      "focus.meaningful_sessions.30d",
      "focus.verified_seconds.30d",
      "focus.completion_rate.30d",
      "mcq.objective_attempts.30d",
      "mcq.objective_accuracy.30d",
      "mcq.repeated_errors.90d",
      "flashcards.meaningful_reviews.30d",
      "recall.periodic_answered.30d",
      "mastery.effective.needs_review.current",
      "retention.overdue.current",
    ],
    dtoBytes: Buffer.byteLength(JSON.stringify(dto), "utf8"),
  };
}
